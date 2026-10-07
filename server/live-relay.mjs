/**
 * ממסר השידור של מסך הצפייה (?view=) — רץ בתוך מכולת האתר, מאחורי nginx
 * (‎/live/‎, ראו nginx.conf ו-docker-entrypoint.sh).
 *
 * המסך הראשי של משחק אונליין שולח לכאן את מצב המסך (מלא, ואחר כך רק הפרשים —
 * src/live/publisher.ts), והממסר מעביר אותו לכל מי שפתח את קישור הצפייה של
 * אותו משחק: ב-Server-Sent Events, או בבקשות המתנה ארוכות כשמשהו בדרך עוצר
 * את הזרם (src/live/subscriber.ts). אין כאן מסד נתונים ואין סודות: ערוץ הוא
 * קוד הצפייה W, ושידור מתקבל רק עם מפתח P שממנו W נגזר (src/live/token.ts).
 * הכול בזיכרון; ממסר שהופעל מחדש מקבל מהמסך הראשי מצב מלא בשידור הבא.
 *
 *   POST /live/<W>/pub          שידור (כותרת x-live-key: P)
 *   GET  /live/<W>/events       זרם SSE לצופה
 *   GET  /live/<W>/poll?after=N המתנה ארוכה (עד 25 שניות) לשינוי שאחרי N
 *   POST /live/<W>/video/…      וידאו וקול של המנחה (server/live-video.mjs)
 *   GET  /live/health           בדיקת חיים
 *
 * בלי תלויות — רק Node.
 */

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createVideo } from './live-video.mjs';

export const VIEW_PREFIX = 'trivia-live-view:v1:';
const TOKEN_RE = /^[0-9a-f]{20}$/;
const KEY_RE = /^[0-9a-f]{64}$/;

export const DEFAULT_LIMITS = {
  /** גודל שידור מרבי. מצב מלא של משחק גדול הוא עשרות KB. */
  bodyBytes: 1024 * 1024,
  /** כמה הפרשים נשמרים אחרי המצב המלא לצופה שמצטרף; מעבר לזה מבקשים מצב מלא. */
  backlogPatches: 300,
  backlogBytes: 1024 * 1024,
  /**
   * הזיכרון של כל הערוצים יחד. ערוץ נפתח בלי סוד (כל אחד יכול להמציא מזהה
   * משחק), ולכן בלי תקרה כוללת אפשר היה למלא את זיכרון השרת — שמגיש גם את
   * עדכוני ה-EXE. כשנגמר המקום, ערוצים בלי צופים שהשתתקו ראשונים מפנים מקום.
   */
  totalBytes: 256 * 1024 * 1024,
  /** שידורים בשנייה לכל ערוץ (המסך הראשי שולח עד ~5), עם פרץ של פי 2. */
  publishPerSecond: 20,
  /** כמה זמן בקשת המתנה ארוכה נשארת פתוחה. */
  pollMs: 25_000,
  /** דופק לצופים (וגם שומר את החיבור פתוח מול פרוקסים). */
  keepaliveMs: 15_000,
  /** מסך ראשי ששתק יותר מזה נחשב לא מחובר — ומסך אחר רשאי לתפוס את הערוץ. */
  publisherFreshMs: 15_000,
  /** ערוץ בלי פעילות ובלי צופים נמחק. */
  channelIdleMs: 6 * 60 * 60 * 1000,
  maxChannels: 2000,
  maxViewersPerChannel: 3000,
  /**
   * חיבורי צופים פתוחים בכל הערוצים יחד (זרמים + המתנות ארוכות). כל צופה הוא
   * גם שני חיבורים ב-nginx של המכולה (ראו worker_connections ב-Dockerfile),
   * והתקרה משאירה שם מקום לאתר ולעדכוני ה-EXE גם כשקישור צפייה "מתפוצץ".
   */
  maxConnections: 6000,
  /** צופה שלא קורא (חיבור תקוע) מנותק כשמצטבר אצלו יותר מזה, ומתחבר מחדש. */
  sseBufferBytes: 512 * 1024,
};

