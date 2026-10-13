import { describe, expect, it } from 'vitest';
import {
  COUNTDOWN_SPACE,
  answerTextMax,
  answersMinHeight,
  largestFitting,
  questionContentMax,
  type QuestionSpace,
} from '../src/render/questionFit.ts';

/** המסך הרגיל: ‎1000 − 132 (כותרת) − 92 (פס תחתון) = 776 בין הכותרת לפס. */
const SPACE = 776;
/** עם באנר ההצטרפות (padding-top 84 במקום 40). */
const BANNER_SPACE = 732;

function space(over: Partial<QuestionSpace> = {}): QuestionSpace {
  return { space: SPACE, countdown: COUNTDOWN_SPACE, gap: 22, questionChrome: 44, answersMin: 0, ...over };
}

describe('answersMinHeight', () => {
  it('שורות של כרטיס מינימלי ורווחים ביניהן', () => {
    expect(answersMinHeight(1, 104, 20)).toBe(104);
    expect(answersMinHeight(3, 104, 20)).toBe(352);
    expect(answersMinHeight(4, 80, 12)).toBe(356);
  });

  it('תשובות תמונה (0 שורות) — בלי מינימום', () => {
    expect(answersMinHeight(0, 104, 20)).toBe(0);
  });
});

describe('questionContentMax', () => {
  it('2–4 תשובות: השאלה שומרת את התקרה הקבועה', () => {
    expect(questionContentMax(space({ answersMin: answersMinHeight(2, 104, 20) }), 240)).toBe(240);
    expect(questionContentMax(space({ answersMin: answersMinHeight(1, 104, 20) }), 240)).toBe(240);
  });

  it('6 תשובות: עד 212px, ועם באנר 168 — כדי ששלוש השורות ייכנסו', () => {
    const answersMin = answersMinHeight(3, 104, 20);
    expect(questionContentMax(space({ answersMin }), 240)).toBe(212);
    expect(questionContentMax(space({ answersMin, space: BANNER_SPACE }), 240)).toBe(168);
  });

  it('8 תשובות בכרטיסים צפופים: 208px, ועם באנר 164', () => {
    const answersMin = answersMinHeight(4, 80, 12);
    expect(questionContentMax(space({ answersMin }), 240)).toBe(208);
    expect(questionContentMax(space({ answersMin, space: BANNER_SPACE }), 240)).toBe(164);
  });

  it('תמונה שהיא השאלה: התקרה שלה (320) יורדת כשיש 5 תשובות ומעלה', () => {
    expect(questionContentMax(space({ answersMin: answersMinHeight(2, 104, 20) }), 320)).toBe(320);
    expect(questionContentMax(space({ answersMin: answersMinHeight(3, 104, 20) }), 320)).toBe(212);
  });

  it('תשובות תמונה: בלי מינימום לתשובות, התקרה נשארת', () => {
    expect(questionContentMax(space({ answersMin: 0 }), 240)).toBe(240);
  });

  it('מסך צפוף מאוד — לא פחות משורה אחת', () => {
    expect(questionContentMax(space({ space: 500, answersMin: 476 }), 240)).toBe(48);
    expect(questionContentMax(space({ space: 500, answersMin: 476 }), 240, 30)).toBe(30);
  });

  it('לא עובר את התקרה הקבועה גם כשיש הרבה מקום', () => {
    expect(questionContentMax(space({ space: 2000 }), 240)).toBe(240);
  });
});

describe('answerTextMax', () => {
  const base = { rowGap: 20, cardChrome: 30, cssMax: 110 };

  it('מקום פנוי — התקציב הקבוע של ה-CSS', () => {
    expect(answerTextMax({ ...base, answersSpace: 1000, rows: 4 })).toBe(110);
  });

  it('מקום צר — חלק שווה לכל שורה, בלי ריפוד ומסגרת', () => {
    // 4 שורות ב-428: ‏(428 − 60) / 4 = 92 → 62 לטקסט
    expect(answerTextMax({ ...base, answersSpace: 428, rows: 4 })).toBe(62);
    // 3 שורות ב-360 (6 תשובות עם באנר): ‏(360 − 40) / 3 = 106.67 → 76
    expect(answerTextMax({ ...base, answersSpace: 360, rows: 3, cssMax: 154 })).toBe(76);
  });

  it('לא פחות משורה אחת', () => {
    expect(answerTextMax({ ...base, answersSpace: 100, rows: 4 })).toBe(30);
    expect(answerTextMax({ ...base, answersSpace: 100, rows: 4, floor: 20 })).toBe(20);
  });

  it('0 שורות לא מחלק באפס', () => {
    expect(answerTextMax({ ...base, answersSpace: 300, rows: 0 })).toBe(110);
  });
});

describe('largestFitting', () => {
  it('הגודל הגדול ביותר שנכנס, בדיוק של חצי פיקסל', () => {
    const got = largestFitting(12, 46, (s) => s <= 30.2);
    expect(got).toBeLessThanOrEqual(30.2);
    expect(got).toBeGreaterThan(29.6);
  });

  it('שום גודל לא נכנס — הקטן ביותר', () => {
    expect(largestFitting(12, 34, () => false)).toBe(12);
  });

  it('הכול נכנס — קרוב לגדול ביותר', () => {
    expect(largestFitting(34, 46, () => true)).toBeGreaterThan(45.4);
  });
});
