/**
 * כמה זמן מעבר אוטומטי ממתין לקריין.
 *
 * במצב אוטומטי המעברים (חשיפת תשובה, פתיחת הצבעה, השקופית הבאה, המעבר האוטומטי
 * של שקופית, חשיפת מקום במסך המנצחים, וסגירת מסכי ההימור, «כל מי שענה נכון»
 * ו«תוצאת הדאבל») נדחים כל עוד הקריין עסוק, כדי לא לחתוך משפט באמצע או לדלג עליו.
 * **עסוק מתחיל ברגע שהוחלט לומר משפט**, ולא רק כשהקול מתחיל: קטעים שעוד יורדים
 * מהרשת (רשת איטית באולם, שקופית שקפצו אליה) לקחו יותר מהשנייה של המעבר, והמעבר
 * חשף את התשובה הבאה לפני שהשאלה נאמרה, ושוב, עד שרק התשובה האחרונה הוקראה.
 *
 * אבל אם קטע אף פעם לא נטען או לא מדווח שנגמר (אירוע ended שלא הגיע, הקשר אודיו
 * שנתקע), ההמתנה הייתה נמשכת לנצח והמשחק האוטומטי נעצר. לכן לכל משפט יש תקרה
 * (`NarrationBusy.until`): בזמן הטעינה NARRATION_LOAD_WAIT_MS, ומהרגע שהקטעים
 * משובצים, הסוף המתוכנן שלהם ועוד NARRATION_END_SLACK_MS. עד 2026-11 התקרה הייתה
 * 15 שניות קבועות מתחילת הקול, ומשפט ארוך יותר (פתיח + «שאלה מספר…» + שאלה ארוכה)
 * נחתך באמצע על ידי התשובה הראשונה.
 */

/** כמה זמן ממתינים לטעינת משפט (הקטעים יורדים מהרשת) לפני שממשיכים בלעדיו. */
export const NARRATION_LOAD_WAIT_MS = 5_000;

/** כמה ממתינים אחרי הסוף המתוכנן של משפט, כשאירוע הסיום שלו לא הגיע. */
export const NARRATION_END_SLACK_MS = 2_000;

/**
 * הקריין עסוק: טוען משפט או אומר אותו. `until` = עד מתי (Date.now) לכל היותר
 * ממתינים לו; בסיום הרגיל הוא חוזר ל-null לפני כן.
 */
export interface NarrationBusy {
  until: number;
}

/** כמה זמן, לכל היותר, הקריין עוד צריך (מילישניות). 0 = שקט. */
export function narratorWaitMs(busy: NarrationBusy | null, now: number): number {
  if (busy === null) return 0;
  return Math.max(1, Math.ceil(busy.until - now));
}

/**
 * ההשהיה בפועל של מעבר אוטומטי: `normalMs` כשהקריין שקט; כשהוא עסוק — לפחות
 * הזמן שהוא עוד צריך (`narratorWaitMs`), וכשהוא מסיים האפקט רץ שוב עם ההשהיה
 * הרגילה.
 */
export function narrationSafeDelayMs(normalMs: number, narratorWait: number): number {
  return narratorWait > 0 ? Math.max(normalMs, narratorWait) : normalMs;
}

/** סגירת מסך תוצאות ההימור: ההשהיה של "השקופית הבאה" ועוד שתי שניות. */
export function betResultsCloseDelayMs(nextSlideSeconds: number, narratorWait: number): number {
  return narrationSafeDelayMs(Math.max(1, nextSlideSeconds) * 1000 + 2000, narratorWait);
}
