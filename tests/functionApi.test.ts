/**
 * שקופית "פונקציה" (type: "function"): פענוח סכמה + מעבר במנוע, בניית מטען
 * הנתונים (buildFunctionPayload), והשליחה בפועל (sendFunctionApi, fetch ממוקק).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameEngine, parseGameFile } from '../src/engine/index.ts';
import { fourAnswers, makeGame, makeSnapshot, rawGame, rawSlide } from './helpers.ts';
import {
  buildFunctionPayload,
  sendFunctionApi,
  type FunctionApiConfig,
  type FunctionPayload,
} from '../src/app/functionApi.ts';
import { addCategory, addGroup, assignGroupByNumber, EMPTY_ROSTER, upsertPlayer, type RosterData } from '../src/app/roster.ts';

/** שקופית פונקציה גולמית — בדיוק במבנה שמייצר עורך המשחקים. */
function functionSlideRaw(id: number, url = 'https://example.com/webhook', method = 'POST') {
  return {
    question: { que: '', scoreForQue: '', timeForQue: '', answers: [], src: '' },
    openMedia: { src: '' },
    endMedia: { src: '' },
    backgroundMedia: { src: '' },
    setting: {
      allowChangeVote: false, slideStartVoting: true, playAfterClicking: false, exitGame: false,
      correctlyAnsweredBefore: false, firstClicker: false, answerIsSequenceClicks: false, fullscreen: false,
      scoringReduction: { active: false, seconds: '', score: '' }, slidBackgroundMedia: { src: '' },
      automaticSkip: { active: false, seconds: '' }, showInLoop: false,
    },
    function: { action: 'api', api: { url, method } },
    type: 'function',
    id,
  };
}

describe('סכמה + מנוע: שקופית function', () => {
  it('נטענת ושומרת את קונפיג ה-API, ואינה שקופית הצבעה', () => {
    const game = parseGameFile(
      rawGame([functionSlideRaw(7), rawSlide({ id: 8, type: 'trivia', que: 'ש', answers: fourAnswers(2) })]),
    );
    const fn = game.questions[0]!;
    expect(fn.type).toBe('function');
    expect(fn.function).toEqual({ action: 'api', api: { url: 'https://example.com/webhook', method: 'POST' } });
  });

  it('המנוע עובר דרכה כשקופית מעבר (לא נפתחת הצבעה)', () => {
    const game = makeGame([functionSlideRaw(7), rawSlide({ id: 8, type: 'trivia', que: 'ש', answers: fourAnswers(2) })]);
    const engine = new GameEngine(game);
    expect(engine.getCurrentSlide().type).toBe('function');
    engine.dispatch({ type: 'ADVANCE', at: 0 }); // שקופית מעבר → הבאה, בלי phase 'voting'
    expect(engine.getState().phase).toBe('showing');
    expect(engine.getCurrentSlide().id).toBe(8);
  });

  it('פעולת "screen" — נשמר screen.type (winners/leaderboard)', () => {
    const raw = (id: number, type: string) => ({
      question: { que: '', scoreForQue: '', timeForQue: '', answers: [], src: '' },
      openMedia: { src: '' }, endMedia: { src: '' }, backgroundMedia: { src: '' }, setting: {
        allowChangeVote: false, slideStartVoting: true, playAfterClicking: false, exitGame: false,
        correctlyAnsweredBefore: false, firstClicker: false, answerIsSequenceClicks: false, fullscreen: false,
        scoringReduction: { active: false, seconds: '', score: '' }, slidBackgroundMedia: { src: '' },
        automaticSkip: { active: false, seconds: '' }, showInLoop: false,
      },
      function: { action: 'screen', screen: { type } }, type: 'function', id,
    });
    const game = parseGameFile(rawGame([raw(1, 'leaderboard'), rawSlide({ id: 2, type: 'trivia', que: 'ש', answers: fourAnswers(2) })]));
    expect(game.questions[0]!.function).toEqual({ action: 'screen', screen: { type: 'leaderboard' } });
  });

  it('פעולת "score" — נשמר score.operation (reset_all)', () => {
    const raw = {
      question: { que: '', scoreForQue: '', timeForQue: '', answers: [], src: '' },
      openMedia: { src: '' }, endMedia: { src: '' }, backgroundMedia: { src: '' }, setting: {
        allowChangeVote: false, slideStartVoting: true, playAfterClicking: false, exitGame: false,
        correctlyAnsweredBefore: false, firstClicker: false, answerIsSequenceClicks: false, fullscreen: false,
        scoringReduction: { active: false, seconds: '', score: '' }, slidBackgroundMedia: { src: '' },
        automaticSkip: { active: false, seconds: '' }, showInLoop: false,
      },
      function: { action: 'score', score: { operation: 'reset_all' } }, type: 'function', id: 1,
    };
    const game = parseGameFile(rawGame([raw, rawSlide({ id: 2, type: 'trivia', que: 'ש', answers: fourAnswers(2) })]));
    expect(game.questions[0]!.function).toEqual({ action: 'score', score: { operation: 'reset_all' } });
  });
});

function twoTrivia() {
  return makeGame([
    rawSlide({ id: 1, type: 'trivia', que: 'בירת צרפת?', answers: fourAnswers(2), scoreForQue: 10, timeForQue: 15 }),
    rawSlide({ id: 2, type: 'trivia', que: '2+2?', answers: fourAnswers(1), scoreForQue: 10, timeForQue: 15 }),
  ]);
}

