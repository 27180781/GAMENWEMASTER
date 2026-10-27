/**
 * בדיקה מקצה לקצה: שמות שנוספו בבונה אחרי שקישור ההפעלה נפתח מגיעים למשחק
 * (src/app/rosterRefresh.ts). המשחק «בחירות», 2026-10-25: 87 שמות יובאו בזמן
 * שהלשונית כבר הייתה פתוחה, וכל המשחק הוצגו מספרי טלפון.
 *
 *   node tools/roster-refresh-e2e.mjs
 *
 * הכול מקומי: שרת לקובץ המשחק (שאפשר לשנות באמצע) ולגיבוי, שרת הצבעות מדומה
 * (socket.io, כמו ב-sound-e2e), vite וכרום. שום דבר לא יוצא לשרתים האמיתיים.
 *
 * מה נבדק:
 *   1. הקובץ נטען בלי משתתפים; השמות נוספים בשרת לפני «התחל משחק» → אחרי
 *      ההתחלה המרשם מכיל אותם, והמצביע הראשון מוצג בשמו בלובי.
 *   2. שם שנוסף באמצע המשחק → מצביע חדש מהטלפון (בלי שם מהשרת) מושך את הקובץ
 *      ומוצג בשמו.
 *   3. מצביע שבאמת אינו ברשימה, שמצביע שוב ושוב → לכל היותר משיכה אחת בשבילו.
 *   4. מצביע מקישור (עם שם מהשרת) → אף משיכה.
 *   5. אין שגיאות בדף. (שם שהמפעיל הוסיף בעצמו נשמר — tests/rosterRefresh.test.ts.)
 */

import http from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { createReport, launchBrowser, pageWatcher, sleep, startViteServer, testGame, waitFor } from './live-e2e-kit.mjs';

const ROOM = '5006';
const GAME_ID = 'roster-refresh-e2e';
const game = testGame({ id: GAME_ID, room: ROOM, name: 'בחירות', setting: { limit: { type: 'phones', number: 168 } } });
game.users = '{}';
game.pendingUsers = [];

const users = (list) =>
  JSON.stringify(
    Object.fromEntries(
      list.map(([phone, name, groupName], i) => [phone, { remoteId: phone, name, groupName, participantId: `p-${i}` }]),
    ),
  );

