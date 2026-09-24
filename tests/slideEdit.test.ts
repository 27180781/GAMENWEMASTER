/**
 * בדיקות לפעולות עריכת השקופיות הטהורות (slideEdit.ts): הזזה, מחיקה, שכפול,
 * הוספה, עריכת תשובות וקביעת תשובה נכונה — כולן אימוטביליות ותקינות-סכימה.
 */
import { describe, expect, it } from 'vitest';
import {
  addAnswer,
  addSlide,
  addSlideOfType,
  applyToAllSlides,
  changeSlideType,
  duplicateSlide,
  moveSlide,
  nextSlideId,
  removeAnswer,
  removeSlide,
  setCorrect,
  shuffleSlides,
  updateSlide,
  VOTABLE_TYPES,
} from '../src/app/slideEdit.ts';
import { toggleCorrect } from '../src/app/slideAdvanced.ts';
import { narrationAnswers } from '../src/app/narration/gameNarration.ts';
import type { GameFile, Slide } from '../src/engine/index.ts';
import { fourAnswers, makeGame, rawSlide } from './helpers.ts';

function game3() {
  return makeGame([
    rawSlide({ id: 1, type: 'trivia', que: 'א', answers: fourAnswers(2), scoreForQue: 3 }),
    rawSlide({ id: 2, type: 'trivia', que: 'ב', answers: fourAnswers(1), scoreForQue: 3 }),
    rawSlide({ id: 3, type: 'trivia', que: 'ג', answers: fourAnswers(4), scoreForQue: 3 }),
  ]);
}

describe('slideEdit', () => {
  it('nextSlideId = מקסימום + 1', () => {
    expect(nextSlideId(game3())).toBe(4);
  });

  it('moveSlide מזיז ולא חורג מהקצוות', () => {
    const g = game3();
    expect(moveSlide(g, 0, 1).questions.map((q) => q.question.que)).toEqual(['ב', 'א', 'ג']);
    expect(moveSlide(g, 2, 1)).toBe(g); // אין למטה מהאחרונה
    expect(moveSlide(g, 0, -1)).toBe(g); // אין מעל הראשונה
    expect(g.questions.map((q) => q.question.que)).toEqual(['א', 'ב', 'ג']); // המקור לא השתנה
  });

  it('removeSlide מוחק, אך לא את השקופית האחרונה שנותרה', () => {
    const g = game3();
    expect(removeSlide(g, 1).questions.map((q) => q.question.que)).toEqual(['א', 'ג']);
    const one = makeGame([rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(2) })]);
    expect(removeSlide(one, 0)).toBe(one); // לא מוחקים את האחרונה
  });

  it('duplicateSlide משכפל עם מזהה חדש מיד אחרי המקור', () => {
    const g = duplicateSlide(game3(), 0);
    expect(g.questions).toHaveLength(4);
    expect(g.questions.map((q) => q.question.que)).toEqual(['א', 'א', 'ב', 'ג']);
    expect(g.questions[1]!.id).toBe(4); // מזהה חדש
  });

  it('addSlide מוסיף שקופית טריוויה תקינה עם מזהה חדש', () => {
    const g = addSlide(game3(), 0);
    expect(g.questions).toHaveLength(4);
    expect(g.questions[1]!.id).toBe(4);
    expect(g.questions[1]!.type).toBe('trivia');
    expect(g.questions[1]!.question.answers.length).toBeGreaterThanOrEqual(2);
    expect(g.questions[1]!.question.answers.some((a) => a.correct)).toBe(true);
  });

  it('updateSlide משנה רק את השקופית המבוקשת', () => {
    const g = updateSlide(game3(), 1, (s) => ({ ...s, question: { ...s.question, que: 'חדש' } }));
    expect(g.questions.map((q) => q.question.que)).toEqual(['א', 'חדש', 'ג']);
  });

  it('addAnswer/removeAnswer שומרים מבנה תקין (>=2, מזהים 1..N)', () => {
    const slide = game3().questions[0]!;
    const more = addAnswer(slide);
    expect(more.question.answers).toHaveLength(5);
    expect(more.question.answers.map((a) => a.id)).toEqual([1, 2, 3, 4, 5]);
    const less = removeAnswer(slide, 0);
    expect(less.question.answers.map((a) => a.id)).toEqual([1, 2, 3]);
    // לא יורדים מתחת ל-2
    const two = removeAnswer(removeAnswer(slide, 0), 0);
    const stay = removeAnswer(two, 0);
    expect(stay.question.answers.length).toBe(2);
  });

  it('removeAnswer שמוחק את התשובה הנכונה — בוחר נכונה חדשה בטריוויה', () => {
    const slide = game3().questions[0]!; // הנכונה במיקום 1 (id 2)
    const after = removeAnswer(slide, 1); // מוחק את הנכונה
    expect(after.question.answers.some((a) => a.correct)).toBe(true);
  });

  it('setCorrect קובע בדיוק תשובה נכונה אחת', () => {
    const slide = game3().questions[0]!;
    const after = setCorrect(slide, 2);
    expect(after.question.answers.filter((a) => a.correct).map((a) => a.id)).toEqual([3]);
  });
});

