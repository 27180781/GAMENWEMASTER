/**
 * בדיקות ל-GameEngine.updateGame — "פוש רענון" למשחק אונליין: החלפת תוכן
 * המשחק תוך שמירת מהלך המשחק (ניקוד, הצבעות, מיקום לפי id).
 */

import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/engine/index.ts';
import { fourAnswers, makeGame, makeSnapshot, rawSlide } from './helpers.ts';

/** משחק trivia בן שלוש שקופיות (id 1..3), עם טקסט שאלה נתון לכל אחת. */
function triviaGame(texts: [string, string, string] = ['q1', 'q2', 'q3']) {
  return makeGame([
    rawSlide({ id: 1, type: 'trivia', que: texts[0], answers: fourAnswers(1), scoreForQue: 3, timeForQue: 20 }),
    rawSlide({ id: 2, type: 'trivia', que: texts[1], answers: fourAnswers(2), scoreForQue: 3, timeForQue: 20 }),
    rawSlide({ id: 3, type: 'trivia', que: texts[2], answers: fourAnswers(3), scoreForQue: 3, timeForQue: 20 }),
  ]);
}

/** משחק את השקופית הראשונה עד הסוף (alice עונה נכון) ומתקדם לשקופית 2. */
function playFirstSlideThenLandOnSecond(engine: GameEngine): void {
  engine.dispatch({ type: 'ADVANCE', at: 1000 }); // showing → voting
  engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { alice: 1 }), at: 1100 });
  engine.dispatch({ type: 'VOTING_TIMEOUT', at: 2000 }); // → results, alice נוקדה
  engine.dispatch({ type: 'ADVANCE', at: 2500 }); // → שקופית 2, showing
}

describe('GameEngine.reset — התחלת משחק מחדש', () => {
  it('מאפס ניקוד/הצבעות/מיקום לשקופית הראשונה', () => {
    const engine = new GameEngine(triviaGame());
    playFirstSlideThenLandOnSecond(engine);
    // מצב לפני איפוס: יש ניקוד, יש הצבעות, ואנחנו בשקופית 2
    expect(engine.getState().scores).toEqual({ alice: 3 });
    expect(engine.getState().currentSlideId).toBe(2);

    engine.reset();

    const s = engine.getState();
    expect(s.currentSlideId).toBe(1);
    expect(s.currentSlideIndex).toBe(0);
    expect(s.phase).toBe('showing');
    expect(s.scores).toEqual({});
    expect(s.votesBySlide).toEqual({});
    expect(s.slidesCompleted).toEqual([]);
    expect(s.answerTimes).toEqual({});
    // אפשר לשחק שוב מההתחלה, והניקוד נצבר מאפס
    engine.dispatch({ type: 'ADVANCE', at: 10 });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { bob: 1 }), at: 20 });
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: 30 });
    expect(engine.getState().scores).toEqual({ bob: 3 });
  });

  it('resetScores מאפס ניקוד בלבד — מיקום, הצבעות והשקופיות שהושלמו נשמרים', () => {
    const engine = new GameEngine(triviaGame());
    playFirstSlideThenLandOnSecond(engine);
    expect(engine.getState().scores).toEqual({ alice: 3 });

    engine.resetScores();

    const s = engine.getState();
    expect(s.scores).toEqual({});
    expect(s.answerTimes).toEqual({});
    // מיקום, הצבעות והשקופיות שהושלמו נשמרים (בניגוד ל-reset המלא)
    expect(s.currentSlideId).toBe(2);
    expect(s.votesBySlide[1]).toEqual({ alice: 1 });
    expect(s.slidesCompleted).toContain(1);
  });
});

