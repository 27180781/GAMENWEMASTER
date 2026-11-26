/**
 * שאלות הדאבל של הגרלת הווילה (src/app/villaDouble.ts, INTEGRATION.md):
 * הסכמה, חישוב התוצאה והכרטיסים, שורת ההשוואה, הטקסטים של המסכים, הגיבוי
 * שהשרת סופר ממנו, והחיבור לטבלת המובילים, לרמזי המנחה ולמסך הצפייה.
 */

import { describe, expect, it } from 'vitest';
import { GameEngine, parseGameFile, type GameFile } from '../src/engine/index.ts';
import {
  doubleComparison,
  doubleIntroLines,
  doubleResult,
  doubleTicketLines,
  doubleTickets,
  doubleTicketsSoFar,
  doubleTitle,
  doubleView,
  doubleWinsTickets,
  hasVillaSlides,
  isDoubleIntro,
  isDoubleSlide,
  stripVillaSlides,
  villaDoublesMeta,
  villaNewRunPlays,
  villaPoolIds,
  villaReachedIn,
  villaResume,
  villaRunOf,
  villaSlideIds,
  type DoubleView,
} from '../src/app/villaDouble.ts';
import { backupToSnapshot, backupWithoutVillas, buildBackupPayload } from '../src/app/backupState.ts';
import type { BackupData } from '../src/app/backup.ts';
import { completedQuestionCount } from '../src/app/leaderboardSchedule.ts';
import { hostKeyHints, type HostHintInput } from '../src/app/hostHints.ts';
import { EMPTY_ROSTER } from '../src/app/roster.ts';
import { LiveSnapshotBuilder, type LiveHostInput } from '../src/live/snapshot.ts';
import { SILENCE } from '../src/live/soundTrack.ts';
import { fourAnswers, makeGame, makeSnapshot, rawGame, rawSlide } from './helpers.ts';

const T0 = 1_000_000;

/** כמה משפחות בארץ קיבלו לפחות k כרטיסים בשאלה הראשונה (k = 0..10), מתוך 20. */
const STATS_A = { families: 20, avg: 41.5, atLeast: [20, 18, 15, 12, 9, 6, 4, 2, 1, 0, 0] };

function intro(id: number, n: number, of: number, tickets = true): Record<string, unknown> {
  return { ...rawSlide({ id, type: 'subject', que: 'שאלת דאבל' }), doubleIntro: { n, of, tickets } };
}

function double(
  id: number,
  correctId: number,
  d: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...rawSlide({
      id,
      type: 'trivia',
      que: `שאלה קשה ${String(d.n)}`,
      answers: fourAnswers(correctId),
      scoreForQue: 20,
      timeForQue: 20,
    }),
    double: d,
  };
}

/**
 * 1 שאלה רגילה · 2 הכרזה · 3 דאבל 1/2 (נכונה 2, עם סטטיסטיקה) · 4 שאלה רגילה ·
 * 5 הכרזה · 6 דאבל 2/2 (נכונה 3, בלי סטטיסטיקה: עוד לא נספרה אף משפחה).
 */
function villaGame(tickets = true): GameFile {
  return makeGame([
    rawSlide({ id: 1, type: 'trivia', que: 'ש1', answers: fourAnswers(2), scoreForQue: 10, timeForQue: 15 }),
    intro(2, 1, 2, tickets),
    double(3, 2, { n: 1, of: 2, poolId: 'q-a', tickets, stats: STATS_A }),
    rawSlide({ id: 4, type: 'trivia', que: 'ש4', answers: fourAnswers(1), scoreForQue: 10, timeForQue: 15 }),
    intro(5, 2, 2, tickets),
    double(6, 3, { n: 2, of: 2, poolId: 'q-b', tickets }),
  ]);
}

/** שקופית 1: חמישה שיחקו; בדאבל הראשון (3) a ו-b צדקו, c טעה, d ו-e לא ענו. */
const VOTES_1 = { a: 2, b: 1, c: 2, d: 3, e: 2 };
const VOTES_3 = { a: 2, b: 2, c: 1 };
/** שקופית 4: f הצטרף; בדאבל השני (6) חמישה מתוך שישה צדקו. */
const VOTES_4 = { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1 };
const VOTES_6 = { a: 3, b: 3, c: 3, d: 3, e: 3, f: 1 };

/** מנוע שמתקדם בעצמו: «play» פותח את ההצבעה בשקופית, מצביע וסוגר (→ תוצאות). */
function driver(game: GameFile) {
  const engine = new GameEngine(game);
  let now = T0;
  let seq = 0;
  const tick = () => (now += 1000);
  return {
    engine,
    play(slideId: number, votes: Record<string, number>): void {
      for (let guard = 0; ; guard += 1) {
        if (guard > 50) throw new Error(`לא הגענו להצבעה בשקופית ${slideId}`);
        const s = engine.getState();
        if (s.currentSlideId === slideId && s.phase === 'voting') break;
        if (s.activeMedia !== null) engine.dispatch({ type: 'MEDIA_ENDED', at: tick() });
        else engine.dispatch({ type: 'ADVANCE', at: tick() });
      }
      engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(++seq, slideId, votes), at: tick() });
      engine.dispatch({ type: 'ADVANCE', at: tick() }); // סגירת ההצבעה → תוצאות
    },
    /** עד סוף המשחק, בלי הצבעות (שאלה שהמנחה עבר עליה בלי שאיש ענה). */
    finish(): void {
      for (let guard = 0; engine.getState().phase !== 'ended'; guard += 1) {
        if (guard > 50) throw new Error('המשחק לא הסתיים');
        if (engine.getState().activeMedia !== null) engine.dispatch({ type: 'MEDIA_ENDED', at: tick() });
        else engine.dispatch({ type: 'ADVANCE', at: tick() });
      }
    },
  };
}

