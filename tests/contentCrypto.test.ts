/**
 * בדיקות להצפנת התוכן (contentCrypto.cjs): קופסה שלמה (GCM) לקבצים/מטען,
 * וקובץ מדיה בבלוקים (CTR) שמאפשר פענוח טווח — הבסיס לדילוג בווידאו.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const crypto = require('../electron/contentCrypto.cjs') as {
  sealBox: (b: Buffer, ctx?: string) => Buffer;
  openBox: (b: Buffer, ctx?: string) => Buffer;
  writeEncryptedMedia: (dest: string, plain: Buffer, salt: string) => void;
  readEncryptedMediaRange: (f: string, salt: string, start: number, end: number) => Buffer;
  encryptedMediaSize: (f: string) => number;
  isEncryptedMedia: (f: string) => boolean;
  MEDIA_BLOCK: number;
};

const dir = mkdtempSync(join(tmpdir(), 'trivia-crypto-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('sealBox / openBox (מטען ה-EXE)', () => {
  it('הלוך-ושוב משחזר את התוכן במדויק', () => {
    const plain = Buffer.from('שלום עולם — תוכן משחק סודי 🎯', 'utf8');
    const boxed = crypto.sealBox(plain, 'seal-game');
    expect(crypto.openBox(boxed, 'seal-game').equals(plain)).toBe(true);
  });

  it('הטקסט המקורי אינו מופיע בתוצאה המוצפנת', () => {
    const plain = Buffer.from('PK data.json סוד', 'utf8');
    const boxed = crypto.sealBox(plain, 'seal-game');
    expect(boxed.includes(Buffer.from('data.json'))).toBe(false);
    expect(boxed.includes(Buffer.from('PK'))).toBe(false);
  });

  it('כל הצפנה מייצרת פלט שונה (מלח/IV אקראיים)', () => {
    const plain = Buffer.from('אותו תוכן');
    expect(crypto.sealBox(plain).equals(crypto.sealBox(plain))).toBe(false);
  });

  it('הקשר שגוי או תוכן שהשתנה — נכשל (אימות GCM)', () => {
    const boxed = crypto.sealBox(Buffer.from('סוד'), 'seal-game');
    expect(() => crypto.openBox(boxed, 'seal-config')).toThrow();
    const tampered = Buffer.from(boxed);
    const last = tampered.length - 1;
    tampered.writeUInt8(tampered.readUInt8(last) ^ 0xff, last);
    expect(() => crypto.openBox(tampered, 'seal-game')).toThrow();
  });
});

describe('מדיה מוצפנת בדיסק (CTR בבלוקים)', () => {
  /** קובץ "וידאו" של 2.5 בלוקים, עם תוכן צפוי לכל בית. */
  const size = Math.floor(crypto.MEDIA_BLOCK * 2.5);
  const plain = Buffer.alloc(size);
  for (let i = 0; i < size; i++) plain[i] = (i * 7 + 13) & 0xff;
  const file = join(dir, 'clip.mp4');
  const salt = 'cachekey123';
  crypto.writeEncryptedMedia(file, plain, salt);

  it('הקובץ בדיסק מזוהה כמוצפן ואינו מכיל את התוכן המקורי', () => {
    expect(crypto.isEncryptedMedia(file)).toBe(true);
    const raw = readFileSync(file);
    // דגימה: 64 הבתים הראשונים של התוכן לא מופיעים בקובץ המוצפן
    expect(raw.includes(plain.subarray(0, 64))).toBe(false);
  });

  it('הגודל המדווח שווה לגודל המקורי', () => {
    expect(crypto.encryptedMediaSize(file)).toBe(size);
  });

  it('פענוח מלא זהה למקור', () => {
    expect(crypto.readEncryptedMediaRange(file, salt, 0, size - 1).equals(plain)).toBe(true);
  });

  it('פענוח טווח מהאמצע (דילוג בווידאו) מדויק בבית', () => {
    const cases: [number, number][] = [
      [0, 99],
      [100, 250],
      [crypto.MEDIA_BLOCK - 5, crypto.MEDIA_BLOCK + 5], // חוצה גבול בלוק
      [crypto.MEDIA_BLOCK * 2, size - 1], // הבלוק החלקי האחרון
      [size - 1, size - 1], // בית בודד בסוף
    ];
    for (const [from, to] of cases) {
      const got = crypto.readEncryptedMediaRange(file, salt, from, to);
      expect(got.equals(plain.subarray(from, to + 1))).toBe(true);
    }
  });

  it('טווח מעבר לגודל נחתך, וטווח לא חוקי מחזיר ריק', () => {
    expect(crypto.readEncryptedMediaRange(file, salt, size - 10, size + 999).length).toBe(10);
    expect(crypto.readEncryptedMediaRange(file, salt, size + 5, size + 10).length).toBe(0);
  });

  it('מלח שגוי (מטמון של משחק אחר) לא משחזר את התוכן', () => {
    const wrong = crypto.readEncryptedMediaRange(file, 'othercache', 0, 99);
    expect(wrong.equals(plain.subarray(0, 100))).toBe(false);
  });

  it('קובץ רגיל לא מזוהה כמוצפן', () => {
    const plainFile = join(dir, 'plain.txt');
    require('node:fs').writeFileSync(plainFile, 'hello');
    expect(crypto.isEncryptedMedia(plainFile)).toBe(false);
  });
});
