/**
 * מי מותר לו להתעדכן אוטומטית. ההגנה הקריטית כאן היא ש-EXE של משחק סגור
 * *לעולם* לא יתעדכן: העדכון כותב קובץ חדש במקום הישן, וזה היה מוחק את המשחק
 * המוטבע בסופו — כישלון שקט שמתגלה רק כשהמשחק כבר לא נפתח.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { canAutoUpdate } = require('../electron/updateGate.cjs') as {
  canAutoUpdate: (ctx: { packaged: boolean; sealed: boolean; portable: boolean }) => boolean;
};

const INSTALLED = { packaged: true, sealed: false, portable: false };

describe('canAutoUpdate', () => {
  it('גרסת ההתקנה מתעדכנת', () => {
    expect(canAutoUpdate(INSTALLED)).toBe(true);
  });

  it('EXE של משחק סגור לעולם לא מתעדכן', () => {
    expect(canAutoUpdate({ ...INSTALLED, sealed: true })).toBe(false);
    // גם אם הוא נייד וגם אם לא — החתימה גוברת בכל מקרה
    expect(canAutoUpdate({ packaged: true, sealed: true, portable: true })).toBe(false);
  });

  it('הגרסה הניידת לא מתעדכנת (electron-updater אינו תומך ב-portable)', () => {
    expect(canAutoUpdate({ ...INSTALLED, portable: true })).toBe(false);
  });

  it('בסביבת פיתוח אין עדכון', () => {
    expect(canAutoUpdate({ ...INSTALLED, packaged: false })).toBe(false);
    expect(canAutoUpdate({ packaged: false, sealed: false, portable: false })).toBe(false);
  });

  it('רק צירוף אחד בדיוק מחזיר true — כל השאר false', () => {
    const combos = [true, false].flatMap((packaged) =>
      [true, false].flatMap((sealed) =>
        [true, false].map((portable) => ({ packaged, sealed, portable })),
      ),
    );
    const allowed = combos.filter((c) => canAutoUpdate(c));
    expect(allowed).toEqual([INSTALLED]);
  });
});
