import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/engine/index.ts';
import { fourAnswers, makeGame, makeSnapshot, rawSlide } from './helpers.ts';

const T0 = 1_000_000;

/** משחק בסיסי: trivia (נכונה=2, ניקוד=10) ואחריה שקופית media. */
function basicGame(triviaSettings: Record<string, unknown> = {}, triviaExtra = {}) {
  return makeGame([
    rawSlide({
      id: 1,
      type: 'trivia',
      que: 'שאלה?',
      answers: fourAnswers(2),
      scoreForQue: 10,
      timeForQue: 15,
      settings: triviaSettings,
      ...triviaExtra,
    }),
    rawSlide({ id: 2, type: 'media', openMediaSrc: 'https://x.dev/v.mp4' }),
  ]);
}

describe('מחזור חיים של שקופית שאלה (SPEC 5.1)', () => {
  it('ENTER → openMedia → שאלה+הצבעה → timeout → תוצאות → endMedia → ADVANCE', () => {
    const game = makeGame([
      rawSlide({
        id: 1,
        type: 'trivia',
        answers: fourAnswers(2),
        scoreForQue: 10,
        openMediaSrc: 'https://x.dev/intro.mp4',
        endMediaSrc: 'https://x.dev/outro.mp4',
      }),
      rawSlide({ id: 2, type: 'subject', que: 'סוף' }),
    ]);
    const engine = new GameEngine(game);

    // ENTER עם openMedia — עדיין לא הצבעה
    expect(engine.getState()).toMatchObject({ phase: 'showing', activeMedia: 'open', currentSlideId: 1 });

    // המדיה הסתיימה → slideStartVoting=true פותח הצבעה מיד
    engine.dispatch({ type: 'MEDIA_ENDED', at: T0 });
    expect(engine.getState()).toMatchObject({ phase: 'voting', activeMedia: null });

    // snapshot מעדכן מונים חיים
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2, b: 1 }), at: T0 + 3000 });
    expect(engine.getState().liveVotes).toEqual({ counts: { '2': 1, '1': 1 }, total: 2 });

    // סגירת חלון → תוצאות + ניקוד + endMedia מתנגן אוטומטית
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: T0 + 15000 });
    expect(engine.getState()).toMatchObject({ phase: 'results', activeMedia: 'end' });
    expect(engine.getState().scores).toEqual({ a: 10 });

    engine.dispatch({ type: 'MEDIA_ENDED' });
    expect(engine.getState()).toMatchObject({ phase: 'results', activeMedia: null, endMediaPlayed: true });

    engine.dispatch({ type: 'ADVANCE' });
    expect(engine.getState()).toMatchObject({ currentSlideId: 2, phase: 'showing', slidesCompleted: [1] });
  });

  it('slideStartVoting=false: ההצבעה נפתחת ידנית עם ADVANCE', () => {
    const engine = new GameEngine(basicGame({ slideStartVoting: false }));
    expect(engine.getState().phase).toBe('showing');
    engine.dispatch({ type: 'ADVANCE', at: T0 });
    expect(engine.getState().phase).toBe('voting');
  });

  it('ADVANCE בזמן מדיה חוסמת מדלג על המדיה בלבד', () => {
    const game = makeGame([
      rawSlide({ id: 1, type: 'media', openMediaSrc: 'https://x.dev/v.mp4' }),
      rawSlide({ id: 2, type: 'subject', que: 'טקסט' }),
    ]);
    const engine = new GameEngine(game);
    expect(engine.getState().activeMedia).toBe('open');
    engine.dispatch({ type: 'ADVANCE' }); // דילוג על הסרטון — לא מעבר שקופית
    expect(engine.getState()).toMatchObject({ currentSlideId: 1, activeMedia: null, phase: 'showing' });
    engine.dispatch({ type: 'ADVANCE' }); // עכשיו מעבר
    expect(engine.getState().currentSlideId).toBe(2);
  });

  it('ADVANCE בזמן הצבעה סוגר את החלון (שליטת מפעיל)', () => {
    const engine = new GameEngine(basicGame());
    expect(engine.getState().phase).toBe('voting'); // slideStartVoting=true, אין openMedia
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2 }), at: T0 });
    engine.dispatch({ type: 'ADVANCE', at: T0 + 4000 });
    expect(engine.getState().phase).toBe('results');
    expect(engine.getState().scores).toEqual({ a: 10 });
  });

  it('סוף המשחק: ADVANCE מהשקופית האחרונה → ended', () => {
    const engine = new GameEngine(
      makeGame([rawSlide({ id: 1, type: 'subject', que: 'שקופית יחידה' })]),
    );
    engine.dispatch({ type: 'ADVANCE' });
    expect(engine.getState()).toMatchObject({ phase: 'ended', slidesCompleted: [1] });
    engine.dispatch({ type: 'ADVANCE' }); // אין לאן להתקדם
    expect(engine.getState().phase).toBe('ended');
  });
});

