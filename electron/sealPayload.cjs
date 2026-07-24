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

const MAGIC = Buffer.from('TREGSEAL'); // 8 bytes
const FOOTER_LEN = 4 + 4 + MAGIC.length; // 16

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
  const gameZip = Buffer.from(gameZipBuf);
  const configBuf = Buffer.from(JSON.stringify(config), 'utf8');
  const footer = Buffer.alloc(FOOTER_LEN);
  footer.writeUInt32LE(gameZip.length, 0);
  footer.writeUInt32LE(configBuf.length, 4);
  MAGIC.copy(footer, 8);
  return Buffer.concat([exe, gameZip, configBuf, footer]);
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
  if (!footer.subarray(8).equals(MAGIC)) return null;
  const gameZipLen = footer.readUInt32LE(0);
  const configLen = footer.readUInt32LE(4);
  const total = gameZipLen + configLen + FOOTER_LEN;
  if (buf.length < total) return null;
  const start = buf.length - total;
  const gameZip = buf.subarray(start, start + gameZipLen);
  const configBuf = buf.subarray(start + gameZipLen, start + gameZipLen + configLen);
  try {
    const config = /** @type {SealConfig} */ (JSON.parse(configBuf.toString('utf8')));
    return { gameZip: new Uint8Array(gameZip), config };
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
    if (!footer.subarray(8).equals(MAGIC)) return null;
    const gameZipLen = footer.readUInt32LE(0);
    const configLen = footer.readUInt32LE(4);
    const payloadLen = gameZipLen + configLen;
    const start = size - FOOTER_LEN - payloadLen;
    if (start < 0) return null;
    const payload = Buffer.alloc(payloadLen);
    fs.readSync(fd, payload, 0, payloadLen, start);
    const gameZip = payload.subarray(0, gameZipLen);
    const config = /** @type {SealConfig} */ (
      JSON.parse(payload.subarray(gameZipLen).toString('utf8'))
    );
    return { gameZip: new Uint8Array(gameZip), config };
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

module.exports = { sealPayload, readSealed, readSealedFromFile, MAGIC: MAGIC.toString(), FOOTER_LEN };
