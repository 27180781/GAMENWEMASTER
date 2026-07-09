/**
 * "קהל סינתטי" ל-M2: מייצר תוכנית הצבעות מזויפת לשקופית ומרכיב ממנה
 * VoteSnapshots מצטברים לאורך חלון ההצבעה — דרך ReplayAdapter, בלי שרת.
 * הפונקציות טהורות (PRNG עם seed) כדי שיהיו ניתנות לבדיקה.
 */

import type { Slide, VoteSnapshot } from '../engine/index.ts';

export interface PlannedVote {
  voterId: string;
  answerId: number;
  /** מתי ההצבעה "נשלחת", ב-ms מפתיחת החלון. */
  atOffsetMs: number;
}

/** PRNG דטרמיניסטי קטן (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CrowdOptions {
  voterCount?: number;
  seed?: number;
  /** הסתברות לבחור בתשובה הנכונה ב-trivia (ברירת מחדל 0.55). */
  correctBias?: number;
}

/** תוכנית הצבעות אקראית-דטרמיניסטית לשקופית. */
export function planCrowdVotes(slide: Slide, options: CrowdOptions = {}): PlannedVote[] {
  const { voterCount = 40, seed = slide.id * 7919 + 17, correctBias = 0.55 } = options;
  const answers = slide.question.answers;
  if (answers.length === 0) return [];

  const random = mulberry32(seed);
  const windowMs = Math.max(2000, slide.question.timeForQue * 1000);
  const correct = answers.find((a) => a.correct);

  const plan: PlannedVote[] = [];
  for (let i = 1; i <= voterCount; i++) {
    let answerId: number;
    if (slide.type === 'trivia' && correct && random() < correctBias) {
      answerId = correct.id;
    } else {
      const pick = answers[Math.floor(random() * answers.length)];
      answerId = (pick ?? answers[0]!).id;
    }
    plan.push({
      voterId: `משתתף ${i}`,
      answerId,
      atOffsetMs: Math.floor(500 + random() * (windowMs - 1000)),
    });
  }
  return plan.sort((a, b) => a.atOffsetMs - b.atOffsetMs);
}

/** ה-snapshot המצטבר של התוכנית בזמן נתון מפתיחת החלון. */
export function snapshotAt(
  plan: PlannedVote[],
  slideId: number,
  elapsedMs: number,
  seq: number,
): VoteSnapshot {
  const counts: Record<string, number> = {};
  const voters: Record<string, number> = {};
  let firstVoter: string | undefined;
  for (const vote of plan) {
    if (vote.atOffsetMs > elapsedMs) break; // התוכנית ממוינת לפי זמן
    if (firstVoter === undefined) firstVoter = vote.voterId;
    voters[vote.voterId] = vote.answerId;
    counts[String(vote.answerId)] = (counts[String(vote.answerId)] ?? 0) + 1;
  }
  return {
    seq,
    slideId,
    counts,
    total: Object.keys(voters).length,
    voters,
    ...(firstVoter !== undefined ? { firstVoter } : {}),
  };
}
