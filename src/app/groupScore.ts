/**
 * ניקוד קבוצתי — פונקציות טהורות שמשלבות את ניקוד השחקנים (מהמנוע) עם שיוכי
 * הקבוצות (מהמרשם). הניקוד הקבוצתי נקבע לפי *ממוצע* חברי הקבוצה, כך שקבוצה
 * קטנה וקבוצה גדולה מתחרות בהוגנות (לפי אחוזים ולא לפי סך הכול). שובר-שוויון:
 * מהירות התגובה הממוצעת — מהיר יותר עדיף.
 */

import type { RosterData } from './roster.ts';

export type AnswerTimes = Record<string, { totalMs: number; count: number }>;

export interface GroupStanding {
  groupId: string;
  name: string;
  /** מספר הקבוצה בקטגוריה (1-based, לפי הסדר). */
  number: number;
  memberCount: number;
  totalScore: number;
  /** totalScore / memberCount — הבסיס לדירוג ההוגן (0 אם אין חברים). */
  avgScore: number;
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
    const avgScore = members.length > 0 ? totalScore / members.length : 0;
    const answered = members
      .map((m) => avgResponseMs(answerTimes, m))
      .filter((ms) => Number.isFinite(ms));
    const avgMs =
      answered.length > 0 ? answered.reduce((a, b) => a + b, 0) / answered.length : Number.POSITIVE_INFINITY;
    return { groupId: g.id, name: g.name, number: i + 1, memberCount: members.length, totalScore, avgScore, avgMs };
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
