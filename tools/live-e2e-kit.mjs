/**
 * מה שהבדיקות מקצה לקצה של הווידאו חולקות (live-video-e2e.mjs — וידאו המנחה,
 * live-stage-e2e.mjs — «במה»): Cloudflare מדומה, שרת עזר לקובץ המשחק ולשרת
 * ההצבעות, כרום עם מצלמה ומיקרופון מדומים, השרת של vite, ורישום התוצאות.
 *
 * Cloudflare המדומה הוא דף כרום נוסף שמשחק את ה-SFU: מקבל את מה שהמנחה
 * והמשתתפים משדרים ומעביר אותו לכל צופה ב-WebRTC אמיתי, דרך אותן קריאות API
 * שהשרת שולח ל-Cloudflare (sessions/new, tracks/new, renegotiate, tracks/close).
 * כמו ב-Cloudflare, צפייה אחת יכולה לקחת רצועות מכמה סשנים (מכמה מצלמות).
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer as createVite } from 'vite';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- המשחק

/** משחק בדיקה מ-fixtures, בלי כתובות מדיה חיצוניות. */
export function testGame({ id, room, name, setting }) {
  const blank = (v) => {
    if (typeof v === 'string') return /^https?:\/\//.test(v) ? '' : v;
    if (Array.isArray(v)) return v.map(blank);
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blank(x)]));
    return v;
  };
  const game = blank(
    JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/neuwirth.json'), 'utf8')),
  );
  game.questions = game.questions.slice(0, 4);
  game.id = id;
  game.room = Number(room);
  game.name = name;
  Object.assign(game.setting, setting);
  game.assets = [];
  return game;
}

// ---------------------------------------------------------------- תוצאות

export function createReport() {
  const results = [];
  const log = [];
  return {
    results,
    log,
    check(name, ok, detail = '') {
      results.push({ name, ok, detail });
      console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
    },
    note(line) {
      log.push(`${new Date().toISOString()} ${line}`);
    },
  };
}

// ---------------------------------------------------------------- Cloudflare מדומה

/** רץ בדף ה-SFU: מחזיק "סשנים" כמו Cloudflare, ומעביר רצועות בין חיבורים. */
export const SFU_SOURCE = `
window.sfu = (() => {
  const sessions = new Map();
  let n = 0;
  const gather = (pc) => new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const t = setTimeout(resolve, 3000);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); }
    });
  });
  // כרום לא מקבל simulcast נכנס בלי שינוי SDP; Cloudflare כן. כאן — שכבה אחת.
  const noSimulcast = (sdp) => sdp.split('\\r\\n').filter((l) => !/^a=(rid|simulcast):/.test(l)).join('\\r\\n');
  return {
    newSession() {
      const id = 'sfu' + (++n);
      sessions.set(id, { pc: null, tracks: new Map(), closed: [] });
      return id;
    },
    async publish(id, offer, tracks) {
      const s = sessions.get(id);
      if (!s) return { error: 'session_error' };
      const pc = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
      s.pc = pc;
      s.simulcastOffered = /a=simulcast:send/.test(offer);
      await pc.setRemoteDescription({ type: 'offer', sdp: noSimulcast(offer) });
      for (const t of tracks) {
        const tx = pc.getTransceivers().find((x) => x.mid === t.mid);
        if (!tx) return { error: 'no mid ' + t.mid };
        tx.direction = 'recvonly';
        s.tracks.set(t.trackName, tx.receiver.track);
      }
      await pc.setLocalDescription(await pc.createAnswer());
      await gather(pc);
      return { sdp: pc.localDescription.sdp };
    },
    /** wants: [{ sessionId, trackName }] — כל רצועה מהסשן שלה. */
    async subscribe(id, wants) {
      const s = sessions.get(id);
      if (!s) return { error: 'session_error' };
      const pc = s.pc || new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
      s.pc = pc;
      s.remotes = [...new Set(wants.map((w) => w.sessionId))];
      const out = [];
      for (const w of wants) {
        const track = sessions.get(w.sessionId)?.tracks.get(w.trackName);
        if (!track) { out.push({ ...w, errorCode: 'track_not_found' }); continue; }
        const tx = pc.addTransceiver(track, { direction: 'sendonly' });
        out.push({ ...w, tx });
      }
      await pc.setLocalDescription(await pc.createOffer());
      await gather(pc);
      return {
        sdp: pc.localDescription.sdp,
        tracks: out.map((t) => t.tx
          ? { trackName: t.trackName, mid: t.tx.mid, sessionId: t.sessionId }
          : { trackName: t.trackName, sessionId: t.sessionId, errorCode: t.errorCode }),
      };
    },
    async renegotiate(id, answer) {
      const s = sessions.get(id);
      if (!s || !s.pc) return { error: 'session_error' };
      await s.pc.setRemoteDescription({ type: 'answer', sdp: answer });
      return {};
    },
    close(id, mids) {
      const s = sessions.get(id);
      if (!s || !s.pc) return {};
      for (const tx of s.pc.getTransceivers()) {
        if (mids.includes(tx.mid)) { try { tx.stop(); } catch {} s.closed.push(tx.mid); }
      }
      return {};
    },
    /** חיבורים שעדיין מעבירים משהו. */
    active() {
      return [...sessions.entries()]
        .filter(([, s]) => s.pc && s.pc.connectionState === 'connected' &&
          s.pc.getTransceivers().some((tx) => !tx.stopped && tx.currentDirection !== 'inactive' && tx.currentDirection !== null))
        .map(([id, s]) => ({
          id,
          publisher: s.tracks.size > 0,
          names: [...s.tracks.keys()],
          remote: s.remotes?.[0] ?? null,
          remotes: s.remotes ?? [],
          sending: s.pc.getTransceivers().filter((tx) => !tx.stopped && tx.currentDirection === 'sendonly').length,
          simulcastOffered: !!s.simulcastOffered,
        }));
    },
  };
})();
`;

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * `fetch` של שרת הווידאו: קובץ המשחק מ-`gameJson`, ו-Cloudflare (`cf`) מהדף
 * של ה-SFU. כל קריאה ל-Cloudflare נרשמת ב-`calls`.
 */
