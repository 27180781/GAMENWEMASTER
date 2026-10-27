/**
 * מי מופיע בפס שמתחת לשאלה בחשיפת התשובה הנכונה (פס המובילים של QuestionSlide).
 *
 * ברירת המחדל: עד 5 מהמהירים שצדקו, לפי סדר הגעה, בשמות בלבד.
 *
 * «הראשון שעונה מנצח» (setting.firstClicker): רק המצביע הראשון מנוקד, ורק אם
 * צדק — ולכן הפס מציג רק אותו, עם הנקודות שקיבל (גם בניקוד יורד, הערך שצלל
 * על המסך ברגע הלחיצה). אם הראשון טעה אף אחד לא זכה, והפס לא מוצג. עד
 * 2026-10 הפס הציג גם כאן חמישה שמות, כאילו כולם זכו (משוב: משחק בשלבים, נסים
 * 2026-10-27 — «אחרי כל שאלה מציגים מי ענתה וכמה נקודות קיבלה»).
 *
 * טהור, כדי שייבדק בנפרד מ-GameHost.
 */

export interface BoardEntry {
  id: string;
  /** הנקודות שהשקופית נתנה לו — רק בפס של «הראשון שעונה». */
  points?: number;
}

export const BOARD_MAX = 5;

export function revealBoard(
  firstClicker: boolean,
  firstClickWinner: string | undefined,
  awards: Readonly<Record<string, number>>,
  correctAnswerers: readonly string[],
): BoardEntry[] {
  if (!firstClicker) return correctAnswerers.slice(0, BOARD_MAX).map((id) => ({ id }));
  if (firstClickWinner === undefined) return [];
  const points = awards[firstClickWinner] ?? 0;
  return points > 0 ? [{ id: firstClickWinner, points }] : [];
}
