// @ts-check
/**
 * הצפנת תוכן המשחק (מטען ה-EXE הסגור + קובצי המדיה בדיסק).
 *
 * מטרה: שאי אפשר יהיה לגשת לקוד/למדיה בקלות — לא ב-7-Zip, לא בהקס-אדיטור,
 * ולא בסייר הקבצים. חשוב לומר בכנות: תוכן שהמכשיר מנגן ניתן תמיד ללכידה
 * (הקלטת מסך/דיבאגר). ההצפנה מעלה את הרף מ"כל אחד" ל"מהנדס עם כלים" — וזה
 * ההבדל המעשי שמשנה.
 *
 * שתי סכימות, לשני שימושים שונים:
 *
 * 1) `sealBox` — AES-256-GCM לקובץ שלם (מטען ה-EXE, data.json). קורא הכל
 *    לזיכרון ומאמת שלמות (tag). מתאים לנתונים קטנים/בינוניים.
 *
 * 2) `mediaFile` — AES-256-CTR בבלוקים של 1MB לקובצי מדיה. CTR נבחר במכוון:
 *    הוא מאפשר **גישה אקראית** — לפענח מהאמצע בלי לקרוא את כל הקובץ — ולכן
 *    דילוג/חיפוש בווידאו (בקשות Range) ממשיך לעבוד, והזיכרון נשאר נמוך.
 *    ה-nonce לכל קובץ + מונה הבלוק מרכיבים את ה-IV, כך שאותו זרם מפתח לעולם
 *    לא חוזר על עצמו.
 *
 * המפתח נגזר (scrypt) ממפתח-בסיס מוטבע בבינארי יחד עם מלח לכל משחק, כך
 * שחשיפת קובץ מדיה אחד לא חושפת את השאר, ושהעתקת תיקיית המטמון בלבד חסרת ערך.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');

/** גודל בלוק לפענוח מדיה — פשרה בין תקורה לגרעיניות דילוג. */
const MEDIA_BLOCK = 1 << 20; // 1MB
const KEY_LEN = 32; // AES-256
const GCM_IV = 12;
const GCM_TAG = 16;
const CTR_NONCE = 8; // 8 בתים nonce + 8 בתים מונה בלוק = IV של 16
const MAGIC_MEDIA = Buffer.from('TREGMED1'); // כותרת קובץ מדיה מוצפן
const MEDIA_HEADER = MAGIC_MEDIA.length + CTR_NONCE; // 16

/**
 * מפתח-הבסיס המוטבע. אינו סוד קריפטוגרפי אמיתי (הוא בתוך הבינארי) — תפקידו
 * למנוע גישה טריוויאלית. אפשר לדרוס אותו בזמן בנייה דרך משתנה סביבה, כדי
 * שלכל לקוח/מהדורה יהיה מפתח משלו.
 */
const BASE_SECRET =
  process.env.TRIVIA_CONTENT_KEY || 'trivia-engine/content-v1/8f3c1d94a7e6b205';

/**
 * מטמון מפתחות נגזרים. scrypt יקר בכוונה (~50ms), וזה בדיוק מה שרצוי מול
 * ניחוש — אבל הגשת מדיה מייצרת עשרות בקשות Range (דילוג בווידאו), ולכן גזירה
 * בכל בקשה הייתה מוסיפה השהיה מורגשת. המפתח נגזר פעם אחת לכל מלח ונשמר
 * בזיכרון התהליך בלבד (לעולם לא לדיסק).
 */
const keyCache = new Map();

/** גזירת מפתח 32-בתים ממלח (scrypt — יקר בכוונה מול ניחוש), עם מטמון. */
function deriveKey(salt) {
  const id = Buffer.from(salt).toString('base64');
  const hit = keyCache.get(id);
  if (hit !== undefined) return hit;
  const key = crypto.scryptSync(BASE_SECRET, salt, KEY_LEN, { N: 16384, r: 8, p: 1 });
  // תקרה זהירה — בפועל יש מלח אחד או שניים בו-זמנית.
  if (keyCache.size > 32) keyCache.clear();
  keyCache.set(id, key);
  return key;
}

// ---------------------------------------------------------------------------
// 1) קופסה שלמה (AES-256-GCM) — מטען ה-EXE וקבצים קטנים
// ---------------------------------------------------------------------------

/**
 * מצפין buffer לקופסה עצמאית: [salt(16)][iv(12)][tag(16)][ciphertext].
 * @param {Buffer|Uint8Array} plain
 * @param {string} context מפריד-תחום (למשל 'seal') — מפתח שונה לכל שימוש
 * @returns {Buffer}
 */
function sealBox(plain, context = 'seal') {
  const salt = crypto.randomBytes(16);
  const key = deriveKey(Buffer.concat([salt, Buffer.from(context, 'utf8')]));
  const iv = crypto.randomBytes(GCM_IV);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()]);
  return Buffer.concat([salt, iv, cipher.getAuthTag(), body]);
}

/**
 * פורק קופסה שנוצרה ב-sealBox. זורק אם התוכן שונה/פגום (אימות GCM).
 * @param {Buffer|Uint8Array} boxed
 * @param {string} context
 * @returns {Buffer}
 */
