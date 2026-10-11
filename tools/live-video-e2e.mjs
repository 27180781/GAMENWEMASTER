#!/usr/bin/env node
/**
 * בדיקה מקצה לקצה של וידאו המנחה במסך הצפייה: המסך הראשי והצופים בכרום אמיתי
 * (מצלמה ומיקרופון מדומים של כרום), הממסר האמיתי (server/live-relay.mjs עם
 * server/live-video.mjs), ו-Cloudflare מדומה — דף כרום נוסף שמשחק את ה-SFU:
 * מקבל את השידור של המנחה ומעביר אותו לכל צופה ב-WebRTC אמיתי, דרך אותן קריאות
 * API שהשרת שולח ל-Cloudflare (sessions/new, tracks/new, renegotiate, tracks/close).
 *
 *   node tools/live-video-e2e.mjs                 # פלט בתיקייה זמנית
 *   node tools/live-video-e2e.mjs ./video-e2e     # שומר צילומים ויומן כאן
 *
 * מה נבדק, לפי הסדר:
 *   1. משחק שהרישיון שלו כולל וידאו: תג «וידאו לצופים» במסך הראשי; לצופים אין חלון.
 *   2. הפעלה: מצלמה ומיקרופון, שידור ל-SFU, ואצל הצופה חלון שמנגן תמונה (מושתק).
 *   3. «הפעלת צליל» אצל הצופה מדליקה גם את הקול של המנחה.
 *   4. מצלמה כבויה אצל המנחה → הצופה רואה «המצלמה כבויה» והקול ממשיך; ובחזרה.
 *   5. מונה הצופים אצל המנחה, ותפריט המפעיל (סקציית הווידאו + תצוגה מקדימה).
 *   6. הצופה מסתיר את הווידאו → החיבור שלו נסגר (גם ב-SFU); «🎥 המנחה» מחזיר.
 *   7. שלט הצבעה + וידאו בעמודה אחת; טלפון לאורך ולרוחב (צילומים + גבולות).
 *   8. הממסר הופעל מחדש באמצע → המנחה פותח שידור חדש לבד, והצופים חוזרים אליו.
 *   9. מסך ראשי שני לוחץ «הפעלה» → השידור עובר אליו, והראשון משחרר את המצלמה.
 *  10. כיבוי אצל המנחה → החלון נעלם אצל הצופים, ו-Cloudflare מפסיק להעביר.
 *
 * קוד יציאה 1 אם בדיקה כלשהי נכשלה. לעולם לא מריץ playwright install.
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer as createVite } from 'vite';
import { startRelay, viewTokenFor } from '../server/live-relay.mjs';
import { createVideo, publishKeyFor } from '../server/live-video.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'video-e2e-')));
fs.mkdirSync(OUT, { recursive: true });

const GAME_ID = '7c1f3a52-4b8e-4d1a-9f0e-2a6b5c4d3e21';
const ROOM = '2047';
const CF = 'https://cf.e2e.test/v1';
const GAME_JSON = 'https://games.e2e.test/get-game-json?gameId=';
const PUBLISH_KEY = publishKeyFor(GAME_ID, ROOM);
const VIEW = viewTokenFor(PUBLISH_KEY);

// ---------------------------------------------------------------- המשחק

const blank = (v) => {
  if (typeof v === 'string') return /^https?:\/\//.test(v) ? '' : v;
  if (Array.isArray(v)) return v.map(blank);
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blank(x)]));
  return v;
};
const game = blank(JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/neuwirth.json'), 'utf8')));
game.questions = game.questions.slice(0, 4);
game.id = GAME_ID;
game.room = Number(ROOM);
game.name = 'בדיקת וידאו מנחה';
game.setting.limit = { type: 'phones', number: 20 };
game.setting.hostVideo = true;
game.assets = [];

// ---------------------------------------------------------------- תוצאות

const results = [];
const log = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const note = (line) => {
  log.push(`${new Date().toISOString()} ${line}`);
};

// ---------------------------------------------------------------- Cloudflare מדומה

/** רץ בדף ה-SFU: מחזיק "סשנים" כמו Cloudflare, ומעביר רצועות בין חיבורים. */
const SFU_SOURCE = `
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
    async subscribe(id, remoteId, names) {
      const s = sessions.get(id);
      const src = sessions.get(remoteId);
      if (!s || !src) return { error: 'session_error' };
      const pc = s.pc || new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
      s.pc = pc;
      s.remote = remoteId;
      const out = [];
      for (const name of names) {
        const track = src.tracks.get(name);
        if (!track) { out.push({ trackName: name, errorCode: 'track_not_found' }); continue; }
        const tx = pc.addTransceiver(track, { direction: 'sendonly' });
        out.push({ trackName: name, tx });
      }
      await pc.setLocalDescription(await pc.createOffer());
      await gather(pc);
      return {
        sdp: pc.localDescription.sdp,
        tracks: out.map((t) => t.tx
          ? { trackName: t.trackName, mid: t.tx.mid, sessionId: remoteId }
          : { trackName: t.trackName, errorCode: t.errorCode }),
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
        .map(([id, s]) => ({ id, publisher: s.tracks.size > 0, remote: s.remote ?? null, simulcastOffered: !!s.simulcastOffered }));
    },
  };
})();
`;

