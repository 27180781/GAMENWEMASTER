#!/usr/bin/env node
/**
 * שאלות הדאבל של הגרלת הווילה מקצה לקצה (src/app/villaDouble.ts, INTEGRATION.md):
 * המשחק האמיתי (dist, אחרי npm run build) ב-Chromium, עם המקלדת, שרת הצבעות מדומה
 * (טלפונים שעונים), ממסר מסך הצפייה ושרת גיבוי מדומה. בודק את מסך ההכרזה, התג מעל
 * השאלה, «תוצאת הדאבל» אחרי החשיפה (גם במסך הצפייה), שהרווח סוגר אותה וממשיך,
 * ואת meta.villaDoubles / meta.villaSlides בגיבוי שהשרת סופר ממנו את הכרטיסים.
 *
 *   npm run build && npm run e2e:villa
 *   npm run e2e:villa -- --shots=./villa-shots     # גם צילומים של כל מסך
 *
 * הכול רץ מקומית: שום דבר לא יוצא לשרתים האמיתיים.
 */

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { Server as SocketServer } from 'socket.io';
import { startRelay, viewTokenFor } from '../server/live-relay.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const option = (name) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 3);
};
const DIST = resolve(option('dist') ?? join(ROOT, 'dist'));
const SHOTS = option('shots') === undefined ? null : resolve(option('shots') || 'villa-shots');
const STEP = Number(process.env.VILLA_E2E_STEP ?? 260);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`אין בנייה ב-${DIST}: קודם npm run build`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// המשחק: שאלה רגילה, הכרזה, שאלת דאבל, שאלה רגילה (מצב טלפונים, חדר 4242)
// ---------------------------------------------------------------------------

const ROOM = 4242;
const GAME_ID = 'villa-double-e2e';
const STATS = { families: 20, avg: 41.5, atLeast: [20, 18, 15, 12, 9, 6, 4, 2, 1, 0, 0] };

function slide(id, type, que, extra = {}, answers = 3) {
  return {
    question: {
      que,
      queMode: 'text',
      scoreForQue: type === 'subject' ? '' : extra.double ? 14 : 7,
      timeForQue: type === 'subject' ? '' : 30,
      src: '',
      answers:
        type === 'subject'
          ? []
          : Array.from({ length: answers }, (_, i) => ({ ans: `תשובה ${i + 1}`, correct: i === 0, id: i + 1 })),
    },
    openMedia: { src: '' },
    backgroundMedia: { src: '' },
    endMedia: { src: '' },
    setting: {
      allowChangeVote: false,
      slideStartVoting: true,
      playAfterClicking: false,
      exitGame: false,
      correctlyAnsweredBefore: false,
      firstClicker: false,
      answerIsSequenceClicks: false,
      fullscreen: false,
      scoringReduction: { active: false, seconds: '', score: '' },
      slidBackgroundMedia: { src: '' },
      automaticSkip: { active: false, seconds: '' },
      showInLoop: false,
    },
    type,
    id,
    ...extra,
  };
}

const GAME = {
  name: 'בדיקת שאלות הדאבל',
  id: GAME_ID,
  cloudinaryFolder: 'test',
  setting: {
    titleThroughoutGame: 'בדיקת שאלות הדאבל',
    ansIsNumber: true,
    multiWinners: 3,
    showWinnersListAfter: null,
    mainColor: '#222B45',
    secondaryColor: '#FFFFFF',
    gameMedia: { src: '' },
    logo: { src: '' },
    triviaMedia: { src: '' },
    winnersMedia: { src: '' },
    winnersListMedia: { src: '' },
    sound: Object.fromEntries(
      [
        'playersConnectingMediaSound',
        'showQuestionMediaSound',
        'winnersMediaSound',
        'winnersListMediaSound',
        'genericMediaSound',
        'timerMediaSound',
        'inShowAnsMediaSound',
      ].map((k) => [k, { src: '' }]),
    ),
    limit: { type: 'phones', number: 100 },
  },
  questions: [
    slide(1, 'trivia', 'שאלה רגילה'),
    slide(2, 'subject', '🎫 שאלת דאבל 1 מתוך 1', { doubleIntro: { n: 1, of: 1, tickets: true } }),
    slide(3, 'trivia', 'שאלת הדאבל', { double: { n: 1, of: 1, poolId: 'pool-7', tickets: true, stats: STATS } }),
    slide(4, 'trivia', 'שאלה אחרונה'),
  ],
  users: '{}',
  room: ROOM,
};

