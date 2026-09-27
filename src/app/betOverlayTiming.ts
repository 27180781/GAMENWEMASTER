/**
 * מתי מסך תוצאות ההימור נסגר לבד במעבר אוטומטי.
 *
 * הזמן הרגיל (ההשהיה של "השקופית הבאה" ועוד שתי שניות) נספר רק אחרי שהקריין
 * סיים, כדי שהסגירה לא תחתוך את סוף המשפט. אבל אם קטע קריינות אף פעם לא מדווח
 * שנגמר (אירוע ended שלא הגיע, הקשר אודיו שנתקע) — המסך נשאר למעלה לנצח
 * והמשחק האוטומטי נעצר. לכן בזמן שהקריין "מדבר" יש תקרה: אחרי
 * BET_NARRATION_SAFETY_MS ממשיכים בכל מקרה. משפטי התוצאות קצרים בהרבה מזה.
 */

/** תקרת ההמתנה לקריין במסך תוצאות ההימור. */
export const BET_NARRATION_SAFETY_MS = 15_000;

export function betResultsCloseDelayMs(nextSlideSeconds: number, narratorSpeaking: boolean): number {
  const normal = Math.max(1, nextSlideSeconds) * 1000 + 2000;
  return narratorSpeaking ? Math.max(normal, BET_NARRATION_SAFETY_MS) : normal;
}
