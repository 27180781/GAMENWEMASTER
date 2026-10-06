/**
 * ספריית המשחקים שהורדו.
 *
 * הבאג שזה פותר: היה *מקום אחד* למשחק. הורדה לפי קוד דרסה את הקודם, ו"טען
 * משחק אחר" מחקה אותו — ולכן אחרי שיצאת לבחור משחק אחר, הדרך היחידה לחזור
 * למשחק שכבר הורדת הייתה להקליד שוב את הקוד ולהוריד מאות מגה-בייט מחדש. גם
 * באולם בלי רשת טובה, וגם דקה לפני אירוע.
 *
 * עכשיו כל משחק שמורד נשמר תחת games/<קוד>.zip ונשאר שם. "המשחק הנוכחי" הוא
 * רק **הצבעה** על אחד מהם (last-game.json עם code), ולכן בחירה מחדש היא כתיבת
 * קובץ מטא זעיר — בלי העתקת החבילה ובלי הורדה.
 *
 * הקובץ מקבל את תיקיית הנתונים כפרמטר ואינו נוגע ב-Electron, כדי שיהיה ניתן
 * לבדיקה מול תיקייה זמנית (ראו tests/gameLibrary.test.ts).
 */

const fs = require('node:fs');
const path = require('node:path');
const { readZipDirectory, readZipEntry } = require('./zipRead.cjs');
const { findGameEntryName } = require('./gameZip.cjs');

/**
 * קוד תקין לשם קובץ. זו בדיוק התבנית שהורדה לפי קוד מקבלת, ולכן קוד שעבר
 * אותה בטוח כשם קובץ — אין צורך בשם ממופה שעלול להתנגש.
 */
function isSafeCode(code) {
  return /^[A-Za-z0-9_-]{1,32}$/.test(String(code ?? ''));
}

function gamesDir(userData) {
  const dir = path.join(userData, 'games');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* קיימת כבר */
  }
  return dir;
}

const libraryZipPath = (userData, code) => path.join(gamesDir(userData), `${code}.zip`);
const libraryMetaPath = (userData, code) => path.join(gamesDir(userData), `${code}.json`);
const lastGameZipPath = (userData) => path.join(userData, 'last-game.zip');
const lastGameMetaPath = (userData) => path.join(userData, 'last-game.json');

/** קריאת מטא JSON, או null. */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * קובץ ה-ZIP של המשחק ה**נוכחי**.
 *
 * כשהמטא מצביע על קוד בספרייה — הקובץ שם, ואין עותק שני. אחרת (משחק שנטען
 * מקובץ ZIP בדיסק) — הקובץ הישן, בדיוק כמו קודם. כך כל הקוד שקורא את "המשחק
 * האחרון" ממשיך לעבוד בלי לדעת על הספרייה.
 */
function currentGameZipPath(userData) {
  const code = readJson(lastGameMetaPath(userData))?.code;
  if (isSafeCode(code)) {
    const p = libraryZipPath(userData, code);
    if (fs.existsSync(p)) return p;
  }
  return lastGameZipPath(userData);
}

/** המשחקים שהורדו, החדש קודם. */
function libraryList(userData) {
  try {
    const out = [];
    for (const file of fs.readdirSync(gamesDir(userData))) {
      if (!file.endsWith('.zip')) continue;
      const code = file.slice(0, -4);
      if (!isSafeCode(code)) continue;
      const meta = readJson(libraryMetaPath(userData, code));
      let size = 0;
      try {
        size = fs.statSync(libraryZipPath(userData, code)).size;
      } catch {
        /* התעלמות */
      }
      out.push({
        code,
        name: String(meta?.name ?? ''),
        savedAt: Number(meta?.savedAt) || 0,
        size,
        // משחק שנבנה במחשב (localGame.cjs) — אין לו עותק בשרת.
        local: meta?.local === true,
        // המשחק במערכת יצירת המשחקים והגרסה של החבילה (ראו libraryBackfill) —
        // כך התוכנה יודעת מה כבר אצלה כשהמערכת שולחת לה משחק או עדכון.
        gameId: typeof meta?.gameId === 'string' ? meta.gameId : null,
        version: typeof meta?.version === 'string' ? meta.version : null,
        // נערך בעורך שבמחשב אחרי ההורדה — עדכון מהמערכת היה מוחק את השינויים.
        editedAt: Number(meta?.editedAt) || 0,
        // נשלח למחשב והורד ברקע, ועוד לא נפתח.
        pendingOpen: meta?.pendingOpen === true,
      });
    }
    out.sort((a, b) => b.savedAt - a.savedAt || a.code.localeCompare(b.code));
    return out;
  } catch {
    return [];
  }
}