describe('GameEngine.updateGame — רענון תוכן חם', () => {
  it('החלפת תוכן שומרת ניקוד, הצבעות ומיקום (לפי id)', () => {
    const engine = new GameEngine(triviaGame());
    playFirstSlideThenLandOnSecond(engine);

    expect(engine.getState().currentSlideId).toBe(2);
    expect(engine.getState().scores.alice).toBe(3);
    expect(engine.getState().votesBySlide[1]).toEqual({ alice: 1 });

    // העורך תיקן את הטקסט של כל השקופיות ודחף רענון
    engine.updateGame(triviaGame(['q1!', 'q2!', 'q3!']));

    const state = engine.getState();
    expect(state.currentSlideId).toBe(2); // המיקום נשמר
    expect(state.phase).toBe('showing');
    expect(state.scores.alice).toBe(3); // הניקוד נשמר
    expect(state.votesBySlide[1]).toEqual({ alice: 1 }); // ההצבעות נשמרו
    expect(engine.getCurrentSlide().question.que).toBe('q2!'); // התוכן התעדכן
  });

  it('שינוי סדר השקופיות שומר על המיקום לפי id (לא לפי אינדקס)', () => {
    const engine = new GameEngine(triviaGame());
    playFirstSlideThenLandOnSecond(engine);
    expect(engine.getState().currentSlideIndex).toBe(1);

    // סדר חדש: 3, 1, 2 — id=2 עובר לאינדקס 2
    const reordered = makeGame([
      rawSlide({ id: 3, type: 'trivia', que: 'q3', answers: fourAnswers(3), scoreForQue: 3, timeForQue: 20 }),
      rawSlide({ id: 1, type: 'trivia', que: 'q1', answers: fourAnswers(1), scoreForQue: 3, timeForQue: 20 }),
      rawSlide({ id: 2, type: 'trivia', que: 'q2', answers: fourAnswers(2), scoreForQue: 3, timeForQue: 20 }),
    ]);
    engine.updateGame(reordered);

    expect(engine.getState().currentSlideId).toBe(2);
    expect(engine.getState().currentSlideIndex).toBe(2); // אינדקס עודכן, id נשמר
    expect(engine.getState().scores.alice).toBe(3);
  });

  it('הוספת שקופית חדשה בסוף אינה מזיזה את המיקום', () => {
    const engine = new GameEngine(triviaGame());
    playFirstSlideThenLandOnSecond(engine);

    const withExtra = makeGame([
      rawSlide({ id: 1, type: 'trivia', que: 'q1', answers: fourAnswers(1), scoreForQue: 3, timeForQue: 20 }),
      rawSlide({ id: 2, type: 'trivia', que: 'q2', answers: fourAnswers(2), scoreForQue: 3, timeForQue: 20 }),
      rawSlide({ id: 3, type: 'trivia', que: 'q3', answers: fourAnswers(3), scoreForQue: 3, timeForQue: 20 }),
      rawSlide({ id: 4, type: 'trivia', que: 'q4', answers: fourAnswers(4), scoreForQue: 3, timeForQue: 20 }),
    ]);
    engine.updateGame(withExtra);

    expect(engine.getState().currentSlideId).toBe(2);
    expect(engine.getGame().questions).toHaveLength(4);
  });

  it('מחיקת השקופית הנוכחית — כניסה מחדש לשקופית הקרובה, נקי, בלי לאבד ניקוד', () => {
    const engine = new GameEngine(triviaGame());
    playFirstSlideThenLandOnSecond(engine); // נמצאים על id=2, אינדקס 1

    // הקובץ החדש בלי id=2 (נותרו 1 ו-3)
    const withoutCurrent = makeGame([
      rawSlide({ id: 1, type: 'trivia', que: 'q1', answers: fourAnswers(1), scoreForQue: 3, timeForQue: 20 }),
      rawSlide({ id: 3, type: 'trivia', que: 'q3', answers: fourAnswers(3), scoreForQue: 3, timeForQue: 20 }),
    ]);
    engine.updateGame(withoutCurrent);

    const state = engine.getState();
    expect(state.currentSlideId).toBe(3); // fallback: min(1, len-1=1) → id=3
    expect(state.phase).toBe('showing');
    expect(state.scores.alice).toBe(3); // הניקוד עדיין נשמר
  });

  it('רענון בזמן voting שומר את ה-phase כשהשקופית הנוכחית עדיין קיימת', () => {
    const engine = new GameEngine(triviaGame());
    engine.dispatch({ type: 'ADVANCE', at: 1000 }); // showing → voting על id=1
    expect(engine.getState().phase).toBe('voting');

    engine.updateGame(triviaGame(['q1-fixed', 'q2', 'q3']));

    expect(engine.getState().phase).toBe('voting'); // ה-phase נשמר
    expect(engine.getState().currentSlideId).toBe(1);
    expect(engine.getCurrentSlide().question.que).toBe('q1-fixed');
  });

  it('רענון אחרי סיום המשחק משאיר אותו ב-ended עם הזוכים מהניקוד', () => {
    const engine = new GameEngine(triviaGame());
    playFirstSlideThenLandOnSecond(engine);
    // מדלגים לסוף
    engine.dispatch({ type: 'ADVANCE', at: 3000 }); // id2 showing → voting
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: 3100 });
    engine.dispatch({ type: 'ADVANCE', at: 3200 }); // → id3 showing
    engine.dispatch({ type: 'ADVANCE', at: 3300 }); // id3 → voting
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: 3400 });
    engine.dispatch({ type: 'ADVANCE', at: 3500 }); // → ended
    expect(engine.getState().phase).toBe('ended');

    engine.updateGame(triviaGame(['a', 'b', 'c']));
    expect(engine.getState().phase).toBe('ended');
    expect(engine.getWinners()[0]).toEqual({ voterId: 'alice', score: 3 });
  });

  it('קובץ בלי שקופיות זורק שגיאה ולא פוגע במצב הקיים', () => {
    const engine = new GameEngine(triviaGame());
    playFirstSlideThenLandOnSecond(engine);
    expect(() => engine.updateGame(makeGame([]))).toThrow();
    expect(engine.getState().currentSlideId).toBe(2); // המצב לא נפגע
    expect(engine.getState().scores.alice).toBe(3);
  });

  it('subscribe מקבל התראה על רענון (React מתעדכן)', () => {
    const engine = new GameEngine(triviaGame());
    let notified = 0;
    engine.subscribe(() => (notified += 1));
    engine.updateGame(triviaGame(['x', 'y', 'z']));
    expect(notified).toBeGreaterThan(0);
  });
});
