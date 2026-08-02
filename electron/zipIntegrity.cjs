// @ts-check
/**
 * בדיקת שלמות של קובץ ZIP שהתקבל מהרשת.
 *
 * למה זה נחוץ דווקא עכשיו: השרת אורז את החבילה **בסטרימינג**, ולכן התשובה
 * מגיעה בלי Content-Length — אין לנו גודל צפוי להשוות אליו. אם החיבור נופל
 * ב-90% מתוך 356MB, הזרם פשוט נגמר, וקובץ חתוך היה נכתב במקום המשחק הקודם
 * שעבד. התקלה הייתה מתגלה רק בפתיחה — כלומר באירוע.
 *
 * מה כן אפשר לבדוק בזול: כל ZIP תקין מסתיים ברשומת End Of Central Directory.
 * היא בת 22 בתים לפחות ויכולה להיגרר עוד עד 64KB של הערה, ולכן מספיק לקרוא
 * את הזנב. חסר EOCD = הקובץ נקטע.
 *
 * טהור (בלי fs/Electron) כדי שיהיה ניתן לבדיקת יחידה.
 */

/** חתימת End Of Central Directory. */
const EOCD_SIGNATURE = 0x06054b50;
/** 22 בתים מינימום + עד 64KB הערה. */
const MAX_EOCD_SCAN = 22 + 0xffff;

/**
 * האם בזנב הנתונים יש רשומת EOCD תקינה — כלומר הקובץ הגיע במלואו.
 * @param {Buffer} tail סוף הקובץ (לפחות 22 בתים; מומלץ MAX_EOCD_SCAN)
 * @param {number} totalSize גודל הקובץ כולו, לאימות ההיסטים ברשומה
 * @returns {boolean}
 */
function hasZipEndRecord(tail, totalSize) {
  if (tail.length < 22) return false;
  // סורקים מהסוף אחורה: ההערה יכולה להכיל בייטים שנראים כמו החתימה.
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tail.readUInt32LE(i) !== EOCD_SIGNATURE) continue;
    const commentLength = tail.readUInt16LE(i + 20);
    // הרשומה חייבת להסתיים בדיוק בסוף הקובץ — אחרת זו חתימה מקרית בתוך נתונים.
    if (i + 22 + commentLength !== tail.length) continue;
    const cdSize = tail.readUInt32LE(i + 12);
    const cdOffset = tail.readUInt32LE(i + 16);
    // ZIP64 מסמן 0xffffffff; שם לא בודקים היסטים כאן — עצם קיום הרשומה מספיק.
    if (cdSize === 0xffffffff || cdOffset === 0xffffffff) return true;
    // הספרייה המרכזית חייבת להיכנס בתוך הקובץ בפועל.
    return cdOffset + cdSize <= totalSize;
  }
  return false;
}

/** כמה בתים לקרוא מסוף הקובץ כדי לבדוק. */
function tailLength(totalSize) {
  return Math.min(totalSize, MAX_EOCD_SCAN);
}

module.exports = { hasZipEndRecord, tailLength, MAX_EOCD_SCAN };