describe('הסכמה: double ו-doubleIntro', () => {
  it('נקראים מהקובץ; tickets חסר = false; סטטיסטיקה פגומה נזרקת בלי להפיל את השאלה', () => {
    const game = makeGame([
      intro(1, 1, 3),
      double(2, 1, { n: 1, of: 3, poolId: 'q-x' }),
      double(3, 1, { n: 2, of: 3, poolId: 'q-y', tickets: true, stats: { families: 'רבות' } }),
    ]);
    expect(game.questions[0]!.doubleIntro).toEqual({ n: 1, of: 3, tickets: true });
    expect(game.questions[1]!.double).toEqual({ n: 1, of: 3, poolId: 'q-x', tickets: false });
    expect(game.questions[2]!.double).toEqual({ n: 2, of: 3, poolId: 'q-y', tickets: true });
    expect(game.questions[2]!.question.answers).toHaveLength(4);
  });

  it('אובייקט פגום נזרק, והשקופית נשארת שקופית רגילה (כמו במנוע שלא מכיר את השדה)', () => {
    const game = parseGameFile(
      rawGame([
        { ...rawSlide({ id: 1, type: 'trivia', que: 'ש', answers: fourAnswers(1) }), double: { n: 'אחת' } },
        { ...rawSlide({ id: 2, type: 'subject', que: 'הכרזה' }), doubleIntro: 'כן' },
      ]),
    );
    expect(game.questions[0]!.double).toBeUndefined();
    expect(game.questions[1]!.doubleIntro).toBeUndefined();
    expect(isDoubleSlide(game.questions[0])).toBe(false);
    expect(isDoubleIntro(game.questions[1])).toBe(false);
  });

  it('דאבל רק על trivia, והכרזה רק על subject', () => {
    const game = makeGame([
      { ...rawSlide({ id: 1, type: 'survey', que: 'סקר', answers: fourAnswers(0) }), double: { n: 1, of: 1, poolId: 'p' } },
      { ...rawSlide({ id: 2, type: 'trivia', que: 'ש', answers: fourAnswers(1) }), doubleIntro: { n: 1, of: 1 } },
    ]);
    expect(isDoubleSlide(game.questions[0])).toBe(false);
    expect(isDoubleIntro(game.questions[1])).toBe(false);
    expect(isDoubleSlide(undefined)).toBe(false);
  });

  it('המשחק כולו: המזהים של כל מה שנוסף בשביל הדאבל, לפי הסדר', () => {
    expect(villaSlideIds(villaGame())).toEqual([2, 3, 5, 6]);
    expect(villaSlideIds(makeGame([rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1) })]))).toEqual([]);
  });
});

describe('doubleTickets — עד 10 כרטיסים לפי אחוז המשפחה שצדק', () => {
  it('מעוגל לכרטיס הקרוב, בין 0 ל-10', () => {
    expect(doubleTickets(0)).toBe(0);
    expect(doubleTickets(0.04)).toBe(0);
    expect(doubleTickets(1 / 3)).toBe(3);
    expect(doubleTickets(0.4)).toBe(4);
    expect(doubleTickets(0.5)).toBe(5);
    expect(doubleTickets(2 / 3)).toBe(7);
    expect(doubleTickets(1)).toBe(10);
  });
  it('ערכים לא תקינים → 0, ומעל 1 → 10', () => {
    expect(doubleTickets(-0.5)).toBe(0);
    expect(doubleTickets(Number.NaN)).toBe(0);
    expect(doubleTickets(Number.POSITIVE_INFINITY)).toBe(0);
    expect(doubleTickets(1.7)).toBe(10);
  });
});

