/**
 * פעולות עריכת שקופיות טהורות (למסך המנחה — שלב ב׳). כל פונקציה מקבלת GameFile
 * ומחזירה GameFile חדש (אימוטבילי) — קל לבדיקה, ומוזרם לתצוגה שמריצה
 * engine.updateGame (hot-swap, לסשן בלבד). התוצאה עוברת פענוח סלחני בתצוגה,
 * כך ששקופית פגומה זמנית לא מפילה את המשחק.
 */

import type { GameFile, Slide } from '../engine/index.ts';

const clone = <T>(x: T): T => structuredClone(x);

/** מזהה שקופית פנוי חדש (מקסימום + 1). */
export function nextSlideId(game: GameFile): number {
  return game.questions.reduce((m, q) => Math.max(m, q.id), 0) + 1;
}

/** הזזת שקופית מקום אחד למעלה (‎-1) או למטה (‎+1). */
export function moveSlide(game: GameFile, index: number, dir: -1 | 1): GameFile {
  const j = index + dir;
  if (index < 0 || index >= game.questions.length || j < 0 || j >= game.questions.length) return game;
  const questions = clone(game.questions);
  const tmp = questions[index]!;
  questions[index] = questions[j]!;
  questions[j] = tmp;
  return { ...game, questions };
}

/** מחיקת שקופית (לא מוחקים את האחרונה — חייבת להישאר לפחות אחת). */
export function removeSlide(game: GameFile, index: number): GameFile {
  if (game.questions.length <= 1 || index < 0 || index >= game.questions.length) return game;
  return { ...game, questions: game.questions.filter((_, i) => i !== index) };
}

/** שכפול שקופית (עם מזהה חדש) מיד אחרי המקור. */
export function duplicateSlide(game: GameFile, index: number): GameFile {
  const slide = game.questions[index];
  if (!slide) return game;
  const copy: Slide = { ...clone(slide), id: nextSlideId(game) };
  const questions = [...game.questions];
  questions.splice(index + 1, 0, copy);
  return { ...game, questions };
}

/**
 * הוספת שקופית טריוויה חדשה מיד אחרי המיקום. נבנית על בסיס מבנה שקופית קיימת
 * (‏setting/רקע תקינים) עם טקסט מרוקן ושתי תשובות — כדי שתעבור ולידציה מיד.
 */
export function addSlide(game: GameFile, index: number): GameFile {
  const base = game.questions[index] ?? game.questions[0];
  if (!base) return game;
  const blank: Slide = {
    ...clone(base),
    id: nextSlideId(game),
    type: 'trivia',
    question: {
      ...clone(base.question),
      que: 'שאלה חדשה',
      src: '',
      answers: [
        { ans: 'תשובה 1', correct: true, id: 1 },
        { ans: 'תשובה 2', correct: false, id: 2 },
      ],
    },
    openMedia: { src: '' },
    endMedia: { src: '' },
  };
  const questions = [...game.questions];
  questions.splice(index + 1, 0, blank);
  return { ...game, questions };
}

/** החלת שינוי על שקופית לפי מיקום (updater מקבל עותק ומחזיר שקופית חדשה). */
export function updateSlide(game: GameFile, index: number, updater: (s: Slide) => Slide): GameFile {
  if (index < 0 || index >= game.questions.length) return game;
  const questions = game.questions.map((q, i) => (i === index ? updater(clone(q)) : q));
  return { ...game, questions };
}

/** הוספת תשובה לשקופית (עד שמירה על מבנה תקין). id לפי המיקום (1..N). */
export function addAnswer(slide: Slide): Slide {
  const answers = [...slide.question.answers];
  answers.push({ ans: `תשובה ${answers.length + 1}`, correct: false, id: answers.length + 1 });
  return { ...slide, question: { ...slide.question, answers } };
}

/** הסרת תשובה לפי מיקום — לא יורדים מתחת ל-2 תשובות בשקופית מצביעה. */
export function removeAnswer(slide: Slide, ansIndex: number): Slide {
  if (slide.question.answers.length <= 2) return slide;
  let answers = slide.question.answers.filter((_, i) => i !== ansIndex);
  // מזהים לפי מיקום; ולדאות שנשארת תשובה נכונה אחת בטריוויה.
  answers = answers.map((a, i) => ({ ...a, id: i + 1 }));
  if (slide.type === 'trivia' && !answers.some((a) => a.correct) && answers[0]) {
    answers[0] = { ...answers[0], correct: true };
  }
  return { ...slide, question: { ...slide.question, answers } };
}

/** קביעת התשובה הנכונה (טריוויה) לפי מיקום — בדיוק אחת נכונה. */
export function setCorrect(slide: Slide, ansIndex: number): Slide {
  const answers = slide.question.answers.map((a, i) => ({ ...a, correct: i === ansIndex }));
  return { ...slide, question: { ...slide.question, answers } };
}
