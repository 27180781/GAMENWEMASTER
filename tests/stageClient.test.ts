/**
 * «במה» בדפדפן (src/live/video): העזרים הטהורים של stage.ts, ומה שהמסך הראשי
 * (stageHost.ts), המשתתף (stageCam.ts) והצופה (stageReceiver.ts) עושים מול
 * השרת האמיתי — server/live-stage.mjs, דרך הממסר בפורט פנוי ומול Cloudflare
 * מדומה — עם חיבורי WebRTC ומצלמה מדומים.
 */

import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error — שרת ב-JS, בלי הצהרות טיפוסים
import { startRelay } from '../server/live-relay.mjs';
// @ts-expect-error — שרת ב-JS, בלי הצהרות טיפוסים
import { pidFor } from '../server/live-stage.mjs';
// @ts-expect-error — שרת ב-JS, בלי הצהרות טיפוסים
import { createVideo } from '../server/live-video.mjs';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../src/render/Stage.tsx';
import {
  DEFAULT_STAGE_WINDOW_PREFS,
  galleryLayout,
  keepWanted,
  liveStageOf,
  parseStageWindowPrefs,
  previewIds,
  resizedStageWindow,
  serializeStageWindowPrefs,
  STAGE_CID_STORAGE_KEY,
  STAGE_WINDOW_LARGE,
  STAGE_WINDOW_SMALL,
  stageCid,
  stageColumns,
  stageFromSnapshot,
  initialVideoSlots,
  videoSlotsStep,
  viewerLayer,
  type VideoSlots,
  type VideoSlotsAction,
} from '../src/live/video/stage.ts';
import {
  STAGE_CAM_OFF,
  StageCamPublisher,
  type StageCamState,
} from '../src/live/video/stageCam.ts';
import {
  liveStageOfHost,
  STAGE_HOST_CLOSED,
  StageHostController,
  type StageHostState,
} from '../src/live/video/stageHost.ts';
import {
  STAGE_VIEW_IDLE,
  StageReceiver,
  type StageViewState,
} from '../src/live/video/stageReceiver.ts';
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

// ------------------------------------------------------------------ טהור

