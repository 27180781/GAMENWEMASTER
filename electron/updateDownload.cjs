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
 * למה העדכון יורד במלואו ולא רק השינויים. הקוד עובר לשורת העדכון (App.tsx מתרגם
 * אותו לנוסח) ולקובץ היומן, כדי שהורדה מלאה לא תהיה עוד תעלומה: עד 7.10.2026
 * היא קרתה בשקט, וכל מה שהלקוח ראה היה "110MB".
 */
const FULL_REASON = Object.freeze({
  /** אין במחשב אף מתקין שאפשר להשוות אליו (installer.exe חסר, ואין עותק אחר). */
  NO_INSTALLER: 'no-installer',
  /** יש מתקין, אבל אין לנו מפת בלוקים שמתארת אותו — הוא של גרסה אחרת. */
  INSTALLER_MISMATCH: 'installer-mismatch',
  /** אין מפה לגרסה המותקנת: ישנה מ-12 בניות, או שהשרת לא ענה. */
  NO_OLD_MAP: 'no-old-map',
  /** אין מפה לגרסה החדשה. */
  NO_NEW_MAP: 'no-new-map',
  /** חישוב ההפרש נכשל או יצא לא עקבי. */
  PLAN_INVALID: 'plan-invalid',
  /** הפרש קודם לאותה גרסה נבנה ונפסל באימות. */
  BAD_DIFFERENTIAL: 'bad-differential',
  /** השרת או הרשת עונים על בקשת טווח בקובץ כולו. */
  RANGE_BLOCKED: 'range-blocked',
});

/**
 * @typedef {{ kind: number, start: number, end: number }} Op
 * @typedef {{ version?: string, files: { name: string, offset: number, checksums: string[], sizes: number[] }[] }} BlockMap
 * @typedef {{ ok: true, bytes: number } | { ok: false, error: string, retryable: boolean, status?: number }} RangeResult
 * @typedef {(url: string, start: number, end: number, sink: (chunk: Buffer) => void) => Promise<RangeResult>} FetchRange
 * @typedef {{ transferred: number, total: number, percent: number, differential: boolean, reason: string | null }} UpdateProgress
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
 * `reason` — למה אין מפה/מתקין, כשהקורא כבר יודע (pickOldInstaller).
 * @param {{ oldBlockMap: BlockMap | null, newBlockMap: BlockMap | null, oldFile: string | null, size: number, log: (m: string) => void, reason?: string | null }} args
 * @returns {{ ops: Op[], differential: boolean, reason: string | null }}
 */
function buildPlan({ oldBlockMap, newBlockMap, oldFile, size, log, reason = null }) {
  /** @param {string} why */
  const full = (why) => ({ ops: [{ kind: OperationKind.DOWNLOAD, start: 0, end: size }], differential: false, reason: why });
  if (newBlockMap === null) return full(FULL_REASON.NO_NEW_MAP);
  if (oldBlockMap === null || oldFile === null) return full(reason ?? FULL_REASON.NO_OLD_MAP);
  let oldSize = -1;
  try {
    oldSize = fs.statSync(oldFile).size;
  } catch {
    log('[update] אין מתקין קודם במטמון — הורדה מלאה');
    return full(FULL_REASON.NO_INSTALLER);
  }
  try {
    const ops = /** @type {Op[]} */ (computeOperations(oldBlockMap, newBlockMap, silentLogger));
    const assembled = ops.reduce((sum, op) => sum + (op.end - op.start), 0);
    const copyEnd = ops.reduce((max, op) => (op.kind === OperationKind.COPY ? Math.max(max, op.end) : max), 0);
    if (ops.length === 0 || assembled !== size || copyEnd > oldSize) {
      log(`[update] תוכנית הפרשית לא עקבית (${assembled} מול ${size}, העתקה עד ${copyEnd} מתוך ${oldSize}) — הורדה מלאה`);
      return full(FULL_REASON.PLAN_INVALID);
    }
    return { ops, differential: true, reason: null };
  } catch (err) {
    log(`[update] חישוב ההפרש נכשל (${/** @type {Error} */ (err).message}) — הורדה מלאה`);
    return full(FULL_REASON.PLAN_INVALID);
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
 *   reason?: string | null,
 *   onProgress?: (p: UpdateProgress) => void,
 *   log?: (m: string) => void,
 * }} args
 *   reason — למה אין מתקין/מפה ישנים, כשהקורא כבר יודע (pickOldInstaller).
 * @returns {Promise<{ ok: true, file: string, differential: boolean, transferred: number, reason: string | null } | { ok: false, error: string, retryable: boolean, reason: string | null }>}
 */
