/**
 * קריאה מתוך חבילה שבדיסק (electron/zipRead.cjs) — הבסיס לעדכון שמוריד רק
 * את מה שהשתנה. קובץ שה-CRC שלו אינו תואם לעולם אינו מועתק: עדיף להוריד
 * שוב מאשר להכניס למשחק סרטון פגום.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
type ZipEntry = { name: string; method: number; crc: number; compressedSize: number; size: number; localOffset: number; encrypted: boolean };
const zr = require('../electron/zipRead.cjs') as {
  readZipDirectory: (file: string) => ZipEntry[] | null;
  readZipEntry: (file: string, entry: ZipEntry, maxBytes?: number) => Buffer | null;
  extractZipEntry: (file: string, entry: ZipEntry, dest: string) => Promise<boolean>;
};
const { writeStoreZip } = require('../electron/zipStore.cjs') as {
  writeStoreZip: (out: string, entries: { path: string; file?: string; data?: Buffer | string }[]) => Promise<number>;
};

const VIDEO = Buffer.alloc(200_000);
for (let i = 0; i < VIDEO.length; i += 1) VIDEO[i] = (i * 13 + 5) & 0xff;
const TEXT = Buffer.from('שאלה ותשובה '.repeat(2000), 'utf8');

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zipread-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** חבילה כמו זו שהמחשב אורז (STORE, גדלים ב-descriptor). */
async function storeZip(): Promise<string> {
  const out = join(dir, 'store.zip');
  await writeStoreZip(out, [
    { path: 'data.json', data: '{"id":"x"}' },
    { path: 'media/סרטון.mp4', data: VIDEO },
    { path: 'media/empty.txt', data: Buffer.alloc(0) },
  ]);
  return out;
}

/** חבילה דחוסה (DEFLATE), כמו שמירת העורך או חבילת השרת. */
async function deflateZip(): Promise<string> {
  const zip = new JSZip();
  zip.file('data.json', TEXT);
  zip.file('media/clip.mp4', VIDEO);
  const out = join(dir, 'deflate.zip');
  writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return out;
}

const find = (entries: ZipEntry[] | null, name: string): ZipEntry => {
  const e = entries?.find((x) => x.name === name);
  if (e === undefined) throw new Error(`missing ${name}`);
  return e;
};

describe('readZipDirectory', () => {
  it('★ רשימת הקבצים מהספרייה המרכזית — שמות (גם בעברית), גדלים ושיטה', async () => {
    const entries = zr.readZipDirectory(await storeZip());
    expect(entries?.map((e) => [e.name, e.size, e.method])).toEqual([
      ['data.json', 10, 0],
      ['media/סרטון.mp4', VIDEO.length, 0],
      ['media/empty.txt', 0, 0],
    ]);
    const deflated = find(zr.readZipDirectory(await deflateZip()), 'data.json');
    expect(deflated.method).toBe(8);
    expect(deflated.compressedSize).toBeLessThan(deflated.size);
  });

  it('קובץ שאינו ZIP, ZIP קטוע או קובץ שאינו קיים — null', async () => {
    writeFileSync(join(dir, 'not.zip'), 'hello world, this is not a zip file at all');
    expect(zr.readZipDirectory(join(dir, 'not.zip'))).toBeNull();
    const full = readFileSync(await storeZip());
    writeFileSync(join(dir, 'cut.zip'), full.subarray(0, full.length - 30));
    expect(zr.readZipDirectory(join(dir, 'cut.zip'))).toBeNull();
    expect(zr.readZipDirectory(join(dir, 'missing.zip'))).toBeNull();
  });
});

describe('readZipEntry', () => {
  it('★ קורא קובץ קטן — גם ב-STORE וגם ב-DEFLATE', async () => {
    const store = await storeZip();
    expect(zr.readZipEntry(store, find(zr.readZipDirectory(store), 'data.json'))?.toString()).toBe('{"id":"x"}');
    const deflate = await deflateZip();
    expect(zr.readZipEntry(deflate, find(zr.readZipDirectory(deflate), 'data.json'))?.equals(TEXT)).toBe(true);
  });

  it('קובץ גדול מהתקרה — null, בלי לקרוא אותו לזיכרון', async () => {
    const store = await storeZip();
    expect(zr.readZipEntry(store, find(zr.readZipDirectory(store), 'media/סרטון.mp4'), 1000)).toBeNull();
  });

  it('★ CRC שאינו תואם — null', async () => {
    const store = await storeZip();
    const entries = zr.readZipDirectory(store);
    const buf = readFileSync(store);
    const at = buf.indexOf(Buffer.from('{"id":"x"}'));
    buf[at + 2] = 'Y'.charCodeAt(0);
    writeFileSync(store, buf);
    expect(zr.readZipEntry(store, find(entries, 'data.json'))).toBeNull();
  });
});

describe('extractZipEntry', () => {
  it('★ מחלץ קובץ בזרימה ליעד, בלי להשאיר קובץ זמני — STORE ו-DEFLATE', async () => {
    const store = await storeZip();
    const dest = join(dir, 'out.mp4');
    expect(await zr.extractZipEntry(store, find(zr.readZipDirectory(store), 'media/סרטון.mp4'), dest)).toBe(true);
    expect(readFileSync(dest).equals(VIDEO)).toBe(true);
    expect(existsSync(`${dest}.seed`)).toBe(false);

    const deflate = await deflateZip();
    const dest2 = join(dir, 'out2.mp4');
    expect(await zr.extractZipEntry(deflate, find(zr.readZipDirectory(deflate), 'media/clip.mp4'), dest2)).toBe(true);
    expect(readFileSync(dest2).equals(VIDEO)).toBe(true);
  });

  it('קובץ ריק', async () => {
    const store = await storeZip();
    const dest = join(dir, 'empty.txt');
    expect(await zr.extractZipEntry(store, find(zr.readZipDirectory(store), 'media/empty.txt'), dest)).toBe(true);
    expect(readFileSync(dest)).toHaveLength(0);
  });

  it('★ קובץ פגום אינו נכתב ליעד — ויעד קיים אינו נדרס', async () => {
    const store = await storeZip();
    const entries = zr.readZipDirectory(store);
    const buf = readFileSync(store);
    const at = buf.indexOf(VIDEO.subarray(1000, 1064));
    buf.writeUInt8(buf.readUInt8(at) ^ 0xff, at);
    writeFileSync(store, buf);
    const dest = join(dir, 'out.mp4');
    writeFileSync(dest, 'קודם');
    expect(await zr.extractZipEntry(store, find(entries, 'media/סרטון.mp4'), dest)).toBe(false);
    expect(readFileSync(dest, 'utf8')).toBe('קודם');
    expect(existsSync(`${dest}.seed`)).toBe(false);
  });

  it('שיטת דחיסה שאינה נתמכת — false', async () => {
    const store = await storeZip();
    const entry = { ...find(zr.readZipDirectory(store), 'data.json'), method: 12 };
    expect(await zr.extractZipEntry(store, entry, join(dir, 'x'))).toBe(false);
    expect(zr.readZipEntry(store, entry)).toBeNull();
  });
});
