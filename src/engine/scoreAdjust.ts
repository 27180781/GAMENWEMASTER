/**
 * תיקון ניקוד ידני באמצע משחק.
 *
 * למה זה קיים: עד כה הניקוד נגזר אך ורק מהתשובות, ולמנחה לא הייתה שום דרך
 * להתערב — שלט שלא נקלט, שאלה שהתבררה כשגויה, או בונוס שהוחלט במקום נשארו
 * בלי מענה. האפשרות היחידה שהייתה היא איפוס הניקוד של *כולם*.
 *
 * שני מסלולים נפרדים בכוונה:
 *   • משתתף — משנה את הניקוד האישי שלו במנוע.
 *   • קבוצה — בונוס **קבוצתי בלבד**, שאינו מתחלק בין החברים ואינו נוגע
 *     בניקוד האישי של אף אחד. כך "10 נקודות לקבוצה א" נשאר 10 נקודות
 *     לקבוצה, בין אם יש בה שני חברים או עשרים.
 *
 * טהור (בלי React) כדי שיהיה ניתן לבדיקה, ומשמש גם את הפאנל הצידי בתצוגה וגם
 * את מסך הניהול — שניהם קוראים לאותן פונקציות. יושב בשכבת המנוע כי שתי
 * הרשומות שהוא מטפל בהן הן נתוני ניקוד, והמנוע הוא שמחזיק אותם.
 */

/** תקרת תיקון בודד — שומרת מפני הקלדה מוטעית (למשל 1000 במקום 10). */
export const MAX_ADJUST = 1000;

/** מנרמל קלט מהמשתמש למספר שלם בטווח המותר. ‎0‎ = אין מה לעשות. */
export function normalizeDelta(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (!Number.isFinite(n)) return 0;
  const whole = Math.trunc(n);
  return Math.max(-MAX_ADJUST, Math.min(MAX_ADJUST, whole));
}

/**
 * שינוי הניקוד האישי של משתתף.
 *
 * לא יורדים מתחת לאפס: מסך המנצחים והמובילים מציגים את המספר כמו שהוא, וניקוד
 * שלילי על המסך הגדול נראה כתקלה. הפחתה גדולה מהניקוד הקיים מאפסת אותו.
 */
export function adjustPlayerScore(
  scores: Readonly<Record<string, number>>,
  voterId: string,
  delta: number,
): Record<string, number> {
  const d = normalizeDelta(delta);
  if (voterId === '' || d === 0) return { ...scores };
  return { ...scores, [voterId]: Math.max(0, (scores[voterId] ?? 0) + d) };
}

/**
 * שינוי הבונוס הקבוצתי. הערך עשוי להיות שלילי (קנס לקבוצה) — הקיזוז מול
 * הניקוד בפועל נעשה בדירוג עצמו (ראו groupScore.ts), כדי שהמנחה יראה כאן את
 * מה שהוא באמת הזין ולא מספר שנחתך בשקט.
 *
 * בונוס שחזר לאפס נמחק מהרשומה, כדי שלא יישאר "בונוס 0" שנראה כמו הגדרה.
 */
export function adjustGroupBonus(
  bonus: Readonly<Record<string, number>>,
  groupId: string,
  delta: number,
): Record<string, number> {
  const d = normalizeDelta(delta);
  if (groupId === '' || d === 0) return { ...bonus };
  const next = { ...bonus };
  const sum = (next[groupId] ?? 0) + d;
  if (sum === 0) delete next[groupId];
  else next[groupId] = sum;
  return next;
}

/** הבונוס של קבוצה (0 כשאין). */
export function groupBonusOf(bonus: Readonly<Record<string, number>> | undefined, groupId: string): number {
  const v = bonus?.[groupId];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
