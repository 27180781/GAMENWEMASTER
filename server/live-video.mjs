/**
 * וידאו וקול של המנחה במסך הצפייה (‎?view=‎), דרך Cloudflare Realtime SFU.
 * רץ בתוך הממסר (server/live-relay.mjs), תחת ‎/live/<W>/video/…‎.
 *
 * המנחה משדר את המצלמה והמיקרופון ל-Cloudflare, וכל צופה מקבל משם עותק.
 * הדפדפנים מדברים עם Cloudflare ישירות (WebRTC), אבל כל פעולה מול ה-API
 * שלהם עוברת כאן, כי רק כאן יש את הסוד של האפליקציה. הכללים:
 *
 * - **רק משחק ששילם.** שידור נפתח רק כשקובץ המשחק (get-game-json) מסמן
 *   `setting.hostVideo` במשחק טלפונים, וקוד החדר שבו הוא החדר שהמנחה טוען.
 *   המנחה מוכיח שהוא המסך הראשי כמו בשידור המסך: מפתח P שנגזר ממזהה המשחק
 *   ומקוד החדר (src/live/token.ts).
 * - **תקרת צופים.** כמספר המשתתפים ברישיון ועוד מרווח קטן (רענונים, טלפון
 *   שני), ותקרה כוללת לכל השרת — כדי שקישור שדלף לא יגדיל את החשבון.
 * - Cloudflare גובה רק על מה שיוצא לצופים. צופה שעזב (sendBeacon) או שהפסיק
 *   לדפוק — החיבור שלו נסגר; שידור שהמנחה שלו השתתק — נסגר.
 *
 * הכול בזיכרון, כמו הממסר. אחרי הפעלה מחדש המנחה מקבל "gone" בדופק הבא
 * ופותח שידור חדש, והצופים מתחברים אליו מחדש.
 *
 *   POST /live/<W>/video/config  מנחה (x-live-key): האם אפשר, ושרתי ICE
 *   POST /live/<W>/video/pub     מנחה: הצעת SDP ← תשובה, ומזהה שידור (gen)
 *   POST /live/<W>/video/beat    מנחה: דופק; מחזיר כמה צופים
 *   POST /live/<W>/video/stop    מנחה: סיום השידור
 *   POST /live/<W>/video/sub     צופה: הצעת SDP מ-Cloudflare ומזהה צפייה
 *   POST /live/<W>/video/answer  צופה: התשובה שלו
 *   POST /live/<W>/video/ping    צופה: דופק
 *   POST /live/<W>/video/leave   צופה: עזב (גם sendBeacon, בלי content-type)
 *
 * הגדרות (משתני סביבה של אפליקציית המנוע ב-CapRover):
 *   CF_REALTIME_APP_ID, CF_REALTIME_APP_SECRET — חובה (Realtime › Serverless SFU)
 *   CF_TURN_KEY_ID, CF_TURN_KEY_API_TOKEN      — רשות: TURN לרשתות חסומות
 *   LIVE_VIDEO_MAX_VIEWERS                     — צופי וידאו בכל השרת (1500)
 *   LIVE_VIDEO_DEFAULT_CAP                     — לרישיון בלי מספר משתתפים (300)
 *
 * בלי תלויות — רק Node.
 */

import { createHash, randomBytes } from 'node:crypto';

const PUB_PREFIX = 'trivia-live-pub:v1:';
const VIEW_PREFIX = 'trivia-live-view:v1:';
const KEY_RE = /^[0-9a-f]{64}$/;
const GAME_ID_RE = /^[0-9A-Za-z-]{8,64}$/;
const HANDLE_RE = /^[0-9a-f]{32}$/;
const MID_RE = /^[0-9A-Za-z_-]{1,32}$/;
const RID_RE = /^[a-z]{1,4}$/;

export const CF_API_BASE = 'https://rtc.live.cloudflare.com/v1';
export const GAME_JSON_URL =
  'https://oousxptmdrrkybadikec.supabase.co/functions/v1/get-game-json?gameId=';
