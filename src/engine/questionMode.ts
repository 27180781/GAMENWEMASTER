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
 * הטקסט שמוצג **לשחקנים** על המסך הגדול.
 *
 * בשאלת תמונה אין טקסט: התמונה היא הנוסח. גם אם נשלח `que`, הוא שם פנימי
 * בלבד — ואסור שיגיע למקרן. מסך שמציג את זה חייב לצייר את התמונה במקומו.
 */
export function questionDisplayText(question: QuestionLike): string {
  return isImageQuestion(question) ? '' : question.que;
}

/**
 * טקסט מזהה לשקופית למסכים **הפנימיים** בלבד — רשימת השקופיות, תפריט המפעיל,
 * חיפוש ודוח התוצאות. עשוי להחזיר את השם הפנימי של שאלת תמונה, ולכן אין
 * להשתמש בו במה שהקהל רואה (שם: questionDisplayText).
 *
 * בלי התווית הזו כל שאלות התמונה היו נראות "(ללא כותרת)" ברשימה ובדוח.
 */
export function questionLabel(question: QuestionLike, fallback = ''): string {
  const text = question.que.trim();
  // בשאלת תמונה `que` אינו מוצג לשחקנים, אבל אם נשלח בכל זאת טקסט הוא משמש
  // כשם פנימי — שימושי בדוח ובחיפוש הרבה יותר מתווית גנרית. ריק = התווית.
  if (isImageQuestion(question)) return text !== '' ? question.que : IMAGE_QUESTION_LABEL;
  return text !== '' ? question.que : fallback;
}
