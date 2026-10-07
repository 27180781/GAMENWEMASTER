/**
 * וידאו המנחה בשרת (server/live-video.mjs), דרך הממסר האמיתי בפורט פנוי ומול
 * Cloudflare מדומה: זכאות מקובץ המשחק, מפתח המנחה, פתיחה וסגירה של שידור,
 * צופים, תקרת צופים, שני מסכים ראשיים, וניקוי של מה שהשתתק.
 */

import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error — שרת ב-JS, בלי הצהרות טיפוסים
import { startRelay, viewTokenFor } from '../server/live-relay.mjs';
// @ts-expect-error — שרת ב-JS, בלי הצהרות טיפוסים
import { createVideo, publishKeyFor } from '../server/live-video.mjs';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

const GAME = '0b5e8a52-6f0c-4d7e-9a51-7c2d3e4f5a6b';
const ROOM = '2047';
const KEY = sha(`trivia-live-pub:v1:${GAME}:${ROOM}`);
const TOKEN: string = viewTokenFor(KEY);
const CF = 'https://cf.test/v1';
const GAME_JSON = 'https://games.test/get-game-json?gameId=';

interface CfCall {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  auth: string | null;
}

/** Cloudflare + get-game-json מדומים, כ-fetch. */
function fakeWorld() {
  const calls: CfCall[] = [];
  const games = new Map<string, unknown>();
  const sessions = new Map<string, { local: Map<string, string> }>();
  let gameFetches = 0;
  let failNext: string | null = null;
  let n = 0;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(GAME_JSON)) {
      gameFetches += 1;
      const game = games.get(decodeURIComponent(url.slice(GAME_JSON.length)));
      return game === undefined ? json(404, { error: 'not found' }) : json(200, game);
    }
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    const headers = new Headers(init?.headers);
    const path = url.slice(CF.length);
    calls.push({ method: init?.method ?? 'GET', path, body, auth: headers.get('authorization') });
    if (failNext !== null && path.endsWith(failNext)) {
      failNext = null;
      return json(500, { errorCode: 'internal_error' });
    }
    if (path.startsWith('/turn/keys/')) {
      return json(201, {
        iceServers: [
          { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
          {
            urls: [
              'turn:turn.cloudflare.com:3478?transport=udp',
              'turn:turn.cloudflare.com:53?transport=udp',
            ],
            username: 'u',
            credential: 'c',
          },
        ],
      });
    }
    const m = /^\/apps\/APP\/sessions\/([^/]+)(?:\/(.+))?$/.exec(path);
    if (m === null) return json(404, { errorCode: 'not_found' });
    const [, session, rest] = m;
    if (session === 'new') {
      n += 1;
      const id = `sess${n}`;
      sessions.set(id, { local: new Map() });
      return json(201, { sessionId: id });
    }
    const s = sessions.get(session ?? '');
    if (s === undefined) return json(410, { errorCode: 'session_error' });
    if (rest === 'tracks/new') {
      const tracks = (body?.tracks ?? []) as Array<Record<string, unknown>>;
      if (body?.sessionDescription !== undefined) {
        for (const t of tracks) s.local.set(String(t.trackName), String(t.mid));
        return json(200, {
          requiresImmediateRenegotiation: false,
          tracks: tracks.map((t) => ({ trackName: t.trackName, mid: t.mid })),
          sessionDescription: { type: 'answer', sdp: `answer:${session}` },
        });
      }
      return json(200, {
        requiresImmediateRenegotiation: true,
        tracks: tracks.map((t, i) => {
          const owner = sessions.get(String(t.sessionId));
          return owner?.local.has(String(t.trackName))
            ? { sessionId: t.sessionId, trackName: t.trackName, mid: String(i) }
            : { trackName: t.trackName, errorCode: 'track_not_found' };
        }),
        sessionDescription: { type: 'offer', sdp: `offer:${session}` },
      });
    }
    if (rest === 'renegotiate') return json(200, {});
    if (rest === 'tracks/close') {
      return json(200, {
        requiresImmediateRenegotiation: false,
        tracks: ((body?.tracks ?? []) as Array<{ mid: string }>).map((t) => ({ mid: t.mid })),
      });
    }
    return json(404, { errorCode: 'not_found' });
  };

  return {
    calls,
    games,
    fetch: fetchImpl,
    gameFetches: () => gameFetches,
    failNext: (suffix: string) => {
      failNext = suffix;
    },
  };
}

