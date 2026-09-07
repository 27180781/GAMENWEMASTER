/**
 * קוד גישה להחלפת המשחק ולעריכתו.
 *
 * הבעיה: התוכנה יושבת על מחשב באולם, ולעיתים קרובות לא המפעיל הוא היחיד שנוגע
 * בה. בלי שום מחסום, כל אחד יכול להחליף את קובץ המשחק או לערוך אותו באמצע
 * אירוע. הקוד הזה חוסם את שתי הפעולות האלה בלבד — *לשחק* אפשר תמיד בלי קוד,
 * כדי שמחסום שכחה לא ישבית אירוע.
 *
 * מה זה כן ומה זה לא: זה מחסום ממשק, לא הצפנה. חבילות המשחק יושבות על הדיסק
 * כקבצים רגילים, ומי שיודע איפה — יגיע אליהן. המטרה היא למנוע שינוי בהיסח
 * הדעת או מתוך סקרנות, לא לעמוד מול מי שמנסה לפרוץ.
 *
 * הקוד עצמו אינו נשמר — רק גיבוב scrypt עם מלח אקראי, כדי שמי שפותח את קובץ
 * ההגדרות לא יראה אותו. הקובץ יושב ב-userData, ולכן הוא **שורד עדכוני תוכנה**
 * ואין צורך להגדיר מחדש בכל גרסה.
 *
 * מקבל את תיקיית הנתונים כפרמטר ואינו נוגע ב-Electron — כדי שיהיה ניתן
 * לבדיקה מול תיקייה זמנית (ראו tests/gameGate.test.ts).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/** פרמטרי scrypt — מכוונים לאימות מיידי גם על מחשב אולם איטי. */
const KEY_LEN = 32;
const SALT_BYTES = 16;

const gateFile = (userData) => path.join(userData, 'game-gate.json');

function readRaw(userData) {
  try {
    return JSON.parse(fs.readFileSync(gateFile(userData), 'utf8'));
  } catch {
    return null;
  }
}

function hash(code, saltHex) {
  return crypto.scryptSync(String(code), Buffer.from(saltHex, 'hex'), KEY_LEN).toString('hex');
}

/**
 * מצב המחסום.
 *
 * `configured: false` פירושו שהמשתמש עוד לא נשאל — ואז מוצג לו חלון ההגדרה
 * בפתיחה. זה גם מה שקורה בהתקנות קיימות מהגרסה הזו והלאה: אין קובץ, ולכן
 * בפתיחה הבאה תוצג להם הבחירה פעם אחת.
 */
function gateStatus(userData) {
  const raw = readRaw(userData);
  if (raw === null || typeof raw !== 'object') return { configured: false, enabled: false };
  return { configured: true, enabled: raw.enabled === true };
}

/**
 * קביעת המחסום. `code` ריק/null = ויתור על קוד (אפשר להחליף משחק בחופשיות).
 * מחזיר false רק אם הכתיבה לדיסק נכשלה.
 */
function setGate(userData, code) {
  const clean = String(code ?? '').trim();
  const data =
    clean === ''
      ? { enabled: false, updatedAt: Date.now() }
      : (() => {
          const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
          return { enabled: true, salt, hash: hash(clean, salt), updatedAt: Date.now() };
        })();
  try {
    fs.writeFileSync(gateFile(userData), JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/**
 * בדיקת קוד. כשהמחסום כבוי (או שטרם הוגדר) הכול פתוח, ולכן מוחזר true — הקורא
 * אינו צריך לבדוק את המצב בעצמו לפני כל פעולה.
 */
function verifyGate(userData, code) {
  const raw = readRaw(userData);
  if (raw === null || raw.enabled !== true) return true;
  const clean = String(code ?? '').trim();
  if (clean === '' || typeof raw.salt !== 'string' || typeof raw.hash !== 'string') return false;
  const want = Buffer.from(raw.hash, 'hex');
  const got = Buffer.from(hash(clean, raw.salt), 'hex');
  // אורך זהה תמיד (KEY_LEN), אבל timingSafeEqual זורק על אורכים שונים —
  // ולכן שומרים על הבדיקה גם כאן, למקרה של קובץ הגדרות פגום.
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

/**
 * החלפת הקוד — דורשת את הקוד הנוכחי. בלי זה מי שניגש למחשב היה יכול פשוט
 * לקבוע קוד חדש, והמחסום היה חסר משמעות.
 */
function changeGate(userData, currentCode, nextCode) {
  if (!verifyGate(userData, currentCode)) return false;
  return setGate(userData, nextCode);
}

module.exports = { gateFile, gateStatus, setGate, verifyGate, changeGate };
