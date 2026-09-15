// @ts-check
/**
 * הורדת עדכון התוכנה — הפרשית **וגם** ניתנת להמשך.
 *
 * electron-updater יודע להוריד הפרשית (רק הבלוקים שהשתנו, את השאר הוא מעתיק
 * מהמתקין הקודם ששמור אצלו), אבל הורדה שנקטעת מתחילה מאפס: הקובץ הזמני נמחק
 * בכל כישלון. כאן ההורדה עצמה נעשית בידינו, באותה תוכנית בדיוק (computeOperations
 * של electron-updater על שתי מפות הבלוקים), ומתקדמת בקובץ `.part` עם רישום
 * התקדמות לצדו: ניתוק באמצע משאיר את מה שירד, והפעם הבאה ממשיכה מאותה נקודה —
 * גם באמצע טווח הורדה. אין מפות או אין מתקין קודם? אותו מנגנון עם תוכנית של
 * טווח אחד — הורדה מלאה, גם היא עם המשך.
 *
 * בסיום הקובץ מאומת ב-sha512 מול הפיד ומונח בדיוק במקום שבו electron-updater
 * מחפש הורדה שכבר בוצעה (pending/<שם> + update-info.json), ואז קריאה ל-
 * downloadUpdate() שלו מוצאת אותו, מדלגת על ההורדה ומתקינה בסגירה כמו תמיד.
 *
 * הרשת והדיסק מוזרקים — ראו tests/updateDownload.test.ts.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
// מודול פנימי של electron-updater (גרסה נעולה ב-package-lock) — אותה תוכנית
// שהוא עצמו היה מבצע.
const { computeOperations, OperationKind } = require('electron-updater/out/differentialDownloader/downloadPlanBuilder');

const COPY_CHUNK = 1024 * 1024;
/** כל כמה בתים שהורדו לשמור את ההתקדמות (מעבר לשמירה בסוף כל פעולה). */
const CHECKPOINT_BYTES = 4 * 1024 * 1024;

/**
 * @typedef {{ kind: number, start: number, end: number }} Op
 * @typedef {{ version?: string, files: { name: string, offset: number, checksums: string[], sizes: number[] }[] }} BlockMap
 * @typedef {{ ok: true, bytes: number } | { ok: false, error: string, retryable: boolean, status?: number }} RangeResult
 * @typedef {(url: string, start: number, end: number, sink: (chunk: Buffer) => void) => Promise<RangeResult>} FetchRange
 * @typedef {{ transferred: number, total: number, percent: number, differential: boolean }} UpdateProgress
 */

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** @param {string} file */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** @param {Op[]} ops @param {string} sha512 */
function planHash(ops, sha512) {
  return crypto.createHash('sha256').update(JSON.stringify([sha512, ops])).digest('hex');
}

/** @param {Op[]} ops */
function downloadBytesOf(ops) {
  return ops.reduce((sum, op) => (op.kind === OperationKind.DOWNLOAD ? sum + (op.end - op.start) : sum), 0);
}

/**
 * התוכנית: הפרשית כשיש שתי מפות ומתקין קודם, אחרת טווח אחד של כל הקובץ.
 * @param {{ oldBlockMap: BlockMap | null, newBlockMap: BlockMap | null, oldFile: string | null, size: number, log: (m: string) => void }} args
 * @returns {{ ops: Op[], differential: boolean }}
 */
function buildPlan({ oldBlockMap, newBlockMap, oldFile, size, log }) {
  const full = { ops: [{ kind: OperationKind.DOWNLOAD, start: 0, end: size }], differential: false };
  if (oldBlockMap === null || newBlockMap === null || oldFile === null) return full;
  let oldSize = -1;
  try {
    oldSize = fs.statSync(oldFile).size;
  } catch {
    log('[update] אין מתקין קודם במטמון — הורדה מלאה');
    return full;
  }
  try {
    const ops = /** @type {Op[]} */ (computeOperations(oldBlockMap, newBlockMap, silentLogger));
    const assembled = ops.reduce((sum, op) => sum + (op.end - op.start), 0);
    const copyEnd = ops.reduce((max, op) => (op.kind === OperationKind.COPY ? Math.max(max, op.end) : max), 0);
    if (ops.length === 0 || assembled !== size || copyEnd > oldSize) {
      log(`[update] תוכנית הפרשית לא עקבית (${assembled} מול ${size}, העתקה עד ${copyEnd} מתוך ${oldSize}) — הורדה מלאה`);
      return full;
    }
    return { ops, differential: true };
  } catch (err) {
    log(`[update] חישוב ההפרש נכשל (${/** @type {Error} */ (err).message}) — הורדה מלאה`);
    return full;
  }
}