function entitledGame(overrides: Record<string, unknown> = {}) {
  return {
    name: 'משחק',
    id: GAME,
    room: Number(ROOM),
    setting: { hostVideo: true, limit: { type: 'phones', number: 2 } },
    ...overrides,
  };
}

interface Server {
  ready: Promise<{ port: number }>;
  close: () => Promise<void>;
  relay: { video: { settle: () => Promise<void>; tick: () => void } };
}

let server: Server | null = null;
let clock = 1_000_000;

async function start(
  options: {
    env?: Record<string, string>;
    limits?: Record<string, unknown>;
    world?: ReturnType<typeof fakeWorld>;
  } = {},
) {
  const world = options.world ?? fakeWorld();
  clock = 1_000_000;
  const video = createVideo({
    fetch: world.fetch,
    now: () => clock,
    env: {
      CF_REALTIME_APP_ID: 'APP',
      CF_REALTIME_APP_SECRET: 'SECRET',
      CF_REALTIME_API_BASE: CF,
      LIVE_VIDEO_GAME_JSON_URL: GAME_JSON,
      ...options.env,
    },
    limits: options.limits ?? {},
    log: () => {},
  });
  server = startRelay({ port: 0, video }) as Server;
  const address = await server.ready;
  const base = `http://127.0.0.1:${address.port}/live/${TOKEN}/video`;
  const call = async (
    action: string,
    body: Record<string, unknown>,
    key: string | null = null,
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const res = await fetch(`${base}/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key === null ? {} : { 'x-live-key': key }),
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const host = (action: string, body: Record<string, unknown> = {}, key = KEY) =>
    call(action, { gameId: GAME, room: ROOM, ...body }, key);
  return { world, call, host, video };
}

const PUB = {
  sid: 'screen-1',
  started: 100,
  sdp: 'v=0 offer',
  tracks: [
    { mid: '0', kind: 'video' },
    { mid: '1', kind: 'audio' },
  ],
  simulcast: ['a', 'b'],
};

afterEach(async () => {
  await server?.close();
  server = null;
});

describe('וידאו המנחה — זכאות ומפתח', () => {
  it('המפתח של המנוע והשרת זהים', () => {
    expect(publishKeyFor(GAME, ROOM)).toBe(KEY);
    expect(publishKeyFor(` ${GAME} `, '02047')).toBe(KEY);
  });

  it('בלי מפתחות Cloudflare — "not-configured", גם למנחה וגם לצופה', async () => {
    const { host, call } = await start({
      env: { CF_REALTIME_APP_ID: '', CF_REALTIME_APP_SECRET: '' },
    });
    expect(await host('config')).toEqual({ status: 503, body: { error: 'not-configured' } });
    expect((await call('sub', { vid: 'v1' })).body).toEqual({ error: 'not-configured' });
  });

  it('מפתח שגוי, או מזהה/חדר שהמפתח לא נגזר מהם — נדחה', async () => {
    const { host } = await start();
    expect((await host('config', {}, sha('other'))).body).toEqual({ error: 'bad-key' });
    expect((await host('config', { room: '9999' })).body).toEqual({ error: 'bad-key' });
    expect((await host('config', { gameId: 'aaaaaaaa-0000' })).body).toEqual({ error: 'bad-key' });
  });

  it('משחק בלי וידאו ברישיון, משחק קליקרים, או חדר אחר ברישיון — "not-entitled"', async () => {
    const world = fakeWorld();
    const { host } = await start({ world });
    world.games.set(GAME, entitledGame({ setting: { limit: { type: 'phones', number: 2 } } }));
    expect(await host('config')).toEqual({ status: 403, body: { error: 'not-entitled' } });

    await server?.close();
    const world2 = fakeWorld();
    const second = await start({ world: world2 });
    world2.games.set(
      GAME,
      entitledGame({ setting: { hostVideo: true, limit: { type: 'clickers', number: 2 } } }),
    );
    expect((await second.host('config')).body).toEqual({ error: 'not-entitled' });

    await server?.close();
    const world3 = fakeWorld();
    const third = await start({ world: world3 });
    world3.games.set(GAME, entitledGame({ room: 5555 }));
    expect((await third.host('config')).body).toEqual({ error: 'not-entitled' });
  });

  it('קובץ המשחק לא נגיש — 502, ונבדק שוב אחרי זמן קצר', async () => {
    const world = fakeWorld();
    const { host } = await start({ world });
    expect(await host('config')).toEqual({ status: 403, body: { error: 'not-entitled' } }); // 404
    world.games.set(GAME, entitledGame());
    expect((await host('config')).status).toBe(403); // עדיין במטמון השלילי
    clock += 11_000;
    expect((await host('config')).status).toBe(200);
    expect(world.gameFetches()).toBe(2);
    // תשובה חיובית נשמרת דקה
    await host('config');
    clock += 30_000;
    await host('config');
    expect(world.gameFetches()).toBe(2);
  });

  it('config: שרתי ICE (STUN בלבד בלי TURN) והתקרה — המשתתפים ועוד מרווח', async () => {
    const world = fakeWorld();
    const { host } = await start({ world });
    world.games.set(
      GAME,
      entitledGame({ setting: { hostVideo: true, limit: { type: 'phones', number: 50 } } }),
    );
    const reply = await host('config');
    expect(reply.status).toBe(200);
    expect(reply.body.iceServers).toEqual([{ urls: ['stun:stun.cloudflare.com:3478'] }]);
    expect(reply.body.maxViewers).toBe(55);
  });

  it('עם מפתח TURN: הרשאה זמנית מ-Cloudflare, בלי פורט 53', async () => {
    const world = fakeWorld();
    const { host } = await start({
      world,
      env: { CF_TURN_KEY_ID: 'TK', CF_TURN_KEY_API_TOKEN: 'TT' },
    });
    world.games.set(GAME, entitledGame());
    const reply = await host('config');
    expect(reply.body.iceServers).toEqual([
      { urls: ['stun:stun.cloudflare.com:3478'] },
      { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' },
    ]);
    const turn = world.calls.find((c) => c.path.startsWith('/turn/'));
    expect(turn?.auth).toBe('Bearer TT');
    expect(turn?.path).toBe('/turn/keys/TK/credentials/generate-ice-servers');
  });
});

describe('וידאו המנחה — שידור וצפייה', () => {
  it('מנחה משדר, צופה מתחבר, הדופק סופר אותו, והוא עוזב', async () => {
    const world = fakeWorld();
    const { host, call, video } = await start({ world });
    world.games.set(GAME, entitledGame());

    const pub = await host('pub', PUB);
    expect(pub.status).toBe(200);
    expect(pub.body.sdp).toBe('answer:sess1');
    expect(pub.body.maxViewers).toBe(7);
    const gen = String(pub.body.gen);
    const tracksNew = world.calls.find((c) => c.path === '/apps/APP/sessions/sess1/tracks/new');
    expect(tracksNew?.auth).toBe('Bearer SECRET');
    expect(tracksNew?.body).toEqual({
      sessionDescription: { type: 'offer', sdp: 'v=0 offer' },
      tracks: [
        { location: 'local', mid: '0', trackName: 'video' },
        { location: 'local', mid: '1', trackName: 'audio' },
      ],
    });

    const sub = await call('sub', { vid: 'phone-1' });
    expect(sub.status).toBe(200);
    expect(sub.body.gen).toBe(gen);
    expect(sub.body.sdp).toBe('offer:sess2');
    expect(sub.body.tracks).toEqual([
      { mid: '0', kind: 'video' },
      { mid: '1', kind: 'audio' },
    ]);
    const remote = world.calls.find((c) => c.path === '/apps/APP/sessions/sess2/tracks/new');
    expect(remote?.body).toEqual({
      tracks: [
        {
          location: 'remote',
          sessionId: 'sess1',
          trackName: 'video',
          simulcast: {
            preferredRid: 'a',
            priorityOrdering: 'asciibetical',
            ridNotAvailable: 'asciibetical',
          },
        },
        { location: 'remote', sessionId: 'sess1', trackName: 'audio' },
      ],
    });

    const handle = String(sub.body.handle);
    expect(await call('answer', { handle, sdp: 'v=0 answer' })).toEqual({
      status: 200,
      body: { ok: true },
    });
    const reneg = world.calls.find((c) => c.path === '/apps/APP/sessions/sess2/renegotiate');
    expect(reneg?.body).toEqual({ sessionDescription: { type: 'answer', sdp: 'v=0 answer' } });
    expect((await call('answer', { handle, sdp: 'again' })).status).toBe(409);

    expect(await call('ping', { handle })).toEqual({ status: 200, body: { ok: true, gen } });
    expect((await host('beat', { gen })).body).toEqual({ ok: true, viewers: 1, maxViewers: 7 });

    expect((await call('leave', { handle })).status).toBe(200);
    await video.settle();
    const close = world.calls.find((c) => c.path === '/apps/APP/sessions/sess2/tracks/close');
    expect(close?.body).toEqual({ tracks: [{ mid: '0' }, { mid: '1' }], force: true });
    expect((await host('beat', { gen })).body.viewers).toBe(0);
    expect((await call('ping', { handle })).status).toBe(404);
  });

  it('בלי simulcast מצד המנחה — הצופה מבקש את הווידאו בלי שכבות', async () => {
    const world = fakeWorld();
    const { host, call } = await start({ world });
    world.games.set(GAME, entitledGame());
    await host('pub', { ...PUB, simulcast: [] });
    await call('sub', { vid: 'v' });
    const remote = world.calls.find((c) => c.path === '/apps/APP/sessions/sess2/tracks/new');
    expect((remote?.body?.tracks as unknown[])[0]).toEqual({
      location: 'remote',
      sessionId: 'sess1',
      trackName: 'video',
    });
  });

  it('רק מיקרופון (בלי מצלמה) — שידור של רצועה אחת', async () => {
    const world = fakeWorld();
    const { host, call } = await start({ world });
    world.games.set(GAME, entitledGame());
    const pub = await host('pub', { ...PUB, tracks: [{ mid: '0', kind: 'audio' }], simulcast: [] });
    expect(pub.status).toBe(200);
    const sub = await call('sub', { vid: 'v' });
    expect(sub.body.tracks).toEqual([{ mid: '0', kind: 'audio' }]);
  });

  it('הודעת מנחה פגומה — 400', async () => {
    const world = fakeWorld();
    const { host } = await start({ world });
    world.games.set(GAME, entitledGame());
    expect((await host('pub', { ...PUB, tracks: [{ mid: 'a b', kind: 'video' }] })).status).toBe(
      400,
    );
    expect((await host('pub', { ...PUB, tracks: [{ mid: '0', kind: 'screen' }] })).status).toBe(
      400,
    );
    expect(
      (
        await host('pub', {
          ...PUB,
          tracks: [
            { mid: '0', kind: 'video' },
            { mid: '1', kind: 'video' },
          ],
        })
      ).status,
    ).toBe(400);
    expect((await host('pub', { ...PUB, sdp: '' })).status).toBe(400);
  });

  it('תקלה ב-Cloudflare — 502, ובלי שידור תלוי', async () => {
    const world = fakeWorld();
    const { host, call } = await start({ world });
    world.games.set(GAME, entitledGame());
    world.failNext('/tracks/new');
    expect(await host('pub', PUB)).toEqual({ status: 502, body: { error: 'sfu-error' } });
    expect((await call('sub', { vid: 'v' })).body).toEqual({ error: 'no-video' });
  });

  it('תקרת צופים: משתתפי הרישיון ועוד המרווח; אותו דף שמתחבר שוב לא נספר פעמיים', async () => {
    const world = fakeWorld();
    const { host, call } = await start({
      world,
      limits: { capMarginMin: 1, capMarginRatio: 0 },
    });
    world.games.set(
      GAME,
      entitledGame({ setting: { hostVideo: true, limit: { type: 'phones', number: 1 } } }),
    );
    const pub = await host('pub', PUB);
    expect(pub.body.maxViewers).toBe(2);
    expect((await call('sub', { vid: 'a' })).status).toBe(200);
    expect((await call('sub', { vid: 'b' })).status).toBe(200);
    expect(await call('sub', { vid: 'c' })).toEqual({ status: 429, body: { error: 'full' } });
    // "a" רענן את הדף — מקבל צפייה חדשה במקום הקודמת
    expect((await call('sub', { vid: 'a' })).status).toBe(200);
    expect((await host('beat', { gen: pub.body.gen })).body.viewers).toBe(2);
  });

  it('תקרה כוללת לכל השרת', async () => {
    const world = fakeWorld();
    const { host, call } = await start({ world, env: { LIVE_VIDEO_MAX_VIEWERS: '1' } });
    world.games.set(
      GAME,
      entitledGame({ setting: { hostVideo: true, limit: { type: 'phones', number: 100 } } }),
    );
    expect((await host('pub', PUB)).body.maxViewers).toBe(1);
    expect((await call('sub', { vid: 'a' })).status).toBe(200);
    expect((await call('sub', { vid: 'b' })).body.error).toBe('full');
  });

  it('המנחה עוצר: Cloudflare סוגר את השידור, צופים חדשים מקבלים "no-video" וקיימים "gone"', async () => {
    const world = fakeWorld();
    const { host, call, video } = await start({ world });
    world.games.set(GAME, entitledGame());
    const gen = String((await host('pub', PUB)).body.gen);
    const handle = String((await call('sub', { vid: 'v' })).body.handle);
    await call('answer', { handle, sdp: 'x' });

    expect((await host('stop', { gen })).status).toBe(200);
    await video.settle();
    const closes = world.calls.filter((c) => c.path.endsWith('/tracks/close')).map((c) => c.path);
    expect(closes).toContain('/apps/APP/sessions/sess1/tracks/close');
    expect(closes).toContain('/apps/APP/sessions/sess2/tracks/close');
    expect((await call('sub', { vid: 'w' })).body.error).toBe('no-video');
    expect((await call('ping', { handle })).status).toBe(404);
    expect((await host('beat', { gen })).status).toBe(404);
  });

  it('שני מסכים ראשיים: החדש גובר, הישן לא חוטף בחזרה לבד — רק בלחיצה', async () => {
    const world = fakeWorld();
    const { host } = await start({ world });
    world.games.set(GAME, entitledGame());
    const a = await host('pub', { ...PUB, sid: 'A', started: 100 });
    const b = await host('pub', { ...PUB, sid: 'B', started: 200 });
    expect(b.status).toBe(200);
    expect(await host('beat', { gen: a.body.gen })).toEqual({
      status: 409,
      body: { error: 'superseded' },
    });
    // ניסיון אוטומטי של הישן נדחה
    expect((await host('pub', { ...PUB, sid: 'A', started: 100 })).body).toEqual({
      error: 'superseded',
    });
    // לחיצה של המנחה במסך הישן — גוברת
    const again = await host('pub', { ...PUB, sid: 'A', started: 100, force: true });
    expect(again.status).toBe(200);
    expect((await host('beat', { gen: b.body.gen })).body).toEqual({ error: 'superseded' });
  });

  it('מנחה ששתק — השידור נסגר; צפייה ששתקה — נסגרת', async () => {
    const world = fakeWorld();
    const { host, call, video } = await start({ world });
    world.games.set(GAME, entitledGame());
    const gen = String((await host('pub', PUB)).body.gen);
    const h1 = String((await call('sub', { vid: '1' })).body.handle);
    await call('answer', { handle: h1, sdp: 'x' });
    const h2 = String((await call('sub', { vid: '2' })).body.handle);
    await call('answer', { handle: h2, sdp: 'x' });

    for (let i = 0; i < 3; i += 1) {
      clock += 27_000;
      expect((await host('beat', { gen })).status).toBe(200);
      expect((await call('ping', { handle: h2 })).status).toBe(200);
    }
    // h1 שתק 81 שניות, h2 — 0
    server?.relay.video.tick();
    await video.settle();
    expect((await call('ping', { handle: h1 })).status).toBe(404);
    expect((await call('ping', { handle: h2 })).status).toBe(200);

    clock += 45_000; // המנחה שתק 75 שניות
    server?.relay.video.tick();
    await video.settle();
    expect((await call('sub', { vid: '3' })).body.error).toBe('no-video');
    expect((await host('beat', { gen })).body).toEqual({ error: 'gone' });
    const closes = world.calls.filter((c) => c.path === '/apps/APP/sessions/sess1/tracks/close');
    expect(closes).toHaveLength(1);
  });

  it('צפייה שלא השלימה את ה-SDP מפנה מקום אחרי 30 שניות', async () => {
    const world = fakeWorld();
    const { host, call } = await start({ world, limits: { capMarginMin: 0, capMarginRatio: 0 } });
    world.games.set(
      GAME,
      entitledGame({ setting: { hostVideo: true, limit: { type: 'phones', number: 1 } } }),
    );
    const gen = String((await host('pub', PUB)).body.gen);
    expect((await call('sub', { vid: 'a' })).status).toBe(200);
    expect((await call('sub', { vid: 'b' })).body.error).toBe('full');
    clock += 31_000;
    await host('beat', { gen });
    expect((await call('sub', { vid: 'b' })).status).toBe(200);
  });

  it('קצב הצטרפויות מוגבל לכל משחק', async () => {
    const world = fakeWorld();
    const { host, call } = await start({ world, limits: { subscribePerSecond: 1 } });
    world.games.set(
      GAME,
      entitledGame({ setting: { hostVideo: true, limit: { type: 'phones', number: 100 } } }),
    );
    await host('pub', PUB);
    const results = [];
    for (let i = 0; i < 6; i += 1) results.push((await call('sub', { vid: `v${i}` })).status);
    expect(results).toEqual([200, 200, 200, 200, 429, 429]);
  });

  it('דופק מנחה עם מפתח שגוי — נדחה', async () => {
    const world = fakeWorld();
    const { host } = await start({ world });
    world.games.set(GAME, entitledGame());
    const gen = (await host('pub', PUB)).body.gen;
    expect((await host('beat', { gen }, sha('x'))).body).toEqual({ error: 'bad-key' });
    expect((await host('stop', { gen }, sha('x'))).body).toEqual({ error: 'bad-key' });
  });

  it('עזיבה ב-sendBeacon (גוף בלי content-type) מתקבלת', async () => {
    const world = fakeWorld();
    const { host, call } = await start({ world });
    world.games.set(GAME, entitledGame());
    const gen = (await host('pub', PUB)).body.gen;
    const handle = String((await call('sub', { vid: 'v' })).body.handle);
    const address = await server!.ready;
    const res = await fetch(`http://127.0.0.1:${address.port}/live/${TOKEN}/video/leave`, {
      method: 'POST',
      body: JSON.stringify({ handle }),
    });
    expect(res.status).toBe(200);
    expect((await host('beat', { gen })).body.viewers).toBe(0);
  });
});
