/**
 * מספר החיוג להצטרפות (setting.joinDial): מערכת יצירת המשחקים שולחת אותו מתוך
 * הגדרה אחת, כדי שהחלפת הקו לא תחכה לגרסת מנוע.
 *
 * מה שחשוב לנעול: משחק בלי השדה (כל קובץ ישן, חבילת אופליין, משחק שנבנה במחשב)
 * מציג את המספר הקבוע; ערך פגום לא מגיע למסך; השדה עובר את הטעינה ואינו פקד
 * בעורך; וקישור הצפייה מקבל את אותו מספר שהמסך הראשי מציג.
 */

import { describe, expect, it } from 'vitest';
import { parseGameFile } from '../src/engine/index.ts';
import { newGameFile } from '../src/app/newGame.ts';
import { JOIN_DIAL_DISPLAY, joinDialDisplay } from '../src/app/urlParams.ts';
import { HIDDEN_SETTINGS } from '../src/app/editorLayout.ts';

const base = newGameFile({ name: 'x', id: 'g', now: new Date('2026-11-11T08:00:00Z') });
const withDial = (joinDial: unknown) =>
  parseGameFile({ ...base, room: 5004, setting: { ...base.setting, joinDial } });

describe('joinDial', () => {
  it('המספר הקבוע הוא קו ה-1700', () => {
    expect(JOIN_DIAL_DISPLAY).toBe('1700-111-948');
  });

  it('עובר את הטעינה ומוצג כמו שנשלח', () => {
    const game = withDial('1700-222-333');
    expect(game.setting.joinDial).toBe('1700-222-333');
    expect(joinDialDisplay(game.setting.joinDial)).toBe('1700-222-333');
    expect(joinDialDisplay(' 03-123 4567 ')).toBe('03-123 4567');
  });

  it('חסר או פגום = המספר הקבוע, והקובץ עדיין נטען', () => {
    expect(joinDialDisplay(base.setting.joinDial)).toBe(JOIN_DIAL_DISPLAY);
    expect(withDial(42).setting.joinDial).toBeUndefined();
    for (const bad of ['', 'חייגו', '<b>1</b>', '123', '1-700', '1234567890123456', '-1700111948', null, 5]) {
      expect(joinDialDisplay(bad), String(bad)).toBe(JOIN_DIAL_DISPLAY);
    }
  });

  it('אינו פקד בעורך', () => {
    expect(HIDDEN_SETTINGS).toContain('joinDial');
  });
});
