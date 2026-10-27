/**
 * פס החשיפה שמתחת לשאלה (src/app/revealBoard.ts): בשאלה רגילה עד 5 מהמהירים
 * שצדקו; ב«הראשון שעונה מנצח» רק הזוכה, עם הנקודות שהמנוע נתן לו — גם בניקוד
 * יורד. משחק בשלבים, נסים 2026-10-27.
 */

import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/engine/index.ts';
import { revealBoard } from '../src/app/revealBoard.ts';
import { fourAnswers, makeGame, makeSnapshot, rawSlide } from './helpers.ts';

const T0 = 1_000_000;

describe('revealBoard', () => {
  it('שאלה רגילה: עד 5 מהמהירים שצדקו, בלי נקודות — כמו קודם', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(revealBoard(false, 'a', { a: 10 }, ids)).toEqual(['a', 'b', 'c', 'd', 'e'].map((id) => ({ id })));
    expect(revealBoard(false, undefined, {}, [])).toEqual([]);
  });

  it('«הראשון שעונה»: רק הזוכה ונקודותיו; ראשון שטעה — הפס ריק', () => {
    expect(revealBoard(true, 'b', { b: 7 }, ['a', 'b', 'c'])).toEqual([{ id: 'b', points: 7 }]);
    expect(revealBoard(true, 'c', {}, ['a', 'b'])).toEqual([]);
    expect(revealBoard(true, undefined, {}, ['a'])).toEqual([]);
  });
});

describe('getSlideAwards + revealBoard מול המנוע', () => {
  function game(firstClicker: boolean) {
    return makeGame([
      rawSlide({
        id: 1,
        type: 'trivia',
        que: 'מהירות',
        answers: fourAnswers(2),
        scoreForQue: 10,
        timeForQue: 10,
        settings: { firstClicker, descendingScore: { active: true, maxScore: 1000 } },
      }),
    ]);
  }

  function play(engine: GameEngine, votes: Record<string, number>, first: string): void {
    engine.dispatch({ type: 'OPEN_VOTING', at: T0 });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, votes, first), at: T0 + 1000, elapsedMs: 4000 });
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: T0 + 11_000 });
  }

  it('הזוכה הראשון מקבל את הערך היורד, והפס מציג בדיוק אותו', () => {
    const engine = new GameEngine(game(true));
    play(engine, { a: 2, b: 2, c: 1 }, 'a');
    const awards = engine.getSlideAwards(1);
    expect(Object.keys(awards)).toEqual(['a']);
    const st = engine.getState();
    const board = revealBoard(true, st.firstClickWinners[1], awards, ['a', 'b']);
    expect(board).toEqual([{ id: 'a', points: awards.a }]);
    expect(awards.a).toBe(st.scores.a);
    expect(awards.a).toBeGreaterThan(0);
    expect(awards.a).toBeLessThanOrEqual(1000);
  });

  it('הראשון טעה: אף אחד לא מנוקד והפס ריק', () => {
    const engine = new GameEngine(game(true));
    play(engine, { c: 1, a: 2 }, 'c');
    expect(engine.getSlideAwards(1)).toEqual({});
    const st = engine.getState();
    expect(revealBoard(true, st.firstClickWinners[1], engine.getSlideAwards(1), ['a'])).toEqual([]);
  });

  it('לפני הסגירה ובשקופית שלא שוחקה — ריק', () => {
    const engine = new GameEngine(game(true));
    expect(engine.getSlideAwards(1)).toEqual({});
    expect(engine.getSlideAwards(99)).toEqual({});
  });
});
