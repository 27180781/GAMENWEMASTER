/**
 * החלפה עצמית של קובץ ההרצה (כלי "חתום EXE").
 *
 * הדרישה הקשוחה: **בשום מסלול לא נשארים בלי כלי**. לכן נבדק גם מסלול הכישלון,
 * ולא רק המסלול המוצלח.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { sameFile, replaceSelf, cleanupOldSelf, oldPathOf } = require('../electron/selfUpdate.cjs') as {
  sameFile: (a: string, b: string) => boolean;
  replaceSelf: (selfPath: string, newPath: string) => boolean;
  cleanupOldSelf: (selfPath: string) => boolean;
  oldPathOf: (selfPath: string) => string;
};

const dirs: string[] = [];
function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'selfupd-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('sameFile', () => {
  it('תוכן זהה → true, תוכן שונה באותו גודל → false', () => {
    const d = tmpDir();
    const a = path.join(d, 'a');
    const b = path.join(d, 'b');
    const c = path.join(d, 'c');
    fs.writeFileSync(a, 'AAAA');
    fs.writeFileSync(b, 'AAAA');
    fs.writeFileSync(c, 'AAAB'); // אותו גודל, תוכן שונה — חייב hash כדי לתפוס
    expect(sameFile(a, b)).toBe(true);
    expect(sameFile(a, c)).toBe(false);
  });

  it('גדלים שונים → false בלי לחשב hash', () => {
    const d = tmpDir();
    const a = path.join(d, 'a');
    const b = path.join(d, 'b');
    fs.writeFileSync(a, 'AAAA');
    fs.writeFileSync(b, 'AAAAAA');
    expect(sameFile(a, b)).toBe(false);
  });

  it('קובץ חסר → false (לא מעדכנים על סמך מידע חסר)', () => {
    const d = tmpDir();
    fs.writeFileSync(path.join(d, 'a'), 'x');
    expect(sameFile(path.join(d, 'a'), path.join(d, 'nope'))).toBe(false);
  });

  it('קובץ גדול מגודל המקטע נקרא במלואו', () => {
    const d = tmpDir();
    const a = path.join(d, 'a');
    const b = path.join(d, 'b');
    const big = Buffer.alloc(9 * 1024 * 1024, 0x41); // > 8MB
    fs.writeFileSync(a, big);
    const changed = Buffer.from(big);
    changed[changed.length - 1] = 0x42; // רק הבית האחרון שונה
    fs.writeFileSync(b, changed);
    expect(sameFile(a, a)).toBe(true);
    expect(sameFile(a, b)).toBe(false);
  });
});

describe('replaceSelf', () => {
  it('מחליף את הקובץ ומשאיר את הישן בצד', () => {
    const d = tmpDir();
    const self = path.join(d, 'SealEXE.exe');
    const next = path.join(d, 'downloaded.exe');
    fs.writeFileSync(self, 'OLD');
    fs.writeFileSync(next, 'NEW');

    expect(replaceSelf(self, next)).toBe(true);
    expect(fs.readFileSync(self, 'utf8')).toBe('NEW');
    expect(fs.readFileSync(oldPathOf(self), 'utf8')).toBe('OLD');
    // הקובץ שהורד לא הוזז ממקומו (המטמון נשאר שמיש)
    expect(fs.readFileSync(next, 'utf8')).toBe('NEW');
    // ולא נשאר קובץ ביניים
    expect(fs.existsSync(`${self}.new`)).toBe(false);
  });

  it('מקור חסר → נכשל בלי לגעת בקובץ הקיים', () => {
    const d = tmpDir();
    const self = path.join(d, 'SealEXE.exe');
    fs.writeFileSync(self, 'OLD');
    expect(replaceSelf(self, path.join(d, 'nope.exe'))).toBe(false);
    expect(fs.readFileSync(self, 'utf8')).toBe('OLD'); // ★ הכלי עדיין שם
  });

  it('כשל בהעברה האחרונה → הקובץ הישן מוחזר למקומו', () => {
    const d = tmpDir();
    const self = path.join(d, 'SealEXE.exe');
    const next = path.join(d, 'downloaded.exe');
    fs.writeFileSync(self, 'OLD');
    fs.writeFileSync(next, 'NEW');

    // מפילים *רק* את ההעברה של staged→self; ההעברות האחרות עוברות כרגיל.
    const realRename = fs.renameSync;
    let calls = 0;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      calls += 1;
      if (calls === 2) throw new Error('כשל מדומה');
      return realRename(from, to);
    });

    expect(replaceSelf(self, next)).toBe(false);
    vi.restoreAllMocks();
    // ★ הדרישה הקריטית: הכלי חזר למקומו עם התוכן המקורי
    expect(fs.existsSync(self)).toBe(true);
    expect(fs.readFileSync(self, 'utf8')).toBe('OLD');
    expect(fs.existsSync(oldPathOf(self))).toBe(false);
  });

  it('שארית מניסיון קודם לא מפריעה', () => {
    const d = tmpDir();
    const self = path.join(d, 'SealEXE.exe');
    const next = path.join(d, 'downloaded.exe');
    fs.writeFileSync(self, 'OLD');
    fs.writeFileSync(next, 'NEW');
    fs.writeFileSync(`${self}.new`, 'GARBAGE'); // שארית מריצה שנקטעה
    expect(replaceSelf(self, next)).toBe(true);
    expect(fs.readFileSync(self, 'utf8')).toBe('NEW');
  });
});

describe('cleanupOldSelf', () => {
  it('מוחק שארית מעדכון קודם ומדווח על כך', () => {
    const d = tmpDir();
    const self = path.join(d, 'SealEXE.exe');
    fs.writeFileSync(self, 'NEW');
    fs.writeFileSync(oldPathOf(self), 'OLD');
    expect(cleanupOldSelf(self)).toBe(true);
    expect(fs.existsSync(oldPathOf(self))).toBe(false);
  });

  it('אין שארית → false, בלי לזרוק', () => {
    const d = tmpDir();
    const self = path.join(d, 'SealEXE.exe');
    fs.writeFileSync(self, 'NEW');
    expect(cleanupOldSelf(self)).toBe(false);
  });
});