let sfuPage = null;
const cfCalls = [];

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function fakeFetch(input, init = {}) {
  const url = String(input);
  if (url.startsWith(GAME_JSON)) {
    const id = decodeURIComponent(url.slice(GAME_JSON.length));
    return id === GAME_ID ? jsonResponse(200, game) : jsonResponse(404, { error: 'not found' });
  }
  if (!url.startsWith(CF)) throw new Error(`unexpected fetch: ${url}`);
  const route = url.slice(CF.length);
  const method = init.method ?? 'GET';
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
  cfCalls.push({ method, route, body });
  const auth = new Headers(init.headers).get('authorization');
  if (auth !== 'Bearer SECRET') return jsonResponse(401, { errorCode: 'unauthorized' });
  let m;
  if (method === 'POST' && route === '/apps/APP/sessions/new') {
    return jsonResponse(201, { sessionId: await sfuPage.evaluate(() => window.sfu.newSession()) });
  }
  if (method === 'POST' && (m = /^\/apps\/APP\/sessions\/([^/]+)\/tracks\/new$/.exec(route))) {
    const id = m[1];
    if (body.sessionDescription !== undefined) {
      const r = await sfuPage.evaluate(
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
    const remote = body.tracks[0]?.sessionId;
    const r = await sfuPage.evaluate(
      ([i, rid, names]) => window.sfu.subscribe(i, rid, names),
      [id, remote, body.tracks.map((t) => t.trackName)],
    );
    if (r.error) return jsonResponse(200, { errorCode: r.error });
    return jsonResponse(200, {
      requiresImmediateRenegotiation: true,
      tracks: r.tracks,
      sessionDescription: { type: 'offer', sdp: r.sdp },
    });
  }
  if (method === 'PUT' && (m = /^\/apps\/APP\/sessions\/([^/]+)\/renegotiate$/.exec(route))) {
    const r = await sfuPage.evaluate(
      ([i, sdp]) => window.sfu.renegotiate(i, sdp),
      [m[1], body.sessionDescription.sdp],
    );
    return r.error ? jsonResponse(400, { errorCode: r.error }) : jsonResponse(200, {});
  }
  if (method === 'PUT' && (m = /^\/apps\/APP\/sessions\/([^/]+)\/tracks\/close$/.exec(route))) {
    await sfuPage.evaluate(
      ([i, mids]) => window.sfu.close(i, mids),
      [m[1], body.tracks.map((t) => t.mid)],
    );
    return jsonResponse(200, { tracks: body.tracks.map((t) => ({ mid: t.mid })) });
  }
  return jsonResponse(404, { errorCode: 'not_found' });
}

const VIDEO_ENV = {
  CF_REALTIME_APP_ID: 'APP',
  CF_REALTIME_APP_SECRET: 'SECRET',
  CF_REALTIME_API_BASE: CF,
  LIVE_VIDEO_GAME_JSON_URL: GAME_JSON,
};

function newVideo() {
  return createVideo({ fetch: fakeFetch, env: VIDEO_ENV, log: (line) => note(`[video] ${line}`) });
}

// ---------------------------------------------------------------- שרת עזר: קובץ המשחק ושרת הצבעות

function startHelper() {
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

// ---------------------------------------------------------------- עזרים לדפים

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, fn, arg, timeout = 20_000) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 200 });
    return true;
  } catch {
    return false;
  }
}

