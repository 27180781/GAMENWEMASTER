/**
 * תוקף החדר של משחק שהורד מהמערכת (setting.phonesUntil).
 *
 * מה שחשוב לנעול: החדר של רישיון טלפונים שפג חוזר למאגר וניתן ללקוח הבא,
 * ולכן אחרי התאריך אין הצבעה מהטלפון; קובץ בלי השדה (כל קובץ ישן, ומשחק
 * שנבנה במחשב) מתנהג בדיוק כמו קודם; והשדה עובר את הטעינה ואינו פקד בעורך.
 */

import { describe, expect, it } from 'vitest';
import { parseGameFile } from '../src/engine/index.ts';
import { newGameFile } from '../src/app/newGame.ts';
import { phonesExpired, phonesUntilText } from '../src/app/gameLicense.ts';
import { HIDDEN_SETTINGS } from '../src/app/editorLayout.ts';

const base = newGameFile({ name: 'x', id: 'g', now: new Date('2026-11-05T08:00:00Z') });
const withUntil = (until: unknown) =>
  parseGameFile({ ...base, room: 5004, setting: { ...base.setting, phonesUntil: until } });

describe('phonesUntil', () => {
  it('עובר את הטעינה כמו שנשלח', () => {
    expect(withUntil('2026-11-08T12:00:00.000Z').setting.phonesUntil).toBe(
      '2026-11-08T12:00:00.000Z',
    );
    expect(withUntil('2026-11-08T12:00:00.000Z').room).toBe('5004');
  });

  it('לפני התאריך הטלפונים פתוחים, ממנו והלאה סגורים', () => {
    const game = withUntil('2026-11-08T12:00:00.000Z');
    expect(phonesExpired(game, Date.parse('2026-11-08T11:59:59Z'))).toBe(false);
    expect(phonesExpired(game, Date.parse('2026-11-08T12:00:00Z'))).toBe(true);
    expect(phonesExpired(game, Date.parse('2027-01-01T00:00:00Z'))).toBe(true);
  });

  it('בלי השדה, או עם ערך שאינו תאריך — לא פג, כמו עד היום', () => {
    const later = Date.parse('2030-01-01T00:00:00Z');
    expect(phonesExpired(parseGameFile({ ...base, room: 5004 }), later)).toBe(false);
    expect(phonesExpired(withUntil(''), later)).toBe(false);
    expect(phonesExpired(withUntil('לא תאריך'), later)).toBe(false);
    expect(phonesExpired(withUntil(12345), later)).toBe(false);
  });

  it('התאריך לתצוגה בשעון ישראל', () => {
    const text = phonesUntilText(withUntil('2026-11-08T12:00:00.000Z'));
    expect(text).toContain('14:00');
    expect(text).toContain('8');
    expect(phonesUntilText(parseGameFile(base))).toBeNull();
  });

  it('אינו פקד בעורך', () => {
    expect(HIDDEN_SETTINGS).toContain('phonesUntil');
  });
});