async function downloadUpdate(args) {
  const { pendingDir, fileName, sha512, size, newUrl, oldFile, fetchRange, onProgress = () => {}, log = () => {} } = args;
  if (!(size > 0)) return { ok: false, error: 'הפיד אינו מציין את גודל המתקין', retryable: false, reason: null };
  fs.mkdirSync(pendingDir, { recursive: true });
  const part = path.join(pendingDir, `${fileName}.part`);
  const stateFile = path.join(pendingDir, `${fileName}.resume.json`);
  const file = path.join(pendingDir, fileName);

  // כבר הורד (בפתיחה קודמת, והתוכנה לא נסגרה מאז כדי להתקין) — אין מה להוריד שוב.
  if (sizeOf(file) === size && (await hashFile(file)) === sha512) {
    writeReady(pendingDir, fileName, sha512);
    log(`[update] ${fileName} כבר הורד ואומת — בלי הורדה`);
    return { ok: true, file, differential: true, transferred: 0, reason: null };
  }

  // מה שכבר למדנו על הקובץ הזה נשאר בכל שמירה, כדי שהמשך אחרי ניתוק יתכנן
  // את אותה תוכנית ולא ינסה שוב (וימחק את מה שירד):
  //   badDifferential — הפרש שנבנה ונפסל באימות (מתקין קודם פגום);
  //   rangeBlocked — בקשת טווח קיבלה את הקובץ כולו (השרת או הרשת אינם תומכים).
  const previous = readJson(stateFile);
  /** @type {{ badDifferential?: string, rangeBlocked?: string }} */
  const sticky = {};
  if (previous?.badDifferential === sha512) sticky.badDifferential = sha512;
  if (previous?.rangeBlocked === sha512) sticky.rangeBlocked = sha512;
  const banned = sticky.badDifferential !== undefined ? FULL_REASON.BAD_DIFFERENTIAL : sticky.rangeBlocked !== undefined ? FULL_REASON.RANGE_BLOCKED : null;
  const plan = buildPlan({
    oldBlockMap: banned !== null ? null : args.oldBlockMap,
    newBlockMap: args.newBlockMap,
    oldFile: banned !== null ? null : oldFile,
    size,
    log,
    reason: banned ?? args.reason ?? null,
  });
  const { ops, differential, reason } = plan;
  if (!differential) log(`[update] ${fileName}: הורדה מלאה (${reason})`);
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
  const save = () => {
    fs.writeFileSync(stateFile, JSON.stringify({ hash, sha512, opsDone, bytes, transferred, differential, ...sticky }));
  };
  const report = () =>
    onProgress({ transferred, total, percent: total > 0 ? Math.min(100, Math.round((transferred / total) * 100)) : 0, differential, reason });
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

  let fd = fs.openSync(part, 'a');
  /**
   * מקצר את הקובץ החדש ל-n בתים. ב-Windows אי אפשר לקצר דרך ידית שנפתחה להוספה
   * (ftruncate על 'a' נותן EPERM), ולכן סוגרים, מקצרים לפי הנתיב ופותחים מחדש.
   * @param {number} n
   */
  const truncatePart = (n) => {
    fs.closeSync(fd);
    fd = -1;
    fs.truncateSync(part, n);
    fd = fs.openSync(part, 'a');
  };
  /** @type {number | null} */
  let oldFd = null;
  let restartFull = false;
  try {
    for (let i = opsDone; i < ops.length; i += 1) {
      const op = ops[i];
      const length = op.end - op.start;
      const already = bytes - opStart; // כמה מהפעולה הזאת כבר בדיסק (המשך באמצע)
      if (op.kind === OperationKind.COPY) {
        if (oldFd === null) oldFd = fs.openSync(/** @type {string} */ (oldFile), 'r');
        // העתקה מקומית מהירה — עושים אותה מההתחלה גם אם חלקה כבר נכתב
        if (already > 0) {
          truncatePart(opStart);
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
        /** @param {Buffer} chunk */
        const sink = (chunk) => {
          fs.writeSync(fd, chunk);
          bytes += chunk.length;
          transferred += chunk.length;
          sinceCheckpoint += chunk.length;
          if (sinceCheckpoint >= CHECKPOINT_BYTES) {
            sinceCheckpoint = 0;
            save();
          }
          report();
        };
        let res = await fetchRange(newUrl, op.start + already, op.end, sink);
        // 200 על טווח שאינו מתחילת הקובץ: השרת או משהו בדרך (אנטי-וירוס שבודק
        // הורדות, פרוקסי) מתעלם מ-Range ושולח את הקובץ כולו. הפרש אינו אפשרי כאן.
        if (!res.ok && res.status === 200) {
          log(`[update] בקשת טווח (מבית ${op.start + already}) קיבלה את הקובץ כולו — אין הורדה חלקית ברשת הזאת`);
          sticky.rangeBlocked = sha512;
          if (differential) {
            restartFull = true;
            break;
          }
          // הורדה מלאה שהתחילה לפני ניתוק: מתחילים אותה מבית 0, שם הקובץ כולו הוא מה שביקשנו.
          truncatePart(0);
          bytes = 0;
          transferred = 0;
          save();
          report();
          res = await fetchRange(newUrl, 0, op.end, sink);
        }
        if (!res.ok) {
          fs.fsyncSync(fd);
          save();
          return { ok: false, error: res.error, retryable: res.retryable, reason };
        }
      }
      opsDone = i + 1;
      opStart += length;
      save();
      report();
    }
  } finally {
    if (fd !== -1) fs.closeSync(fd);
    if (oldFd !== null) fs.closeSync(oldFd);
  }
  if (restartFull) {
    // ההפרש לא יעבוד ברשת הזאת — מתכננים מחדש הורדה מלאה, באותה קריאה (ולא בעוד
    // כמה דקות) ובלי לחזור להורדה של electron-updater, שהייתה נכשלת באותה נקודה.
    fs.rmSync(part, { force: true });
    fs.writeFileSync(stateFile, JSON.stringify({ ...sticky }));
    return downloadUpdate(args);
  }

  // אימות: גודל, ואז sha512 מול הפיד — כמו ש-electron-updater עושה לקובץ שהוריד.
  const finalSize = fs.statSync(part).size;
  const digest = await hashFile(part);
  if (finalSize !== size || digest !== sha512) {
    log(`[update] הקובץ שנבנה אינו תואם לפיד (גודל ${finalSize}/${size}, hash ${digest === sha512 ? 'תואם' : 'שונה'})`);
    fs.rmSync(part, { force: true });
    // הפרש שנכשל = המתקין הקודם אינו מה שחשבנו; הפעם הבאה מורידה את הכול.
    fs.writeFileSync(stateFile, JSON.stringify(differential ? { ...sticky, badDifferential: sha512 } : { ...sticky }));
    return { ok: false, error: 'העדכון שהורד אינו תקין — ננסה שוב', retryable: true, reason };
  }
  fs.rmSync(file, { force: true });
  fs.renameSync(part, file);
  writeReady(pendingDir, fileName, sha512);
  // המפה של הגרסה החדשה — ה"ישנה" של העדכון הבא; electron-updater מעתיק אותה למטמון.
  if (args.newBlockMap !== null) {
    fs.writeFileSync(path.join(pendingDir, 'current.blockmap'), zlib.gzipSync(JSON.stringify(args.newBlockMap)));
  }
  fs.rmSync(stateFile, { force: true });
  // מתקינים ישנים שנשארו ב-pending (electron-updater אינו מנקה אותו כשהקובץ המוכן
  // תואם), כדי שלא יצטברו 110MB לכל עדכון. נשאר המתקין שממנו נבנה ההפרש, אם הוא
  // כאן: אם העדכון הזה לא יותקן, גם העדכון הבא יצטרך אותו.
  const keep = new Set([fileName, 'update-info.json', 'current.blockmap']);
  if (oldFile !== null && path.resolve(path.dirname(oldFile)) === path.resolve(pendingDir)) keep.add(path.basename(oldFile));
  cleanPending(pendingDir, keep, log);
  log(`[update] ${fileName}: ${differential ? 'הפרשי' : `מלא (${reason})`}, ${(transferred / 1048576).toFixed(1)}MB ירדו מתוך ${(size / 1048576).toFixed(1)}MB`);
  return { ok: true, file, differential, transferred, reason };
}

/**
 * מה ש-electron-updater מחפש כדי לדלג על ההורדה שלו (DownloadedUpdateHelper).
 * @param {string} pendingDir @param {string} fileName @param {string} sha512
 */
function writeReady(pendingDir, fileName, sha512) {
  fs.writeFileSync(path.join(pendingDir, 'update-info.json'), JSON.stringify({ fileName, sha512, isAdminRightsRequired: false }));
}

/** @param {string} file */
function sizeOf(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return -1;
  }
}

