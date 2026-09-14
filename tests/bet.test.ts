/**
 * שקופית הימור (bet.ts + המנוע): גובה ההימור, איתור השקופית המכריעה, ההכרעה,
 * הפיכות בחזרה אחורה, איפוס/הסרה, ו-snapshot.
 */

import { describe, expect, it } from 'vitest';
import {
  GameEngine,
  betOutcomeSummary,
  betSlideFor,
  betSummary,
  describeBetOption,
  describeBetOptionShort,
  parseGameFile,
  resolveBets,
  resolvesBet,
  stakeFor,
  stakesFor,
  type GameFile,
} from '../src/engine/index.ts';
import type { BetConfig } from '../src/engine/bet.ts';
import { fourAnswers, makeGame, makeSnapshot, rawGame, rawSlide, runFullGame } from './helpers.ts';

const T0 = 1_000_000;

const CLASSIC: BetConfig = {
  options: [{ kind: 'none' }, { kind: 'percent', value: 25 }, { kind: 'percent', value: 50 }, { kind: 'all' }],
  payout: 1,
  allowNegative: false,
};

const BET_ANSWERS = [
  { ans: 'בלי הימור', correct: false, id: 1 },
  { ans: 'רבע', correct: false, id: 2 },
  { ans: 'חצי', correct: false, id: 3 },
  { ans: 'הכול!', correct: false, id: 4 },
];

/** שקופית הימור גולמית (כפי שהבנאי מייצא) עם קונפיג נתון. */
function rawBet(id: number, bet: Record<string, unknown> = CLASSIC as unknown as Record<string, unknown>) {
  return {
    ...rawSlide({ id, type: 'trivia', que: 'על כמה אתם מהמרים?', answers: BET_ANSWERS, scoreForQue: '', timeForQue: 15 }),
    type: 'bet',
    bet,
  };
}

/** משחק: טריוויה (10 נק׳) → הימור → טריוויה (נכונה 2, 10 נק׳) → מדיה. */
function betGame(extra: Record<string, unknown> = {}): GameFile {
  return makeGame([
    rawSlide({ id: 1, type: 'trivia', que: 'ש1', answers: fourAnswers(1), scoreForQue: 10, timeForQue: 15 }),
    rawBet(2, { ...CLASSIC, ...extra }),
    rawSlide({ id: 3, type: 'trivia', que: 'ש3', answers: fourAnswers(2), scoreForQue: 10, timeForQue: 15 }),
    rawSlide({ id: 4, type: 'media', openMediaSrc: 'https://x.dev/v.mp4' }),
  ]);
}

/** מריץ שקופית הצבעה אחת: פתיחה → snapshot → סגירה. מניח שהמנוע ב-showing של השקופית. */
function vote(engine: GameEngine, votes: Record<string, number>, at = T0): void {
  engine.dispatch({ type: 'OPEN_VOTING', at });
  const slide = engine.getCurrentSlide();
  engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, slide.id, votes), at: at + 1000 });
  engine.dispatch({ type: 'VOTING_TIMEOUT', at: at + 5000 });
}

/** מריץ את שלוש השקופיות: ש1 (a,b,c,d לפי votes1), הימור (bets), ש3 (votes3). */
function play(
  engine: GameEngine,
  votes1: Record<string, number>,
  bets: Record<string, number>,
  votes3: Record<string, number>,
): void {
  vote(engine, votes1); // שקופית 1
  engine.dispatch({ type: 'ADVANCE', at: T0 + 6000 }); // → הימור
  vote(engine, bets, T0 + 7000);
  engine.dispatch({ type: 'ADVANCE', at: T0 + 13000 }); // → שקופית 3
  vote(engine, votes3, T0 + 14000);
}

