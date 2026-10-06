/**
 * ממסר השידור (server/live-relay.mjs), והשרשרת המלאה: מסך ראשי → ממסר →
 * מסך צפייה (publisher.ts / subscriber.ts) על שרת אמיתי בפורט פנוי.
 */

import { createHash } from 'node:crypto';
import { get as httpGet } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LivePublisher, type PublisherStatus } from '../src/live/publisher.ts';
import { LiveSubscriber, type ViewerUpdate } from '../src/live/subscriber.ts';
import { LIVE_SCHEMA, type LiveSnapshot } from '../src/live/types.ts';
// @ts-expect-error — שרת ב-JS, בלי הצהרות טיפוסים
import { startRelay, viewTokenFor } from '../server/live-relay.mjs';

interface RelayHandle {
  ready: Promise<{ port: number }>;
  close: () => Promise<void>;
  relay: { channels: Map<string, unknown> };
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const KEY = sha('trivia-live-pub:v1:game-1:2047');
const TOKEN: string = viewTokenFor(KEY);

let server: RelayHandle;
let base: string;

beforeEach(async () => {
  server = startRelay({ port: 0, limits: { pollMs: 400, publisherFreshMs: 600 } }) as RelayHandle;
  const address = await server.ready;
  base = `http://127.0.0.1:${address.port}/live`;
});

afterEach(async () => {
  await server.close();
});

async function publish(body: Record<string, unknown>, key = KEY, token = TOKEN) {
  const res = await fetch(`${base}/${token}/pub`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-live-key': key },
    body: JSON.stringify({ sid: 's1', started: 1, seq: 1, prev: -1, t: Date.now(), ...body }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function poll(after: number) {
  const res = await fetch(`${base}/${TOKEN}/poll?after=${after}&vid=test`);
  return (await res.json()) as Record<string, unknown>;
}

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout');
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

describe('הממסר', () => {
  it('בדיקת חיים', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('שידור עם מפתח שאינו של הערוץ — נדחה', async () => {
    const other = sha('trivia-live-pub:v1:another-game:2047');
    expect((await publish({ kind: 'key', data: { a: 1 } }, other)).status).toBe(403);
    expect((await publish({ kind: 'key', data: { a: 1 } }, 'not-a-key')).status).toBe(403);
  });

  it('מצב מלא, הפרש, וסנכרון לצופה שמצטרף', async () => {
    expect((await publish({ kind: 'key', seq: 1, data: { n: 1, list: [1] } })).status).toBe(200);
    expect((await publish({ kind: 'patch', seq: 2, prev: 1, ops: [[['n'], 2]] })).status).toBe(200);
    const joined = await poll(-1);
    expect(joined).toMatchObject({
      type: 'sync',
      live: true,
      v: 2,
      key: { v: 1, data: { n: 1, list: [1] } },
    });
    expect(joined.patches).toEqual([expect.objectContaining({ v: 2, ops: [[['n'], 2]] })]);
    // מי שכבר ראה את גרסה 1 מקבל רק את ההפרש
    const caughtUp = await poll(1);
    expect(caughtUp.key).toBeNull();
    expect(caughtUp.patches).toHaveLength(1);
  });

  it('הפרש שלא ממשיך את מה שהממסר מחזיק — מבקשים מצב מלא', async () => {
    expect((await publish({ kind: 'patch', seq: 1, prev: 0, ops: [] })).body).toEqual({
      error: 'need-key',
    });
    await publish({ kind: 'key', seq: 1, data: { n: 1 } });
    expect((await publish({ kind: 'patch', seq: 3, prev: 2, ops: [] })).body).toEqual({
      error: 'need-key',
    });
  });

  it('המתנה ארוכה: חוזרת עם השינוי ברגע שהוא קורה', async () => {
    await publish({ kind: 'key', seq: 1, data: { n: 1 } });
    const waiting = poll(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await publish({ kind: 'patch', seq: 2, prev: 1, ops: [[['n'], 5]] });
    const msg = await waiting;
    expect(msg).toMatchObject({ type: 'sync', v: 2 });
    // בלי שינוי — דופק אחרי זמן ההמתנה
    expect(await poll(2)).toMatchObject({ type: 'beat', v: 2 });
  });

  it('שני מסכים ראשיים: האחרון שנפתח משדר, וישן ששתק מוחלף', async () => {
    await publish({ sid: 'old', started: 100, kind: 'key', data: { who: 'old' } });
    expect(
      (await publish({ sid: 'new', started: 200, kind: 'key', data: { who: 'new' } })).status,
    ).toBe(200);
    expect((await publish({ sid: 'old', started: 100, seq: 2, kind: 'beat' })).body).toEqual({
      error: 'superseded',
    });
    // החדש משתתק — הישן רשאי לחזור (ומתבקש לשלוח מצב מלא)
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect((await publish({ sid: 'old', started: 100, seq: 3, kind: 'beat' })).body).toEqual({
      error: 'need-key',
    });
  });

  it('זרם SSE: סנכרון מיידי, ואז כל הפרש', async () => {
    await publish({ kind: 'key', seq: 1, data: { n: 1 } });
    const messages: Record<string, unknown>[] = [];
    const req = httpGet(`${base}/${TOKEN}/events`, (res) => {
      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.headers['x-accel-buffering']).toBe('no');
      let buffer = '';
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        let at = buffer.indexOf('\n\n');
        while (at >= 0) {
          const block = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          for (const line of block.split('\n')) {
            if (line.startsWith('data: '))
              messages.push(JSON.parse(line.slice(6)) as Record<string, unknown>);
          }
          at = buffer.indexOf('\n\n');
        }
      });
    });
    try {
      await until(() => messages.length >= 1);
      expect(messages[0]).toMatchObject({ type: 'sync', v: 1, key: { data: { n: 1 } } });
      await publish({ kind: 'patch', seq: 2, prev: 1, ops: [[['n'], 2]] });
      await until(() => messages.length >= 2);
      expect(messages[1]).toMatchObject({ type: 'patch', v: 2, patch: { ops: [[['n'], 2]] } });
    } finally {
      req.destroy();
    }
  });

  it('תקרת חיבורי צופים לכל השרת — מעליה "עמוס", ומתפנה כשצופה יוצא', async () => {
    await server.close();
    server = startRelay({ port: 0, limits: { maxConnections: 2, pollMs: 400 } }) as RelayHandle;
    base = `http://127.0.0.1:${(await server.ready).port}/live`;
    const open = () =>
      new Promise<{ status: number; close: () => void }>((resolve) => {
        const req = httpGet(`${base}/${TOKEN}/events`, (res) => {
          res.resume();
          resolve({ status: res.statusCode ?? 0, close: () => req.destroy() });
        });
      });
    const a = await open();
    const b = await open();
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await fetch(`${base}/${TOKEN}/poll?after=-1&vid=x`)).status).toBe(503);
    expect((await open()).status).toBe(503);
    a.close();
    await until(
      async () =>
        ((await (await fetch(`${base}/health`)).json()) as { connections: number }).connections < 2,
    );
    const c = await open();
    expect(c.status).toBe(200);
    b.close();
    c.close();
  });

  it('שידור מהיר מדי — נעצר', async () => {
    await publish({ kind: 'key', seq: 1, data: { n: 1 } });
    const statuses: number[] = [];
    for (let i = 0; i < 60; i++)
      statuses.push((await publish({ kind: 'beat', seq: 2 + i })).status);
    expect(statuses).toContain(429);
  });
});

function snapshot(over: Partial<LiveSnapshot> = {}): LiveSnapshot {
  return {
    schema: LIVE_SCHEMA,
    stage: 'opening',
    game: {
      name: 'בדיקה',
      setting: {} as LiveSnapshot['game']['setting'],
      slideCount: 1,
      slides: {},
    },
    state: {} as LiveSnapshot['state'],
    reveal: { questionShown: false, answersShown: 0, revealCorrect: false },
    timer: null,
    liveCorrectCount: null,
    players: [],
    leaders: [],
    lobby: [],
    join: { show: true, code: '2047', qr: '' },
    overlays: {
      leaders: false,
      votes: false,
      lobby: false,
      bet: null,
      groups: null,
      board: null,
      connect: null,
      raffle: null,
    },
    winnersRevealed: 0,
    scoresPage: 0,
    fn: { status: 'idle', detail: '' },
    paused: false,
    mediaAt: null,
    roster: { categories: [], memberships: {} },
    groupBonus: {},
    names: {},
    colors: {},
    sound: { seq: 0, kind: 'none', channel: '', src: '', loop: false, at: 0 },
    cues: [],
    ...over,
  };
}

describe('מסך ראשי → ממסר → מסך צפייה', () => {
  it('הצופה רואה כל שינוי, גם כשהוא מצטרף באמצע', async () => {
    let current = snapshot();
    const statuses: PublisherStatus[] = [];
    const publisher = new LivePublisher({
      relayBase: base,
      viewToken: TOKEN,
      publishKey: KEY,
      snapshot: () => current,
      minIntervalMs: 20,
      onStatus: (s) => statuses.push(s),
    });
    let seen: ViewerUpdate | null = null;
    const viewer = new LiveSubscriber({
      relayBase: base,
      viewToken: TOKEN,
      onUpdate: (u) => {
        seen = u;
      },
      EventSource: null, // המתנה ארוכה (ב-Node אין EventSource)
    });
    try {
      await until(() => statuses.some((s) => s.state === 'live'));
      viewer.start();
      const shown = () => (seen as ViewerUpdate | null)?.snapshot ?? null;
      await until(() => shown() !== null);
      expect(shown()).toEqual(current);
      expect((seen as ViewerUpdate | null)?.connection).toBe('live');

      current = snapshot({
        stage: 'playing',
        lobby: [{ id: 'v1', name: 'דנה', initial: 'ד', color: '#fff' }],
        names: { v1: 'דנה' },
      });
      publisher.poke();
      await until(() => shown()?.stage === 'playing');
      expect(shown()).toEqual(current);

      current = {
        ...current,
        lobby: [...current.lobby, { id: 'v2', name: 'יוסי', initial: 'י', color: '#000' }],
      };
      publisher.poke();
      await until(() => shown()?.lobby.length === 2);
      expect(shown()).toEqual(current);
      // הצופה מתרגם זמנים של המנחה לשעון שלו (כאן — אותו מחשב, כמעט אפס)
      expect(Math.abs((seen as ViewerUpdate | null)!.toLocal(1000) - 1000)).toBeLessThan(1000);
    } finally {
      publisher.stop();
      viewer.stop();
    }
  });

  it('ממסר שהופעל מחדש מקבל שוב מצב מלא', async () => {
    let current = snapshot({ winnersRevealed: 1 });
    const publisher = new LivePublisher({
      relayBase: base,
      viewToken: TOKEN,
      publishKey: KEY,
      snapshot: () => current,
      minIntervalMs: 20,
    });
    try {
      await until(() => publisher.currentStatus.state === 'live');
      // "הפעלה מחדש": הממסר שוכח הכול
      server.relay.channels.clear();
      current = snapshot({ winnersRevealed: 2 });
      publisher.poke();
      await until(() => {
        const channel = server.relay.channels.get(TOKEN) as { key: unknown } | undefined;
        return channel !== undefined && channel.key !== null;
      });
      const msg = await poll(-1);
      expect((msg.key as { data: LiveSnapshot }).data.winnersRevealed).toBe(2);
    } finally {
      publisher.stop();
    }
  });
});
