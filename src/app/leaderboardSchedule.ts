/**
 * תזמון טבלת המובילים האוטומטית (setting.showWinnersListAfter) — פעם בכל N
 * שאלות (שקופיות מצביעות) שהושלמו, מציגים אוטומטית את טבלת המובילים באמצע
 * המשחק. הלוגיקה טהורה כדי שתהיה ניתנת לבדיקה בנפרד מ-GameHost.
 */

import { isVotableSlide, type GameFile } from '../engine/index.ts';

/** כמה שאלות (שקופיות מצביעות) כבר הושלמו, לפי slidesCompleted מהמנוע. */
export function completedQuestionCount(game: GameFile, slidesCompleted: number[]): number {
  const done = new Set(slidesCompleted);
  // הימור מצביע אבל אינו שאלה — לא מזיז את הספירה.
  return game.questions.filter((q) => isVotableSlide(q) && q.type !== 'bet' && done.has(q.id)).length;
}

/**
 * האם להציג עכשיו את טבלת המובילים האוטומטית: הפיצ'ר דלוק (showAfter מספר חיובי)
 * ומספר השאלות שהושלמו הוא כפולה חיובית של showAfter. null/0/שלילי = מכובה.
 */
export function shouldShowLeaderboard(completedQuestions: number, showAfter: number | null): boolean {
  if (showAfter === null || showAfter <= 0) return false;
  return completedQuestions > 0 && completedQuestions % showAfter === 0;
}

/**
 * הצעד של הטבלה האוטומטית כשמספר השאלות שהושלמו משתנה. `handled` = הספירה
 * הגבוהה ביותר שכבר טופלה (הוצגה או שלא הייתה נקודת טבלה). הטבלה נפתחת רק
 * כשהספירה עוברת אותה: חזרה (Backspace, קפיצה) מוציאה שאלה מ"הושלמו", וכשהיא
 * מושלמת שוב הטבלה של הנקודה הזאת כבר הוצגה. בלי זה היא נפתחה שוב מעל השאלה
 * שחזרו אליה.
 */
export function autoLeaderboardStep(
  handled: number,
  completedQuestions: number,
  showAfter: number | null,
): { handled: number; show: boolean } {
  if (completedQuestions <= handled) return { handled, show: false };
  return {
    handled: completedQuestions,
    show: shouldShowLeaderboard(completedQuestions, showAfter),
  };
}
