/**
 * בדיקות לניקוד הקבוצתי (groupScore.ts): דירוג לפי ממוצע החברים (הוגנות בין
 * קבוצה קטנה לגדולה) עם שובר-שוויון לפי מהירות תגובה ממוצעת.
 */

import { describe, expect, it } from 'vitest';
import {
  addCategory,
  addGroup,
  assignGroupByNumber,
  EMPTY_ROSTER,
  type RosterData,
} from '../src/app/roster.ts';
import {
  avgResponseMs,
  groupCategories,
  groupMembers,
  groupStandings,
  hasGroupData,
  type AnswerTimes,
} from '../src/app/groupScore.ts';

function twoGroupRoster(): RosterData {
  let r = addCategory(EMPTY_ROSTER, 'עיר', 'cat1');
  r = addGroup(r, 'cat1', 'קטנה', 'g1'); // מספר 1
  r = addGroup(r, 'cat1', 'גדולה', 'g2'); // מספר 2
  // קבוצה קטנה: 2 חברים, שניהם עם ניקוד גבוה
  r = assignGroupByNumber(r, 'a', 'cat1', 1);
  r = assignGroupByNumber(r, 'b', 'cat1', 1);
  // קבוצה גדולה: 4 חברים, ניקוד מעורב
  r = assignGroupByNumber(r, 'c', 'cat1', 2);
  r = assignGroupByNumber(r, 'd', 'cat1', 2);
  r = assignGroupByNumber(r, 'e', 'cat1', 2);
  r = assignGroupByNumber(r, 'f', 'cat1', 2);
  return r;
}

describe('ניקוד קבוצתי לפי ממוצע', () => {
  it('קבוצה קטנה עם ממוצע גבוה מנצחת קבוצה גדולה עם ממוצע נמוך (הוגנות)', () => {
    const r = twoGroupRoster();
    // קטנה: 10+10 → ממוצע 10. גדולה: 10+10+0+0 → סה"כ 20 (יותר!) אך ממוצע 5.
    const scores = { a: 10, b: 10, c: 10, d: 10, e: 0, f: 0 };
    const standings = groupStandings(r, 'cat1', scores, {});
    expect(standings[0]!.groupId).toBe('g1'); // הקטנה ראשונה למרות סך נמוך יותר
    expect(standings[0]!.avgScore).toBe(10);
    expect(standings[1]!.avgScore).toBe(5);
    expect(standings[1]!.totalScore).toBe(20); // סך גבוה יותר אך ממוצע נמוך
  });

  it('שובר-שוויון: כשהממוצע זהה, הקבוצה המהירה יותר מדורגת גבוה', () => {
    const r = twoGroupRoster();
    const scores = { a: 5, b: 5, c: 5, d: 5, e: 5, f: 5 }; // ממוצע 5 לשתיהן
    const times: AnswerTimes = {
      // קטנה איטית יותר (ממוצע 2000), גדולה מהירה (ממוצע 1000)
      a: { totalMs: 2000, count: 1 },
      b: { totalMs: 2000, count: 1 },
      c: { totalMs: 1000, count: 1 },
      d: { totalMs: 1000, count: 1 },
      e: { totalMs: 1000, count: 1 },
      f: { totalMs: 1000, count: 1 },
    };
    const standings = groupStandings(r, 'cat1', scores, times);
    expect(standings[0]!.groupId).toBe('g2'); // הגדולה המהירה ראשונה
    expect(standings[1]!.groupId).toBe('g1');
  });

  it('avgResponseMs מחזיר ממוצע, ו-Infinity למי שלא ענה', () => {
    const times: AnswerTimes = { x: { totalMs: 900, count: 3 } };
    expect(avgResponseMs(times, 'x')).toBe(300);
    expect(avgResponseMs(times, 'y')).toBe(Number.POSITIVE_INFINITY);
  });

  it('hasGroupData: false בלי קבוצות/שיוכים, true כשיש', () => {
    expect(hasGroupData(EMPTY_ROSTER)).toBe(false);
    let r = addCategory(EMPTY_ROSTER, 'עיר', 'cat1');
    r = addGroup(r, 'cat1', 'א', 'g1');
    expect(hasGroupData(r)).toBe(false); // יש קבוצה אבל אין שיוכים
    r = assignGroupByNumber(r, '1', 'cat1', 1);
    expect(hasGroupData(r)).toBe(true);
  });

  it('groupMembers: חברי הקבוצה ממוינים לפי ניקוד (המובילים ראשונים)', () => {
    const r = twoGroupRoster();
    const scores = { a: 3, b: 8, c: 5, d: 5, e: 1, f: 9 };
    // הקבוצה הגדולה (g2): c,d,e,f — לפי ניקוד: f(9),c(5),d(5),e(1)
    const members = groupMembers(r, 'cat1', 'g2', scores, {});
    expect(members.map((m) => m.id)).toEqual(['f', 'c', 'd', 'e']);
    expect(members[0]).toMatchObject({ id: 'f', score: 9 });
    // הקטנה (g1): b(8) לפני a(3)
    expect(groupMembers(r, 'cat1', 'g1', scores, {}).map((m) => m.id)).toEqual(['b', 'a']);
  });

  it('groupMembers: שובר-שוויון לפי מהירות כשהניקוד זהה', () => {
    const r = twoGroupRoster();
    const scores = { c: 5, d: 5, e: 5, f: 5 };
    const times: AnswerTimes = {
      c: { totalMs: 3000, count: 1 },
      d: { totalMs: 1000, count: 1 }, // המהיר ביותר
      e: { totalMs: 2000, count: 1 },
      // f לא ענה → Infinity → אחרון
    };
    expect(groupMembers(r, 'cat1', 'g2', scores, times).map((m) => m.id)).toEqual([
      'd',
      'e',
      'c',
      'f',
    ]);
  });

  it('groupCategories: רק קטגוריות שיש בהן קבוצות', () => {
    let r = addCategory(EMPTY_ROSTER, 'עם קבוצות', 'c1');
    r = addGroup(r, 'c1', 'א', 'g1');
    r = addCategory(r, 'ריקה', 'c2'); // בלי קבוצות
    expect(groupCategories(r).map((c) => c.id)).toEqual(['c1']);
  });
});
