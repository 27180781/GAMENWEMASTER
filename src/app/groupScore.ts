/**
 * ניקוד קבוצתי — פונקציות טהורות שמשלבות את ניקוד השחקנים (מהמנוע) עם שיוכי
 * הקבוצות (מהמרשם). הניקוד הקבוצתי נקבע לפי *ממוצע* חברי הקבוצה, כך שקבוצה
 * קטנה וקבוצה גדולה מתחרות בהוגנות (לפי אחוזים ולא לפי סך הכול). שובר-שוויון:
 * מהירות התגובה הממוצעת — מהיר יותר עדיף.
 */

import type { RosterData } from './roster.ts';
import { groupBonusOf } from '../engine/scoreAdjust.ts';

export type AnswerTimes = Record<string, { totalMs: number; count: number }>;

export interface GroupStanding {
  groupId: string;
  name: string;
  /** מספר הקבוצה בקטגוריה (1-based, לפי הסדר). */
  number: number;
  memberCount: number;
  /** סכום הניקוד האישי של החברים — בלי הבונוס. */
  totalScore: number;
  /**
   * הניקוד שהקבוצה מדורגת לפיו: ממוצע החברים **ועוד הבונוס הידני**.
   *
   * הבונוס מתווסף לממוצע ולא לסכום — בדיוק בגלל הסיבה שבגללה מדרגים לפי
   * ממוצע מלכתחילה: "10 נקודות לקבוצה א" צריך להיות שווה בערכו בין אם יש בה
   * שני חברים או עשרים. חלוקה בסכום הייתה נותנת לקבוצה קטנה פי עשרה.
   */
  avgScore: number;
  /** הבונוס הידני שניתן לקבוצה (0 כשאין). מוצג בנפרד כדי שיהיה ברור מאיפה הניקוד. */
  bonus: number;
  /** מהירות הקבוצה: ממוצע זמני התגובה של החברים שענו (Infinity אם אף אחד לא ענה). */
  avgMs: number;
}

/** זמן תגובה ממוצע (ms) של מצביע — נמוך = מהיר; Infinity אם לא ענה כלל. */
export function avgResponseMs(answerTimes: AnswerTimes, voterId: string): number {
  const t = answerTimes[voterId];
  return t !== undefined && t.count > 0 ? t.totalMs / t.count : Number.POSITIVE_INFINITY;
}

/**
 * דירוג הקבוצות בקטגוריה — לפי ממוצע הניקוד של חברי הקבוצה, עם שובר-שוויון
 * לפי מהירות תגובה ממוצעת ואז לפי מספר הקבוצה (יציבות).
 */
export function groupStandings(
  roster: RosterData,
  categoryId: string,
  scores: Record<string, number>,
  answerTimes: AnswerTimes,
  /** בונוסים ידניים לקבוצות (ראו scoreAdjust.ts). חסר = אין בונוסים. */
  groupBonus?: Readonly<Record<string, number>>,
): GroupStanding[] {
  const category = roster.categories.find((c) => c.id === categoryId);
  if (!category) return [];

  const membersByGroup: Record<string, string[]> = {};
  for (const g of category.groups) membersByGroup[g.id] = [];
  for (const [playerId, byCat] of Object.entries(roster.memberships)) {
    const groupId = byCat[categoryId];
    if (groupId !== undefined && membersByGroup[groupId] !== undefined) {
      membersByGroup[groupId]!.push(playerId);
    }
  }

  const standings: GroupStanding[] = category.groups.map((g, i) => {
    const members = membersByGroup[g.id] ?? [];
    const totalScore = members.reduce((sum, m) => sum + (scores[m] ?? 0), 0);
    const base = members.length > 0 ? totalScore / members.length : 0;
    const bonus = groupBonusOf(groupBonus, g.id);
    // קנס שגדול מהניקוד לא מציג מספר שלילי על המסך הגדול — הוא נעצר באפס.
    // הבונוס עצמו נשמר כמו שהוא, כדי שהמנחה יראה בפאנל את מה שהזין.
    const avgScore = Math.max(0, base + bonus);
    const answered = members
      .map((m) => avgResponseMs(answerTimes, m))
      .filter((ms) => Number.isFinite(ms));
    const avgMs =
      answered.length > 0 ? answered.reduce((a, b) => a + b, 0) / answered.length : Number.POSITIVE_INFINITY;
    return {
      groupId: g.id,
      name: g.name,
      number: i + 1,
      memberCount: members.length,
      totalScore,
      avgScore,
      bonus,
      avgMs,
    };
  });

  standings.sort((a, b) => b.avgScore - a.avgScore || a.avgMs - b.avgMs || a.number - b.number);
  return standings;
}

/** יש דירוג קבוצתי להציג? (קטגוריה עם קבוצות + לפחות שיוך אחד). */
export function hasGroupData(roster: RosterData): boolean {
  return (
    roster.categories.some((c) => c.groups.length > 0) && Object.keys(roster.memberships).length > 0
  );
}

/** הקטגוריות שיש בהן קבוצות (הרלוונטיות לתצוגת דירוג הקבוצות). */
export function groupCategories(roster: RosterData) {
  return roster.categories.filter((c) => c.groups.length > 0);
}

export interface GroupMember {
  id: string;
  score: number;
  /** זמן תגובה ממוצע (ms) — שובר-שוויון, נמוך = מהיר. */
  avgMs: number;
}

/**
 * חברי קבוצה מסוימת בקטגוריה, ממוינים לפי ניקוד (שובר-שוויון: מהירות, ואז
 * מזהה ליציבות) — כדי להציג את המובילים בתוך הקבוצה עצמה.
 */
export function groupMembers(
  roster: RosterData,
  categoryId: string,
  groupId: string,
  scores: Record<string, number>,
  answerTimes: AnswerTimes,
): GroupMember[] {
  const out: GroupMember[] = [];
  for (const [playerId, byCat] of Object.entries(roster.memberships)) {
    if (byCat[categoryId] !== groupId) continue;
    out.push({ id: playerId, score: scores[playerId] ?? 0, avgMs: avgResponseMs(answerTimes, playerId) });
  }
  out.sort((a, b) => b.score - a.score || a.avgMs - b.avgMs || a.id.localeCompare(b.id));
  return out;
}
