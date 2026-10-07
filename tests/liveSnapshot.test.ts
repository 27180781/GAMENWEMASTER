/**
 * מצב המסך שיוצא למסך הצפייה (src/live/snapshot.ts) — מה מוסתר ומה עובר.
 *
 * הצופים הם גם המשתתפים, והקישור עובר הלאה בקלות. לכן: שום מספר טלפון, שום
 * מזהה משחק, שום תשובה נכונה לפני החשיפה ושום שקופית שעוד לא הגיעה — גם לא
 * בתעבורת הרשת (מי שפותח כלי מפתחים רואה בדיוק את ה-JSON הזה).
 */

import { describe, expect, it } from 'vitest';
import { GameEngine, type GameFile } from '../src/engine/index.ts';
import { EMPTY_ROSTER } from '../src/app/roster.ts';
import { mirrorEngine } from '../src/live/mirrorEngine.ts';
import {
  BLANK_IMAGE,
  LiveSnapshotBuilder,
  maskPhoneLike,
  type LiveHostInput,
} from '../src/live/snapshot.ts';
import { SILENCE } from '../src/live/soundTrack.ts';
import type { LiveVideo } from '../src/live/video/api.ts';
import type { RailPlayer } from '../src/render/QuestionSlide.tsx';
import { fourAnswers, makeGame, makeSnapshot, rawSlide } from './helpers.ts';

const GAME_ID = '6b1f3c2e-7a4d-4e1b-9c8f-0a1b2c3d4e5f';
const PHONES = ['0541234567', '0529876543', '0501112233'];
const T0 = 1_000_000;

function liveGame(): GameFile {
  const imageQuestion = rawSlide({
    id: 2,
    type: 'trivia',
    que: 'שם פנימי של התמונה',
    answers: fourAnswers(2),
    scoreForQue: 10,
    timeForQue: 20,
    questionSrc: 'https://cdn.example/q2-sharp.jpg',
    settings: { imageReveal: { active: true, blur: 48 } },
  });
  (imageQuestion.question as Record<string, unknown>).queMode = 'image';
  imageQuestion.backgroundMedia = { src: 'https://cdn.example/q2-sharp.jpg' };
  return makeGame(
    [
      rawSlide({
        id: 1,
        type: 'trivia',
        que: 'ש1',
        answers: fourAnswers(3),
        scoreForQue: 10,
        timeForQue: 15,
      }),
      imageQuestion,
      {
        ...rawSlide({ id: 3, type: 'media' }),
        type: 'function',
        function: {
          action: 'api',
          api: { url: 'https://secret.example/hook?key=abc', method: 'POST' },
        },
      },
      rawSlide({
        id: 4,
        type: 'trivia',
        que: 'שאלה סודית שעוד לא הגיעה',
        answers: fourAnswers(1),
        scoreForQue: 10,
        timeForQue: 15,
      }),
    ],
    { id: GAME_ID, room: 2047 },
  );
}

function rail(ids: string[]): RailPlayer[] {
  return ids.map((id) => ({ id, name: id, initial: id[0]!, color: '#FF6B6B' }));
}

