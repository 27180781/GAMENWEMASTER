// @ts-check
/**
 * הרצת פיתוח (`electron .` מתיקיית הקוד) מול התוכנה הארוזה.
 *
 * לוגיקה טהורה, בנפרד מ-main.cjs, כדי שתהיה ניתנת לבדיקת יחידה
 * (tests/runMode.test.ts).
 *
 * לא app.isPackaged לבדו: Electron קובע אותו לפי שם הקובץ שרץ, ו-electron.exe
 * הוא "לא ארוז". עד אוקטובר 2026 עותק של התוכנה המותקנת בשם electron.exe נחשב
 * הרצת פיתוח: בלי בדיקה מול המערכת (ולכן בלי השבתה ובלי המתג של החתימה), עם
 * כל האישורים פתוחים (וקובץ משחק ששונה נפתח כרגיל, כי מחשב שאושר פטור
 * מהנעילה, ראו gameSignature.cjs), ועם כלי הפיתוח במקש. process.defaultApp
 * דולק רק כש-Electron עצמו טוען תיקיית קוד; בתוכנה ארוזה הוא לעולם לא דולק,
 * בשום שם של קובץ.
 */

/**
 * @param {{ isPackaged: boolean, defaultApp: unknown }} ctx
 * @returns {boolean}
 */
function isDevRun(ctx) {
  return ctx.isPackaged !== true && ctx.defaultApp === true;
}

/**
 * משתני הסביבה שמפנים את התוכנה לשרת אחר (TRIVIA_REMOTE_URL / TRIVIA_REMOTE_KEY,
 * למשל השרת המדומה של tools/device-e2e.mjs). רק בהרצת פיתוח: בתוכנה הארוזה
 * משתנה סביבה היה מפנה אותה לשרת שעונה "המחשב אושר לעריכה" או "המתג כבוי".
 * @param {boolean} dev
 * @param {Record<string, string | undefined>} env
 * @returns {{ url: string | null, key: string | null }}
 */
function remoteOverride(dev, env) {
  if (!dev) return { url: null, key: null };
  return { url: env.TRIVIA_REMOTE_URL || null, key: env.TRIVIA_REMOTE_KEY || null };
}

/**
 * מפתחות בדיקה לחתימת קובצי המשחק (TRIVIA_TEST_SIGNING_KEYS: JSON של kid → המפתח
 * הציבורי הגולמי, base64url), נוסף על המפתחות המוטבעים. רק בהרצת פיתוח, בשביל
 * tools/signature-e2e.mjs: בתוכנה הארוזה מפתח שמגיע ממשתנה סביבה היה מאפשר לכל
 * אחד לחתום על כל קובץ. כל מה שאינו אובייקט של מחרוזות — כלום.
 * @param {boolean} dev
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, string>}
 */
function testSigningKeys(dev, env) {
  if (!dev || !env.TRIVIA_TEST_SIGNING_KEYS) return {};
  try {
    const parsed = JSON.parse(env.TRIVIA_TEST_SIGNING_KEYS);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, x]) => typeof x === 'string' && x !== ''));
  } catch {
    return {};
  }
}

module.exports = { isDevRun, remoteOverride, testSigningKeys };
