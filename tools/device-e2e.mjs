#!/usr/bin/env node
/**
 * בדיקה מקצה לקצה של "משחקים שנשלחים למחשב": התוכנה האמיתית (Electron, אחרי
 * npm run build) מול שרת מדומה של מערכת יצירת המשחקים, בתיקיית נתונים זמנית.
 *
 *   npm run build && xvfb-run -a npm run e2e:device            # בלינוקס בלי מסך
 *   npm run e2e:device -- ./device-e2e                         # שומר צילומים ויומן
 *
 * מה נבדק, לפי הסדר:
 *   1. מסך הפתיחה מציג את מספר המחשב.
 *   2. הבדיקה הראשונה מחזירה משחק — הוא יורד ברקע ונפתח לבד (כמו קוד שהוקלד).
 *   3. האישורים מהמערכת: עריכה נעולה, משחק חדש פתוח, והכפתור הנעול מסביר למה.
 *   4. המשחק השתנה במערכת: הודעה עם כפתור, ושום דבר לא יורד ברקע (הוא על המסך).
 *   5. טעינת העדכון: רק הרשימה יורדת שוב; קובץ שכתובתו לא השתנתה מועתק.
 *   6. שם שהוקלד במחשב מגיע לשרת.
 *   7. המנהל שינה אישורים — הכפתורים מתעדכנים בבדיקה הבאה.
 *   8. «השבתת התוכנה» בזמן משחק: המשחק אינו נקטע, וההשבתה נשמרת ומדווחת.
 *   9. פתיחה מחדש: מסך הנעילה במקום מסך הפתיחה, עם מספר המחשב.
 *  10. בלי רשת: הנעילה, האישורים והשם נשארים (device.json), והספרייה זוכרת משחק וגרסה.
 *  11. פתיחה מחדש בלי רשת — נעולה מהרגע הראשון.
 *  12. ביטול ההשבתה: הרשת חוזרת, «בדיקה חוזרת» — התוכנה נפתחת, והמערכת יודעת.
 *
 * קוד יציאה 1 אם בדיקה כלשהי נכשלה. לעולם לא מריץ playwright install.
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'device-e2e-')));
fs.mkdirSync(OUT, { recursive: true });

const GAME_ID = '92916bed-ce28-4ce3-9066-7a9bacb792ca';
const CODE = '123456';

// משחק אמיתי מהקבועים, בלי כתובות חיצוניות (הבדיקה לא יוצאת לרשת), עם קובץ
// מדיה אחד שהשרת המדומה מגיש — כדי לבדוק שהוא אינו יורד שוב בעדכון.
const blank = (v) => {
  if (typeof v === 'string') return /^https?:\/\//.test(v) ? '' : v;
  if (Array.isArray(v)) return v.map(blank);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blank(x)]));
  return v;
};
const base = blank(JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/neuwirth.json'), 'utf8')));
base.questions = base.questions.slice(0, 4);
base.id = GAME_ID;
base.name = 'חידון בדיקה מקצה לקצה';
base.setting.logo = { src: 'media/logo.png' };
base.setting.limit = { type: 'clickers', number: 20 };
base.assets = [];
const LOGO = fs.readFileSync(path.join(ROOT, 'build/icon.png'));

/** מה שהמערכת "יודעת" — הבדיקה משנה אותו בין השלבים. */
const server = {
  version: 'v1',
  name: null,
  permissions: { createGame: true, editGame: false },
  blocked: false,
  syncBodies: [],
  manifestHits: 0,
  mediaHits: 0,
};
const gameJson = () => {
  const g = structuredClone(base);
  if (server.version === 'v2') g.questions[0].question.que = 'שאלה ששונתה במערכת (גרסה 2)';
  return g;
};

const http1 = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const send = (status, body, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };
  if (req.method === 'POST' && url.pathname === '/offline-device') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      server.syncBodies.push(body);
      if (typeof body.name === 'string') server.name = body.name || null;
      // כמו offline-device: מחשב מושבת אינו מקבל משחקים, ונבדק כל דקה.
      send(200, {
        ok: true,
        device: { id: body.deviceId, name: server.name, permissions: server.permissions, blocked: server.blocked },
        games: server.blocked
          ? []
          : [{ gameId: GAME_ID, name: base.name, code: CODE, version: server.version, expiresAt: '2099-01-01T00:00:00Z' }],
        pollSeconds: server.blocked ? 60 : 600,
      });
    });
    return;
  }
  if (url.pathname === '/get-offline-manifest' && url.searchParams.get('code') === CODE) {
    server.manifestHits += 1;
    const { port } = http1.address();
    send(200, {
      gameJson: gameJson(),
      mediaFiles: [{ url: `http://127.0.0.1:${port}/media/logo.png`, localPath: 'media/logo.png' }],
      version: server.version,
    });
    return;
  }
  if (url.pathname === '/media/logo.png') {
    server.mediaHits += 1;
    send(200, LOGO, 'image/png');
    return;
  }
  send(404, { error: 'not found' });
});
await new Promise((r) => http1.listen(0, '127.0.0.1', r));
const { port } = http1.address();