// ---------------------------------------------------------------------------
// השרת: dist, קובץ המשחק (‎/fx/game.json‎) ושרת גיבוי מדומה (‎/backup/‎)
// ---------------------------------------------------------------------------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};
/** כל POST לשרת הגיבוי: { path, body }. */
const backupPosts = [];

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  if (path === '/fx/game.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(GAME));
    return;
  }
  if (path.startsWith('/backup/')) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.method === 'POST') {
        let body = null;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          /* גוף לא תקין */
        }
        backupPosts.push({ path: path.slice('/backup'.length), body });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    return;
  }
  const file = normalize(join(DIST, path === '/' ? 'index.html' : path.slice(1)));
  if (!file.startsWith(DIST + sep) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

/** שרת הצבעות מדומה (הפרוטוקול של SocketVoteAdapter): vote() = טלפון שלחץ. */
const votesHttp = createServer();
const io = new SocketServer(votesHttp, { transports: ['websocket'] });
io.on('connection', (socket) => {
  socket.on('join/room', (data) => {
    const room = String(data?.gameId ?? '');
    void socket.join(room);
    socket.emit('room/joined', { gameId: room });
  });
});
await new Promise((r) => votesHttp.listen(0, '127.0.0.1', r));
const VOTE_URL = `http://127.0.0.1:${votesHttp.address().port}`;
const vote = (phone, answer) =>
  io.to(String(ROOM)).emit('voting', { gameId: String(ROOM), phone, vote: answer, playerName: `שחקן ${phone.slice(-2)}` });

const relay = startRelay({ port: 0 });
const RELAY = `http://127.0.0.1:${(await relay.ready).port}/live`;

// ---------------------------------------------------------------------------
// הריצה
// ---------------------------------------------------------------------------

const browser = await chromium.launch({
  ...(existsSync('/opt/pw-browsers/chromium')
    ? { executablePath: '/opt/pw-browsers/chromium' }
    : process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : { channel: 'chrome' }),
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`מסך המשחק: ${String(e)}`));
page.on('dialog', (d) => void d.accept());

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
};
if (SHOTS !== null) mkdirSync(SHOTS, { recursive: true });
let shotN = 0;
const shot = async (p, name) => {
  if (SHOTS === null) return;
  shotN += 1;
  await p.screenshot({ path: join(SHOTS, `${String(shotN).padStart(2, '0')}-${name}.png`) });
};
const space = async (times = 1) => {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press('Space');
    await sleep(STEP);
  }
};
const text = (p, sel) => p.locator(sel).first().innerText({ timeout: 3000 }).catch(() => null);
const count = (p, sel) => p.locator(sel).count();
const counter = () => text(page, '.slide-counter');
/** שאלה מהתשובות ועד החשיפה, עם הצבעות של טלפונים. */
async function playQuestion(votes) {
  await space(3); // שלוש התשובות
  await space(1); // פתיחת ההצבעה
  for (const [phone, answer] of votes) vote(phone, answer);
  await sleep(900); // ההקשות עוברות דרך שרת ההצבעות
  await space(2); // סגירה וחשיפה
  await sleep(400);
}

