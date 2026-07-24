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

  it('הזנב באורך קבוע', () => {
    const sealed = sealPayload(fakeExe, gameZip, config);
    const configLen = Buffer.from(JSON.stringify(config), 'utf8').length;
    expect(sealed.length).toBe(fakeExe.length + gameZip.length + configLen + FOOTER_LEN);
  });
});
