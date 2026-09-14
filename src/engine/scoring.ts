/**
 * כללי ניקוד משותפים למנוע ולתצוגה (SPEC סעיף 5.2).
 *
 * ניקוד יורד (`setting.descendingScore`): הניקוד לשאלה צולל **ברציפות** —
 * לא במדרגות — מ-`maxScore` לאפס לאורך זמן המענה (`timeForQue`), ומי שעונה
 * נכון מקבל את הערך שהיה על המסך ברגע הלחיצה. 1000 נקודות על 10 שניות =
 * 100 נקודות לשנייה. כשדולק הוא מחליף את `scoreForQue` ואת `scoringReduction`.
 *
 * הפונקציה כאן היא המקור היחיד לנוסחה: המנוע מנקד בה (gameEngine.ts) והשקופית
 * מציגה בה את המספר החי (QuestionSlide.tsx) — כך מה שרואים הוא מה שמקבלים.
 * טהור (בלי React/DOM) כדי שיהיה ניתן לבדיקה.
 */

import type { Slide } from './schema.ts';

/** ברירת המחדל של הניקוד המקסימלי — כמו בעורך של מערכת יצירת המשחקים. */
export const DEFAULT_DESCENDING_MAX_SCORE = 1000;

/**
 * הניקוד ברגע נתון: ‎maxScore · (1 − elapsed / duration)‎, מעוגל למספר שלם,
 * לעולם לא מתחת לאפס. משך לא-חיובי (אין טיימר) = ניקוד מלא כל הזמן.
 */
export function descendingScoreAt(maxScore: number, elapsedMs: number, durationMs: number): number {
  if (!Number.isFinite(maxScore) || maxScore <= 0) return 0;
  const max = Math.round(maxScore);
  if (!Number.isFinite(durationMs) || durationMs <= 0) return max;
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const fraction = Math.max(0, 1 - elapsed / durationMs);
  return Math.round(max * fraction);
}

/**
 * הגדרת הניקוד היורד של שקופית, מוכנה לשימוש — או null כשהוא כבוי.
 * `durationMs` הוא זמן המענה של השקופית; קצב הירידה נגזר ממנו ואינו משתנה
 * כשהמנחה מוסיף/מחסיר שניות לטיימר באמצע (הניקוד פשוט ממשיך לרדת באותו קצב).
 */
export function descendingScoreOf(slide: Slide): { maxScore: number; durationMs: number } | null {
  const d = slide.setting.descendingScore;
  if (!d.active || d.maxScore <= 0) return null;
  return { maxScore: d.maxScore, durationMs: slide.question.timeForQue * 1000 };
}

/**
 * האם השקופית מנוקדת "כמו טריוויה" — תשובה נכונה מזכה, שגויה לא.
 *
 * • trivia — תמיד.
 * • ans_images — רק כשהמחבר סימן תשובה נכונה: לפחות אחת `correct: true`
 *   **וגם** לפחות אחת שאינה. כך מערכת יצירת המשחקים שולחת כל שקופית
 *   «תשובה בתמונה» (העורך שלה דורש תשובה נכונה ומציג ניקוד), ועד כה היא
 *   הייתה שווה אפס במנוע. קבצים ישנים שבהם **כל** התמונות `correct: true`
 *   («בחירה חופשית») נשארים כפי שהיו — ניקוד השתתפות מאחורי קונפיג, כמו סקר.
 */
export function scoredLikeTrivia(slide: Slide): boolean {
  if (slide.type === 'trivia') return true;
  if (slide.type !== 'ans_images') return false;
  const answers = slide.question.answers;
  return answers.some((a) => a.correct) && answers.some((a) => !a.correct);
}