/** מה רכיב הווידאו של הצופה עושה עכשיו. */
function videoInfo(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.live-video-el');
    const tile = document.querySelector('.live-video');
    if (el === null) return { exists: false, tile: tile !== null };
    const stream = el.srcObject;
    return {
      exists: true,
      tile: tile !== null,
      attached: el.isConnected,
      playing: tile?.classList.contains('is-playing') ?? false,
      paused: el.paused,
      muted: el.muted,
      width: el.videoWidth,
      height: el.videoHeight,
      time: el.currentTime,
      ready: el.readyState,
      audioTracks: stream instanceof MediaStream ? stream.getAudioTracks().length : 0,
      videoTracks: stream instanceof MediaStream ? stream.getVideoTracks().length : 0,
      cover: [...document.querySelectorAll('.live-video-cover')].map((c) => c.textContent.trim()),
    };
  });
}

function chipText(page) {
  return page.evaluate(
    () => document.querySelector('.host-video-chip')?.textContent?.trim() ?? null,
  );
}

async function clickChip(page, title) {
  await page.locator(`.host-video-chip button[title="${title}"]`).click();
}

async function relayHealth(relayBase) {
  const res = await fetch(`${relayBase}/health`);
  return res.json();
}

/** כל הרכיבים העיקריים של הצופה בתוך החלון (לא נחתכים). */
function layoutProblems(page) {
  return page.evaluate(() => {
    const out = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    for (const sel of ['.live-video', '.live-pad-keys', '.live-controls', '.live-screen-area']) {
      const el = document.querySelector(sel);
      if (el === null) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) out.push(`${sel} בגודל 0`);
      if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) {
        out.push(
          `${sel} חורג מהחלון (${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)} בחלון ${vw}×${vh})`,
        );
      }
    }
    const tile = document.querySelector('.live-video');
    const screen = document.querySelector('.live-screen-area');
    if (tile && screen) {
      const a = tile.getBoundingClientRect();
      const b = screen.getBoundingClientRect();
      const overlap =
        Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
        Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      if (overlap > 4) out.push('חלון הווידאו מכסה את מסך המשחק');
    }
    return out;
  });
}

// ---------------------------------------------------------------- הבדיקה

