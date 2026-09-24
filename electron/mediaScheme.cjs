/**
 * סכימת המדיה מהדיסק (‏trivia-media://) — ההרשאות שלה והכותרות שכל תשובה שלה
 * נושאת. נפרד מ-main.cjs כדי שאפשר יהיה לבדוק אותו בלי Electron.
 *
 * הדף נטען מ-‎file://‎ והמדיה מוגשת מ-‎trivia-media://‎ — origin אחר. ‏<video>,
 * ‏<img> ו-<audio> טוענים בלי CORS, ולכן עבדו תמיד. נגן הקריינות, לעומתם, מושך
 * כל קטע ב-fetch() ומפענח אותו ל-Web Audio, ו-fetch חוצה-origin כפוף ל-CORS:
 * הסכימה צריכה להיות corsEnabled, וכל תשובה צריכה לאשר את ה-origin המבקש.
 * ב-Electron 33 זה עובד גם בלי שניהם (נבדק: תשובה של protocol.handle אינה
 * עוברת בדיקת CORS) — אבל זו התנהגות של Electron ולא חוזה, ואם תשתנה בשדרוג
 * הקריינות האופליינית ב-EXE תשתוק כולה בלי שום שגיאה נראית.
 */

/** ההרשאות של הסכימה — חייבות להירשם לפני app.ready. */
const MEDIA_SCHEME_PRIVILEGES = Object.freeze({
  standard: true,
  secure: true,
  supportFetchAPI: true,
  stream: true,
  // fetch() חוצה-origin (קטעי הקריינות) — ראו למעלה.
  corsEnabled: true,
});

/**
 * התשובה עם Access-Control-Allow-Origin: *. נבנית מחדש ולא נערכת במקום:
 * לתשובה של net.fetch יש כותרות נעולות. הגוף עובר כמו שהוא (זרם), כך שהזרמה
 * ו-Range נשמרים. המדיה מקומית ואין בה נתוני משתמש, ולכן '*' בטוח.
 */
function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

module.exports = { MEDIA_SCHEME_PRIVILEGES, withCors };
