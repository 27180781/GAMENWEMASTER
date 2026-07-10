/**
 * בדיקות למרשם השחקנים (roster.ts) — שמות, קטגוריות, קבוצות ושיוכים.
 * הפעולות אימיוטביליות; בודקים גם ניקוי שיוכים במחיקת קטגוריה/קבוצה/שחקן.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_ROSTER,
  addCategory,
  addGroup,
  assignGroup,
  changePlayerId,
  displayName,
  groupOf,
  normalizeRoster,
  removeCategory,
  removeGroup,
  removePlayer,
  upsertPlayer,
  type RosterData,
} from '../src/app/roster.ts';

describe('שמות שחקנים', () => {
  it('displayName מחזיר את השם אם הוגדר, אחרת את המספר', () => {
    let r: RosterData = EMPTY_ROSTER;
    r = upsertPlayer(r, '0501234567', 'משה');
    expect(displayName(r, '0501234567')).toBe('משה');
    expect(displayName(r, '0509999999')).toBe('0509999999'); // אין שם → המספר
  });

  it('upsertPlayer מעדכן שם קיים ולא יוצר כפילות', () => {
    let r = upsertPlayer(EMPTY_ROSTER, '12', 'א');
    r = upsertPlayer(r, '12', 'ב');
    expect(r.players).toHaveLength(1);
    expect(r.players[0]!.name).toBe('ב');
  });

  it('upsertPlayer מתעלם ממספר ריק', () => {
    expect(upsertPlayer(EMPTY_ROSTER, '   ', 'x').players).toHaveLength(0);
  });

  it('changePlayerId ממפה מחדש את השיוכים ולא דורס מספר תפוס', () => {
    let r = upsertPlayer(EMPTY_ROSTER, '5', 'דנה');
    r = addCategory(r, 'עיר', 'cat1');
    r = addGroup(r, 'cat1', 'ירושלים', 'g1');
    r = assignGroup(r, '5', 'cat1', 'g1');

    r = changePlayerId(r, '5', '7');
    expect(r.players[0]!.id).toBe('7');
    expect(groupOf(r, '7', 'cat1')).toBe('g1'); // השיוך עבר יחד עם המספר
    expect(r.memberships['5']).toBeUndefined();

    // מספר תפוס — לא משנים
    r = upsertPlayer(r, '9', 'רון');
    const before = r;
    r = changePlayerId(r, '7', '9');
    expect(r).toBe(before);
  });

  it('removePlayer מסיר גם את השיוכים שלו', () => {
    let r = upsertPlayer(EMPTY_ROSTER, '5', 'דנה');
    r = addCategory(r, 'עיר', 'cat1');
    r = assignGroup(r, '5', 'cat1', 'g1');
    r = removePlayer(r, '5');
    expect(r.players).toHaveLength(0);
    expect(r.memberships['5']).toBeUndefined();
  });
});

describe('קטגוריות וקבוצות', () => {
  const base = (): RosterData => {
    let r = upsertPlayer(EMPTY_ROSTER, '1', 'א');
    r = addCategory(r, 'עיר', 'cat1');
    r = addGroup(r, 'cat1', 'ירושלים', 'g1');
    r = addGroup(r, 'cat1', 'תל אביב', 'g2');
    r = addCategory(r, 'משקפיים', 'cat2');
    r = addGroup(r, 'cat2', 'מרכיב', 'g3');
    return r;
  };

  it('שחקן יכול להשתייך לקבוצה בכמה קטגוריות במקביל', () => {
    let r = base();
    r = assignGroup(r, '1', 'cat1', 'g1'); // ירושלים
    r = assignGroup(r, '1', 'cat2', 'g3'); // מרכיב משקפיים
    expect(groupOf(r, '1', 'cat1')).toBe('g1');
    expect(groupOf(r, '1', 'cat2')).toBe('g3');
  });

  it('assignGroup עם ערך ריק מסיר את השיוך באותה קטגוריה בלבד', () => {
    let r = base();
    r = assignGroup(r, '1', 'cat1', 'g1');
    r = assignGroup(r, '1', 'cat2', 'g3');
    r = assignGroup(r, '1', 'cat1', ''); // הסרה מ"עיר"
    expect(groupOf(r, '1', 'cat1')).toBe('');
    expect(groupOf(r, '1', 'cat2')).toBe('g3'); // השני נשאר
  });

  it('removeGroup מנקה שיוכים שהצביעו על אותה קבוצה', () => {
    let r = base();
    r = assignGroup(r, '1', 'cat1', 'g1');
    r = removeGroup(r, 'cat1', 'g1');
    expect(r.categories[0]!.groups.find((g) => g.id === 'g1')).toBeUndefined();
    expect(groupOf(r, '1', 'cat1')).toBe('');
  });

  it('removeCategory מוחק את הקטגוריה ואת כל השיוכים אליה', () => {
    let r = base();
    r = assignGroup(r, '1', 'cat1', 'g1');
    r = assignGroup(r, '1', 'cat2', 'g3');
    r = removeCategory(r, 'cat1');
    expect(r.categories).toHaveLength(1);
    expect(groupOf(r, '1', 'cat1')).toBe('');
    expect(groupOf(r, '1', 'cat2')).toBe('g3');
  });
});

describe('normalizeRoster — טעינה מ-JSON', () => {
  it('מנקה ערכים פגומים ושומר מבנה תקין', () => {
    const raw = {
      players: [{ id: 7, name: 'שרה' }, { id: '', name: 'ריק' }, 'זבל'],
      categories: [{ id: 'c', name: 'עיר', groups: [{ id: 'g', name: 'י-ם' }] }],
      memberships: { '7': { c: 'g', bad: '' } },
    };
    const r = normalizeRoster(raw);
    expect(r.players).toEqual([{ id: '7', name: 'שרה' }]); // id ריק ולא-אובייקט נזרקו
    expect(r.categories[0]!.groups[0]!.name).toBe('י-ם');
    expect(r.memberships['7']).toEqual({ c: 'g' }); // שיוך ריק נופה
  });

  it('קלט לא-אובייקט → מרשם ריק', () => {
    expect(normalizeRoster(null)).toEqual(EMPTY_ROSTER);
    expect(normalizeRoster('x')).toEqual(EMPTY_ROSTER);
  });
});