/**
 * מוחק מ-pending מתקינים והורדות חלקיות שאינם ב-keep.
 * @param {string} pendingDir @param {Set<string>} keep @param {(m: string) => void} log
 */
function cleanPending(pendingDir, keep, log) {
  for (const name of listDir(pendingDir)) {
    if (keep.has(name) || !/(\.exe|\.part|\.resume\.json)$/i.test(name)) continue;
    try {
      fs.rmSync(path.join(pendingDir, name), { force: true });
      log(`[update] נמחק מ-pending: ${name}`);
    } catch {
      /* נעול — בפעם הבאה */
    }
  }
}

/** @param {string} dir @returns {string[]} */
function listDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
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
 * כמה בתים המפה מתארת — בדיוק גודל המתקין שממנו נבנתה. מפה פגומה (בלי sizes /
 * offset מספריים) נותנת NaN, שאינו שווה לאף גודל — ולכן נפסלת ולא מפילה את העדכון.
 * @param {BlockMap} map
 */
function blockMapSize(map) {
  return map.files.reduce((max, f) => {
    const sizes = Array.isArray(f?.sizes) ? f.sizes.reduce((s, n) => s + Number(n), 0) : NaN;
    return Math.max(max, Number(f?.offset) + sizes);
  }, 0);
}