let gameFetches = 0;
const server = http.createServer((req, res) => {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, apikey, authorization',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  };
  if (req.method === 'OPTIONS') return void res.writeHead(204, cors).end();
  if (req.url?.startsWith('/game.json')) {
    gameFetches += 1;
    return void res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(game));
  }
  if (req.url?.startsWith('/backup')) {
    req.resume();
    return void res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end('null');
  }
  res.writeHead(404, cors).end();
});
const io = new SocketServer(server, { transports: ['websocket'], cors: { origin: '*' } });
io.on('connection', (socket) => {
  socket.on('join/room', (data) => {
    const room = String(data?.gameId ?? '');
    void socket.join(room);
    socket.emit('room/joined', { gameId: room });
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
/** הצבעה מהטלפון; playerName רק לקישור (בשיחה הוא חסר, כמו ב-pbx.js). */
const vote = (phone, answer, playerName) =>
  io.to(ROOM).emit('voting', { gameId: ROOM, phone, vote: answer, ...(playerName ? { playerName } : {}) });

const report = createReport();
const errors = [];
const { vite, base: appBase } = await startViteServer([]);
const browser = await launchBrowser();
let failed = false;
try {
  const page = await browser.newPage();
  pageWatcher(errors)(page, 'מסך המשחק');
  page.on('dialog', (d) => void d.accept());
  const roster = () =>
    page.evaluate((id) => JSON.parse(localStorage.getItem(`trivia-roster:${id}`) ?? '{"players":[]}'), GAME_ID);
  const lobbyHas = (text) => waitFor(page, (t) => document.body.innerText.includes(t), text, 15_000);

  const q = new URLSearchParams({
    voteServer: base,
    liveRelay: 'http://127.0.0.1:9/live',
    backupUrl: `${base}/backup`,
    game: `${base}/game.json`,
  });
  await page.goto(`${appBase}?${q}`);
  const startBtn = page.getByRole('button', { name: /התחל משחק/ });
  await startBtn.waitFor({ timeout: 30_000 });
  report.check('הקובץ נטען בלי משתתפים (פעמיים ב-dev: StrictMode)', gameFetches >= 1 && gameFetches <= 2, `משיכות: ${gameFetches}`);

  // 1. הייבוא בבונה קורה עכשיו, כשהלשונית כבר פתוחה
  game.users = users([
    ['0504107086', 'אוריה טפירו', 'י'],
    ['0527195912', 'המורה אתי', 'מורות'],
  ]);
  await startBtn.click();
  await page.locator('.lobby-screen').waitFor({ timeout: 30_000 });
  const gotNames = await waitFor(
    page,
    (id) => (localStorage.getItem(`trivia-roster:${id}`) ?? '').includes('אוריה טפירו'),
    GAME_ID,
  );
  report.check('בכניסה למשחק הקובץ נמשך שוב והשמות נכנסו למרשם', gotNames, `משיכות: ${gameFetches}`);
  const r1 = await roster();
  report.check(
    'הקבוצות נכנסו גם הן',
    (r1.categories ?? []).some((c) => (c.groups ?? []).some((g) => g.name === 'מורות')),
  );
  vote('0504107086', 1);
  report.check('מצביעה מהרשימה מוצגת בשמה בלובי', await lobbyHas('אוריה טפירו'));

  await sleep(10_500); // מעבר למרווח המינימלי בין משיכות

  // 2. שם שנוסף באמצע המשחק
  game.users = users([
    ['0504107086', 'אוריה טפירו', 'י'],
    ['0527195912', 'המורה אתי', 'מורות'],
    ['0583299207', 'טוהר מלול', 'ט'],
  ]);
  const before2 = gameFetches;
  vote('0583299207', 2);
  report.check('מצביעה שנוספה באמצע מוצגת בשמה', await lobbyHas('טוהר מלול'), `משיכות נוספות: ${gameFetches - before2}`);

  // 3. מספר שאינו ברשימה — מצביע שוב ושוב
  await sleep(10_500);
  const before3 = gameFetches;
  for (let i = 0; i < 5; i += 1) {
    vote('0500000001', 1);
    await sleep(300);
  }
  await sleep(12_000);
  report.check('מספר שאינו ברשימה מושך את הקובץ פעם אחת בלבד', gameFetches - before3 === 1, `משיכות: ${gameFetches - before3}`);

  // 4. מצביע מקישור, עם שם מהשרת
  const before4 = gameFetches;
  vote('מיכל', 1, 'מיכל');
  await lobbyHas('מיכל');
  await sleep(2_000);
  report.check('מצביע מקישור (עם שם) לא מושך את הקובץ', gameFetches === before4, `משיכות: ${gameFetches - before4}`);

  const r2 = await roster();
  report.check(
    'המרשם אחרי כל הרענונים: שלושת השמות מהקובץ',
    ['אוריה טפירו', 'המורה אתי', 'טוהר מלול'].every((n) => r2.players.some((p) => p.name === n)),
    `${r2.players.length} שחקנים`,
  );
  report.check('אין שגיאות בדף', errors.length === 0, errors.slice(0, 5).join(' | '));
} catch (e) {
  report.check('הבדיקה רצה עד הסוף', false, String(e?.stack ?? e));
} finally {
  failed = report.results.some((r) => !r.ok);
  await browser.close();
  await vite.close();
  io.close();
  server.close();
}
console.log(failed ? '\nנכשל' : '\nהכול עבר');
process.exit(failed ? 1 : 0);
