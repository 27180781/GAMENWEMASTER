/**
 * שלט ההצבעה במסך הצפייה (src/live/votePad.ts): מתי הוא פתוח, אילו כפתורים
 * יש בו, איזה שם מותר, ומה נשלח לשרת ההצבעות — אותם שדות כמו מהטלפון.
 */

import { describe, expect, it } from 'vitest';
import { EMPTY_ROSTER } from '../src/app/roster.ts';
import { GameEngine, type GameFile } from '../src/engine/index.ts';
import { LiveSnapshotBuilder, type LiveHostInput } from '../src/live/snapshot.ts';
import { SILENCE } from '../src/live/soundTrack.ts';
import type { LiveSnapshot } from '../src/live/types.ts';
import {
  PLAYER_NAME_MAX,
  cleanPlayerName,
  joinFields,
  padRoom,
  padView,
  playerNameProblem,
  postToVoteServer,
  voteFields,
} from '../src/live/votePad.ts';
import { NUM_COLORS } from '../src/render/GroupConnectScreen.tsx';
import { COIN_COLORS } from '../src/render/QuestionSlide.tsx';
import { fourAnswers, makeGame, makeSnapshot, rawSlide } from './helpers.ts';

const T0 = 1_000_000;

/** תשובות באותיות (‎ansIsNumber: false‎), כמו ברוב המשחקים. */
function game(): GameFile {
  const g = makeGame(
    [
      rawSlide({ id: 1, type: 'trivia', que: 'ש1', answers: fourAnswers(3), timeForQue: 15 }),
      rawSlide({
        id: 2,
        type: 'trivia',
        que: 'ש2',
        answers: fourAnswers(1).slice(0, 3),
        timeForQue: 15,
      }),
      rawSlide({ id: 3, type: 'media' }),
    ],
    { room: 2047 },
  );
  g.setting.ansIsNumber = false;
  return g;
}

function input(engine: GameEngine, over: Partial<LiveHostInput> = {}): LiveHostInput {
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
    join: { show: true, code: '2047', qrUrl: null },
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
    revealThumb: null,
    video: null,
    ...over,
  };
}

function snapOf(engine: GameEngine, over: Partial<LiveHostInput> = {}): LiveSnapshot {
  // דרך ה-JSON — בדיוק מה שהצופה מקבל ברשת
  return JSON.parse(
    JSON.stringify(new LiveSnapshotBuilder().build(input(engine, over))),
  ) as LiveSnapshot;
}

function voting(g: GameFile = game()): GameEngine {
  const engine = new GameEngine(g);
  engine.dispatch({ type: 'OPEN_VOTING', at: T0 });
  return engine;
}

describe('שלט ההצבעה — מתי פתוח ואילו כפתורים', () => {
  it('לפני שנפתחה הצבעה — סגור, בלי כפתורים', () => {
    const view = padView(snapOf(new GameEngine(game())));
    expect(view.mode).toBe('closed');
    expect(view.keys).toEqual([]);
  });

  it('הצבעה פתוחה: כפתור לכל תשובה, באותה אות ובאותו צבע כמו המטבע שליד התשובה', () => {
    const view = padView(snapOf(voting()));
    expect(view.mode).toBe('answers');
    expect(view.windowKey).toBe('slide:1');
    expect(view.keys.map((k) => k.label)).toEqual(['A', 'B', 'C', 'D']);
    expect(view.keys.map((k) => k.value)).toEqual([1, 2, 3, 4]);
    expect(view.keys.map((k) => k.bg)).toEqual(COIN_COLORS.slice(0, 4).map((c) => c.bg));
    expect(view.keys.map((k) => k.fg)).toEqual(COIN_COLORS.slice(0, 4).map((c) => c.fg));
    // ברירת המחדל: רק ההקשה הראשונה נספרת
    expect(view.changeable).toBe(false);
  });

  it('תשובות מספריות — על הכפתור המספר, כמו על המסך', () => {
    const g = game();
    g.setting.ansIsNumber = true;
    expect(padView(snapOf(voting(g))).keys.map((k) => k.label)).toEqual(['1', '2', '3', '4']);
  });

  it('שינוי הצבעה מותר — במשחק כולו או בשקופית', () => {
    const all = game();
    all.setting.allowChangeVote = true;
    expect(padView(snapOf(voting(all))).changeable).toBe(true);
    const one = game();
    one.questions[0]!.setting.allowChangeVote = true;
    expect(padView(snapOf(voting(one))).changeable).toBe(true);
  });

  it('כמה כפתורים — כמו מספר התשובות בשקופית', () => {
    const engine = voting();
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: T0 + 15_000 });
    engine.dispatch({ type: 'GOTO', slideId: 2, at: T0 + 16_000 });
    engine.dispatch({ type: 'OPEN_VOTING', at: T0 + 17_000 });
    expect(engine.getState().phase).toBe('voting');
    const view = padView(snapOf(engine));
    expect(view.mode).toBe('answers');
    expect(view.windowKey).toBe('slide:2');
    expect(view.keys.map((k) => k.label)).toEqual(['A', 'B', 'C']);
  });

  it('טיימר עצור (מקש 6 או שכבה חוסמת) — המסך הראשי לא קולט, והשלט מראה עצירה', () => {
    const view = padView(
      snapOf(voting(), {
        timer: { remaining: 9, total: 15, paused: true, elapsedMs: 6000, sampledAt: T0 + 6000 },
      }),
    );
    expect(view.mode).toBe('paused');
    expect(view.keys).toHaveLength(4);
  });

  it('אחרי שההצבעה נסגרה, ומחוץ למסך המשחק — סגור', () => {
    const engine = voting();
    engine.dispatch({
      type: 'VOTE_SNAPSHOT',
      snapshot: makeSnapshot(1, 1, { a: 3 }),
      at: T0 + 1000,
    });
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: T0 + 15_000 });
    expect(padView(snapOf(engine)).mode).toBe('closed');
    expect(padView(snapOf(voting(), { stage: 'winners' })).mode).toBe('closed');
  });

  it('מסך ההצטרפות לקבוצות — כפתור ממוספר לכל קבוצה, בצבעים של המסך', () => {
    const groups = [
      { id: 'g-a', name: 'כחולים' },
      { id: 'g-b', name: 'אדומים' },
      { id: 'g-c', name: 'ירוקים' },
    ];
    const view = padView(
      snapOf(new GameEngine(game()), {
        overlays: {
          ...input(new GameEngine(game())).overlays,
          connect: { categoryName: 'שבט', groups, counts: {}, total: 0 },
        },
      }),
    );
    expect(view.mode).toBe('groups');
    expect(view.keys.map((k) => [k.value, k.label])).toEqual([
      [1, '1'],
      [2, '2'],
      [3, '3'],
    ]);
    expect(view.keys.map((k) => k.bg)).toEqual(NUM_COLORS.slice(0, 3).map((c) => c.bg));
    expect(view.windowKey).toBe('groups:g-a,g-b,g-c');
    expect(view.changeable).toBe(true);
  });

  it('קוד החדר — מה שבבאנר ההצטרפות', () => {
    expect(padRoom(snapOf(voting()))).toBe('2047');
    expect(padRoom(snapOf(voting(), { join: { show: false, code: '2047', qrUrl: null } }))).toBe(
      null,
    );
  });
});

