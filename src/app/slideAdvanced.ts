/**
 * "הגדרות שקופית מתקדמות" — החלון שנפתח בכפתור ⚙ ליד נוסח השאלה, בדיוק כמו
 * במערכת יצירת המשחקים.
 *
 * עד כה החלון הזה נגזר אוטומטית מסכימת ה-JSON, ולכן הציג *כל* מפתח שקיים
 * ב-`setting` — כולל שבעה שדות שהמנוע מקבל אך אינו פועל לפיהם (`slideStartVoting`,
 * `playAfterClicking`, `exitGame`, `answerIsSequenceClicks`, `fullscreen`,
 * `showInLoop`, `correctlyAnsweredBefore`). הם שרידים מהמערכת הישנה, לעורך
 * המקוון אין להם פקד, ומחבר משחק שהיה מזיז אותם לא היה רואה שום שינוי.
 *
 * לכן הרשימה כאן מוצהרת: **תשע** ההגדרות שהעורך המקוון מציע, בסדר שלו. השדות
 * האחרים ממשיכים להישמר בקובץ כרגיל — פשוט אין להם פקד, כמו באונליין.
 *
 * טהור (בלי React) כדי שיהיה ניתן לבדיקה.
 */

import type { Slide } from '../engine/index.ts';

export type AdvancedSetting =
  | 'multiCorrect'
  | 'groupRestriction'
  | 'allowChangeVote'
  | 'firstClicker'
  | 'automaticSkip'
  | 'slidBackgroundMedia'
  | 'scoringReduction'
  | 'descendingScore'
  | 'imageReveal';

/** הסדר שבו ההגדרות מוצגות בחלון — זהה לסדר שבעורך המקוון. */
const FULL: AdvancedSetting[] = [
  'multiCorrect',
  'groupRestriction',
  'allowChangeVote',
  'firstClicker',
  'automaticSkip',
  'slidBackgroundMedia',
  'scoringReduction',
  'descendingScore',
  'imageReveal',
];

/**
 * אילו הגדרות מוצגות לסוג שקופית נתון.
 *
 * • טריוויה — כל התשע.
 * • תשובה בתמונה — הכול חוץ מ"מספר תשובות נכונות" (המתג שלה יושב מעל רשימת
 *   התשובות, כמו באונליין). ניקוד יורד כן — היא מנוקדת כמו טריוויה כשסומנה
 *   בה תשובה נכונה (ראו scoring.ts); וגם חשיפה הדרגתית של תמונת השאלה.
 * • סקר — בלי "מספר תשובות נכונות", בלי ניקוד יורד ובלי חשיפה הדרגתית: אין בו
 *   תשובה נכונה, ומתג שלא עושה כלום הוא בדיוק מה שביקשנו להוציא מהחלון הזה.
 * • טקסט — רק רקע ספציפי; אין בה הצבעה.
 * • מדיה / פונקציה — אין חלון מתקדם בכלל.
 */
export function advancedSettingsFor(type: string): AdvancedSetting[] {
  if (type === 'trivia') return FULL;
  if (type === 'ans_images') return FULL.filter((s) => s !== 'multiCorrect');
  if (type === 'survey') {
    return FULL.filter((s) => s !== 'multiCorrect' && s !== 'descendingScore' && s !== 'imageReveal');
  }
  if (type === 'subject') return ['slidBackgroundMedia'];
  return [];
}

/** האם לשקופית יש חלון הגדרות מתקדמות. */
export function hasAdvancedSettings(type: string): boolean {
  return advancedSettingsFor(type).length > 0;
}

/** האם השקופית מסומנת כרגע כ"מספר תשובות נכונות" — כלומר יותר מאחת. */
export function isMultiCorrect(slide: Slide): boolean {
  return slide.question.answers.filter((a) => a.correct).length > 1;
}

/**
 * סימון/ביטול תשובה נכונה במצב "מספר תשובות נכונות".
 *
 * לא יורדים לאפס תשובות נכונות: שקופית טריוויה בלי אף תשובה נכונה נדחית בטעינה
 * (ראו slideSchema), כך שביטול האחרונה היה יוצר קובץ שאי אפשר לפתוח.
 */
export function toggleCorrect(slide: Slide, ansIndex: number): Slide {
  const answers = slide.question.answers.map((a, i) =>
    i === ansIndex ? { ...a, correct: !a.correct } : a,
  );
  if (!answers.some((a) => a.correct)) return slide;
  return { ...slide, question: { ...slide.question, answers } };
}

/**
 * כיבוי "מספר תשובות נכונות" — חוזרים לתשובה הנכונה הראשונה שהייתה מסומנת,
 * כמו בעורך המקוון. שקופית בלי אף תשובה נכונה מקבלת את הראשונה.
 */
export function collapseToSingleCorrect(slide: Slide): Slide {
  const first = slide.question.answers.findIndex((a) => a.correct);
  const keep = first === -1 ? 0 : first;
  const answers = slide.question.answers.map((a, i) => ({ ...a, correct: i === keep }));
  return { ...slide, question: { ...slide.question, answers } };
}

/**
 * שמות הקבוצות שאפשר לשייך אליהן שקופית — נאספים מהמשתתפים שבקובץ המשחק,
 * בדיוק כמו הבורר באונליין ("כל המשתתפים" = בלי הגבלה).
 */
export function gameGroupNames(users: { groupName: string }[]): string[] {
  const seen = new Set<string>();
  for (const u of users) {
    const name = u.groupName.trim();
    if (name !== '') seen.add(name);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, 'he'));
}
