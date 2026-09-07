/**
 * ספריית המשחקים שהורדו.
 *
 * הבאג שזה פותר: היה מקום אחד למשחק. הורדה לפי קוד דרסה את הקודם, ו"טען משחק
 * אחר" מחקה אותו — ולכן חזרה למשחק שכבר הורד דרשה הקלדת הקוד והורדה מחדש של
 * מאות מגה-בייט. הבדיקות כאן נועלות בדיוק את שתי ההתנהגויות האלה.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
interface LibEntry {
  code: string;
  name: string;
  savedAt: number;
  size: number;
}
const lib = require('../electron/gameLibrary.cjs') as {
  isSafeCode: (code: unknown) => boolean;
  libraryZipPath: (dir: string, code: string) => string;
  lastGameZipPath: (dir: string) => string;
  lastGameMetaPath: (dir: string) => string;
  currentGameZipPath: (dir: string) => string;
  libraryList: (dir: string) => LibEntry[];
  librarySelect: (dir: string, code: string) => boolean;
  libraryStore: (dir: string, code: string, name: string) => boolean;
  libraryDelete: (dir: string, code: string) => boolean;
  forgetCurrent: (dir: string) => void;
};

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gamelib-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** מדמה חבילה שהורדה: כותב את ה-ZIP ואז רושם אותה. */
function download(code: string, name = `משחק ${code}`, bytes = 'ZIPDATA') {
  mkdirSync(join(dir, 'games'), { recursive: true });
  writeFileSync(lib.libraryZipPath(dir, code), bytes);
  lib.libraryStore(dir, code, name);
}

describe('קוד תקין לשם קובץ', () => {
  it('מקבל את מה שהורדה לפי קוד מקבלת', () => {
    for (const ok of ['12345', 'abc-DEF_9', 'a']) expect(lib.isSafeCode(ok), ok).toBe(true);
  });

  it('★ דוחה כל דבר שעלול לצאת מהתיקייה', () => {
    for (const bad of ['../x', 'a/b', 'a\\b', '', 'a'.repeat(33), 'קוד', null, undefined]) {
      expect(lib.isSafeCode(bad), String(bad)).toBe(false);
    }
  });
});

describe('הורדה ובחירה', () => {
  it('★ משחק שהורד מופיע ברשימה והופך לנוכחי', () => {
    download('12345');
    expect(lib.libraryList(dir).map((g) => g.code)).toEqual(['12345']);
    expect(lib.currentGameZipPath(dir)).toBe(lib.libraryZipPath(dir, '12345'));
  });

  it('הרשימה ממוינת — החדש קודם', async () => {
    download('aaa');
    await new Promise((r) => setTimeout(r, 5));
    download('bbb');
    expect(lib.libraryList(dir).map((g) => g.code)).toEqual(['bbb', 'aaa']);
  });

  it('הרשימה נושאת שם וגודל', () => {
    download('12345', 'ערב טריוויה', 'ABCDEFGHIJ');
    const [g] = lib.libraryList(dir);
    expect(g?.name).toBe('ערב טריוויה');
    expect(g?.size).toBe(10);
    expect(g?.savedAt).toBeGreaterThan(0);
  });

  it('★ הורדה שנייה אינה מוחקת את הראשונה', () => {
    download('111');
    download('222');
    expect(lib.libraryList(dir).map((g) => g.code).sort()).toEqual(['111', '222']);
  });

  it('★ בחירה מחדש היא כתיבת מטא בלבד — החבילה לא הועתקה', () => {
    download('111');
    download('222'); // עכשיו 222 הוא הנוכחי
    expect(lib.librarySelect(dir, '111')).toBe(true);
    expect(lib.currentGameZipPath(dir)).toBe(lib.libraryZipPath(dir, '111'));
    // אין עותק נוסף: last-game.zip לא נוצר בכלל
    expect(existsSync(lib.lastGameZipPath(dir))).toBe(false);
  });

  it('בחירת קוד שאינו קיים נכשלת ואינה משנה את הנוכחי', () => {
    download('111');
    expect(lib.librarySelect(dir, '999')).toBe(false);
    expect(lib.currentGameZipPath(dir)).toBe(lib.libraryZipPath(dir, '111'));
  });
});

/** ★ הבעיה המקורית: יציאה לבחירת משחק אחר מחקה את מה שהורד. */
describe('"טען משחק אחר" אינו מוחק את הספרייה', () => {
  it('★ אחרי ביטול הבחירה — המשחקים עדיין שם, ואפשר לבחור בלי הורדה', () => {
    download('12345', 'ערב טריוויה');
    lib.forgetCurrent(dir);

    expect(lib.libraryList(dir).map((g) => g.code)).toEqual(['12345']);
    expect(lib.currentGameZipPath(dir)).toBe(lib.lastGameZipPath(dir)); // אין נוכחי
    expect(lib.librarySelect(dir, '12345')).toBe(true); // ובחירה מחזירה אותו
    expect(readFileSync(lib.currentGameZipPath(dir), 'utf8')).toBe('ZIPDATA');
  });
});

describe('מחיקה', () => {
  it('★ מוחקת את החבילה ואת המטא', () => {
    download('12345');
    expect(lib.libraryDelete(dir, '12345')).toBe(true);
    expect(lib.libraryList(dir)).toEqual([]);
    expect(existsSync(lib.libraryZipPath(dir, '12345'))).toBe(false);
  });

  it('★ מחיקת המשחק הנוכחי מבטלת גם את הבחירה', () => {
    download('12345');
    lib.libraryDelete(dir, '12345');
    expect(lib.currentGameZipPath(dir)).toBe(lib.lastGameZipPath(dir));
    expect(existsSync(lib.lastGameMetaPath(dir))).toBe(false);
  });

  it('מחיקת משחק אחר אינה נוגעת בבחירה', () => {
    download('111');
    download('222'); // 222 נוכחי
    lib.libraryDelete(dir, '111');
    expect(lib.currentGameZipPath(dir)).toBe(lib.libraryZipPath(dir, '222'));
  });
});

/** תאימות אחורה: משחק שנטען מקובץ ZIP בדיסק אינו בספרייה, וחייב להמשיך לעבוד. */
describe('משחק שנטען מקובץ ZIP (בלי קוד)', () => {
  it('★ הנוכחי הוא הקובץ הישן, כמו קודם', () => {
    writeFileSync(lib.lastGameZipPath(dir), 'OLDZIP');
    writeFileSync(lib.lastGameMetaPath(dir), JSON.stringify({ name: 'מהדיסק' }));
    expect(lib.currentGameZipPath(dir)).toBe(lib.lastGameZipPath(dir));
  });

  it('מטא שמצביע על קוד שכבר נמחק נופל בחזרה לקובץ הישן', () => {
    writeFileSync(lib.lastGameZipPath(dir), 'OLDZIP');
    writeFileSync(lib.lastGameMetaPath(dir), JSON.stringify({ name: 'x', code: '404' }));
    expect(lib.currentGameZipPath(dir)).toBe(lib.lastGameZipPath(dir));
  });

  it('מטא פגום אינו מפיל דבר', () => {
    writeFileSync(lib.lastGameMetaPath(dir), 'not json');
    expect(lib.currentGameZipPath(dir)).toBe(lib.lastGameZipPath(dir));
    expect(lib.libraryList(dir)).toEqual([]);
  });
});
