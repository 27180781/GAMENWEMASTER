// @ts-check
/**
 * כתיבת ZIP במצב STORE (בלי דחיסה) לדיסק, בזרימה.
 *
 * למה: חבילת משחק שהורדה ישירות מהאחסון מגיעה כקבצים נפרדים, ושאר התוכנה
 * (הספרייה, המטמון המוצפן, החתימה) מכירה רק חבילת ZIP אחת — בדיוק במבנה
 * שהשרת בונה ב-download-by-code: כותרת מקומית עם data descriptor לכל קובץ,
 * ואז הספרייה המרכזית. וידאו ותמונות ממילא דחוסים, ולכן STORE לא עולה כלום.
 *
 * הבייטים לעולם אינם נטענים כולם לזיכרון: קובץ נקרא מהדיסק בחתיכות ונכתב
 * ישר לחבילה, וה-CRC מחושב תוך כדי. טהור (בלי Electron) — ראו tests/zipStore.test.ts.
 */
const fs = require('node:fs');

/** טבלת CRC-32 (IEEE), כמו ב-zip. */
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c >>> 0;
}

/**
 * עדכון CRC מצטבר. מתחילים מ-0xffffffff ומסיימים ב-XOR עם 0xffffffff.
 * @param {number} crc
 * @param {Uint8Array} buf
 */
function crc32Update(crc, buf) {
  let c = crc;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}

/** @param {number} n */
function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}
/** @param {number} n */
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

/** זמן/תאריך בפורמט DOS של zip (רזולוציה של שתי שניות). @param {Date} d */
function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

const FLAG_DESCRIPTOR_UTF8 = 0x0808; // ביט 3: גדלים ו-CRC ב-descriptor; ביט 11: שמות UTF-8
const MAX_ZIP32 = 0xffffffff;

/**
 * @typedef {{ path: string, file?: string, data?: Buffer | string }} StoreEntry
 * `file` — נתיב בדיסק שייקרא בזרימה; `data` — תוכן קטן שכבר בזיכרון.
 */

/**
 * כותב את הערכים ל-`outPath` ומחזיר את גודל החבילה בבתים.
 * @param {string} outPath
 * @param {StoreEntry[]} entries
 * @returns {Promise<number>}
 */
async function writeStoreZip(outPath, entries) {
  if (entries.length >= 0xffff) throw new Error('יותר מדי קבצים לחבילה (zip64 אינו נתמך)');
  const out = fs.createWriteStream(outPath);
  /** @type {Error | null} */
  let streamError = null;
  out.on('error', (err) => {
    streamError = err;
  });
  /** @param {Buffer} buf */
  const write = (buf) =>
    new Promise((resolve, reject) => {
      if (streamError !== null) {
        reject(streamError);
        return;
      }
      out.write(buf, (err) => (err ? reject(err) : resolve(undefined)));
    });

  let offset = 0;
  /** @type {{ name: Buffer, time: number, date: number, crc: number, size: number, localStart: number }[]} */
  const central = [];
  const stamp = dosDateTime(new Date());

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const localStart = offset;
    await write(
      Buffer.concat([
        u32(0x04034b50),
        u16(20),
        u16(FLAG_DESCRIPTOR_UTF8),
        u16(0), // STORE
        u16(stamp.time),
        u16(stamp.date),
        u32(0), // CRC — ב-descriptor
        u32(0), // גודל דחוס — ב-descriptor
        u32(0), // גודל מקורי — ב-descriptor
        u16(name.length),
        u16(0),
        name,
      ]),
    );
    offset += 30 + name.length;

    let crc = 0xffffffff;
    let size = 0;
    if (entry.file !== undefined) {
      for await (const chunk of fs.createReadStream(entry.file)) {
        const buf = /** @type {Buffer} */ (chunk);
        crc = crc32Update(crc, buf);
        size += buf.length;
        await write(buf);
      }
    } else {
      const buf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data ?? ''), 'utf8');
      crc = crc32Update(crc, buf);
      size = buf.length;
      if (size > 0) await write(buf);
    }
    const crcFinal = (crc ^ 0xffffffff) >>> 0;
    if (size > MAX_ZIP32) throw new Error(`הקובץ ${entry.path} גדול מדי לחבילה (zip64 אינו נתמך)`);
    await write(Buffer.concat([u32(0x08074b50), u32(crcFinal), u32(size), u32(size)]));
    offset += size + 16;
    central.push({ name, time: stamp.time, date: stamp.date, crc: crcFinal, size, localStart });
  }

  const cdStart = offset;
  for (const c of central) {
    await write(
      Buffer.concat([
        u32(0x02014b50),
        u16(20), // נוצר על ידי
        u16(20), // גרסה נדרשת
        u16(FLAG_DESCRIPTOR_UTF8),
        u16(0),
        u16(c.time),
        u16(c.date),
        u32(c.crc),
        u32(c.size),
        u32(c.size),
        u16(c.name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(c.localStart),
        c.name,
      ]),
    );
    offset += 46 + c.name.length;
  }
  const cdSize = offset - cdStart;
  if (offset > MAX_ZIP32) throw new Error('החבילה גדולה מדי (zip64 אינו נתמך)');
  await write(
    Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(cdSize), u32(cdStart), u16(0)]),
  );
  offset += 22;

  await new Promise((resolve, reject) => {
    out.end(() => (streamError !== null ? reject(streamError) : resolve(undefined)));
  });
  return offset;
}

module.exports = { writeStoreZip, crc32Update };
