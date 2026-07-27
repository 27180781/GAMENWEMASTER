/**
 * בדיקות לחותמת המשחק (sealPayload) — אריזה/פריקה של משחק סגור ב-EXE.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { sealPayload, sealToFile, readSealed, readSealedFromFile, baseExeLength, FOOTER_LEN } =
  require('../electron/sealPayload.cjs');

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

// ---------------------------------------------------------------------------
// כלי "חתום EXE" — חתימה מקובץ לקובץ, כולל חתימה מתוך EXE שכבר חתום
// ---------------------------------------------------------------------------

const tmpDirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seal-test-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('baseExeLength', () => {
  it('קובץ בלי חותמת → גודלו המלא', () => {
    const dir = tmpDir();
    const p = path.join(dir, 'plain.exe');
    fs.writeFileSync(p, fakeExe);
    expect(baseExeLength(p)).toBe(fakeExe.length);
  });

  it('קובץ חתום → האורך *לפני* המטען (הבסיס הנקי)', () => {
    const dir = tmpDir();
    const p = path.join(dir, 'sealed.exe');
    fs.writeFileSync(p, sealPayload(fakeExe, gameZip, config));
    expect(baseExeLength(p)).toBe(fakeExe.length);
  });

  it('קובץ שאינו קיים → 1-', () => {
    expect(baseExeLength(path.join(tmpDir(), 'nope.exe'))).toBe(-1);
  });
});

describe('sealToFile', () => {
  it('כותב EXE חתום שניתן לקריאה חזרה', () => {
    const dir = tmpDir();
    const base = path.join(dir, 'base.exe');
    const out = path.join(dir, 'game.exe');
    fs.writeFileSync(base, fakeExe);
    const size = sealToFile(base, gameZip, config, out);

    expect(fs.statSync(out).size).toBe(size);
    const read = readSealedFromFile(out);
    expect(read).not.toBeNull();
    expect(Buffer.from(read!.gameZip).equals(gameZip)).toBe(true);
    expect(read!.config).toEqual(config);
    // הבסיס הועתק כמו שהוא — ה-EXE עדיין תקין להרצה
    expect(fs.readFileSync(out).subarray(0, fakeExe.length).equals(fakeExe)).toBe(true);
  });

  it('חתימה מתוך EXE שכבר חתום מחליפה את המטען ולא משרשרת אותו', () => {
    const dir = tmpDir();
    const first = path.join(dir, 'first.exe');
    const second = path.join(dir, 'second.exe');
    fs.writeFileSync(first, sealPayload(fakeExe, gameZip, config));

    const otherZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 9, 9, 9]);
    const otherConfig = { ...config, name: 'משחק שני', room: '' };
    const size = sealToFile(first, otherZip, otherConfig, second);

    // הקובץ החדש קטן מ"בסיס + שני מטענים" — כלומר המטען הישן הושמט
    expect(size).toBeLessThan(fs.statSync(first).size + otherZip.length + FOOTER_LEN * 2);
    const read = readSealedFromFile(second);
    expect(Buffer.from(read!.gameZip).equals(otherZip)).toBe(true);
    expect(read!.config).toEqual(otherConfig);
    // ומה שנשאר בתחילת הקובץ הוא הבסיס הנקי בלבד
    expect(baseExeLength(second)).toBe(fakeExe.length);
  });

  it('מסרב לכתוב על קובץ הבסיס עצמו', () => {
    const dir = tmpDir();
    const base = path.join(dir, 'base.exe');
    fs.writeFileSync(base, fakeExe);
    expect(() => sealToFile(base, gameZip, config, base)).toThrow();
    // הקובץ לא נפגע
    expect(fs.readFileSync(base).equals(fakeExe)).toBe(true);
  });

  it('בסיס שאינו קיים → שגיאה ברורה', () => {
    const dir = tmpDir();
    expect(() =>
      sealToFile(path.join(dir, 'nope.exe'), gameZip, config, path.join(dir, 'out.exe')),
    ).toThrow();
  });

  it('בסיס גדול מגודל המקטע — מועתק שלם (העתקה במקטעים)', () => {
    const dir = tmpDir();
    const base = path.join(dir, 'big.exe');
    const out = path.join(dir, 'big-game.exe');
    // 20MB > מקטע ההעתקה (8MB) → לפחות שלוש איטרציות של הלולאה
    const big = Buffer.alloc(20 * 1024 * 1024, 0xab);
    big.write('MZ', 0);
    fs.writeFileSync(base, big);
    sealToFile(base, gameZip, config, out);
    expect(fs.readFileSync(out).subarray(0, big.length).equals(big)).toBe(true);
    expect(Buffer.from(readSealedFromFile(out)!.gameZip).equals(gameZip)).toBe(true);
  });
});
