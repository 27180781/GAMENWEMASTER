/**
 * זיהוי חבילה חתוכה. השרת אורז בסטרימינג ולכן אין Content-Length — בלי
 * הבדיקה הזו חיבור שנפל היה מחליף משחק עובד בקובץ שבור.
 */

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import JSZip from 'jszip';

const require_ = createRequire(import.meta.url);
const { hasZipEndRecord, tailLength } = require_('../electron/zipIntegrity.cjs') as {
  hasZipEndRecord: (tail: Buffer, total: number) => boolean;
  tailLength: (total: number) => number;
};

/** בודק קובץ שלם דרך אותו מסלול שהתוכנה משתמשת בו. */
function check(buf: Buffer): boolean {
  const tail = buf.subarray(buf.length - tailLength(buf.length));
  return hasZipEndRecord(tail, buf.length);
}

async function makeZip(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('game.json', JSON.stringify({ id: 'g', name: 'משחק', questions: [] }));
  zip.file('Assets/big.bin', Buffer.alloc(200 * 1024, 3));
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

describe('hasZipEndRecord', () => {
  it('ZIP שלם — תקין', async () => {
    expect(check(await makeZip())).toBe(true);
  });

  it('★ ZIP שנקטע — נפסל, בכל אחוז שהוא', async () => {
    const full = await makeZip();
    for (const pct of [0.1, 0.5, 0.9, 0.99]) {
      const cut = full.subarray(0, Math.floor(full.length * pct));
      expect(check(cut), `נקטע ב-${pct * 100}%`).toBe(false);
    }
  });

  it('חסר בית אחד בלבד — עדיין נפסל', async () => {
    const full = await makeZip();
    expect(check(full.subarray(0, full.length - 1))).toBe(false);
  });

  it('קובץ ריק / זעיר — נפסל בלי לקרוס', () => {
    expect(check(Buffer.alloc(0))).toBe(false);
    expect(check(Buffer.from('PK'))).toBe(false);
    expect(check(Buffer.alloc(21))).toBe(false);
  });

  it('לא HTML של שגיאה שהתחזה לחבילה', () => {
    expect(check(Buffer.from('<html>504 Gateway Timeout</html>'))).toBe(false);
  });

  it('חתימה מקרית בתוך הנתונים אינה נחשבת לסוף קובץ', () => {
    // 0x06054b50 באמצע תוכן, בלי שהרשומה מסתיימת בסוף הקובץ
    const fake = Buffer.alloc(200);
    fake.writeUInt32LE(0x06054b50, 40);
    expect(check(fake)).toBe(false);
  });

  it('ההיסט של הספרייה המרכזית חייב להיכנס בקובץ', async () => {
    const full = await makeZip();
    const copy = Buffer.from(full);
    // מזייפים היסט ענק — רשומה "תקינה" שמצביעה מחוץ לקובץ
    copy.writeUInt32LE(0x7fffffff, copy.length - 22 + 16);
    expect(check(copy)).toBe(false);
  });

  it('tailLength לא חורג מגודל הקובץ', () => {
    expect(tailLength(10)).toBe(10);
    expect(tailLength(5_000_000)).toBe(22 + 0xffff);
  });
});