/**
 * כלי "ערבוב סדר השאלות" ו"החלה על כל השקופיות" — שניהם משנים הרבה שקופיות
 * בבת אחת ואין להם ביטול, ולכן שווה לוודא במדויק במה הם נוגעים.
 */
describe('כלי העורך — ערבוב והחלה קולקטיבית', () => {
  const mixed = () =>
    makeGame([
      rawSlide({ id: 1, type: 'subject', que: 'פתיח' }),
      rawSlide({ id: 2, type: 'trivia', que: 'א', answers: fourAnswers(1), timeForQue: 10, scoreForQue: 1 }),
      rawSlide({ id: 3, type: 'media', que: 'סרטון' }),
      rawSlide({ id: 4, type: 'trivia', que: 'ב', answers: fourAnswers(2), timeForQue: 20, scoreForQue: 2 }),
      rawSlide({ id: 5, type: 'survey', que: 'ג', answers: fourAnswers(1), timeForQue: 30, scoreForQue: 3 }),
    ]);

  it('★ ערבוב מזיז רק שקופיות מצביעות — הפתיח והסרטון נשארים במקומם', () => {
    // rand קבוע (0) הופך את הערבוב לתמורה ידועה: [2,4,5] → [4,5,2].
    const out = shuffleSlides(mixed(), () => 0);
    expect(out.questions.map((q) => q.id)).toEqual([1, 4, 3, 5, 2]);
    // הסוגים במקומם: שקופית שאינה מצביעה לא זזה, ומצביעה נוחתת רק על מקום של מצביעה.
    expect(out.questions.map((q) => q.type)).toEqual([
      'subject',
      'trivia',
      'media',
      'survey',
      'trivia',
    ]);
  });

  it('ערבוב עם פחות משתי שאלות מחזיר את המשחק כמו שהוא', () => {
    const one = makeGame([rawSlide({ id: 1, type: 'trivia', que: 'א', answers: fourAnswers(1) })]);
    expect(shuffleSlides(one)).toBe(one);
  });

  it('★ החלה קולקטיבית נוגעת רק בשקופיות מצביעות', () => {
    const out = applyToAllSlides(mixed(), { timeForQue: 25, scoreForQue: 9 });
    for (const q of out.questions) {
      if (VOTABLE_TYPES.has(q.type)) {
        expect(q.question.timeForQue, String(q.id)).toBe(25);
        expect(q.question.scoreForQue, String(q.id)).toBe(9);
      }
    }
    // טקסט ומדיה נשארו על ערכי הריקון שלהן
    expect(out.questions[0]!.question.scoreForQue).toBe(0);
    expect(out.questions[2]!.question.scoreForQue).toBe(0);
  });

  it('★ שדה שלא נמסר אינו נדרס — אפשר להחיל ניקוד בלי לגעת בזמנים', () => {
    const out = applyToAllSlides(mixed(), { scoreForQue: 9 });
    expect(out.questions[1]!.question.scoreForQue).toBe(9);
    expect(out.questions[1]!.question.timeForQue).toBe(10); // כמו שהיה
    expect(out.questions[3]!.question.timeForQue).toBe(20);
  });
});

/**
 * הקריינות בעריכה חיה (מסך המנחה והעורך המקומי). כל קטע הוא הקלטה של טקסט
 * מסוים והמנוע לעולם אינו מייצר שמע — ולכן אחרי כל עריכה נשאר רק קטע שהטקסט
 * שלו עדיין על המסך, צמוד לתשובה שלו. שקט עדיף על קטע שגוי.
 */
