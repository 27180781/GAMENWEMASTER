// @ts-check
/**
 * שליחת התוצאות של משחק שהורץ בתוכנה למערכת יצירת המשחקים, כדי שיופיעו
 * ב«האירועים שלי» כמו משחק טלפונים (פונקציית save-offline-result בבונה).
 *
 * בסוף כל הפעלה (מסך המנצחים) ה-renderer מוסר את התוצאה, והיא נכתבת לתיקיית
 * `results-outbox` בתיקיית הנתונים, קובץ לכל הפעלה. משם היא יוצאת כשיש רשת:
 * מיד, בפתיחת התוכנה, וכל כמה דקות כל עוד משהו ממתין. כך משחק שהורץ בלי
 * אינטרנט נשלח כשהמחשב מתחבר, גם אחרי שהתוכנה נסגרה ונפתחה.
 *
 * השרת מזהה הפעלה לפי (gameId, runId) ושומר אותה פעם אחת, ולכן שליחה חוזרת
 * (תשובה שלא הגיעה, שתי התוכנות פתוחות) אינה יוצרת כפילות. מה שהשרת דחה
 * לצמיתות (משחק שלא קיים, תוכן לא תקין) עובר ל-`failed/` ולא נשלח שוב;
 * שרת שעוד לא מכיר את הפונקציה (404 בלי תשובה שלה), עומס או תקלה — נשאר בתור.
 *
 * הרשת מוזרקת (post), כדי שהלוגיקה תיבדק בלי Electron — tests/resultUpload.test.ts.
 */
const fs = require('node:fs');
const path = require('node:path');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;
const OUTBOX = 'results-outbox';
/** הפעלות לשליחה בכל סבב; השאר בסבב הבא. */
const MAX_PER_FLUSH = 20;
/** גודל מקסימלי של תוצאה אחת (השרת מגביל באותו גודל). */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * @typedef {{
 *   gameId: string,
 *   runId: string,
 *   startedAt: number,
 *   endedAt: number,
 *   gameState: Record<string, unknown>,
 * }} ResultEntry
 * @typedef {{ status: number, body: unknown }} PostResult
 * @typedef {{ sent: number, kept: number, dropped: number, offline: boolean }} FlushResult
 */

/** @param {string} userData */
function outboxDir(userData) {
  return path.join(userData, OUTBOX);
}

/**
 * בדיקת התוצאה שה-renderer מסר. null = לא נשלחת (משחק שנבנה במחשב ואין לו
 * מזהה במערכת, נתונים חסרים).
 * @param {unknown} raw
 * @returns {ResultEntry | null}
 */
function cleanEntry(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  if (typeof r.gameId !== 'string' || !UUID.test(r.gameId)) return null;
  if (typeof r.runId !== 'string' || !RUN_ID.test(r.runId)) return null;
  if (typeof r.startedAt !== 'number' || !Number.isFinite(r.startedAt)) return null;
  if (typeof r.endedAt !== 'number' || !Number.isFinite(r.endedAt)) return null;
  const gs = r.gameState;
  if (gs === null || typeof gs !== 'object' || Array.isArray(gs)) return null;
  const users = /** @type {Record<string, unknown>} */ (gs).users;
  if (users === null || typeof users !== 'object') return null;
  return {
    gameId: r.gameId.toLowerCase(),
    runId: r.runId,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    gameState: /** @type {Record<string, unknown>} */ (gs),
  };
}

/**
 * כתיבת תוצאה לתור. אותה הפעלה פעמיים (המשך מגיבוי שהגיע שוב לסוף) — הקובץ
 * מוחלף בתוצאה האחרונה. מחזיר false כשהתוצאה אינה נשלחת או שהכתיבה נכשלה.
 * @param {string} userData
 * @param {unknown} raw
 * @returns {boolean}
 */
function enqueueResult(userData, raw) {
  const entry = cleanEntry(raw);
  if (entry === null) return false;
  const text = JSON.stringify(entry);
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return false;
  const dir = outboxDir(userData);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${entry.gameId}_${entry.runId}.json`);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} userData */
function pendingFiles(userData) {
  const dir = outboxDir(userData);
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const full = path.join(dir, f);
        let mtime = 0;
        try {
          mtime = fs.statSync(full).mtimeMs;
        } catch {
          /* נמחק בינתיים */
        }
        return { full, name: f, mtime };
      })
      .sort((a, b) => a.mtime - b.mtime);
  } catch {
    return [];
  }
}

/** כמה תוצאות ממתינות לשליחה. @param {string} userData */
function pendingCount(userData) {
  return pendingFiles(userData).length;
}

/** @param {string} userData @param {string} full @param {string} name */
function moveToFailed(userData, full, name) {
  const failed = path.join(outboxDir(userData), 'failed');
  try {
    fs.mkdirSync(failed, { recursive: true });
    fs.renameSync(full, path.join(failed, name));
  } catch {
    try {
      fs.unlinkSync(full);
    } catch {
      /* כבר לא שם */
    }
  }
}

/**
 * האם התשובה היא של הפונקציה עצמה (ולא, למשל, 404 של שרת שעוד לא פרס אותה).
 * @param {unknown} body
 */
function isOwnAnswer(body) {
  return body !== null && typeof body === 'object' && typeof (/** @type {Record<string, unknown>} */ (body).code) === 'string';
}

/**
 * סבב שליחה אחד. כשל רשת עוצר את הסבב (אין טעם לנסות את השאר עכשיו).
 * @param {{ userData: string, post: (body: Record<string, unknown>) => Promise<PostResult> }} deps
 * @returns {Promise<FlushResult>}
 */
async function flushResults(deps) {
  const files = pendingFiles(deps.userData);
  /** @type {FlushResult} */
  const out = { sent: 0, kept: 0, dropped: 0, offline: false };
  for (const [i, f] of files.entries()) {
    if (i >= MAX_PER_FLUSH || out.offline) {
      out.kept += 1;
      continue;
    }
    /** @type {ResultEntry | null} */
    let entry = null;
    try {
      entry = cleanEntry(JSON.parse(fs.readFileSync(f.full, 'utf8')));
    } catch {
      entry = null;
    }
    if (entry === null) {
      moveToFailed(deps.userData, f.full, f.name);
      out.dropped += 1;
      continue;
    }
    /** @type {PostResult} */
    let res;
    try {
      res = await deps.post({ ...entry });
    } catch {
      out.offline = true;
      out.kept += 1;
      continue;
    }
    const body = /** @type {Record<string, unknown> | null} */ (
      res.body !== null && typeof res.body === 'object' ? res.body : null
    );
    if (res.status >= 200 && res.status < 300 && body !== null && body.success === true) {
      try {
        fs.unlinkSync(f.full);
      } catch {
        /* נמחק כבר */
      }
      out.sent += 1;
    } else if ([400, 404, 413, 422].includes(res.status) && isOwnAnswer(body)) {
      // סירוב סופי של הפונקציה (משחק שלא קיים, תוכן לא תקין) — לא שולחים שוב.
      moveToFailed(deps.userData, f.full, f.name);
      out.dropped += 1;
    } else {
      out.kept += 1;
    }
  }
  return out;
}

module.exports = { enqueueResult, flushResults, pendingCount, cleanEntry, OUTBOX, MAX_PER_FLUSH };