function openBox(boxed, context = 'seal') {
  const buf = Buffer.from(boxed);
  if (buf.length < 16 + GCM_IV + GCM_TAG) throw new Error('קופסה מוצפנת קצרה מדי');
  const salt = buf.subarray(0, 16);
  const iv = buf.subarray(16, 16 + GCM_IV);
  const tag = buf.subarray(16 + GCM_IV, 16 + GCM_IV + GCM_TAG);
  const body = buf.subarray(16 + GCM_IV + GCM_TAG);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(Buffer.concat([salt, Buffer.from(context, 'utf8')])), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

// ---------------------------------------------------------------------------
// 2) קובץ מדיה (AES-256-CTR בבלוקים) — פענוח לפי דרישה, תומך דילוג
// ---------------------------------------------------------------------------

/** IV לבלוק מסוים: nonce(8) + מספר בלוק (8, big-endian). */
function blockIv(nonce, blockIndex) {
  const iv = Buffer.alloc(16);
  nonce.copy(iv, 0, 0, CTR_NONCE);
  iv.writeBigUInt64BE(BigInt(blockIndex), CTR_NONCE);
  return iv;
}

/**
 * כותב קובץ מדיה מוצפן: [MAGIC(8)][nonce(8)][בלוקים מוצפנים...].
 * כל בלוק מוצפן עצמאית ב-CTR, ולכן ניתן לפענח כל בלוק בנפרד.
 * @param {string} destPath
 * @param {Buffer} plain
 * @param {string} salt מלח לכל משחק (מזהה המטמון)
 */
function writeEncryptedMedia(destPath, plain, salt) {
  const key = deriveKey(Buffer.concat([Buffer.from(salt, 'utf8'), Buffer.from('media')]));
  const nonce = crypto.randomBytes(CTR_NONCE);
  const parts = [MAGIC_MEDIA, nonce];
  for (let i = 0, block = 0; i < plain.length; i += MEDIA_BLOCK, block++) {
    const chunk = plain.subarray(i, Math.min(i + MEDIA_BLOCK, plain.length));
    const c = crypto.createCipheriv('aes-256-ctr', key, blockIv(nonce, block));
    parts.push(c.update(chunk), c.final());
  }
  fs.writeFileSync(destPath, Buffer.concat(parts));
}

/** גודל התוכן המקורי (בלי הכותרת) של קובץ מדיה מוצפן. */
function encryptedMediaSize(filePath) {
  return Math.max(0, fs.statSync(filePath).size - MEDIA_HEADER);
}

/** האם הקובץ הוא מדיה מוצפנת שלנו (בדיקת כותרת). */
function isEncryptedMedia(filePath) {
  let fd = -1;
  try {
    fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(MAGIC_MEDIA.length);
    fs.readSync(fd, head, 0, head.length, 0);
    return head.equals(MAGIC_MEDIA);
  } catch {
    return false;
  } finally {
    if (fd !== -1) {
      try {
        fs.closeSync(fd);
      } catch {
        /* התעלמות */
      }
    }
  }
}

/**
 * קורא ומפענח טווח בתים מקובץ מדיה מוצפן — בלי לקרוא את כל הקובץ. זה מה
 * שמאפשר דילוג/חיפוש בווידאו (Range) בלי לפגוע בזיכרון.
 * @param {string} filePath
 * @param {string} salt
 * @param {number} start בית התחלה בתוכן המקורי (כולל)
 * @param {number} end בית סיום בתוכן המקורי (כולל)
 * @returns {Buffer}
 */
function readEncryptedMediaRange(filePath, salt, start, end) {
  const total = encryptedMediaSize(filePath);
  const from = Math.max(0, start);
  const to = Math.min(end, total - 1);
  if (total === 0 || from > to) return Buffer.alloc(0);

  const key = deriveKey(Buffer.concat([Buffer.from(salt, 'utf8'), Buffer.from('media')]));
  const fd = fs.openSync(filePath, 'r');
  try {
    const nonce = Buffer.alloc(CTR_NONCE);
    fs.readSync(fd, nonce, 0, CTR_NONCE, MAGIC_MEDIA.length);

    const firstBlock = Math.floor(from / MEDIA_BLOCK);
    const lastBlock = Math.floor(to / MEDIA_BLOCK);
    const out = [];
    for (let block = firstBlock; block <= lastBlock; block++) {
      const blockStart = block * MEDIA_BLOCK;
      const size = Math.min(MEDIA_BLOCK, total - blockStart);
      const enc = Buffer.alloc(size);
      fs.readSync(fd, enc, 0, size, MEDIA_HEADER + blockStart);
      const d = crypto.createDecipheriv('aes-256-ctr', key, blockIv(nonce, block));
      const plain = Buffer.concat([d.update(enc), d.final()]);
      // חיתוך לקצוות המבוקשים (רק בבלוק הראשון/אחרון)
      const sliceFrom = block === firstBlock ? from - blockStart : 0;
      const sliceTo = block === lastBlock ? to - blockStart + 1 : plain.length;
      out.push(plain.subarray(sliceFrom, sliceTo));
    }
    return Buffer.concat(out);
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = {
  sealBox,
  openBox,
  writeEncryptedMedia,
  readEncryptedMediaRange,
  encryptedMediaSize,
  isEncryptedMedia,
  MEDIA_BLOCK,
};
