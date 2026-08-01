// @ts-check
/**
 * בחירת קובץ המשחק מתוך רשימת הערכים בארכיון — לוגיקה טהורה, משותפת לשמירת
 * העריכה (main) ולבדיקות.
 *
 * חייבת להתאים לכלל שבצד ה-renderer (‏zipLoader.ts): חבילה מהשרת מכילה
 * `game.json` *וגם* `manifest.json`, וחבילה מהעורך מכילה `data.json`. בחירה
 * בקובץ הלא-נכון בשמירה הייתה דורסת את המניפסט במקום את המשחק.
 */

/** קובצי JSON שהם עזר ולעולם אינם קובץ המשחק. */
const NON_GAME_JSON = new Set(['manifest.json', 'package.json', 'meta.json']);

/** שם הקובץ בלבד, באותיות קטנות. */
function baseName(name) {
  return (String(name).split('/').pop() ?? '').toLowerCase();
}

/**
 * מחזיר את שם הערך שהוא קובץ המשחק, או null אם אין.
 * סדר: data.json → game.json → כל JSON אחר שאינו קובץ עזר.
 * @param {string[]} names שמות הערכים בארכיון (בלי תיקיות)
 * @returns {string | null}
 */
function findGameEntryName(names) {
  const list = names.filter((n) => !n.endsWith('/'));
  return (
    list.find((n) => baseName(n) === 'data.json') ??
    list.find((n) => baseName(n) === 'game.json') ??
    list.find((n) => baseName(n).endsWith('.json') && !NON_GAME_JSON.has(baseName(n))) ??
    null
  );
}

/**
 * עובר על ערכי JSON ומחליף כל *מחרוזת* לפי הפונקציה הנתונה. משמש להמרת
 * כתובות מדיה זמניות (‏trivia-media://) לנתיבים יחסיים בתוך הארכיון — ועובד
 * על כל שדה, גם כאלה שיתווספו לסכימה בעתיד.
 * @param {unknown} value
 * @param {(s: string) => string} mapString
 * @returns {unknown}
 */
function mapStrings(value, mapString) {
  if (typeof value === 'string') return mapString(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, mapString));
  if (value !== null && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = mapStrings(v, mapString);
    return out;
  }
  return value;
}

module.exports = { findGameEntryName, mapStrings, NON_GAME_JSON };
