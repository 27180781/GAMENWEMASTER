/**
 * שלט מנחה: מזהה מצביע (קליקר / מספר טלפון) שההקשות שלו הן פקודות מנחה
 * ולא הצבעות. הפונקציה מפרידה את הקשת המנחה מה-snapshot ומנקה אותה מכל
 * השדות — המנחה לעולם לא משתתף בהצבעה ולא נספר.
 *
 * פקודות המנחה (זהות גם במקלדת בזמן משחק):
 *   1 — הצגת מסך מנצחים / חזרה ממנו
 *   2 — שקופית אחת אחורה
 *   3 — סאונד מחיאות כפיים
 *   4 — הוספת 10 שניות לטיימר הפעיל
 *   5 — החסרת 10 שניות מהטיימר הפעיל
 *   6 — עצירת הטיימר וההצבעה / המשך
 */

import type { VoteSnapshot } from '../engine/index.ts';

export interface HostExtraction {
  /** ה-snapshot אחרי ניקוי הקשת המנחה (או המקורי אם המנחה לא הופיע). */
  snapshot: VoteSnapshot;
  /** ההקשה של המנחה (answerId) או null אם לא הופיעה. */
  hostAnswer: number | null;
}

export function extractHostVote(snapshot: VoteSnapshot, hostVoterId: string): HostExtraction {
  if (hostVoterId === '' || !snapshot.voters || !(hostVoterId in snapshot.voters)) {
    return { snapshot, hostAnswer: null };
  }

  const hostAnswer = snapshot.voters[hostVoterId]!;

  const voters = { ...snapshot.voters };
  delete voters[hostVoterId];

  const counts = { ...snapshot.counts };
  const key = String(hostAnswer);
  const count = counts[key];
  if (count !== undefined) {
    if (count <= 1) delete counts[key];
    else counts[key] = count - 1;
  }

  const cleaned: VoteSnapshot = {
    ...snapshot,
    voters,
    counts,
    total: Math.max(0, snapshot.total - 1),
  };
  if (snapshot.firstVoter === hostVoterId) {
    delete cleaned.firstVoter;
  }
  return { snapshot: cleaned, hostAnswer };
}
