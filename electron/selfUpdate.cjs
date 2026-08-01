// @ts-check
/**
 * החלפה עצמית של קובץ EXE נייד (כלי "חתום EXE").
 *
 * ‏electron-updater אינו תומך ביעד portable, אבל לקובץ נייד יש דרך פשוטה משלו:
 * Windows *אוסר* למחוק או לדרוס קובץ הרצה שרץ כרגע — אך **מתיר לשנות את שמו**.
 * לכן: מסמנים את החדש לצד הישן, משנים את שם הרץ ל-`.old`, ומעבירים את החדש
 * למקומו. השאריות נמחקות בהפעלה הבאה, כשהקובץ הישן כבר לא נעול.
 *
 * הסדר נבחר כך ש**בשום שלב לא נשארים בלי כלי**: אם ההעברה האחרונה נכשלת,
 * מחזירים את הישן למקומו. לכן הלוגיקה יושבת כאן, בנפרד מ-main, וניתנת לבדיקה.
 */

const fs = require('node:fs');
const crypto = require('node:crypto');

/** גודל מקטע לקריאת hash — מספיק גדול כדי לא להתיש את הדיסק. */
const HASH_CHUNK = 8 * 1024 * 1024;

/** SHA-256 של קובץ, בקריאה במקטעים (הקבצים כאן שוקלים ~90MB). */
function hashFile(filePath) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(HASH_CHUNK);
    let pos = 0;
    for (;;) {
      const got = fs.readSync(fd, buf, 0, HASH_CHUNK, pos);
      if (got <= 0) break;
      h.update(buf.subarray(0, got));
      pos += got;
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

/**
 * האם שני הקבצים זהים. משווים קודם גודל (זול, ופוסל את רוב המקרים) ורק אז
 * hash — כדי לא לחשב 90MB בכל הפעלה כשברור שאין שינוי.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function sameFile(a, b) {
  try {
    const sa = fs.statSync(a);
    const sb = fs.statSync(b);
    if (sa.size !== sb.size) return false;
    return hashFile(a) === hashFile(b);
  } catch {
    return false; // קובץ חסר/לא קריא — מתייחסים כ"שונה" ולא מעדכנים בעיוורון
  }
}

/** שם הקובץ שאליו מוסט העותק הישן עד שאפשר יהיה למחוק אותו. */
function oldPathOf(selfPath) {
  return `${selfPath}.old`;
}

/**
 * מוחק שארית מעדכון קודם. נקרא בהפעלה — אז הקובץ הישן כבר לא רץ ולא נעול.
 * @param {string} selfPath
 * @returns {boolean} האם נמחקה שארית
 */
function cleanupOldSelf(selfPath) {
  const old = oldPathOf(selfPath);
  try {
    if (!fs.existsSync(old)) return false;
    fs.rmSync(old, { force: true });
    return true;
  } catch {
    return false; // עדיין נעול (מופע נוסף רץ) — ננסה בהפעלה הבאה
  }
}

/**
 * מחליף את קובץ ההרצה שרץ כרגע בקובץ חדש. מחזיר true אם ההחלפה הצליחה.
 * הגרסה החדשה תיכנס לתוקף בהפעלה הבאה — התהליך הרץ ממשיך עם התמונה הישנה.
 *
 * @param {string} selfPath נתיב הקובץ הרץ
 * @param {string} newPath הקובץ החדש (יועתק, לא יוזז)
 * @returns {boolean}
 */
function replaceSelf(selfPath, newPath) {
  const staged = `${selfPath}.new`;
  const old = oldPathOf(selfPath);
  try {
    // שארית מניסיון קודם שנקטע — מנקים כדי שההעתקה תתחיל מדף חלק.
    fs.rmSync(staged, { force: true });
    // מעתיקים *לאותה תיקייה*, כדי שההעברה שאחריה תהיה באותו כונן (ולכן מיידית).
    fs.copyFileSync(newPath, staged);
    fs.renameSync(selfPath, old); // מותר גם על קובץ שרץ
    try {
      fs.renameSync(staged, selfPath);
    } catch (err) {
      // ההעברה נכשלה — מחזירים את הישן למקומו. עדיף כלי ישן מכלי חסר.
      fs.renameSync(old, selfPath);
      throw err;
    }
    return true;
  } catch {
    try {
      fs.rmSync(staged, { force: true });
    } catch {
      /* אין מה לנקות */
    }
    return false;
  }
}

module.exports = { sameFile, replaceSelf, cleanupOldSelf, oldPathOf };
