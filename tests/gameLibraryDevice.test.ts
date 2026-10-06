/**
 * מה שהספרייה זוכרת בשביל משחקים שהמערכת שולחת למחשב (electron/gameLibrary.cjs):
 * איזה משחק בכל חבילה ובאיזו גרסה, מה נערך במחשב, ומה הורד ועוד לא נפתח.
 * ההבטחות: הורדה ברקע לא מחליפה את המשחק שהמפעיל בחר, ועותק שנערך במחשב
 * או שעל המסך לא נמחק.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
interface LibEntry {
  code: string;
  name: string;
  savedAt: number;
  local: boolean;
  gameId: string | null;
  version: string | null;
  editedAt: number;
  pendingOpen: boolean;
}
type StoreExtra = { local?: boolean; gameId?: string | null; version?: string; source?: string; pendingOpen?: boolean; select?: boolean };
const lib = require('../electron/gameLibrary.cjs') as {
  libraryZipPath: (dir: string, code: string) => string;
  libraryMetaPath: (dir: string, code: string) => string;
  libraryList: (dir: string) => LibEntry[];
  librarySelect: (dir: string, code: string) => boolean;
  libraryStore: (dir: string, code: string, name: string, extra?: StoreExtra) => boolean;
  currentCode: (dir: string) => string | null;
  forgetCurrent: (dir: string) => void;
  libraryMarkEdited: (dir: string) => boolean;
  libraryBackfill: (dir: string) => number;
  libraryDedupe: (dir: string, gameId: string, keepCode: string) => string[];
  readPackageInfo: (zipPath: string) => { gameId: string | null; version: string | null } | null;
};
const { writeStoreZip } = require('../electron/zipStore.cjs') as {
  writeStoreZip: (out: string, entries: { path: string; data?: Buffer | string }[]) => Promise<number>;
};

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gamelib-dev-'));
  mkdirSync(join(dir, 'games'), { recursive: true });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function put(code: string, extra: StoreExtra = {}) {
  writeFileSync(lib.libraryZipPath(dir, code), 'ZIP');
  expect(lib.libraryStore(dir, code, `משחק ${code}`, extra)).toBe(true);
}
const entry = (code: string) => lib.libraryList(dir).find((g) => g.code === code);

describe('רישום משחק שהגיע מהמערכת', () => {
  it('★ המזהה (באותיות קטנות), הגרסה ו"ממתין לפתיחה" נרשמים ומוצגים ברשימה', () => {
    put('100', { gameId: A.toUpperCase(), version: 'v1', source: 'device', pendingOpen: true, select: false });
    expect(entry('100')).toMatchObject({ gameId: A, version: 'v1', pendingOpen: true, editedAt: 0, local: false });
  });

  it('★ select:false — נרשם בלי להחליף את המשחק שהמפעיל בחר', () => {
    put('100');
    put('200', { gameId: A, version: 'v1', select: false });
    expect(lib.currentCode(dir)).toBe('100');
    expect(lib.libraryList(dir).map((g) => g.code).sort()).toEqual(['100', '200']);
  });

  it('★ פתיחה מנקה את "ממתין לפתיחה"', () => {
    put('100', { gameId: A, version: 'v1', pendingOpen: true, select: false });
    expect(lib.librarySelect(dir, '100')).toBe(true);
    expect(entry('100')?.pendingOpen).toBe(false);
    expect(entry('100')).toMatchObject({ gameId: A, version: 'v1' });
  });

  it('משחק שהורד בלי מזהה נרשם עם gameId: null — כך ההשלמה לא תחפש בו שוב', () => {
    put('100');
    expect(JSON.parse(readFileSync(lib.libraryMetaPath(dir, '100'), 'utf8'))).toHaveProperty('gameId', null);
  });

  it('משחק שנבנה במחשב אינו נושא מזהה של משחק מהמערכת', () => {
    put('local-1', { local: true, gameId: A });
    expect(entry('local-1')).toMatchObject({ local: true, gameId: null });
  });
});

describe('libraryMarkEdited', () => {
  it('★ שמירה בעורך מסמנת את המשחק הנוכחי כ"נערך במחשב"', () => {
    put('100', { gameId: A, version: 'v1' });
    expect(lib.libraryMarkEdited(dir)).toBe(true);
    expect(entry('100')?.editedAt).toBeGreaterThan(0);
    expect(entry('100')?.version).toBe('v1');
  });

  it('בלי משחק נוכחי — אין מה לסמן', () => {
    put('100');
    lib.forgetCurrent(dir);
    expect(lib.libraryMarkEdited(dir)).toBe(false);
  });
});

describe('readPackageInfo / libraryBackfill — משחקים שהורדו לפני הגרסה הזו', () => {
  async function oldDownload(code: string, data: unknown) {
    await writeStoreZip(lib.libraryZipPath(dir, code), [{ path: 'data.json', data: JSON.stringify(data) }]);
    // מטא כמו שגרסה קודמת כתבה — בלי gameId ובלי גרסה
    writeFileSync(lib.libraryMetaPath(dir, code), JSON.stringify({ code, name: `ישן ${code}`, savedAt: 5 }));
  }

  it('★ קורא את המשחק והגרסה מתוך data.json בחבילה', async () => {
    await oldDownload('100', { id: A.toUpperCase(), metadata: { version: 'v7' } });
    expect(lib.readPackageInfo(lib.libraryZipPath(dir, '100'))).toEqual({ gameId: A, version: 'v7' });
  });

  it('קובץ שאינו ZIP — null', () => {
    writeFileSync(lib.libraryZipPath(dir, 'bad'), 'not a zip');
    expect(lib.readPackageInfo(lib.libraryZipPath(dir, 'bad'))).toBeNull();
  });

  it('★ ההשלמה רושמת פעם אחת, ולא נוגעת במשחקים מקומיים', async () => {
    await oldDownload('100', { id: A, metadata: { version: 'v1' } });
    await oldDownload('200', { name: 'בלי מזהה' });
    put('local-1', { local: true });
    expect(lib.libraryBackfill(dir)).toBe(2);
    expect(entry('100')).toMatchObject({ gameId: A, version: 'v1', name: 'ישן 100' });
    expect(entry('200')).toMatchObject({ gameId: null, version: null });
    expect(lib.libraryBackfill(dir)).toBe(0);
    expect(entry('local-1')?.gameId).toBeNull();
  });
});

describe('libraryDedupe — עותקים ישנים של אותו משחק', () => {
  it('★ נמחקים אחרי שהגיע עותק חדש — חוץ מהנוכחי, מעותק שנערך ומשחק מקומי', () => {
    put('old-plain', { gameId: A, version: 'v1' });
    put('old-edited', { gameId: A, version: 'v1' });
    lib.libraryMarkEdited(dir); // old-edited הוא הנוכחי ונערך
    put('old-current', { gameId: A, version: 'v1' }); // עכשיו זה הנוכחי
    put('other-game', { gameId: B, version: 'v1', select: false });
    put('new', { gameId: A, version: 'v2', select: false });

    expect(lib.libraryDedupe(dir, A.toUpperCase(), 'new')).toEqual(['old-plain']);
    expect(lib.libraryList(dir).map((g) => g.code).sort()).toEqual(['new', 'old-current', 'old-edited', 'other-game']);
    expect(existsSync(lib.libraryZipPath(dir, 'old-plain'))).toBe(false);
  });

  it('בלי מזהה — לא מוחקים כלום', () => {
    put('100', { gameId: null });
    put('200', { gameId: null });
    expect(lib.libraryDedupe(dir, '', '200')).toEqual([]);
  });
});