describe('במה — עזרים', () => {
  it('רשת: 1 בעמודה, עד 4 בשתיים, ומעל — שלוש; שכבה עליונה רק ל-1–2', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(stageColumns)).toEqual([1, 2, 2, 2, 3, 3, 3, 3, 3]);
    expect([1, 2, 3, 9].map(viewerLayer)).toEqual(['high', 'high', 'low', 'low']);
  });

  it('גלריה: כל החלונות ב-16:9 נכנסים לחלונית, בשני הגדלים', () => {
    for (const box of [STAGE_WINDOW_SMALL, STAGE_WINDOW_LARGE]) {
      const inner = { width: box.width - 16, height: box.height - 16 };
      for (let n = 1; n <= 9; n++) {
        const { cols, rows, tile } = galleryLayout(n, inner, 6);
        expect(cols * rows).toBeGreaterThanOrEqual(n);
        expect(cols * tile.width + (cols - 1) * 6).toBeLessThanOrEqual(inner.width);
        expect(rows * tile.height + (rows - 1) * 6).toBeLessThanOrEqual(inner.height);
        expect(Math.abs(tile.width / tile.height - 16 / 9)).toBeLessThan(0.02);
      }
    }
    expect(galleryLayout(1, { width: 560, height: 308 }, 6).tile).toEqual({
      width: 547,
      height: 307,
    });
  });

  it('מי שהמצלמה שלו כבתה לרגע נשאר בבחירה עד שעובר הזמן', () => {
    const live = new Set(['a', 'c']);
    const first = keepWanted(['a', 'b', 'c'], live, new Map(), 1000, 500);
    expect(first.wanted).toEqual(['a', 'b', 'c']);
    expect([...first.missingSince]).toEqual([['b', 1000]]);
    const later = keepWanted(first.wanted, live, first.missingSince, 1400, 500);
    expect(later.wanted).toEqual(['a', 'b', 'c']);
    const gone = keepWanted(later.wanted, live, later.missingSince, 1500, 500);
    expect(gone.wanted).toEqual(['a', 'c']);
    // חזר בזמן — נשכח שהיה חסר
    const back = keepWanted(later.wanted, new Set(['a', 'b', 'c']), later.missingSince, 1450, 500);
    expect(back.missingSince.size).toBe(0);
  });

  it('תצוגה מקדימה: מי שעל הבמה, אחר כך מי שביקשו לראות (האחרון ראשון), ואז לפי הסדר', () => {
    const cams = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: id }));
    expect(previewIds(cams, ['d'], [], 3)).toEqual(['d', 'a', 'b']);
    expect(previewIds(cams, ['d'], ['b', 'e'], 3)).toEqual(['d', 'e', 'b']);
    // מי שכבר לא דלוק — לא בתצוגה
    expect(previewIds(cams, ['x'], ['y'], 2)).toEqual(['a', 'b']);
  });

  it('הבמה לצופים: בסדר של המנחה, עם השמות; ומהמסך הראשי רק כשהיא פתוחה', () => {
    const cams = [
      { id: 'a', name: 'רותי', at: 1 },
      { id: 'b', name: 'דן', at: 2 },
    ];
    expect(liveStageOf(7, ['b', 'a', 'z'], cams)).toEqual({
      v: 7,
      ids: [
        { id: 'b', name: 'דן' },
        { id: 'a', name: 'רותי' },
        { id: 'z', name: '' },
      ],
    });
    expect(liveStageOfHost(STAGE_HOST_CLOSED)).toBeNull();
    expect(
      liveStageOfHost({ ...STAGE_HOST_CLOSED, phase: 'open', v: 3, ids: ['a'], cams }),
    ).toEqual({ v: 3, ids: [{ id: 'a', name: 'רותי' }] });
  });

  it('המזהה הפרטי של הדף נשמר לחלון; פגום או בלי אחסון — חדש', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const fresh = () => 'f'.repeat(32);
    expect(stageCid(storage, fresh)).toBe('f'.repeat(32));
    expect(store.get(STAGE_CID_STORAGE_KEY)).toBe('f'.repeat(32));
    expect(stageCid(storage, () => 'a'.repeat(32))).toBe('f'.repeat(32));
    store.set(STAGE_CID_STORAGE_KEY, 'not-a-cid');
    expect(stageCid(storage, () => 'b'.repeat(32))).toBe('b'.repeat(32));
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(stageCid(broken, () => 'c'.repeat(32))).toBe('c'.repeat(32));
    expect(stageCid(null, () => 'd'.repeat(32))).toBe('d'.repeat(32));
  });

  it('הבמה ממצב המסך: רק מה שתקין, בלי כפילויות, עד 9', () => {
    expect(stageFromSnapshot(null)).toBeNull();
    expect(stageFromSnapshot({ v: 'x', ids: [] })).toBeNull();
    expect(stageFromSnapshot({ v: 1 })).toBeNull();
    const id = (n: number) => n.toString(16).padStart(16, '0');
    const ids = [
      { id: id(1), name: 'רותי' },
      { id: id(1), name: 'כפול' },
      { id: 'short', name: 'פגום' },
      null,
      { id: id(2), name: 5 },
      ...Array.from({ length: 12 }, (_, i) => ({ id: id(10 + i), name: `מ${i}` })),
    ];
    const stage = stageFromSnapshot({ v: 4, ids });
    expect(stage?.v).toBe(4);
    expect(stage?.ids).toHaveLength(9);
    expect(stage?.ids.slice(0, 2)).toEqual([
      { id: id(1), name: 'רותי' },
      { id: id(2), name: '' },
    ]);
  });

  it('חלון של מצלמה: הישנה נשארת מוצגת עד שבחדשה יש תמונה', () => {
    const EMPTY = { stream: null, ready: false, portrait: false };
    let v: VideoSlots<string> = initialVideoSlots<string>(null);
    const step = (action: VideoSlotsAction<string>) => {
      v = videoSlotsStep(v, action);
      return v;
    };
    // הראשונה נכנסת ישר לרכיב שמוצג
    step({ type: 'stream', stream: 'A' });
    expect(v).toEqual({ front: 0, slots: [{ stream: 'A', ready: false, portrait: false }, EMPTY] });
    step({ type: 'frame', slot: 0, stream: 'A', ready: true, portrait: false });
    expect(v.slots[0].ready).toBe(true);

    // חיבור חדש: נטען מאחור, A ממשיכה להיות מוצגת עד התמונה הראשונה של B
    step({ type: 'stream', stream: 'B' });
    expect(v.front).toBe(0);
    expect(v.slots[1]).toEqual({ stream: 'B', ready: false, portrait: false });
    step({ type: 'frame', slot: 1, stream: 'B', ready: false, portrait: false });
    expect(v.front).toBe(0);
    step({ type: 'frame', slot: 1, stream: 'B', ready: true, portrait: true });
    expect(v).toEqual({ front: 1, slots: [EMPTY, { stream: 'B', ready: true, portrait: true }] });
    // אירוע מאוחר של הרכיב הישן — לא משנה כלום
    expect(step({ type: 'frame', slot: 0, stream: 'A', ready: true, portrait: false })).toBe(v);

    // חזרה לאותה תמונה בזמן שחדשה נטענת — החדשה נזרקת
    step({ type: 'stream', stream: 'C' });
    step({ type: 'stream', stream: 'B' });
    expect(v).toEqual({ front: 1, slots: [EMPTY, { stream: 'B', ready: true, portrait: true }] });

    // בחדשה אין תמונה בזמן: עוברים אליה בכל זאת
    step({ type: 'stream', stream: 'D' });
    step({ type: 'swap' });
    expect(v).toEqual({ front: 0, slots: [{ stream: 'D', ready: false, portrait: false }, EMPTY] });
    // ועוד לפני שהיא מוכנה מגיעה אחרת: אין מה להשאיר מוצג — מחליפים במקום
    step({ type: 'stream', stream: 'E' });
    expect(v).toEqual({ front: 0, slots: [{ stream: 'E', ready: false, portrait: false }, EMPTY] });
    expect(step({ type: 'swap' })).toBe(v);

    // בלי תמונה בכלל — שני הרכיבים מתרוקנים
    step({ type: 'frame', slot: 0, stream: 'E', ready: true, portrait: false });
    step({ type: 'stream', stream: 'F' });
    step({ type: 'stream', stream: null });
    expect(v.slots).toEqual([EMPTY, EMPTY]);
  });

  it('חלונית הבמה: נשמרת ונקראת, נשארת בתוך המסך, ובהגדלה הפינה נשארת במקום', () => {
    expect(parseStageWindowPrefs(null)).toEqual(DEFAULT_STAGE_WINDOW_PREFS);
    expect(parseStageWindowPrefs('{nope')).toEqual(DEFAULT_STAGE_WINDOW_PREFS);
    expect(parseStageWindowPrefs('null')).toEqual(DEFAULT_STAGE_WINDOW_PREFS);
    const prefs = { pos: { x: 100, y: 200 }, minimized: true, large: true };
    expect(parseStageWindowPrefs(serializeStageWindowPrefs(prefs))).toEqual(prefs);
    // מחוץ למסך — חוזרת פנימה
    const far = parseStageWindowPrefs(JSON.stringify({ x: 99_999, y: -50, large: true }));
    expect(far.pos.x + STAGE_WINDOW_LARGE.width).toBeLessThanOrEqual(STAGE_WIDTH);
    expect(far.pos.y).toBeGreaterThanOrEqual(0);
    // ברירת המחדל בפינה השמאלית התחתונה: בהגדלה גדלה למעלה וימינה
    const shown = DEFAULT_STAGE_WINDOW_PREFS.pos;
    const big = resizedStageWindow(DEFAULT_STAGE_WINDOW_PREFS, shown);
    expect(big.large).toBe(true);
    expect(big.pos.x).toBe(shown.x);
    expect(big.pos.y + STAGE_WINDOW_LARGE.height).toBe(shown.y + STAGE_WINDOW_SMALL.height);
    expect(big.pos.y + STAGE_WINDOW_LARGE.height).toBeLessThanOrEqual(STAGE_HEIGHT);
    expect(resizedStageWindow(big, big.pos)).toEqual(DEFAULT_STAGE_WINDOW_PREFS);
  });
});

