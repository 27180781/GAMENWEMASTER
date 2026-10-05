#!/usr/bin/env node
/**
 * צילומי מטריצה: כל מסך × כל ערכת נושא × כל ערכת צבעים, מגלריית המסכים
 * (gallery.html), עם בדיקות אוטומטיות לכל צילום.
 *
 *   npm run shots                                   # הכול
 *   npm run shots -- --themes=glass --colors=default --screens=lobby,question-8
 *   npm run shots -- --bg=sample                    # רקע צבעוני עמוס (בדיקת קריאות)
 *   npm run shots -- --bg=./my-background.jpg       # או כל קובץ/כתובת
 *
 * פלט: theme-shots/<theme>/<colors>/<screen>.png, דף מגע לכל ערכה+צבעים
 * (theme-shots/<theme>-<colors>.png) ו-theme-shots/report.json. קוד יציאה 1 אם
 * בדיקה כלשהי נכשלה.
 *
 * הבדיקות:
 *   overflow — אלמנט גלוי שחורג מגבולות הבמה (1920×1080) אחרי חיתוך ההורים.
 *              אלמנט שכולו מחוץ לבמה נחשב "מחוץ לבמה בכוונה" ואינו נספר.
 *   overlap  — טקסט/תמונת שאלה או כרטיס תשובה שמכוסים ע"י אלמנט אחר באותו מסך
 *              שאלה (באג פריסה; כיסוי ע"י שכבת overlay אינו נספר).
 *   fit      — FitText (‎[data-fit-text]‎) שהתוכן שלו עדיין גולש מהקופסה.
 *   contrast — יחס ניגודיות WCAG של טקסט השאלה/התשובות/שקופית הטקסט מול מה
 *              שמצויר מתחתיו בפועל (צילום שני כשהטקסט שקוף, דגימת פיקסלים —
 *              כך גם רקע מדורג/תמונה נמדד). האחוזון ה-10 של הדגימות, סף 3:1.
 *              תשובות מעומעמות בכוונה (‎.q-card--dim‎) אינן נבדקות.
 *   console  — שגיאות קונסול / שגיאות דף.
 *
 * דפדפן: playwright-core עם Chromium המותקן (/opt/pw-browsers/chromium אם קיים,
 * אחרת CHROMIUM_PATH או ערוץ chrome). לעולם לא מריץ playwright install.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STAGE_W = 1920;
const STAGE_H = 1080;
const CONTRAST_MIN = 3;
const CONCURRENCY = Number(process.env.SHOTS_CONCURRENCY ?? 4);

// ---------------------------------------------------------------------------
// ארגומנטים
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (m) out[m[1]] = m[2] ?? 'true';
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const list = (v) => (v === undefined || v === '' ? null : v.split(',').map((s) => s.trim()).filter(Boolean));
const OUT_DIR = resolve(ROOT, args.out ?? 'theme-shots');

/** --bg: כתובת http(s), 'sample' (רקע הדוגמה העמוס), או נתיב לקובץ מקומי. */
function resolveBg(value, allow) {
  if (value === undefined || value === '') return '';
  if (value === 'sample' || /^https?:\/\//.test(value)) return value;
  const abs = resolve(process.cwd(), value);
  if (!existsSync(abs)) throw new Error(`--bg: הקובץ לא נמצא: ${abs}`);
  allow.push(dirname(abs));
  return `/@fs${abs}`;
}

// ---------------------------------------------------------------------------
// בדיקות בתוך הדף
// ---------------------------------------------------------------------------

/** רץ בדף: חריגה מהבמה + FitText שגולש. */
function pageChecks() {
  const stage = document.querySelector('.stage');
  if (!stage) return { overflow: ['אין .stage בדף'], fit: [] };
  const sr = stage.getBoundingClientRect();
  const tol = 2;
  const visible = (el) =>
    el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
  const describe = (el) => {
    const cls = typeof el.className === 'string' && el.className.trim() !== '' ? '.' + el.className.trim().split(/\s+/).join('.') : '';
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 28);
    return `${el.tagName.toLowerCase()}${cls}${text ? ` "${text}"` : ''}`;
  };

  const overflow = [];
  const flagged = new Set();
  for (const el of stage.querySelectorAll('*')) {
    if (el.closest('.screen-background')) continue;
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    let l = r.left;
    let t = r.top;
    let rr = r.right;
    let b = r.bottom;
    for (let a = el.parentElement; a && a !== stage; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const ar = a.getBoundingClientRect();
      if (cs.overflowX !== 'visible') {
        l = Math.max(l, ar.left);
        rr = Math.min(rr, ar.right);
      }
      if (cs.overflowY !== 'visible') {
        t = Math.max(t, ar.top);
        b = Math.min(b, ar.bottom);
      }
    }
    if (rr - l < 1 || b - t < 1) continue; // נחתך לגמרי בתוך הורה
    const intersects = rr > sr.left && l < sr.right && b > sr.top && t < sr.bottom;
    if (!intersects) continue; // כולו מחוץ לבמה — בכוונה
    const over = l < sr.left - tol || t < sr.top - tol || rr > sr.right + tol || b > sr.bottom + tol;
    if (!over) continue;
    const parentFlagged = el.parentElement !== null && flagged.has(el.parentElement);
    flagged.add(el);
    if (parentFlagged) continue;
    overflow.push(
      `${describe(el)} [${Math.round(l - sr.left)},${Math.round(t - sr.top)} → ${Math.round(rr - sr.left)},${Math.round(b - sr.top)}]`,
    );
  }

  const fit = [];
  for (const el of stage.querySelectorAll('[data-fit-text]')) {
    if (!visible(el)) continue;
    if (el.clientWidth === 0 && el.clientHeight === 0) continue; // inline — אין קופסה
    if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) {
      fit.push(`${describe(el)} ${el.scrollWidth}×${el.scrollHeight} > ${el.clientWidth}×${el.clientHeight}`);
    }
  }
  // טקסט שאלה/תשובה שמכוסה ע"י אלמנט אחר *באותו מסך שאלה* (למשל שורת תשובות
  // שנדחקה מתחת לפס התחתון) — באג פריסה. כיסוי ע"י שכבה (טבלה/הגרלה) אינו נספר.
  const overlap = [];
  for (const el of stage.querySelectorAll('.q-question-text, .q-card-text, .q-question-main-image, .q-card')) {
    if (!visible(el)) continue;
    const screen = el.closest('.q-screen');
    if (screen === null) continue;
    const r = el.getBoundingClientRect();
    for (const [fx, fy] of [[0.5, 0.5], [0.2, 0.5], [0.8, 0.5], [0.5, 0.85]]) {
      const top = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
      if (top === null || el.contains(top) || top.contains(el)) continue;
      if (top.closest('.q-screen') !== screen) continue;
      // שכנים בתוך אותו כרטיס (מטבע, מונה חי) — חלק מהעיצוב
      const card = el.closest('.q-card');
      if (card !== null && card.contains(top)) continue;
      overlap.push(`${describe(el)} מכוסה ע"י ${describe(top)}`);
      break;
    }
  }
  return { overflow, fit, overlap };
}