describe('doubleResult — כמה מהמשפחה צדקו', () => {
  const game = villaGame();
  const votes = { 1: VOTES_1, 3: VOTES_3 };

  it('המשפחה = כל מי ששיחק עד השאלה (כולל), גם מי שלא ענה עליה', () => {
    expect(doubleResult(game, 2, votes)).toEqual({
      slideId: 3,
      poolId: 'q-a',
      n: 1,
      of: 2,
      correct: 2,
      base: 5,
      share: 0.4,
      tickets: 4,
      ticketsOpen: true,
      counts: true,
    });
  });

  it('מי שהמנחה הסיר לא נספר; עם 4 משתתפים זו הפעלת ניסיון', () => {
    const r = doubleResult(game, 2, votes, new Set(['e']))!;
    expect(r.base).toBe(4);
    expect(r.correct).toBe(2);
    expect(r.tickets).toBe(5);
    expect(r.counts).toBe(false);
    // מי שהוסר וצדק לא נספר גם בין הצודקים
    expect(doubleResult(game, 2, votes, new Set(['a']))!.correct).toBe(1);
  });

  it('מי שהצטרף אחרי השאלה לא נכנס למשפחה שלה', () => {
    const later = { ...votes, 4: VOTES_4 };
    expect(doubleResult(game, 2, later)!.base).toBe(5);
    expect(doubleResult(game, 5, { ...later, 6: VOTES_6 })).toMatchObject({ base: 6, correct: 5, tickets: 8 });
  });

  it('לא שאלת דאבל → null; שאלה בלי אף משתתף → 0 מתוך 0', () => {
    expect(doubleResult(game, 0, votes)).toBeNull();
    expect(doubleResult(game, 1, votes)).toBeNull();
    expect(doubleResult(game, 99, votes)).toBeNull();
    expect(doubleResult(game, 2, {})).toMatchObject({ correct: 0, base: 0, share: 0, tickets: 0, counts: false });
  });

  it('משחק שהשרת סגר לכרטיסים (tickets=false): אותה תוצאה, בלי כרטיסים שנספרים', () => {
    const r = doubleResult(villaGame(false), 2, votes)!;
    expect(r.tickets).toBe(4);
    expect(r.ticketsOpen).toBe(false);
    expect(r.counts).toBe(false);
  });

  it('הכרטיסים שנצברו עד עכשיו: רק שאלות דאבל שענו עליהן', () => {
    const all = { 1: VOTES_1, 3: VOTES_3, 4: VOTES_4, 6: VOTES_6 };
    expect(doubleTicketsSoFar(game, 2, all)).toBe(4);
    expect(doubleTicketsSoFar(game, 4, all)).toBe(4);
    expect(doubleTicketsSoFar(game, 5, all)).toBe(12);
    expect(doubleTicketsSoFar(game, 5, { 1: VOTES_1, 3: VOTES_3, 4: VOTES_4 })).toBe(4);
  });
});

describe('doubleComparison — שורת ההשוואה לשאר המשפחות', () => {
  it('בלי סטטיסטיקה, או פחות מ-5 משפחות → «מהמשפחות הראשונות»', () => {
    const first = 'אתם מהמשפחות הראשונות בארץ שענו על השאלה הזאת!';
    expect(doubleComparison(undefined, 4)).toBe(first);
    expect(doubleComparison({ families: 4, avg: 50, atLeast: [4, 4, 3, 3, 2, 2, 1, 1, 0, 0, 0] }, 4)).toBe(first);
  });
  it('תוצאה שרוב המשפחות לא הגיעו אליה → «רק X%»', () => {
    expect(doubleComparison(STATS_A, 4)).toBe('רק 45% מהמשפחות בארץ הגיעו לתוצאה כזאת!');
    expect(doubleComparison(STATS_A, 5)).toBe('רק 30% מהמשפחות בארץ הגיעו לתוצאה כזאת!');
    // אחוז קטן מאוד לא נכתב «0%»
    const many = { families: 1000, avg: 20, atLeast: [1000, 800, 600, 400, 200, 100, 50, 20, 10, 5, 3] };
    expect(doubleComparison(many, 10)).toBe('רק 1% מהמשפחות בארץ הגיעו לתוצאה כזאת!');
  });
  it('תוצאה שאף משפחה לא הגיעה אליה → «המשפחה הראשונה»', () => {
    expect(doubleComparison(STATS_A, 9)).toBe('אתם המשפחה הראשונה בארץ שהגיעה לתוצאה כזאת!');
  });
  it('תוצאה רגילה, או 0 כרטיסים → הממוצע הארצי', () => {
    const avg = 'בממוצע 42% מבני המשפחה בכל הארץ ענו נכון על השאלה הזאת';
    expect(doubleComparison(STATS_A, 1)).toBe(avg);
    expect(doubleComparison(STATS_A, 0)).toBe(avg);
  });
});

