/**
 * תזמון טבלת המובילים האוטומטית (setting.showWinnersListAfter) — פעם בכל N
 * שאלות (שקופיות מצביעות) שהושלמו, מציגים אוטומטית את טבלת המובילים באמצע
 * המשחק. הלוגיקה טהורה כדי שתהיה ניתנת לבדיקה בנפרד מ-GameHost.
 */

import { isVotableSlide, type GameFile } from '../engine/index.ts';

/** כמה שאלות (שקופיות מצביעות) כבר הושלמו, לפי slidesCompleted מהמנוע. */
export function completedQuestionCount(game: GameFile, slidesCompleted: number[]): number {
  const done = new Set(slidesCompleted);
  return game.questions.filter((q) => isVotableSlide(q) && done.has(q.id)).length;
}

/**
 * האם להציג עכשיו את טבלת המובילים האוטומטית: הפיצ'ר דלוק (showAfter מספר חיובי)
 * ומספר השאלות שהושלמו הוא כפולה חיובית של showAfter. null/0/שלילי = מכובה.
 */
export function shouldShowLeaderboard(completedQuestions: number, showAfter: number | null): boolean {
  if (showAfter === null || showAfter <= 0) return false;
  return completedQuestions > 0 && completedQuestions % showAfter === 0;
}