async function main() {
  const helper = await startHelper();
  const voteServer = `http://127.0.0.1:${helper.port}`;
  const gameUrl = `http://127.0.0.1:${helper.port}/game.json`;

  let relay = startRelay({ port: 0, video: newVideo() });
  const address = await relay.ready;
  const relayPort = address.port;
  const relayBase = `http://127.0.0.1:${relayPort}/live`;

  const vite = await createVite({
    root: ROOT,
    logLevel: 'warn',
    clearScreen: false,
    server: {
      host: '127.0.0.1',
      port: 5320,
      strictPort: false,
      watch: { ignored: ['**/release/**', '**/dist/**', '**/video-e2e*/**'] },
    },
  });
  await vite.listen();
  const base = (
    vite.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${vite.config.server.port}/`
  ).replace(/\/?$/, '/');
  const qs = `liveRelay=${encodeURIComponent(relayBase)}&voteServer=${encodeURIComponent(voteServer)}`;
  const hostUrl = `${base}?game=${encodeURIComponent(gameUrl)}&${qs}`;
  const viewUrl = `${base}?view=${VIEW}&${qs}`;

  const executablePath = fs.existsSync('/opt/pw-browsers/chromium')
    ? '/opt/pw-browsers/chromium'
    : process.env.CHROMIUM_PATH;
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : { channel: 'chrome' }),
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--disable-features=WebRtcHideLocalIpsWithMdns',
      // כמו בכרום רגיל: קול רק אחרי נגיעה בדף
      '--autoplay-policy=document-user-activation-required',
    ],
  });

  const errors = [];
  const watch = (page, label) => {
    page.on('pageerror', (err) => errors.push(`${label}: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      // שרת ההצבעות המדומה לא מדבר socket.io — המסך הראשי מנסה ונכשל, וזה בסדר כאן.
      if (/Failed to load resource|socket\.io|ERR_CONNECTION_REFUSED|WebSocket/.test(text)) return;
      errors.push(`${label}: ${text}`);
    });
  };

  let exitCode = 0;
  try {
    const sfuContext = await browser.newContext();
    sfuPage = await sfuContext.newPage();
    watch(sfuPage, 'sfu');
    await sfuPage.goto('about:blank');
    await sfuPage.evaluate(SFU_SOURCE);

    // ---- 1. המסך הראשי, לפני הפעלה ----
    const hostContext = await browser.newContext({
      viewport: { width: 1600, height: 900 },
      permissions: ['camera', 'microphone'],
    });
    const host = await hostContext.newPage();
    watch(host, 'host');
    await host.goto(hostUrl);
    await host.getByRole('button', { name: /התחל משחק/ }).click({ timeout: 30_000 });
    const chipShown = await waitFor(
      host,
      () => document.querySelector('.host-video-chip') !== null,
    );
    check('תג «וידאו לצופים» במסך הראשי', chipShown, String(await chipText(host)));

    const viewerContext = await browser.newContext({ viewport: { width: 1440, height: 810 } });
    const viewer = await viewerContext.newPage();
    watch(viewer, 'viewer');
    await viewer.goto(viewUrl);
    await viewer.locator('.live-join-watch').click({ timeout: 30_000 });
    const gotScreen = await waitFor(
      viewer,
      () => document.querySelector('.live-screen-area .game-root') !== null,
    );
    check('מסך הצפייה מקבל את המשחק', gotScreen);
    check(
      'בלי שידור — אין חלון וידאו אצל הצופה',
      (await viewer.locator('.live-video').count()) === 0,
    );

    // ---- 2. הפעלה ----
    await host.locator('.host-video-chip button').first().click();
    const hostLive = await waitFor(host, () =>
      document.querySelector('.host-video-chip-state')?.textContent?.includes('🔴'),
    );
    check('המנחה משדר (מצלמה + מיקרופון מדומים)', hostLive, String(await chipText(host)));
    const pubCall = cfCalls.find((c) => /tracks\/new$/.test(c.route) && c.body?.sessionDescription);
    check(
      'השרת שלח ל-Cloudflare שתי רצועות (וידאו וקול)',
      pubCall !== undefined &&
        JSON.stringify(pubCall.body.tracks.map((t) => [t.location, t.trackName])) ===
          JSON.stringify([
            ['local', 'video'],
            ['local', 'audio'],
          ]),
      JSON.stringify(pubCall?.body?.tracks ?? null),
    );
    const sfuActive = await sfuPage.evaluate(() => window.sfu.active());
    check(
      'המנחה הציע שתי שכבות (simulcast)',
      sfuActive.some((s) => s.publisher && s.simulcastOffered),
      JSON.stringify(sfuActive),
    );

    const playing = await waitFor(
      viewer,
      () => {
        const el = document.querySelector('.live-video-el');
        return (
          document.querySelector('.live-video.is-playing') !== null &&
          el !== null &&
          el.videoWidth > 0 &&
          !el.paused
        );
      },
      undefined,
      30_000,
    );
    const v1 = await videoInfo(viewer);
    check('הצופה רואה את המצלמה של המנחה', playing, JSON.stringify(v1));
    check('בלי «הפעלת צליל» — מושתק', v1.muted === true);
    check('הגיעו תמונה וקול', v1.videoTracks === 1 && v1.audioTracks === 1);
    await sleep(1500);
    const v1b = await videoInfo(viewer);
    check('הווידאו זז', v1b.time > v1.time, `${v1.time.toFixed(2)} → ${v1b.time.toFixed(2)}`);
    await viewer.screenshot({ path: path.join(OUT, '01-viewer-desktop.png') });
    await host.screenshot({ path: path.join(OUT, '01-host.png') });

    // ---- 3. צליל ----
    await viewer.locator('.live-btn--call').click();
    await sleep(500);
    const v2 = await videoInfo(viewer);
    check(
      '«הפעלת צליל» מדליקה את הקול של המנחה',
      v2.muted === false && v2.paused === false,
      JSON.stringify(v2),
    );

    // ---- 4. מצלמה כבויה ----
    await clickChip(host, 'כיבוי המצלמה');
    const camOff = await waitFor(viewer, () =>
      [...document.querySelectorAll('.live-video-cover')].some((c) =>
        c.textContent.includes('המצלמה של המנחה כבויה'),
      ),
    );
    const v3 = await videoInfo(viewer);
    check(
      'מצלמה כבויה → «המצלמה של המנחה כבויה» והקול ממשיך',
      camOff && !v3.paused && !v3.muted,
      JSON.stringify(v3),
    );
    await viewer.screenshot({ path: path.join(OUT, '02-viewer-cam-off.png') });
    await clickChip(host, 'הדלקת המצלמה');
    const camOn = await waitFor(
      viewer,
      () => document.querySelector('.live-video.is-playing') !== null,
    );
    check('המצלמה חוזרת', camOn);

    // ---- 5. מונה הצופים ----
    const counted = await waitFor(
      host,
      () => document.querySelector('.host-video-chip-state')?.textContent?.includes('1'),
      undefined,
      25_000,
    );
    check('המנחה רואה צופה אחד', counted, String(await chipText(host)));

    // תפריט המפעיל (ESC): הסקציה של הווידאו, עם תצוגה מקדימה
    await host.keyboard.press('Escape');
    const panel = await waitFor(host, () => {
      const p = document.querySelector('.host-video-panel');
      const preview = document.querySelector('.host-video-preview');
      return p !== null && preview !== null && preview.videoWidth > 0;
    });
    check(
      'תפריט המפעיל: סקציית הווידאו ותצוגה מקדימה',
      panel,
      String(
        await host.evaluate(
          () => document.querySelector('.host-video-status')?.textContent ?? null,
        ),
      ),
    );
    await host.screenshot({ path: path.join(OUT, '02-host-menu.png') });
    await host.keyboard.press('Escape');

    // ---- 6. הסתרה ----
    await viewer.locator('.live-video-hide').click();
    const hidden = await waitFor(viewer, () => document.querySelector('.live-video') === null);
    const left = await waitFor(
      sfuPage,
      () => window.sfu.active().filter((s) => !s.publisher).length === 0,
    );
    const health = await relayHealth(relayBase);
    check(
      'הסתרה סוגרת את החיבור של הצופה (גם ב-SFU)',
      hidden && left && health.video?.viewers === 0,
      JSON.stringify(health.video),
    );
    const showBtn = viewer.locator('.live-btn', { hasText: 'המנחה' });
    check('כפתור «🎥 המנחה» מופיע', (await showBtn.count()) === 1);
    await showBtn.click();
    const back = await waitFor(
      viewer,
      () => {
        const el = document.querySelector('.live-video-el');
        return (
          document.querySelector('.live-video.is-playing') !== null &&
          el !== null &&
          el.videoWidth > 0 &&
          !el.paused
        );
      },
      undefined,
      30_000,
    );
    const v4 = await videoInfo(viewer);
    check('הווידאו חוזר, עם הקול', back && v4.muted === false, JSON.stringify(v4));

    // ---- 7. שלט + וידאו, ופריסות טלפון ----
    await viewer.locator('.live-btn--play').click();
    await viewer.locator('.live-join-input').fill('דנה');
    await viewer.locator('.live-join-go').click();
    const padAndVideo = await waitFor(
      viewer,
      () =>
        document.querySelector('.live-side .live-video') !== null &&
        document.querySelector('.live-side .live-pad') !== null,
    );
    check('שלט ההצבעה והווידאו באותה עמודה', padAndVideo);
    const p1 = await layoutProblems(viewer);
    check('מחשב: שלט + וידאו בתוך החלון', p1.length === 0, p1.join('; '));
    await viewer.screenshot({ path: path.join(OUT, '03-viewer-desktop-pad.png') });

    const phones = [
      { name: 'portrait', viewport: { width: 390, height: 844 } },
      { name: 'landscape', viewport: { width: 844, height: 390 } },
    ];
    for (const ph of phones) {
      const ctx = await browser.newContext({
        viewport: ph.viewport,
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      });
      const page = await ctx.newPage();
      watch(page, `phone-${ph.name}`);
      await page.goto(viewUrl);
      await page.locator('.live-join-watch').click({ timeout: 30_000 });
      const ok = await waitFor(
        page,
        () => document.querySelector('.live-video.is-playing') !== null,
        undefined,
        30_000,
      );
      const pr = await layoutProblems(page);
      check(
        `טלפון ${ph.name === 'portrait' ? 'לאורך' : 'לרוחב'}: וידאו בלי שלט`,
        ok && pr.length === 0,
        pr.join('; '),
      );
      await page.screenshot({ path: path.join(OUT, `04-phone-${ph.name}.png`) });
      await page.locator('.live-btn--play').click();
      await page.locator('.live-join-input').fill('יוסי');
      await page.locator('.live-join-go').click();
      await waitFor(page, () => document.querySelector('.live-pad') !== null);
      await sleep(300);
      const pr2 = await layoutProblems(page);
      check(
        `טלפון ${ph.name === 'portrait' ? 'לאורך' : 'לרוחב'}: וידאו + שלט`,
        pr2.length === 0,
        pr2.join('; '),
      );
      await page.screenshot({ path: path.join(OUT, `05-phone-${ph.name}-pad.png`) });
      await ctx.close();
    }

    // ---- 8. הממסר הופעל מחדש ----
    // ב-Cloudflare החיבורים ממשיכים; הממסר החדש לא מכיר אף אחד. המנחה מגלה
    // בדופק ("gone"), פותח שידור חדש, והצופים עוברים אליו (רצועה חדשה).
    const streamBefore = await viewer.evaluate(
      () => document.querySelector('.live-video-el')?.srcObject?.id ?? null,
    );
    await relay.close();
    relay = startRelay({ port: relayPort, video: newVideo() });
    await relay.ready;
    note('relay restarted');
    let republished = false;
    for (let i = 0; i < 45 && !republished; i += 1) {
      await sleep(1000);
      republished = (await relayHealth(relayBase)).video?.publications === 1;
    }
    const recovered = await waitFor(
      viewer,
      (before) => {
        const el = document.querySelector('.live-video-el');
        const id = el?.srcObject?.id ?? null;
        return (
          document.querySelector('.live-video.is-playing') !== null &&
          id !== null &&
          id !== before &&
          el.videoWidth > 0 &&
          !el.paused
        );
      },
      streamBefore,
      60_000,
    );
    const hostBack = await waitFor(host, () =>
      document.querySelector('.host-video-chip-state')?.textContent?.includes('🔴'),
    );
    check(
      'אחרי הפעלה מחדש של הממסר — המנחה משדר שוב לבד והצופה חוזר',
      republished && recovered && hostBack,
      JSON.stringify({
        republished,
        recovered,
        hostBack,
        health: (await relayHealth(relayBase)).video,
      }),
    );

    // ---- 9. מסך ראשי שני ----
    const host2Context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      permissions: ['camera', 'microphone'],
    });
    const host2 = await host2Context.newPage();
    watch(host2, 'host2');
    await host2.goto(hostUrl);
    await host2.getByRole('button', { name: /התחל משחק/ }).click({ timeout: 30_000 });
    await waitFor(host2, () => document.querySelector('.host-video-chip') !== null);
    await host2.locator('.host-video-chip button').first().click();
    const host2Live = await waitFor(host2, () =>
      document.querySelector('.host-video-chip-state')?.textContent?.includes('🔴'),
    );
    const host1Out = await waitFor(
      host,
      () => document.querySelector('.host-video-chip')?.textContent?.includes('עבר למסך אחר'),
      undefined,
      30_000,
    );
    check(
      'מסך שני שלוחץ «הפעלה» מקבל את השידור, והראשון משחרר',
      host2Live && host1Out,
      String(await chipText(host)),
    );
    const viewerFollows = await waitFor(
      viewer,
      () => {
        const el = document.querySelector('.live-video-el');
        return (
          document.querySelector('.live-video.is-playing') !== null &&
          el !== null &&
          el.videoWidth > 0 &&
          !el.paused
        );
      },
      undefined,
      45_000,
    );
    check('הצופה עובר לשידור של המסך השני', viewerFollows);

    // ---- 10. כיבוי ----
    await clickChip(host2, 'כיבוי הווידאו');
    const gone = await waitFor(
      viewer,
      () => document.querySelector('.live-video') === null,
      undefined,
      20_000,
    );
    const quiet = await waitFor(sfuPage, () => window.sfu.active().length === 0, undefined, 20_000);
    const health3 = await relayHealth(relayBase);
    check('כיבוי → החלון נעלם אצל הצופה', gone);
    check(
      'כיבוי → Cloudflare מפסיק להעביר (המנחה והצופים)',
      quiet && health3.video?.publications === 0 && health3.video?.viewers === 0,
      JSON.stringify({
        health: health3.video,
        sfu: await sfuPage.evaluate(() => window.sfu.active()),
      }),
    );
    await viewer.screenshot({ path: path.join(OUT, '06-viewer-after-stop.png') });

    check('בלי שגיאות בדפים', errors.length === 0, errors.slice(0, 5).join(' | '));
  } catch (err) {
    check('הבדיקה רצה עד הסוף', false, err?.stack ?? String(err));
  } finally {
    fs.writeFileSync(
      path.join(OUT, 'log.txt'),
      `${log.join('\n')}\n\n${JSON.stringify(
        cfCalls.map((c) => `${c.method} ${c.route}`),
        null,
        1,
      )}\n`,
    );
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    await browser.close().catch(() => {});
    await vite.close().catch(() => {});
    await relay.close().catch(() => {});
    helper.server.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} עברו · פלט: ${OUT}`);
  if (failed.length > 0) exitCode = 1;
  process.exit(exitCode);
}

void main();