describe('סכימה — שקופית bet', () => {
  it('★ נטענת בקפדנות עם הקונפיג, והאפשרויות מיושרות לכרטיסים', () => {
    const game = betGame();
    const bet = game.questions[1]!;
    expect(bet.type).toBe('bet');
    expect(bet.bet?.options.map((o) => o.kind)).toEqual(['none', 'percent', 'percent', 'all']);
    expect(bet.bet?.payout).toBe(1);
    expect(bet.bet?.allowNegative).toBe(false);
    // "" בניקוד = כלל הריקון, לא ניקוד חסר — הימור אינו מנוקד
    expect(bet.question.scoreForQue).toBe(0);
    expect(bet.question.timeForQue).toBe(15);
  });

  it('קונפיג חסר או קצר מושלם ב"בלי הימור"; ארוך מדי נקצץ', () => {
    const short = makeGame([{ ...rawBet(1), bet: { options: [{ kind: 'all' }] } }]).questions[0]!;
    expect(short.bet?.options.map((o) => o.kind)).toEqual(['all', 'none', 'none', 'none']);
    const missing = makeGame([{ ...rawBet(1), bet: undefined }]).questions[0]!;
    expect(missing.bet?.options).toHaveLength(4);
    expect(missing.bet?.options.every((o) => o.kind === 'none')).toBe(true);
    const long = makeGame([
      { ...rawBet(1), bet: { options: [1, 2, 3, 4, 5].map(() => ({ kind: 'all' })) } },
    ]).questions[0]!;
    expect(long.bet?.options).toHaveLength(4);
  });

  it('"" במכפיל/ערך מנורמל (כלל הריקון), ומכפיל לכל אפשרות נשמר', () => {
    const g = makeGame([
      { ...rawBet(1), bet: { options: [{ kind: 'none' }, { kind: 'percent', value: '' }, { kind: 'fixed', value: 50, payout: 2 }, { kind: 'all', payout: '' }], payout: '' } },
    ]);
    const b = g.questions[0]!.bet!;
    expect(b.payout).toBe(1);
    expect(b.options[1]).toMatchObject({ kind: 'percent', value: 0 });
    expect(b.options[2]).toMatchObject({ kind: 'fixed', value: 50, payout: 2 });
    expect(b.options[3]).toMatchObject({ kind: 'all', payout: 1 });
  });

  it('פחות משתי אפשרויות — נדחית כמו כל שקופית מצביעה', () => {
    const oneCard = {
      ...rawSlide({ id: 1, type: 'trivia', que: 'הימור', answers: [BET_ANSWERS[0]!], scoreForQue: '', timeForQue: 15 }),
      type: 'bet',
      bet: CLASSIC as unknown as Record<string, unknown>,
    };
    expect(() => makeGame([oneCard])).toThrow();
  });

  it('קובץ בלי שקופיות הימור נטען כרגיל (השדות החדשים ב-state ריקים)', () => {
    const engine = new GameEngine(makeGame([rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1) })]));
    expect(engine.getState().betStakes).toEqual({});
    expect(engine.getState().betOutcomes).toEqual({});
  });
});

describe('stakeFor / stakesFor — גובה ההימור', () => {
  it('★ אחוז ו"הכול" נגזרים מהניקוד, מעוגלים למטה; "בלי" = 0', () => {
    expect(stakeFor({ kind: 'percent', value: 25 }, 30)).toBe(7);
    expect(stakeFor({ kind: 'percent', value: 50 }, 31)).toBe(15);
    expect(stakeFor({ kind: 'all' }, 42)).toBe(42);
    expect(stakeFor({ kind: 'none' }, 42)).toBe(0);
    expect(stakeFor(null, 42)).toBe(0);
  });

  it('סכום קבוע אינו תלוי בניקוד — גם מי שבלי נקודות יכול להמר', () => {
    expect(stakeFor({ kind: 'fixed', value: 100 }, 0)).toBe(100);
    expect(stakeFor({ kind: 'fixed', value: 100 }, 30)).toBe(100);
  });

  it('ניקוד 0 או שלילי → אחוז/הכול נותנים 0; ערכים מחוץ לטווח נחתכים', () => {
    expect(stakeFor({ kind: 'all' }, 0)).toBe(0);
    expect(stakeFor({ kind: 'all' }, -5)).toBe(0);
    expect(stakeFor({ kind: 'percent', value: 250 }, 10)).toBe(10);
    expect(stakeFor({ kind: 'percent', value: -5 }, 10)).toBe(0);
    expect(stakeFor({ kind: 'fixed', value: -5 }, 10)).toBe(0);
  });

  it('stakesFor רושם רק מי ששם משהו על הכף', () => {
    const stakes = stakesFor(CLASSIC, { a: 4, b: 1, c: 3, d: 2 }, { a: 100, b: 100, c: 100 });
    expect(stakes).toEqual({ a: 100, c: 50 }); // b בלי הימור, d בלי נקודות
  });
});