describe('שם המשתתף', () => {
  it('רווחים מיותרים החוצה, ועד 20 תווים', () => {
    expect(cleanPlayerName('  דנה   כהן \n')).toBe('דנה כהן');
    expect(cleanPlayerName('א'.repeat(30))).toHaveLength(PLAYER_NAME_MAX);
    expect(cleanPlayerName(`${'ב'.repeat(19)}   ג`)).toBe('ב'.repeat(19));
  });

  it('חייב לכלול אות — כדי שאיש לא יצביע בשם מספר טלפון של משתתף אחר או של שלט המנחה', () => {
    expect(playerNameProblem('')).not.toBeNull();
    expect(playerNameProblem('0541234567')).not.toBeNull();
    expect(playerNameProblem('054-123 4567')).not.toBeNull();
    expect(playerNameProblem('דנה')).toBeNull();
    expect(playerNameProblem('Dana 2')).toBeNull();
    expect(playerNameProblem('שולחן 7')).toBeNull();
  });
});

describe('מה נשלח לשרת ההצבעות', () => {
  it('אותם שדות כמו קישור ההצבעה מהטלפון: השם הוא גם המזהה', () => {
    expect(joinFields('2047', 'דנה')).toEqual({ gameId: '2047', ApiPhone: 'דנה' });
    expect(voteFields('2047', 'דנה', 3, 1234)).toEqual({
      gameId: '2047',
      vote: '3',
      playerName: 'דנה',
      ApiTime: '1234',
      ApiPhone: 'דנה',
    });
  });

  it('POST כטופס לנתיב של השרת; true רק כשהשרת קיבל', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const ok: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response('OK', { status: 200 });
    };
    await expect(
      postToVoteServer(
        'https://votes.example/',
        '/game/voting',
        voteFields('2047', 'דנה', 2, 5),
        ok,
      ),
    ).resolves.toBe(true);
    expect(calls[0]!.url).toBe('https://votes.example/game/voting');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(calls[0]!.init?.headers).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    expect(Object.fromEntries(new URLSearchParams(String(calls[0]!.init?.body)))).toEqual({
      gameId: '2047',
      vote: '2',
      playerName: 'דנה',
      ApiTime: '5',
      ApiPhone: 'דנה',
    });

    const refused: typeof fetch = async () => new Response('ERROR', { status: 400 });
    await expect(
      postToVoteServer('https://votes.example', '/game/join', joinFields('2047', 'דנה'), refused),
    ).resolves.toBe(false);
    const offline: typeof fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(
      postToVoteServer('https://votes.example', '/game/join', joinFields('2047', 'דנה'), offline),
    ).resolves.toBe(false);
  });
});