// ------------------------------------------------------- מול השרת האמיתי

interface Server {
  ready: Promise<{ port: number }>;
  close: () => Promise<void>;
}

let server: Server | null = null;
let clock = 1_000_000;
const cleanups: Array<() => void> = [];

afterEach(async () => {
  cleanups.splice(0).forEach((fn) => fn());
  await server?.close();
  server = null;
});

const cid = (n: number) => n.toString(16).padStart(32, '0');
const pid = (n: number): string => pidFor(TOKEN, cid(n));

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

function stageGame(setting: Record<string, unknown> = {}) {
  return entitledGame({
    setting: {
      hostVideo: true,
      hostVideoStage: true,
      limit: { type: 'phones', number: 20 },
      ...setting,
    },
  });
}

async function start(options: { game?: unknown; limits?: Record<string, unknown> } = {}) {
  const world = fakeWorld();
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
  }) as { tick: () => void; stats: () => { stageViewers: number } };
  server = startRelay({ port: 0, video }) as Server;
  const { port } = await server.ready;
  const relayBase = `http://127.0.0.1:${port}/live`;
  const publish = async (): Promise<string> => {
    const res = await fetch(`${relayBase}/${TOKEN}/video/pub`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-live-key': KEY },
      body: JSON.stringify({ gameId: GAME, room: ROOM, ...PUB }),
    });
    const body = (await res.json()) as { gen: string };
    return body.gen;
  };
  return { relayBase, publish, video };
}