/** קוד הצפייה שנגזר ממפתח השידור — אותה נוסחה כמו liveViewToken ב-src/live/token.ts. */
export function viewTokenFor(publishKey) {
  return createHash('sha256')
    .update(VIEW_PREFIX + publishKey)
    .digest('hex')
    .slice(0, 20);
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-live-key',
  'access-control-max-age': '86400',
};

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    ...CORS,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createRelay({ now = () => Date.now(), limits = {}, video = undefined } = {}) {
  const cfg = { ...DEFAULT_LIMITS, ...limits };
  // וידאו המנחה: בלי מפתחות Cloudflare בסביבה הוא עונה "not-configured" ותו לא.
  const media = video ?? createVideo({ now });
  /** @type {Map<string, any>} */
  const channels = new Map();
  let openConnections = 0;

  function getChannel(token, create) {
    let ch = channels.get(token);
    if (ch === undefined && create) {
      if (channels.size >= cfg.maxChannels) return null;
      ch = {
        token,
        owner: null,
        ownerSeq: -1,
        lastPublishAt: 0,
        version: 0,
        key: null, // { v, json }
        patches: [], // [{ v, json, bytes }]
        patchBytes: 0,
        skewSamples: [],
        sse: new Set(),
        waiters: new Set(),
        pollers: new Map(), // vid → lastSeen
        lastActivity: now(),
        tokens: cfg.publishPerSecond * 2,
        tokensAt: now(),
      };
      channels.set(token, ch);
    }
    return ch;
  }

  function channelBytes(ch) {
    return (ch.key === null ? 0 : ch.key.json.length) + ch.patchBytes;
  }

  /**
   * מקום ל-`incoming` בתים נוספים בערוץ `ch`. כשהתקרה הכוללת מתמלאת — מוחקים
   * ערוצים בלי צופים, מהשקט ביותר. false = אין מקום גם אחרי זה.
   */
  function makeRoom(ch, incoming) {
    let total = 0;
    for (const other of channels.values()) total += channelBytes(other);
    if (total + incoming <= cfg.totalBytes) return true;
    const idle = [...channels.values()]
      .filter((other) => other !== ch && other.sse.size === 0 && other.waiters.size === 0)
      .sort((a, b) => a.lastActivity - b.lastActivity);
    for (const other of idle) {
      total -= channelBytes(other);
      channels.delete(other.token);
      if (total + incoming <= cfg.totalBytes) return true;
    }
    return false;
  }

  /** דלי אסימונים: false = הערוץ משדר מהר מדי. */
  function takeToken(ch, at) {
    const rate = cfg.publishPerSecond;
    ch.tokens = Math.min(rate * 2, ch.tokens + ((at - ch.tokensAt) / 1000) * rate);
    ch.tokensAt = at;
    if (ch.tokens < 1) return false;
    ch.tokens -= 1;
    return true;
  }

  function isLive(ch) {
    return ch.owner !== null && now() - ch.lastPublishAt < cfg.publisherFreshMs;
  }

  function skewOf(ch) {
    return ch.skewSamples.length === 0 ? 0 : Math.min(...ch.skewSamples);
  }

  function viewerCount(ch) {
    const cutoff = now() - cfg.pollMs * 2;
    for (const [vid, seen] of ch.pollers) if (seen < cutoff) ch.pollers.delete(vid);
    return ch.sse.size + ch.pollers.size;
  }

  /** הודעת סנכרון: המצב המלא והפרשים שאחריו, או רק ההפרשים שאחרי `after`. */
  function syncMessage(ch, after) {
    const head = `"live":${isLive(ch)},"skew":${skewOf(ch)},"now":${now()},"v":${ch.version}`;
    if (ch.key === null) return `{"type":"sync",${head},"key":null,"patches":[]}`;
    const fromKey = after < ch.key.v || after > ch.version;
    const patches = fromKey ? ch.patches : ch.patches.filter((p) => p.v > after);
    const key = fromKey ? ch.key.json : 'null';
    return `{"type":"sync",${head},"key":${key},"patches":[${patches.map((p) => p.json).join(',')}]}`;
  }

  function beatMessage(ch) {
    return `{"type":"beat","live":${isLive(ch)},"skew":${skewOf(ch)},"now":${now()},"v":${ch.version}}`;
  }

  function writeSse(res, json) {
    if (res.writableLength > cfg.sseBufferBytes) {
      res.destroy();
      return;
    }
    try {
      res.write(`data: ${json}\n\n`);
    } catch {
      /* החיבור נסגר — יוסר באירוע close */
    }
  }

  /** שינוי חדש בערוץ: לכל זרם — ההפרש עצמו; לכל ממתין — מה שהוא עוד לא ראה. */
  function broadcast(ch, json) {
    for (const res of ch.sse) writeSse(res, json);
    for (const waiter of ch.waiters) {
      clearTimeout(waiter.timer);
      ch.waiters.delete(waiter);
      respondPoll(waiter.res, syncMessage(ch, waiter.after));
    }
  }

  function respondPoll(res, json) {
    if (res.writableEnded) return;
    res.writeHead(200, {
      ...CORS,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(json),
    });
    res.end(json);
  }

  async function handlePublish(req, res, token) {
    const key = String(req.headers['x-live-key'] ?? '');
    if (!KEY_RE.test(key) || viewTokenFor(key) !== token)
      return sendJson(res, 403, { error: 'bad-key' });
    let msg;
    try {
      msg = JSON.parse(await readBody(req, cfg.bodyBytes));
    } catch (err) {
      return sendJson(res, err?.status === 413 ? 413 : 400, {
        error: err?.status === 413 ? 'too-large' : 'bad-json',
      });
    }
    const { sid, started, seq, prev, t, kind } = msg ?? {};
    if (
      typeof sid !== 'string' ||
      sid.length === 0 ||
      sid.length > 64 ||
      !Number.isFinite(started) ||
      !Number.isInteger(seq) ||
      !Number.isFinite(t) ||
      !['key', 'patch', 'beat'].includes(kind)
    ) {
      return sendJson(res, 400, { error: 'bad-message' });
    }
    const ch = getChannel(token, true);
    if (ch === null) return sendJson(res, 503, { error: 'busy' });
    const at = now();
    ch.lastActivity = at;
    if (!takeToken(ch, at)) return sendJson(res, 429, { error: 'slow-down' });

    // מי משדר: המסך שנפתח אחרון. מסך ישן ששתק — כל מסך אחר רשאי לתפוס.
    if (ch.owner !== null && ch.owner.sid !== sid) {
      const newer = started > ch.owner.started;
      const stale = at - ch.lastPublishAt >= cfg.publisherFreshMs;
      if (!newer && !stale) return sendJson(res, 409, { error: 'superseded' });
      ch.owner = { sid, started };
      ch.ownerSeq = -1;
      ch.skewSamples = []; // שעון של מחשב אחר
    } else if (ch.owner === null) {
      ch.owner = { sid, started };
      ch.ownerSeq = -1;
      ch.skewSamples = [];
    }

    ch.skewSamples.push(at - t);
    if (ch.skewSamples.length > 10) ch.skewSamples.shift();
    ch.lastPublishAt = at;

    if (kind === 'beat') {
      if (ch.ownerSeq === -1) return sendJson(res, 409, { error: 'need-key' });
      return sendJson(res, 200, { ok: true, viewers: viewerCount(ch) });
    }

    if (kind === 'key') {
      if (msg.data === null || typeof msg.data !== 'object' || Array.isArray(msg.data)) {
        return sendJson(res, 400, { error: 'bad-message' });
      }
      const json = `{"v":${ch.version + 1},"t":${t},"data":${JSON.stringify(msg.data)}}`;
      if (!makeRoom(ch, json.length - channelBytes(ch)))
        return sendJson(res, 503, { error: 'busy' });
      ch.version += 1;
      ch.key = { v: ch.version, json };
      ch.patches = [];
      ch.patchBytes = 0;
      ch.ownerSeq = seq;
      broadcast(
        ch,
        `{"type":"key","live":true,"skew":${skewOf(ch)},"now":${at},"v":${ch.version},"key":${json}}`,
      );
      return sendJson(res, 200, { ok: true, viewers: viewerCount(ch) });
    }

    // patch: חייב להמשיך בדיוק את מה שהממסר מחזיק, אחרת הצופים יתפצלו.
    if (ch.key === null || prev !== ch.ownerSeq || !Array.isArray(msg.ops)) {
      return sendJson(res, 409, { error: 'need-key' });
    }
    if (ch.patches.length >= cfg.backlogPatches * 2 || ch.patchBytes >= cfg.backlogBytes * 2) {
      return sendJson(res, 409, { error: 'need-key' });
    }
    const json = `{"v":${ch.version + 1},"t":${t},"ops":${JSON.stringify(msg.ops)}}`;
    if (!makeRoom(ch, json.length)) return sendJson(res, 503, { error: 'busy' });
    ch.version += 1;
    ch.patches.push({ v: ch.version, json });
    ch.patchBytes += json.length;
    ch.ownerSeq = seq;
    broadcast(
      ch,
      `{"type":"patch","live":true,"skew":${skewOf(ch)},"now":${at},"v":${ch.version},"patch":${json}}`,
    );
    const wantKey = ch.patches.length >= cfg.backlogPatches || ch.patchBytes >= cfg.backlogBytes;
    return sendJson(res, 200, {
      ok: true,
      viewers: viewerCount(ch),
      ...(wantKey ? { wantKey: true } : {}),
    });
  }

  /** חיבור צופה נספר עד שהוא נסגר; false = השרת מלא. */
  function admit(res) {
    if (openConnections >= cfg.maxConnections) return false;
    openConnections += 1;
    res.on('close', () => {
      openConnections -= 1;
    });
    return true;
  }

  function handleEvents(req, res, token) {
    const ch = getChannel(token, true);
    if (ch === null) return sendJson(res, 503, { error: 'busy' });
    if (ch.sse.size >= cfg.maxViewersPerChannel || !admit(res))
      return sendJson(res, 503, { error: 'busy' });
    ch.lastActivity = now();
    res.writeHead(200, {
      ...CORS,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-store, no-transform',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    });
    // ריפוד: חלק מהפרוקסים מחזיקים את תחילת התשובה עד שמצטבר מספיק.
    res.write(`retry: 3000\n:${' '.repeat(2048)}\n\n`);
    writeSse(res, syncMessage(ch, -1));
    ch.sse.add(res);
    res.on('close', () => {
      ch.sse.delete(res);
      ch.lastActivity = now();
    });
  }

  function handlePoll(req, res, token, url) {
    const ch = getChannel(token, true);
    if (ch === null) return sendJson(res, 503, { error: 'busy' });
    const after = Number.parseInt(url.searchParams.get('after') ?? '-1', 10);
    const vid = (url.searchParams.get('vid') ?? '').slice(0, 40);
    if (vid !== '' && !ch.pollers.has(vid) && ch.pollers.size >= cfg.maxViewersPerChannel) {
      return sendJson(res, 503, { error: 'busy' });
    }
    if (!admit(res)) return sendJson(res, 503, { error: 'busy' });
    if (vid !== '') ch.pollers.set(vid, now());
    ch.lastActivity = now();
    const since = Number.isFinite(after) ? after : -1;
    if (ch.version > since || since > ch.version) {
      return respondPoll(res, syncMessage(ch, since));
    }
    const waiter = { res, after: since, timer: null };
    waiter.timer = setTimeout(() => {
      ch.waiters.delete(waiter);
      respondPoll(res, beatMessage(ch));
    }, cfg.pollMs);
    ch.waiters.add(waiter);
    res.on('close', () => {
      clearTimeout(waiter.timer);
      ch.waiters.delete(waiter);
    });
  }

  /** ‎/live/<W>/video/<action>‎ — גוף JSON (גם בלי content-type, כמו sendBeacon). */
  async function handleVideo(req, res, token, action) {
    let body = {};
    try {
      const text = await readBody(req, media.config.bodyBytes);
      if (text.trim() !== '') body = JSON.parse(text);
    } catch (err) {
      return sendJson(res, err?.status === 413 ? 413 : 400, {
        error: err?.status === 413 ? 'too-large' : 'bad-json',
      });
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return sendJson(res, 400, { error: 'bad-json' });
    }
    const [status, reply] = await media.handle(req, token, action, body);
    return sendJson(res, status, reply);
  }

  async function handle(req, res) {
    try {
      const url = new URL(req.url ?? '/', 'http://relay.local');
      const parts = url.pathname.split('/').filter(Boolean);
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS);
        return res.end();
      }
      if (parts[0] !== 'live') return sendJson(res, 404, { error: 'not-found' });
      if (parts.length === 2 && parts[1] === 'health' && req.method === 'GET') {
        let viewers = 0;
        for (const ch of channels.values()) viewers += viewerCount(ch);
        return sendJson(res, 200, {
          ok: true,
          channels: channels.size,
          viewers,
          connections: openConnections,
          video: media.stats(),
        });
      }
      const token = parts[1] ?? '';
      if (parts.length === 4 && parts[2] === 'video' && TOKEN_RE.test(token)) {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method' });
        return await handleVideo(req, res, token, parts[3]);
      }
      if (parts.length !== 3 || !TOKEN_RE.test(token))
        return sendJson(res, 404, { error: 'not-found' });
      if (parts[2] === 'pub' && req.method === 'POST') return await handlePublish(req, res, token);
      if (parts[2] === 'events' && req.method === 'GET') return handleEvents(req, res, token);
      if (parts[2] === 'poll' && req.method === 'GET') return handlePoll(req, res, token, url);
      return sendJson(res, 404, { error: 'not-found' });
    } catch {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal' });
      else res.end();
    }
  }

  /** דופק לצופים + ניקוי ערוצים נטושים. נקרא מטיימר. */
  function tick() {
    const at = now();
    media.tick();
    for (const ch of channels.values()) {
      if (ch.sse.size > 0) {
        const beat = beatMessage(ch);
        for (const res of ch.sse) writeSse(res, beat);
      }
      const idle = at - ch.lastActivity > cfg.channelIdleMs;
      if (idle && ch.sse.size === 0 && ch.waiters.size === 0) channels.delete(ch.token);
    }
  }

  function close() {
    for (const ch of channels.values()) {
      for (const res of ch.sse) res.end();
      for (const waiter of ch.waiters) {
        clearTimeout(waiter.timer);
        waiter.res.end();
      }
    }
    channels.clear();
  }

  return { handle, tick, close, channels, config: cfg, video: media };
}

export function startRelay({ port = 8787, host = '127.0.0.1', ...options } = {}) {
  const relay = createRelay(options);
  const server = createServer((req, res) => void relay.handle(req, res));
  // SSE ובקשות המתנה ארוכות — בלי ניתוק אוטומטי של Node.
  server.requestTimeout = 0;
  server.headersTimeout = 30_000;
  server.keepAliveTimeout = 65_000;
  const timer = setInterval(relay.tick, relay.config.keepaliveMs);
  timer.unref?.();
  const ready = new Promise((resolve) =>
    server.listen(port, host, () => resolve(server.address())),
  );
  return {
    server,
    relay,
    ready,
    close: () =>
      new Promise((resolve) => {
        clearInterval(timer);
        relay.close();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const port = Number(process.env.LIVE_RELAY_PORT ?? 8787);
  const host = process.env.LIVE_RELAY_HOST ?? '127.0.0.1';
  const { ready } = startRelay({ port, host });
  void ready.then((address) => {
    console.log(
      `[live-relay] listening on ${typeof address === 'object' && address ? `${address.address}:${address.port}` : address}`,
    );
  });
}