describe('doubleView ו-doubleTicketLines — מה שמסך «תוצאת הדאבל» מציג', () => {
  const game = villaGame();

  it('הדאבל הראשון: 2 מתוך 5, 4 כרטיסים, וההשוואה', () => {
    const view = doubleView(game, 2, { 1: VOTES_1, 3: VOTES_3 })!;
    expect(view).toEqual({
      n: 1,
      of: 2,
      correct: 2,
      base: 5,
      tickets: 4,
      ticketsOpen: true,
      counts: true,
      soFar: 4,
      comparison: 'רק 45% מהמשפחות בארץ הגיעו לתוצאה כזאת!',
    });
    expect(doubleTicketLines(view)).toEqual({ main: 'קיבלתם עוד 4 כרטיסים להגרלת הווילה!', note: null });
  });

  it('הדאבל השני: הכרטיסים שנצברו בכל שאלות הדאבל', () => {
    const view = doubleView(game, 5, { 1: VOTES_1, 3: VOTES_3, 4: VOTES_4, 6: VOTES_6 })!;
    expect(view).toMatchObject({ n: 2, correct: 5, base: 6, tickets: 8, soFar: 12 });
    expect(view.comparison).toBe('אתם מהמשפחות הראשונות בארץ שענו על השאלה הזאת!');
    expect(doubleTicketLines(view)).toEqual({
      main: 'קיבלתם עוד 8 כרטיסים להגרלת הווילה!',
      note: 'עד עכשיו צברתם 12 כרטיסים בשאלות הדאבל',
    });
  });

  it('אין מה להציג: לא דאבל, או שאיש עוד לא שיחק', () => {
    expect(doubleView(game, 0, { 1: VOTES_1 })).toBeNull();
    expect(doubleView(game, 2, {})).toBeNull();
  });

  const view = (over: Partial<DoubleView>): DoubleView => ({
    n: 1,
    of: 3,
    correct: 0,
    base: 6,
    tickets: 0,
    ticketsOpen: true,
    counts: true,
    soFar: 0,
    comparison: '',
    ...over,
  });

  it('0 כרטיסים: «עוד מחכות לכם» רק כשיש עוד שאלות דאבל', () => {
    expect(doubleTicketLines(view({ n: 1 }))!.main).toBe('הפעם בלי כרטיסים, אבל עוד מחכות לכם שאלות דאבל!');
    expect(doubleTicketLines(view({ n: 3 }))!.main).toBe('הפעם בלי כרטיסים נוספים');
  });

  it('כרטיס אחד בלשון יחיד, גם בסיכום', () => {
    expect(doubleTicketLines(view({ n: 2, tickets: 1, soFar: 1 }))).toEqual({
      main: 'קיבלתם עוד כרטיס להגרלת הווילה!',
      note: 'עד עכשיו צברתם כרטיס אחד בשאלות הדאבל',
    });
    // בלי כרטיסים שנצברו — בלי שורת סיכום
    expect(doubleTicketLines(view({ n: 2, tickets: 0, soFar: 0 }))!.note).toBeNull();
  });

  it('עד 4 משתתפים: כמה זה היה שווה, והסבר (בלי «הפעלת ניסיון»: שאלות הדאבל מופיעות פעם אחת)', () => {
    const note = 'כשמשתתפים עד 4, הכרטיסים להגרלת הווילה לא נספרים';
    expect(doubleTicketLines(view({ counts: false, base: 4, tickets: 5 }))).toEqual({
      main: 'עם יותר מ-4 משתתפים זה היה שווה 5 כרטיסים',
      note,
    });
    expect(doubleTicketLines(view({ counts: false, tickets: 1 }))!.main).toContain('שווה כרטיס אחד');
    expect(doubleTicketLines(view({ counts: false, tickets: 0 }))!.main).toContain('שווה אף כרטיס');
  });

  it('תרועה רק כשהכרטיסים באמת נוספים', () => {
    expect(doubleWinsTickets(view({ tickets: 3 }))).toBe(true);
    expect(doubleWinsTickets(view({ tickets: 0 }))).toBe(false);
    expect(doubleWinsTickets(view({ tickets: 3, counts: false }))).toBe(false);
    expect(doubleWinsTickets(view({ tickets: 3, counts: false, ticketsOpen: false }))).toBe(false);
    expect(doubleWinsTickets(null)).toBe(false);
  });

  it('משחק שכבר אינו יכול לזכות: בלי שום שורה על כרטיסים', () => {
    expect(doubleTicketLines(view({ ticketsOpen: false, counts: false, tickets: 7 }))).toBeNull();
    expect(doubleView(villaGame(false), 2, { 1: VOTES_1, 3: VOTES_3 })!.ticketsOpen).toBe(false);
  });
});

describe('הטקסטים של מסך ההכרזה ושל התג', () => {
  it('הכותרת והמונה', () => {
    expect(doubleTitle(3, 10)).toBe('שאלת דאבל 3 מתוך 10');
    const lines = doubleIntroLines({ n: 3, of: 10, tickets: true });
    expect(lines.title).toBe('שאלת דאבל');
    expect(lines.counter).toBe('3 מתוך 10');
    expect(lines.lines).toEqual([
      'שאלה קשה במיוחד, עם ניקוד כפול!',
      'ככל שיותר מכם יענו נכון, כך תקבלו יותר כרטיסים להגרלת הווילה: עד 10 בשאלה',
    ]);
  });
  it('בלי כרטיסים — בלי המשפט על ההגרלה', () => {
    expect(doubleIntroLines({ n: 1, of: 2, tickets: false }).lines).toEqual(['שאלה קשה במיוחד, עם ניקוד כפול!']);
  });
});