function playedBoth(): GameEngine {
  const e = new GameEngine(twoTrivia());
  e.dispatch({ type: 'ADVANCE', at: 0 });
  e.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2, b: 1, c: 2 }), at: 1000 });
  e.dispatch({ type: 'ADVANCE', at: 5000 });
  e.dispatch({ type: 'ADVANCE', at: 6000 });
  e.dispatch({ type: 'ADVANCE', at: 7000 });
  e.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(2, 2, { a: 1, b: 1 }), at: 8000 });
  e.dispatch({ type: 'ADVANCE', at: 12000 });
  return e;
}

function roster(): RosterData {
  let r = upsertPlayer(EMPTY_ROSTER, 'a', 'דנה'); // ל-'a' יש שם; ל-b/c אין
  r = addCategory(r, 'עיר', 'cat1');
  r = addGroup(r, 'cat1', 'אריות', 'g1');
  r = addGroup(r, 'cat1', 'נמרים', 'g2');
  r = assignGroupByNumber(r, 'a', 'cat1', 1);
  r = assignGroupByNumber(r, 'c', 'cat1', 1);
  r = assignGroupByNumber(r, 'b', 'cat1', 2);
  return r;
}

describe('buildFunctionPayload', () => {
  const nameOf = (id: string) => (id === 'a' ? 'דנה' : id); // רק ל-a יש שם
  const payload = buildFunctionPayload(twoTrivia(), playedBoth().getState(), roster(), nameOf, new Date('2026-07-13T10:00:00Z'));

  it('מטא בסיסי', () => {
    expect(payload.gameName).toBe('משחק בדיקה');
    expect(payload.participantCount).toBe(3);
    expect(payload.sentAt).toBe('2026-07-13T10:00:00.000Z');
  });

  it('משתתפים: מספר, שם (רק אם משויך), ניקוד, ותשובות לכל שאלה', () => {
    const a = payload.participants.find((p) => p.number === 'a')!;
    expect(a).toEqual({
      number: 'a',
      name: 'דנה',
      score: 20,
      numAnswers: 2,
      numCorrect: 2,
      groupId: 'g1',
      answers: [
        { queId: 1, answerId: 2, correct: true },
        { queId: 2, answerId: 1, correct: true },
      ],
    });
    const b = payload.participants.find((p) => p.number === 'b')!;
    expect(b.name).toBe(''); // אין שם משויך → רק מספר
    expect(b.answers).toEqual([
      { queId: 1, answerId: 1, correct: false },
      { queId: 2, answerId: 1, correct: true },
    ]);
    // c לא ענה בשקופית 2 → תשובה אחת בלבד
    const c = payload.participants.find((p) => p.number === 'c')!;
    expect(c.answers).toEqual([{ queId: 1, answerId: 2, correct: true }]);
    expect(payload.participants[0]!.number).toBe('a'); // ממוין לפי ניקוד
  });

  it('שאלות וקבוצות', () => {
    expect(payload.questions).toEqual([
      { queId: 1, type: 'trivia', que: 'בירת צרפת?', correctAnswerIds: [2] },
      { queId: 2, type: 'trivia', que: '2+2?', correctAnswerIds: [1] },
    ]);
    const g1 = payload.groups.find((g) => g.id === 'g1')!;
    expect(g1).toEqual({ id: 'g1', name: 'אריות', category: 'עיר', memberNumbers: ['a', 'c'], totalScore: 30, avgScore: 15 });
  });
});

describe('sendFunctionApi', () => {
  afterEach(() => vi.unstubAllGlobals());
  const payload = { gameId: 'g', gameName: 'x', sentAt: '', participantCount: 1, participants: [{ number: 'a', name: '', score: 5, numAnswers: 1, numCorrect: 1, groupId: null, answers: [] }], questions: [], groups: [] } as FunctionPayload;

  it('POST — גוף JSON עם המטען', async () => {
    const fn = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve({ ok: true }));
    vi.stubGlobal('fetch', fn);
    await sendFunctionApi({ url: 'https://h/w', method: 'POST' }, payload);
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe('https://h/w');
    expect(init!.method).toBe('POST');
    expect((init!.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init!.body as string).participants[0].number).toBe('a');
  });

  it('GET — המטען מקודד בפרמטר payload', async () => {
    const fn = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve({ ok: true }));
    vi.stubGlobal('fetch', fn);
    await sendFunctionApi({ url: 'https://h/w?x=1', method: 'GET' }, payload);
    const [url, init] = fn.mock.calls[0]!;
    expect(init!.method).toBe('GET');
    expect(url.startsWith('https://h/w?x=1&payload=')).toBe(true);
    const encoded = url.split('payload=')[1]!;
    expect(JSON.parse(decodeURIComponent(encoded)).gameId).toBe('g');
  });

  it('זורק בכתובת ריקה ובסטטוס לא-תקין', async () => {
    await expect(sendFunctionApi({ url: '  ', method: 'POST' }, payload)).rejects.toThrow();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500 })));
    await expect(sendFunctionApi({ url: 'https://h/w', method: 'POST' }, payload)).rejects.toThrow('HTTP 500');
  });
});

// שקט TS: הטיפוס בשימוש
const _cfg: FunctionApiConfig = { url: '', method: 'GET' };
void _cfg;