describe('★ קריינות אחרי עריכה חיה — רק מה שעדיין נכון', () => {
  /** שקופית טריוויה עם קטע לכל טקסט: שאלה, ארבע תשובות (ב נכונה) ותשובה נכונה. */
  const narrated = (): GameFile =>
    makeGame([
      {
        ...rawSlide({
          id: 1,
          type: 'trivia',
          que: 'מה בירת צרפת?',
          answers: [
            { ans: 'לונדון', correct: false, id: 1 },
            { ans: 'פריז', correct: true, id: 2 },
            { ans: 'רומא', correct: false, id: 3 },
            { ans: 'ברלין', correct: false, id: 4 },
          ],
          scoreForQue: 3,
        }),
        narration: {
          question: 'q.mp3',
          answers: ['london.mp3', 'paris.mp3', 'rome.mp3', 'berlin.mp3'],
          correct: 'correct-paris.mp3',
        },
      },
      rawSlide({ id: 2, type: 'trivia', que: 'ב', answers: fourAnswers(1), scoreForQue: 3 }),
    ]);
  const first = (g: GameFile): Slide => g.questions[0]!;
  const edit = (updater: (s: Slide) => Slide) => first(updateSlide(narrated(), 0, updater));
  const withAnswers = (slide: Slide, answers: Slide['question']['answers']): Slide => ({
    ...slide,
    question: { ...slide.question, answers },
  });

  it('★ מחיקת תשובה מוציאה את הקטע שלה — והשאר לא זזים מקום', () => {
    const after = removeAnswer(first(narrated()), 0); // מוחקים את "לונדון"
    expect(after.narration?.answers).toEqual(['paris.mp3', 'rome.mp3', 'berlin.mp3']);
    // מה שהבמאי מקבל: הקטע של "פריז" ליד "פריז", ולא הקטע של "לונדון"
    expect(narrationAnswers(after)).toEqual([
      { correct: true, clip: 'paris.mp3' },
      { correct: false, clip: 'rome.mp3' },
      { correct: false, clip: 'berlin.mp3' },
    ]);
    expect(after.narration?.question).toBe('q.mp3');
    expect(after.narration?.correct).toBe('correct-paris.mp3'); // "פריז" עדיין הנכונה
  });

  it('★ מחיקת התשובה הנכונה — הקטע "התשובה הנכונה" יורד (נבחרה נכונה אחרת)', () => {
    const after = removeAnswer(first(narrated()), 1); // מוחקים את "פריז"
    expect(after.question.answers.find((a) => a.correct)?.ans).toBe('לונדון');
    expect(after.narration?.answers).toEqual(['london.mp3', 'rome.mp3', 'berlin.mp3']);
    expect(after.narration?.correct).toBeNull();
  });

  it('★ עריכת נוסח תשובה — הקטע שלה יורד, ושל השאר נשאר', () => {
    const after = edit((s) =>
      withAnswers(
        s,
        s.question.answers.map((a, i) => (i === 2 ? { ...a, ans: 'מדריד' } : a)),
      ),
    );
    expect(after.narration?.answers).toEqual(['london.mp3', 'paris.mp3', null, 'berlin.mp3']);
    expect(after.narration?.correct).toBe('correct-paris.mp3');
  });

  it('★ עריכת נוסח התשובה הנכונה — גם הקטע שלה וגם "התשובה הנכונה" יורדים', () => {
    const after = edit((s) =>
      withAnswers(
        s,
        s.question.answers.map((a, i) => (i === 1 ? { ...a, ans: 'פריס' } : a)),
      ),
    );
    expect(after.narration?.answers).toEqual(['london.mp3', null, 'rome.mp3', 'berlin.mp3']);
    expect(after.narration?.correct).toBeNull();
  });

  it('★ עריכת נוסח השאלה — קטע השאלה יורד; רווחים בלבד אינם עריכה', () => {
    const que = (text: string) => edit((s) => ({ ...s, question: { ...s.question, que: text } }));
    expect(que('מהי בירת צרפת?').narration?.question).toBeNull();
    expect(que('מהי בירת צרפת?').narration?.answers).toEqual([
      'london.mp3',
      'paris.mp3',
      'rome.mp3',
      'berlin.mp3',
    ]);
    expect(que('  מה בירת   צרפת? ').narration?.question).toBe('q.mp3');
  });

  it('★ החלפת התשובה הנכונה — "התשובה הנכונה" יורד, קטעי התשובות נשארים', () => {
    const after = setCorrect(first(narrated()), 2);
    expect(after.narration?.correct).toBeNull();
    expect(after.narration?.answers).toEqual(['london.mp3', 'paris.mp3', 'rome.mp3', 'berlin.mp3']);
    // סימון מחדש של אותה תשובה אינו שינוי
    expect(setCorrect(first(narrated()), 1).narration?.correct).toBe('correct-paris.mp3');
    // תשובה נכונה נוספת (בחירה מרובה) — ההכרזה המוכנה כבר לא מלאה
    expect(edit((s) => toggleCorrect(s, 3)).narration?.correct).toBeNull();
  });

  it('★ "הרוב קובע" — אין תשובה נכונה מראש, ולכן גם לא הכרזה מוכנה', () => {
    const after = edit((s) => ({
      ...withAnswers(
        s,
        s.question.answers.map((a) => ({ ...a, correct: false })),
      ),
      setting: { ...s.setting, majorityDecides: true },
    }));
    expect(after.narration?.correct).toBeNull();
    expect(after.narration?.answers).toEqual(['london.mp3', 'paris.mp3', 'rome.mp3', 'berlin.mp3']);
  });

  it('★ הזזת תשובות — כל קטע זז עם התשובה שלו', () => {
    const after = edit((s) => {
      const [a, b, c, d] = s.question.answers;
      return withAnswers(s, [d!, c!, b!, a!]);
    });
    expect(after.narration?.answers).toEqual(['berlin.mp3', 'rome.mp3', 'paris.mp3', 'london.mp3']);
    expect(after.narration?.correct).toBe('correct-paris.mp3');
    expect(after.narration?.question).toBe('q.mp3');
  });

  it('★ תשובה חדשה — בלי קטע, והמערך מיושר לתשובות', () => {
    const after = addAnswer(first(narrated()));
    expect(after.narration?.answers).toEqual([
      'london.mp3',
      'paris.mp3',
      'rome.mp3',
      'berlin.mp3',
      null,
    ]);
  });

  it('★ שינוי סוג: סקר אינו מכריז תשובה נכונה; הימור מחליף את התשובות בכיתובים', () => {
    const survey = first(changeSlideType(narrated(), 0, 'survey'));
    expect(survey.narration?.correct).toBeNull();
    expect(survey.narration?.question).toBe('q.mp3');
    expect(survey.narration?.answers).toEqual(['london.mp3', 'paris.mp3', 'rome.mp3', 'berlin.mp3']);
    // שקופית שתשובותיה עדיין "תשובה N" — ההימור מחליף אותן בכיתובי הכרטיסים
    const plain = makeGame([
      {
        ...rawSlide({ id: 1, type: 'trivia', que: 'א', answers: fourAnswers(1) }),
        narration: { question: 'qa.mp3', answers: ['1.mp3', '2.mp3', '3.mp3', '4.mp3'], correct: null },
      },
    ]);
    const bet = first(changeSlideType(plain, 0, 'bet'));
    expect(bet.question.answers.map((a) => a.ans)).not.toContain('תשובה 1');
    expect(bet.narration?.answers).toEqual([null, null, null, null]);
    expect(bet.narration?.question).toBe('qa.mp3');
  });

  it('★ שקופית חדשה אינה יורשת את הקריינות של שקופית הבסיס', () => {
    const g = addSlide(narrated(), 0);
    expect(g.questions[1]!.question.que).toBe('שאלה חדשה');
    expect(g.questions[1]!.narration).toBeUndefined();
    expect(g.questions[0]!.narration?.question).toBe('q.mp3'); // הבסיס לא נפגע
    expect(addSlideOfType(narrated(), 0, 'survey').questions[1]!.narration).toBeUndefined();
  });

  it('★ שכפול, הזזה וערבוב — הקטעים נשארים צמודים לתוכן שלהם', () => {
    const dup = duplicateSlide(narrated(), 0);
    expect(dup.questions[1]!.narration).toEqual(dup.questions[0]!.narration);
    const moved = moveSlide(narrated(), 0, 1);
    expect(moved.questions[1]!.question.que).toBe('מה בירת צרפת?');
    expect(moved.questions[1]!.narration?.question).toBe('q.mp3');
    expect(moved.questions[0]!.narration).toBeUndefined();
    const shuffled = shuffleSlides(narrated(), () => 0);
    const paris = shuffled.questions.find((q) => q.question.que === 'מה בירת צרפת?')!;
    expect(paris.narration?.answers).toEqual(['london.mp3', 'paris.mp3', 'rome.mp3', 'berlin.mp3']);
  });

  it('עריכה שאינה נוגעת בטקסט (זמן, ניקוד, מדיה) — הקריינות נשארת כמו שהיא', () => {
    const after = edit((s) => ({ ...s, question: { ...s.question, timeForQue: 40, src: 'x.png' } }));
    expect(after.narration).toEqual(first(narrated()).narration);
  });
});
