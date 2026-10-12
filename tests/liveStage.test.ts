/**
 * «במה» בשרת (server/live-stage.mjs), דרך הממסר האמיתי בפורט פנוי ומול
 * Cloudflare מדומה: הזכאות והמנחה, משתתף שמדליק מצלמה, מי על הבמה, צופים
 * שרואים רק את מי שעל הבמה (ונחתכים מיד כשהוא יורד), כיבוי בידי המנחה, החלפה
 * של מצלמה, וסגירה כשהמנחה מכבה את הווידאו או נעלם.
 */

import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error — שרת ב-JS, בלי הצהרות טיפוסים
import { startRelay } from '../server/live-relay.mjs';
// @ts-expect-error — שרת ב-JS, בלי הצהרות טיפוסים
import { cleanName, pidFor } from '../server/live-stage.mjs';
// @ts-expect-error — שרת ב-JS, בלי הצהרות טיפוסים
import { createVideo } from '../server/live-video.mjs';
import {
  CF,
  entitledGame,
  fakeWorld,
  GAME,
  GAME_JSON,
  KEY,
  ROOM,
  TOKEN,
} from './liveVideoWorld.ts';

interface Server {
  ready: Promise<{ port: number }>;
  close: () => Promise<void>;
}

type Reply = { status: number; body: Record<string, unknown> };

let server: Server | null = null;
let clock = 1_000_000;