/**
 * בחירת משחק מהספרייה כמשחק הנוכחי — כתיבת מטא בלבד, ולכן מיידית גם למשחק
 * של מאות מגה-בייט.
 */
function librarySelect(userData, code) {
  if (!isSafeCode(code) || !fs.existsSync(libraryZipPath(userData, code))) return false;
  const meta = readJson(libraryMetaPath(userData, code));
  const name = String(meta?.name ?? `משחק ${code}`);
  try {
    fs.writeFileSync(
      lastGameMetaPath(userData),
      JSON.stringify({ name, code, savedAt: Date.now() }),
    );
  } catch {
    return false;
  }
  // משחק שנשלח למחשב ונפתח עכשיו — כבר לא "ממתין לפתיחה".
  if (meta?.pendingOpen === true) {
    const { pendingOpen: _done, ...rest } = meta;
    writeMeta(userData, code, rest);
  }
  return true;
}

/** כתיבת המטא של משחק בספרייה. @returns {boolean} */
function writeMeta(userData, code, meta) {
  try {
    fs.writeFileSync(libraryMetaPath(userData, code), JSON.stringify(meta));
    return true;
  } catch {
    return false;
  }
}

/**
 * רישום חבילה שהורדה (הקובץ כבר במקומו) וסימונה כנוכחית.
 * `extra.local` — משחק שנבנה במחשב ולא הורד (ראו localGame.cjs).
 * `extra.gameId` / `extra.version` — המשחק במערכת והגרסה של החבילה.
 * `extra.source` — 'device' כשהמערכת שלחה את המשחק למחשב (ראו deviceSync.cjs).
 * `extra.pendingOpen` — הורד ברקע ועוד לא נפתח.
 * `extra.select: false` — רישום בלבד, בלי להחליף את המשחק הנוכחי: הורדה ברקע
 * לעולם אינה מחליפה את המשחק שהמפעיל בחר.
 */
function libraryStore(userData, code, name, extra = {}) {
  if (!isSafeCode(code)) return false;
  const ok = writeMeta(userData, code, {
    code,
    name: String(name ?? ''),
    savedAt: Date.now(),
    ...(extra.local === true ? { local: true } : {}),
    // gameId נרשם תמיד במשחק שהורד (גם null), כדי ש-libraryBackfill לא יחפש שוב.
    ...(extra.local === true ? {} : { gameId: typeof extra.gameId === 'string' ? extra.gameId.toLowerCase() : null }),
    ...(typeof extra.version === 'string' ? { version: extra.version } : {}),
    ...(typeof extra.source === 'string' ? { source: extra.source } : {}),
    ...(extra.pendingOpen === true ? { pendingOpen: true } : {}),
  });
  if (!ok) return false;
  if (extra.select === false) return true;
  return librarySelect(userData, code);
}

/** קוד המשחק הנוכחי בספרייה, או null (משחק מקובץ ZIP / אין משחק). */
function currentCode(userData) {
  const code = readJson(lastGameMetaPath(userData))?.code;
  return isSafeCode(code) && fs.existsSync(libraryZipPath(userData, code)) ? code : null;
}

/** האם המשחק הנוכחי נבנה במחשב (ולא הורד מהשרת). */
function currentIsLocal(userData) {
  const code = currentCode(userData);
  return code !== null && readJson(libraryMetaPath(userData, code))?.local === true;
}

/**
 * עדכון השם של המשחק הנוכחי ברשימה אחרי שמירה בעורך, כדי שהרשימה תציג את
 * השם ששמור בקובץ. רק למשחק שנבנה במחשב: למשחק שהורד השם ברשימה הוא השם
 * מהשרת, והוא מתעדכן בהורדה מחדש.
 */
function renameCurrentLocal(userData, name) {
  const clean = String(name ?? '').trim();
  const code = currentCode(userData);
  if (clean === '' || code === null) return false;
  const meta = readJson(libraryMetaPath(userData, code));
  if (meta?.local !== true || meta.name === clean) return false;
  try {
    fs.writeFileSync(libraryMetaPath(userData, code), JSON.stringify({ ...meta, name: clean }));
    const last = readJson(lastGameMetaPath(userData));
    if (last !== null) fs.writeFileSync(lastGameMetaPath(userData), JSON.stringify({ ...last, name: clean }));
    return true;
  } catch {
    return false;
  }
}

/** ביטול בחירת המשחק הנוכחי ("טען משחק אחר"). הספרייה **אינה** נמחקת. */
function forgetCurrent(userData) {
  for (const p of [lastGameZipPath(userData), lastGameMetaPath(userData)]) {
    try {
      fs.rmSync(p, { force: true });
    } catch {
      /* התעלמות */
    }
  }
}