/** כמו sendBeacon: גוף בלי content-type, בלי לחכות לתשובה. */
const beacon = (url: string, body: string) => {
  void fetch(url, { method: 'POST', body }).catch(() => {});
  return true;
};

/** חיבור WebRTC מדומה: מתחבר מיד אחרי שהצד השני ענה. */
class FakePC extends EventTarget {
  connectionState: RTCPeerConnectionState = 'new';
  iceGatheringState: RTCIceGatheringState = 'complete';
  localDescription: RTCSessionDescriptionInit | null = null;
  private readonly txs: Array<{ mid: string | null; receiver: { track: unknown } }> = [];

  addTransceiver() {
    const tx = { mid: null as string | null, receiver: { track: {} } };
    this.txs.push(tx);
    return tx;
  }

  async createOffer() {
    return { type: 'offer' as const, sdp: 'v=0 cam\r\na=simulcast:send a;b\r\n' };
  }

  async createAnswer() {
    return { type: 'answer' as const, sdp: 'v=0 answer' };
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit) {
    this.localDescription = desc;
    this.txs.forEach((tx, i) => {
      tx.mid ??= String(i);
    });
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit) {
    // הצעה מ-Cloudflare: רצועה לכל מצלמה, לפי ה-mid שהשרת מסר
    if (desc.type === 'offer') {
      for (let i = 0; i < 16; i++) this.txs.push({ mid: String(i), receiver: { track: { i } } });
    }
    setTimeout(() => this.set('connected'), 0);
  }

  getTransceivers() {
    return this.txs;
  }

  set(state: RTCPeerConnectionState) {
    if (this.connectionState === 'closed') return;
    this.connectionState = state;
    this.dispatchEvent(new Event('connectionstatechange'));
  }

  close() {
    this.connectionState = 'closed';
  }
}

const newPC = () => new FakePC() as unknown as RTCPeerConnection;

function fakeCamera(): MediaStream {
  const track = { kind: 'video', onended: null, stop: () => {} };
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
    getAudioTracks: () => [],
  } as unknown as MediaStream;
}

