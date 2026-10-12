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
 *      ולאורך הדרך «המצלמה שלי»: החלונית הצפה אצל המנחה בלבד — גרירה (גם מעבר
 *      לשולי הבמה), מזעור ופתיחה, חלון נפרד (Picture-in-Picture), מצלמה כבויה,
 *      ונעלמת כשהשידור עובר למסך אחר או נכבה.
 *   6. הצופה מסתיר את הווידאו → החיבור שלו נסגר (גם ב-SFU); «🎥 המנחה» מחזיר.
 *   7. שלט הצבעה + וידאו בעמודה אחת; טלפון לאורך ולרוחב (צילומים + גבולות).
 *   8. הממסר הופעל מחדש באמצע → המנחה פותח שידור חדש לבד, והצופים חוזרים אליו.
 *   9. מסך ראשי שני לוחץ «הפעלה» → השידור עובר אליו, והראשון משחרר את המצלמה.
 *  10. כיבוי אצל המנחה → החלון נעלם אצל הצופים, ו-Cloudflare מפסיק להעביר.
 *
 * קוד יציאה 1 אם בדיקה כלשהי נכשלה. לעולם לא מריץ playwright install.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startRelay, viewTokenFor } from '../server/live-relay.mjs';
import { createVideo, publishKeyFor } from '../server/live-video.mjs';
import {
  createReport,
  fakeCloudflare,
  launchBrowser,
  openSfu,
  pageWatcher,
  relayHealth,
  sleep,
  startHelper,
  startViteServer,
  testGame,
  videoEnv,
  waitFor,
} from './live-e2e-kit.mjs';

const OUT = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'video-e2e-')));
fs.mkdirSync(OUT, { recursive: true });

const GAME_ID = '7c1f3a52-4b8e-4d1a-9f0e-2a6b5c4d3e21';
const ROOM = '2047';
const CF = 'https://cf.e2e.test/v1';
const GAME_JSON = 'https://games.e2e.test/get-game-json?gameId=';
const PUBLISH_KEY = publishKeyFor(GAME_ID, ROOM);
const VIEW = viewTokenFor(PUBLISH_KEY);

const game = testGame({
  id: GAME_ID,
  room: ROOM,
  name: 'בדיקת וידאו מנחה',
  setting: { limit: { type: 'phones', number: 20 }, hostVideo: true },
});

const { results, log, check, note } = createReport();

// ---------------------------------------------------------------- Cloudflare מדומה

let sfuPage = null;
const cloudflare = fakeCloudflare({
  cf: CF,
  gameJson: GAME_JSON,
  games: new Map([[GAME_ID, game]]),
  sfuPage: () => sfuPage,
});
const cfCalls = cloudflare.calls;

function newVideo() {
  return createVideo({
    fetch: cloudflare.fetch,
    env: videoEnv({ cf: CF, gameJson: GAME_JSON }),
    log: (line) => note(`[video] ${line}`),
  });
}

// ---------------------------------------------------------------- עזרים לדפים

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

/** «המצלמה שלי» אצל המנחה: איפה (בבמה ובמסך), מה מוצג, ומה נשמר. */
function selfViewInfo(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.host-self-view');
    const stage = document.querySelector('.stage');
    if (el === null || stage === null) return { exists: false };
    const r = el.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    const video = el.querySelector('video');
    return {
      exists: true,
      left: Number.parseFloat(el.style.left),
      top: Number.parseFloat(el.style.top),
      compact: el.classList.contains('is-compact'),
      text: el.textContent.trim(),
      inside:
        r.left >= s.left - 0.5 &&
        r.top >= s.top - 0.5 &&
        r.right <= s.right + 0.5 &&
        r.bottom <= s.bottom + 0.5,
      screen: { x: r.left, y: r.top, w: r.width, h: r.height },
      scale: s.width / 1920,
      stage: { x: s.left, y: s.top },
      pip: video !== null && document.pictureInPictureElement === video,
      playing: video !== null && !video.paused && video.readyState >= 2 && video.videoWidth > 0,
      saved: localStorage.getItem('trivia.hostVideo.selfView'),
      focus: document.activeElement?.tagName ?? null,
    };
  });
}

