/**
 * כמה זמן מעבר אוטומטי ממתין לקריין.
 *
 * במצב אוטומטי המעברים (חשיפת תשובה, פתיחת הצבעה, השקופית הבאה, סגירת מסך
 * תוצאות ההימור) נדחים כל עוד הקריין מדבר, כדי לא לחתוך משפט באמצע. אבל אם
 * קטע קריינות אף פעם לא מדווח שנגמר (אירוע ended שלא הגיע, הקשר אודיו שנתקע)
 * — ההמתנה הייתה נמשכת לנצח והמשחק האוטומטי נעצר. לכן בזמן שהקריין "מדבר"
 * יש תקרה: אחרי NARRATION_SAFETY_MS ממשיכים בכל מקרה. משפטי הקריין קצרים
 * בהרבה מזה.
 */

/** תקרת ההמתנה לקריין לפני מעבר אוטומטי. */
export const NARRATION_SAFETY_MS = 15_000;

/**
 * ההשהיה בפועל של מעבר אוטומטי: `normalMs` כשהקריין שקט; כשהוא מדבר —
 * לפחות NARRATION_SAFETY_MS (וכשהוא מסיים, האפקט רץ שוב עם ההשהיה הרגילה).
 */
export function narrationSafeDelayMs(normalMs: number, narratorSpeaking: boolean): number {
  return narratorSpeaking ? Math.max(normalMs, NARRATION_SAFETY_MS) : normalMs;
}

/** סגירת מסך תוצאות ההימור: ההשהיה של "השקופית הבאה" ועוד שתי שניות. */
export function betResultsCloseDelayMs(nextSlideSeconds: number, narratorSpeaking: boolean): number {
  return narrationSafeDelayMs(Math.max(1, nextSlideSeconds) * 1000 + 2000, narratorSpeaking);
}
