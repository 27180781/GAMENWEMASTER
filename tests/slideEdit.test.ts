/**
 * בדיקות לפעולות עריכת השקופיות הטהורות (slideEdit.ts): הזזה, מחיקה, שכפול,
 * הוספה, עריכת תשובות וקביעת תשובה נכונה — כולן אימוטביליות ותקינות-סכימה.
 */
import { describe, expect, it } from 'vitest';
import {
  addAnswer,
  addSlide,
  duplicateSlide,
  moveSlide,
  nextSlideId,
  removeAnswer,
  removeSlide,
  setCorrect,
  updateSlide,
} from '../src/app/slideEdit.ts';
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
