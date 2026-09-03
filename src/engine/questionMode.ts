/**
 * נוסח השאלה: טקסט או תמונה.
 *
 * מערכת יצירת המשחקים מאפשרת להחליף את נוסח השאלה בתמונה. בקובץ זה נראה כך:
 *
 *   "question": { "que": "", "queMode": "image", "src": "https://…/x.jpg", … }
 *
 * כלומר ‎src‎ — שהוא ממילא שדה תמונת השאלה — מפסיק להיות מדיה *לצד* השאלה
 * והופך להיות **השאלה עצמה**. התשובות, הזמן והניקוד אינם משתנים.
 *
 * טהור (בלי React) כדי שיהיה ניתן לבדיקת יחידה, ומשמש גם בתצוגה, גם ברשימות
 * ובתפריטים וגם בדוח — כך שכולם מסכימים מה "כותרת" השקופית.
 */

export type QuestionMode = 'text' | 'image';

/** החלק מהשקופית שנוגע לנוסח השאלה. מוגדר רזה כדי שגם הדוח יוכל להשתמש בו. */
export interface QuestionLike {
  que: string;
  src: string;
  queMode?: string | undefined;
}

/** תווית ברירת מחדל לשאלת תמונה, במקומות שמציגים טקסט בלבד (רשימות, דוח). */
export const IMAGE_QUESTION_LABEL = 'שאלת תמונה';

/**
 * המצב בפועל.
 *
 * 'image' רק כשגם התבקש וגם **יש תמונה**: קובץ שסומן כתמונה אך הגיע בלי `src`
 * היה מצייר מלבן ריק על המקרן. נפילה לטקסט משאירה לפחות את מה שכן קיים.
 * כל ערך שאינו 'image' (כולל חסר או לא מוכר) הוא טקסט.
 */
export function questionMode(question: QuestionLike): QuestionMode {
  return question.queMode === 'image' && question.src.trim() !== '' ? 'image' : 'text';
}

/** האם להציג את התמונה במקום נוסח השאלה. */
export function isImageQuestion(question: QuestionLike): boolean {
  return questionMode(question) === 'image';
}

/**
 * האם להציג את `src` ככרטיס מדיה *לצד* השאלה. בשאלת תמונה — לא, כי אותה
 * תמונה כבר מוצגת כשאלה עצמה, וכפילות הייתה תופסת חצי מסך לחינם.
 */
export function showsSideImage(question: QuestionLike): boolean {
  return question.src !== '' && !isImageQuestion(question);
}

/**
 * טקסט מזהה לשקופית — לרשימות, לתפריט המפעיל ולדוח. בשאלת תמונה אין נוסח,
 * ובלי התווית הזו כל השאלות האלה היו נראות "(ללא כותרת)" ואי אפשר היה להבדיל
 * ביניהן.
 */
export function questionLabel(question: QuestionLike, fallback = ''): string {
  if (isImageQuestion(question)) return IMAGE_QUESTION_LABEL;
  const text = question.que.trim();
  return text !== '' ? question.que : fallback;
}