function input(engine: GameEngine, over: Partial<LiveHostInput> = {}): LiveHostInput {
  return {
    stage: 'playing',
    game: engine.getGame(),
    state: engine.getState(),
    reveal: { questionShown: true, answersShown: 4, revealCorrect: false },
    timer: null,
    players: rail(PHONES),
    leaders: rail([PHONES[0]!, PHONES[2]!]),
    lobby: rail(PHONES),
    // המקרה הגרוע: אין שמות, המסך הראשי מציג את המספרים עצמם
    nameOf: (id) => id,
    roster: EMPTY_ROSTER,
    groupBonus: {},
    join: { show: true, code: '2047', qrUrl: 'https://join.example/?room=2047' },
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

function expectNoSecrets(json: string): void {
  for (const phone of PHONES) expect(json).not.toContain(phone);
  expect(json).not.toContain(GAME_ID);
  expect(json).not.toContain('secret.example');
  expect(json).not.toContain('שאלה סודית');
}

/** שקופית 1: פתיחת הצבעה ושלוש הצבעות (שתיים נכונות). */
function votingOnFirst(): GameEngine {
  const engine = new GameEngine(liveGame());
  engine.dispatch({ type: 'OPEN_VOTING', at: T0 });
  engine.dispatch({
    type: 'VOTE_SNAPSHOT',
    snapshot: makeSnapshot(1, 1, { [PHONES[0]!]: 3, [PHONES[1]!]: 1, [PHONES[2]!]: 3 }),
    at: T0 + 1000,
  });
  return engine;
}

describe('מצב המסך למסך הצפייה', () => {
  it('הסתרת מספר טלפון: 3 ראשונות ו-3 אחרונות', () => {
    expect(maskPhoneLike('0541234567')).toBe('054••••567');
    expect(maskPhoneLike('+972-54-123-4567')).toBe('972••••••567');
    expect(maskPhoneLike('17')).toBe('17');
    expect(maskPhoneLike('ישראל ישראלי')).toBe('ישראל ישראלי');
  });

  it('בלי מספרי טלפון, בלי מזהה המשחק ובלי שקופיות שעוד לא הגיעו', () => {
    const engine = votingOnFirst();
    const builder = new LiveSnapshotBuilder();
    const raffle = {
      entries: PHONES.map((id) => ({ id, name: id })),
      winner: { id: PHONES[1]!, name: PHONES[1]! },
      run: 1,
    };
    for (const stage of ['opening', 'playing', 'winners', 'scoreboard'] as const) {
      const snap = builder.build(
        input(engine, {
          stage,
          overlays: { ...input(engine).overlays, votes: true, leaders: true, raffle },
        }),
      );
      const json = JSON.stringify(snap);
      expectNoSecrets(json);
      expect(Object.keys(snap.game.slides)).toEqual(['0']);
      expect(snap.game.slideCount).toBe(4);
    }
    const snap = builder.build(input(engine));
    expect(snap.players.map((p) => p.name)).toEqual(['054••••567', '052••••543', '050••••233']);
    expect(snap.join).toEqual({ show: true, code: '2047', qr: 'https://join.example/?room=2047' });
  });

  it('בזמן ההצבעה: התשובה הנכונה, המונים ומי צדק — מוסתרים', () => {
    const engine = votingOnFirst();
    const snap = new LiveSnapshotBuilder().build(input(engine));
    const slide = snap.game.slides['0']!;
    expect(slide.question.answers.map((a) => a.correct)).toEqual([false, false, false, false]);
    expect(snap.state.liveVotes).toEqual({ counts: {}, total: 3 });
    // הפס "צדקו/טעו" עדיין מקבל את המספר — בלי לדעת איזו תשובה
    expect(snap.liveCorrectCount).toBe(2);
    expect(snap.leaders).toEqual([]);
    expect(snap.state.scores).toEqual({});
  });

  it('מונה הצבעות חי שהמנחה הדליק — המונים עוברים, הנכונה עדיין לא', () => {
    const game = liveGame();
    game.questions[0]!.setting.liveVoteCounts = true;
    const engine = new GameEngine(game);
    engine.dispatch({ type: 'OPEN_VOTING', at: T0 });
    engine.dispatch({
      type: 'VOTE_SNAPSHOT',
      snapshot: makeSnapshot(1, 1, { [PHONES[0]!]: 3 }),
      at: T0 + 500,
    });
    const snap = new LiveSnapshotBuilder().build(input(engine));
    expect(snap.state.liveVotes?.counts).toEqual({ '3': 1 });
    expect(snap.game.slides['0']!.question.answers.some((a) => a.correct)).toBe(false);
  });

  it('אחרי החשיפה: התשובה הנכונה, המונים ומי צדק — כמו במסך הראשי', () => {
    const engine = votingOnFirst();
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: T0 + 15_000 });
    const snap = new LiveSnapshotBuilder().build(
      input(engine, { reveal: { questionShown: true, answersShown: 4, revealCorrect: true } }),
    );
    expect(snap.game.slides['0']!.question.answers.map((a) => a.correct)).toEqual([
      false,
      false,
      true,
      false,
    ]);
    expect(snap.state.liveVotes?.counts).toEqual({ '3': 2, '1': 1 });
    expect(snap.leaders.map((p) => p.name)).toEqual(['054••••567', '050••••233']);
  });

  it('שאלה ותשובות שעוד לא נחשפו — ריקות', () => {
    const engine = new GameEngine(liveGame());
    const snap = new LiveSnapshotBuilder().build(
      input(engine, { reveal: { questionShown: false, answersShown: 1, revealCorrect: false } }),
    );
    const q = snap.game.slides['0']!.question;
    expect(q.que).toBe('');
    expect(q.answers.map((a) => a.ans)).toEqual(['תשובה 1', '', '', '']);
  });

  it('"התמונה מתבהרת": בלי התמונה החדה עד שההצבעה נסגרת', () => {
    const engine = votingOnFirst();
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: T0 + 15_000 });
    engine.dispatch({ type: 'ADVANCE', at: T0 + 16_000 });
    expect(engine.getState().currentSlideIndex).toBe(1);
    const builder = new LiveSnapshotBuilder();

    const before = builder.build(input(engine));
    const slide = before.game.slides['1']!;
    expect(slide.question.que).toBe(''); // שם פנימי של שאלת תמונה
    expect(slide.question.src).toBe(BLANK_IMAGE);
    expect(slide.backgroundMedia.src).toBe('');
    expect(JSON.stringify(before)).not.toContain('q2-sharp');

    const thumb = 'data:image/webp;base64,AAAA';
    expect(
      builder.build(input(engine, { revealThumb: thumb })).game.slides['1']!.question.src,
    ).toBe(thumb);

    engine.dispatch({ type: 'OPEN_VOTING', at: T0 + 17_000 });
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: T0 + 37_000 });
    const after = builder.build(
      input(engine, { reveal: { questionShown: true, answersShown: 4, revealCorrect: true } }),
    );
    expect(after.game.slides['1']!.question.src).toBe('https://cdn.example/q2-sharp.jpg');
  });

  it('שקופית פונקציה: בלי כתובת ה-API', () => {
    const engine = new GameEngine(liveGame());
    engine.dispatch({ type: 'GOTO', slideId: 3, at: T0 });
    const snap = new LiveSnapshotBuilder().build(input(engine));
    expect(snap.game.slides['2']!.function).toEqual({ action: 'api' });
    expectNoSecrets(JSON.stringify(snap));
  });

  it('תמונה דינמית שהכתובת שלה מכילה את מזהה המשחק — לא נשלחת', () => {
    const engine = new GameEngine(liveGame());
    const state = {
      ...engine.getState(),
      subjectCommand: {
        kind: 'dynamic-image' as const,
        url: `https://api.example/${GAME_ID}/chart.png`,
      },
    };
    const snap = new LiveSnapshotBuilder().build(input(engine, { state }));
    expect(snap.state.subjectCommand).toBeNull();
    expectNoSecrets(JSON.stringify(snap));
  });

  it('הגדרות המשחק: רק שדות מוכרים, בלי הקריינות', () => {
    const engine = new GameEngine(liveGame());
    const snap = new LiveSnapshotBuilder().build(input(engine));
    expect('narration' in snap.game.setting).toBe(false);
    expect(snap.game.setting.mainColor).toBe(engine.getGame().setting.mainColor);
  });

  it('וידאו המנחה: הדגל ברישיון לא יוצא לצופים; השידור — רק מזהה ומצב', () => {
    const game = liveGame();
    game.setting.hostVideo = true;
    const engine = new GameEngine(game);
    const builder = new LiveSnapshotBuilder();
    const off = builder.build(input(engine));
    expect('hostVideo' in off.game.setting).toBe(false);
    expect(off.video).toBeNull();
    const video = { gen: 'g1', cam: true, mic: false, extra: 'x' } as unknown as LiveVideo;
    const on = builder.build(input(engine, { video }));
    expect(on.video).toEqual({ gen: 'g1', cam: true, mic: false });
  });

  it('טיימר: עוגן חדש רק כשהספירה של הצופה הייתה סוטה', () => {
    const engine = votingOnFirst();
    const builder = new LiveSnapshotBuilder();
    const first = builder.build(
      input(engine, {
        timer: { remaining: 10, total: 15, paused: false, elapsedMs: 5000, sampledAt: 50_000 },
      }),
    ).timer;
    expect(first).toMatchObject({ remaining: 10, at: 50_000 });
    const same = builder.build(
      input(engine, {
        timer: { remaining: 9.8, total: 15, paused: false, elapsedMs: 5200, sampledAt: 50_200 },
      }),
    ).timer;
    expect(same).toEqual(first);
    const moved = builder.build(
      input(engine, {
        timer: { remaining: 9.8, total: 15, paused: true, elapsedMs: 5200, sampledAt: 50_300 },
      }),
    ).timer;
    expect(moved).toMatchObject({ paused: true, remaining: 9.8, at: 50_300 });
  });

  it('מסכי הניקוד במסך הצפייה מדורגים בדיוק כמו במסך הראשי', () => {
    const engine = votingOnFirst();
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: T0 + 15_000 });
    const snap = new LiveSnapshotBuilder().build(input(engine, { stage: 'scoreboard' }));
    const mirror = mirrorEngine(snap);
    const shown = mirror.getWinners(10).map((w) => [snap.names[w.voterId], w.score]);
    const real = engine.getWinners(10).map((w) => [maskPhoneLike(w.voterId), w.score]);
    expect(shown).toEqual(real);
    // מי שהצביע ולא צבר ניקוד מופיע גם הוא ב"הניקוד של כל המשתתפים"
    const voters = Object.values(mirror.getState().votesBySlide).flatMap((v) => Object.keys(v));
    expect(voters.map((a) => snap.names[a]).sort()).toEqual(PHONES.map(maskPhoneLike).sort());
    expect(mirror.getGame().questions).toHaveLength(4);
    expect(mirror.getCurrentSlide().question.que).toBe('ש1');
  });
});
