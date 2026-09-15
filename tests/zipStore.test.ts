/**
 * כותב ה-ZIP (electron/zipStore.cjs) — החבילה שנבנית במחשב מקבצים שהורדו
 * ישירות חייבת להיקרא בדיוק כמו חבילת השרת: על ידי JSZip (המטמון המוצפן),
 * עם CRC נכון לכל קובץ, ועם רשומת סיום שבדיקת השלמות מזהה.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { writeStoreZip, crc32Update } = require('../electron/zipStore.cjs') as {
  writeStoreZip: (out: string, entries: { path: string; file?: string; data?: Buffer | string }[]) => Promise<number>;
  crc32Update: (crc: number, buf: Uint8Array) => number;
};
const { hasZipEndRecord, tailLength } = require('../electron/zipIntegrity.cjs') as {
  hasZipEndRecord: (tail: Buffer, total: number) => boolean;
  tailLength: (total: number) => number;
};

describe('zipStore', () => {
  let dir = '';
  afterEach(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('CRC-32 תואם לתקן (וקטור הבדיקה "123456789" → CBF43926)', () => {
    const crc = (crc32Update(0xffffffff, Buffer.from('123456789')) ^ 0xffffffff) >>> 0;
    expect(crc.toString(16)).toBe('cbf43926');
  });

  it('★ החבילה נקראת ב-JSZip עם אימות CRC, בשמות ובתוכן המקוריים — כולל קובץ מהדיסק ועברית בשם', async () => {
    dir = mkdtempSync(join(tmpdir(), 'zipstore-'));
    const big = Buffer.alloc(300_000);
    for (let i = 0; i < big.length; i += 1) big[i] = (i * 31 + 7) & 0xff;
    writeFileSync(join(dir, 'clip.mp4'), big);
    const out = join(dir, 'game.zip');
    const bytes = await writeStoreZip(out, [
      { path: 'data.json', data: '{"name":"משחק"}' },
      { path: 'Assets/clip.mp4', file: join(dir, 'clip.mp4') },
      { path: 'Assets/ריק.txt', data: '' },
      { path: 'manifest.json', data: Buffer.from('{"files":[]}') },
    ]);
    const buf = readFileSync(out);
    expect(buf.length).toBe(bytes);
    const zip = await JSZip.loadAsync(buf, { checkCRC32: true });
    expect(Object.keys(zip.files).sort()).toEqual(['Assets/clip.mp4', 'Assets/ריק.txt', 'data.json', 'manifest.json']);
    expect(await zip.file('data.json')!.async('string')).toBe('{"name":"משחק"}');
    expect((await zip.file('Assets/clip.mp4')!.async('nodebuffer')).equals(big)).toBe(true);
    expect(await zip.file('Assets/ריק.txt')!.async('string')).toBe('');
    // בדיקת השלמות של ההורדה לפי קוד (EOCD בזנב) חייבת לעבור גם על חבילה שנבנתה כאן.
    const tail = buf.subarray(buf.length - tailLength(buf.length));
    expect(hasZipEndRecord(tail, buf.length)).toBe(true);
  });

  it('CRC שגוי היה נתפס — הבדיקה באמת מאמתת', async () => {
    dir = mkdtempSync(join(tmpdir(), 'zipstore-'));
    const out = join(dir, 'game.zip');
    await writeStoreZip(out, [{ path: 'a.txt', data: 'hello' }]);
    const buf = readFileSync(out);
    const first = 30 + 'a.txt'.length; // הבית הראשון של התוכן
    buf.writeUInt8(buf.readUInt8(first) ^ 0xff, first);
    await expect(JSZip.loadAsync(buf, { checkCRC32: true })).rejects.toThrow(/crc/i);
  });
});