const CONTRAST_SELECTOR = ':is(.q-question-text, .q-card-text, .subject-text)';
const PROBE_CSS = `.__contrast-probe ${CONTRAST_SELECTOR} {
  color: transparent !important; -webkit-text-fill-color: transparent !important;
  text-shadow: none !important; -webkit-text-stroke: 0 !important;
}`;

/** רץ בדף: הטקסט (שקוף כרגע) מול פיקסלי הצילום שבו הוא מוסתר. */
async function contrastCheck({ png, selector, textColors }) {
  const img = new Image();
  img.src = `data:image/png;base64,${png}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);

  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = (r, gg, b) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
  const els = [...document.querySelectorAll(`.stage ${selector}`)];
  const results = [];
  els.forEach((el, i) => {
    if (el.closest('.q-card--dim')) return;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return;
    const label = el.className.split(/\s+/)[0];
    // מוסתר מתחת לשכבה אחרת (overlay של טבלה/הגרלה וכו') — לא נראה, לא נמדד
    const br = el.getBoundingClientRect();
    const top = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
    if (top === null || !(el.contains(top) || top.contains(el))) return;
    const color = textColors[i];
    if (color === null) {
      results.push({ label, ratio: null, why: 'צבע טקסט לא ניתן לחישוב' });
      return;
    }
    let op = 1;
    for (let a = el; a; a = a.parentElement) op *= Number(getComputedStyle(a).opacity);
    const alpha = color.a * op;
    const r = el.getBoundingClientRect();
    const l = Math.max(0, Math.floor(r.left + 2));
    const t = Math.max(0, Math.floor(r.top + 2));
    const w = Math.min(canvas.width, Math.ceil(r.right - 2)) - l;
    const h = Math.min(canvas.height, Math.ceil(r.bottom - 2)) - t;
    if (w < 2 || h < 2) return;
    const data = g.getImageData(l, t, w, h).data;
    const ratios = [];
    const nx = Math.min(40, w);
    const ny = Math.min(12, h);
    for (let yi = 0; yi < ny; yi++) {
      for (let xi = 0; xi < nx; xi++) {
        const x = Math.floor(((xi + 0.5) / nx) * w);
        const y = Math.floor(((yi + 0.5) / ny) * h);
        const o = (y * w + x) * 4;
        const br = data[o];
        const bg = data[o + 1];
        const bb = data[o + 2];
        const tr = color.r * alpha + br * (1 - alpha);
        const tg = color.g * alpha + bg * (1 - alpha);
        const tb = color.b * alpha + bb * (1 - alpha);
        const l1 = lum(tr, tg, tb);
        const l2 = lum(br, bg, bb);
        ratios.push((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05));
      }
    }
    ratios.sort((a, b) => a - b);
    results.push({ label, ratio: ratios[Math.floor(ratios.length * 0.1)] ?? null });
  });
  return results;
}

/** צבעי הטקסט המחושבים (לפני ההסתרה). null = לא rgb/rgba (למשל טקסט בגרדיאנט). */
function textColorsOf(selector) {
  return [...document.querySelectorAll(`.stage ${selector}`)].map((el) => {
    const cs = getComputedStyle(el);
    if (cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text') return null;
    const fill = cs.webkitTextFillColor && cs.webkitTextFillColor !== cs.color ? cs.webkitTextFillColor : cs.color;
    const m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(fill);
    if (m) {
      let a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : Number(m[4]);
      return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a };
    }
    const c = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/.exec(fill);
    if (c) {
      return { r: Number(c[1]) * 255, g: Number(c[2]) * 255, b: Number(c[3]) * 255, a: c[4] === undefined ? 1 : Number(c[4]) };
    }
    return null;
  });
}

// ---------------------------------------------------------------------------
// צילום יחיד
// ---------------------------------------------------------------------------

async function shoot(page, baseUrl, job) {
  const errors = [];
  const onConsole = (msg) => {
    if (msg.type() === 'error') errors.push(msg.text().slice(0, 160));
  };
  const onPageError = (err) => errors.push(`pageerror: ${String(err.message ?? err).slice(0, 160)}`);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  try {
    const q = new URLSearchParams({ screen: job.screen, theme: job.theme, colors: job.colors, freeze: '1' });
    if (job.bg !== '') q.set('bg', job.bg);
    const url = `${baseUrl}gallery.html?${q}`;
    let ready = false;
    for (let attempt = 0; attempt < 2 && !ready; attempt++) {
      try {
        await page.goto(url, { waitUntil: 'load' });
        await page.waitForFunction(() => document.documentElement.dataset.galleryReady === '1', null, {
          timeout: 20000,
        });
        ready = true;
      } catch (err) {
        if (attempt === 1) throw err; // ניסיון שני — למשל אחרי טעינה מחדש של אופטימיזציית תלויות
      }
    }

    const { overflow, fit, overlap } = await page.evaluate(pageChecks);
    mkdirSync(dirname(job.file), { recursive: true });
    await page.screenshot({ path: job.file });

    const textColors = await page.evaluate(textColorsOf, CONTRAST_SELECTOR);
    let contrast = [];
    if (textColors.length > 0) {
      await page.evaluate(() => document.documentElement.classList.add('__contrast-probe'));
      const png = (await page.screenshot()).toString('base64');
      await page.evaluate(() => document.documentElement.classList.remove('__contrast-probe'));
      contrast = await page.evaluate(contrastCheck, { png, selector: CONTRAST_SELECTOR, textColors });
    }
    return { ...job, overflow, fit, overlap, contrast, errors };
  } catch (err) {
    return { ...job, overflow: [], fit: [], overlap: [], contrast: [], errors: [...errors, `shot failed: ${err.message}`] };
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }
}

function verdict(r) {
  const ratios = r.contrast.map((c) => c.ratio).filter((x) => x !== null);
  const minRatio = ratios.length > 0 ? Math.min(...ratios) : null;
  const contrastFail = minRatio !== null && minRatio < CONTRAST_MIN;
  const fail = r.overflow.length > 0 || r.fit.length > 0 || r.overlap.length > 0 || contrastFail || r.errors.length > 0;
  return { minRatio, contrastFail, fail };
}

// ---------------------------------------------------------------------------
// דף מגע
// ---------------------------------------------------------------------------

async function contactSheet(page, baseUrl, theme, colors, results) {
  const cells = results
    .map((r) => {
      const v = verdict(r);
      const src = `${baseUrl}${relative(ROOT, r.file).split('\\').join('/')}?t=${Date.now()}`;
      return `<figure class="${v.fail ? 'fail' : 'ok'}"><img src="${src}"><figcaption>${r.screen}${
        v.fail ? ' ✗' : ''
      }</figcaption></figure>`;
    })
    .join('');
  const html = `<!doctype html><html dir="ltr"><head><meta charset="utf-8"><style>
    body{margin:0;padding:20px;background:#1e1e24;color:#eee;font:16px system-ui,sans-serif}
    h1{margin:0 0 14px;font-size:24px}
    .grid{display:grid;grid-template-columns:repeat(5,480px);gap:14px}
    figure{margin:0;background:#2b2b33;border-radius:8px;overflow:hidden;border:3px solid #2b2b33}
    figure.fail{border-color:#e5484d}
    img{display:block;width:480px;height:270px}
    figcaption{padding:6px 10px;font-weight:600}
    figure.fail figcaption{color:#ff8b8e}
  </style></head><body><h1>theme: ${theme} · colors: ${colors}</h1><div class="grid">${cells}</div></body></html>`;
  await page.setViewportSize({ width: 2500, height: 800 });
  await page.goto(`${baseUrl}gallery.html`); // אותו מקור — כדי שהתמונות ייטענו מהשרת
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? null : i.decode().catch(() => null)))));
  const file = resolve(OUT_DIR, `${theme}-${colors}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await page.setViewportSize({ width: STAGE_W, height: STAGE_H });
  return file;
}

// ---------------------------------------------------------------------------
// ריצה
// ---------------------------------------------------------------------------

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

async function main() {
  const allow = [ROOT];
  const bg = resolveBg(args.bg, allow);

  const server = await createServer({
    root: ROOT,
    logLevel: 'warn',
    clearScreen: false,
    server: {
      host: '127.0.0.1',
      port: 5300,
      strictPort: false,
      fs: { allow },
      watch: { ignored: ['**/theme-shots/**', '**/release/**', '**/dist/**'] },
    },
  });
  await server.listen();
  const baseUrl = (server.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${server.config.server.port}/`).replace(/\/?$/, '/');

  const executablePath = existsSync('/opt/pw-browsers/chromium')
    ? '/opt/pw-browsers/chromium'
    : process.env.CHROMIUM_PATH;
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : { channel: 'chrome' }),
    args: ['--font-render-hinting=none', '--disable-gpu-vsync'],
  });
  let exitCode = 0;
  try {
    const context = await browser.newContext({ viewport: { width: STAGE_W, height: STAGE_H }, deviceScaleFactor: 1 });

    // קריאת הרשימות מהגלריה עצמה (מקור אמת יחיד) + חימום אופטימיזציית התלויות של Vite
    const meta = await (async () => {
      const page = await context.newPage();
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await page.goto(`${baseUrl}gallery.html`, { waitUntil: 'networkidle' });
          await page.waitForFunction(() => window.__galleryMeta !== undefined, null, { timeout: 20000 });
          const m = await page.evaluate(() => window.__galleryMeta);
          await page.close();
          return m;
        } catch (err) {
          if (attempt === 2) throw err;
        }
      }
      throw new Error('unreachable');
    })();

    const pick = (all, wanted, what) => {
      if (wanted === null) return all;
      const unknown = wanted.filter((w) => !all.includes(w));
      if (unknown.length > 0) throw new Error(`${what} לא מוכרים: ${unknown.join(', ')} (קיימים: ${all.join(', ')})`);
      return wanted;
    };
    const themes = pick(meta.themes, list(args.themes), 'themes');
    const colorsList = pick(meta.colors, list(args.colors), 'colors');
    const screens = pick(
      meta.screens.map((s) => s.id),
      list(args.screens),
      'screens',
    );

    const jobs = [];
    for (const theme of themes)
      for (const colors of colorsList)
        for (const screen of screens)
          jobs.push({ theme, colors, screen, bg, file: resolve(OUT_DIR, theme, colors, `${screen}.png`) });

    console.log(`צילום ${jobs.length} מסכים (${themes.length} ערכות × ${colorsList.length} צבעים × ${screens.length} מסכים) …`);
    const results = new Array(jobs.length);
    let next = 0;
    const pages = await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => context.newPage()));
    await Promise.all(
      pages.map(async (page) => {
        await page.addInitScript((css) => {
          document.addEventListener('DOMContentLoaded', () => {
            const s = document.createElement('style');
            s.textContent = css;
            document.head.appendChild(s);
          });
        }, PROBE_CSS);
        while (next < jobs.length) {
          const i = next++;
          results[i] = await shoot(page, baseUrl, jobs[i]);
          process.stdout.write('.');
        }
      }),
    );
    process.stdout.write('\n\n');

    // טבלה
    const header = `${pad('theme', 8)} ${pad('colors', 15)} ${pad('screen', 30)} ${pad('overflow', 9)} ${pad('fit', 5)} ${pad('overlap', 8)} ${pad('contrast', 9)} ${pad('console', 8)} result`;
    console.log(header);
    console.log('-'.repeat(header.length + 4));
    const details = [];
    for (const r of results) {
      const v = verdict(r);
      if (v.fail) exitCode = 1;
      console.log(
        `${pad(r.theme, 8)} ${pad(r.colors, 15)} ${pad(r.screen, 30)} ${pad(r.overflow.length || 'ok', 9)} ${pad(
          r.fit.length || 'ok',
          5,
        )} ${pad(r.overlap.length || 'ok', 8)} ${pad(v.minRatio === null ? 'n/a' : v.minRatio.toFixed(2) + (v.contrastFail ? '!' : ''), 9)} ${pad(
          r.errors.length || 'ok',
          8,
        )} ${v.fail ? 'FAIL' : 'pass'}`,
      );
      if (v.fail) {
        const lines = [
          ...r.overflow.slice(0, 4).map((x) => `overflow: ${x}`),
          ...r.fit.slice(0, 4).map((x) => `fit: ${x}`),
          ...r.overlap.slice(0, 4).map((x) => `overlap: ${x}`),
          ...r.contrast
            .filter((c) => c.ratio !== null && c.ratio < CONTRAST_MIN)
            .slice(0, 4)
            .map((c) => `contrast: ${c.label} ${c.ratio.toFixed(2)}:1`),
          ...r.errors.slice(0, 4).map((x) => `console: ${x}`),
        ];
        details.push(`${r.theme}/${r.colors}/${r.screen}\n  ${lines.join('\n  ')}`);
      }
    }
    if (details.length > 0) console.log(`\nפירוט הכשלים:\n${details.join('\n')}`);

    // דפי מגע
    const sheetPage = await context.newPage();
    const sheets = [];
    for (const theme of themes) {
      for (const colors of colorsList) {
        const subset = results.filter((r) => r.theme === theme && r.colors === colors);
        sheets.push(await contactSheet(sheetPage, baseUrl, theme, colors, subset));
      }
    }
    writeFileSync(
      resolve(OUT_DIR, 'report.json'),
      JSON.stringify(
        results.map((r) => ({ ...r, file: relative(ROOT, r.file), ...verdict(r) })),
        null,
        2,
      ),
    );
    console.log(`\nדפי מגע:\n${sheets.map((s) => '  ' + relative(ROOT, s)).join('\n')}`);
    console.log(`${results.filter((r) => verdict(r).fail).length} נכשלו מתוך ${results.length}.`);
  } finally {
    await browser.close();
    await server.close();
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
