#!/usr/bin/env node
/**
 * שאלות הדאבל של הגרלת הווילה מקצה לקצה (src/app/villaDouble.ts, INTEGRATION.md):
 * המשחק האמיתי (dist, אחרי npm run build) ב-Chromium, עם המקלדת, שרת הצבעות מדומה
 * (טלפונים שעונים), ממסר מסך הצפייה ושרת גיבוי מדומה. בודק את מסך ההכרזה, התג מעל
 * השאלה, «תוצאת הדאבל» אחרי החשיפה (גם במסך הצפייה), שהרווח סוגר אותה וממשיך,
 * ואת meta.villaDoubles / meta.villaSlides / meta.villaPool בגיבוי שהשרת סופר ממנו
 * את הכרטיסים. ו«פעם אחת»: חלון הבחירה בפתיחה, התחלה מחדש אחרי ששאלת דאבל הופיעה
 * (בלעדיהן), «הפעלת ניסיון» בלעדיהן, קובץ שקשור להפעלה אחרת (`run`), והמשך מגיבוי
 * של ההפעלה שהקובץ קשור אליה מול «משחק חדש».
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

const makeVillaGame = (id, run) => ({
  name: 'בדיקת שאלות הדאבל',
  id,
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
    slide(2, 'subject', '🎫 שאלת דאבל 1 מתוך 1', {
      doubleIntro: { n: 1, of: 1, tickets: true, ...(run !== undefined ? { run } : {}) },
    }),
    slide(3, 'trivia', 'שאלת הדאבל', {
      double: { n: 1, of: 1, poolId: 'pool-7', tickets: true, stats: STATS, ...(run !== undefined ? { run } : {}) },
    }),
    slide(4, 'trivia', 'שאלה אחרונה'),
  ],
  users: '{}',
  room: ROOM,
});

/** ההפעלה שהשאלות «כבר הופיעו» בה, בקבצים שקשורים להפעלה (`run`). */
const RUN = 1_764_115_200_123;
/** הקבצים לפי מזהה (‎/fx/<id>.json‎): הראשי פתוח לכל הפעלה, והשאר לתרחישי «פעם אחת». */
const GAMES = {
  [GAME_ID]: makeVillaGame(GAME_ID),
  'villa-trial-e2e': makeVillaGame('villa-trial-e2e'),
  'villa-bound-e2e': makeVillaGame('villa-bound-e2e', RUN),
  'villa-resume-e2e': makeVillaGame('villa-resume-e2e', RUN),
  'villa-resume-new-e2e': makeVillaGame('villa-resume-new-e2e', RUN),
};
/** גיבוי חי של ההפעלה RUN, אחרי שאלה 1 (חמישה ענו), לפני שאלת הדאבל. */
const liveBackupOf = (id) => {
  const votes = { '0500000001': 1, '0500000002': 2, '0500000003': 1, '0500000004': 3, '0500000005': 1 };
  const users = Object.fromEntries(
    Object.entries(votes).map(([phone, answer]) => [
      phone,
      {
        name: `שחקן ${phone.slice(-2)}`,
        score: answer === 1 ? 7 : 0,
        groupId: null,
        numAnswers: 1,
        numCorrect: answer === 1 ? 1 : 0,
        details: { lastQue: 1, lastVote: answer, votes: { 1: answer } },
      },
    ]),
  );
  return {
    id,
    users: JSON.stringify(users),
    questions: JSON.stringify({
      1: { queId: 1, type: 'trivia', display: true, numVotes: 5, correctVotes: 3, answers: { 1: 3, 2: 1, 3: 1 } },
      3: { queId: 3, type: 'trivia', display: false, numVotes: 0, correctVotes: 0, answers: {} },
      4: { queId: 4, type: 'trivia', display: false, numVotes: 0, correctVotes: 0, answers: {} },
    }),
    groups: '[]',
    meta: JSON.stringify({ currentQueId: 1, phase: 'results', startedAt: RUN, villaSlides: [2, 3], villaPool: ['pool-7'] }),
    completed: false,
  };
};
/** הגיבויים החיים שהשרת המדומה מחזיר (GET ‎/save-backup/<id>‎). */
const LIVE_BACKUPS = {
  'villa-resume-e2e': liveBackupOf('villa-resume-e2e'),
  'villa-resume-new-e2e': liveBackupOf('villa-resume-new-e2e'),
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
  const fx = /^\/fx\/([\w-]+)\.json$/.exec(path);
  if (fx !== null && GAMES[fx[1]] !== undefined) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(GAMES[fx[1]]));
    return;
  }
  const live = /^\/backup\/save-backup\/([\w-]+)$/.exec(path);
  if (req.method === 'GET' && live !== null) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(LIVE_BACKUPS[live[1]] ?? {}));
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