function stageGame(setting: Record<string, unknown> = {}) {
  return entitledGame({
    setting: {
      hostVideo: true,
      hostVideoStage: true,
      limit: { type: 'phones', number: 2 },
      ...setting,
    },
  });
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

/** מזהה פרטי של דף משתתף (32 תווי hex). */
const cid = (n: number) => n.toString(16).padStart(32, '0');
const pid = (n: number): string => pidFor(TOKEN, cid(n));
const CAM = { sdp: 'v=0 cam offer', mid: '0', simulcast: ['a', 'b'] };

async function start(
  options: {
    limits?: Record<string, unknown>;
    game?: unknown;
    world?: ReturnType<typeof fakeWorld>;
  } = {},
) {
  const world = options.world ?? fakeWorld();
  world.games.set(GAME, options.game ?? stageGame());
  clock = 1_000_000;
  const video = createVideo({
    fetch: world.fetch,
    now: () => clock,
    env: {
      CF_REALTIME_APP_ID: 'APP',
      CF_REALTIME_APP_SECRET: 'SECRET',
      CF_REALTIME_API_BASE: CF,
      LIVE_VIDEO_GAME_JSON_URL: GAME_JSON,
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
  ): Promise<Reply> => {
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
  /** וידאו המנחה משודר — בלעדיו אי אפשר לפתוח את הבמה. */
  const publish = async (): Promise<string> => {
    const reply = await host('pub', PUB);
    expect(reply.status).toBe(200);
    return reply.body.gen as string;
  };
  /** הסקר של המנחה: מה הוא רוצה, ומה חוזר. */
  const stage = (gen: string, body: Record<string, unknown> = {}) =>
    host('stage', { gen, open: true, ...body });
  const camOn = (n: number, name = `משתתף ${n}`, extra: Record<string, unknown> = {}) =>
    call('cam', { cid: cid(n), name, ...CAM, ...extra });
  /** שם הסשן ב-Cloudflare המדומה של בקשת tracks/new האחרונה עם רצועות מרוחקות. */
  const lastRemoteSession = () => {
    const found = [...world.calls]
      .reverse()
      .find(
        (c) =>
          c.path.endsWith('/tracks/new') &&
          Array.isArray(c.body?.tracks) &&
          (c.body.tracks as Array<{ location: string }>)[0]?.location === 'remote',
      );
    return /sessions\/([^/]+)\//.exec(found?.path ?? '')?.[1] ?? null;
  };
  const closedOn = (session: string) =>
    world.calls
      .filter((c) => c.method === 'PUT' && c.path === `/apps/APP/sessions/${session}/tracks/close`)
      .flatMap((c) => (c.body?.tracks as Array<{ mid: string }>).map((t) => t.mid));
  return { world, call, host, video, publish, stage, camOn, lastRemoteSession, closedOn };
}

afterEach(async () => {
  await server?.close();
  server = null;
});

describe('במה — מזהים ושמות', () => {
  it('המזהה הציבורי נגזר מהמזהה הפרטי ומהמשחק, ולא חושף אותו', () => {
    expect(pid(1)).toMatch(/^[0-9a-f]{16}$/);
    expect(pid(1)).toBe(pidFor(TOKEN, cid(1)));
    expect(pid(1)).not.toBe(pid(2));
    expect(pidFor('a'.repeat(20), cid(1))).not.toBe(pid(1));
  });

  it('שם: בלי תווי בקרה וכיווניות, רווח אחד, עד 20 תווים', () => {
    expect(cleanName('  דנה ‮כהן‏  ')).toBe('דנה כהן');
    expect(cleanName('א\nב\tג')).toBe('א ב ג');
    expect(cleanName('א'.repeat(30))).toBe('א'.repeat(20));
    expect(cleanName('​‪')).toBe('');
    expect(cleanName(42)).toBe('');
  });
});

describe('במה — המנחה פותח', () => {
  it('רק ברישיון עם «במה», רק כשהווידאו משודר, ורק מהמסך שמחזיק את השידור', async () => {
    const { publish, stage } = await start({ game: stageGame({ hostVideoStage: false }) });
    const gen = await publish();
    expect(await stage(gen)).toEqual({ status: 403, body: { error: 'not-entitled' } });

    await server?.close();
    const second = await start();
    // בלי שידור — אי אפשר לפתוח
    expect(await second.stage('')).toEqual({ status: 409, body: { error: 'no-video' } });
    const gen2 = await second.publish();
    const opened = await second.stage(gen2);
    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({ ok: true, open: true, ids: [], cams: [], maxOnStage: 9 });
    // מסך ראשי אחר (שידור אחר) — לא משנה כלום
    expect(await second.stage('someone-else')).toEqual({
      status: 409,
      body: { error: 'superseded' },
    });
    // מפתח שגוי
    expect((await second.host('stage', { gen: gen2, open: true }, 'f'.repeat(64))).body).toEqual({
      error: 'bad-key',
    });
  });

  it('משתתף לא מדליק מצלמה כשהבמה סגורה', async () => {
    const { call, camOn, publish } = await start();
    await publish();
    expect(await call('cam-config', { cid: cid(1) })).toEqual({
      status: 409,
      body: { error: 'closed' },
    });
    expect((await camOn(1)).body).toEqual({ error: 'closed' });
  });
});

describe('במה — משתתף מדליק מצלמה', () => {
  it('הכנה ושידור: ICE, מזהה ציבורי, ומצלמה ש-Cloudflare מקבל בשם "cam"', async () => {
    const { call, camOn, publish, stage, world } = await start();
    const gen = await publish();
    await stage(gen);

    const config = await call('cam-config', { cid: cid(1) });
    expect(config.status).toBe(200);
    expect(config.body).toMatchObject({ ok: true, id: pid(1) });
    expect(Array.isArray(config.body.iceServers)).toBe(true);
    expect((await call('cam-config', { cid: 'not-hex' })).status).toBe(400);

    const on = await camOn(1, '  רותי‮  ');
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ ok: true, id: pid(1), onStage: false });
    expect(on.body.sdp).toMatch(/^answer:/);
    const publishCall = world.calls.find(
      (c) =>
        c.path.endsWith('/tracks/new') &&
        (c.body?.tracks as Array<{ location: string }>)[0]?.location === 'local' &&
        (c.body?.tracks as Array<{ trackName: string }>)[0]?.trackName === 'cam',
    );
    expect(publishCall).toBeDefined();

    // המנחה רואה אותה, עם השם הנקי
    const polled = await stage(gen);
    expect(polled.body.cams).toEqual([{ id: pid(1), name: 'רותי', at: expect.any(Number) }]);
  });

  it('בלי שם, SDP או mid תקינים — נדחה', async () => {
    const { camOn, publish, stage } = await start();
    await stage(await publish());
    expect((await camOn(1, '   ')).status).toBe(400);
    expect((await camOn(1, 'דנה', { sdp: '' })).status).toBe(400);
    expect((await camOn(1, 'דנה', { mid: 'a b' })).status).toBe(400);
    expect((await camOn(1, 'דנה', { simulcast: ['A!'] })).status).toBe(400);
  });

  it('דופק: מחזיר אם הוא על הבמה; בלי דופק המצלמה נכבית', async () => {
    const { call, camOn, publish, stage, video } = await start();
    const gen = await publish();
    await stage(gen);
    const handle = (await camOn(1)).body.handle as string;
    expect((await call('cam-beat', { handle })).body).toEqual({ ok: true, onStage: false });
    await stage(gen, { ids: [pid(1)] });
    expect((await call('cam-beat', { handle })).body).toEqual({ ok: true, onStage: true });

    clock += 36_000; // לא דפק
    video.tick();
    expect(await call('cam-beat', { handle })).toEqual({ status: 404, body: { error: 'timeout' } });
    const polled = await stage(gen, { ids: [pid(1)] });
    expect(polled.body).toMatchObject({ ids: [], cams: [] });
  });

  it('כיבוי בידי המשתתף: "stopped", והמנחה כבר לא רואה אותה', async () => {
    const { call, camOn, publish, stage, video, closedOn } = await start();
    const gen = await publish();
    await stage(gen);
    const handle = (await camOn(1)).body.handle as string;
    expect((await call('cam-stop', { handle })).body).toEqual({ ok: true });
    await video.settle();
    expect(closedOn('sess2')).toEqual(['0']); // sess1 = המנחה, sess2 = המצלמה
    expect(await call('cam-beat', { handle })).toEqual({ status: 404, body: { error: 'stopped' } });
    expect((await stage(gen)).body.cams).toEqual([]);
  });

  it('תקרת מצלמות ומגבלת קצב', async () => {
    const { camOn, publish, stage } = await start({
      limits: { stage: { maxCams: 2, camPerSecond: 1, camBurst: 3 } },
    });
    await stage(await publish());
    expect((await camOn(1)).status).toBe(200);
    expect((await camOn(2)).status).toBe(200);
    expect(await camOn(3)).toEqual({ status: 429, body: { error: 'full' } });
    // אותו משתתף מתחבר שוב — לא נספר פעמיים, אבל עדיין במגבלת הקצב
    expect((await camOn(1)).status).toBe(200);
    expect(await camOn(2)).toEqual({ status: 429, body: { error: 'slow-down' } });
    clock += 1000;
    expect((await camOn(2)).status).toBe(200);
  });
});

describe('במה — מי על הבמה, ומי רואה', () => {
  it('צופה רואה רק את מי שעל הבמה; המסך הראשי רואה כל מצלמה', async () => {
    const { call, camOn, host, publish, stage, world, lastRemoteSession } = await start();
    const gen = await publish();
    await stage(gen);
    await camOn(1, 'אבי');
    await camOn(2, 'בתיה');

    // עוד לא על הבמה
    expect(await call('stage-sub', { vid: 'v1', ids: [pid(1)] })).toEqual({
      status: 409,
      body: { error: 'stale' },
    });
    // המסך הראשי: תצוגה מקדימה של כל מצלמה
    const preview = await host('stage-sub', { vid: 'h1', ids: [pid(1), pid(2)] });
    expect(preview.status).toBe(200);
    expect(preview.body.tracks).toEqual([
      { mid: '0', id: pid(1) },
      { mid: '1', id: pid(2) },
    ]);

    const before = (await stage(gen)).body.v as number;
    const up = await stage(gen, { ids: [pid(2), pid(1)] });
    expect(up.body.ids).toEqual([pid(2), pid(1)]);
    expect(up.body.v).toBeGreaterThan(before);

    const sub = await call('stage-sub', { vid: 'v1', ids: [pid(2), pid(1)], layer: 'low' });
    expect(sub.status).toBe(200);
    expect(sub.body).toMatchObject({ ok: true, v: up.body.v });
    expect(sub.body.sdp).toMatch(/^offer:/);
    const remote = world.calls.find(
      (c) => c.path === `/apps/APP/sessions/${lastRemoteSession()}/tracks/new`,
    );
    // שכבה נמוכה לצופה, מהסשן של כל מצלמה
    expect(remote?.body?.tracks).toEqual([
      {
        location: 'remote',
        sessionId: 'sess3',
        trackName: 'cam',
        simulcast: {
          preferredRid: 'b',
          priorityOrdering: 'asciibetical',
          ridNotAvailable: 'asciibetical',
        },
      },
      {
        location: 'remote',
        sessionId: 'sess2',
        trackName: 'cam',
        simulcast: {
          preferredRid: 'b',
          priorityOrdering: 'asciibetical',
          ridNotAvailable: 'asciibetical',
        },
      },
    ]);
    const high = await host('stage-sub', { vid: 'h2', ids: [pid(1)], layer: 'high' });
    expect(high.status).toBe(200);
    const highCall = world.calls.find(
      (c) => c.path === `/apps/APP/sessions/${lastRemoteSession()}/tracks/new`,
    );
    expect(
      (highCall?.body?.tracks as Array<{ simulcast: { preferredRid: string } }>)[0]?.simulcast
        .preferredRid,
    ).toBe('a');

    const answer = await call('stage-answer', { handle: sub.body.handle, sdp: 'v=0 answer' });
    expect(answer.body).toEqual({ ok: true });
    expect((await call('stage-ping', { handle: sub.body.handle })).body).toEqual({
      ok: true,
      v: up.body.v,
      stale: false,
    });
  });

  it('עד 9 על הבמה, ורק מצלמות דלוקות; מי שהמצלמה שלו כבתה חוזר כשהיא נדלקת', async () => {
    const { camOn, publish, stage, video } = await start({
      limits: { stage: { camBurst: 100 } },
    });
    const gen = await publish();
    await stage(gen);
    for (let n = 1; n <= 11; n += 1) expect((await camOn(n)).status).toBe(200);
    const all = Array.from({ length: 11 }, (_, i) => pid(i + 1));
    const up = await stage(gen, { ids: [...all, 'zz', pid(1)] });
    expect(up.body.ids).toEqual(all.slice(0, 9));
    // מצלמה שלא קיימת — לא על הבמה
    const ghost = await stage(gen, { ids: [pid(40), pid(1)] });
    expect(ghost.body.ids).toEqual([pid(1)]);

    // המצלמה של 1 כבתה (בלי דופק) — יורד; נדלקת שוב — חוזר, כי המנחה עדיין רוצה אותו
    clock += 36_000;
    for (let n = 2; n <= 11; n += 1) await camOn(n); // האחרים התחברו שוב בינתיים
    video.tick();
    expect((await stage(gen, { ids: [pid(1), pid(2)] })).body.ids).toEqual([pid(2)]);
    await camOn(1);
    expect((await stage(gen, { ids: [pid(1), pid(2)] })).body.ids).toEqual([pid(1), pid(2)]);
  });

  it('מי שירד מהבמה נחתך אצל הצופים מיד, אבל לא בתצוגה המקדימה של המנחה', async () => {
    const { call, camOn, host, publish, stage, video, closedOn, lastRemoteSession } = await start();
    const gen = await publish();
    await stage(gen);
    await camOn(1);
    await camOn(2);
    await stage(gen, { ids: [pid(1), pid(2)] });
    const viewer = await call('stage-sub', { vid: 'v1', ids: [pid(1), pid(2)] });
    const viewerSession = lastRemoteSession() as string;
    await call('stage-answer', { handle: viewer.body.handle, sdp: 'v=0 answer' });
    const preview = await host('stage-sub', { vid: 'h1', ids: [pid(1), pid(2)] });
    const previewSession = lastRemoteSession() as string;
    await call('stage-answer', { handle: preview.body.handle, sdp: 'v=0 answer' });

    const down = await stage(gen, { ids: [pid(2)] });
    expect(down.body.ids).toEqual([pid(2)]);
    await video.settle();
    expect(closedOn(viewerSession)).toEqual(['0']); // הרצועה של 1
    expect(closedOn(previewSession)).toEqual([]);
    const ping = await call('stage-ping', { handle: viewer.body.handle });
    expect(ping.body).toEqual({ ok: true, v: down.body.v, stale: true });
    // והוא כבר לא יכול לבקש אותו
    expect((await call('stage-sub', { vid: 'v1', ids: [pid(1)] })).body).toEqual({
      error: 'stale',
    });
  });

  it('המנחה מכבה מצלמה: נכבית, יורדת מהבמה, והמשתתף לא מדליק שוב', async () => {
    const { call, camOn, publish, stage, video } = await start();
    const gen = await publish();
    await stage(gen);
    const handle = (await camOn(1)).body.handle as string;
    await camOn(2);
    await stage(gen, { ids: [pid(1), pid(2)] });

    const off = await stage(gen, { ids: [pid(1), pid(2)], off: [pid(1)] });
    expect(off.body.ids).toEqual([pid(2)]);
    expect(off.body.cams).toEqual([{ id: pid(2), name: 'משתתף 2', at: expect.any(Number) }]);
    expect(await call('cam-beat', { handle })).toEqual({ status: 404, body: { error: 'blocked' } });
    expect(await call('cam-config', { cid: cid(1) })).toEqual({
      status: 403,
      body: { error: 'blocked' },
    });
    expect((await camOn(1)).body).toEqual({ error: 'blocked' });

    // גם אחרי שהבמה נסגרת ונפתחת; ואחרי שעבר הזמן — שוב אפשר
    await stage(gen, { open: false });
    await stage(gen);
    expect((await camOn(1)).body).toEqual({ error: 'blocked' });
    clock += 31 * 60_000;
    await stage(gen); // המנחה ממשיך לשאול
    video.tick();
    expect((await camOn(1)).status).toBe(200);
  });

  it('אותו משתתף מתחבר שוב: המצלמה הקודמת "replaced", והוא נשאר על הבמה', async () => {
    const { call, camOn, publish, stage, video, closedOn, lastRemoteSession } = await start();
    const gen = await publish();
    await stage(gen);
    const first = (await camOn(1)).body.handle as string;
    const up = await stage(gen, { ids: [pid(1)] });
    const viewer = await call('stage-sub', { vid: 'v1', ids: [pid(1)] });
    const viewerSession = lastRemoteSession() as string;
    await call('stage-answer', { handle: viewer.body.handle, sdp: 'v=0 answer' });

    const again = await camOn(1);
    expect(again.body).toMatchObject({ ok: true, id: pid(1), onStage: true });
    expect(await call('cam-beat', { handle: first })).toEqual({
      status: 404,
      body: { error: 'replaced' },
    });
    const after = await stage(gen, { ids: [pid(1)] });
    expect(after.body.ids).toEqual([pid(1)]);
    expect(after.body.v).toBeGreaterThan(up.body.v as number); // הצופים יתחברו מחדש
    await video.settle();
    expect(closedOn(viewerSession)).toEqual(['0']);
    expect((await call('stage-ping', { handle: viewer.body.handle })).body).toMatchObject({
      stale: true,
    });
  });

  it('אותו דף מתחבר מחדש: עד שתי צפיות, הישנה ביותר נסגרת', async () => {
    const { call, camOn, publish, stage, video, closedOn } = await start();
    const gen = await publish();
    await stage(gen);
    await camOn(1);
    await stage(gen, { ids: [pid(1)] });
    const a = await call('stage-sub', { vid: 'v1', ids: [pid(1)] });
    const b = await call('stage-sub', { vid: 'v1', ids: [pid(1)] });
    const c = await call('stage-sub', { vid: 'v1', ids: [pid(1)] });
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
    await video.settle();
    // sess1 מנחה, sess2 מצלמה, sess3/4/5 הצפיות
    expect(closedOn('sess3')).toEqual(['0']);
    expect(closedOn('sess4')).toEqual([]);
    expect((await call('stage-ping', { handle: a.body.handle })).status).toBe(404);
    expect((await call('stage-ping', { handle: c.body.handle })).status).toBe(200);
    expect((await call('stage-leave', { handle: c.body.handle })).body).toEqual({ ok: true });
    expect((await call('stage-ping', { handle: c.body.handle })).status).toBe(404);
  });

  it('תקרת צופים כמו בווידאו המנחה; דף שמתחבר מחדש נספר פעם אחת', async () => {
    const { call, camOn, publish, stage } = await start({
      game: stageGame({ limit: { type: 'phones', number: 1 } }), // תקרה 6
    });
    const gen = await publish();
    await stage(gen);
    await camOn(1);
    await stage(gen, { ids: [pid(1)] });
    const first: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await call('stage-sub', { vid: `v${i}`, ids: [pid(1)] });
      expect(res.status).toBe(200);
      first.push(res.body.handle as string);
    }
    expect(await call('stage-sub', { vid: 'v99', ids: [pid(1)] })).toEqual({
      status: 429,
      body: { error: 'full' },
    });
    // צופה שכבר בפנים מתחבר מחדש (הבמה השתנתה) — גם כשהתקרה מלאה
    expect((await call('stage-sub', { vid: 'v0', ids: [pid(1)] })).status).toBe(200);
    // מי שעוזב מפנה מקום
    await call('stage-leave', { handle: first[1] });
    expect((await call('stage-sub', { vid: 'v99', ids: [pid(1)] })).status).toBe(200);
  });
});

describe('במה — נסגרת', () => {
  it('המנחה סוגר: כל המצלמות נכבות "closed" וכל הצפיות נסגרות', async () => {
    const { call, camOn, publish, stage, video } = await start();
    const gen = await publish();
    await stage(gen);
    const handle = (await camOn(1)).body.handle as string;
    await stage(gen, { ids: [pid(1)] });
    const viewer = await call('stage-sub', { vid: 'v1', ids: [pid(1)] });

    const closed = await stage(gen, { open: false });
    expect(closed.body).toMatchObject({ ok: true, open: false, ids: [], cams: [] });
    expect(await call('cam-beat', { handle })).toEqual({ status: 404, body: { error: 'closed' } });
    expect((await call('stage-ping', { handle: viewer.body.handle })).status).toBe(404);
    expect(await call('cam-config', { cid: cid(1) })).toEqual({
      status: 409,
      body: { error: 'closed' },
    });
    expect(video.stats()).toMatchObject({ stages: 0, cams: 0, stageViewers: 0 });
  });

  it('המנחה מכבה את הווידאו — גם הבמה נסגרת', async () => {
    const { call, camOn, host, publish, stage } = await start();
    const gen = await publish();
    await stage(gen);
    const handle = (await camOn(1)).body.handle as string;
    expect((await host('stop', { gen })).body).toEqual({ ok: true });
    expect(await call('cam-beat', { handle })).toEqual({ status: 404, body: { error: 'closed' } });
  });

  it('השידור התנתק: הבמה ממתינה למנחה; מנחה שנעלם לגמרי — נסגרת', async () => {
    const { call, camOn, publish, stage, video } = await start();
    const gen = await publish();
    await stage(gen);
    const handle = (await camOn(1)).body.handle as string;

    // השידור של המנחה השתתק (40 שניות), אבל המסך עוד שואל על הבמה
    clock += 20_000;
    await call('cam-beat', { handle });
    clock += 21_000;
    await call('cam-beat', { handle });
    video.tick();
    expect(video.stats()).toMatchObject({ publications: 0, stages: 1 });
    const still = await stage(gen);
    expect(still.body).toMatchObject({ open: true, cams: [{ id: pid(1), name: 'משתתף 1' }] });

    // המנחה הפסיק לשאול
    clock += 30_000;
    await call('cam-beat', { handle });
    clock += 31_000;
    await call('cam-beat', { handle });
    video.tick();
    expect(await call('cam-beat', { handle })).toEqual({ status: 404, body: { error: 'timeout' } });
    expect(video.stats()).toMatchObject({ stages: 0 });
  });

  it('אחרי הפעלה מחדש של השרת: המנחה פותח שוב בסקר, והמשתתפים מתחברים שוב לאותו מקום', async () => {
    const first = await start();
    const gen = await first.publish();
    await first.stage(gen);
    await first.camOn(1);
    await first.stage(gen, { ids: [pid(1)] });
    await server?.close();

    const fresh = await start();
    const gen2 = await fresh.publish();
    const reopened = await fresh.stage(gen2, { ids: [pid(1)] });
    expect(reopened.body).toMatchObject({ open: true, ids: [] });
    expect((await fresh.camOn(1)).body).toMatchObject({ ok: true, id: pid(1), onStage: true });
    expect((await fresh.stage(gen2, { ids: [pid(1)] })).body.ids).toEqual([pid(1)]);
  });
});
