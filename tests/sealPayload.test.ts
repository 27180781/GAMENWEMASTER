/**
 * בדיקות לחותמת המשחק (sealPayload) — אריזה/פריקה של משחק סגור ב-EXE.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { sealPayload, readSealed, FOOTER_LEN } = require('../electron/sealPayload.cjs');

const fakeExe = Buffer.from('MZ generic exe bytes ...'.repeat(50));
const gameZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]); // "PK.."
const config = { room: 'ABC', allowClickers: true, allowPhones: true, limit: 200, name: 'משחק' };

describe('sealPayload', () => {
  it('אריזה ואז פריקה מחזירה בדיוק את ה-ZIP וההגדרות', () => {
    const sealed = sealPayload(fakeExe, gameZip, config);
    // ה-EXE הגנרי נשאר בהתחלה ללא שינוי (עדיין רץ)
    expect(sealed.subarray(0, fakeExe.length).equals(fakeExe)).toBe(true);
    const out = readSealed(sealed);
    expect(out).not.toBeNull();
    expect(Buffer.from(out!.gameZip).equals(gameZip)).toBe(true);
    expect(out!.config).toEqual(config);
  });

  it('EXE בלי חותמת → null', () => {
    expect(readSealed(fakeExe)).toBeNull();
    expect(readSealed(Buffer.alloc(3))).toBeNull(); // קצר מהזנב
  });

  it('חותמת פגומה (MAGIC שגוי) → null', () => {
    const sealed = sealPayload(fakeExe, gameZip, config);
    sealed[sealed.length - 1] ^= 0xff; // פוגמים את ה-MAGIC
    expect(readSealed(sealed)).toBeNull();
  });

  it('הזנב באורך קבוע, והאורכים שבו תואמים למטען בפועל', () => {
    const sealed = sealPayload(fakeExe, gameZip, config);
    const footer = sealed.subarray(sealed.length - FOOTER_LEN);
    const gameLen = footer.readUInt32LE(0);
    const configLen = footer.readUInt32LE(4);
    // המטען מוצפן, ולכן ארוך מהמקור (מלח+IV+tag) — אך המבנה נשאר עקבי.
    expect(sealed.length).toBe(fakeExe.length + gameLen + configLen + FOOTER_LEN);
    expect(gameLen).toBeGreaterThan(gameZip.length);
  });

  it('המטען מוצפן: ה-ZIP וההגדרות אינם קריאים בקובץ (אין חילוץ ב-7-Zip)', () => {
    const sealed = sealPayload(fakeExe, gameZip, config);
    const payload = sealed.subarray(fakeExe.length, sealed.length - FOOTER_LEN);
    // כותרת ZIP ("PK\x03\x04") לא מופיעה — כלי ארכיון לא ימצאו ארכיון
    expect(payload.includes(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(false);
    // גם ההגדרות (קוד החדר/שם המשחק) אינן גלויות כטקסט
    expect(payload.includes(Buffer.from('ABC', 'utf8'))).toBe(false);
    expect(payload.includes(Buffer.from('allowClickers', 'utf8'))).toBe(false);
    expect(payload.includes(Buffer.from('משחק', 'utf8'))).toBe(false);
  });

  it('מטען שנפגם → null (בלי לקרוס)', () => {
    const sealed = sealPayload(fakeExe, gameZip, config);
    sealed[fakeExe.length + 5] ^= 0xff; // פוגמים בתוך המטען המוצפן
    expect(readSealed(sealed)).toBeNull();
  });
});
