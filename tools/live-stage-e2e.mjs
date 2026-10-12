#!/usr/bin/env node
/**
 * בדיקה מקצה לקצה של «במה»: המסך הראשי, שני משתתפים שמדליקים מצלמה בקישור
 * הצפייה, וצופה — בכרום אמיתי עם מצלמות מדומות, הממסר האמיתי
 * (server/live-relay.mjs עם live-video.mjs ו-live-stage.mjs), ו-Cloudflare
 * מדומה שמעביר WebRTC אמיתי (live-e2e-kit.mjs).
 *
 *   node tools/live-stage-e2e.mjs                 # פלט בתיקייה זמנית
 *   node tools/live-stage-e2e.mjs ./stage-e2e     # שומר צילומים ויומן כאן
 *
 * מה נבדק, לפי הסדר:
 *   1. משחק שהרישיון שלו כולל במה: הכפתור «👥» בתג רק כשהווידאו של המנחה דלוק.
 *   2. לפני שהמנחה פותח את הבמה — אין כפתור מצלמה בקישור הצפייה.
 *   3. המנחה פותח מתפריט המפעיל → חלון ניהול הבמה; בקישור מופיע «📷 מצלמה».
 *   4. שני משתתפים מדליקים מצלמה בשם → רק המנחה רואה אותם (שכבה נמוכה).
 *   5. רותי עולה לבמה → הצופים רואים אותה, היא רואה את עצמה כמו מראה, ובמסך
 *      הראשי חלונית צפה.
 *   6. דן עולה → אצל הצופה שני חלונות, בלי רגע שבו אין אף אחד.
 *   7. החלונית במסך הראשי: מזעור (בלי וידאו) ופתיחה.
 *   8. צופה מסתיר את הבמה → החיבור שלו נסגר; «👥 הבמה» מחזיר.
 *   9. טלפון לאורך: המנחה, הבמה, המצלמה שלי ושלט ההצבעה בתוך החלון.
 *  10. המנחה מכבה את דן → דן רואה למה ולא מדליק שוב; הוא יורד אצל כולם.
 *  11. המנחה סוגר את הבמה → המצלמה של רותי כבה והיא רואה למה, הבמה נעלמת,
 *      ו-Cloudflare מפסיק להעביר את המצלמות.
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

const OUT = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'stage-e2e-')));
fs.mkdirSync(OUT, { recursive: true });

const GAME_ID = '5d2e8b41-9c3a-4f6e-8a1b-3c7d9e0f1a24';
const ROOM = '3051';
const CF = 'https://cf.e2e.test/v1';
const GAME_JSON = 'https://games.e2e.test/get-game-json?gameId=';
const VIEW = viewTokenFor(publishKeyFor(GAME_ID, ROOM));

const game = testGame({
  id: GAME_ID,
  room: ROOM,
  name: 'בדיקת במה',
  setting: { limit: { type: 'phones', number: 20 }, hostVideo: true, hostVideoStage: true },
});

const { results, log, check, note } = createReport();

let sfuPage = null;
const cloudflare = fakeCloudflare({
  cf: CF,
  gameJson: GAME_JSON,
  games: new Map([[GAME_ID, game]]),
  sfuPage: () => sfuPage,
});

// ---------------------------------------------------------------- מה רואים בכל דף

/** הבמה אצל צופה: החלונות, ומי מהם מנגן. */
function viewerStage(page) {
  return page.evaluate(() => ({
    shown: document.querySelector('.live-stage') !== null,
    note: document.querySelector('.live-stage-note')?.textContent ?? null,
    camButton: document.querySelector('.live-btn--cam') !== null,
    tiles: [...document.querySelectorAll('.live-stage-tile')].map((t) => {
      const v = t.querySelector('video.is-shown');
      return {
        name: t.querySelector('.live-stage-name')?.textContent ?? '',
        own: t.classList.contains('is-own'),
        mirror: v?.classList.contains('is-mirror') ?? false,
        playing: v !== null && v.videoWidth > 0 && !v.paused,
      };
    }),
  }));
}