const config = fs.mkdtempSync(path.join(os.tmpdir(), 'device-e2e-config-'));
const dataDir = path.join(config, 'trivia-engine');
const env = { ...process.env, TRIVIA_REMOTE_URL: `http://127.0.0.1:${port}`, XDG_CONFIG_HOME: config, NO_PROXY: '127.0.0.1,localhost' };
for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy']) delete env[k];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const until = async (fn, ms = 10000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 200))) if (await fn()) return true;
  return await fn();
};

const log = path.join(OUT, 'main.log');
/** התוכנה, עם אותה תיקיית נתונים בכל פתיחה (כמו פתיחה מחדש באותו מחשב). */
const launch = async () => {
  const electronApp = await _electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron'),
    args: ['--no-sandbox', ROOT],
    cwd: ROOT,
    env,
    timeout: 60000,
  });
  electronApp.process().stdout?.on('data', (d) => fs.appendFileSync(log, d));
  electronApp.process().stderr?.on('data', (d) => fs.appendFileSync(log, d));
  let win = null;
  for (let i = 0; i < 100 && win === null; i += 1) {
    win = electronApp.windows().find((w) => w.url().includes('dist/index.html') && !w.url().includes('#host')) ?? null;
    if (win === null) await new Promise((r) => setTimeout(r, 300));
  }
  return { electronApp, win };
};
let { electronApp: app, win: page } = await launch();
const shot = (n) => page?.screenshot({ path: path.join(OUT, `${n}.png`) });
const relaunch = async () => {
  await app.close().catch(() => {});
  ({ electronApp: app, win: page } = await launch());
  if (page === null) throw new Error('החלון הראשי לא נפתח מחדש');
};
const LOCKED = 'לא ניתן להפעיל את התוכנה';
const lockVisible = () => page.getByText(LOCKED).isVisible().catch(() => false);
const savedDevice = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'device.json'), 'utf8'));

