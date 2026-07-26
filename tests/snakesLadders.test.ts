/**
 * בדיקות ללוגיקת "סולמות וחבלים קבוצתי": אחוזי הצלחה לכל קבוצה, התקדמות
 * (אחוזים/קובייה), סולמות וחבלים, וגבולות הלוח.
 */
import { describe, expect, it } from 'vitest';
import {
  applyJump,
  BOARD_SIZE,
  boardCategoryId,
  boardStandings,
  DEFAULT_LADDERS,
  DEFAULT_SNAKES,
  EMPTY_BOARD,
  hasWinner,
  MAX_STEPS,
  membersByGroup,
  playRound,
  rollDice,
  stepsForPercent,
  type BoardState,
} from '../src/app/snakesLadders.ts';
import { addCategory, addGroup, assignGroupByNumber, EMPTY_ROSTER } from '../src/app/roster.ts';

/** אדום: a,b · כחול: c,d,e · (f אינו משויך — מחוץ למשחק הקבוצתי) */
function roster() {
  let r = addCategory(EMPTY_ROSTER, 'צבע', 'cat1');
  r = addGroup(r, 'cat1', 'אדום', 'g1');
  r = addGroup(r, 'cat1', 'כחול', 'g2');
  r = assignGroupByNumber(r, 'a', 'cat1', 1);
  r = assignGroupByNumber(r, 'b', 'cat1', 1);
  r = assignGroupByNumber(r, 'c', 'cat1', 2);
  r = assignGroupByNumber(r, 'd', 'cat1', 2);
  r = assignGroupByNumber(r, 'e', 'cat1', 2);
  return r;
}

const round = (over: Partial<Parameters<typeof playRound>[0]> = {}) =>
  playRound({
    roster: roster(),
    categoryId: 'cat1',
    votes: {},
    correctAnswerIds: [2],
    progression: 'percent',
    seed: 1,
    board: EMPTY_BOARD,
    ...over,
  });

describe('עזרי לוח', () => {
  it('boardCategoryId מחזיר את הקטגוריה הראשונה עם קבוצות', () => {
    expect(boardCategoryId(roster())).toBe('cat1');
    expect(boardCategoryId(EMPTY_ROSTER)).toBeNull();
  });

  it('membersByGroup מקבץ רק משויכים', () => {
    const m = membersByGroup(roster(), 'cat1');
    expect(m.g1!.sort()).toEqual(['a', 'b']);
    expect(m.g2!.sort()).toEqual(['c', 'd', 'e']);
    expect(Object.values(m).flat()).not.toContain('f'); // לא משויך → מחוץ למשחק
  });

  it('stepsForPercent: 0%→0, 100%→MAX_STEPS, וחסום בטווח', () => {
    expect(stepsForPercent(0)).toBe(0);
    expect(stepsForPercent(100)).toBe(MAX_STEPS);
    expect(stepsForPercent(80)).toBe(4);
    expect(stepsForPercent(40)).toBe(2);
    expect(stepsForPercent(-50)).toBe(0);
    expect(stepsForPercent(999)).toBe(MAX_STEPS);
  });

  it('rollDice דטרמיניסטי ובטווח 1..6', () => {
    for (let s = 0; s < 50; s++) {
      const v = rollDice(s);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      expect(rollDice(s)).toBe(v); // אותו seed → אותה תוצאה
    }
  });

  it('applyJump מזהה סולם וחבל', () => {
    const ladderFrom = Number(Object.keys(DEFAULT_LADDERS)[0]);
    expect(applyJump(ladderFrom)).toEqual({ to: DEFAULT_LADDERS[ladderFrom], jump: 'ladder' });
    const snakeFrom = Number(Object.keys(DEFAULT_SNAKES)[0]);
    expect(applyJump(snakeFrom)).toEqual({ to: DEFAULT_SNAKES[snakeFrom], jump: 'snake' });
    expect(applyJump(2)).toEqual({ to: 2, jump: null });
  });
});