/** המצלמה של המשתתף בקישור הצפייה. */
function camBar(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('.live-stage-cam');
    if (bar === null) return null;
    const v = bar.querySelector('video.is-shown');
    return {
      text: bar.querySelector('.live-stage-cam-text')?.textContent ?? '',
      onStage: bar.classList.contains('is-onstage'),
      ended: bar.classList.contains('is-ended'),
      preview: v !== null && v.videoWidth > 0 && !v.paused,
      buttons: [...bar.querySelectorAll('button')].map((b) => b.textContent.trim()),
    };
  });
}

/** חלון ניהול הבמה במסך הראשי. */
function manager(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.stage-manager');
    if (el === null) return null;
    return {
      count: el.querySelector('.stage-manager-count')?.textContent ?? null,
      empty: el.querySelector('.stage-manager-grid-empty') !== null,
      onStage: [...el.querySelectorAll('.stage-chip-name')].map((c) => c.textContent.trim()),
      cards: [...el.querySelectorAll('.stage-card')].map((c) => {
        const v = c.querySelector('video.is-shown');
        return {
          name: c.querySelector('.stage-card-name')?.textContent ?? '',
          on: c.classList.contains('is-on'),
          badge: c.querySelector('.stage-card-badge')?.textContent ?? null,
          playing: v !== null && v.videoWidth > 0 && !v.paused,
        };
      }),
    };
  });
}

/** החלונית הצפה במסך הראשי. */
function stageWindow(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.stage-window');
    const stage = document.querySelector('.stage');
    if (el === null || stage === null) return null;
    const r = el.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    return {
      compact: el.classList.contains('is-compact'),
      text: el.textContent.trim(),
      inside:
        r.left >= s.left - 0.5 &&
        r.top >= s.top - 0.5 &&
        r.right <= s.right + 0.5 &&
        r.bottom <= s.bottom + 0.5,
      tiles: [...el.querySelectorAll('.stage-tile')].map((t) => {
        const v = t.querySelector('video.is-shown');
        return {
          name: t.querySelector('.stage-tile-name')?.textContent ?? '',
          playing: v !== null && v.videoWidth > 0 && !v.paused,
        };
      }),
    };
  });
}

/** כמה חיבורים ב-SFU מעבירים עכשיו מצלמות של משתתפים. */
async function sfuStage() {
  const active = await sfuPage.evaluate(() => window.sfu.active());
  const cams = active.filter((s) => s.names.includes('cam')).map((s) => s.id);
  return {
    cams: cams.length,
    subs: active.filter((s) => !s.publisher && s.remotes.some((r) => cams.includes(r))).length,
  };
}

/** הבקשה האחרונה ל-Cloudflare לצפייה במצלמות: איזו שכבה ביקשו לכל אחת. */
function lastStageSubLayers() {
  const call = [...cloudflare.calls]
    .reverse()
    .find(
      (c) =>
        /tracks\/new$/.test(c.route) &&
        c.body?.tracks?.some((t) => t.location === 'remote' && t.trackName === 'cam'),
    );
  return call?.body.tracks.map((t) => t.simulcast?.preferredRid ?? null) ?? null;
}