/** פותח את המשחק `id` עד מסך הפתיחה (כמו קישור מהבונה, עם שרת ההצבעות והגיבוי המדומים). */
async function open(p, id) {
  const query = new URLSearchParams({
    game: `${BASE}/fx/${id}.json`,
    voteServer: VOTE_URL,
    liveRelay: RELAY,
    backupUrl: `${BASE}/backup`,
  });
  await p.goto(`${BASE}/?${query}`);
  await p.getByRole('button', { name: /התחל משחק/ }).click({ timeout: 20000 });
  await p.locator('.lobby-screen').waitFor({ timeout: 20000 });
  await sleep(800);
}
/** הגיבויים האחרונים שנשלחו למשחק `id` (המטא מפוענח). */
const metasOf = (id) =>
  backupPosts.filter((p) => p.path === '/save-backup' && p.body?.id === id).map((p) => JSON.parse(p.body.meta));

let crash = null;
let viewer = null;
try {
  await open(page, GAME_ID);

  // «פעם אחת»: לפני הפעלה עם שאלות דאבל המפעיל בוחר, והרווח לא מתחיל מאחורי החלון
  const modal = (await text(page, '.villa-once-box')) ?? '';
  check('חלון הבחירה בפתיחה', modal.includes('מופיעות פעם אחת בלבד') && modal.includes('הפעלת ניסיון'), modal);
  await shot(page, 'once-modal');
  await space(1);
  check('הרווח לא מתחיל את המשחק מאחורי החלון', (await count(page, '.lobby-screen')) === 1);
  check('בלי שורת «בלעדיהן» כשההפעלה משחקת אותן', (await count(page, '.villa-off-badge')) === 0);
  await page.getByRole('button', { name: /ההפעלה האמיתית/ }).click();
  await sleep(300);
  check('החלון נסגר', (await count(page, '.villa-once-box')) === 0);

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
  check('meta.villaPool = [pool-7]', JSON.stringify(meta?.villaPool) === '["pool-7"]', JSON.stringify(meta?.villaPool));
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

  // התחלה מחדש באותו חלון, אחרי ששאלת הדאבל הופיעה: ההפעלה החדשה בלעדיהן
  const sentBefore = metasOf(GAME_ID).length;
  await page.getByTitle('הגדרות').click();
  await page.getByRole('button', { name: /התחלת המשחק מחדש/ }).click({ timeout: 5000 });
  await page.locator('.lobby-screen').waitFor({ timeout: 10000 });
  await sleep(500);
  check('אחרי התחלה מחדש: בלי חלון הבחירה', (await count(page, '.villa-once-box')) === 0);
  const usedBadge = (await text(page, '.villa-off-badge')) ?? '';
  check('אחרי התחלה מחדש: «כבר הופיעו»', usedBadge.includes('כבר הופיעו'), usedBadge);
  await shot(page, 'restart-without-doubles');
  await space(1);
  await sleep(300);
  check('אחרי התחלה מחדש: המשחק בלי שאלות הדאבל (1/2)', (await counter()) === '1/2', await counter());
  await playQuestion([['0500000001', 1]]);
  await space(1);
  await sleep(500);
  check('אחרי התחלה מחדש: השאלה הבאה היא האחרונה, בלי הכרזה', (await counter()) === '2/2' && (await count(page, '.double-intro')) === 0, await counter());
  await sleep(1800);
  const after = metasOf(GAME_ID).slice(sentBefore);
  check(
    'אחרי התחלה מחדש: הגיבויים בלי villaSlides (השרת לא רואה הפעלה עם דאבל)',
    after.length > 0 && after.every((m) => m.villaSlides === undefined && m.villaPool === undefined),
    JSON.stringify(after.map((m) => m.villaSlides)),
  );

  // «הפעלת ניסיון» בחלון: ההפעלה בלעדיהן, והשרת לא רואה כלום
  const trial = await context.newPage();
  trial.on('pageerror', (e) => errors.push(`ניסיון: ${String(e)}`));
  await open(trial, 'villa-trial-e2e');
  await trial.getByRole('button', { name: /הפעלת ניסיון/ }).click({ timeout: 5000 });
  await sleep(300);
  const trialBadge = (await text(trial, '.villa-off-badge')) ?? '';
  check('ניסיון: השורה «הפעלת ניסיון: בלי שאלות הדאבל»', trialBadge.includes('הפעלת ניסיון'), trialBadge);
  await shot(trial, 'trial-without-doubles');
  await trial.keyboard.press('Space');
  await sleep(500);
  check('ניסיון: המשחק בלי שאלות הדאבל (1/2)', (await text(trial, '.slide-counter')) === '1/2', await text(trial, '.slide-counter'));
  await sleep(1800);
  const trialMetas = metasOf('villa-trial-e2e');
  check('ניסיון: הגיבויים בלי villaSlides', trialMetas.length > 0 && trialMetas.every((m) => m.villaSlides === undefined), `${trialMetas.length}`);
  await trial.close();

  // קובץ שקשור להפעלה אחרת (השרת: «כבר הופיעו», רק לרענון שלה), בלי גיבוי שלה: בלעדיהן
  const bound = await context.newPage();
  bound.on('pageerror', (e) => errors.push(`קובץ קשור: ${String(e)}`));
  await open(bound, 'villa-bound-e2e');
  check('קובץ קשור: בלי חלון הבחירה', (await count(bound, '.villa-once-box')) === 0);
  check('קובץ קשור: «כבר הופיעו»', ((await text(bound, '.villa-off-badge')) ?? '').includes('כבר הופיעו'));
  await bound.keyboard.press('Space');
  await sleep(500);
  check('קובץ קשור: המשחק בלי שאלות הדאבל (1/2)', (await text(bound, '.slide-counter')) === '1/2', await text(bound, '.slide-counter'));
  await bound.close();

  // המשך מגיבוי של ההפעלה שהקובץ קשור אליה: ממשיכה עם שאלות הדאבל, בלי לשאול שוב
  const resume = await context.newPage();
  resume.on('pageerror', (e) => errors.push(`המשך: ${String(e)}`));
  await open(resume, 'villa-resume-e2e');
  await resume.getByRole('button', { name: /המשך מהנקודה/ }).click({ timeout: 10000 });
  await sleep(500);
  check('המשך של ההפעלה: בלי חלון הבחירה', (await count(resume, '.villa-once-box')) === 0);
  check('המשך של ההפעלה: עם שאלות הדאבל (1/4)', (await text(resume, '.slide-counter')) === '1/4', await text(resume, '.slide-counter'));
  // מהשחזור על «תוצאות» הרווח הראשון חושף את התשובה הנכונה, והבא עובר לשקופית הבאה
  for (let i = 0; i < 3 && (await text(resume, '.slide-counter')) === '1/4'; i++) {
    await resume.keyboard.press('Space');
    await sleep(600);
  }
  check('המשך של ההפעלה: ההכרזה אחרי שאלה 1', (await count(resume, '.double-intro')) === 1, await text(resume, '.slide-counter'));
  await shot(resume, 'resume-with-doubles');
  await resume.close();

  // אותו גיבוי, «משחק חדש»: הפעלה אחרת, ולכן בלעדיהן
  const fresh = await context.newPage();
  fresh.on('pageerror', (e) => errors.push(`משחק חדש: ${String(e)}`));
  await open(fresh, 'villa-resume-new-e2e');
  await fresh.getByRole('button', { name: /משחק חדש/ }).click({ timeout: 10000 });
  await sleep(500);
  check('«משחק חדש» במקום המשך: בלי חלון הבחירה', (await count(fresh, '.villa-once-box')) === 0);
  check('«משחק חדש» במקום המשך: «כבר הופיעו»', ((await text(fresh, '.villa-off-badge')) ?? '').includes('כבר הופיעו'));
  await fresh.keyboard.press('Space');
  await sleep(500);
  check('«משחק חדש» במקום המשך: בלי שאלות הדאבל (1/2)', (await text(fresh, '.slide-counter')) === '1/2', await text(fresh, '.slide-counter'));
  await fresh.close();
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
