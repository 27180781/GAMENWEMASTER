/**
 * חשיפה הדרגתית של תמונת השאלה (`setting.imageReveal`) — «מה יש בתמונה?».
 *
 * תמונת השאלה (`question.src`, בשני מצבי ההצגה: לצד הטקסט או במקומו) מוצגת
 * מטושטשת ב-`blur` פיקסלים כל עוד ההצבעה לא נפתחה, מתבהרת **ברציפות** לאורך
 * זמן המענה (`timeForQue`) וחדה לגמרי כשההצבעה נסגרת. לצד `descendingScore`
 * מתקבל המשחק הקלאסי: מי שמזהה את התמונה כשהיא עוד מרוחה מקבל הכי הרבה.
 *
 * הזמן הוא אותו שעון של הניקוד היורד (TimerView.elapsedMs — אפקטיבי, בלי
 * עצירות מנחה, לפי `timeForQue` ולא לפי הארכות), כך שהבהירות של התמונה
 * והמספר שעל המסך תמיד מספרים את אותו סיפור. טהור (בלי React/DOM).
 */

import type { Slide } from './schema.ts';
import type { GamePhase } from './types.ts';

/** ברירת המחדל של עוצמת הטשטוש (px על במה של 1920) — כמו בעורך של הבנאי. */
export const DEFAULT_IMAGE_REVEAL_BLUR = 48;

/**
 * הגדרת החשיפה של שקופית, מוכנה לשימוש — או null כשהיא כבויה או כשאין תמונת
 * שאלה לטשטש (קובץ שסומן בלי `src` פשוט מציג טקסט, כמו תמיד).
 */
export function imageRevealOf(slide: Slide): { blur: number; durationMs: number } | null {
  const r = slide.setting.imageReveal;
  if (!r.active || r.blur <= 0) return null;
  if (slide.question.src.trim() === '') return null;
  return { blur: r.blur, durationMs: slide.question.timeForQue * 1000 };
}

/**
 * הטשטוש (px) ברגע נתון בזמן ההצבעה: ‎maxBlur · (1 − elapsed / duration)‎,
 * לעולם לא מתחת לאפס. בלי טיימר (משך לא-חיובי) אין "לאורך הזמן" — התמונה חדה.
 */
export function imageRevealBlurAt(maxBlur: number, elapsedMs: number, durationMs: number): number {
  if (!Number.isFinite(maxBlur) || maxBlur <= 0) return 0;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  return maxBlur * Math.max(0, 1 - elapsed / durationMs);
}

/**
 * הטשטוש לפי שלב השקופית:
 *   • showing — מלא: המנחה קורא את השאלה וחושף תשובות, ואיש עוד לא רואה.
 *   • voting — לפי הזמן שחלף; בלי דגימת זמן (הפריים הראשון) — עדיין מלא.
 *   • results / ended — אפס: החשיפה.
 */
export function imageRevealBlurFor(
  phase: GamePhase,
  maxBlur: number,
  elapsedMs: number | null,
  durationMs: number,
): number {
  if (phase === 'showing') return Math.max(0, maxBlur);
  if (phase === 'voting') {
    return elapsedMs === null ? Math.max(0, maxBlur) : imageRevealBlurAt(maxBlur, elapsedMs, durationMs);
  }
  return 0;
}
