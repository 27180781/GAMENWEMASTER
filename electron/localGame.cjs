/**
 * משחק שנבנה מאפס בתוכנה עצמה (בלי מערכת יצירת המשחקים).
 *
 * המשחק נשמר בספרייה בדיוק כמו משחק שהורד — games/<קוד>.zip עם data.json
 * בשורש — ולכן כל המסלולים הקיימים (טעינה, עריכה ושמירה, מדיה שנוספת בעורך,
 * בחירה מהרשימה ומחיקה) עובדים עליו בלי שינוי. מה שמבדיל אותו:
 *   - הקוד מתחיל ב-local-, כך שהוא לעולם לא יתנגש בקוד של משחק מהשרת;
 *   - במטא יש local: true — אין לו עותק בשרת, ולכן אין "הורדה מחדש", והמחיקה
 *     שלו סופית.
 *
 * הקובץ מקבל את תיקיית הנתונים כפרמטר ואינו נוגע ב-Electron, כדי שיהיה ניתן
 * לבדיקה מול תיקייה זמנית (ראו tests/localGame.test.ts).
 */

const fs = require('node:fs');
const crypto = require('node:crypto');
const JSZip = require('jszip');
const lib = require('./gameLibrary.cjs');

/** קוד חדש למשחק מקומי: local-<זמן>-<אקראי>, תקין כשם קובץ (isSafeCode). */
function newLocalCode(now = Date.now()) {
  return `local-${now.toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

const isLocalCode = (code) => typeof code === 'string' && code.startsWith('local-');

/**
 * יצירת המשחק: data.json לתוך ZIP חדש בספרייה, רישום, וסימון כמשחק הנוכחי.
 * @param {string} userData
 * @param {string} name
 * @param {string} dataJson
 * @returns {Promise<{ ok: boolean, code?: string, error?: string }>}
 */
async function createLocalGame(userData, name, dataJson) {
  let parsed;
  try {
    parsed = JSON.parse(String(dataJson));
  } catch {
    return { ok: false, error: 'קובץ המשחק אינו JSON תקין' };
  }
  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.questions)) {
    return { ok: false, error: 'קובץ המשחק אינו תקין' };
  }
  const cleanName = String(name ?? '').trim() || String(parsed.name ?? '').trim() || 'משחק חדש';

  let code = newLocalCode();
  while (fs.existsSync(lib.libraryZipPath(userData, code))) code = newLocalCode();

  const zip = new JSZip();
  zip.file('data.json', JSON.stringify(parsed));
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const target = lib.libraryZipPath(userData, code);
  // כתיבה זמנית ואז החלפה — קריסה באמצע לא משאירה ברשימה חבילה חתוכה.
  const tmp = `${target}.saving`;
  try {
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, target);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    return { ok: false, error: `שמירת המשחק נכשלה: ${/** @type {Error} */ (err).message}` };
  }
  if (!lib.libraryStore(userData, code, cleanName, { local: true })) {
    fs.rmSync(target, { force: true });
    return { ok: false, error: 'רישום המשחק בספרייה נכשל' };
  }
  return { ok: true, code };
}

module.exports = { createLocalGame, newLocalCode, isLocalCode };
