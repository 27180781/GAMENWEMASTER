// @ts-check
/**
 * מי מותר לו להתעדכן אוטומטית.
 *
 * לוגיקה טהורה, בנפרד מ-main.cjs, כדי שתהיה ניתנת לבדיקת יחידה — זו הגנה
 * שכשל בה הוא הרסני ולא מורגש עד שמאוחר מדי.
 */

/**
 * @param {{ packaged: boolean, sealed: boolean, portable: boolean }} ctx
 *   packaged — הרצה מהאריזה (ולא מסביבת פיתוח).
 *   sealed   — ה-EXE מכיל משחק מוטבע ("משחק סגור").
 *   portable — הרצה מהקובץ הנייד (‏PORTABLE_EXECUTABLE_FILE מוגדר).
 * @returns {boolean}
 */
function canAutoUpdate(ctx) {
  // פיתוח — אין מה לעדכן, ואין מתקין.
  if (ctx.packaged !== true) return false;
  // EXE של משחק סגור: העדכון כותב קובץ חדש במקום הישן — וזה *מוחק את המשחק*
  // המוטבע בסופו. משחק סגור לעולם לא מתעדכן בעצמו, בשום תנאי.
  if (ctx.sealed === true) return false;
  // גרסה ניידת: electron-updater אינו תומך ביעד portable (היא רצה מתיקייה
  // זמנית ואין לאן להתקין). מורידים אותה מחדש במקום.
  if (ctx.portable === true) return false;
  return true;
}

module.exports = { canAutoUpdate };