export const STUN_SERVERS = [{ urls: ['stun:stun.cloudflare.com:3478'] }];

export const DEFAULT_VIDEO_LIMITS = {
  /** כמה זמן תשובה חיובית של קובץ המשחק נשמרת. */
  entitlementTtlMs: 60_000,
  /** תשובה שלילית / תקלה — נבדקת שוב מהר יותר (למשל מיד אחרי שהמנהל הדליק). */
  entitlementFailTtlMs: 10_000,
  /** המנחה דופק כל ~10 שניות; שידור ששתק יותר מזה נסגר. */
  publisherTimeoutMs: 40_000,
  /** הצופה דופק כל ~20 שניות; צפייה ששתקה יותר מזה נסגרת. */
  viewerTimeoutMs: 75_000,
  /** צפייה שלא השלימה את ה-SDP תוך זה — נסגרת ומפנה מקום. */
  pendingTimeoutMs: 30_000,
  /** כמה זמן שידור שהוחלף ע"י מסך אחר נזכר (כדי לענות "superseded" ולא "gone"). */
  retiredMemoryMs: 10 * 60_000,
  /** הצטרפויות בשנייה לכל משחק, עם פרץ של פי 4. */
  subscribePerSecond: 5,
  /** מרווח מעל מספר המשתתפים ברישיון: לפחות 5, או 10%. */
  capMarginMin: 5,
  capMarginRatio: 0.1,
  maxPublications: 500,
  cfTimeoutMs: 10_000,
  turnTimeoutMs: 3_000,
  /** תוקף הרשאת TURN לצופה/מנחה. משחק ארוך מזה ממשיך — החיבור כבר קיים. */
  turnTtlSeconds: 6 * 60 * 60,
  maxSdpBytes: 64 * 1024,
  bodyBytes: 128 * 1024,
};

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** "0123" ו-123 הם אותו חדר — אותה נוסחה כמו normalizeRoom ב-src/live/token.ts. */
export function normalizeRoom(room) {
  const text = String(room ?? '').trim();
  return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, '') : text;
}

/** מפתח השידור P — אותה נוסחה כמו livePublishKey ב-src/live/token.ts. */
export function publishKeyFor(gameId, room) {
  return sha256(`${PUB_PREFIX}${String(gameId).trim()}:${normalizeRoom(room)}`);
}

function viewTokenOf(publishKey) {
  return sha256(VIEW_PREFIX + publishKey).slice(0, 20);
}

/** תקרת צופי הווידאו של משחק: המשתתפים ברישיון ועוד מרווח, ולא מעל התקרה הכוללת. */
export function viewerCapFor(limitNumber, cfg) {
  const n = Number(limitNumber);
  const base =
    Number.isFinite(n) && n > 0 && n < Number.MAX_SAFE_INTEGER
      ? Math.ceil(n) + Math.max(cfg.capMarginMin, Math.ceil(n * cfg.capMarginRatio))
      : cfg.defaultCap;
  return Math.max(1, Math.min(base, cfg.maxViewers));
}

function envNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function newId() {
  return randomBytes(16).toString('hex');
}

/**
 * @param {{
 *   fetch?: typeof fetch,
 *   now?: () => number,
 *   env?: Record<string, string | undefined>,
 *   limits?: Partial<typeof DEFAULT_VIDEO_LIMITS>,
 *   log?: (line: string) => void,
 * }} [options]
 */
