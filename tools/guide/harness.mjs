/**
 * תשתית להקלטת מדריכי הווידאו של התוכנה.
 *
 * הרעיון: לא מצלמים מסך ולא מציירים מוקאפים — מריצים את **הבנייה האמיתית**
 * (dist/) בדפדפן, נוהגים בה כמו משתמש, ומקליטים. מעליה מוזרקת שכבת הדרכה
 * (כותרת, כיתובית, סמן עכבר וטבעת הדגשה) שאינה חלק מהתוכנה. כך המדריך אינו
 * יכול "להתיישן" מול המסכים — הוא מצולם מהם.
 *
 * גשר ה-Electron מדומה (window.triviaDesktop), כך שאפשר להראות ריסיבר
 * שמתחבר, שלטים שנלחצים ושמירה לקובץ — בלי חומרה.
 *
 * הרצה: node tools/guide/record.mjs [שם-פרק]
 */

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../..');
export const DIST = join(ROOT, 'dist');
export const OUT = join(ROOT, 'public/guide');

const SIZE = { width: 1280, height: 720 };
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

/** שרת סטטי לבנייה — file:// חוסם חלק מה-API של הדפדפן. */
function serveDist() {
  const srv = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    let file = join(DIST, path === '/' ? '/index.html' : path);
    if (!existsSync(file) || path === '/') file = join(DIST, 'index.html');
    res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

/** שכבת ההדרכה — נבנית מחוץ ל-#root כדי ש-React לא יגע בה. */
const OVERLAY = `
(() => {
  if (document.getElementById('guide-layer')) return;
  const el = document.createElement('div');
  el.id = 'guide-layer';
  el.dir = 'rtl';
  el.innerHTML = \`
    <style>
      #guide-layer { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none;
        font-family: 'Kanuba','Heebo','Assistant','Segoe UI',system-ui,sans-serif; }
      #guide-chapter { position: absolute; top: 0; inset-inline: 0; display: flex; align-items: center;
        gap: 12px; padding: 12px 26px; background: linear-gradient(180deg, rgba(12,8,26,.92), rgba(12,8,26,0));
        color: #fff; font-size: 21px; font-weight: 800; opacity: 0; transition: opacity .35s; }
      #guide-chapter .n { background: #6c5ce7; border-radius: 999px; padding: 3px 14px; font-size: 18px; }
      #guide-caption { position: absolute; bottom: 34px; inset-inline: 60px; margin: 0 auto; max-width: 1000px;
        background: rgba(12,8,26,.93); color: #fff; border-radius: 16px; padding: 18px 28px;
        font-size: 27px; font-weight: 700; line-height: 1.5; text-align: center;
        box-shadow: 0 12px 40px rgba(0,0,0,.45); opacity: 0; transform: translateY(14px);
        transition: opacity .3s, transform .3s; white-space: pre-wrap; }
      #guide-caption.on { opacity: 1; transform: none; }
      #guide-ring { position: absolute; border: 4px solid #ffd23f; border-radius: 14px;
        box-shadow: 0 0 0 4000px rgba(8,5,18,.45), 0 0 22px rgba(255,210,63,.9);
        opacity: 0; transition: all .45s cubic-bezier(.4,0,.2,1); }
      #guide-ring.on { opacity: 1; }
      #guide-cursor { position: absolute; width: 26px; height: 26px; margin: -4px 0 0 -4px;
        opacity: 0; transition: transform .55s cubic-bezier(.4,0,.2,1), opacity .3s; }
      #guide-cursor.on { opacity: 1; }
      #guide-cursor svg { filter: drop-shadow(0 2px 5px rgba(0,0,0,.55)); }
      #guide-cursor.tap::after { content: ''; position: absolute; inset: -14px; border-radius: 50%;
        border: 3px solid #ffd23f; animation: guide-tap .5s ease-out; }
      @keyframes guide-tap { from { transform: scale(.35); opacity: 1; } to { transform: scale(1.5); opacity: 0; } }
      #guide-card { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 18px;
        align-items: center; justify-content: center; text-align: center; color: #fff;
        background: linear-gradient(135deg, #241d3d, #4b2e86 55%, #241d3d); opacity: 0; transition: opacity .45s; }
      #guide-card.on { opacity: 1; }
      #guide-card .t { font-size: 62px; font-weight: 900; }
      #guide-card .s { font-size: 30px; opacity: .85; max-width: 900px; line-height: 1.5; }
      #guide-card .k { font-size: 22px; opacity: .6; letter-spacing: .12em; }
    </style>
    <div id="guide-chapter"><span class="n"></span><span class="t"></span></div>
    <div id="guide-ring"></div>
    <div id="guide-cursor"><svg viewBox="0 0 24 24" width="26" height="26">
      <path d="M4 2l7.5 18 2.2-7.3L21 10.5z" fill="#fff" stroke="#1b1430" stroke-width="1.6" stroke-linejoin="round"/>
    </svg></div>
    <div id="guide-caption"></div>
    <div id="guide-card"><div class="t"></div><div class="s"></div><div class="k"></div></div>
  \`;
  document.body.appendChild(el);
  const $ = (s) => el.querySelector(s);
  window.__guideUI = {
    chapter(n, t) {
      // מוצג בפתיחת הפרק ונעלם — התוכנה מציגה הודעות משלה בראש המסך, ופס
      // קבוע שם היה מסתיר בדיוק את ההודעות שהמדריך בא להסביר.
      const bar = $('#guide-chapter');
      bar.querySelector('.n').textContent = n;
      bar.querySelector('.t').textContent = t;
      bar.style.opacity = t ? '1' : '0';
      clearTimeout(window.__guideBarT);
      if (t) window.__guideBarT = setTimeout(() => { bar.style.opacity = '0'; }, 7000);
    },
    caption(text) {
      const c = $('#guide-caption');
      if (!text) { c.classList.remove('on'); return; }
      c.textContent = text;
      c.classList.add('on');
    },
    card(t, s, k) {
      const c = $('#guide-card');
      if (t === null) { c.classList.remove('on'); return; }
      c.querySelector('.t').textContent = t;
      c.querySelector('.s').textContent = s ?? '';
      c.querySelector('.k').textContent = k ?? '';
      c.classList.add('on');
    },
    ring(rect) {
      const r = $('#guide-ring');
      if (!rect) { r.classList.remove('on'); return; }
      const pad = rect.pad ?? 8;
      r.style.left = (rect.x - pad) + 'px';
      r.style.top = (rect.y - pad) + 'px';
      r.style.width = (rect.width + pad * 2) + 'px';
      r.style.height = (rect.height + pad * 2) + 'px';
      r.classList.add('on');
    },
    cursor(x, y, tap) {
      const c = $('#guide-cursor');
      if (x === null) { c.classList.remove('on'); return; }
      c.classList.add('on');
      c.style.transform = \`translate(\${x}px, \${y}px)\`;
      if (tap) { c.classList.remove('tap'); void c.offsetWidth; c.classList.add('tap'); }
    },
  };
})();
`;

/**
 * גשר Electron מדומה. נשלט מהסקריפט דרך window.__desk — כך אפשר להראות
 * ריסיבר שמתחבר ושלטים שנלחצים בלי חומרה מחוברת.
 */
function bridgeScript(zipB64, opts) {
  return `
(() => {
  const bin = atob(${JSON.stringify(zipB64)});
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const subs = { clicker: [], receiver: [], server: [], win: [], update: [], download: [] };
  const fan = (k) => (cb) => { subs[k].push(cb); return () => { subs[k] = subs[k].filter((f) => f !== cb); }; };
  window.__desk = {
    clicker: (ev) => subs.clicker.forEach((f) => f(ev)),
    receiver: (info) => subs.receiver.forEach((f) => f(info)),
    server: (info) => subs.server.forEach((f) => f(info)),
    press: (remoteId, button = 1) => subs.clicker.forEach((f) => f({ type: 'key', button, remoteId })),
    saves: [],
    launched: 0,
  };
  window.triviaDesktop = {
    isDesktop: true,
    platform: 'win32',
    onClicker: fan('clicker'),
    onReceiver: fan('receiver'),
    onClickerServer: fan('server'),
    onWindowState: fan('win'),
    onUpdateStatus: fan('update'),
    onDownloadProgress: fan('download'),
    downloadGameByCode: () => Promise.resolve({ ok: false, error: 'הדגמה בלבד' }),
    launchReceiver: () => { window.__desk.launched++; },
    showReceiver: () => {},
    stopReceiver: () => {},
    setWindowFullscreen: () => {},
    minimizeWindow: () => {},
    getSealedGame: () => Promise.resolve(null),
    getLastGame: () => Promise.resolve(${opts.lastGame ? '{ name: "משחק לדוגמה.zip", bytes }' : 'null'}),
    rememberGame: () => {},
    forgetGame: () => {},
    backupSave: () => Promise.resolve(true),
    backupLoad: () => Promise.resolve(null),
    backupClear: () => {},
    saveReport: () => Promise.resolve('x'),
    openReports: () => {},
    quit: () => {},
    sealMode: () => Promise.resolve({ capable: false, tool: false }),
    appVersion: () => Promise.resolve('1.0.0'),
    saveEditedGame: (json) => { window.__desk.saves.push(JSON.parse(json)); return Promise.resolve({ ok: true, addedMedia: 0 }); },
  };
})();
`;
}

/**
 * פותח דפדפן מוקלט עם התוכנה טעונה, ומחזיר את ה-API להנחיית ההקלטה.
 * @param {{slug:string,index:string,name:string,zipB64:string,lastGame?:boolean,query?:string}} cfg
 */
export async function openGuide(cfg) {
  mkdirSync(OUT, { recursive: true });
  const raw = join(OUT, '.raw', cfg.slug);
  rmSync(raw, { recursive: true, force: true });
  const srv = await serveDist();
  const app = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    headless: true,
    args: ['--force-prefers-reduced-motion=0'],
  });
  const ctx = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 1,
    recordVideo: { dir: raw, size: SIZE },
  });
  await ctx.addInitScript(bridgeScript(cfg.zipB64, { lastGame: cfg.lastGame !== false }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => void d.accept());
  await page.goto(`${app}/${cfg.query ?? ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.game-root', { timeout: 15000 });
  await page.evaluate(OVERLAY);

  /** השכבה נבנית מחדש אחרי ניווט/רענון — מוודאים שהיא שם לפני כל שימוש. */
  const ui = async (fn, ...args) => {
    await page.evaluate(OVERLAY);
    return page.evaluate(fn, ...args);
  };

  const api = {
    page,
    errors,

    /** כרטיס פתיחה/סיום במסך מלא. */
    async card(title, sub, key, ms = 3000) {
      await ui(([t, s, k]) => window.__guideUI.card(t, s, k), [title, sub, key]);
      await page.waitForTimeout(ms);
    },
    async cardOff() {
      await ui(() => window.__guideUI.card(null));
      await page.waitForTimeout(500);
    },

    /** פס הכותרת העליון — נשאר לאורך הפרק. */
    async chapter(text) {
      await ui(([n, t]) => window.__guideUI.chapter(n, t), [cfg.index, text]);
    },

    /** כיתובית. ‎ms‎ ברירת מחדל נגזר מאורך הטקסט כדי שיהיה זמן לקרוא. */
    async say(text, ms) {
      await ui((t) => window.__guideUI.caption(t), text);
      await page.waitForTimeout(ms ?? Math.min(9000, 1700 + text.length * 62));
    },
    async sayOff() {
      await ui(() => window.__guideUI.caption(''));
      await page.waitForTimeout(300);
    },

    /** מדגיש אלמנט ומזיז אליו את הסמן. */
    async point(selector, opts = {}) {
      const box = await page.locator(selector).first().boundingBox();
      if (!box) throw new Error(`אין אלמנט להדגשה: ${selector}`);
      await ui(([b, pad]) => {
        window.__guideUI.ring({ ...b, pad });
        window.__guideUI.cursor(b.x + b.width / 2, b.y + b.height / 2, false);
      }, [box, opts.pad ?? 8]);
      await page.waitForTimeout(opts.hold ?? 900);
      return box;
    },
    /** כמו point, אבל מדלג בשקט אם הרכיב אינו קיים בתצורה הזו. */
    async pointMaybe(selector, opts = {}) {
      if ((await page.locator(selector).count()) === 0) return false;
      await api.point(selector, opts);
      return true;
    },
    async pointOff() {
      await ui(() => { window.__guideUI.ring(null); window.__guideUI.cursor(null); });
      await page.waitForTimeout(300);
    },

    /** מצביע, "מקליק" ואז לוחץ באמת. */
    async click(selector, opts = {}) {
      await api.point(selector, opts);
      await ui(([b]) => window.__guideUI.cursor(b.x + b.width / 2, b.y + b.height / 2, true),
        [await page.locator(selector).first().boundingBox()]);
      await page.waitForTimeout(320);
      await page.locator(selector).first().click({ timeout: 10000 });
      await page.waitForTimeout(opts.after ?? 700);
    },

    /** הקלדה איטית וקריאה לתוך שדה. */
    async type(selector, text, opts = {}) {
      await api.point(selector, opts);
      await page.locator(selector).first().click();
      await page.locator(selector).first().fill('');
      await page.locator(selector).first().type(text, { delay: opts.delay ?? 55 });
      await page.waitForTimeout(opts.after ?? 600);
    },

    async wait(ms) {
      await page.waitForTimeout(ms);
    },

    /** סוגר, ומעביר את ההקלטה לשם קבוע. */
    async finish() {
      await page.waitForTimeout(900);
      const video = page.video();
      await ctx.close();
      await browser.close();
      srv.close();
      const target = join(OUT, `${cfg.slug}.webm`);
      if (video) {
        const src = await video.path();
        rmSync(target, { force: true });
        renameSync(src, target);
      } else {
        // גיבוי: לוקחים את הקובץ היחיד שנוצר בתיקייה
        const files = readdirSync(raw).filter((f) => f.endsWith('.webm'));
        if (files[0]) { rmSync(target, { force: true }); renameSync(join(raw, files[0]), target); }
      }
      rmSync(raw, { recursive: true, force: true });
      if (errors.length > 0) console.log(`  ⚠ שגיאות בדף: ${errors.slice(0, 3).join(' | ')}`);
      return target;
    },
  };

  await api.chapter(cfg.name);
  return api;
}
