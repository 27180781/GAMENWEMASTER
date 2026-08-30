/**
 * מאיפה תוכנת האופליין מורידה עדכונים ואת ה-EXE הבסיסי.
 *
 * הכתובת מצביעה על **שרת המשחק** ולא על GitHub, כדי שכל התעבורה אצל הלקוח —
 * גם ההורדה הראשונה וגם כל עדכון — תגיע מהשרת שלנו בלבד. הקבצים עצמם נמשכים
 * מהמהדורה ב-GitHub בזמן בניית תמונת ה-Docker של האתר (ראו Dockerfile
 * ו-tools/fetch-desktop-assets.mjs), כלומר שרת-לשרת ומחוץ לעין הלקוח.
 *
 * חייב להיות זהה ל-‎publish.url‎ שב-electron-builder.yml — יש בדיקה שמוודאת
 * את זה (tests/desktopHost.test.ts), כי חוסר התאמה שקט פירושו שהתוכנה
 * המותקנת מחפשת עדכונים במקום שאיש לא מפרסם אליו.
 */

const DESKTOP_BASE_URL = 'https://gamemwemaster.caprover.clicker.co.il/desktop';

module.exports = { DESKTOP_BASE_URL };