describe('הגיבוי: meta.villaDoubles ו-meta.villaSlides', () => {
  it('שאלת דאבל שההצבעה בה נסגרה נכנסת, עם מסך ההכרזה שלפניה', () => {
    const game = villaGame();
    const d = driver(game);
    d.play(1, VOTES_1);
    d.play(3, VOTES_3);
    const p = buildBackupPayload(game, d.engine.getState(), EMPTY_ROSTER, (id) => id, 42);
    expect(p.meta.villaSlides).toEqual([2, 3, 5, 6]);
    expect(p.meta.villaDoubles).toEqual([
      {
        slideId: 3,
        introSlideId: 2,
        poolId: 'q-a',
        n: 1,
        correct: 2,
        base: 5,
        tickets: 4,
        que: 'שאלה קשה 1',
        answers: fourAnswers(2),
      },
    ]);
    // מי שהוסר לא נספר גם בגיבוי
    const removed = buildBackupPayload(game, d.engine.getState(), EMPTY_ROSTER, (id) => id, 42, ['e']);
    expect(removed.meta.villaDoubles![0]).toMatchObject({ base: 4, tickets: 5 });
  });

  it('בזמן ההצבעה עצמה השאלה עוד לא נכנסת', () => {
    const game = villaGame();
    const d = driver(game);
    d.play(1, VOTES_1);
    // מתקדמים עד שההצבעה בשאלת הדאבל נפתחת, ועוצרים שם
    while (!(d.engine.getState().currentSlideId === 3 && d.engine.getState().phase === 'voting')) {
      d.engine.dispatch({ type: 'ADVANCE', at: T0 });
    }
    const p = buildBackupPayload(game, d.engine.getState(), EMPTY_ROSTER, (id) => id, 42);
    expect(p.meta.villaSlides).toEqual([2, 3, 5, 6]);
    expect(p.meta.villaDoubles).toBeUndefined();
  });

  it('סוף המשחק: גם שאלת דאבל שאיש לא ענה עליה, עם 0 מתוך המשפחה', () => {
    const game = villaGame();
    const d = driver(game);
    d.play(1, VOTES_1);
    d.play(3, VOTES_3);
    d.play(4, VOTES_4);
    d.finish();
    const state = d.engine.getState();
    expect(villaDoublesMeta(game, state).map((m) => [m.slideId, m.introSlideId, m.correct, m.base, m.tickets])).toEqual([
      [3, 2, 2, 5, 4],
      [6, 5, 0, 6, 0],
    ]);
  });

  it('משחק בלי שאלות דאבל: המטא בדיוק כמו קודם', () => {
    const game = makeGame([rawSlide({ id: 1, type: 'trivia', que: 'ש', answers: fourAnswers(1), scoreForQue: 10, timeForQue: 15 })]);
    const d = driver(game);
    d.play(1, { a: 1 });
    const p = buildBackupPayload(game, d.engine.getState(), EMPTY_ROSTER, (id) => id, 42);
    expect(p.meta).toEqual({ currentQueId: 1, phase: 'results', startedAt: 42 });
  });

  it('שחזור מגיבוי מחשב את אותה תוצאה מההצבעות (המטא עצמו אינו משוחזר)', () => {
    const game = villaGame();
    const d = driver(game);
    d.play(1, VOTES_1);
    d.play(3, VOTES_3);
    const p = buildBackupPayload(game, d.engine.getState(), EMPTY_ROSTER, (id) => id, 42);
    const data: BackupData = { id: 'g', ...p, completed: false };
    const restored = new GameEngine(game);
    restored.restore(backupToSnapshot(game, data));
    expect(doubleResult(game, 2, restored.getState().votesBySlide)).toEqual(
      doubleResult(game, 2, d.engine.getState().votesBySlide),
    );
  });
});