export function fakeCloudflare({ cf, gameJson, games, sfuPage }) {
  const calls = [];
  async function fetchImpl(input, init = {}) {
    const url = String(input);
    if (url.startsWith(gameJson)) {
      const game = games.get(decodeURIComponent(url.slice(gameJson.length)));
      return game ? jsonResponse(200, game) : jsonResponse(404, { error: 'not found' });
    }
    if (!url.startsWith(cf)) throw new Error(`unexpected fetch: ${url}`);
    const route = url.slice(cf.length);
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ method, route, body });
    const auth = new Headers(init.headers).get('authorization');
    if (auth !== 'Bearer SECRET') return jsonResponse(401, { errorCode: 'unauthorized' });
    const sfu = sfuPage();
    let m;
    if (method === 'POST' && route === '/apps/APP/sessions/new') {
      return jsonResponse(201, { sessionId: await sfu.evaluate(() => window.sfu.newSession()) });
    }
    if (method === 'POST' && (m = /^\/apps\/APP\/sessions\/([^/]+)\/tracks\/new$/.exec(route))) {
      const id = m[1];
      if (body.sessionDescription !== undefined) {
        const r = await sfu.evaluate(
          ([i, sdp, t]) => window.sfu.publish(i, sdp, t),
          [id, body.sessionDescription.sdp, body.tracks],
        );
        if (r.error) return jsonResponse(200, { errorCode: r.error });
        return jsonResponse(200, {
          requiresImmediateRenegotiation: false,
          tracks: body.tracks.map((t) => ({ mid: t.mid, trackName: t.trackName })),
          sessionDescription: { type: 'answer', sdp: r.sdp },
        });
      }
      const wants = body.tracks.map((t) => ({ sessionId: t.sessionId, trackName: t.trackName }));
      const r = await sfu.evaluate(([i, w]) => window.sfu.subscribe(i, w), [id, wants]);
      if (r.error) return jsonResponse(200, { errorCode: r.error });
      return jsonResponse(200, {
        requiresImmediateRenegotiation: true,
        tracks: r.tracks,
        sessionDescription: { type: 'offer', sdp: r.sdp },
      });
    }
    if (method === 'PUT' && (m = /^\/apps\/APP\/sessions\/([^/]+)\/renegotiate$/.exec(route))) {
      const r = await sfu.evaluate(
        ([i, sdp]) => window.sfu.renegotiate(i, sdp),
        [m[1], body.sessionDescription.sdp],
      );
      return r.error ? jsonResponse(400, { errorCode: r.error }) : jsonResponse(200, {});
    }
    if (method === 'PUT' && (m = /^\/apps\/APP\/sessions\/([^/]+)\/tracks\/close$/.exec(route))) {
      await sfu.evaluate(
        ([i, mids]) => window.sfu.close(i, mids),
        [m[1], body.tracks.map((t) => t.mid)],
      );
      return jsonResponse(200, { tracks: body.tracks.map((t) => ({ mid: t.mid })) });
    }
    return jsonResponse(404, { errorCode: 'not_found' });
  }
  return { fetch: fetchImpl, calls };
}