/**
 * סימון המשחק הנוכחי כ"נערך במחשב" אחרי שמירה בעורך. עדכון שהמערכת שולחת
 * למחשב לא יחליף אותו בלי לשאול — אחרת השינויים שנעשו כאן היו נמחקים בשקט.
 */
function libraryMarkEdited(userData) {
  const code = currentCode(userData);
  if (code === null) return false;
  const meta = readJson(libraryMetaPath(userData, code));
  if (meta === null) return false;
  return writeMeta(userData, code, { ...meta, editedAt: Date.now() });
}

/**
 * קריאת המשחק שבחבילה (id והגרסה מ-data.json) בלי לטעון אותה לזיכרון. null
 * כשאין data.json קריא.
 * @returns {{ gameId: string | null, version: string | null } | null}
 */
function readPackageInfo(zipPath) {
  const entries = readZipDirectory(zipPath);
  if (entries === null) return null;
  const name = findGameEntryName(entries.map((e) => e.name));
  const entry = name === null ? undefined : entries.find((e) => e.name === name);
  if (entry === undefined) return null;
  const buf = readZipEntry(zipPath, entry);
  if (buf === null) return null;
  try {
    const data = JSON.parse(buf.toString('utf8'));
    const id = typeof data?.id === 'string' ? data.id.toLowerCase() : null;
    const version = typeof data?.metadata?.version === 'string' ? data.metadata.version : null;
    return { gameId: id, version };
  } catch {
    return null;
  }
}

/**
 * משחקים שהורדו לפני שהתוכנה התחילה לרשום איזה משחק בכל חבילה (או בחבילת
 * הגיבוי של השרת): קוראים את data.json פעם אחת ורושמים. בלי זה, משחק שכבר
 * במחשב היה נראה "חסר" כשהמערכת שולחת אותו, ועותק שני שלו היה נוסף.
 */
function libraryBackfill(userData) {
  let changed = 0;
  for (const g of libraryList(userData)) {
    if (g.local) continue;
    const metaPath = libraryMetaPath(userData, g.code);
    const meta = readJson(metaPath);
    if (meta !== null && Object.prototype.hasOwnProperty.call(meta, 'gameId')) continue;
    const info = readPackageInfo(libraryZipPath(userData, g.code));
    const next = {
      ...(meta ?? { code: g.code, name: '', savedAt: 0 }),
      gameId: info?.gameId ?? null,
      ...(info?.version ? { version: info.version } : {}),
    };
    if (writeMeta(userData, g.code, next)) changed += 1;
  }
  return changed;
}

/**
 * עותקים ישנים של אותו משחק (קוד אחר — למשל אחרי חידוש רישיון) נמחקים כשהגיע
 * עותק חדש. לא נוגעים במשחק הנוכחי, בעותק שנערך במחשב או במשחק מקומי.
 * @returns {string[]} הקודים שנמחקו
 */
function libraryDedupe(userData, gameId, keepCode) {
  if (typeof gameId !== 'string' || gameId === '') return [];
  const current = readJson(lastGameMetaPath(userData))?.code;
  const removed = [];
  for (const g of libraryList(userData)) {
    if (g.code === keepCode || g.gameId !== gameId.toLowerCase()) continue;
    if (g.local || g.editedAt > 0 || g.code === current) continue;
    libraryDelete(userData, g.code);
    removed.push(g.code);
  }
  return removed;
}

/** מחיקת משחק מהספרייה. אם הוא הנוכחי — הבחירה מתבטלת גם היא. */
function libraryDelete(userData, code) {
  if (!isSafeCode(code)) return false;
  const wasCurrent = readJson(lastGameMetaPath(userData))?.code === code;
  // גם הורדה ישירה שנקטעה באמצע (<קוד>.download, ראו remoteGame.cjs) — "מחיקה" צריכה לנקות הכול.
  for (const p of [libraryZipPath(userData, code), libraryMetaPath(userData, code), path.join(gamesDir(userData), `${code}.download`)]) {
    try {
      fs.rmSync(p, { force: true, recursive: true });
    } catch {
      /* התעלמות */
    }
  }
  if (wasCurrent) forgetCurrent(userData);
  return true;
}

module.exports = {
  isSafeCode,
  gamesDir,
  libraryZipPath,
  libraryMetaPath,
  lastGameZipPath,
  lastGameMetaPath,
  currentGameZipPath,
  libraryList,
  librarySelect,
  libraryStore,
  libraryDelete,
  forgetCurrent,
  currentCode,
  currentIsLocal,
  renameCurrentLocal,
  libraryMarkEdited,
  libraryBackfill,
  libraryDedupe,
  readPackageInfo,
};