describe('קליטת VoteSnapshots', () => {
  it('מתעלם מ-seq ישן/כפול ומ-slideId זר', () => {
    const engine = new GameEngine(basicGame());
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(5, 1, { a: 2, b: 2 }) });
    // seq ישן — נזרק
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(4, 1, { a: 1 }) });
    // שקופית אחרת — נזרק
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(6, 99, { c: 1 }) });
    expect(engine.getState().liveVotes).toEqual({ counts: { '2': 2 }, total: 2 });
  });

  it('snapshot אחרי סגירת ההצבעה לא משנה תוצאות', () => {
    const engine = new GameEngine(basicGame());
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2 }) });
    engine.dispatch({ type: 'VOTING_TIMEOUT' });
    const scoresBefore = engine.getState().scores;
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(2, 1, { a: 2, b: 2, c: 2 }) });
    expect(engine.getState().scores).toBe(scoresBefore);
    expect(engine.getState().votesBySlide[1]).toEqual({ a: 2 });
  });
});

describe('ניקוד (SPEC 5.2)', () => {
  it('trivia: רק מי שבחר תשובה נכונה מקבל scoreForQue', () => {
    const engine = new GameEngine(basicGame());
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2, b: 1, c: 2 }) });
    engine.dispatch({ type: 'VOTING_TIMEOUT' });
    expect(engine.getState().scores).toEqual({ a: 10, c: 10 });
    expect(engine.getState().votesBySlide[1]).toEqual({ a: 2, b: 1, c: 2 });
  });

  it('allowChangeVote=false: ההצבעה הראשונה נועלת', () => {
    const engine = new GameEngine(basicGame({ allowChangeVote: false }));
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 1 }) });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(2, 1, { a: 2 }) }); // ניסיון שינוי
    engine.dispatch({ type: 'VOTING_TIMEOUT' });
    expect(engine.getState().scores).toEqual({}); // ננעל על 1 — תשובה שגויה
    expect(engine.getState().votesBySlide[1]).toEqual({ a: 1 });
  });

  it('allowChangeVote=true: ההצבעה האחרונה גוברת', () => {
    const engine = new GameEngine(basicGame({ allowChangeVote: true }));
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 1 }) });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(2, 1, { a: 2 }) });
    engine.dispatch({ type: 'VOTING_TIMEOUT' });
    expect(engine.getState().scores).toEqual({ a: 10 });
    expect(engine.getState().votesBySlide[1]).toEqual({ a: 2 });
  });

  it('scoringReduction: אחרי seconds שניות הניקוד יורד ל-score', () => {
    const engine = new GameEngine(
      basicGame({
        slideStartVoting: false,
        scoringReduction: { active: true, seconds: 10, score: 3 },
      }),
    );
    engine.dispatch({ type: 'ADVANCE', at: T0 }); // פתיחת הצבעה ב-T0
    // a מצביע אחרי 5 שניות — ניקוד מלא
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2 }), at: T0 + 5000 });
    // b מצביע בדיוק על הסף (10 שניות) — כבר מופחת
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(2, 1, { a: 2, b: 2 }), at: T0 + 10000 });
    // c מצביע אחרי 12 שניות — מופחת
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(3, 1, { a: 2, b: 2, c: 2 }), at: T0 + 12000 });
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: T0 + 15000 });
    expect(engine.getState().scores).toEqual({ a: 10, b: 3, c: 3 });
  });

  it('scoringReduction בלי הזרקת זמן (at) — ניקוד מלא, בלי קריסה', () => {
    const engine = new GameEngine(
      basicGame({ scoringReduction: { active: true, seconds: 10, score: 3 } }),
    );
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2 }) });
    engine.dispatch({ type: 'VOTING_TIMEOUT' });
    expect(engine.getState().scores).toEqual({ a: 10 });
  });

  it('firstClicker: רק המצביע הראשון מקבל ניקוד', () => {
    const engine = new GameEngine(basicGame({ firstClicker: true }));
    engine.dispatch({
      type: 'VOTE_SNAPSHOT',
      snapshot: makeSnapshot(1, 1, { a: 2, b: 2, c: 1 }, 'b'),
    });
    engine.dispatch({ type: 'VOTING_TIMEOUT' });
    expect(engine.getState().scores).toEqual({ b: 10 });
    expect(engine.getState().firstClickWinners).toEqual({ 1: 'b' });
  });

  it('firstClicker שטעה בתשובה — לא מקבל ניקוד', () => {
    const engine = new GameEngine(basicGame({ firstClicker: true }));
    engine.dispatch({
      type: 'VOTE_SNAPSHOT',
      snapshot: makeSnapshot(1, 1, { a: 2, c: 1 }, 'c'),
    });
    engine.dispatch({ type: 'VOTING_TIMEOUT' });
    expect(engine.getState().scores).toEqual({});
    expect(engine.getState().firstClickWinners).toEqual({ 1: 'c' });
  });

  it('correctlyAnsweredBefore: רק מי שצדק בכל שאלות ה-trivia הקודמות', () => {
    const game = makeGame([
      rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(2), scoreForQue: 5 }),
      rawSlide({ id: 2, type: 'survey', answers: fourAnswers(0), scoreForQue: '' }),
      rawSlide({
        id: 3,
        type: 'trivia',
        answers: fourAnswers(3),
        scoreForQue: 20,
        settings: { correctlyAnsweredBefore: true },
      }),
    ]);
    const engine = new GameEngine(game);
    // שקופית 1: a צודק, b טועה
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2, b: 1 }) });
    engine.dispatch({ type: 'VOTING_TIMEOUT' });
    engine.dispatch({ type: 'ADVANCE' });
    // שקופית 2 (survey — לא משפיעה על הסינון)
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(2, 2, { a: 1, b: 1 }) });
    engine.dispatch({ type: 'VOTING_TIMEOUT' });
    engine.dispatch({ type: 'ADVANCE' });
    // שקופית 3: שניהם עונים נכון — אבל רק a זכאי
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(3, 3, { a: 3, b: 3 }) });
    engine.dispatch({ type: 'VOTING_TIMEOUT' });
    expect(engine.getState().scores).toEqual({ a: 25 });
  });

  it('survey: בלי ניקוד כברירת מחדל; עם ניקוד השתתפות מאחורי קונפיג', () => {
    const surveyGame = () =>
      makeGame([rawSlide({ id: 1, type: 'survey', answers: fourAnswers(0), scoreForQue: 7 })]);

    const noScoring = new GameEngine(surveyGame());
    noScoring.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 1, b: 4 }) });
    noScoring.dispatch({ type: 'VOTING_TIMEOUT' });
    expect(noScoring.getState().scores).toEqual({});

    const withScoring = new GameEngine(surveyGame(), { surveyParticipationScoring: true });
    withScoring.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 1, b: 4 }) });
    withScoring.dispatch({ type: 'VOTING_TIMEOUT' });
    expect(withScoring.getState().scores).toEqual({ a: 7, b: 7 });
  });

  it('getWinners: ממוין יורד ומוגבל ל-multiWinners', () => {
    const game = makeGame([
      rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1), scoreForQue: 10 }),
      rawSlide({ id: 2, type: 'trivia', answers: fourAnswers(1), scoreForQue: 5 }),
    ]);
    const engine = new GameEngine(game);
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 1, b: 1, c: 2 }) });
    engine.dispatch({ type: 'VOTING_TIMEOUT' });
    engine.dispatch({ type: 'ADVANCE' });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(2, 2, { b: 1 }) });
    engine.dispatch({ type: 'VOTING_TIMEOUT' });
    expect(engine.getWinners(2)).toEqual([
      { voterId: 'b', score: 15 },
      { voterId: 'a', score: 10 },
    ]);
  });
});

