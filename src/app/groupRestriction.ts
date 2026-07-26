/**
 * הגבלת שקופית לקבוצה אחת (setting.groupRestriction): רק משתתפים ששייכים
 * לקבוצה הנתונה יכולים להצביע בשקופית. הקשות של כל השאר נזרקות עוד לפני
 * שהן מגיעות למנוע — כך הן לא נספרות, לא מזכות בניקוד, ולא מופיעות בפירוט
 * ההצבעות. הניקוד הקיים של מי שלא משתתף **אינו משתנה** (הוא פשוט מדלג על
 * השאלה).
 *
 * שיוך המשתתף נקבע לפי המרשם: `groupName` שמגיע ב-`users` שבקובץ המשחק נכנס
 * לקטגוריה בשם המשחק, ולכן ההשוואה היא מול *כל* שמות הקבוצות של המשתתף (על
 * פני כל הקטגוריות). ההשוואה מתעלמת מרווחים מיותרים ומרישיות, כדי שהתאמה
 * לא תישבר בגלל הבדל הקלדה קטן.
 *
 * הפונקציות כאן טהורות — קלות לבדיקה, בלי תלות ב-React או ב-DOM.
 */

import type { Slide, VoteSnapshot } from '../engine/index.ts';
import { playerGroupNames, type RosterData } from './roster.ts';

/** שם הקבוצה שהשקופית מוגבלת אליה, או null אם אין הגבלה. */
export function slideGroupRestriction(slide: Slide): string | null {
  const r = slide.setting.groupRestriction;
  if (!r?.active) return null;
  const name = r.groupName.trim();
  return name === '' ? null : name;
}

/** נרמול שם קבוצה להשוואה סלחנית (רווחים/רישיות). */
const norm = (s: string) => s.trim().toLowerCase();

/** האם המשתתף שייך לקבוצה הנתונה (לפי המרשם). */
export function isInGroup(roster: RosterData, voterId: string, groupName: string): boolean {
  const target = norm(groupName);
  if (target === '') return true;
  return playerGroupNames(roster, voterId).some((g) => norm(g) === target);
}

/**
 * מסנן snapshot כך שיישארו בו רק מצביעים מהקבוצה המורשית, ומחשב מחדש את
 * המונים והסך. אם אין הגבלה — מחזיר את ה-snapshot כפי שהוא (בלי עותק מיותר).
 *
 * דורש `voters`: בלי מיפוי מצביע→תשובה אי אפשר לדעת מי הצביע על מה, ולכן
 * לא ניתן לסנן ביושר. במקרה כזה מחזירים snapshot ריק — עדיף לא לספור כלום
 * מאשר לספור הצבעות של קבוצה שאינה אמורה להשתתף.
 */
export function restrictSnapshotToGroup(
  snapshot: VoteSnapshot,
  roster: RosterData,
  groupName: string | null,
): VoteSnapshot {
  if (groupName === null) return snapshot;
  if (!snapshot.voters) {
    return { ...snapshot, counts: {}, total: 0, voters: {} };
  }

  const voters: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const [voterId, answerId] of Object.entries(snapshot.voters)) {
    if (!isInGroup(roster, voterId, groupName)) continue;
    voters[voterId] = answerId;
    const key = String(answerId);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  const out: VoteSnapshot = {
    ...snapshot,
    voters,
    counts,
    total: Object.keys(voters).length,
  };
  // "הראשון שלחץ" נשמר רק אם הוא עצמו מורשה.
  if (snapshot.firstVoter !== undefined && !(snapshot.firstVoter in voters)) {
    delete out.firstVoter;
  }
  return out;
}

/** מספר המשתתפים המורשים מתוך רשימת מחוברים — לחיווי "כמה הצביעו מתוך כמה". */
export function eligibleCount(
  roster: RosterData,
  connectedIds: string[],
  groupName: string | null,
): number {
  if (groupName === null) return connectedIds.length;
  return connectedIds.filter((id) => isInGroup(roster, id, groupName)).length;
}