try {
  if (page === null) throw new Error('החלון הראשי לא נפתח');
  await page.waitForSelector('.device-panel', { timeout: 20000 });
  const id = (await page.locator('.device-id').innerText()).trim();
  check('מסך הפתיחה מציג את מספר המחשב', /^\d{4}-\d{4}$/.test(id), id);
  await shot('1-panel');

  await page.getByText('נפתח המשחק שנשלח למחשב הזה', { exact: false }).waitFor({ timeout: 40000 });
  check('המשחק שנשלח ירד ונפתח לבד', server.manifestHits === 1 && server.mediaHits === 1);
  const first = server.syncBodies[0];
  check('הבדיקה שולחת מספר, סוד ומערכת הפעלה', /^\d{8}$/.test(first.deviceId) && /^[0-9a-f]{64}$/.test(first.secret) && first.platform === process.platform);
  await shot('2-opened');
  // הפעלה ראשונה: חלון "קוד גישה" הקיים פתוח — ממשיכים בלי קוד.
  const noCode = page.getByRole('button', { name: 'המשך בלי קוד' });
  if (await noCode.isVisible().catch(() => false)) await noCode.click();

  const editBtn = page.getByRole('button', { name: /עריכת המשחק/ });
  const newBtn = page.getByRole('button', { name: /משחק חדש/ });
  check('עריכה נעולה ומשחק חדש פתוח, כפי שאושר', (await editBtn.isDisabled()) && !(await newBtn.isDisabled()));
  check('הכפתור הנעול מסביר למה', ((await editBtn.getAttribute('title')) ?? '').includes('דורשת אישור מהמנהל'));

  server.version = 'v2';
  await page.evaluate(() => window.triviaDesktop.deviceSync());
  await page.getByText('יש גרסה חדשה של המשחק הזה במערכת', { exact: false }).waitFor({ timeout: 20000 });
  check('הודעה על גרסה חדשה, בלי הורדה ברקע של המשחק שעל המסך', server.manifestHits === 1);
  await shot('3-update-notice');

  await page.getByRole('button', { name: 'טעינת העדכון' }).click();
  await page.getByText('המשחק עודכן לגרסה האחרונה מהמערכת', { exact: false }).waitFor({ timeout: 30000 });
  check('העדכון נטען, והמדיה שלא השתנתה לא ירדה שוב', server.manifestHits === 2 && server.mediaHits === 1, `${server.manifestHits}/${server.mediaHits}`);
  await shot('4-updated');

  const sent = server.syncBodies.length;
  await page.evaluate(() => window.triviaDesktop.deviceRename('אולם בדיקה'));
  check('שם שהוקלד במחשב מגיע לשרת', await until(() => server.syncBodies.slice(sent).some((b) => b.name === 'אולם בדיקה')));

  server.permissions = { createGame: false, editGame: true };
  await page.evaluate(() => window.triviaDesktop.deviceSync());
  await page
    .waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('עריכת המשחק') && !b.disabled), null, {
      timeout: 10000,
    })
    .catch(() => {});
  check('אישורים שהמנהל שינה מתעדכנים בבדיקה הבאה', !(await editBtn.isDisabled()) && (await newBtn.isDisabled()));
  check('עד עכשיו — פתוחה, והמחשב מדווח שאינו נעול', !(await lockVisible()) && server.syncBodies.every((b) => b.blocked === false));
  await shot('5-approvals-changed');

  // 8. המשחק מתחיל (מצב דמה), ובאמצעו המנהל משבית את התוכנה במחשב: המשחק ממשיך.
  await page.getByRole('button', { name: /מצב דמה/ }).click();
  await page.locator('.operator-menu-fab').waitFor({ timeout: 40000 });
  server.blocked = true;
  const beforeBlock = server.syncBodies.length;
  await page.evaluate(() => window.triviaDesktop.deviceSync());
  check('ההשבתה נשמרת במחשב', await until(() => savedDevice().blocked === true));
  check('והמחשב מדווח למערכת שקיבל אותה', await until(() => server.syncBodies.slice(beforeBlock).some((b) => b.blocked === true), 15000));
  await new Promise((r) => setTimeout(r, 1000));
  check('משחק שרץ אינו נקטע', !(await lockVisible()) && (await page.locator('.operator-menu-fab').isVisible()));
  await shot('6-blocked-while-playing');

  // 9. המשחק נגמר (ב-EXE: סגירת התוכנה) — בפתיחה הבאה: מסך הנעילה.
  await relaunch();
  await page.getByText(LOCKED).waitFor({ timeout: 20000 });
  check('פתיחה מחדש — מסך הנעילה במקום מסך הפתיחה', await page.getByText('יש לפנות לחוויה בקליק').isVisible());
  check('מסך הנעילה מציג את מספר המחשב', (await page.locator('.device-lock-id').innerText()).includes(id));
  check('אין דרך להפעיל משחק', (await page.getByRole('button', { name: /מצב דמה|שחק עם|התחל משחק|טען משחק|משחק חדש/ }).count()) === 0);
  await page.waitForTimeout(600);
  await shot('7-locked');

  // 10. בלי רשת — הכול נשאר.
  http1.closeAllConnections();
  await new Promise((r) => http1.close(r));
  const s = await page.evaluate(() => window.triviaDesktop.deviceSync());
  check('בלי רשת — האישורים נשארים', s.state === 'offline' && s.permissions.editGame === true && s.permissions.createGame === false, s.state);
  check('בלי רשת — הנעילה נשארת', s.blocked === true && (await lockVisible()));
  const saved = savedDevice();
  check('האישורים, השם וההשבתה שמורים במחשב', saved.permissions.editGame === true && saved.permissions.createGame === false && saved.name === 'אולם בדיקה' && saved.blocked === true);
  const meta = JSON.parse(fs.readFileSync(path.join(dataDir, 'games', `${CODE}.json`), 'utf8'));
  check('הספרייה זוכרת משחק וגרסה', meta.gameId === GAME_ID && meta.version === 'v2' && meta.source === 'device', JSON.stringify(meta));

  // 11. פתיחה מחדש בלי רשת — נעולה מהרגע הראשון.
  await relaunch();
  await page.getByText(LOCKED).waitFor({ timeout: 20000 });
  check('פתיחה בלי רשת — נעולה', true);
  await page.waitForTimeout(600);
  await shot('8-locked-offline');

  // 12. המנהל ביטל, הרשת חוזרת, «בדיקה חוזרת» — התוכנה נפתחת.
  server.blocked = false;
  await new Promise((r) => http1.listen(port, '127.0.0.1', r));
  const beforeUnblock = server.syncBodies.length;
  await page.getByRole('button', { name: /בדיקה חוזרת/ }).click();
  check('ביטול ההשבתה — התוכנה נפתחת', await until(async () => !(await lockVisible()), 15000));
  check('והמערכת יודעת שהמחשב נפתח', await until(() => server.syncBodies.slice(beforeUnblock).some((b) => b.blocked === false), 15000));
  check('הביטול נשמר במחשב', savedDevice().blocked === false);
  await page.waitForTimeout(600);
  await shot('9-unblocked');
} catch (err) {
  check('הריצה', false, err instanceof Error ? err.message.split('\n')[0] : String(err));
  await shot('error')?.catch(() => {});
} finally {
  await app.close().catch(() => {});
  if (http1.listening) http1.close();
  fs.rmSync(config, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${failed === 0 ? `כל ${results.length} הבדיקות עברו` : `${failed} נכשלו`} · צילומים ויומן: ${OUT}`);
process.exit(failed === 0 ? 0 : 1);
