/**
 * "הרוב קובע" (setting.majorityDecides) — שאלה בלי תשובה נכונה מראש.
 *
 * בסגירת ההצבעה התשובה שקיבלה הכי הרבה קולות נעשית הנכונה — ובתיקו, כל
 * התשובות שבראש. ההכרעה נכתבת אל דגלי `correct` של השקופית עצמה, כך שכל מי
 * שקורא אותם — ניקוד, חשיפה, "ענו נכון קודם", הימור, גיבוי, דוח, לוח הסולמות —
 * רואה את התשובה שנקבעה בלי לדעת שהיא נקבעה בזמן אמת. המנוע שומר את ההכרעה
 * גם ב-state (`majorityBySlide`) ומחיל אותה מחדש אחרי שחזור ורענון תוכן.
 */

import type { Slide } from './schema.ts';

/** האם השקופית מכריעה את התשובה לפי הרוב (רק שקופיות שמנוקדות כמו טריוויה). */
export function usesMajority(slide: Slide): boolean {
  return slide.setting.majorityDecides && (slide.type === 'trivia' || slide.type === 'ans_images');
}

/**
 * מזהי התשובות שקיבלו הכי הרבה קולות (ממוינים). בלי הצבעות — רשימה ריקה
 * (אין נכונה, איש לא מקבל ניקוד). `validIds` מסנן הצבעות על כפתור שאינו תשובה.
 */
export function majorityAnswerIds(
  votes: Readonly<Record<string, number>>,
  validIds?: ReadonlySet<number>,
): number[] {
  const counts = new Map<number, number>();
  for (const answerId of Object.values(votes)) {
    if (validIds !== undefined && !validIds.has(answerId)) continue;
    counts.set(answerId, (counts.get(answerId) ?? 0) + 1);
  }
  let max = 0;
  for (const count of counts.values()) if (count > max) max = count;
  if (max === 0) return [];
  return [...counts.entries()]
    .filter(([, count]) => count === max)
    .map(([id]) => id)
    .sort((a, b) => a - b);
}

/** מחיל את ההכרעה על השקופית (in place) — הדגלים הם מקור האמת לכל השרשרת. */
export function applyMajority(slide: Slide, winners: readonly number[]): void {
  const set = new Set(winners);
  for (const answer of slide.question.answers) answer.correct = set.has(answer.id);
}
