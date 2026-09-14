/**
 * "הרוב קובע" (setting.majorityDecides): התשובה הנכונה נקבעת בסגירת ההצבעה לפי
 * הרוב, נכתבת אל השקופית, ושורדת חזרה אחורה, שחזור ורענון תוכן.
 */

import { describe, expect, it } from 'vitest';
import { GameEngine, applyMajority, majorityAnswerIds, parseGameFile, usesMajority } from '../src/engine/index.ts';
import { buildBackupPayload, backupToSnapshot } from '../src/app/backupState.ts';
import { EMPTY_ROSTER } from '../src/app/roster.ts';
import { fourAnswers, makeGame, makeSnapshot, rawGame, rawSlide } from './helpers.ts';

const T0 = 1_000_000;
const NO_CORRECT = fourAnswers(0); // אף תשובה לא מסומנת

function majorityGame(type: 'trivia' | 'ans_images' = 'trivia') {
  return makeGame([
    rawSlide({
      id: 1,
      type,
      que: 'מה הרוב חושב?',
      answers: type === 'ans_images' ? NO_CORRECT.map((a) => ({ ...a, ans: `https://x.dev/${a.id}.jpg` })) : NO_CORRECT,
      scoreForQue: 10,
      timeForQue: 15,
      settings: { majorityDecides: true },
    }),
    rawSlide({ id: 2, type: 'trivia', que: 'רגילה', answers: fourAnswers(1), scoreForQue: 10, settings: { correctlyAnsweredBefore: true } }),
  ]);
}

function closeWith(engine: GameEngine, votes: Record<string, number>, seq = 1): void {
  engine.dispatch({ type: 'OPEN_VOTING', at: T0 });
  engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(seq, engine.getCurrentSlide().id, votes), at: T0 + 1000 });
  engine.dispatch({ type: 'VOTING_TIMEOUT', at: T0 + 5000 });
}

describe('סכימה', () => {
  it('★ טריוויה בלי תשובה נכונה נטענת כש"הרוב קובע"; בלעדיו — נדחית', () => {
    expect(majorityGame().questions[0]!.setting.majorityDecides).toBe(true);
    expect(() =>
      makeGame([rawSlide({ id: 1, type: 'trivia', answers: NO_CORRECT, scoreForQue: 10 })]),
    ).toThrow();
  });

  it('סימון שהגיע בקובץ מתאפס — הנכונה נקבעת רק בזמן אמת', () => {
    const g = makeGame([
      rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(2), settings: { majorityDecides: true } }),
    ]);
    expect(g.questions[0]!.question.answers.every((a) => !a.correct)).toBe(true);
  });

  it('ברירת המחדל כבויה, וגם liveVoteCounts', () => {
    const g = makeGame([rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1) })]);
    expect(g.questions[0]!.setting.majorityDecides).toBe(false);
    expect(g.questions[0]!.setting.liveVoteCounts).toBe(false);
    const on = makeGame([rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1), settings: { liveVoteCounts: true } })]);
    expect(on.questions[0]!.setting.liveVoteCounts).toBe(true);
  });
});

describe('majorityAnswerIds', () => {
  it('★ הרוב; תיקו — כולם שבראש; בלי הצבעות — אף אחד', () => {
    expect(majorityAnswerIds({ a: 2, b: 2, c: 1 })).toEqual([2]);
    expect(majorityAnswerIds({ a: 2, b: 1 })).toEqual([1, 2]);
    expect(majorityAnswerIds({})).toEqual([]);
  });
  it('הצבעה על כפתור שאינו תשובה אינה נספרת', () => {
    expect(majorityAnswerIds({ a: 9, b: 9, c: 1 }, new Set([1, 2, 3, 4]))).toEqual([1]);
  });
  it('applyMajority כותב את הדגלים; usesMajority רק לטריוויה/תמונות', () => {
    const g = majorityGame();
    applyMajority(g.questions[0]!, [3]);
    expect(g.questions[0]!.question.answers.map((a) => a.correct)).toEqual([false, false, true, false]);
    expect(usesMajority(g.questions[0]!)).toBe(true);
    const survey = makeGame([rawSlide({ id: 1, type: 'survey', answers: NO_CORRECT, settings: { majorityDecides: true } })]);
    expect(usesMajority(survey.questions[0]!)).toBe(false);
  });
});

