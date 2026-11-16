/**
 * «כל מי שענה נכון» (setting.showAllCorrect, src/app/correctList.ts): מתי יש
 * צעד כזה, מי מופיע ובאיזה סדר, ואיך השמות נפרסים.
 */

import { describe, expect, it } from 'vitest';
import { parseGameFile, type GameFile } from '../src/engine/index.ts';
import {
  CORRECT_LIST_PAGE_MS,
  correctListApplies,
  correctListCloseDelayMs,
  correctListLayout,
  correctListOrder,
} from '../src/app/correctList.ts';
import { fourAnswers, rawGame, rawSlide } from './helpers.ts';

function game(showAllCorrect: unknown, slides: Record<string, unknown>[]): GameFile {
  const raw = rawGame(slides);
  const setting = raw.setting as Record<string, unknown>;
  if (showAllCorrect !== undefined) setting.showAllCorrect = showAllCorrect;
  return parseGameFile(raw);
}

const TRIVIA = rawSlide({ id: 1, type: 'trivia', que: 'ש', answers: fourAnswers(2), scoreForQue: 10, timeForQue: 15 });
const POLL = rawSlide({ id: 2, type: 'survey', que: 'סקר', answers: fourAnswers(0), timeForQue: 15 });
const FIRST = rawSlide({
  id: 3,
  type: 'trivia',
  que: 'ראשון',
  answers: fourAnswers(1),
  scoreForQue: 10,
  timeForQue: 15,
  settings: { firstClicker: true },
});

describe('«כל מי שענה נכון»', () => {
  it('כבוי כברירת מחדל: קובץ בלי השדה, או עם כל ערך שאינו true', () => {
    for (const value of [undefined, false, 'true', 1, null]) {
      const g = game(value, [TRIVIA]);
      expect(g.setting.showAllCorrect).toBe(false);
      expect(correctListApplies(g.setting, g.questions[0]!)).toBe(false);
    }
  });

  it('דלוק: רק בשקופית עם תשובה נכונה, ולא ב«הראשון שעונה מנצח»', () => {
    const g = game(true, [TRIVIA, POLL, FIRST]);
    expect(g.setting.showAllCorrect).toBe(true);
    expect(correctListApplies(g.setting, g.questions[0]!)).toBe(true);
    expect(correctListApplies(g.setting, g.questions[1]!)).toBe(false);
    expect(correctListApplies(g.setting, g.questions[2]!)).toBe(false);
  });

  it('«הרוב קובע»: אין צעד לפני ההכרעה, ויש אחריה', () => {
    const g = game(true, [
      rawSlide({
        id: 1,
        type: 'trivia',
        que: 'רוב',
        answers: fourAnswers(0),
        scoreForQue: 10,
        timeForQue: 15,
        settings: { majorityDecides: true },
      }),
    ]);
    const slide = g.questions[0]!;
    expect(correctListApplies(g.setting, slide)).toBe(false);
    slide.question.answers[1]!.correct = true; // ההכרעה בסגירה (applyMajority)
    expect(correctListApplies(g.setting, slide)).toBe(true);
  });

  it('לפי סדר ההגעה, רק מי שההצבעה שנרשמה לו נכונה, בלי מי שהוסר', () => {
    const votes = { a: 2, b: 1, c: 2, d: 2, e: 3 };
    // b ו-e טעו; d הוסר מהמשחק; c הגיע ראשון
    expect(correctListOrder(['c', 'b', 'a', 'd', 'e'], votes, new Set([2]), new Set(['d']))).toEqual(['c', 'a']);
  });

  it('שינוי הצבעה: מי שעבר לתשובה שגויה יוצא, ומי שעבר לנכונה נשאר במקום ההגעה שלו', () => {
    expect(correctListOrder(['a', 'b', 'c'], { a: 1, b: 2, c: 2 }, new Set([2]))).toEqual(['b', 'c']);
  });

  it('אחרי רענון (בלי סדר הגעה) — כל מי שצדק לפי ההצבעות שנרשמו', () => {
    expect(correctListOrder([], { x: 2, y: 4, z: 2 }, new Set([2]))).toEqual(['x', 'z']);
    // חלק ידוע וחלק לא: הידועים קודם
    expect(correctListOrder(['z'], { x: 2, z: 2 }, new Set([2]))).toEqual(['z', 'x']);
  });

  it('בחירה מרובה: כל אחת מהתשובות הנכונות נחשבת', () => {
    expect(correctListOrder(['a', 'b', 'c'], { a: 1, b: 3, c: 2 }, new Set([1, 3]))).toEqual(['a', 'b']);
  });

  it('פריסה: עמודה אחת לרשימה קצרה, עד 5 עמודות של 8, ומעל 40 עמודים', () => {
    expect(correctListLayout(0)).toEqual({ cols: 1, rows: 1, pages: 1 });
    expect(correctListLayout(3)).toEqual({ cols: 1, rows: 3, pages: 1 });
    expect(correctListLayout(8)).toEqual({ cols: 1, rows: 8, pages: 1 });
    expect(correctListLayout(9)).toEqual({ cols: 2, rows: 8, pages: 1 });
    expect(correctListLayout(40)).toEqual({ cols: 5, rows: 8, pages: 1 });
    expect(correctListLayout(41)).toEqual({ cols: 5, rows: 8, pages: 2 });
    expect(correctListLayout(250)).toEqual({ cols: 5, rows: 8, pages: 7 });
  });

  it('במעבר אוטומטי: לפחות ההשהיה, ולפחות עמוד שלם לכל עמוד', () => {
    expect(correctListCloseDelayMs(9000, 10)).toBe(9000);
    expect(correctListCloseDelayMs(3000, 10)).toBe(CORRECT_LIST_PAGE_MS);
    expect(correctListCloseDelayMs(3000, 100)).toBe(3 * CORRECT_LIST_PAGE_MS);
  });
});