/** כל הרכיבים העיקריים של הצופה בתוך החלון (לא נחתכים). */
function layoutProblems(page) {
  return page.evaluate(() => {
    const out = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const selectors = [
      '.live-video',
      '.live-stage',
      '.live-stage-cam',
      '.live-pad-keys',
      '.live-controls',
      '.live-screen-area',
    ];
    for (const sel of selectors) {
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
    const screen = document.querySelector('.live-screen-area')?.getBoundingClientRect();
    for (const sel of ['.live-video', '.live-stage', '.live-stage-cam']) {
      const a = document.querySelector(sel)?.getBoundingClientRect();
      if (!a || !screen) continue;
      const overlap =
        Math.max(0, Math.min(a.right, screen.right) - Math.max(a.left, screen.left)) *
        Math.max(0, Math.min(a.bottom, screen.bottom) - Math.max(a.top, screen.top));
      if (overlap > 4) out.push(`${sel} מכסה את מסך המשחק`);
    }
    return out;
  });
}

/**
 * כמה צפיות במצלמות פתוחות בשרת, אחרי שמתייצב: אחרי שינוי בבמה החיבור הקודם
 * של כל צופה ממשיך עוד כמה שניות (stageReceiver.ts, `overlapMs`).
 */
async function stageViewersSettle(relayBase, expected, ms = 10_000) {
  const end = Date.now() + ms;
  let count = (await relayHealth(relayBase)).video.stageViewers;
  while (count !== expected && Date.now() < end) {
    await sleep(250);
    count = (await relayHealth(relayBase)).video.stageViewers;
  }
  return count;
}

/** המשתתף מדליק מצלמה: הכפתור, השם בחלון, ואישור. */
async function turnOnCam(page, name) {
  await page.locator('.live-btn--cam').click();
  await page.locator('#live-cam-title').waitFor({ timeout: 10_000 });
  await page.locator('.live-join-input').fill(name);
  await page.locator('.live-join-go').click();
}

const cardButton = (page, name, label) =>
  page.locator('.stage-card', { hasText: name }).locator('button', { hasText: label });

// ---------------------------------------------------------------- הבדיקה

async function main() {
  const helper = await startHelper(game);
  const voteServer = `http://127.0.0.1:${helper.port}`;
  const gameUrl = `http://127.0.0.1:${helper.port}/game.json`;

  const relay = startRelay({
    port: 0,
    video: createVideo({
      fetch: cloudflare.fetch,
      env: videoEnv({ cf: CF, gameJson: GAME_JSON }),
      log: (line) => note(`[video] ${line}`),
    }),
  });
  const relayBase = `http://127.0.0.1:${(await relay.ready).port}/live`;

  const { vite, base } = await startViteServer(['**/stage-e2e*/**']);
  const qs = `liveRelay=${encodeURIComponent(relayBase)}&voteServer=${encodeURIComponent(voteServer)}`;
  const hostUrl = `${base}?game=${encodeURIComponent(gameUrl)}&${qs}`;
  const viewUrl = `${base}?view=${VIEW}&${qs}`;

  const browser = await launchBrowser();
  const errors = [];
  const watch = pageWatcher(errors);

  let exitCode = 0;
  try {
    sfuPage = await openSfu(browser, watch);

    // ---- 1. המסך הראשי ----
    const hostContext = await browser.newContext({
      viewport: { width: 1600, height: 900 },
      permissions: ['camera', 'microphone'],
    });
    const host = await hostContext.newPage();
    watch(host, 'host');
    await host.goto(hostUrl);
    await host.getByRole('button', { name: /התחל משחק/ }).click({ timeout: 30_000 });
    await waitFor(host, () => document.querySelector('.host-video-chip') !== null);
    const stageButton = host.locator('.host-video-chip button[title^="במה"]');
    check('בלי וידאו של המנחה — אין כפתור במה בתג', (await stageButton.count()) === 0);
    await host.locator('.host-video-chip button').first().click();
    const hostLive = await waitFor(host, () =>
      document.querySelector('.host-video-chip-state')?.textContent?.includes('🔴'),
    );
    check('הווידאו של המנחה דלוק, ובתג כפתור «👥»', hostLive && (await stageButton.count()) === 1);

    // ---- 2. הצופים, לפני שהבמה נפתחת ----
    const openViewer = async (label, options) => {
      const context = await browser.newContext({ permissions: ['camera'], ...options });
      const page = await context.newPage();
      watch(page, label);
      await page.goto(viewUrl);
      await page.locator('.live-join-watch').click({ timeout: 30_000 });
      await waitFor(page, () => document.querySelector('.live-video.is-playing') !== null);
      return page;
    };
    const ruti = await openViewer('ruti', { viewport: { width: 1440, height: 810 } });
    const watcher = await openViewer('watcher', { viewport: { width: 1440, height: 810 } });
    const dan = await openViewer('dan', {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    await sleep(1000);
    check(
      'במה סגורה — אין כפתור מצלמה בקישור הצפייה',
      !(await viewerStage(ruti)).camButton && !(await viewerStage(dan)).camButton,
    );

    // ---- 3. המנחה פותח מתפריט המפעיל ----
    await host.keyboard.press('Escape');
    const section = await waitFor(host, () => document.querySelector('.stage-panel') !== null);
    const sectionText = await host.evaluate(
      () => document.querySelector('.stage-panel-status')?.textContent ?? '',
    );
    check(
      'תפריט המפעיל: סקציית «במה», סגורה',
      section && sectionText.includes('סגורה'),
      sectionText,
    );
    await host.screenshot({ path: path.join(OUT, '01-host-menu.png') });
    await host.locator('.stage-panel .stage-go').click();
    const opened = await waitFor(
      host,
      () =>
        document.querySelector('.operator-menu') === null &&
        document.querySelector('.stage-manager-grid-empty') !== null,
    );
    check('«פתיחת הבמה» פותחת את חלון הניהול, ריק', opened, JSON.stringify(await manager(host)));
    const camOffered = await waitFor(ruti, () => document.querySelector('.live-btn--cam') !== null);
    check('בקישור הצפייה מופיע «📷 מצלמה»', camOffered);
    await host.screenshot({ path: path.join(OUT, '02-host-manager-empty.png') });

    // ---- 4. שני משתתפים מדליקים מצלמה ----
    await turnOnCam(ruti, 'רותי');
    const rutiLive = await waitFor(ruti, () => {
      const bar = document.querySelector('.live-stage-cam');
      const v = bar?.querySelector('video.is-shown');
      return (
        bar?.textContent?.includes('רק המנחה רואה אתכם') === true && v != null && v.videoWidth > 0
      );
    });
    check('רותי: המצלמה דלוקה, ורק המנחה רואה אותה', rutiLive, JSON.stringify(await camBar(ruti)));
    await waitFor(dan, () => document.querySelector('.live-btn--cam') !== null);
    await turnOnCam(dan, 'דן');
    const danLive = await waitFor(
      dan,
      () => document.querySelector('.live-stage-cam')?.textContent?.includes('רק המנחה') === true,
    );
    check('דן (טלפון): המצלמה דלוקה', danLive, JSON.stringify(await camBar(dan)));
    await dan.screenshot({ path: path.join(OUT, '03-phone-cam-on.png') });

    const twoCards = await waitFor(
      host,
      () => {
        const cards = [...document.querySelectorAll('.stage-card')];
        return (
          cards.length === 2 &&
          cards.every((c) => {
            const v = c.querySelector('video.is-shown');
            return v !== null && v.videoWidth > 0 && !v.paused;
          })
        );
      },
      undefined,
      30_000,
    );
    const m1 = await manager(host);
    check(
      'המנחה רואה את שתי המצלמות, בשמות',
      twoCards &&
        JSON.stringify(m1.cards.map((c) => c.name).sort()) === JSON.stringify(['דן', 'רותי']),
      JSON.stringify(m1),
    );
    check(
      'התצוגה המקדימה של המנחה בשכבה הנמוכה',
      JSON.stringify(lastStageSubLayers()) === JSON.stringify(['b', 'b']),
      JSON.stringify(lastStageSubLayers()),
    );
    check(
      'הצופים עדיין לא רואים אף מצלמה',
      !(await viewerStage(watcher)).shown && (await sfuStage()).subs === 1,
      JSON.stringify(await sfuStage()),
    );
    await host.screenshot({ path: path.join(OUT, '04-host-manager-two.png') });

    // ---- 5. רותי עולה לבמה ----
    await cardButton(host, 'רותי', 'לבמה').click();
    const badge = await waitFor(host, () =>
      [...document.querySelectorAll('.stage-card')].some(
        (c) => c.textContent.includes('רותי') && c.querySelector('.stage-card-badge') !== null,
      ),
    );
    check('בחלון הניהול: רותי על הבמה', badge, JSON.stringify((await manager(host))?.onStage));
    const watcherSees = await waitFor(
      watcher,
      () => {
        const tiles = [...document.querySelectorAll('.live-stage-tile')];
        const v = tiles[0]?.querySelector('video.is-shown');
        return tiles.length === 1 && v != null && v.videoWidth > 0 && !v.paused;
      },
      undefined,
      30_000,
    );
    const w1 = await viewerStage(watcher);
    check(
      'הצופה רואה את רותי על הבמה',
      watcherSees && w1.tiles[0]?.name === 'רותי' && !w1.tiles[0]?.own,
      JSON.stringify(w1),
    );
    check(
      'במה של אחת — הצופה מבקש את השכבה העליונה',
      JSON.stringify(lastStageSubLayers()) === JSON.stringify(['a']),
      JSON.stringify(lastStageSubLayers()),
    );
    const rutiOnStage = await waitFor(
      ruti,
      () =>
        document.querySelector('.live-stage-cam.is-onstage') !== null &&
        [...document.querySelectorAll('.live-stage-tile.is-own video.is-mirror.is-shown')].some(
          (v) => v.videoWidth > 0,
        ),
    );
    check(
      'רותי יודעת שהיא על הבמה, ורואה את עצמה כמו מראה (מהמצלמה, לא מהשרת)',
      rutiOnStage,
      JSON.stringify({ bar: await camBar(ruti), stage: await viewerStage(ruti) }),
    );
    const danSees = await waitFor(
      dan,
      () => {
        const v = document.querySelector('.live-stage-tile video.is-shown');
        return v != null && v.videoWidth > 0;
      },
      undefined,
      30_000,
    );
    check('דן (טלפון) רואה את רותי', danSees, JSON.stringify(await viewerStage(dan)));
    await host.keyboard.press('Escape');
    const windowShown = await waitFor(
      host,
      () => {
        const v = document.querySelector('.stage-window .stage-tile video.is-shown');
        return document.querySelector('.stage-manager') === null && v != null && v.videoWidth > 0;
      },
      undefined,
      30_000,
    );
    const win1 = await stageWindow(host);
    check(
      'ESC סוגר את חלון הניהול, ובמסך הראשי חלונית עם רותי',
      windowShown && win1.inside && win1.tiles[0]?.name === 'רותי',
      JSON.stringify(win1),
    );
    await host.screenshot({ path: path.join(OUT, '05-host-window-one.png') });
    await watcher.screenshot({ path: path.join(OUT, '05-viewer-one.png') });
    await ruti.screenshot({ path: path.join(OUT, '05-ruti-on-stage.png') });

    // ---- 6. דן עולה: בלי רגע שבו הבמה ריקה ----
    await host.locator('.host-video-chip button.is-stage-open').click();
    await waitFor(host, () => document.querySelector('.stage-manager .stage-card') !== null);
    // רותי כבר על הבמה: אצל הצופה החלון שלה מנגן כל הזמן, גם כשהחיבור מתחלף.
    const samples = [];
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        const tile = (await viewerStage(watcher)).tiles.find((t) => t.name === 'רותי');
        samples.push(tile?.playing === true ? 1 : 0);
        await sleep(50);
      }
    })();
    await cardButton(host, 'דן', 'לבמה').click();
    const twoOnStage = await waitFor(
      watcher,
      () =>
        [...document.querySelectorAll('.live-stage-tile video.is-shown')].filter(
          (v) => v.videoWidth > 0 && !v.paused,
        ).length === 2,
      undefined,
      30_000,
    );
    sampling = false;
    await sampler;
    const w2 = await viewerStage(watcher);
    check(
      'הצופה רואה את שניהם, לפי הסדר של המנחה',
      twoOnStage && JSON.stringify(w2.tiles.map((t) => t.name)) === JSON.stringify(['רותי', 'דן']),
      JSON.stringify(w2),
    );
    check(
      'במעבר החלון של רותי לא נעלם אף לרגע',
      samples.length > 0 && samples.every((n) => n === 1),
      `${samples.length} דגימות: ${samples.join('')}`,
    );
    check(
      'במה של שניים — שוב השכבה העליונה',
      JSON.stringify(lastStageSubLayers()) === JSON.stringify(['a']) ||
        JSON.stringify(lastStageSubLayers()) === JSON.stringify(['a', 'a']),
      JSON.stringify(lastStageSubLayers()),
    );
    await host.keyboard.press('Escape');
    const window2 = await waitFor(
      host,
      () =>
        [...document.querySelectorAll('.stage-window .stage-tile video.is-shown')].filter(
          (v) => v.videoWidth > 0,
        ).length === 2,
      undefined,
      30_000,
    );
    check('בחלונית של המסך הראשי שניהם', window2, JSON.stringify(await stageWindow(host)));
    await host.screenshot({ path: path.join(OUT, '06-host-window-two.png') });
    await watcher.screenshot({ path: path.join(OUT, '06-viewer-two.png') });

    // ---- 7. החלונית: מזעור ופתיחה ----
    // צופה אחד, רותי ודן (כל אחד רואה את השני) והחלונית במסך הראשי
    const before = await stageViewersSettle(relayBase, 4);
    await host.locator('.stage-window').hover();
    await host.locator('.stage-window button[title="מזעור"]').click();
    const minimized = await waitFor(host, () =>
      document.querySelector('.stage-window.is-compact')?.textContent?.includes('הבמה · 2'),
    );
    const after = await stageViewersSettle(relayBase, 3);
    check(
      'מזעור: כפתור «👥 הבמה · 2», והמסך הראשי מפסיק לקבל את המצלמות',
      minimized && before === 4 && after === 3,
      JSON.stringify({ before, after }),
    );
    await host.locator('.stage-window').click();
    const restored = await waitFor(
      host,
      () =>
        [...document.querySelectorAll('.stage-window .stage-tile video.is-shown')].filter(
          (v) => v.videoWidth > 0,
        ).length === 2,
      undefined,
      30_000,
    );
    check('לחיצה על הכפתור פותחת את החלונית, עם שניהם', restored);

    // ---- 8. צופה מסתיר את הבמה ----
    const beforeHide = await stageViewersSettle(relayBase, 4);
    await watcher.locator('.live-stage-hide').click();
    const hidden = await waitFor(watcher, () => document.querySelector('.live-stage') === null);
    const afterHide = await stageViewersSettle(relayBase, 3);
    check(
      'הסתרה סוגרת את החיבור של הצופה לבמה',
      hidden && beforeHide === 4 && afterHide === 3,
      JSON.stringify({ beforeHide, afterHide }),
    );
    const showStage = watcher.locator('.live-btn', { hasText: 'הבמה' });
    check('כפתור «👥 הבמה» מופיע', (await showStage.count()) === 1);
    await showStage.click();
    const back = await waitFor(
      watcher,
      () =>
        [...document.querySelectorAll('.live-stage-tile video.is-shown')].filter(
          (v) => v.videoWidth > 0,
        ).length === 2,
      undefined,
      30_000,
    );
    check('הבמה חוזרת', back);

    // ---- 9. טלפון לאורך: הכול בתוך החלון ----
    await dan.locator('.live-btn--play').click();
    await dan.locator('.live-join-input').fill('דן');
    await dan.locator('.live-join-go').click();
    await waitFor(dan, () => document.querySelector('.live-pad') !== null);
    await waitFor(
      dan,
      () =>
        [...document.querySelectorAll('.live-stage-tile video.is-shown')].filter(
          (v) => v.videoWidth > 0,
        ).length === 2,
    );
    await sleep(300);
    const phone = await layoutProblems(dan);
    check(
      'טלפון לאורך: וידאו המנחה, הבמה, המצלמה שלי והשלט בתוך החלון',
      phone.length === 0,
      phone.join('; '),
    );
    await dan.screenshot({ path: path.join(OUT, '07-phone-stage-pad.png') });
    const desktop = await layoutProblems(watcher);
    check('מחשב: הבמה בתוך החלון', desktop.length === 0, desktop.join('; '));

    // ---- 10. המנחה מכבה את דן ----
    await host.locator('.host-video-chip button.is-stage-open').click();
    await cardButton(host, 'דן', 'כיבוי').click();
    await cardButton(host, 'דן', 'כן, לכבות').click();
    const blocked = await waitFor(dan, () =>
      document.querySelector('.live-stage-cam')?.textContent?.includes('כובתה על ידי המנחה'),
    );
    const bar1 = await camBar(dan);
    check(
      'דן רואה שהמנחה כיבה את המצלמה, בלי «נסו שוב»',
      blocked && !bar1.buttons.includes('נסו שוב'),
      JSON.stringify(bar1),
    );
    const danGone = await waitFor(
      watcher,
      () => {
        const names = [...document.querySelectorAll('.live-stage-name')].map((n) => n.textContent);
        return names.length === 1 && names[0] === 'רותי';
      },
      undefined,
      30_000,
    );
    const m2 = await manager(host);
    check(
      'דן יורד אצל כולם, ומהרשימה של המנחה',
      danGone && m2.cards.length === 1 && m2.cards[0].name === 'רותי',
      JSON.stringify({ watcher: await viewerStage(watcher), manager: m2 }),
    );
    await dan.locator('.live-stage-cam button', { hasText: 'סגירה' }).click();
    await waitFor(dan, () => document.querySelector('.live-btn--cam') !== null);
    await turnOnCam(dan, 'דן');
    const stillBlocked = await waitFor(dan, () =>
      document.querySelector('.live-stage-cam')?.textContent?.includes('כובתה על ידי המנחה'),
    );
    await sleep(1500);
    check(
      'דן מנסה להדליק שוב — עדיין כבויה',
      stillBlocked && (await manager(host)).cards.length === 1,
      JSON.stringify(await camBar(dan)),
    );

    // ---- 11. המנחה סוגר את הבמה ----
    await host.locator('.stage-manager-header button', { hasText: 'סגירת הבמה' }).click();
    const closedHere = await waitFor(
      host,
      () =>
        document.querySelector('.stage-manager-closed') !== null &&
        document.querySelector('.stage-window') === null,
    );
    check('במסך הראשי: הבמה סגורה והחלונית נעלמה', closedHere);
    const rutiEnded = await waitFor(ruti, () =>
      document.querySelector('.live-stage-cam')?.textContent?.includes('הבמה נסגרה'),
    );
    check('רותי: «הבמה נסגרה, והמצלמה כבתה»', rutiEnded, JSON.stringify(await camBar(ruti)));
    const watcherClosed = await waitFor(
      watcher,
      () =>
        document.querySelector('.live-stage') === null &&
        document.querySelector('.live-btn--cam') === null,
    );
    check('אצל הצופה הבמה וכפתור המצלמה נעלמים', watcherClosed);
    await stageViewersSettle(relayBase, 0);
    const health = (await relayHealth(relayBase)).video;
    const quiet = await waitFor(
      sfuPage,
      () => {
        const active = window.sfu.active();
        return !active.some((s) => s.names.includes('cam'));
      },
      undefined,
      20_000,
    );
    check(
      'בשרת ובכל Cloudflare: אין במה, אין מצלמות ואין צפיות בהן',
      quiet && health.stages === 0 && health.cams === 0 && health.stageViewers === 0,
      JSON.stringify({ health, sfu: await sfuStage() }),
    );
    check(
      'וידאו המנחה ממשיך',
      await waitFor(watcher, () => document.querySelector('.live-video.is-playing') !== null),
    );
    await ruti.screenshot({ path: path.join(OUT, '08-ruti-closed.png') });

    check('בלי שגיאות בדפים', errors.length === 0, errors.slice(0, 5).join(' | '));
  } catch (err) {
    check('הבדיקה רצה עד הסוף', false, err?.stack ?? String(err));
  } finally {
    fs.writeFileSync(
      path.join(OUT, 'log.txt'),
      `${log.join('\n')}\n\n${JSON.stringify(
        cloudflare.calls.map((c) => `${c.method} ${c.route}`),
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