describe('המנוע', () => {
  it('★ הרוב מקבל את הניקוד, המיעוט לא, והשקופית מסומנת', () => {
    const engine = new GameEngine(majorityGame());
    closeWith(engine, { a: 2, b: 2, c: 3, d: 2 });
    expect(engine.getState().scores).toEqual({ a: 10, b: 10, d: 10 });
    expect(engine.getState().majorityBySlide).toEqual({ 1: [2] });
    expect(engine.getCurrentSlide().question.answers.find((x) => x.id === 2)?.correct).toBe(true);
  });

  it('תיקו — כל מי שבחר באחת מהמובילות מקבל ניקוד', () => {
    const engine = new GameEngine(majorityGame());
    closeWith(engine, { a: 1, b: 3 });
    expect(engine.getState().scores).toEqual({ a: 10, b: 10 });
    expect(engine.getState().majorityBySlide[1]).toEqual([1, 3]);
  });

  it('תשובות-תמונה עם "הרוב קובע" מנוקדות כמו טריוויה', () => {
    const engine = new GameEngine(majorityGame('ans_images'));
    closeWith(engine, { a: 4, b: 4, c: 1 });
    expect(engine.getState().scores).toEqual({ a: 10, b: 10 });
  });

  it('★ "ענו נכון קודם" מתייחס להכרעה', () => {
    const engine = new GameEngine(majorityGame());
    closeWith(engine, { a: 2, b: 1, c: 2 }); // הרוב: 2 → a,c צדקו, b טעה
    engine.dispatch({ type: 'ADVANCE', at: T0 + 6000 });
    closeWith(engine, { a: 1, b: 1, c: 1 }, 2); // כולם צודקים בשאלה 2, אבל b נפסל
    expect(engine.getState().scores).toEqual({ a: 20, c: 20 });
  });

  it('★ חזרה על השאלה מכריעה מחדש (הניקוד הקודם מקוזז)', () => {
    const engine = new GameEngine(majorityGame());
    closeWith(engine, { a: 2, b: 2, c: 3 });
    engine.dispatch({ type: 'GOTO', slideId: 1, at: T0 + 9000 });
    closeWith(engine, { a: 3, b: 3, c: 3 }, 2);
    expect(engine.getState().scores).toEqual({ a: 10, b: 10, c: 10 });
    expect(engine.getState().majorityBySlide[1]).toEqual([3]);
    expect(engine.getCurrentSlide().question.answers.map((x) => x.correct)).toEqual([false, false, true, false]);
  });

  it('★ שחזור מ-snapshot ורענון תוכן מחילים את ההכרעה מחדש על הקובץ', () => {
    const engine = new GameEngine(majorityGame());
    closeWith(engine, { a: 2, b: 2, c: 3 });
    const snap = engine.serialize('2026-09-15T00:00:00.000Z');
    expect(snap.majorityBySlide).toEqual({ 1: [2] });
    const fresh = new GameEngine(majorityGame()); // קובץ טרי — בלי דגלים
    fresh.restore(snap);
    expect(fresh.getGame().questions[0]!.question.answers[1]!.correct).toBe(true);
    // רענון תוכן — קובץ חדש בלי דגלים; ההכרעה חוזרת
    fresh.updateGame(majorityGame());
    expect(fresh.getGame().questions[0]!.question.answers[1]!.correct).toBe(true);
    // reset — ההכרעות נמחקות, הדגלים מתנקים
    fresh.reset();
    expect(fresh.getGame().questions[0]!.question.answers.some((a) => a.correct)).toBe(false);
  });

  it('★ הגיבוי נושא את ההכרעה, וחוזר דרך backupToSnapshot', () => {
    const engine = new GameEngine(majorityGame());
    closeWith(engine, { a: 2, b: 2, c: 3 });
    const payload = buildBackupPayload(engine.getGame(), engine.getState(), EMPTY_ROSTER, (id) => id, 42);
    expect(payload.meta.majorityBySlide).toEqual({ 1: [2] });
    // הדוח בגיבוי סופר "ענו נכון" לפי ההכרעה
    expect(payload.questions['1']?.correctVotes).toBe(2);
    const snap = backupToSnapshot(majorityGame(), { ...payload, id: 'b1', completed: false });
    expect(snap.majorityBySlide).toEqual({ 1: [2] });
  });

  it('parseGameFile — קובץ ישן בלי השדות נטען ללא שינוי', () => {
    const g = parseGameFile(rawGame([rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1) })]));
    expect(g.questions[0]!.setting.majorityDecides).toBe(false);
  });
});