async function until<T>(get: () => T, ok: (value: T) => boolean, ms = 4000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = get();
    if (ok(value)) return value;
    if (Date.now() > end) throw new Error(`timeout: ${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

function hostOf(relayBase: string, options: { graceMs?: number; fetch?: typeof fetch } = {}) {
  const box = { state: STAGE_HOST_CLOSED as StageHostState, history: [] as StageHostState[] };
  const ctl = new StageHostController({
    relayBase,
    viewToken: TOKEN,
    publishKey: KEY,
    gameId: GAME,
    room: ROOM,
    pollMs: 30,
    ...(options.graceMs !== undefined ? { graceMs: options.graceMs } : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    onState: (s) => {
      box.state = s;
      box.history.push(s);
    },
  });
  cleanups.push(() => ctl.dispose());
  return { ctl, box };
}

/** `offline` — הטלפון איבד את הרשת: שום בקשה, גם לא ההודעה שהמצלמה כבתה. */
function camOf(relayBase: string, n: number) {
  const box = { state: STAGE_CAM_OFF as StageCamState, phases: [] as string[], offline: false };
  const cam = new StageCamPublisher({
    relayBase,
    viewToken: TOKEN,
    cid: cid(n),
    media: { getUserMedia: async () => fakeCamera(), createPeerConnection: newPC },
    fetch: (input, init) =>
      box.offline ? Promise.reject(new Error('offline')) : fetch(input, init),
    sendBeacon: (url, body) => (box.offline ? true : beacon(url, body)),
    beatMs: 40,
    onState: (s) => {
      box.state = s;
      if (box.phases.at(-1) !== s.phase) box.phases.push(s.phase);
    },
  });
  cleanups.push(() => cam.dispose());
  return { cam, box };
}

function viewerOf(relayBase: string, publishKey: string | null = null) {
  const box = { state: STAGE_VIEW_IDLE as StageViewState };
  const receiver = new StageReceiver({
    relayBase,
    viewToken: TOKEN,
    publishKey,
    createPeerConnection: newPC,
    createStream: (tracks) => ({ tracks }) as unknown as MediaStream,
    sendBeacon: beacon,
    debounceMs: 0,
    pingMs: 40,
    fullRetryMs: 60_000,
    overlapMs: 300,
    onState: (s) => {
      box.state = s;
    },
  });
  cleanups.push(() => receiver.stop());
  return { receiver, box };
}

describe('במה — המסך הראשי, המשתתף והצופה', () => {
  it('המנחה פותח, משתתף מדליק, עולה לבמה, צופה רואה אותו, והמנחה מכבה', async () => {
    const { relayBase, publish, video } = await start();
    const gen = await publish();
    const host = hostOf(relayBase);
    host.ctl.setGen(gen);
    host.ctl.open();
    expect(host.box.state.phase).toBe('opening');
    await until(
      () => host.box.state.phase,
      (p) => p === 'open',
    );

    const ruti = camOf(relayBase, 1);
    await ruti.cam.start('רותי');
    expect(ruti.box.state).toMatchObject({ phase: 'live', id: pid(1), onStage: false });
    await until(
      () => host.box.state.cams.length,
      (n) => n === 1,
    );
    expect(host.box.state.cams[0]).toMatchObject({ id: pid(1), name: 'רותי' });

    // עולה לבמה: המנחה רואה, מצב המסך מכריז, והמשתתף לומד מהדופק
    host.ctl.put(pid(1));
    expect(host.box.state.wanted).toEqual([pid(1)]);
    await until(
      () => host.box.state.ids,
      (ids) => ids.length === 1,
    );
    expect(host.ctl.live).toEqual({ v: host.box.state.v, ids: [{ id: pid(1), name: 'רותי' }] });
    await until(
      () => ruti.box.state.onStage,
      (on) => on,
    );

    // צופה מתחבר למי שעל הבמה
    const viewer = viewerOf(relayBase);
    viewer.receiver.want([pid(1)], String(host.box.state.v), 'high');
    await until(
      () => viewer.box.state.phase,
      (p) => p === 'playing',
    );
    expect([...viewer.box.state.streams.keys()]).toEqual([pid(1)]);

    // עוד משתתף עולה: הצופה עובר לחיבור החדש בלי להפסיק לנגן
    const dan = camOf(relayBase, 2);
    await dan.cam.start('דן');
    await until(
      () => host.box.state.cams.length,
      (n) => n === 2,
    );
    host.ctl.put(pid(2));
    await until(
      () => host.box.state.ids.length,
      (n) => n === 2,
    );
    const phases: string[] = [];
    const seen = setInterval(() => phases.push(viewer.box.state.phase), 5);
    viewer.receiver.want([pid(1), pid(2)], String(host.box.state.v), 'low');
    await until(
      () => viewer.box.state.streams.size,
      (n) => n === 2,
    );
    clearInterval(seen);
    expect(phases.every((p) => p === 'playing')).toBe(true);
    // החיבור הקודם ממשיך עוד רגע (עד שבחלונות יש תמונה מהחדש), ואז נסגר
    expect(video.stats().stageViewers).toBe(2);
    await until(
      () => video.stats().stageViewers,
      (n) => n === 1,
    );

    // המנחה מכבה את רותי: היא יורדת, רואה למה, ולא מדליקה שוב
    host.ctl.block(pid(1));
    expect(host.box.state.cams.map((c) => c.id)).toEqual([pid(2)]);
    await until(
      () => ruti.box.state.phase,
      (p) => p === 'ended',
    );
    expect(ruti.box.state.ended).toBe('blocked');
    await until(
      () => host.box.state.ids,
      (ids) => ids.length === 1 && ids[0] === pid(2),
    );
    await ruti.cam.start('רותי');
    expect(ruti.box.state).toMatchObject({ phase: 'ended', ended: 'blocked' });
    expect(dan.box.state.phase).toBe('live');

    // הצופה כבר לא רוצה במה — מתנתק
    viewer.receiver.want([], '0', 'low');
    expect(viewer.box.state.phase).toBe('idle');

    // המנחה סוגר את הבמה: המצלמה של דן נכבית, ורואה למה
    host.ctl.close();
    expect(host.box.state.phase).toBe('closed');
    await until(
      () => dan.box.state.phase,
      (p) => p === 'ended',
    );
    expect(dan.box.state.ended).toBe('closed');
  });

  it('בלי שידור אי אפשר לפתוח; רישיון בלי במה — נסגרת עם הסבר, ולא שואלים שוב', async () => {
    const { relayBase, publish } = await start({ game: stageGame({ hostVideoStage: false }) });
    let calls = 0;
    const counted: typeof fetch = (input, init) => {
      calls += 1;
      return fetch(input, init);
    };
    const host = hostOf(relayBase, { fetch: counted });
    host.ctl.open();
    expect(host.box.state).toMatchObject({ phase: 'closed', error: 'no-video' });
    expect(calls).toBe(0);

    host.ctl.setGen(await publish());
    host.ctl.open();
    await until(
      () => host.box.state.error,
      (e) => e === 'not-entitled',
    );
    expect(host.box.state.phase).toBe('closed');
    const after = calls;
    await new Promise((r) => setTimeout(r, 150));
    expect(calls).toBe(after);
  });

  it('תקלה בדרך לא סוגרת את הבמה, וכיבוי הווידאו סוגר אותה', async () => {
    const { relayBase, publish } = await start();
    let broken = false;
    const flaky: typeof fetch = (input, init) =>
      broken ? Promise.reject(new Error('offline')) : fetch(input, init);
    const host = hostOf(relayBase, { fetch: flaky });
    host.ctl.setGen(await publish());
    host.ctl.open();
    await until(
      () => host.box.state.phase,
      (p) => p === 'open',
    );
    const ruti = camOf(relayBase, 1);
    await ruti.cam.start('רותי');
    await until(
      () => host.box.state.cams.length,
      (n) => n === 1,
    );
    host.ctl.put(pid(1));
    await until(
      () => host.box.state.ids.length,
      (n) => n === 1,
    );

    broken = true;
    await new Promise((r) => setTimeout(r, 200));
    expect(host.box.state).toMatchObject({ phase: 'open', error: null, wanted: [pid(1)] });
    expect(host.ctl.live?.ids).toEqual([{ id: pid(1), name: 'רותי' }]);
    broken = false;
    await new Promise((r) => setTimeout(r, 1500)); // הסקר הבא, אחרי ההמתנה שגדלה
    expect(host.box.state).toMatchObject({ phase: 'open', ids: [pid(1)] });

    // הווידאו נכבה (או עבר למסך אחר): הבמה נסגרת כאן, ובשרת עם השידור
    host.ctl.setGen(null);
    expect(host.box.state).toMatchObject({ phase: 'closed', error: null, wanted: [] });
    expect(host.ctl.live).toBeNull();
  });

  it('משתתף שהמצלמה שלו כבתה לרגע נשאר על הבמה; מי שלא חזר — יורד אחרי הזמן', async () => {
    const { relayBase, publish, video } = await start();
    const host = hostOf(relayBase, { graceMs: 800 });
    host.ctl.setGen(await publish());
    host.ctl.open();
    await until(
      () => host.box.state.phase,
      (p) => p === 'open',
    );
    const ruti = camOf(relayBase, 1);
    await ruti.cam.start('רותי');
    const dan = camOf(relayBase, 2);
    await dan.cam.start('דן');
    await until(
      () => host.box.state.cams.length,
      (n) => n === 2,
    );
    host.ctl.put(pid(1));
    host.ctl.put(pid(2));
    await until(
      () => host.box.state.ids.length,
      (n) => n === 2,
    );

    // שני הטלפונים איבדו את הרשת, והשרת שוכח את שתי המצלמות (שתקו יותר מדי;
    // השידור של המנחה והבמה עצמה עוד בזמן). רותי חוזרת לרשת ומתחברת מחדש לבד,
    // עם אותו מזהה, לאותו מקום; דן לא חוזר — ויורד אחרי הזמן.
    ruti.box.offline = true;
    dan.box.offline = true;
    const from = host.box.history.length;
    clock += 36_000;
    video.tick();
    await new Promise((r) => setTimeout(r, 150));
    ruti.box.offline = false;
    await until(
      () => ruti.box.phases,
      (p) => p.includes('reconnecting') && p.at(-1) === 'live',
    );
    expect(ruti.box.state.id).toBe(pid(1));
    await until(
      () => host.box.state.ids,
      (ids) => ids.length === 1 && ids[0] === pid(1),
    );
    await until(
      () => host.box.state.wanted,
      (w) => w.length === 1,
    );
    expect(host.box.state.wanted).toEqual([pid(1)]);
    const after = host.box.history.slice(from);
    // השרת באמת שכח את רותי לרגע, והמנחה לא איבד אותה אף פעם
    expect(after.some((s) => !s.cams.some((c) => c.id === pid(1)))).toBe(true);
    expect(after.every((s) => s.phase === 'open' && s.wanted[0] === pid(1))).toBe(true);
  });

  it('צופים: מעל התקרה — «מלאה»; המסך הראשי רואה גם מי שלא על הבמה', async () => {
    const { relayBase, publish } = await start({
      game: stageGame({ limit: { type: 'phones', number: 1 } }),
      limits: { capMarginMin: 0, capMarginRatio: 0 },
    });
    const host = hostOf(relayBase);
    host.ctl.setGen(await publish());
    host.ctl.open();
    await until(
      () => host.box.state.phase,
      (p) => p === 'open',
    );
    const ruti = camOf(relayBase, 1);
    await ruti.cam.start('רותי');
    const dan = camOf(relayBase, 2);
    await dan.cam.start('דן');
    await until(
      () => host.box.state.cams.length,
      (n) => n === 2,
    );
    host.ctl.put(pid(1));
    await until(
      () => host.box.state.ids.length,
      (n) => n === 1,
    );

    // צופה לא מתחבר למי שאינו על הבמה; המסך הראשי (תצוגה מקדימה) כן
    const peeker = viewerOf(relayBase);
    peeker.receiver.want([pid(2)], 'x', 'low');
    await new Promise((r) => setTimeout(r, 150));
    expect(peeker.box.state.phase).toBe('connecting');
    peeker.receiver.stop();
    const preview = viewerOf(relayBase, KEY);
    preview.receiver.want([pid(1), pid(2)], 'p', 'low');
    await until(
      () => preview.box.state.streams.size,
      (n) => n === 2,
    );

    // תקרה של צופה אחד: הראשון רואה, השני מחכה
    const a = viewerOf(relayBase);
    const b = viewerOf(relayBase);
    a.receiver.want([pid(1)], '1', 'high');
    await until(
      () => a.box.state.phase,
      (p) => p === 'playing',
    );
    b.receiver.want([pid(1)], '1', 'high');
    await until(
      () => b.box.state.phase,
      (p) => p === 'full',
    );
    // הבמה משתנה: מי שבפנים מתחבר מחדש גם כשהתקרה מלאה
    a.receiver.want([pid(1)], '2', 'low');
    await until(
      () => a.box.state.phase,
      (p) => p === 'playing',
    );
    // מי שעוזב מפנה מקום
    a.receiver.stop();
    await new Promise((r) => setTimeout(r, 100));
    b.receiver.want([pid(1)], '3', 'high');
    await until(
      () => b.box.state.phase,
      (p) => p === 'playing',
    );
  });
});