describe('playRound — התקדמות לפי אחוזים', () => {
  it('אחוז מחושב מכלל חברי הקבוצה (מי שלא ענה = טעות)', () => {
    // אדום: a נכון, b לא ענה → 1/2 = 50%. כחול: c,d נכון, e טעות → 2/3 = 67%.
    const b = round({ votes: { a: 2, c: 2, d: 2, e: 1 } });
    const red = b.lastRound.find((g) => g.name === 'אדום')!;
    const blue = b.lastRound.find((g) => g.name === 'כחול')!;
    expect(red.percent).toBe(50);
    expect(red.answered).toBe(1);
    expect(red.members).toBe(2);
    expect(blue.percent).toBe(67);
    expect(blue.answered).toBe(3);
  });

  it('כל קבוצה מתקדמת לפי האחוז שלה', () => {
    const b = round({ votes: { a: 2, b: 2, c: 2, d: 1, e: 1 } }); // אדום 100%, כחול 33%
    const red = b.lastRound.find((g) => g.name === 'אדום')!;
    const blue = b.lastRound.find((g) => g.name === 'כחול')!;
    expect(red.steps).toBe(MAX_STEPS);
    expect(blue.steps).toBe(stepsForPercent(33));
  });

  it('אף אחד לא ענה — אין תזוזה', () => {
    const b = round({ votes: {} });
    expect(b.lastRound.every((g) => g.steps === 0 && g.to === 0)).toBe(true);
  });

  it('בסקר (בלי תשובה נכונה) כל מי שענה נחשב נכון', () => {
    const b = round({ votes: { a: 4, b: 1 }, correctAnswerIds: [] });
    expect(b.lastRound.find((g) => g.name === 'אדום')!.percent).toBe(100);
  });

  it('סולם מרים את הקבוצה', () => {
    // מציבים את אדום כך שנחיתה תיפול בדיוק על סולם
    const entry = Number(Object.keys(DEFAULT_LADDERS)[0]);
    const board: BoardState = { ...EMPTY_BOARD, positions: { g1: entry - MAX_STEPS } };
    const b = round({ votes: { a: 2, b: 2 }, board }); // אדום 100% → MAX_STEPS
    const red = b.lastRound.find((g) => g.name === 'אדום')!;
    expect(red.landed).toBe(entry);
    expect(red.jump).toBe('ladder');
    expect(red.to).toBe(DEFAULT_LADDERS[entry]);
    expect(b.positions.g1).toBe(DEFAULT_LADDERS[entry]);
  });

  it('חבל מפיל את הקבוצה', () => {
    const entry = Number(Object.keys(DEFAULT_SNAKES)[0]);
    const board: BoardState = { ...EMPTY_BOARD, positions: { g1: entry - MAX_STEPS } };
    const b = round({ votes: { a: 2, b: 2 }, board });
    const red = b.lastRound.find((g) => g.name === 'אדום')!;
    expect(red.jump).toBe('snake');
    expect(red.to).toBe(DEFAULT_SNAKES[entry]);
    expect(red.to).toBeLessThan(red.landed);
  });

  it('לא חורגים מקצה הלוח', () => {
    const board: BoardState = { ...EMPTY_BOARD, positions: { g1: BOARD_SIZE - 1 } };
    const b = round({ votes: { a: 2, b: 2 }, board });
    expect(b.positions.g1).toBe(BOARD_SIZE);
    expect(hasWinner(b)).toBe(true);
  });

  it('אינו משנה את מצב הלוח הקודם (אימוטבילי)', () => {
    const board: BoardState = { ...EMPTY_BOARD, positions: { g1: 5 } };
    round({ votes: { a: 2, b: 2 }, board });
    expect(board.positions.g1).toBe(5);
  });
});

describe('playRound — התקדמות לפי קובייה', () => {
  it('רק הקבוצה המובילה מתקדמת, לפי הטלה', () => {
    // אדום 100% · כחול 33% → אדום מנצח את ההטלה
    const b = round({ progression: 'dice', votes: { a: 2, b: 2, c: 2, d: 1, e: 1 }, seed: 7 });
    expect(b.diceWinner).toBe('g1');
    expect(b.lastDice).toBe(rollDice(7));
    expect(b.lastRound.find((g) => g.name === 'אדום')!.steps).toBe(rollDice(7));
    expect(b.lastRound.find((g) => g.name === 'כחול')!.steps).toBe(0);
  });

  it('אף קבוצה לא ענתה נכון — אין הטלה ואין תזוזה', () => {
    const b = round({ progression: 'dice', votes: { a: 1, c: 1 } }); // אין נכונות
    expect(b.lastDice).toBeNull();
    expect(b.diceWinner).toBeNull();
    expect(b.lastRound.every((g) => g.steps === 0)).toBe(true);
  });

  it('שובר-שוויון יציב כשהאחוזים זהים', () => {
    const votes = { a: 2, b: 2, c: 2, d: 2, e: 2 }; // שתיהן 100%
    const first = round({ progression: 'dice', votes, seed: 3 }).diceWinner;
    expect(round({ progression: 'dice', votes, seed: 3 }).diceWinner).toBe(first);
  });
});

describe('boardStandings', () => {
  it('ממוין לפי מיקום, עם סימון סיום', () => {
    const board: BoardState = { ...EMPTY_BOARD, positions: { g1: 4, g2: BOARD_SIZE } };
    const s = boardStandings(roster(), 'cat1', board);
    expect(s[0]!.name).toBe('כחול');
    expect(s[0]!.finished).toBe(true);
    expect(s[1]!.name).toBe('אדום');
    expect(s[1]!.finished).toBe(false);
  });
});
