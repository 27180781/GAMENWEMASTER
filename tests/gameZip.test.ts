/**
 * בחירת קובץ המשחק בצד ה-main (שמירת עריכה) והמרת מחרוזות ב-JSON.
 *
 * הכלל חייב להתאים לזה שבצד ה-renderer: בחירה שגויה בשמירה הייתה *דורסת את
 * המניפסט* במקום את קובץ המשחק — נזק שקט שמתגלה רק בפתיחה הבאה.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { findGameEntryName, mapStrings } = require('../electron/gameZip.cjs') as {
  findGameEntryName: (names: string[]) => string | null;
  mapStrings: (v: unknown, f: (s: string) => string) => unknown;
};

describe('findGameEntryName', () => {
  it('חבילת השרת: game.json ולא manifest.json, גם כשהמניפסט ראשון', () => {
    expect(findGameEntryName(['manifest.json', 'game.json', 'Assets/a.jpg'])).toBe('game.json');
  });

  it('data.json גובר על game.json', () => {
    expect(findGameEntryName(['game.json', 'data.json'])).toBe('data.json');
  });

  it('שם JSON אחר נתמך, וקובצי עזר לעולם לא נבחרים', () => {
    expect(findGameEntryName(['manifest.json', 'trivia.json'])).toBe('trivia.json');
    expect(findGameEntryName(['manifest.json', 'package.json', 'meta.json'])).toBeNull();
  });

  it('נמצא גם בתוך תיקייה, ותיקיות עצמן לא נבחרות', () => {
    expect(findGameEntryName(['pack/', 'pack/manifest.json', 'pack/data.json'])).toBe('pack/data.json');
  });

  it('אין JSON כלל → null', () => {
    expect(findGameEntryName(['Assets/a.jpg', 'readme.txt'])).toBeNull();
  });
});

describe('mapStrings', () => {
  it('מחליף מחרוזות בכל עומק — כולל מערכים ושדות עתידיים', () => {
    const src = {
      a: 'x',
      nested: { b: 'x', keep: 7, flag: true, nil: null },
      list: ['x', { c: 'x' }, 3],
    };
    const out = mapStrings(src, (s) => (s === 'x' ? 'y' : s));
    expect(out).toEqual({
      a: 'y',
      nested: { b: 'y', keep: 7, flag: true, nil: null },
      list: ['y', { c: 'y' }, 3],
    });
  });

  it('אינו משנה את המקור', () => {
    const src = { a: 'x' };
    mapStrings(src, () => 'y');
    expect(src.a).toBe('x');
  });

  it('ערכים שאינם מחרוזת נשארים כמו שהם', () => {
    expect(mapStrings(5, () => 'y')).toBe(5);
    expect(mapStrings(null, () => 'y')).toBe(null);
  });
});