/**
 * המפה ה"ישנה" להפרש: הראשונה מהמועמדות שמתארת קובץ בגודל המתקין שבמטמון.
 * מפה של קובץ אחר מייצרת תוכנית שמעתיקה בלוקים לא נכונים — הקובץ שנבנה נפסל
 * ב-sha512, והעדכון כולו יורד מחדש (110MB במקום 1.5MB). עדיף לגלות את זה לפני
 * שמורידים משהו: בלי מפה תואמת — הורדה מלאה מיד.
 * @param {(BlockMap | null)[]} candidates לפי סדר עדיפות
 * @param {number} oldSize גודל המתקין שבמטמון (0 = אין)
 * @returns {BlockMap | null}
 */
function pickOldBlockMap(candidates, oldSize) {
  if (!(oldSize > 0)) return null;
  return candidates.find((m) => m !== null && blockMapSize(m) === oldSize) ?? null;
}

/**
 * איפה עשוי להימצא מתקין להשוואה, לפי סדר עדיפות:
 *   1. installer.exe במטמון של electron-updater — NSIS מעתיק את עצמו לשם בכל התקנה.
 *      ההעתקה שקטה ואינה נבדקת (CopyFiles /SILENT): אם היא נכשלת, הקובץ חסר או
 *      נשאר מגרסה קודמת, וזה כל מה שנדרש כדי שכל עדכון יירד במלואו.
 *   2. מתקינים ב-pending: העדכון שהתקין את הגרסה הנוכחית נשאר שם (קודם כאלה בשם
 *      של הגרסה המותקנת), והעדכון האחרון שהורד ותואם ל-current.blockmap.
 *   3. המתקין שהמשתמש הוריד — בתיקיות שמועברות (תיקיית ההורדות): בשם עם הגרסה,
 *      כולל "(1)" של הורדה חוזרת, או בשם הקבוע TriviaEngine-Setup.exe.
 * כל זוג קובץ+מפה תואמים מתאים להפרש, גם של גרסה אחרת מהמותקנת — pickOldInstaller
 * בוחר רק קובץ שגודלו שווה בדיוק לאחת המפות, ובסוף sha512 מכריע.
 * @param {{ cacheDir: string, pendingDir: string, installerName: string, targetName?: string, folders?: string[], list?: (dir: string) => string[] }} args
 *   installerName — שם המתקין של הגרסה המותקנת (HavayaBeClick-Setup-0.1.N.exe).
 *   targetName — שם המתקין שמורידים עכשיו: עותק שלו ב-pending שלא עבר את האימות
 *   (downloadUpdate בודק קודם) פגום, ואינו בסיס להפרש.
 * @returns {string[]}
 */