export function createVideo({
  fetch: fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
  env = process.env,
  limits = {},
  log = (line) => console.log(`[live-video] ${line}`),
} = {}) {
  const cfg = {
    ...DEFAULT_VIDEO_LIMITS,
    maxViewers: envNumber(env.LIVE_VIDEO_MAX_VIEWERS, 1500),
    defaultCap: envNumber(env.LIVE_VIDEO_DEFAULT_CAP, 300),
    ...limits,
  };
  const appId = (env.CF_REALTIME_APP_ID ?? '').trim();
  const appSecret = (env.CF_REALTIME_APP_SECRET ?? '').trim();
  const turnKeyId = (env.CF_TURN_KEY_ID ?? '').trim();
  const turnToken = (env.CF_TURN_KEY_API_TOKEN ?? '').trim();
  const apiBase = (env.CF_REALTIME_API_BASE ?? CF_API_BASE).replace(/\/+$/, '');
  const gameJsonUrl = env.LIVE_VIDEO_GAME_JSON_URL ?? GAME_JSON_URL;
  const configured = appId !== '' && appSecret !== '';

  /** W → השידור הפעיל של המשחק. */
  const pubs = new Map();
  /** gen של שידור שמסך אחר החליף → מתי. */
  const retired = new Map();
  /** handle → צפייה. */
  const viewers = new Map();
  /** gameId → { at, ttl, value } */
  const entitlements = new Map();
  /** W → דלי אסימונים להצטרפויות. */
  const buckets = new Map();
  /** סגירות שממתינות (בלי לחכות להן בבקשה עצמה). */
  const cleanups = new Set();

  // ---------------------------------------------------------------- Cloudflare

  async function cf(method, path, body) {
    const res = await fetchImpl(`${apiBase}/apps/${appId}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${appSecret}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(cfg.cfTimeoutMs),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  }

  /** שגיאה מהתשובה של Cloudflare (ברמת הבקשה או של רצועה), או null. */
  function cfError(reply, expectTracks) {
    if (reply.status < 200 || reply.status >= 300) {
      return `${reply.status} ${reply.json?.errorCode ?? ''}`.trim();
    }
    if (reply.json === null || typeof reply.json !== 'object') return 'bad-reply';
    if (reply.json.errorCode) return String(reply.json.errorCode);
    if (expectTracks) {
      const tracks = Array.isArray(reply.json.tracks) ? reply.json.tracks : [];
      if (tracks.length === 0) return 'no-tracks';
      const failed = tracks.find((t) => t?.errorCode);
      if (failed !== undefined) return String(failed.errorCode);
    }
    return null;
  }

  async function newSession() {
    const reply = await cf('POST', '/sessions/new');
    const error = cfError(reply, false);
    if (error !== null || typeof reply.json?.sessionId !== 'string') {
      throw Object.assign(new Error(`sessions/new: ${error ?? 'no session'}`), { sfu: true });
    }
    return reply.json.sessionId;
  }

  /** סגירה בכוח, בלי SDP: Cloudflare מפסיק להעביר (ולגבות). לא נכשלת בקול. */
  function closeTracks(sessionId, mids) {
    if (!configured || mids.length === 0) return;
    const job = cf('PUT', `/sessions/${sessionId}/tracks/close`, {
      tracks: mids.map((mid) => ({ mid })),
      force: true,
    })
      .catch(() => {})
      .finally(() => cleanups.delete(job));
    cleanups.add(job);
  }

  async function iceServers() {
    if (turnKeyId === '' || turnToken === '') return STUN_SERVERS;
    try {
      const res = await fetchImpl(
        `${apiBase}/turn/keys/${turnKeyId}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${turnToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({ ttl: cfg.turnTtlSeconds }),
          signal: AbortSignal.timeout(cfg.turnTimeoutMs),
        },
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(json?.iceServers)) return STUN_SERVERS;
      // פורט 53 חסום בדפדפנים — בלי ה-trickle שלנו הוא רק מעכב (התיעוד שלהם).
      return json.iceServers.map((server) => ({
        ...server,
        urls: (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(
          (url) => typeof url === 'string' && !/:53(\?|$)/.test(url),
        ),
      }));
    } catch {
      return STUN_SERVERS;
    }
  }

  // ------------------------------------------------------------- זכאות

  /**
   * האם למשחק יש וידאו מנחה ברישיון, ומה החדר והתקרה שלו — מקובץ המשחק עצמו,
   * כמו שהמנוע מקבל אותו.
   */
  async function entitlement(gameId) {
    const at = now();
    const cached = entitlements.get(gameId);
    if (cached !== undefined && at - cached.at < cached.ttl) return cached.value;
    let value;
    try {
      const res = await fetchImpl(`${gameJsonUrl}${encodeURIComponent(gameId)}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(cfg.cfTimeoutMs),
      });
      const json = res.ok ? await res.json().catch(() => null) : null;
      if (json === null || typeof json !== 'object') {
        value = { ok: false, error: res.status === 404 ? 'not-entitled' : 'game-unavailable' };
      } else {
        const setting = json.setting ?? {};
        const phones = setting.limit?.type === 'phones';
        value =
          setting.hostVideo === true && phones
            ? {
                ok: true,
                room: normalizeRoom(json.room),
                cap: viewerCapFor(setting.limit?.number, cfg),
              }
            : { ok: false, error: 'not-entitled' };
      }
    } catch {
      value = { ok: false, error: 'game-unavailable' };
    }
    entitlements.set(gameId, {
      at,
      ttl: value.ok ? cfg.entitlementTtlMs : cfg.entitlementFailTtlMs,
      value,
    });
    return value;
  }

  // ------------------------------------------------------------- מצב

  function pubAlive(pub) {
    return now() - pub.beatAt < cfg.publisherTimeoutMs;
  }

  function viewerAlive(v) {
    const limit = v.answered ? cfg.viewerTimeoutMs : cfg.pendingTimeoutMs;
    return now() - v.seenAt < limit;
  }

  function viewersOf(token, gen) {
    let count = 0;
    for (const v of viewers.values()) {
      if (v.token === token && v.gen === gen && viewerAlive(v)) count += 1;
    }
    return count;
  }

  function totalViewers() {
    let count = 0;
    for (const v of viewers.values()) if (viewerAlive(v)) count += 1;
    return count;
  }

  function dropViewer(v) {
    viewers.delete(v.handle);
    closeTracks(v.session, v.mids);
  }

  function retirePublication(token, pub, reason) {
    if (pubs.get(token) === pub) pubs.delete(token);
    if (reason === 'superseded') retired.set(pub.gen, now());
    closeTracks(pub.session, pub.mids);
    // הצופים של השידור הזה מקבלים "gone" בדופק ומתחברים לשידור החדש.
    for (const v of viewers.values()) if (v.token === token && v.gen === pub.gen) dropViewer(v);
    log(`stop ${token.slice(0, 6)} gen=${pub.gen.slice(0, 6)} (${reason})`);
  }

  function takeSubscribeToken(token) {
    const at = now();
    const rate = cfg.subscribePerSecond;
    const bucket = buckets.get(token) ?? { tokens: rate * 4, at };
    bucket.tokens = Math.min(rate * 4, bucket.tokens + ((at - bucket.at) / 1000) * rate);
    bucket.at = at;
    buckets.set(token, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  // ------------------------------------------------------------- בקשות

  /** המפתח בכותרת חייב להיות זה ש-W נגזר ממנו. */
  function hostKey(req, token) {
    const key = String(req.headers['x-live-key'] ?? '');
    return KEY_RE.test(key) && viewTokenOf(key) === token ? key : null;
  }

  /** בדיקות המנחה: מפתח, מזהה משחק וחדר שהמפתח נגזר מהם, וזכאות ברישיון. */
  async function checkHost(req, token, body) {
    const key = hostKey(req, token);
    if (key === null) return { status: 403, error: 'bad-key' };
    const gameId = typeof body.gameId === 'string' ? body.gameId.trim() : '';
    const room = normalizeRoom(body.room);
    if (!GAME_ID_RE.test(gameId) || room === '' || publishKeyFor(gameId, room) !== key) {
      return { status: 403, error: 'bad-key' };
    }
    if (!configured) return { status: 503, error: 'not-configured' };
    const ent = await entitlement(gameId);
    if (!ent.ok) return { status: ent.error === 'not-entitled' ? 403 : 502, error: ent.error };
    if (ent.room !== room) return { status: 403, error: 'not-entitled' };
    return { status: 200, ent, gameId };
  }

  async function handleConfig(token, req, body) {
    const check = await checkHost(req, token, body);
    if (check.status !== 200) return [check.status, { error: check.error }];
    return [200, { ok: true, iceServers: await iceServers(), maxViewers: check.ent.cap }];
  }

  async function handlePublish(token, req, body) {
    const check = await checkHost(req, token, body);
    if (check.status !== 200) return [check.status, { error: check.error }];
    const { sid, started, sdp, tracks, force } = body;
    const simulcast = Array.isArray(body.simulcast) ? body.simulcast : [];
    if (
      typeof sid !== 'string' ||
      sid.length === 0 ||
      sid.length > 64 ||
      !Number.isFinite(started) ||
      typeof sdp !== 'string' ||
      sdp.length === 0 ||
      sdp.length > cfg.maxSdpBytes ||
      !Array.isArray(tracks) ||
      tracks.length === 0 ||
      tracks.length > 2 ||
      !tracks.every(
        (t) => MID_RE.test(String(t?.mid ?? '')) && ['video', 'audio'].includes(t?.kind),
      ) ||
      new Set(tracks.map((t) => t.kind)).size !== tracks.length ||
      simulcast.length > 3 ||
      !simulcast.every((rid) => typeof rid === 'string' && RID_RE.test(rid))
    ) {
      return [400, { error: 'bad-message' }];
    }

    const existing = pubs.get(token);
    if (existing !== undefined && existing.sid !== sid && pubAlive(existing)) {
      // שני מסכים ראשיים: לחיצה של המנחה גוברת; ניסיון אוטומטי לא דוחק מסך חדש יותר.
      if (force !== true && existing.started > started) return [409, { error: 'superseded' }];
    }
    if (existing === undefined && pubs.size >= cfg.maxPublications) return [503, { error: 'busy' }];

    let session;
    let reply;
    try {
      session = await newSession();
      reply = await cf('POST', `/sessions/${session}/tracks/new`, {
        sessionDescription: { type: 'offer', sdp },
        tracks: tracks.map((t) => ({ location: 'local', mid: String(t.mid), trackName: t.kind })),
      });
    } catch (err) {
      log(`pub ${token.slice(0, 6)} failed: ${err?.message ?? err}`);
      return [502, { error: 'sfu-error' }];
    }
    const error = cfError(reply, true);
    const answer = reply.json?.sessionDescription;
    if (error !== null || answer?.type !== 'answer' || typeof answer.sdp !== 'string') {
      log(`pub ${token.slice(0, 6)} tracks/new: ${error ?? 'no answer'}`);
      closeTracks(
        session,
        tracks.map((t) => String(t.mid)),
      );
      return [502, { error: 'sfu-error' }];
    }

    // עכשיו (אחרי ה-await) — מה שמחזיק את הערוץ ברגע הזה מוחלף.
    const current = pubs.get(token);
    if (current !== undefined) {
      retirePublication(token, current, current.sid === sid ? 'replaced' : 'superseded');
    }
    const pub = {
      gen: newId(),
      gameId: check.gameId,
      sid,
      started,
      session,
      mids: tracks.map((t) => String(t.mid)),
      kinds: tracks.map((t) => t.kind),
      simulcast,
      cap: check.ent.cap,
      beatAt: now(),
    };
    pubs.set(token, pub);
    log(
      `start ${token.slice(0, 6)} gen=${pub.gen.slice(0, 6)} ${pub.kinds.join('+')} cap=${pub.cap}`,
    );
    return [200, { ok: true, gen: pub.gen, sdp: answer.sdp, maxViewers: pub.cap }];
  }

  function handleBeat(token, req, body) {
    if (hostKey(req, token) === null) return [403, { error: 'bad-key' }];
    const pub = pubs.get(token);
    if (pub === undefined || pub.gen !== body.gen || !pubAlive(pub)) {
      if (pub !== undefined && !pubAlive(pub)) retirePublication(token, pub, 'timeout');
      return retired.has(body.gen) ? [409, { error: 'superseded' }] : [404, { error: 'gone' }];
    }
    pub.beatAt = now();
    return [200, { ok: true, viewers: viewersOf(token, pub.gen), maxViewers: pub.cap }];
  }

  function handleStop(token, req, body) {
    if (hostKey(req, token) === null) return [403, { error: 'bad-key' }];
    const pub = pubs.get(token);
    if (pub !== undefined && pub.gen === body.gen) retirePublication(token, pub, 'stopped');
    return [200, { ok: true }];
  }

  async function handleSubscribe(token, body) {
    if (!configured) return [503, { error: 'not-configured' }];
    const pub = pubs.get(token);
    if (pub === undefined || !pubAlive(pub)) return [404, { error: 'no-video' }];
    const vid = typeof body.vid === 'string' ? body.vid.slice(0, 64) : '';
    // אותו דף שמתחבר שוב (שידור חדש, ניתוק) — הצפייה הקודמת שלו מפנה מקום.
    if (vid !== '') {
      for (const v of viewers.values()) if (v.token === token && v.vid === vid) dropViewer(v);
    }
    if (viewersOf(token, pub.gen) >= pub.cap) return [429, { error: 'full' }];
    if (totalViewers() >= cfg.maxViewers) return [503, { error: 'busy' }];
    if (!takeSubscribeToken(token)) return [429, { error: 'slow-down' }];
    const ice = iceServers(); // במקביל לפתיחת החיבור ב-Cloudflare

    const remote = pub.kinds.map((kind) => ({
      location: 'remote',
      sessionId: pub.session,
      trackName: kind,
      ...(kind === 'video' && pub.simulcast.length > 1
        ? {
            simulcast: {
              preferredRid: [...pub.simulcast].sort()[0],
              priorityOrdering: 'asciibetical',
              ridNotAvailable: 'asciibetical',
            },
          }
        : {}),
    }));
    let session;
    let reply;
    try {
      session = await newSession();
      reply = await cf('POST', `/sessions/${session}/tracks/new`, { tracks: remote });
    } catch (err) {
      log(`sub ${token.slice(0, 6)} failed: ${err?.message ?? err}`);
      return [502, { error: 'sfu-error' }];
    }
    const error = cfError(reply, true);
    const offer = reply.json?.sessionDescription;
    const got = Array.isArray(reply.json?.tracks) ? reply.json.tracks : [];
    const mids = got.map((t) => String(t?.mid ?? '')).filter((mid) => mid !== '');
    if (error !== null || offer?.type !== 'offer' || typeof offer.sdp !== 'string') {
      log(`sub ${token.slice(0, 6)} tracks/new: ${error ?? 'no offer'}`);
      closeTracks(session, mids);
      return [502, { error: 'sfu-error' }];
    }
    // השידור עוד אותו שידור? (המנחה יכול היה להחליף אותו בזמן ה-await.)
    if (pubs.get(token) !== pub) {
      closeTracks(session, mids);
      return [409, { error: 'restart' }];
    }
    const viewer = {
      handle: newId(),
      token,
      vid,
      gen: pub.gen,
      session,
      mids,
      answered: false,
      seenAt: now(),
    };
    viewers.set(viewer.handle, viewer);
    return [
      200,
      {
        ok: true,
        handle: viewer.handle,
        gen: pub.gen,
        sdp: offer.sdp,
        tracks: got.map((t) => ({ mid: String(t.mid), kind: t.trackName })),
        iceServers: await ice,
      },
    ];
  }

  function viewerFor(token, body) {
    const handle = typeof body.handle === 'string' ? body.handle : '';
    if (!HANDLE_RE.test(handle)) return null;
    const v = viewers.get(handle);
    return v !== undefined && v.token === token ? v : null;
  }

  async function handleAnswer(token, body) {
    const v = viewerFor(token, body);
    if (v === null || !viewerAlive(v)) return [404, { error: 'gone' }];
    if (v.answered) return [409, { error: 'answered' }];
    if (
      typeof body.sdp !== 'string' ||
      body.sdp.length === 0 ||
      body.sdp.length > cfg.maxSdpBytes
    ) {
      return [400, { error: 'bad-message' }];
    }
    v.answered = true; // תשובה אחת בלבד, גם אם השנייה מגיעה לפני שהראשונה חזרה
    let reply;
    try {
      reply = await cf('PUT', `/sessions/${v.session}/renegotiate`, {
        sessionDescription: { type: 'answer', sdp: body.sdp },
      });
    } catch (err) {
      log(`answer ${token.slice(0, 6)} failed: ${err?.message ?? err}`);
      dropViewer(v);
      return [502, { error: 'sfu-error' }];
    }
    const error = cfError(reply, false);
    if (error !== null) {
      log(`answer ${token.slice(0, 6)} renegotiate: ${error}`);
      dropViewer(v);
      return [502, { error: 'sfu-error' }];
    }
    v.seenAt = now();
    return [200, { ok: true }];
  }

  function handlePing(token, body) {
    const v = viewerFor(token, body);
    const pub = pubs.get(token);
    if (v === null || !viewerAlive(v) || pub === undefined || pub.gen !== v.gen || !pubAlive(pub)) {
      if (v !== null) dropViewer(v);
      return [404, { error: 'gone' }];
    }
    v.seenAt = now();
    return [200, { ok: true, gen: pub.gen }];
  }

  function handleLeave(token, body) {
    const v = viewerFor(token, body);
    if (v !== null) dropViewer(v);
    return [200, { ok: true }];
  }

  /**
   * בקשה ל-‎/live/<W>/video/<action>‎. מחזיר [סטטוס, גוף]; הממסר כותב את
   * התשובה. `body` הוא ה-JSON שכבר נקרא (או {} כשאין).
   */
  async function handle(req, token, action, body) {
    switch (action) {
      case 'config':
        return handleConfig(token, req, body);
      case 'pub':
        return handlePublish(token, req, body);
      case 'beat':
        return handleBeat(token, req, body);
      case 'stop':
        return handleStop(token, req, body);
      case 'sub':
        return handleSubscribe(token, body);
      case 'answer':
        return handleAnswer(token, body);
      case 'ping':
        return handlePing(token, body);
      case 'leave':
        return handleLeave(token, body);
      default:
        return [404, { error: 'not-found' }];
    }
  }

  /** ניקוי: צפיות ששתקו, שידורים שהמנחה שלהם נעלם, זיכרונות ישנים. */
  function tick() {
    const at = now();
    for (const v of viewers.values()) if (!viewerAlive(v)) dropViewer(v);
    for (const [token, pub] of pubs) if (!pubAlive(pub)) retirePublication(token, pub, 'timeout');
    for (const [gen, when] of retired) if (at - when > cfg.retiredMemoryMs) retired.delete(gen);
    for (const [gameId, entry] of entitlements) {
      if (at - entry.at > Math.max(entry.ttl, cfg.entitlementTtlMs)) entitlements.delete(gameId);
    }
    for (const [token, bucket] of buckets) if (at - bucket.at > 60_000) buckets.delete(token);
  }

  function stats() {
    return { configured, publications: pubs.size, viewers: totalViewers() };
  }

  /** לבדיקות: מחכה שכל הסגירות שנשלחו יחזרו. */
  async function settle() {
    while (cleanups.size > 0) await Promise.all([...cleanups]);
  }

  return { handle, tick, stats, settle, config: cfg, pubs, viewers };
}