describe('ניווט: BACK / GOTO', () => {
  it('BACK חוזר לשקופית הקודמת ומוציא אותה מהמושלמות; ניקוד לא מוכפל בהרצה חוזרת', () => {
    const engine = new GameEngine(basicGame());
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2 }) });
    engine.dispatch({ type: 'VOTING_TIMEOUT' });
    engine.dispatch({ type: 'ADVANCE' });
    expect(engine.getState()).toMatchObject({ currentSlideId: 2, slidesCompleted: [1] });
    expect(engine.getState().scores).toEqual({ a: 10 });

    engine.dispatch({ type: 'BACK' });
    expect(engine.getState()).toMatchObject({ currentSlideId: 1, phase: 'voting', slidesCompleted: [] });

    // הרצה חוזרת של אותה שקופית — הניקוד מחושב מחדש, לא נערם
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(2, 1, { a: 2, b: 2 }) });
    engine.dispatch({ type: 'VOTING_TIMEOUT' });
    expect(engine.getState().scores).toEqual({ a: 10, b: 10 });

    // ובתיקון תשובה לשגויה — הניקוד הקודם יורד
    engine.dispatch({ type: 'BACK' }); // אינדקס 0 — נשאר, נכנס מחדש
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(3, 1, { a: 1, b: 2 }) });
    engine.dispatch({ type: 'VOTING_TIMEOUT' });
    expect(engine.getState().scores).toEqual({ b: 10 });
  });

  it('GOTO קופץ לפי id; id לא קיים — התעלמות', () => {
    const game = makeGame([
      rawSlide({ id: 1, type: 'subject', que: 'א' }),
      rawSlide({ id: 2, type: 'subject', que: 'ב' }),
      rawSlide({ id: 3, type: 'subject', que: 'ג' }),
    ]);
    const engine = new GameEngine(game);
    engine.dispatch({ type: 'GOTO', slideId: 3 });
    expect(engine.getState().currentSlideId).toBe(3);
    engine.dispatch({ type: 'GOTO', slideId: 42 });
    expect(engine.getState().currentSlideId).toBe(3);
  });

  it('BACK מ-ended נכנס מחדש לשקופית האחרונה', () => {
    const engine = new GameEngine(
      makeGame([rawSlide({ id: 1, type: 'subject', que: 'יחידה' })]),
    );
    engine.dispatch({ type: 'ADVANCE' });
    expect(engine.getState().phase).toBe('ended');
    engine.dispatch({ type: 'BACK' });
    expect(engine.getState()).toMatchObject({ phase: 'showing', currentSlideId: 1 });
  });
});

