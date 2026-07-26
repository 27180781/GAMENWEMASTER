/**
 * בדיקות להגבלת שקופית לקבוצה (groupRestriction): רק חברי הקבוצה מצביעים,
 * המונים מחושבים מחדש, והשאר פשוט מדלגים על השאלה (ניקוד לא נפגע).
 */
import { describe, expect, it } from 'vitest';
import {
  eligibleCount,
  isInGroup,
  restrictSnapshotToGroup,
  slideGroupRestriction,
} from '../src/app/groupRestriction.ts';
import { addCategory, addGroup, assignGroupByNumber, EMPTY_ROSTER } from '../src/app/roster.ts';
import { fourAnswers, makeGame, makeSnapshot, rawSlide } from './helpers.ts';

/** מרשם: קבוצה "אדום" (a,b) וקבוצה "כחול" (c,d); e ללא קבוצה. */
function roster() {
  let r = addCategory(EMPTY_ROSTER, 'צבע', 'cat1');
  r = addGroup(r, 'cat1', 'אדום', 'g1');
  r = addGroup(r, 'cat1', 'כחול', 'g2');
  r = assignGroupByNumber(r, 'a', 'cat1', 1);
  r = assignGroupByNumber(r, 'b', 'cat1', 1);
  r = assignGroupByNumber(r, 'c', 'cat1', 2);
  r = assignGroupByNumber(r, 'd', 'cat1', 2);
  return r;
}

/** שקופית עם/בלי הגבלת קבוצה. */
function slideWith(restriction?: { active: boolean; groupName: string }) {
  const settings = restriction ? { groupRestriction: restriction } : {};
  return makeGame([
    rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(2), scoreForQue: 3, settings }),
  ]).questions[0]!;
}

describe('slideGroupRestriction', () => {
  it('בלי השדה כלל — אין הגבלה (תאימות אחורה)', () => {
    expect(slideGroupRestriction(slideWith())).toBeNull();
  });
  it('active:false — אין הגבלה', () => {
    expect(slideGroupRestriction(slideWith({ active: false, groupName: 'אדום' }))).toBeNull();
  });
  it('active:true עם שם — מחזיר את שם הקבוצה', () => {
    expect(slideGroupRestriction(slideWith({ active: true, groupName: 'אדום' }))).toBe('אדום');
  });
  it('active:true בלי שם — אין הגבלה (לא חוסם את כולם בטעות)', () => {
    expect(slideGroupRestriction(slideWith({ active: true, groupName: '  ' }))).toBeNull();
  });
});

describe('isInGroup', () => {
  const r = roster();
  it('מזהה חברות לפי המרשם', () => {
    expect(isInGroup(r, 'a', 'אדום')).toBe(true);
    expect(isInGroup(r, 'c', 'אדום')).toBe(false);
    expect(isInGroup(r, 'e', 'אדום')).toBe(false); // ללא שיוך כלל
  });
  it('השוואה סלחנית לרווחים ולרישיות', () => {
    let r2 = addCategory(EMPTY_ROSTER, 'c', 'cat1');
    r2 = addGroup(r2, 'cat1', 'Red Team', 'g1');
    r2 = assignGroupByNumber(r2, 'x', 'cat1', 1);
    expect(isInGroup(r2, 'x', '  red team ')).toBe(true);
  });
});

describe('restrictSnapshotToGroup', () => {
  const r = roster();
  // a,b (אדום) בחרו 1 ו-2; c,d (כחול) בחרו 3; e (ללא קבוצה) בחר 4
  const snap = makeSnapshot(1, 1, { a: 1, b: 2, c: 3, d: 3, e: 4 }, 'c');

  it('בלי הגבלה — ה-snapshot חוזר כמו שהוא', () => {
    expect(restrictSnapshotToGroup(snap, r, null)).toBe(snap);
  });

  it('משאיר רק את חברי הקבוצה ומחשב מונים מחדש', () => {
    const out = restrictSnapshotToGroup(snap, r, 'אדום');
    expect(Object.keys(out.voters ?? {}).sort()).toEqual(['a', 'b']);
    expect(out.counts).toEqual({ '1': 1, '2': 1 });
    expect(out.total).toBe(2);
  });

  it('firstVoter נשמר רק אם הוא מורשה', () => {
    // c (כחול) היה הראשון — בהגבלה לאדום הוא יורד
    expect(restrictSnapshotToGroup(snap, r, 'אדום').firstVoter).toBeUndefined();
    // בהגבלה לכחול הוא נשאר
    expect(restrictSnapshotToGroup(snap, r, 'כחול').firstVoter).toBe('c');
  });

  it('אף אחד מהמורשים לא הצביע — snapshot ריק ותקין', () => {
    const out = restrictSnapshotToGroup(makeSnapshot(1, 1, { c: 3 }), r, 'אדום');
    expect(out.total).toBe(0);
    expect(out.counts).toEqual({});
    expect(out.voters).toEqual({});
  });

  it('בלי מיפוי מצביעים — לא סופרים כלום (עדיף מלספור קבוצה זרה)', () => {
    const noVoters = { seq: 1, slideId: 1, counts: { '1': 5 }, total: 5 };
    const out = restrictSnapshotToGroup(noVoters, r, 'אדום');
    expect(out.total).toBe(0);
    expect(out.counts).toEqual({});
  });

  it('לא משנה את ה-snapshot המקורי (אימוטבילי)', () => {
    const before = JSON.stringify(snap);
    restrictSnapshotToGroup(snap, r, 'אדום');
    expect(JSON.stringify(snap)).toBe(before);
  });
});

describe('eligibleCount', () => {
  const r = roster();
  it('בלי הגבלה — כל המחוברים', () => {
    expect(eligibleCount(r, ['a', 'b', 'c', 'd', 'e'], null)).toBe(5);
  });
  it('עם הגבלה — רק חברי הקבוצה', () => {
    expect(eligibleCount(r, ['a', 'b', 'c', 'd', 'e'], 'אדום')).toBe(2);
    expect(eligibleCount(r, ['a', 'b', 'c', 'd', 'e'], 'כחול')).toBe(2);
  });
});
