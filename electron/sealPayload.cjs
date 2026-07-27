// @ts-check
/**
 * "חותמת" משחק ל-EXE — אריזה/פריקה של משחק סגור בתוך קובץ ה-EXE הנייד.
 *
 * במקום לבנות Electron מחדש לכל משחק, מדביקים את המשחק (ZIP) + הגדרות לסוף
 * קובץ ה-EXE הגנרי (קבצי EXE מתעלמים מבתים נגררים אחרי מבנה ה-PE, כך שהם
 * עדיין רצים). בהפעלה, ה-EXE קורא את *הקובץ של עצמו*, מזהה את החותמת בסוף,
 * ומחלץ את המשחק + ההגדרות.
 *
 * מבנה הזנב (footer), בסוף הקובץ ממש:
 *   [ ...EXE גנרי... ][ ZIP המשחק ][ JSON הגדרות ][ gameZipLen(4 LE) ][ configLen(4 LE) ][ MAGIC(8) ]
 *
 * הלוגיקה טהורה (בלי Electron) — משותפת לכלי החותמת (Node) ולתהליך ה-main,
 * וניתנת לבדיקת יחידה.
 */

const fs = require('node:fs');
const path = require('node:path');
const { sealBox, openBox } = require('./contentCrypto.cjs');

const MAGIC = Buffer.from('TREGSEAL'); // 8 bytes — גרסה 1 (מטען גלוי, נתמך לקריאה)
const MAGIC_ENC = Buffer.from('TREGSEA2'); // 8 bytes — גרסה 2 (מטען מוצפן)
const FOOTER_LEN = 4 + 4 + MAGIC.length; // 16
/** מפרידי-תחום להצפנה — מפתח נגזר שונה למשחק ולהגדרות. */
const CTX_GAME = 'seal-game';
const CTX_CONFIG = 'seal-config';

/**
 * @typedef {Object} SealConfig
 * @property {string} [room]           קוד חדר לטלפונים ('' = בלי טלפונים)
 * @property {boolean} allowClickers   לאפשר שלטים (RF317)
 * @property {boolean} allowPhones     לאפשר טלפונים (סוקט)
 * @property {number|null} [limit]     מגבלת משתתפים (null = כמו ב-JSON)
 * @property {string} [name]           שם המשחק (לתצוגה/מטא)
 */

/**
 * אורז EXE גנרי + ZIP משחק + הגדרות לחותמת אחת (Buffer).
 * @param {Buffer|Uint8Array} exeBuf
 * @param {Buffer|Uint8Array} gameZipBuf
 * @param {SealConfig} config
 * @returns {Buffer}
 */
function sealPayload(exeBuf, gameZipBuf, config) {
  const exe = Buffer.from(exeBuf);
  // המטען מוצפן (AES-256-GCM): בלי זה אפשר היה לפתוח את ה-EXE ב-7-Zip או
  // בהקס-אדיטור ולשלוף את כל המשחק והמדיה. עכשיו אין שם ZIP גלוי כלל.
  const gameZip = sealBox(Buffer.from(gameZipBuf), CTX_GAME);
  const configBuf = sealBox(Buffer.from(JSON.stringify(config), 'utf8'), CTX_CONFIG);
  const footer = Buffer.alloc(FOOTER_LEN);
  footer.writeUInt32LE(gameZip.length, 0);
  footer.writeUInt32LE(configBuf.length, 4);
  MAGIC_ENC.copy(footer, 8);
  return Buffer.concat([exe, gameZip, configBuf, footer]);
}

/**
 * מפענח את שני חלקי המטען לפי גרסת החותמת. גרסה 1 (גלויה) עדיין נקראת, כדי
 * ש-EXE-ים שכבר הופצו ימשיכו לעבוד.
 * @param {Buffer} gamePart
 * @param {Buffer} configPart
 * @param {boolean} encrypted
 */
function decodeParts(gamePart, configPart, encrypted) {
  const gameZip = encrypted ? openBox(gamePart, CTX_GAME) : gamePart;
  const configJson = (encrypted ? openBox(configPart, CTX_CONFIG) : configPart).toString('utf8');
  return { gameZip: new Uint8Array(gameZip), config: JSON.parse(configJson) };
}

/**
 * מפרק חותמת מתוך Buffer מלא (EXE + חותמת). מחזיר null אם אין חותמת תקינה.
 * @param {Buffer|Uint8Array} input
 * @returns {{ gameZip: Uint8Array, config: SealConfig } | null}
 */
function readSealed(input) {
  const buf = Buffer.from(input);
  if (buf.length < FOOTER_LEN) return null;
  const footer = buf.subarray(buf.length - FOOTER_LEN);
  const tail = footer.subarray(8);
  const encrypted = tail.equals(MAGIC_ENC);
  if (!encrypted && !tail.equals(MAGIC)) return null;
  const gameZipLen = footer.readUInt32LE(0);
  const configLen = footer.readUInt32LE(4);
  const total = gameZipLen + configLen + FOOTER_LEN;
  if (buf.length < total) return null;
  const start = buf.length - total;
  const gameZip = buf.subarray(start, start + gameZipLen);
  const configBuf = buf.subarray(start + gameZipLen, start + gameZipLen + configLen);
  try {
    return decodeParts(gameZip, configBuf, encrypted);
  } catch {
    return null;
  }
}

/**
 * קורא חותמת ישירות מקובץ — קורא רק את הזנב והמטען (בלי לטעון EXE של 70MB
 * לזיכרון). מחזיר null אם אין חותמת/הקובץ לא קיים.
 * @param {string} filePath
 * @returns {{ gameZip: Uint8Array, config: SealConfig } | null}
 */
