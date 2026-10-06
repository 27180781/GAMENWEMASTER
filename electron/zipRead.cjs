// @ts-check
/**
 * קריאה מתוך חבילת ZIP שבדיסק בלי לטעון אותה לזיכרון: רשימת הקבצים מהספרייה
 * המרכזית, קריאת קובץ קטן (data.json, manifest.json), וחילוץ קובץ בודד בזרימה
 * עם בדיקת CRC.
 *
 * למה: עדכון של משחק שכבר במחשב מוריד רק את מה שהשתנה. קובץ מדיה שכתובתו לא
 * השתנתה מועתק מהחבילה הקודמת במקום לרדת שוב (ראו remoteGame.cjs) — וזה
 * ההבדל בין עדכון של שניות לתיקון ניסוח של שאלה, לבין הורדה מחדש של מאות MB.
 * ומאותה סיבה הספרייה יכולה לזהות איזה משחק נמצא בחבילה ישנה (gameLibrary.cjs).
 *
 * תומך ב-STORE וב-DEFLATE, כמו כל החבילות שהתוכנה פוגשת (חבילת השרת, האריזה
 * במחשב, שמירת העורך). zip64 והצפנה אינם נתמכים — ואז פשוט אין קיצור דרך.
 * טהור (בלי Electron) — ראו tests/zipRead.test.ts.
 */
const fs = require('node:fs');
const zlib = require('node:zlib');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { crc32Update } = require('./zipStore.cjs');
const { MAX_EOCD_SCAN } = require('./zipIntegrity.cjs');

/**
 * @typedef {{
 *   name: string,
 *   method: number,
 *   crc: number,
 *   compressedSize: number,
 *   size: number,
 *   localOffset: number,
 *   encrypted: boolean,
 * }} ZipEntry
 */

/**
 * רשימת הקבצים בחבילה, מהספרייה המרכזית.
 * @param {string} file
 * @returns {ZipEntry[] | null} null = אינו ZIP, נקטע, zip64, או פגום
 */
function readZipDirectory(file) {
  /** @type {number} */
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return null;
  }
  try {
    const size = fs.fstatSync(fd).size;
    if (size < 22) return null;
    const tailLen = Math.min(size, MAX_EOCD_SCAN);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tailLen) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return null;
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return null;
    if (cdOffset + cdSize > size) return null;
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOffset);
    /** @type {ZipEntry[]} */
    const entries = [];
    let p = 0;
    for (let n = 0; n < count; n += 1) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) return null;
      const flags = cd.readUInt16LE(p + 8);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      if (p + 46 + nameLen > cd.length) return null;
      entries.push({
        // שמות בלי דגל UTF-8 מפוענחים גם הם כ-UTF-8, כמו ב-JSZip.
        name: cd.subarray(p + 46, p + 46 + nameLen).toString('utf8'),
        method: cd.readUInt16LE(p + 10),
        crc: cd.readUInt32LE(p + 16),
        compressedSize: cd.readUInt32LE(p + 20),
        size: cd.readUInt32LE(p + 24),
        localOffset: cd.readUInt32LE(p + 42),
        encrypted: (flags & 1) !== 0,
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * היכן מתחילים הבתים של הקובץ בחבילה (אחרי הכותרת המקומית, שה-extra שלה יכול
 * להיות שונה מזה שבספרייה המרכזית). null = כותרת לא תקינה או מחוץ לקובץ.
 * @param {string} file
 * @param {ZipEntry} entry
 * @returns {number | null}
 */
function dataStart(file, entry) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(30);
    if (fs.readSync(fd, head, 0, 30, entry.localOffset) !== 30) return null;
    if (head.readUInt32LE(0) !== 0x04034b50) return null;
    const start = entry.localOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    return start + entry.compressedSize <= fs.fstatSync(fd).size ? start : null;
  } finally {
    fs.closeSync(fd);
  }
}

/** @param {ZipEntry} entry */
function supported(entry) {
  return !entry.encrypted && (entry.method === 0 || entry.method === 8);
}

/**
 * קריאת קובץ קטן מהחבילה לזיכרון (data.json, manifest.json), עם בדיקת CRC.
 * @param {string} file
 * @param {ZipEntry} entry
 * @param {number} [maxBytes]
 * @returns {Buffer | null}
 */
function readZipEntry(file, entry, maxBytes = 64 * 1024 * 1024) {
  try {
    if (!supported(entry) || entry.size > maxBytes || entry.compressedSize > maxBytes) return null;
    const start = dataStart(file, entry);
    if (start === null) return null;
    const raw = Buffer.alloc(entry.compressedSize);
    const fd = fs.openSync(file, 'r');
    try {
      fs.readSync(fd, raw, 0, raw.length, start);
    } finally {
      fs.closeSync(fd);
    }
    const data = entry.method === 8 ? zlib.inflateRawSync(raw) : raw;
    if (data.length !== entry.size) return null;
    return ((crc32Update(0xffffffff, data) ^ 0xffffffff) >>> 0) === entry.crc ? data : null;
  } catch {
    return null;
  }
}

/**
 * חילוץ קובץ אחד ל-dest בזרימה. הקובץ נכתב קודם ל-`dest.seed` ומועבר למקומו
 * רק אחרי שה-CRC והגודל תואמים — כך קובץ שנקרא חלקית לעולם אינו נראה שלם.
 * @param {string} file
 * @param {ZipEntry} entry
 * @param {string} dest
 * @returns {Promise<boolean>}
 */
async function extractZipEntry(file, entry, dest) {
  const tmp = `${dest}.seed`;
  try {
    if (!supported(entry)) return false;
    const start = dataStart(file, entry);
    if (start === null) return false;
    let crc = 0xffffffff;
    let size = 0;
    if (entry.compressedSize === 0) {
      fs.writeFileSync(tmp, Buffer.alloc(0)); // קובץ ריק (STORE) — אין מה לזרום
    } else {
      const tap = new Transform({
        transform(chunk, _enc, cb) {
          crc = crc32Update(crc, chunk);
          size += chunk.length;
          cb(null, chunk);
        },
      });
      const src = fs.createReadStream(file, { start, end: start + entry.compressedSize - 1 });
      const out = fs.createWriteStream(tmp);
      if (entry.method === 8) await pipeline(src, zlib.createInflateRaw(), tap, out);
      else await pipeline(src, tap, out);
    }
    if (size !== entry.size || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) {
      fs.rmSync(tmp, { force: true });
      return false;
    }
    fs.rmSync(dest, { force: true });
    fs.renameSync(tmp, dest);
    return true;
  } catch {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* אין מה למחוק */
    }
    return false;
  }
}

module.exports = { readZipDirectory, readZipEntry, extractZipEntry };