describe('פעם אחת: run, משחק בלי שאלות הדאבל, הפעלה חדשה והמשך', () => {
  const R = 1_764_115_200_123;
  const bound = (run: unknown): GameFile =>
    makeGame([
      rawSlide({ id: 1, type: 'trivia', que: 'ש1', answers: fourAnswers(2), scoreForQue: 10, timeForQue: 15 }),
      { ...intro(2, 1, 1), doubleIntro: { n: 1, of: 1, tickets: true, run } },
      double(3, 2, { n: 1, of: 1, poolId: 'q-a', tickets: true, run }),
      rawSlide({ id: 4, type: 'trivia', que: 'ש4', answers: fourAnswers(1), scoreForQue: 10, timeForQue: 15 }),
    ]);
  /** גיבוי של הפעלה על הקובץ `game` שעצרה אחרי ש-`plays` שוחקו (ונשארה בתוצאות של האחרונה). */
  const backupOf = (game: GameFile, startedAt: number, plays: Array<[number, Record<string, number>]>): BackupData => {
    const d = driver(game);
    for (const [slideId, votes] of plays) d.play(slideId, votes);
    return { id: 'g', ...buildBackupPayload(game, d.engine.getState(), EMPTY_ROSTER, (id) => id, startedAt), completed: false };
  };

  it('הסכמה: run מספר או מחרוזת של ספרות; ערך פגום → 1- (אף הפעלה), וחסר → בלי run', () => {
    expect(bound(R).questions[2]!.double!.run).toBe(R);
    expect(bound(R).questions[1]!.doubleIntro!.run).toBe(R);
    expect(bound(String(R)).questions[2]!.double!.run).toBe(R);
    expect(bound('אתמול').questions[2]!.double!.run).toBe(-1);
    expect(bound(-5).questions[1]!.doubleIntro!.run).toBe(-1);
    expect(villaGame().questions[2]!.double!.run).toBeUndefined();
    // השקופית עצמה נשארת שאלת דאבל גם כש-run פגום
    expect(isDoubleSlide(bound('אתמול').questions[2])).toBe(true);
  });

  it('villaRunOf: null כשהן פתוחות לכל הפעלה, ההפעלה כשהן קשורות, ו-1- כשהשקופיות לא מסכימות', () => {
    expect(villaRunOf(villaGame())).toBeNull();
    expect(villaRunOf(bound(R))).toBe(R);
    const mixed = makeGame([
      { ...intro(1, 1, 2), doubleIntro: { n: 1, of: 2, run: R } },
      double(2, 1, { n: 1, of: 2, poolId: 'q-a', run: R + 1 }),
    ]);
    expect(villaRunOf(mixed)).toBe(-1);
  });

  it('stripVillaSlides: הקובץ בלי ההכרזות והשאלות, ממוספר מחדש 1..N כמו קובץ שהשרת שולח בלי דאבל', () => {
    const game = villaGame();
    const stripped = stripVillaSlides(game);
    expect(stripped.questions.map((q) => [q.id, q.question.que])).toEqual([
      [1, 'ש1'],
      [2, 'ש4'],
    ]);
    expect(hasVillaSlides(stripped)).toBe(false);
    expect(stripped.id).toBe(game.id);
    // הקובץ המקורי לא השתנה, וקובץ בלי דאבל חוזר כמו שהוא
    expect(villaSlideIds(game)).toEqual([2, 3, 5, 6]);
    expect(stripVillaSlides(stripped)).toBe(stripped);
    // מזהים שאינם המקום נשארים כמו שהם
    const odd = makeGame([
      rawSlide({ id: 10, type: 'trivia', que: 'א', answers: fourAnswers(1) }),
      intro(20, 1, 1),
      double(30, 1, { n: 1, of: 1, poolId: 'q-a' }),
      rawSlide({ id: 40, type: 'trivia', que: 'ב', answers: fourAnswers(1) }),
    ]);
    expect(stripVillaSlides(odd).questions.map((q) => q.id)).toEqual([10, 40]);
  });

  it('הפעלה בלי שאלות הדאבל: הגיבוי שלה זהה לגיבוי של משחק שאין לו (בלי villaSlides, והשרת לא רואה כלום)', () => {
    const stripped = stripVillaSlides(villaGame());
    const plain = makeGame([
      rawSlide({ id: 1, type: 'trivia', que: 'ש1', answers: fourAnswers(2), scoreForQue: 10, timeForQue: 15 }),
      rawSlide({ id: 2, type: 'trivia', que: 'ש4', answers: fourAnswers(1), scoreForQue: 10, timeForQue: 15 }),
    ]);
    const run = (game: GameFile) => {
      const d = driver(game);
      d.play(1, VOTES_1);
      d.play(2, VOTES_4);
      return buildBackupPayload(game, d.engine.getState(), EMPTY_ROSTER, (id) => id, 42);
    };
    expect(run(stripped)).toEqual(run(plain));
    expect(run(stripped).meta.villaSlides).toBeUndefined();
  });

  it('meta.villaPool: מזהי השאלות במאגר, כדי שהשרת יידע איזו תוכנית ההפעלה משחקת עוד לפני שנסגרה שאלה', () => {
    expect(villaPoolIds(villaGame())).toEqual(['q-a', 'q-b']);
    const d = driver(villaGame());
    d.play(1, VOTES_1);
    const p = buildBackupPayload(villaGame(), d.engine.getState(), EMPTY_ROSTER, (id) => id, 42);
    expect(p.meta.villaPool).toEqual(['q-a', 'q-b']);
    expect(p.meta.villaDoubles).toBeUndefined();
  });

  it('villaReachedIn: ההכרזה עוד לא; שאלת דאבל על המסך כן (כמו display בגיבוי)', () => {
    const game = villaGame();
    const d = driver(game);
    expect(villaReachedIn(game, d.engine.getState())).toBe(false);
    d.play(1, VOTES_1);
    while (d.engine.getState().currentSlideId !== 2) d.engine.dispatch({ type: 'ADVANCE', at: T0 });
    expect(villaReachedIn(game, d.engine.getState())).toBe(false); // ההכרזה
    while (d.engine.getState().currentSlideId !== 3) d.engine.dispatch({ type: 'ADVANCE', at: T0 });
    expect(d.engine.getState().phase).not.toBe('voting'); // עוד לפני ההצבעה
    expect(villaReachedIn(game, d.engine.getState())).toBe(true);
    // ובגיבוי של אותו רגע השאלה מסומנת display, ולכן גם השרת יודע
    const p = buildBackupPayload(game, d.engine.getState(), EMPTY_ROSTER, (id) => id, 42);
    expect(p.questions['3']!.display).toBe(true);
    expect(p.questions['2']).toBeUndefined(); // ההכרזה אינה שאלה
  });

  it('הפעלה חדשה משחקת אותן רק כשהן פתוחות, בלי שחקני דמה, כשעוד לא הופיעו בחלון ובלי «ניסיון»', () => {
    const open = villaGame();
    const base = { run: null, crowd: false, reachedHere: false };
    expect(villaNewRunPlays(open, base)).toBe(true);
    expect(villaNewRunPlays(open, { ...base, run: R })).toBe(false);
    expect(villaNewRunPlays(open, { ...base, crowd: true })).toBe(false);
    expect(villaNewRunPlays(open, { ...base, reachedHere: true })).toBe(false);
    expect(villaNewRunPlays(open, { ...base, declined: true })).toBe(false);
    expect(villaNewRunPlays(stripVillaSlides(open), base)).toBe(false);
  });

  it('המשך: קובץ פתוח — רק הפעלה ששיחקה בדיוק אותן שקופיות ממשיכה איתן', () => {
    const game = villaGame();
    const played = backupOf(game, 7, [[1, VOTES_1]]);
    expect(villaResume(game, played.meta)).toEqual({ play: true, drop: false });
    // הפעלה שהתחילה בלעדיהן ממשיכה בלעדיהן
    const without = backupOf(stripVillaSlides(game), 7, [[1, VOTES_1]]);
    expect(villaResume(game, without.meta)).toEqual({ play: false, drop: false });
    // הפעלה ששיחקה תוכנית אחרת (שקופיות אחרות) ממשיכה בלי דאבל, ויורדת מהן בגיבוי
    expect(villaResume(game, { ...played.meta, villaSlides: [2, 3] })).toEqual({ play: false, drop: true });
  });

  it('המשך: קובץ שקשור להפעלה — רק אותה הפעלה, ורק אם שיחקה אותן', () => {
    const game = bound(R);
    const mine = backupOf(game, R, [[1, VOTES_1]]);
    expect(villaResume(game, mine.meta)).toEqual({ play: true, drop: false });
    expect(villaResume(game, { ...mine.meta, startedAt: R + 1 })).toEqual({ play: false, drop: true });
    const without = backupOf(stripVillaSlides(game), R, [[1, VOTES_1]]);
    expect(villaResume(game, without.meta)).toEqual({ play: false, drop: false });
    // קובץ בלי שאלות דאבל, וגיבוי ששיחק אותן: ממשיכים בלעדיהן
    expect(villaResume(stripVillaSlides(game), mine.meta)).toEqual({ play: false, drop: true });
  });

  it('backupWithoutVillas: ההפעלה ממשיכה על הקובץ בלי הדאבל, עם המזהים, ההצבעות והמיקום הנכונים', () => {
    const game = villaGame();
    const saved = backupOf(game, 7, [
      [1, VOTES_1],
      [3, VOTES_3],
      [4, VOTES_4],
    ]);
    const data = backupWithoutVillas(saved);
    expect(data.meta.villaSlides).toBeUndefined();
    expect(data.meta.villaPool).toBeUndefined();
    expect(data.meta.villaDoubles).toBeUndefined();
    expect(data.meta.startedAt).toBe(7);
    expect(data.meta.currentQueId).toBe(2); // שקופית 4 היא השנייה בקובץ בלי הדאבל
    expect(Object.keys(data.questions).sort()).toEqual(['1', '2']);
    expect(data.questions['2']!.queId).toBe(2);
    expect(data.users.a!.details.votes).toEqual({ '1': 2, '2': 1 });
    expect(data.users.f!.details).toMatchObject({ lastQue: 2, votes: { '2': 1 } });
    // הניקוד נשאר, כולל מה שהושג בדאבל
    expect(data.users.a!.score).toBe(saved.users.a!.score);

    const stripped = stripVillaSlides(game);
    const engine = new GameEngine(stripped);
    engine.restore(backupToSnapshot(stripped, data));
    const st = engine.getState();
    expect(st.currentSlideId).toBe(2);
    expect(engine.getCurrentSlide().question.que).toBe('ש4');
    expect(st.votesBySlide[1]).toEqual(VOTES_1);
    expect(st.votesBySlide[2]).toEqual(VOTES_4);
    expect(st.slidesCompleted).toEqual([1]);
  });

  it('backupWithoutVillas: הפעלה שנעצרה על הכרזה או על שאלת דאבל ממשיכה מהשקופית שאחריה, מההתחלה', () => {
    const game = villaGame();
    const saved = backupOf(game, 7, [
      [1, VOTES_1],
      [3, VOTES_3],
    ]);
    expect(saved.meta.currentQueId).toBe(3);
    const onDouble = backupWithoutVillas(saved);
    expect(onDouble.meta).toMatchObject({ currentQueId: 2, phase: 'showing' });
    const onIntro = backupWithoutVillas({ ...saved, meta: { ...saved.meta, currentQueId: 5, phase: 'showing' } });
    expect(onIntro.meta).toMatchObject({ currentQueId: 3, phase: 'showing' }); // אחרי 5 ו-6 אין עוד שקופית: 3 אינו בקובץ
    const stripped = stripVillaSlides(game);
    const engine = new GameEngine(stripped);
    engine.restore(backupToSnapshot(stripped, onDouble));
    expect(engine.getState()).toMatchObject({ currentSlideId: 2, phase: 'showing' });
    expect(engine.getState().votesBySlide[1]).toEqual(VOTES_1);
    // גיבוי בלי שקופיות דאבל חוזר כמו שהוא
    const plain = backupOf(stripped, 7, [[1, VOTES_1]]);
    expect(backupWithoutVillas(plain)).toBe(plain);
  });

  it('backupWithoutVillas: הימורים והכרעות «הרוב קובע» עוברים למזהים החדשים', () => {
    const saved = backupOf(villaGame(), 7, [[1, VOTES_1]]);
    const data = backupWithoutVillas({
      ...saved,
      meta: {
        ...saved.meta,
        betStakes: { '4': { a: 10 }, '3': { b: 5 } },
        betOutcomes: { '4': { a: { stake: 10, won: true, delta: 10, answerId: 1 } } },
        majorityBySlide: { '4': [1], '6': [2] },
      },
    });
    expect(data.meta.betStakes).toEqual({ '2': { a: 10 } });
    expect(data.meta.betOutcomes).toEqual({ '2': { a: { stake: 10, won: true, delta: 10, answerId: 1 } } });
    expect(data.meta.majorityBySlide).toEqual({ '2': [1] });
  });
});

