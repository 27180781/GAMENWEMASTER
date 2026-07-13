/**
 * שובר-שוויון לפי מהירות בדירוג האישי (getWinners): כשהניקוד זהה בדיוק,
 * המצביע שהקדים (זמן תגובה ממוצע נמוך) מדורג גבוה יותר.
 */

import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/engine/index.ts';
import { fourAnswers, makeGame, makeSnapshot, rawSlide } from './helpers.ts';

const T0 = 1_000_000;

function triviaGame() {
  return makeGame([
    rawSlide({ id: 1, type: 'trivia', que: 'ש?', answers: fourAnswers(2), scoreForQue: 10, timeForQue: 15 }),
    rawSlide({ id: 2, type: 'subject', que: 'סוף' }),
  ]);
}

describe('שובר-שוויון לפי מהירות', () => {
  it('שני מנצחים עם ניקוד זהה — המהיר יותר ראשון', () => {
    const engine = new GameEngine(triviaGame());
    engine.dispatch({ type: 'ADVANCE', at: T0 }); // פותח הצבעה (openedAt=T0)
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2 }), at: T0 + 1000 });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(2, 1, { a: 2, b: 2 }), at: T0 + 3000 });
    engine.dispatch({ type: 'ADVANCE', at: T0 + 5000 }); // סגירת ההצבעה → תוצאות

    const winners = engine.getWinners();
    expect(winners[0]!.score).toBe(10);
    expect(winners[1]!.score).toBe(10); // תיקו בניקוד
    expect(winners[0]!.voterId).toBe('a'); // a הקדים (1000ms מול 3000ms)
    expect(winners[1]!.voterId).toBe('b');
    expect(engine.averageResponseMs('a')).toBe(1000);
    expect(engine.averageResponseMs('b')).toBe(3000);
  });

  it('כשהמהיר מתחלף — הסדר מתהפך', () => {
    const engine = new GameEngine(triviaGame());
    engine.dispatch({ type: 'ADVANCE', at: T0 });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { b: 2 }), at: T0 + 500 });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(2, 1, { b: 2, a: 2 }), at: T0 + 4000 });
    engine.dispatch({ type: 'ADVANCE', at: T0 + 6000 });
    expect(engine.getWinners()[0]!.voterId).toBe('b'); // b הקדים
  });

  it('חזרה לשקופית ומדידה מחדש — זמני התגובה מתעדכנים הפיך', () => {
    const engine = new GameEngine(triviaGame());
    engine.dispatch({ type: 'ADVANCE', at: T0 });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2 }), at: T0 + 2000 });
    engine.dispatch({ type: 'ADVANCE', at: T0 + 5000 }); // סגירה ראשונה: latency 2000
    expect(engine.averageResponseMs('a')).toBe(2000);
    // חזרה לשקופית ופתיחה מחדש עם זמן מוקדם יותר
    engine.dispatch({ type: 'BACK', at: T0 + 6000 });
    engine.dispatch({ type: 'ADVANCE', at: T0 + 10_000 }); // פותח הצבעה מחדש (openedAt=10000)
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(3, 1, { a: 2 }), at: T0 + 10_500 });
    engine.dispatch({ type: 'ADVANCE', at: T0 + 12_000 }); // סגירה שנייה: latency 500
    expect(engine.averageResponseMs('a')).toBe(500); // לא 1250 — הישן הופחת
  });
});
