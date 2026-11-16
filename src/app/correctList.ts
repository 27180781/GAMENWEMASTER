/**
 * «כל מי שענה נכון» (setting.showAllCorrect) — צעד נוסף ברווח אחרי חשיפת
 * התשובה הנכונה: מסך עם השמות של כל מי שצדק בשאלה, לפי סדר המהירות (הראשון
 * שענה נכון ראשון). הפס שמתחת לשאלה מציג רק את חמשת הראשונים (revealBoard.ts),
 * ולקוח ביקש לראות את כולם (בקשת נסים 2026-11-16).
 *
 * כבוי כברירת מחדל: רק `true` בקובץ מדליק, וכל קובץ קיים מתנהג בדיוק כמו קודם.
 * הלוגיקה טהורה כדי שתיבדק בנפרד מ-GameHost.
 */

import { marksCorrectAnswer, type GlobalSettings, type Slide } from '../engine/index.ts';

/** כמה שורות בכל עמודה, ועד כמה עמודות בעמוד. */
export const CORRECT_LIST_ROWS = 8;
export const CORRECT_LIST_MAX_COLS = 5;
export const CORRECT_LIST_PER_PAGE = CORRECT_LIST_ROWS * CORRECT_LIST_MAX_COLS;
/** כמה זמן מוצג כל עמוד כשיש יותר שמות מעמוד אחד (העמודים מתחלפים לבד). */
export const CORRECT_LIST_PAGE_MS = 6000;

/**
 * האם לשקופית הזאת יש צעד «כל מי שענה נכון»: ההגדרה דלוקה, השקופית מסמנת
 * תשובה נכונה (טריוויה, בחירה מרובה, תשובה בתמונה עם תשובה נכונה, וגם «הרוב
 * קובע» אחרי ההכרעה), ולא «הראשון שעונה מנצח» — שם רק אחד זוכה, והפס שמתחת
 * לשאלה כבר מציג אותו עם הנקודות.
 */
export function correctListApplies(setting: Pick<GlobalSettings, 'showAllCorrect'>, slide: Slide): boolean {
  if (setting.showAllCorrect !== true) return false;
  if (slide.type === 'bet') return false;
  if (slide.setting.firstClicker) return false;
  return marksCorrectAnswer(slide) && slide.question.answers.some((a) => a.correct);
}

/**
 * מי ענה נכון, לפי סדר המהירות.
 *
 * `arrival` — סדר ההגעה של המצביעים כפי שהמסך ראה אותם (המהיר ראשון). `votes`
 * — ההצבעות שהמנוע רשם לשקופית (voterId → answerId), והן הקובעות מי צדק:
 * עם שינוי הצבעה נספרת זו שנרשמה, וב«הרוב קובע» התשובה הנכונה נקבעת רק
 * בסגירה, ולכן אי אפשר לסמן «צדק» בזמן ההגעה. מי שהמנוע רשם ואינו ב-`arrival`
 * (אחרי רענון או שחזור מגיבוי) נוסף בסוף, כי הסדר שלו לא ידוע. משתתף שהוסר
 * מהמשחק לא מוצג.
 */
export function correctListOrder(
  arrival: readonly string[],
  votes: Readonly<Record<string, number>>,
  correctIds: ReadonlySet<number>,
  removed: ReadonlySet<string> = new Set(),
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const take = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const answer = votes[id];
    if (answer === undefined || !correctIds.has(answer) || removed.has(id)) return;
    out.push(id);
  };
  for (const id of arrival) take(id);
  for (const id of Object.keys(votes)) take(id);
  return out;
}

export interface CorrectListLayout {
  /** עמודות בעמוד (1–5). */
  cols: number;
  /** שורות בכל עמודה. */
  rows: number;
  /** כמה עמודים (לפחות 1). */
  pages: number;
}

/**
 * פריסת השמות: עמודות של 8 מלמעלה למטה, עד 5 עמודות (40 בעמוד). רשימה קצרה
 * נשארת בעמודה אחת קצרה ובאותיות גדולות, ומעל 40 העמודים מתחלפים לבד.
 */
export function correctListLayout(count: number): CorrectListLayout {
  const n = Math.max(0, Math.floor(count));
  const cols = Math.min(CORRECT_LIST_MAX_COLS, Math.max(1, Math.ceil(n / CORRECT_LIST_ROWS)));
  const rows = cols === 1 ? Math.max(1, Math.min(CORRECT_LIST_ROWS, n)) : CORRECT_LIST_ROWS;
  const pages = Math.max(1, Math.ceil(n / CORRECT_LIST_PER_PAGE));
  return { cols, rows, pages };
}

/**
 * במעבר אוטומטי: אחרי כמה זמן המסך נסגר לבד. לפחות ההשהיה הרגילה, ולפחות
 * עמוד שלם לכל עמוד, כדי שרשימה ארוכה תוצג עד סופה.
 */
export function correctListCloseDelayMs(baseMs: number, count: number): number {
  return Math.max(baseMs, correctListLayout(count).pages * CORRECT_LIST_PAGE_MS);
}