describe('טבלת המובילים האוטומטית — שאלות הדאבל אינן נספרות', () => {
  it('«טבלה אחרי כל N שאלות» נשאר לפי השאלות שהבונה הכניס', () => {
    const game = villaGame();
    expect(completedQuestionCount(game, [1, 2, 3])).toBe(1);
    expect(completedQuestionCount(game, [1, 2, 3, 4, 5, 6])).toBe(2);
  });
});

describe('רמזי המנחה — תוצאת הדאבל בין «ענו נכון» לתוצאות ההימור', () => {
  const base: HostHintInput = {
    phase: 'results',
    activeMedia: null,
    slideType: 'trivia',
    votable: true,
    totalAnswers: 4,
    questionShown: true,
    answersShown: 4,
    revealCorrect: true,
    hasNextSlide: true,
  };
  const space = (a: Partial<HostHintInput>) => hostKeyHints({ ...base, ...a })[0]!.label;

  it('אחרי החשיפה הרווח פותח את תוצאת הדאבל; פתוחה → סוגר וממשיך', () => {
    expect(space({ doublePending: true })).toBe('תוצאת הדאבל');
    expect(space({ doubleOverlay: true })).toBe('המשך (סגירת תוצאת הדאבל)');
    // לפני החשיפה — החשיפה קודמת
    expect(space({ revealCorrect: false, doublePending: true })).toBe('חשיפת התשובה הנכונה');
  });
  it('הסדר: «כל מי שענה נכון», אחריו הדאבל, ואחריו ההימור', () => {
    expect(space({ correctPending: true, doublePending: true })).toBe('כל מי שענה נכון');
    expect(space({ correctOverlay: true, doublePending: true })).toBe('תוצאת הדאבל');
    expect(space({ doublePending: true, betPending: true })).toBe('תוצאת הדאבל');
    expect(space({ doubleOverlay: true, betPending: true })).toBe('תוצאות ההימור');
  });
});