describe('שקופיות subject ופקודות מערכת', () => {
  it('dynamic-image: המנוע חושף פקודה עם URL שבו {{GAMA_ID}} הוחלף ב-id של המשחק', () => {
    const game = makeGame([
      rawSlide({
        id: 1,
        type: 'subject',
        que: 'image_URL\nhttps://srv.example/img/{{GAMA_ID}}.png',
      }),
    ]);
    const engine = new GameEngine(game);
    expect(engine.getState().subjectCommand).toEqual({
      kind: 'dynamic-image',
      url: 'https://srv.example/img/test-game-0000.png',
    });
  });

  it('Send_data: המנוע חושף פקודת send-data', () => {
    const game = makeGame([rawSlide({ id: 1, type: 'subject', que: 'Send_data' })]);
    expect(new GameEngine(game).getState().subjectCommand).toEqual({ kind: 'send-data' });
  });

  it('subject רגיל: אין פקודה', () => {
    const game = makeGame([rawSlide({ id: 1, type: 'subject', que: 'סגרו את הכרטיסיה כעת' })]);
    expect(new GameEngine(game).getState().subjectCommand).toBeNull();
  });
});

describe('serialize / restore (SPEC 7.1)', () => {
  function playedEngine(): GameEngine {
    const engine = new GameEngine(basicGame(), { roomId: 'room-7' });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2, b: 1 }) });
    engine.dispatch({ type: 'VOTING_TIMEOUT' });
    engine.dispatch({ type: 'ADVANCE' });
    return engine;
  }

  it('round-trip: restore ואז serialize מחזירים מצב זהה', () => {
    const engine = playedEngine();
    const snapshot = engine.serialize('2026-07-09T10:00:00.000Z');
    expect(snapshot).toMatchObject({
      version: 1,
      gameId: 'test-game-0000',
      roomId: 'room-7',
      seq: 1,
      currentSlideId: 2,
      phase: 'showing',
      scores: { a: 10 },
      votesBySlide: { 1: { a: 2, b: 1 } },
      slidesCompleted: [1],
    });

    const restored = new GameEngine(basicGame());
    restored.restore(snapshot);
    expect(restored.serialize('2026-07-09T10:00:01.000Z')).toEqual(
      engine.serialize('2026-07-09T10:00:01.000Z'),
    );
    // וגם ה-state הנצפה זהה בשדות המהותיים
    expect(restored.getState()).toMatchObject({
      phase: 'showing',
      currentSlideId: 2,
      scores: { a: 10 },
      votesBySlide: { 1: { a: 2, b: 1 } },
      slidesCompleted: [1],
    });
  });

  it('seq עולה בכל שמירה', () => {
    const engine = playedEngine();
    expect(engine.serialize('T').seq).toBe(1);
    expect(engine.serialize('T').seq).toBe(2);
    expect(engine.serialize('T').seq).toBe(3);
  });

  it('restore ממשחק אחר נדחה עם שגיאה בעברית', () => {
    const engine = playedEngine();
    const snapshot = engine.serialize('T');
    const otherGame = makeGame([rawSlide({ id: 1, type: 'subject', que: 'x' })], {
      id: 'other-game-id',
    });
    expect(() => new GameEngine(otherGame).restore(snapshot)).toThrowError(/משחק אחר/);
  });

  it('אפשר להמשיך לשחק אחרי restore ולהגיע לאותה תוצאה', () => {
    const engine = playedEngine();
    const restored = new GameEngine(basicGame());
    restored.restore(engine.serialize('T'));
    for (const target of [engine, restored]) {
      target.dispatch({ type: 'MEDIA_ENDED' }); // ה-media של שקופית 2 (במשוחזר אין מדיה פעילה — יתעלם)
      target.dispatch({ type: 'ADVANCE' });
    }
    expect(restored.getState().phase).toBe(engine.getState().phase);
    expect(restored.getState().scores).toEqual(engine.getState().scores);
    expect(restored.getState().slidesCompleted).toEqual(engine.getState().slidesCompleted);
  });
});

describe('subscribe — מנגנון המנויים', () => {
  it('מאזין מקבל עדכון על כל שינוי state; ביטול מנוי עוצר', () => {
    const engine = new GameEngine(basicGame({ slideStartVoting: false }));
    let calls = 0;
    const unsubscribe = engine.subscribe(() => { calls += 1; });
    engine.dispatch({ type: 'ADVANCE' });
    expect(calls).toBeGreaterThan(0);
    const before = calls;
    unsubscribe();
    engine.dispatch({ type: 'VOTING_TIMEOUT' });
    expect(calls).toBe(before);
  });
});