describe('betSlideFor — על מה ההימור חל', () => {
  const game = makeGame([
    rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1) }),
    rawBet(2),
    rawSlide({ id: 3, type: 'subject', que: 'הפסקה' }),
    rawSlide({ id: 4, type: 'survey', answers: fourAnswers(0) }),
    rawSlide({ id: 5, type: 'trivia', answers: fourAnswers(1) }),
    rawSlide({ id: 6, type: 'trivia', answers: fourAnswers(1) }),
    rawBet(7),
    rawBet(8),
    rawSlide({ id: 9, type: 'trivia', answers: fourAnswers(1) }),
    rawBet(10),
  ]);
  const idAt = (i: number) => betSlideFor(game, i)?.id ?? null;

  it('★ מדלג על טקסט וסקר ומגיע להימור; שאלה מנוקדת ביניהם עוצרת', () => {
    expect(idAt(4)).toBe(2); // ש5 — ההימור מעבר להפסקה ולסקר
    expect(idAt(5)).toBeNull(); // ש6 — ש5 כבר ניצלה את ההימור
    expect(idAt(0)).toBeNull();
  });

  it('שני הימורים ברצף — הקרוב לשאלה קובע', () => {
    expect(idAt(8)).toBe(8);
  });

  it('resolvesBet — רק שאלה מנוקדת עם הימור לפניה', () => {
    expect(resolvesBet(game, 4)).toBe(true);
    expect(resolvesBet(game, 3)).toBe(false); // סקר
    expect(resolvesBet(game, 5)).toBe(false);
    expect(resolvesBet(game, 9)).toBe(false); // הימור בסוף — אין מה שיכריע
  });
});

describe('resolveBets — ההכרעה', () => {
  const correct = new Set([2]);
  it('★ נכון = +הימור, טעה = −הימור, לא ענה = −הימור', () => {
    const out = resolveBets({
      stakes: { a: 50, b: 50, c: 50 },
      betVotes: { a: 3, b: 3, c: 3 },
      config: CLASSIC,
      finalVotes: { a: 2, b: 1 },
      correctIds: correct,
      scores: { a: 100, b: 100, c: 100 },
    });
    expect(out.a).toEqual({ stake: 50, won: true, delta: 50, answerId: 2 });
    expect(out.b).toEqual({ stake: 50, won: false, delta: -50, answerId: 1 });
    expect(out.c).toEqual({ stake: 50, won: false, delta: -50, answerId: null });
  });

  it('★ רצפת האפס: ההפסד לא עובר את הניקוד; allowNegative מבטל את הרצפה', () => {
    const base = { stakes: { a: 100 }, betVotes: { a: 3 }, finalVotes: { a: 1 }, correctIds: correct, scores: { a: 30 } };
    expect(resolveBets({ ...base, config: CLASSIC }).a!.delta).toBe(-30);
    expect(resolveBets({ ...base, config: { ...CLASSIC, allowNegative: true } }).a!.delta).toBe(-100);
  });

  it('מכפיל: כללי ופרטי לאפשרות, מעוגל', () => {
    const cfg: BetConfig = { ...CLASSIC, payout: 1.5, options: [{ kind: 'none' }, { kind: 'percent', value: 25 }, { kind: 'percent', value: 50 }, { kind: 'all', payout: 2 }] };
    const out = resolveBets({
      stakes: { a: 25, b: 100 },
      betVotes: { a: 2, b: 4 },
      config: cfg,
      finalVotes: { a: 2, b: 2 },
      correctIds: correct,
      scores: { a: 100, b: 100 },
    });
    expect(out.a!.delta).toBe(38); // 25 × 1.5 = 37.5 → 38
    expect(out.b!.delta).toBe(200); // "הכול" משלם פי 2
  });
});

