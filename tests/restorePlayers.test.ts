/**
 * «החזרת כל המשתתפים שהוסרו» (function · restore_players): GameEngine.restoreVoters
 * מחזיר את מי שהוסר ב-removeVoters עם הניקוד, ההצבעות והזמנים שהיו לו.
 */

import { describe, expect, it } from 'vitest';
import { GameEngine, functionConfigSchema } from '../src/engine/index.ts';
import { buildBackupPayload } from '../src/app/backupState.ts';
import { fourAnswers, makeGame, makeSnapshot, rawSlide } from './helpers.ts';

function triviaGame() {
  return makeGame([
    rawSlide({ id: 1, type: 'trivia', que: 'q1', answers: fourAnswers(1), scoreForQue: 3, timeForQue: 20 }),
    rawSlide({ id: 2, type: 'trivia', que: 'q2', answers: fourAnswers(2), scoreForQue: 5, timeForQue: 20 }),
    rawSlide({ id: 3, type: 'trivia', que: 'q3', answers: fourAnswers(3), scoreForQue: 7, timeForQue: 20 }),
  ]);
}

/** שקופית 1: alice ו-bob נכונים, carol טועה. נשארים בתוצאות של שקופית 1. */
function playFirst(engine: GameEngine): void {
  engine.dispatch({ type: 'ADVANCE', at: 0 });
  engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { alice: 1, bob: 1, carol: 2 }), at: 100 });
  engine.dispatch({ type: 'VOTING_TIMEOUT', at: 2000 });
}

describe('restoreVoters', () => {
  it('מחזיר את מי שהוסר עם הניקוד וההצבעות שהיו לו', () => {
    const engine = new GameEngine(triviaGame());
    playFirst(engine);
    engine.removeVoters(['alice', 'carol']);
    expect(engine.getState().scores).toEqual({ bob: 3 });
    expect(engine.getRemovedScores()).toEqual({ alice: 3 });

    // שקופית 2 בלי המוסרים
    engine.dispatch({ type: 'ADVANCE', at: 2500 });
    engine.dispatch({ type: 'ADVANCE', at: 3000 });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(2, 2, { bob: 2 }), at: 3100 });
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: 5000 });
    expect(engine.getState().scores).toEqual({ bob: 8 });

    const back = engine.restoreVoters(['alice', 'carol']);
    expect(back).toBe(2);
    const s = engine.getState();
    expect(s.scores).toEqual({ bob: 8, alice: 3 });
    expect(s.votesBySlide[1]).toEqual({ bob: 1, alice: 1, carol: 2 });
    expect(engine.getRemovedScores()).toEqual({});
    // והם ממשיכים לצבור כרגיל
    engine.dispatch({ type: 'ADVANCE', at: 5500 });
    engine.dispatch({ type: 'ADVANCE', at: 6000 });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(3, 3, { alice: 3, carol: 3 }), at: 6100 });
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: 8000 });
    expect(engine.getState().scores).toEqual({ bob: 8, alice: 10, carol: 7 });
  });

  it('חזרה לשקופית שנוקדה לפני ההסרה לא מכפילה את הניקוד של מי שחזר', () => {
    const engine = new GameEngine(triviaGame());
    playFirst(engine);
    engine.removeVoters(['alice']);
    engine.restoreVoters(['alice']);
    // ניקוד מחדש של שקופית 1 עם אותן הצבעות — מקזז את מה שנרשם ומוסיף שוב
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { alice: 1, bob: 1, carol: 2 }), at: 2100 });
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: 2200 });
    expect(engine.getState().scores.alice).toBe(3);
  });

  it('בלי מוסרים — לא עושה כלום', () => {
    const engine = new GameEngine(triviaGame());
    playFirst(engine);
    const before = engine.getState();
    expect(engine.restoreVoters([])).toBe(0);
    expect(engine.restoreVoters(['nobody'])).toBe(0);
    expect(engine.getState()).toBe(before);
  });

  it('איפוס ניקוד אחרי ההסרה — מי שחוזר חוזר עם 0', () => {
    const engine = new GameEngine(triviaGame());
    playFirst(engine);
    engine.removeVoters(['alice']);
    engine.resetScores();
    expect(engine.getRemovedScores()).toEqual({});
    engine.restoreVoters(['alice']);
    expect(engine.getState().scores.alice).toBeUndefined();
  });

  it('אחרי קריסה: הניקוד של מי שהוסר חוזר מהגיבוי', () => {
    const engine = new GameEngine(triviaGame());
    playFirst(engine);
    engine.removeVoters(['alice']);
    const payload = buildBackupPayload(
      engine.getGame(), engine.getState(), { categories: [], players: [], memberships: {} } as never,
      (id) => id, 0, ['alice'], {}, engine.getRemovedScores(),
    );
    expect(payload.meta.removedScores).toEqual({ alice: 3 });

    const fresh = new GameEngine(triviaGame());
    fresh.restore(engine.serialize());
    fresh.setRemovedScores(['alice', 'bogus'], { alice: 3, bogus: 'x' as never });
    expect(fresh.getRemovedScores()).toEqual({ alice: 3 });
    expect(fresh.restoreVoters(['alice', 'bogus'])).toBe(2);
    expect(fresh.getState().scores).toEqual({ bob: 3, alice: 3 });
  });

  it('הפעולה מוכרת בסכימה ואין לה תת-קונפיג', () => {
    const parsed = functionConfigSchema.parse({ action: 'restore_players' });
    expect(parsed.action).toBe('restore_players');
    expect(functionConfigSchema.shape.action.description).toContain('restore_players');
  });
});