describe('מסך הצפייה — בלי מזהה השאלה ובלי הסטטיסטיקה, והתוצאה רק אחרי החשיפה', () => {
  function liveInput(engine: GameEngine, over: Partial<LiveHostInput> = {}): LiveHostInput {
    return {
      stage: 'playing',
      game: engine.getGame(),
      state: engine.getState(),
      reveal: { questionShown: true, answersShown: 4, revealCorrect: false },
      timer: null,
      players: [],
      leaders: [],
      lobby: [],
      nameOf: (id) => id,
      roster: EMPTY_ROSTER,
      groupBonus: {},
      join: { show: false, code: '', qrUrl: null },
      overlays: {
        leaders: false,
        votes: false,
        lobby: false,
        bet: false,
        groups: null,
        board: null,
        connect: null,
        raffle: null,
      },
      winnersRevealed: 0,
      scoresPage: 0,
      functionStatus: 'idle',
      functionDetail: '',
      paused: false,
      mediaStartedAt: null,
      sound: SILENCE,
      cues: [],
      applause: null,
      revealThumb: null,
      video: null,
      groupRail: null,
      ...over,
    };
  }

  it('מסך ההכרזה עובר עם המספור בלבד', () => {
    const d = driver(villaGame());
    d.play(1, VOTES_1);
    d.engine.dispatch({ type: 'ADVANCE', at: T0 }); // → מסך ההכרזה
    expect(d.engine.getState().currentSlideId).toBe(2);
    const snap = new LiveSnapshotBuilder().build(liveInput(d.engine));
    expect(snap.game.slides['1']!.doubleIntro).toEqual({ n: 1, of: 2, tickets: true });
  });

  it('שאלת הדאבל: n, of ו-tickets; poolId ריק ובלי הסטטיסטיקה', () => {
    const d = driver(villaGame());
    d.play(1, VOTES_1);
    d.play(3, VOTES_3);
    const view = doubleView(d.engine.getGame(), 2, d.engine.getState().votesBySlide)!;
    const builder = new LiveSnapshotBuilder();
    const overlays = { ...liveInput(d.engine).overlays, double: view };
    const before = builder.build(liveInput(d.engine, { overlays }));
    expect(before.game.slides['2']!.double).toEqual({ n: 1, of: 2, poolId: '', tickets: true });
    expect(before.overlays.double).toBeNull();
    const json = JSON.stringify(before);
    expect(json).not.toContain('q-a');
    expect(json).not.toContain('atLeast');

    const after = builder.build(
      liveInput(d.engine, {
        overlays,
        reveal: { questionShown: true, answersShown: 4, revealCorrect: true },
      }),
    );
    expect(after.overlays.double).toEqual(view);
    const closed = builder.build(
      liveInput(d.engine, { reveal: { questionShown: true, answersShown: 4, revealCorrect: true } }),
    );
    expect(closed.overlays.double).toBeNull();
  });
});