let crash = null;
let viewer = null;
try {
  const query = new URLSearchParams({
    game: `${BASE}/fx/game.json`,
    voteServer: VOTE_URL,
    liveRelay: RELAY,
    backupUrl: `${BASE}/backup`,
  });
  await page.goto(`${BASE}/?${query}`);
  await page.getByRole('button', { name: /התחל משחק/ }).click({ timeout: 20000 });
  await page.locator('.lobby-screen').waitFor({ timeout: 20000 });
  await sleep(800);

  // מסך הצפייה, בהקשר נפרד (צופה במחשב אחר)
  const viewerContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
  viewer = await viewerContext.newPage();
  viewer.on('pageerror', (e) => errors.push(`מסך הצפייה: ${String(e)}`));
  const token = viewTokenFor(createHash('sha256').update(`trivia-live-pub:v1:${GAME_ID}:${ROOM}`).digest('hex'));
  await viewer.goto(`${BASE}/?view=${token}&liveRelay=${encodeURIComponent(RELAY)}`);
  await viewer.getByRole('button', { name: /רק לצפות/ }).click({ timeout: 15000 }).catch(() => undefined);
  await viewer.getByRole('button', { name: /הפעלת צליל/ }).click({ timeout: 15000 }).catch(() => undefined);
  await sleep(800);

  // שאלה 1: חמישה משחקים, שלושה צודקים
  await space(1);
  await playQuestion([
    ['0500000001', 1],
    ['0500000002', 2],
    ['0500000003', 1],
    ['0500000004', 3],
    ['0500000005', 1],
  ]);
  check('שאלה 1: חמישה ענו', (await text(page, '.q-answered-num')) === '5', await text(page, '.q-answered-num'));

  // מסך ההכרזה
  await space(1);
  await sleep(500);
  check('מסך ההכרזה מוצג', (await count(page, '.double-intro')) === 1, `שקופית ${await counter()}`);
  check('מסך ההכרזה: «שאלת דאבל» ו-«1 מתוך 1»', /שאלת דאבל[\s\S]*1 מתוך 1/.test((await text(page, '.double-intro')) ?? ''));
  check('מסך ההכרזה: שורת הכרטיסים', ((await text(page, '.double-intro')) ?? '').includes('עד 10 בשאלה'));
  await shot(page, 'intro');
  check('מסך ההכרזה גם בצפייה', (await count(viewer, '.double-intro')) === 1);

  // שאלת הדאבל: התג, ואז a ו-b צודקים, c טועה, d ו-e לא עונים → 2 מתוך 5 = 4 כרטיסים
  await space(1);
  await sleep(400);
  const pill = (await text(page, '.q-mode-pill--double')) ?? '';
  check('התג מעל שאלת הדאבל', pill.includes('שאלת דאבל 1 מתוך 1') && pill.includes('ניקוד כפול'), pill);
  await playQuestion([
    ['0500000001', 1],
    ['0500000002', 1],
    ['0500000003', 2],
  ]);
  check('אחרי החשיפה התוצאה עוד סגורה', (await count(page, '.double-overlay')) === 0);

  await space(1);
  await sleep(1600); // הכרטיסים נדלקים אחד אחרי השני
  check('רווח פותח את «תוצאת הדאבל»', (await count(page, '.double-overlay')) === 1);
  check('2 ענו נכון', (await text(page, '.double-num')) === '2', await text(page, '.double-num'));
  check('מתוך 5', (await text(page, '.double-of')) === 'מתוך 5', await text(page, '.double-of'));
  check('4 כרטיסים דולקים מתוך 10', (await count(page, '.double-ticket--on')) === 4 && (await count(page, '.double-ticket')) === 10);
  const tickets = (await text(page, '.double-tickets')) ?? '';
  check('«קיבלתם עוד 4 כרטיסים»', tickets === 'קיבלתם עוד 4 כרטיסים להגרלת הווילה!', tickets);
  const compare = (await text(page, '.double-compare')) ?? '';
  check('שורת ההשוואה', compare === 'רק 45% מהמשפחות בארץ הגיעו לתוצאה כזאת!', compare);
  await shot(page, 'result');
  await sleep(600);
  check('«תוצאת הדאבל» גם בצפייה', (await count(viewer, '.double-overlay')) === 1);
  check('בצפייה: 2 מתוך 5', (await text(viewer, '.double-num')) === '2' && (await text(viewer, '.double-of')) === 'מתוך 5');
  check('בצפייה בלי כפתור סגירה', (await count(viewer, '.double-close')) === 0);
  await shot(viewer, 'result-viewer');

  // רווח סוגר וממשיך: אותה שקופית, ורווח נוסף לשקופית הבאה
  const before = await counter();
  await space(1);
  await sleep(400);
  check('רווח סוגר את התוצאה', (await count(page, '.double-overlay')) === 0);
  check('אחרי הסגירה עדיין באותה שקופית', (await counter()) === before, `${before} → ${await counter()}`);
  await sleep(600);
  check('נסגרה גם בצפייה', (await count(viewer, '.double-overlay')) === 0);
  await space(1);
  await sleep(400);
  check('רווח נוסף: השקופית הבאה', (await counter()) === '4/4', await counter());

  // שאלה אחרונה וסוף המשחק
  await playQuestion([['0500000001', 1]]);
  await space(1);
  await sleep(2000);

  const posts = backupPosts.filter((p) => p.path === '/save-backup' && p.body?.id === GAME_ID);
  const last = posts.at(-1);
  const meta = last ? JSON.parse(last.body.meta) : null;
  check('נשלחו גיבויים', posts.length > 0, `${posts.length}`);
  check('meta.villaSlides = [2, 3]', JSON.stringify(meta?.villaSlides) === '[2,3]', JSON.stringify(meta?.villaSlides));
  const d = meta?.villaDoubles?.[0];
  check(
    'meta.villaDoubles: שאלה 3, הכרזה 2, 2 מתוך 5, 4 כרטיסים',
    meta?.villaDoubles?.length === 1 &&
      d.slideId === 3 &&
      d.introSlideId === 2 &&
      d.poolId === 'pool-7' &&
      d.n === 1 &&
      d.correct === 2 &&
      d.base === 5 &&
      d.tickets === 4 &&
      d.que === 'שאלת הדאבל' &&
      d.answers?.length === 3,
    JSON.stringify(meta?.villaDoubles),
  );
  const gameOver = backupPosts.some((p) => p.path === '/save-backup/game-over');
  check('סוף המשחק נרשם (game-over)', gameOver);
} catch (err) {
  crash = err instanceof Error ? err.message.split('\n')[0] : String(err);
} finally {
  await browser.close();
  server.close();
  votesHttp.close();
  io.close();
  await relay.close();
}

for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.ok || !r.detail ? '' : ` — ${r.detail}`}`);
for (const e of errors) console.log(`✗ שגיאה בדף: ${e}`);
if (crash) console.log(`✗ הריצה נעצרה: ${crash}`);
const failed = results.filter((r) => !r.ok).length + errors.length + (crash ? 1 : 0);
console.log(failed === 0 ? `\nכל ${results.length} הבדיקות עברו` : `\n${failed} בעיות`);
process.exit(failed === 0 ? 0 : 1);
