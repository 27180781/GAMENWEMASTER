/**
 * קליטה חכמה: שלטים נקלטים בלחיצה, שמות נקשרים אליהם לפי הסדר — משני הכיוונים.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_ROSTER,
  addPendingNames,
  captureRemote,
  clearPendingNames,
  displayName,
  ensureGroupByName,
  playerGroupNames,
  removePendingName,
  type RosterData,
} from '../src/app/roster.ts';

const CAT = 'קבוצות';

describe('captureRemote', () => {
  it('לחיצה ראשונה קולטת את השלט; בלי שמות ברשימה הוא ממתין לשיוך', () => {
    const res = captureRemote(EMPTY_ROSTER, '317', CAT);
    expect(res.isNew).toBe(true);
    expect(res.id).toBe('317');
    expect(res.name).toBe(''); // ★ "ממתין לשיוך"
    expect(res.roster.players).toEqual([{ id: '317', name: '' }]);
  });

  it('לחיצה חוזרת על אותו שלט אינה מוסיפה אותו שוב — רק מציגה מי הוא', () => {
    const first = captureRemote(EMPTY_ROSTER, '317', CAT);
    const named = addPendingNames(first.roster, [{ name: 'דנה', group: '' }], CAT);
    const again = captureRemote(named, '317', CAT);
    expect(again.isNew).toBe(false);
    expect(again.name).toBe('דנה');
    expect(again.roster.players).toHaveLength(1);
    expect(again.roster).toBe(named); // בלי שינוי מיותר במצב
  });

  it('שמות ברשימה מראש — כל לחיצה תופסת את הבא בתור', () => {
    let r: RosterData = addPendingNames(
      EMPTY_ROSTER,
      [
        { name: 'אבי', group: '' },
        { name: 'בני', group: '' },
      ],
      CAT,
    );
    const a = captureRemote(r, '101', CAT);
    expect(a.name).toBe('אבי');
    r = a.roster;
    const b = captureRemote(r, '102', CAT);
    expect(b.name).toBe('בני');
    r = b.roster;
    // נגמרו השמות — השלט הבא ממתין לשיוך
    const c = captureRemote(r, '103', CAT);
    expect(c.name).toBe('');
    expect(c.roster.pendingNames).toEqual([]);
    expect(displayName(c.roster, '101')).toBe('אבי');
    expect(displayName(c.roster, '103')).toBe('103'); // בלי שם — המספר עצמו
  });

  it('הכיוון ההפוך: קודם לוחצים, אחר כך מוסיפים שמות — והשיבוץ לפי הסדר', () => {
    let r = EMPTY_ROSTER;
    for (const id of ['201', '202', '203']) r = captureRemote(r, id, CAT).roster;
    expect(r.players.every((p) => p.name === '')).toBe(true);

    r = addPendingNames(
      r,
      [
        { name: 'גל', group: '' },
        { name: 'דור', group: '' },
      ],
      CAT,
    );
    expect(r.players.map((p) => p.name)).toEqual(['גל', 'דור', '']); // ★ לפי הסדר
    expect(r.pendingNames).toEqual([]);

    // שם נוסף משלים את האחרון
    r = addPendingNames(r, [{ name: 'הדר', group: '' }], CAT);
    expect(r.players.map((p) => p.name)).toEqual(['גל', 'דור', 'הדר']);
  });

  it('עודף שמות ממתין ללחיצות הבאות', () => {
    let r = captureRemote(EMPTY_ROSTER, '301', CAT).roster;
    r = addPendingNames(
      r,
      [
        { name: 'א', group: '' },
        { name: 'ב', group: '' },
        { name: 'ג', group: '' },
      ],
      CAT,
    );
    expect(r.players.map((p) => p.name)).toEqual(['א']);
    expect(r.pendingNames.map((p) => p.name)).toEqual(['ב', 'ג']);
    const next = captureRemote(r, '302', CAT);
    expect(next.name).toBe('ב');
    expect(next.roster.pendingNames.map((p) => p.name)).toEqual(['ג']);
  });

  it('שם עם קבוצה — נוצרת קטגוריה וקבוצה, והשחקן משויך', () => {
    let r = captureRemote(EMPTY_ROSTER, '401', CAT).roster;
    r = addPendingNames(r, [{ name: 'יעל', group: 'ירושלים' }], 'עיר');
    expect(r.players).toEqual([{ id: '401', name: 'יעל' }]);
    const cat = r.categories.find((c) => c.name === 'עיר');
    expect(cat?.groups.map((g) => g.name)).toEqual(['ירושלים']);
    expect(playerGroupNames(r, '401')).toEqual(['ירושלים']);
  });

  it('מספר ריק אינו נקלט', () => {
    const res = captureRemote(EMPTY_ROSTER, '   ', CAT);
    expect(res.roster.players).toEqual([]);
    expect(res.isNew).toBe(false);
  });
});

describe('ensureGroupByName', () => {
  it('אינו יוצר כפילויות — אותה קטגוריה ואותה קבוצה חוזרות', () => {
    const a = ensureGroupByName(EMPTY_ROSTER, 'עיר', 'חיפה');
    const b = ensureGroupByName(a.roster, 'עיר ', ' חיפה');
    expect(b.categoryId).toBe(a.categoryId);
    expect(b.groupId).toBe(a.groupId);
    expect(b.roster.categories).toHaveLength(1);
    expect(b.roster.categories[0]?.groups).toHaveLength(1);
  });
});

describe('ניהול השמות הממתינים', () => {
  it('מחיקה לפי מיקום וניקוי הכול', () => {
    const r = addPendingNames(
      EMPTY_ROSTER,
      [
        { name: 'א', group: '' },
        { name: 'ב', group: '' },
        { name: 'ג', group: '' },
      ],
      CAT,
    );
    expect(removePendingName(r, 1).pendingNames.map((p) => p.name)).toEqual(['א', 'ג']);
    expect(removePendingName(r, 9)).toBe(r); // מחוץ לטווח — בלי שינוי
    expect(clearPendingNames(r).pendingNames).toEqual([]);
  });

  it('שמות ריקים נזרקים', () => {
    const r = addPendingNames(EMPTY_ROSTER, [{ name: '  ', group: 'x' }], CAT);
    expect(r.pendingNames).toEqual([]);
  });
});
