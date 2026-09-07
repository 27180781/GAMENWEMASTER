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
  const name = String(readJson(libraryMetaPath(userData, code))?.name ?? `משחק ${code}`);
  try {
    fs.writeFileSync(
      lastGameMetaPath(userData),
      JSON.stringify({ name, code, savedAt: Date.now() }),
    );
    return true;
  } catch {
    return false;
  }
}

/** רישום חבילה שהורדה (הקובץ כבר במקומו) וסימונה כנוכחית. */
function libraryStore(userData, code, name) {
  if (!isSafeCode(code)) return false;
  try {
    fs.writeFileSync(
      libraryMetaPath(userData, code),
      JSON.stringify({ code, name: String(name ?? ''), savedAt: Date.now() }),
    );
  } catch {
    return false;
  }
  return librarySelect(userData, code);
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

/** מחיקת משחק מהספרייה. אם הוא הנוכחי — הבחירה מתבטלת גם היא. */
function libraryDelete(userData, code) {
  if (!isSafeCode(code)) return false;
  const wasCurrent = readJson(lastGameMetaPath(userData))?.code === code;
  for (const p of [libraryZipPath(userData, code), libraryMetaPath(userData, code)]) {
    try {
      fs.rmSync(p, { force: true });
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
};