describe('המנוע — הימור ואז שאלה', () => {
  it('★ ההימור נרשם בסגירת שקופית ההימור, ומוכרע בשאלה שאחריה', () => {
    const engine = new GameEngine(betGame());
    // ש1: a,b,c צודקים (10 כל אחד); d טועה (0)
    // הימור: a הכול (10), b חצי (5), c בלי, d הכול (0 → לא מהמר)
    // ש3: a צודק, b טועה, c צודק, d צודק
    play(engine, { a: 1, b: 1, c: 1, d: 2 }, { a: 4, b: 3, c: 1, d: 4 }, { a: 2, b: 1, c: 2, d: 2 });
    const state = engine.getState();
    expect(state.betStakes[2]).toEqual({ a: 10, b: 5 });
    expect(state.betOutcomes[3]).toEqual({
      a: { stake: 10, won: true, delta: 10, answerId: 2 },
      b: { stake: 5, won: false, delta: -5, answerId: 1 },
    });
    // a: 10 + 10 (ש3) + 10 (הימור) = 30 · b: 10 − 5 = 5 · c: 10 + 10 = 20 · d: 10
    expect(state.scores).toEqual({ a: 30, b: 5, c: 20, d: 10 });
    // ההימור עצמו אינו "שאלה": לא ניקוד ולא זמן תגובה
    expect(state.answerTimes.c?.count).toBe(2);
  });

  it('★ מי שלא ענה על השאלה מפסיד את ההימור', () => {
    const engine = new GameEngine(betGame());
    play(engine, { a: 1 }, { a: 3 }, {});
    expect(engine.getState().betOutcomes[3]!.a).toMatchObject({ won: false, delta: -5, answerId: null });
    expect(engine.getState().scores).toEqual({ a: 5 });
  });

  it('★ "הכול" והפסד — יורדים לאפס ולא מתחת (המשתתף נעלם מהניקוד, לא מהגיבוי)', () => {
    const engine = new GameEngine(betGame());
    play(engine, { a: 1 }, { a: 4 }, { a: 1 });
    expect(engine.getState().scores).toEqual({});
    expect(engine.getState().betOutcomes[3]!.a).toMatchObject({ won: false, delta: -10 });
  });

  it('ניקוד יורד/הפחתה בשאלה אינם משנים את "נכון": מי שצדק מקבל את ההימור גם עם 0 נקודות מהשאלה', () => {
    const engine = new GameEngine(
      makeGame([
        rawSlide({ id: 1, type: 'trivia', que: 'ש1', answers: fourAnswers(1), scoreForQue: 10 }),
        rawBet(2),
        rawSlide({ id: 3, type: 'trivia', que: 'ש3', answers: fourAnswers(2), scoreForQue: 10, settings: { descendingScore: { active: true, maxScore: 100 } }, timeForQue: 10 }),
      ]),
    );
    vote(engine, { a: 1 });
    engine.dispatch({ type: 'ADVANCE', at: T0 + 6000 });
    vote(engine, { a: 4 }, T0 + 7000);
    engine.dispatch({ type: 'ADVANCE', at: T0 + 13000 });
    engine.dispatch({ type: 'OPEN_VOTING', at: T0 + 14000 });
    // ענה נכון אחרי שהטיימר נגמר — 0 נקודות מהשאלה, אבל ההימור זוכה
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 3, { a: 2 }), at: T0 + 25000, elapsedMs: 11000 });
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: T0 + 25000 });
    expect(engine.getState().betOutcomes[3]!.a).toMatchObject({ won: true, delta: 10 });
    expect(engine.getState().scores.a).toBe(20);
  });

  it('★ חזרה על השאלה מבטלת את ההכרעה ומכריעה מחדש עם אותם הימורים', () => {
    const engine = new GameEngine(betGame());
    play(engine, { a: 1, b: 1 }, { a: 4, b: 4 }, { a: 2, b: 1 });
    expect(engine.getState().scores).toEqual({ a: 30 }); // b ירד לאפס
    // חזרה לשקופית 3 והצבעה הפוכה: a טועה, b צודק
    engine.dispatch({ type: 'GOTO', slideId: 3, at: T0 + 30000 });
    // התוצאה הקודמת נשארת עד הסגירה הבאה — המסך עדיין מציג אותה בחזרה אחורה
    expect(engine.getState().betOutcomes[3]!.a!.won).toBe(true);
    vote(engine, { a: 1, b: 2 }, T0 + 31000);
    const state = engine.getState();
    expect(state.betOutcomes[3]).toEqual({
      a: { stake: 10, won: false, delta: -10, answerId: 1 },
      b: { stake: 10, won: true, delta: 10, answerId: 2 },
    });
    expect(state.scores).toEqual({ b: 30 });
  });

  it('חזרה על שקופית ההימור מחשבת הימורים מחדש מהניקוד הנוכחי', () => {
    const engine = new GameEngine(betGame());
    vote(engine, { a: 1 }); // a: 10
    engine.dispatch({ type: 'ADVANCE', at: T0 + 6000 });
    vote(engine, { a: 3 }, T0 + 7000); // חצי = 5
    expect(engine.getState().betStakes[2]).toEqual({ a: 5 });
    engine.dispatch({ type: 'GOTO', slideId: 2, at: T0 + 20000 });
    vote(engine, { a: 4 }, T0 + 21000); // הכול = 10
    expect(engine.getState().betStakes[2]).toEqual({ a: 10 });
  });

  it('הימור שאחריו אין שאלה מנוקדת — לא משנה ניקוד (בטל)', () => {
    const engine = new GameEngine(
      makeGame([
        rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1), scoreForQue: 10 }),
        rawBet(2),
        rawSlide({ id: 3, type: 'survey', answers: fourAnswers(0) }),
      ]),
    );
    play(engine, { a: 1 }, { a: 4 }, { a: 1 });
    expect(engine.getState().scores).toEqual({ a: 10 });
    expect(engine.getState().betOutcomes).toEqual({});
    expect(engine.getState().betStakes[2]).toEqual({ a: 10 });
  });

  it('שני הימורים ברצף — רק הקרוב לשאלה מוכרע', () => {
    const engine = new GameEngine(
      makeGame([
        rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1), scoreForQue: 10 }),
        rawBet(2),
        rawBet(3),
        rawSlide({ id: 4, type: 'trivia', answers: fourAnswers(2), scoreForQue: 10 }),
      ]),
    );
    vote(engine, { a: 1 });
    engine.dispatch({ type: 'ADVANCE', at: T0 + 6000 });
    vote(engine, { a: 4 }, T0 + 7000); // הימור 2: הכול (10)
    engine.dispatch({ type: 'ADVANCE', at: T0 + 13000 });
    vote(engine, { a: 2 }, T0 + 14000); // הימור 3: רבע (2)
    engine.dispatch({ type: 'ADVANCE', at: T0 + 20000 });
    vote(engine, { a: 2 }, T0 + 21000); // צודק
    expect(engine.getState().betOutcomes[4]!.a).toMatchObject({ stake: 2, won: true, delta: 2 });
    expect(engine.getState().scores.a).toBe(22);
  });

  it('שאלת תמונות עם תשובה נכונה מכריעה; סקר לא', () => {
    const engine = new GameEngine(
      makeGame([
        rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1), scoreForQue: 10 }),
        rawBet(2),
        rawSlide({ id: 3, type: 'ans_images', que: 'תמונות', answers: fourAnswers(3).map((a) => ({ ...a, ans: `https://x.dev/${a.id}.jpg` })), scoreForQue: 5 }),
      ]),
    );
    play(engine, { a: 1 }, { a: 4 }, { a: 3 });
    expect(engine.getState().betOutcomes[3]!.a).toMatchObject({ won: true, delta: 10 });
    expect(engine.getState().scores.a).toBe(25);
  });

  it('איפוס ניקוד (function · score) מבטל הימורים פתוחים ותוצאות', () => {
    const engine = new GameEngine(betGame());
    play(engine, { a: 1 }, { a: 4 }, { a: 2 });
    engine.resetScores();
    expect(engine.getState().betStakes).toEqual({});
    expect(engine.getState().betOutcomes).toEqual({});
    expect(engine.getState().scores).toEqual({});
  });

  it('הסרת משתתפים מוחקת אותם גם מההימורים', () => {
    const engine = new GameEngine(betGame());
    play(engine, { a: 1, b: 1 }, { a: 4, b: 4 }, { a: 2, b: 2 });
    engine.removeVoters(['a']);
    expect(engine.getState().betStakes[2]).toEqual({ b: 10 });
    expect(Object.keys(engine.getState().betOutcomes[3]!)).toEqual(['b']);
  });

  it('★ serialize/restore נושאים את ההימורים; snapshot ישן בלעדיהם נטען', () => {
    const engine = new GameEngine(betGame());
    play(engine, { a: 1 }, { a: 3 }, { a: 2 });
    const snap = engine.serialize('2026-09-15T00:00:00.000Z');
    expect(snap.betStakes).toEqual({ 2: { a: 5 } });
    expect(snap.betOutcomes?.[3]?.a).toMatchObject({ won: true, delta: 5 });
    const fresh = new GameEngine(betGame());
    fresh.restore(snap);
    expect(fresh.getState().betStakes).toEqual({ 2: { a: 5 } });
    expect(fresh.getState().betOutcomes[3]!.a!.delta).toBe(5);
    const legacy = { ...snap };
    delete legacy.betStakes;
    delete legacy.betOutcomes;
    delete legacy.majorityBySlide;
    const older = new GameEngine(betGame());
    older.restore(legacy);
    expect(older.getState().betStakes).toEqual({});
  });

  it('רענון חם שומר הימורים ותוצאות', () => {
    const engine = new GameEngine(betGame());
    play(engine, { a: 1 }, { a: 3 }, { a: 2 });
    engine.updateGame(betGame());
    expect(engine.getState().betStakes[2]).toEqual({ a: 5 });
    expect(engine.getState().betOutcomes[3]!.a!.delta).toBe(5);
  });

  it('משחק מלא (runFullGame) עם הימור רץ עד הסוף', () => {
    const engine = new GameEngine(betGame());
    const log = runFullGame(engine, (slide) => (slide.type === 'bet' ? { a: 4, b: 2 } : { a: slide.question.answers.find((x) => x.correct)!.id, b: 1 }));
    expect(engine.getState().phase).toBe('ended');
    expect(log.transitions.some((t) => t.slideId === 2 && t.phase === 'voting')).toBe(true);
    // a: 10 (ש1) + 10 (ש3) + 10 (הימור "הכול") = 30
    // b: 10 (ש1, תשובה 1 נכונה) → הימור רבע = 2 → טעה בש3 → 8
    expect(engine.getState().scores).toEqual({ a: 30, b: 8 });
  });
});