function readSealedFromFile(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    if (size < FOOTER_LEN) return null;
    const footer = Buffer.alloc(FOOTER_LEN);
    fs.readSync(fd, footer, 0, FOOTER_LEN, size - FOOTER_LEN);
    const tail = footer.subarray(8);
    const encrypted = tail.equals(MAGIC_ENC);
    if (!encrypted && !tail.equals(MAGIC)) return null;
    const gameZipLen = footer.readUInt32LE(0);
    const configLen = footer.readUInt32LE(4);
    const payloadLen = gameZipLen + configLen;
    const start = size - FOOTER_LEN - payloadLen;
    if (start < 0) return null;
    const payload = Buffer.alloc(payloadLen);
    fs.readSync(fd, payload, 0, payloadLen, start);
    return decodeParts(payload.subarray(0, gameZipLen), payload.subarray(gameZipLen), encrypted);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* כבר סגור */
      }
    }
  }
}

/**
 * אורך ה-EXE ה"נקי" בקובץ נתון — כלומר כמה בתים מתחילתו הם ה-EXE הגנרי, בלי
 * חותמת. קובץ בלי חותמת מחזיר את גודלו המלא; קובץ חתום מחזיר את האורך *לפני*
 * המטען. כך אפשר לחתום משחק מתוך EXE שכבר חתום, בלי לשרשר מטען על מטען
 * (מה שהיה מנפח את הקובץ ומשאיר בו את המשחק הקודם).
 * @param {string} filePath
 * @returns {number} אורך הבסיס בבתים, או -1 אם הקובץ לא נקרא
 */
function baseExeLength(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    if (size < FOOTER_LEN) return size;
    const footer = Buffer.alloc(FOOTER_LEN);
    fs.readSync(fd, footer, 0, FOOTER_LEN, size - FOOTER_LEN);
    const tail = footer.subarray(8);
    if (!tail.equals(MAGIC_ENC) && !tail.equals(MAGIC)) return size; // אין חותמת
    const payloadLen = footer.readUInt32LE(0) + footer.readUInt32LE(4);
    const base = size - FOOTER_LEN - payloadLen;
    return base > 0 ? base : size;
  } catch {
    return -1;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* כבר סגור */
      }
    }
  }
}

/** גודל מקטע ההעתקה של ה-EXE הבסיסי (‏8MB) — ראו sealToFile. */
const COPY_CHUNK = 8 * 1024 * 1024;

/**
 * חותם משחק לקובץ EXE חדש *בלי* להחזיק את ה-EXE הבסיסי בזיכרון: הבסיס מועתק
 * במקטעים מהקובץ המקורי אל קובץ היעד, ורק אז נכתב המטען המוצפן והזנב. חשוב
 * כאן במיוחד — ה-EXE הבסיסי שוקל ~90MB, ומשחק עם וידאו יכול לשקול מאות MB;
 * גרסת ה-Buffer (sealPayload) הייתה מחזיקה את שניהם, פעמיים, בזיכרון.
 *
 * הבסיס נקבע לפי baseExeLength, כך שחתימה מתוך EXE שכבר חתום מייצרת קובץ עם
 * מטען *אחד* (המשחק החדש), ולא שרשור מטענים.
 *
 * @param {string} basePath נתיב ה-EXE הגנרי (או חתום — המטען שלו יושמט)
 * @param {Buffer|Uint8Array} gameZipBuf
 * @param {SealConfig} config
 * @param {string} outPath נתיב היעד (חייב להיות שונה מ-basePath)
 * @returns {number} גודל הקובץ שנוצר בבתים
 */
function sealToFile(basePath, gameZipBuf, config, outPath) {
  if (path.resolve(basePath) === path.resolve(outPath)) {
    throw new Error('אי אפשר לחתום את התוכנה על עצמה — בחרו שם/מיקום אחר');
  }
  const baseLen = baseExeLength(basePath);
  if (baseLen <= 0) throw new Error('לא ניתן לקרוא את קובץ הבסיס');
  const gameZip = sealBox(Buffer.from(gameZipBuf), CTX_GAME);
  const configBuf = sealBox(Buffer.from(JSON.stringify(config), 'utf8'), CTX_CONFIG);
  const footer = Buffer.alloc(FOOTER_LEN);
  footer.writeUInt32LE(gameZip.length, 0);
  footer.writeUInt32LE(configBuf.length, 4);
  MAGIC_ENC.copy(footer, 8);

  const src = fs.openSync(basePath, 'r');
  let dst;
  try {
    dst = fs.openSync(outPath, 'w');
    const chunk = Buffer.alloc(Math.min(COPY_CHUNK, baseLen));
    let copied = 0;
    while (copied < baseLen) {
      const want = Math.min(chunk.length, baseLen - copied);
      const got = fs.readSync(src, chunk, 0, want, copied);
      if (got <= 0) throw new Error('קריאת קובץ הבסיס נקטעה');
      fs.writeSync(dst, chunk, 0, got);
      copied += got;
    }
    fs.writeSync(dst, gameZip);
    fs.writeSync(dst, configBuf);
    fs.writeSync(dst, footer);
  } finally {
    try {
      fs.closeSync(src);
    } catch {
      /* כבר סגור */
    }
    if (dst !== undefined) {
      try {
        fs.closeSync(dst);
      } catch {
        /* כבר סגור */
      }
    }
  }
  return baseLen + gameZip.length + configBuf.length + footer.length;
}

module.exports = {
  sealPayload,
  sealToFile,
  readSealed,
  readSealedFromFile,
  baseExeLength,
  MAGIC: MAGIC.toString(),
  FOOTER_LEN,
};