/** משתני הסביבה של שרת הווידאו מול Cloudflare המדומה. */
export function videoEnv({ cf, gameJson }) {
  return {
    CF_REALTIME_APP_ID: 'APP',
    CF_REALTIME_APP_SECRET: 'SECRET',
    CF_REALTIME_API_BASE: cf,
    LIVE_VIDEO_GAME_JSON_URL: gameJson,
  };
}

/** פותח את דף ה-SFU. */
export async function openSfu(browser, watch) {
  const context = await browser.newContext();
  const page = await context.newPage();
  watch(page, 'sfu');
  await page.goto('about:blank');
  await page.evaluate(SFU_SOURCE);
  return page;
}

// ---------------------------------------------------------------- שרת עזר: קובץ המשחק ושרת הצבעות

export function startHelper(game) {
  const votes = [];
  const server = http.createServer((req, res) => {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end();
      return;
    }
    if (req.url?.startsWith('/game.json')) {
      res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(game));
      return;
    }
    if (req.url === '/game/join' || req.url === '/game/voting') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        votes.push({ url: req.url, raw });
        res.writeHead(200, { ...cors, 'content-type': 'text/plain' }).end('OK');
      });
      return;
    }
    res.writeHead(404, cors).end();
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ server, votes, port: server.address().port })),
  );
}

// ---------------------------------------------------------------- דפדפן ו-vite

export async function startViteServer(ignored) {
  const vite = await createVite({
    root: ROOT,
    logLevel: 'warn',
    clearScreen: false,
    server: {
      host: '127.0.0.1',
      port: 5320,
      strictPort: false,
      watch: { ignored: ['**/release/**', '**/dist/**', ...ignored] },
    },
  });
  await vite.listen();
  const base = (
    vite.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${vite.config.server.port}/`
  ).replace(/\/?$/, '/');
  return { vite, base };
}

/** כרום עם מצלמה ומיקרופון מדומים. לעולם לא מוריד דפדפן. */
export function launchBrowser() {
  const executablePath = fs.existsSync('/opt/pw-browsers/chromium')
    ? '/opt/pw-browsers/chromium'
    : process.env.CHROMIUM_PATH;
  return chromium.launch({
    ...(executablePath ? { executablePath } : { channel: 'chrome' }),
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--disable-features=WebRtcHideLocalIpsWithMdns',
      // כמו בכרום רגיל: קול רק אחרי נגיעה בדף
      '--autoplay-policy=document-user-activation-required',
    ],
  });
}

/** שגיאות בדף נאספות ל-`errors`, חוץ מהשגיאות הצפויות של שרת ההצבעות המדומה. */
export function pageWatcher(errors) {
  return (page, label) => {
    page.on('pageerror', (err) => errors.push(`${label}: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      // שרת ההצבעות המדומה לא מדבר socket.io — המסך הראשי מנסה ונכשל, וזה בסדר כאן.
      if (/Failed to load resource|socket\.io|ERR_CONNECTION_REFUSED|WebSocket/.test(text)) return;
      errors.push(`${label}: ${text}`);
    });
  };
}

export async function waitFor(page, fn, arg, timeout = 20_000) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 200 });
    return true;
  } catch {
    return false;
  }
}

export async function relayHealth(relayBase) {
  const res = await fetch(`${relayBase}/health`);
  return res.json();
}