describe('סיכומים ותיאורים לתצוגה', () => {
  it('betSummary — מהמרים, סה"כ, הגדולים', () => {
    const s = betSummary({ a: 10, b: 30, c: 20, d: 0 }, 2);
    expect(s).toEqual({ bettors: 3, total: 60, top: [{ voterId: 'b', stake: 30 }, { voterId: 'c', stake: 20 }] });
  });

  it('betOutcomeSummary — זכו/הפסידו ממוינים, הזכייה הגדולה', () => {
    const s = betOutcomeSummary({
      a: { stake: 10, won: true, delta: 10, answerId: 2 },
      b: { stake: 40, won: false, delta: -40, answerId: 1 },
      c: { stake: 25, won: true, delta: 50, answerId: 2 },
      d: { stake: 5, won: false, delta: -5, answerId: null },
    });
    expect(s.won).toBe(2);
    expect(s.lost).toBe(2);
    expect(s.totalWon).toBe(60);
    expect(s.totalLost).toBe(45);
    expect(s.winners.map((w) => w.voterId)).toEqual(['c', 'a']);
    expect(s.losers.map((l) => l.voterId)).toEqual(['b', 'd']);
    expect(s.biggest?.voterId).toBe('c');
  });

  it('describeBetOption — תיאור הכרטיס והקיצור', () => {
    const cfg: BetConfig = { ...CLASSIC, payout: 2 };
    expect(describeBetOption({ kind: 'none' }, cfg)).toBe('שומרים על הנקודות');
    expect(describeBetOption({ kind: 'percent', value: 25 }, CLASSIC)).toBe('25% מהניקוד שלך');
    expect(describeBetOption({ kind: 'fixed', value: 100 }, CLASSIC)).toBe('100 נקודות');
    expect(describeBetOption({ kind: 'all' }, cfg)).toBe('כל הניקוד שלך · זכייה פי 2');
    expect(describeBetOption({ kind: 'all', payout: 3 }, CLASSIC)).toBe('כל הניקוד שלך · זכייה פי 3');
    expect(['none', 'percent', 'fixed', 'all'].map((k) => describeBetOptionShort({ kind: k, value: 50 }))).toEqual(['בלי', '50%', '50 נק׳', 'הכול']);
  });

  it('parseGameFile מקבל את הפלט של הבנאי כפי שהוא (מחרוזת JSON)', () => {
    const game = parseGameFile(rawGame([rawBet(1), rawSlide({ id: 2, type: 'trivia', answers: fourAnswers(1) })]));
    expect(game.questions[0]!.bet?.options).toHaveLength(4);
  });
});