/**
 * @param {{
 *   pendingDir: string,
 *   fileName: string,
 *   sha512: string,
 *   size: number,
 *   newUrl: string,
 *   oldFile: string | null,
 *   oldBlockMap: BlockMap | null,
 *   newBlockMap: BlockMap | null,
 *   fetchRange: FetchRange,
 *   onProgress?: (p: UpdateProgress) => void,
 *   log?: (m: string) => void,
 * }} args
 * @returns {Promise<{ ok: true, file: string, differential: boolean, transferred: number } | { ok: false, error: string, retryable: boolean }>}
 */
async function downloadUpdate(args) {
  const { pendingDir, fileName, sha512, size, newUrl, oldFile, fetchRange, onProgress = () => {}, log = () => {} } = args;
  if (!(size > 0)) return { ok: false, error: 'הפיד אינו מציין את גודל המתקין', retryable: false };
  fs.mkdirSync(pendingDir, { recursive: true });
  const part = path.join(pendingDir, `${fileName}.part`);
  const stateFile = path.join(pendingDir, `${fileName}.resume.json`);

  // הפרש שכבר נכשל באימות (מתקין קודם פגום) — לא מנסים אותו שוב לאותו קובץ.
  const previous = readJson(stateFile);
  const differentialBanned = previous?.badDifferential === sha512;
  const plan = buildPlan({
    oldBlockMap: differentialBanned ? null : args.oldBlockMap,
    newBlockMap: differentialBanned ? null : args.newBlockMap,
    oldFile,
    size,
    log,
  });
  const { ops, differential } = plan;
  const total = downloadBytesOf(ops);
  const hash = planHash(ops, sha512);

  // המשך: אותה תוכנית, ואותו מספר בתים בדיסק כפי שנרשם.
  let opsDone = 0;
  let bytes = 0;
  let transferred = 0;
  let partSize = -1;
  try {
    partSize = fs.statSync(part).size;
  } catch {
    partSize = -1;
  }
  if (previous !== null && previous.hash === hash && partSize >= 0 && previous.bytes === partSize && previous.opsDone <= ops.length) {
    opsDone = previous.opsDone;
    bytes = previous.bytes;
    transferred = previous.transferred ?? 0;
    log(`[update] ממשיכים הורדה: ${(bytes / 1048576).toFixed(1)}MB כבר בדיסק`);
  } else {
    try {
      fs.rmSync(part, { force: true });
    } catch {
      /* אין */
    }
    fs.writeFileSync(part, '');
  }
  const save = (extra = {}) => {
    fs.writeFileSync(stateFile, JSON.stringify({ hash, sha512, opsDone, bytes, transferred, differential, ...extra }));
  };
  const report = () => onProgress({ transferred, total, percent: total > 0 ? Math.min(100, Math.round((transferred / total) * 100)) : 0, differential });
  save();
  report();

  // תחילת הפעולה הנוכחית בקובץ החדש — כדי להמשיך גם באמצע טווח.
  let opStart = 0;
  for (let i = 0; i < opsDone; i += 1) opStart += ops[i].end - ops[i].start;
  if (bytes < opStart || bytes > size) {
    // רישום לא עקבי — מתחילים מהתחלה בבטחה
    opsDone = 0;
    bytes = 0;
    transferred = 0;
    opStart = 0;
    fs.writeFileSync(part, '');
    save();
  }
  fs.truncateSync(part, bytes);

  const fd = fs.openSync(part, 'a');
  /** @type {number | null} */
  let oldFd = null;
  try {
    for (let i = opsDone; i < ops.length; i += 1) {
      const op = ops[i];
      const length = op.end - op.start;
      const already = bytes - opStart; // כמה מהפעולה הזאת כבר בדיסק (המשך באמצע)
      if (op.kind === OperationKind.COPY) {
        if (oldFd === null) oldFd = fs.openSync(/** @type {string} */ (oldFile), 'r');
        // העתקה מקומית מהירה — עושים אותה מההתחלה גם אם חלקה כבר נכתב
        if (already > 0) {
          fs.ftruncateSync(fd, opStart);
          bytes = opStart;
        }
        const buf = Buffer.alloc(Math.min(COPY_CHUNK, length));
        let pos = op.start;
        while (pos < op.end) {
          const n = fs.readSync(oldFd, buf, 0, Math.min(buf.length, op.end - pos), pos);
          if (n <= 0) throw new Error('המתקין הקודם קצר מהצפוי');
          fs.writeSync(fd, buf, 0, n);
          pos += n;
          bytes += n;
        }
      } else {
        let sinceCheckpoint = 0;
        const res = await fetchRange(newUrl, op.start + already, op.end, (chunk) => {
          fs.writeSync(fd, chunk);
          bytes += chunk.length;
          transferred += chunk.length;
          sinceCheckpoint += chunk.length;
          if (sinceCheckpoint >= CHECKPOINT_BYTES) {
            sinceCheckpoint = 0;
            save();
          }
          report();
        });
        if (!res.ok) {
          fs.fsyncSync(fd);
          save();
          return { ok: false, error: res.error, retryable: res.retryable };
        }
      }
      opsDone = i + 1;
      opStart += length;
      save();
      report();
    }
  } finally {
    fs.closeSync(fd);
    if (oldFd !== null) fs.closeSync(oldFd);
  }

  // אימות: גודל, ואז sha512 מול הפיד — כמו ש-electron-updater עושה לקובץ שהוריד.
  const finalSize = fs.statSync(part).size;
  const digest = await hashFile(part);
  if (finalSize !== size || digest !== sha512) {
    log(`[update] הקובץ שנבנה אינו תואם לפיד (גודל ${finalSize}/${size}, hash ${digest === sha512 ? 'תואם' : 'שונה'})`);
    fs.rmSync(part, { force: true });
    // הפרש שנכשל = המתקין הקודם אינו מה שחשבנו; הפעם הבאה מורידה את הכול.
    fs.writeFileSync(stateFile, JSON.stringify(differential ? { badDifferential: sha512 } : {}));
    return { ok: false, error: 'העדכון שהורד אינו תקין — ננסה שוב', retryable: true };
  }
  const file = path.join(pendingDir, fileName);
  fs.rmSync(file, { force: true });
  fs.renameSync(part, file);
  // מה ש-electron-updater מחפש כדי לדלג על ההורדה שלו (DownloadedUpdateHelper).
  fs.writeFileSync(path.join(pendingDir, 'update-info.json'), JSON.stringify({ fileName, sha512, isAdminRightsRequired: false }));
  // המפה של הגרסה החדשה — ה"ישנה" של העדכון הבא; electron-updater מעתיק אותה למטמון.
  if (args.newBlockMap !== null) {
    fs.writeFileSync(path.join(pendingDir, 'current.blockmap'), zlib.gzipSync(JSON.stringify(args.newBlockMap)));
  }
  fs.rmSync(stateFile, { force: true });
  log(`[update] ${fileName}: ${differential ? 'הפרשי' : 'מלא'}, ${(transferred / 1048576).toFixed(1)}MB ירדו מתוך ${(size / 1048576).toFixed(1)}MB`);
  return { ok: true, file, differential, transferred };
}

/** sha512 של קובץ, base64 — הפורמט של latest.yml. @param {string} file */
function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha512');
    fs.createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('base64')));
  });
}

/** מפת בלוקים דחוסה (gzip JSON) → אובייקט, או null. @param {Buffer | null | undefined} buf */
function parseBlockMap(buf) {
  if (!buf || buf.length === 0) return null;
  try {
    const parsed = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
    return Array.isArray(parsed?.files) && parsed.files.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * כתובת המפה של הגרסה המותקנת — כמו ב-electron-updater: שם המתקין החדש עם
 * מספר הגרסה הישן במקום החדש, ו-.blockmap בסוף.
 * @param {string} newUrl @param {string} newVersion @param {string} oldVersion
 */
function oldBlockMapUrl(newUrl, newVersion, oldVersion) {
  return `${newUrl.split(newVersion).join(oldVersion)}.blockmap`;
}

module.exports = { downloadUpdate, buildPlan, planHash, parseBlockMap, hashFile, oldBlockMapUrl, CHECKPOINT_BYTES };
