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
import { parseGameFile } from '../src/engine/loader.ts';

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

/**
 * ★ מה קורה כששולחים שדה שאיננו מכירים — למשל תמונה נוספת בשם שטרם סוכם.
 *
 * Zod מסנן מפתחות לא ידועים כברירת מחדל, והעורך המקומי שומר את האובייקט
 * ה*מפוענח* (JSON.stringify של הטיוטה). כלומר בלי passthrough, עצם הפתיחה של
 * המשחק בעורך ולחיצה על "שמור" הייתה **מוחקת מהקובץ לצמיתות** כל שדה שהמערכת
 * החיצונית הוסיפה. עדיף לשמור נתון שאיננו מציגים מאשר להשמיד אותו.
 */
describe('שדות שאיננו מכירים נשמרים', () => {
  const withExtras = () => {
    const s = slide({
      que: '',
      queMode: 'image',
      src: 'https://x/q.jpg',
      // שם מומצא בכוונה — הבדיקה היא על ההתנהגות, לא על שדה מסוים
      accompanyingImage: 'https://x/side.jpg',
    }) as Record<string, unknown>;
    s['authorNote'] = 'הערה של יוצר המשחק';
    return s;
  };

  it('★ שדה לא מוכר בתוך question שורד את הפענוח', () => {
    const parsed = slideSchema.parse(withExtras()) as { question: Record<string, unknown> };
    expect(parsed.question['accompanyingImage']).toBe('https://x/side.jpg');
  });

  it('★ שדה לא מוכר ברמת השקופית שורד גם הוא', () => {
    const parsed = slideSchema.parse(withExtras()) as Record<string, unknown>;
    expect(parsed['authorNote']).toBe('הערה של יוצר המשחק');
  });

  it('★ מחזור מלא: טעינה → שמירה (כמו בעורך) אינו מאבד את השדה', () => {
    const file = {
      id: 'g1',
      name: 'משחק',
      users: '{}',
      setting: {
        titleThroughoutGame: '', ansIsNumber: true, multiWinners: 1, winnersListCount: 5,
        mainColor: '#8B2FC9', secondaryColor: '#FFD23F',
        gameMedia: { src: '' }, logo: { src: '' }, triviaMedia: { src: '' },
        winnersMedia: { src: '' }, winnersListMedia: { src: '' },
        sound: {
          playersConnectingMediaSound: { src: null }, showQuestionMediaSound: { src: null },
          winnersMediaSound: { src: null }, winnersListMediaSound: { src: null },
          genericMediaSound: { src: null }, timerMediaSound: { src: null },
          inShowAnsMediaSound: { src: null },
        },
        limit: { type: 'clickers' },
      },
      questions: [withExtras()],
    };
    const loaded = parseGameFile(file);
    // בדיוק מה שהעורך המקומי שומר לדיסק
    const saved = JSON.parse(JSON.stringify(loaded)) as {
      questions: { question: Record<string, unknown> }[];
    };
    expect(saved.questions[0]?.question['accompanyingImage']).toBe('https://x/side.jpg');
  });
});

/**
 * "גם תמונה בתוך השאלה וגם תמונה שהיא השאלה" — בפורמט הנתון יש שדה תמונה
 * אחד (`question.src`), ולכן שתי התצוגות הן אותה תמונה ואי אפשר להתנגש.
 * מה שכן אפשר להציג יחד עם שאלת תמונה — ושנבדק כאן — הוא רקע השקופית ומדיה
 * שרצה לפניה, שהם שדות נפרדים לגמרי.
 */
describe('שאלת תמונה לצד מדיה אחרת של אותה שקופית', () => {
  it('★ תמונת השאלה אינה מוצגת גם ככרטיס בצד — זו אותה תמונה', () => {
    const question = q({ que: '', queMode: 'image', src: 'https://x/q.jpg' });
    expect(isImageQuestion(question)).toBe(true);
    expect(showsSideImage(question)).toBe(false);
  });

  it('רקע השקופית ומדיה שלפניה הם שדות נפרדים ואינם מושפעים', () => {
    const parsed = slideSchema.parse({
      ...slide({ que: '', queMode: 'image', src: 'https://x/q.jpg' }),
      openMedia: { src: 'https://x/before.mp4' },
      backgroundMedia: { src: 'https://x/bg.jpg' },
    });
    expect(parsed.question.src).toBe('https://x/q.jpg');
    expect(parsed.openMedia.src).toBe('https://x/before.mp4');
    expect(parsed.backgroundMedia.src).toBe('https://x/bg.jpg');
  });
});