function installerCandidates({ cacheDir, pendingDir, installerName, targetName = '', folders = [], list = listDir }) {
  const out = [path.join(cacheDir, 'installer.exe')];
  const lower = installerName.toLowerCase();
  const base = lower.replace(/\.exe$/, '');
  const escape = (/** @type {string} */ t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // ב-pending: כל מתקין שלם (לא temp- של electron-updater, לא .part, לא היעד), של הגרסה המותקנת קודם.
  const pendingExes = list(pendingDir)
    .filter((n) => /\.exe$/i.test(n) && !/^temp-/i.test(n) && n.toLowerCase() !== targetName.toLowerCase())
    .sort((a, b) => Number(b.toLowerCase() === lower) - Number(a.toLowerCase() === lower));
  out.push(...pendingExes.map((n) => path.join(pendingDir, n)));
  const named = new RegExp(`^${escape(base)}( ?\\(\\d+\\))?\\.exe$`, 'i');
  const stable = /^TriviaEngine-Setup( ?\(\d+\))?\.exe$/i;
  /** @param {string} n */
  const rank = (n) => (n.toLowerCase() === lower ? 0 : named.test(n) ? 1 : stable.test(n) ? 2 : -1);
  for (const dir of folders) {
    const found = list(dir)
      .map((n) => ({ n, r: rank(n) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r || a.n.localeCompare(b.n))
      .slice(0, 10);
    out.push(...found.map((x) => path.join(dir, x.n)));
  }
  return [...new Set(out)];
}

/**
 * המתקין והמפה להפרש: הקובץ הראשון (לפי סדר העדיפות) שגודלו שווה לאחת המפות.
 * בלי זוג כזה — הורדה מלאה, עם הסיבה.
 * @param {{ installers: string[], maps: (BlockMap | null)[], sizeOf: (file: string) => number }} args
 *   maps — לפי סדר עדיפות: של הגרסה המותקנת מהשרת, ואחר כך current.blockmap שבמטמון.
 * @returns {{ oldFile: string | null, oldBlockMap: BlockMap | null, reason: string | null, sizes: { file: string, size: number }[] }}
 */
function pickOldInstaller({ installers, maps, sizeOf }) {
  /** @type {{ file: string, size: number }[]} */
  const sizes = [];
  for (const file of installers) {
    const size = sizeOf(file);
    sizes.push({ file, size });
    if (!(size > 0)) continue;
    const map = pickOldBlockMap(maps, size);
    if (map !== null) return { oldFile: file, oldBlockMap: map, reason: null, sizes };
  }
  const anyInstaller = sizes.some((x) => x.size > 0);
  const reason = !anyInstaller ? FULL_REASON.NO_INSTALLER : maps[0] === null ? FULL_REASON.NO_OLD_MAP : FULL_REASON.INSTALLER_MISMATCH;
  return { oldFile: null, oldBlockMap: null, reason, sizes };
}

/**
 * כתובת המפה של הגרסה המותקנת — כמו ב-electron-updater: שם המתקין החדש עם
 * מספר הגרסה הישן במקום החדש, ו-.blockmap בסוף.
 * @param {string} newUrl @param {string} newVersion @param {string} oldVersion
 */
function oldBlockMapUrl(newUrl, newVersion, oldVersion) {
  return `${newUrl.split(newVersion).join(oldVersion)}.blockmap`;
}

module.exports = {
  downloadUpdate,
  buildPlan,
  planHash,
  parseBlockMap,
  hashFile,
  oldBlockMapUrl,
  blockMapSize,
  pickOldBlockMap,
  installerCandidates,
  pickOldInstaller,
  FULL_REASON,
  CHECKPOINT_BYTES,
};
