/**
 * שאלה שנוסחה תמונה (queMode) — הפורמט שמערכת יצירת המשחקים מייצרת:
 *
 *   "question": { "que": "", "queMode": "image", "src": "https://…/x.jpg", … }
 */

import { describe, expect, it } from 'vitest';
import {
  IMAGE_QUESTION_LABEL,
  isImageQuestion,
  questionLabel,
  questionMode,
  showsSideImage,
} from '../src/engine/questionMode.ts';
import { slideSchema } from '../src/engine/schema.ts';

const q = (over: Record<string, unknown> = {}) => ({ que: '', src: '', ...over });

/** שקופית מלאה כפי שהיא מגיעה בקובץ — לבדיקת הסכימה עצמה. */
const slide = (question: Record<string, unknown>) => ({
  id: 1,
  type: 'trivia',
  question: {
    que: '',
    scoreForQue: 10,
    timeForQue: 20,
    answers: [
      { ans: 'א', correct: true, id: 1 },
      { ans: 'ב', correct: false, id: 2 },
    ],
    src: '',
    ...question,
  },
  openMedia: { src: '' },
  endMedia: { src: '' },
  backgroundMedia: { src: '' },
  setting: {
    allowChangeVote: false, slideStartVoting: true, playAfterClicking: false, exitGame: false,
    correctlyAnsweredBefore: false, firstClicker: false, answerIsSequenceClicks: false,
    fullscreen: false, scoringReduction: { active: false, seconds: '', score: '' },
    slidBackgroundMedia: { src: '' }, automaticSkip: { active: false, seconds: '' },
    showInLoop: false,
  },
});

describe('questionMode', () => {
  it('★ הפורמט של מערכת יצירת המשחקים — que ריק + queMode image + src', () => {
    const question = q({ que: '', queMode: 'image', src: 'https://x/questions/7/a.jpg' });
    expect(questionMode(question)).toBe('image');
    expect(isImageQuestion(question)).toBe(true);
  });

  it('בלי queMode — טקסט, בדיוק כמו כל הקבצים שנוצרו עד עכשיו', () => {
    expect(questionMode(q({ que: 'מהי בירת ישראל?' }))).toBe('text');
    // גם כשיש תמונת שאלה לצד הטקסט — זו מדיה, לא נוסח השאלה.
    expect(questionMode(q({ que: 'שאלה', src: 'https://x/a.jpg' }))).toBe('text');
  });

  it('★ סומן תמונה אבל אין src — נופלים לטקסט ולא מציירים מלבן ריק על המקרן', () => {
    expect(questionMode(q({ que: 'גיבוי', queMode: 'image', src: '' }))).toBe('text');
    expect(questionMode(q({ que: '', queMode: 'image', src: '   ' }))).toBe('text');
  });

  it('ערך queMode לא מוכר נחשב טקסט ואינו מפיל דבר', () => {
    expect(questionMode(q({ que: 'ש', queMode: 'video', src: 'https://x/a.jpg' }))).toBe('text');
    expect(questionMode(q({ que: 'ש', queMode: '' }))).toBe('text');
  });
});

describe('showsSideImage — לא מציגים את אותה תמונה פעמיים', () => {
  it('★ בשאלת תמונה אין כרטיס מדיה בצד', () => {
    expect(showsSideImage(q({ queMode: 'image', src: 'https://x/a.jpg' }))).toBe(false);
  });

  it('בשאלת טקסט עם תמונה — הכרטיס בצד מוצג כרגיל', () => {
    expect(showsSideImage(q({ que: 'שאלה', src: 'https://x/a.jpg' }))).toBe(true);
  });

  it('בלי תמונה בכלל — אין כרטיס', () => {
    expect(showsSideImage(q({ que: 'שאלה' }))).toBe(false);
  });
});

describe('questionLabel — רשימות, תפריט המפעיל ודוח התוצאות', () => {
  it('★ שאלת תמונה מקבלת תווית ולא נשארת ריקה', () => {
    // בלי זה כל שאלות התמונה היו נראות "(ללא כותרת)" ברשימה, ובדוח היה תא ריק.
    expect(questionLabel(q({ que: '', queMode: 'image', src: 'https://x/a.jpg' }))).toBe(
      IMAGE_QUESTION_LABEL,
    );
  });

  it('שאלת טקסט מחזירה את הנוסח כמו שהוא, כולל שורות חדשות', () => {
    expect(questionLabel(q({ que: 'שורה א\nשורה ב' }))).toBe('שורה א\nשורה ב');
  });

  it('טקסט ריק נופל לברירת המחדל שנמסרה', () => {
    expect(questionLabel(q({ que: '   ' }), '(ללא כותרת)')).toBe('(ללא כותרת)');
    expect(questionLabel(q({ que: '' }))).toBe('');
  });
});

describe('הסכימה מקבלת את הפורמט החדש', () => {
  it('★ שקופית עם queMode:image נטענת', () => {
    const parsed = slideSchema.safeParse(
      slide({ que: '', queMode: 'image', src: 'https://x/questions/7/a.jpg' }),
    );
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.question.queMode).toBe('image');
  });

  it('★ קובץ ישן בלי השדה נטען, ומקבל queMode: text', () => {
    const parsed = slideSchema.safeParse(slide({ que: 'שאלה רגילה' }));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.question.queMode).toBe('text');
  });

  it('★ ערך לא מוכר אינו פוסל את הקובץ — הוא רק מוצג כטקסט', () => {
    // דווקא זו הסיבה ש-queMode הוא z.string ולא z.enum: ערך שהמערכת החיצונית
    // תוסיף בעתיד לא יפיל משחק שלם בטעינה.
    const parsed = slideSchema.safeParse(slide({ que: 'ש', queMode: 'gif' }));
    expect(parsed.success).toBe(true);
    expect(parsed.success && questionMode(parsed.data.question)).toBe('text');
  });

  it('שאלת תמונה עוברת גם את דרישת התשובות של טריוויה', () => {
    const parsed = slideSchema.safeParse(
      slide({ que: '', queMode: 'image', src: 'https://x/a.jpg' }),
    );
    expect(parsed.success).toBe(true);
  });
});