/** גרירה בעכבר אמיתי ממרכז החלונית, בפיקסלים של המסך. */
async function dragSelfView(page, dx, dy) {
  const box = await selfViewInfo(page);
  const x = box.screen.x + box.screen.w / 2;
  const y = box.screen.y + box.screen.h / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
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
  const helper = await startHelper(game);
  const voteServer = `http://127.0.0.1:${helper.port}`;
  const gameUrl = `http://127.0.0.1:${helper.port}/game.json`;

  let relay = startRelay({ port: 0, video: newVideo() });
  const address = await relay.ready;
  const relayPort = address.port;
  const relayBase = `http://127.0.0.1:${relayPort}/live`;

  const { vite, base } = await startViteServer(['**/video-e2e*/**']);
  const qs = `liveRelay=${encodeURIComponent(relayBase)}&voteServer=${encodeURIComponent(voteServer)}`;
  const hostUrl = `${base}?game=${encodeURIComponent(gameUrl)}&${qs}`;
  const viewUrl = `${base}?view=${VIEW}&${qs}`;

  const browser = await launchBrowser();
  const errors = [];
  const watch = pageWatcher(errors);

  let exitCode = 0;
  try {
    sfuPage = await openSfu(browser, watch);

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

    // ---- 2ב. «המצלמה שלי» — חלונית צפה אצל המנחה בלבד ----
    const selfShown = await waitFor(host, () => {
      const el = document.querySelector('.host-self-view video');
      return el !== null && el.videoWidth > 0 && !el.paused;
    });
    const s0 = await selfViewInfo(host);
    check(
      '«המצלמה שלי»: חלונית עם המצלמה של המנחה, בפינה ובתוך הבמה',
      selfShown && s0.inside && !s0.compact && s0.left > 960 && s0.top > 540,
      JSON.stringify({ left: s0.left, top: s0.top, inside: s0.inside }),
    );
    check(
      '«המצלמה שלי» לא מגיעה למסך הצפייה',
      (await viewer.locator('.host-self-view').count()) === 0,
    );

    await dragSelfView(host, -300, -150);
    const s1 = await selfViewInfo(host);
    const want = { left: s0.left - 300 / s0.scale, top: s0.top - 150 / s0.scale };
    const saved1 = JSON.parse(s1.saved ?? '{}');
    check(
      'גרירה מזיזה את החלונית לפי הגודל של הבמה, ונשמרת במחשב',
      Math.abs(s1.left - want.left) <= 2 &&
        Math.abs(s1.top - want.top) <= 2 &&
        saved1.x === s1.left &&
        saved1.y === s1.top &&
        s1.focus !== 'BUTTON',
      JSON.stringify({ from: [s0.left, s0.top], to: [s1.left, s1.top], want, saved: s1.saved }),
    );

    await dragSelfView(host, -4000, -4000);
    const s2 = await selfViewInfo(host);
    check(
      'גרירה מעבר לשולי המסך נעצרת בתוך הבמה',
      s2.inside && s2.left === 12 && s2.top === 12,
      JSON.stringify({ left: s2.left, top: s2.top }),
    );

    await host.locator('.host-self-view button[title="מזעור"]').click();
    const s3 = await selfViewInfo(host);
    check(
      'מזעור: כפתור «המצלמה שלי» באותה פינה, בלי פוקוס על כפתור',
      s3.compact &&
        s3.text.includes('המצלמה שלי') &&
        s3.left === s2.left &&
        s3.top === s2.top &&
        JSON.parse(s3.saved ?? '{}').minimized === true &&
        s3.focus !== 'BUTTON',
      JSON.stringify({
        compact: s3.compact,
        text: s3.text,
        at: [s3.left, s3.top],
        focus: s3.focus,
      }),
    );
    await host.locator('.host-self-view').click();
    const s4 = await selfViewInfo(host);
    check(
      'לחיצה על הכפתור הממוזער פותחת את החלונית בחזרה',
      !s4.compact && s4.playing && JSON.parse(s4.saved ?? '{}').minimized === false,
      JSON.stringify({ compact: s4.compact, playing: s4.playing }),
    );

    const pipButton = host.locator('.host-self-view button[title^="פתיחה בחלון נפרד"]');
    const pipOffered = (await pipButton.count()) === 1;
    if (pipOffered) await pipButton.click();
    const inPip =
      pipOffered &&
      (await waitFor(host, () => document.pictureInPictureElement !== null, undefined, 5_000));
    await sleep(300);
    const s5 = await selfViewInfo(host);
    check(
      'חלון נפרד (Picture-in-Picture): הווידאו ממשיך, ובמסך נשאר כפתור קטן',
      inPip && s5.pip && s5.compact && s5.text.includes('בחלון נפרד') && s5.playing,
      JSON.stringify({
        offered: pipOffered,
        pip: s5.pip,
        compact: s5.compact,
        text: s5.text,
        playing: s5.playing,
      }),
    );
    await host.screenshot({ path: path.join(OUT, '01-host-self-view-pip.png') });
    await dragSelfView(host, 200, 100);
    const s5b = await selfViewInfo(host);
    check(
      'בזמן החלון הנפרד אפשר לגרור את הכפתור, והחלון הנפרד נשאר פתוח',
      s5b.pip && s5b.compact && s5b.left > s5.left && s5b.top > s5.top && s5b.inside,
      JSON.stringify({ from: [s5.left, s5.top], to: [s5b.left, s5b.top], pip: s5b.pip }),
    );
    await host.locator('.host-self-view').click();
    const outOfPip = await waitFor(
      host,
      () => document.pictureInPictureElement === null,
      undefined,
      5_000,
    );
    const s6 = await selfViewInfo(host);
    check(
      'לחיצה על הכפתור מחזירה מהחלון הנפרד לחלונית, במקום שאליו גררו את הכפתור',
      outOfPip &&
        !s6.compact &&
        !s6.pip &&
        s6.playing &&
        s6.left === s5b.left &&
        s6.top === s5b.top,
      JSON.stringify({
        pip: s6.pip,
        compact: s6.compact,
        playing: s6.playing,
        at: [s6.left, s6.top],
        pill: [s5b.left, s5b.top],
      }),
    );

    // בחזרה לפינה, לצילום (ולשאר הבדיקה)
    await dragSelfView(host, (s0.left - s6.left) * s6.scale, (s0.top - s6.top) * s6.scale);
    const s7 = await selfViewInfo(host);
    check(
      'גרירה חזרה לפינה',
      Math.abs(s7.left - s0.left) <= 2 && Math.abs(s7.top - s0.top) <= 2,
      JSON.stringify({ left: s7.left, top: s7.top }),
    );

    // מזעור בפינה התחתונה: הכפתור נצמד לפינה ולא נשאר תלוי באוויר
    await host.locator('.host-self-view button[title="מזעור"]').click();
    const s8 = await selfViewInfo(host);
    check(
      'מזעור בפינה התחתונה: הכפתור נצמד לאותה פינה',
      s8.compact && s8.inside && s8.left + 220 === s7.left + 320 && s8.top + 44 === s7.top + 180,
      JSON.stringify({ tile: [s7.left, s7.top], pill: [s8.left, s8.top] }),
    );
    await host.screenshot({ path: path.join(OUT, '01-host-self-view-minimized.png') });
    await host.locator('.host-self-view').click();
    const s9 = await selfViewInfo(host);
    check(
      'והפתיחה מחזירה את החלונית בדיוק למקום שלה',
      !s9.compact && s9.left === s7.left && s9.top === s7.top,
      JSON.stringify({ left: s9.left, top: s9.top }),
    );
    await host.screenshot({ path: path.join(OUT, '01-host-self-view.png') });

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
    const selfCamOff = await waitFor(host, () =>
      document.querySelector('.host-self-view-off')?.textContent?.includes('המצלמה כבויה'),
    );
    check('«המצלמה שלי» אומרת שהמצלמה כבויה', selfCamOff);
    await clickChip(host, 'הדלקת המצלמה');
    const camOn = await waitFor(
      viewer,
      () => document.querySelector('.live-video.is-playing') !== null,
    );
    check('המצלמה חוזרת', camOn);
    const selfCamOn = await waitFor(
      host,
      () => document.querySelector('.host-self-view-off') === null,
    );
    check('«המצלמה שלי» חוזרת עם המצלמה', selfCamOn);

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
    const selfMoved =
      (await waitFor(host, () => document.querySelector('.host-self-view') === null)) &&
      (await waitFor(host2, () => document.querySelector('.host-self-view video')?.videoWidth > 0));
    check('«המצלמה שלי» עוברת עם השידור למסך השני', selfMoved);

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
      'כיבוי → «המצלמה שלי» נעלמת אצל המנחה',
      await waitFor(host2, () => document.querySelector('.host-self-view') === null),
    );
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
