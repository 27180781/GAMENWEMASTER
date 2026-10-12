#!/usr/bin/env node
/**
 * בדיקת הצלילים של המנוע מקצה לקצה: המשחק האמיתי (dist, אחרי npm run build)
 * ב-Chromium, עם המקלדת, מסך המנחה בלשונית נפרדת ומסך הצפייה. כל צליל של
 * AudioManager (play/pause) וכל סרטון של שקופית נרשמים, ואחרי כל צעד נבדק מה
 * נשמע עכשיו ומה על המסך.
 *
 *   npm run build && npm run e2e:sound                 # כל התרחישים
 *   npm run e2e:sound -- applause winners-voting       # רק אלה
 *   npm run e2e:sound -- --verbose                     # כל הצעדים גם כשהכול עבר
 *   npm run e2e:sound -- --out=./sound-e2e             # יומן מלא לכל תרחיש, לקבצים
 *   npm run e2e:sound -- --dist=../main/dist           # בנייה אחרת, למשל להשוואה עם main
 *   npm run e2e:sound -- --list                        # רשימת התרחישים
 *
 * כל תרחיש בונה משחק קטן משלו, עם קובץ WAV אחר לכל ערוץ צליל (q-sound.wav,
 * timer.wav…) — כך היומן אומר מה מתנגן לפי שם הקובץ. שרת מקומי מגיש אותו יחד
 * עם dist, שרת גיבוי מדומה (‎?backupUrl=‎), ממסר מסך הצפייה
 * (server/live-relay.mjs) ושרת הצבעות מדומה. סרטון הבדיקה נוצר בדפדפן בתחילת הריצה
 * (MediaRecorder), כך שאין קובצי מדיה בריפו ושום דבר לא יוצא לרשת.
 *
 * כללים שנבדקים בכל צעד: AudioManager מנגן ערוץ אחד בכל רגע — שני צלילים יחד הם
 * כישלון, חוץ ממחיאות כפיים, שמתנגנות מעל הצליל. בזמן המחיאות הצליל מונמך, ובלעדיהן
 * כל צליל בווליום מלא.
 *
 * התרחישים:
 *   question-sound       צליל השאלה: שאלה 1 אחרי מסך הפתיחה, כניסה רגילה, אחרי טבלת
 *                        המובילים האוטומטית והידנית, טבלה בזמן הצבעה, מסך ההתחברות (X),
 *                        תצוגת המנצחים (W) והתחלה מחדש (#234).
 *   no-question-sound    משחק בלי צליל שאלה: מחיאות כפיים מתחת לטבלה ממשיכות כשהיא נסגרת.
 *   applause             מחיאות כפיים (3) מעל מוזיקת הפתיחה ומעל הטיימר, שממשיכים
 *                        מונמכים וחוזרים לווליום המלא כשהן נגמרות; הצבעה שנסגרה
 *                        בזמנן עוצרת את הטיימר, והמחיאות ממשיכות עד הסוף.
 *   media-under-leaders  סרטון פתיחה שעולה מתחת לטבלה האוטומטית מחכה, ומתחיל מההתחלה,
 *                        עם קול, כשהיא נסגרת; כשהוא נגמר השאלה עולה עם הצליל שלה.
 *   video-slide-under-leaders  אותו דבר בשקופית וידאו (בלי שאלה).
 *   media-under-manual   אותו דבר מתחת לטבלה הידנית (1), כשעוברים שקופית ב-N.
 *   cover-backgrounds    הרקעים של מסך הפתיחה, של הטבלה ושל תצוגת המנצחים (W) ממשיכים לנגן.
 *   timer-under-leaders  טבלה בזמן הצבעה עוצרת את הטיימר ואת צלילו; 6 מתחתיה רק קובע
 *                        אם הוא ימשיך כשהיא נסגרת.
 *   votes-during-pause   הצבעות מטלפונים (שרת הצבעות מדומה) שנשלחות בזמן עצירה (6)
 *                        או מתחת לטבלה נקלטות כשממשיכים או כשסוגרים, גם כשאף אחד
 *                        לא מצביע אחריהן.
 *   back-after-leaders   חזרה (Backspace) לשקופית שאחריה נפתחה טבלה אוטומטית לא פותחת
 *                        אותה שוב.
 *   refresh-lobby        רענון קובץ המשחק (Shift+R) לא מתחיל מחדש את מוזיקת הפתיחה.
 *   auto-skip            מעבר אוטומטי סופר מחשיפת התשובה, ולא מתחת לטבלה.
 *   winners-voting       W בזמן הצבעה: הטיימר מחכה, וממשיך מאותה נקודה (W או 2).
 *   winners-end          W ואז 2: סוף המשחק האמיתי עדיין נרשם (גיבוי), ו-2 במסך
 *                        המנצחים האמיתי לא עושה כלום. קובץ התוצאות לא יורד מעצמו מול
 *                        הקהל: הוא יורד ממסך המנחה (בחלון שלו) או מתפריט המפעיל.
 *   fast-forward-end     N בשקופית האחרונה מתחת לטבלה: הרווח הראשון חושף מנצח.
 *   going-back           2 בשאלה הראשונה לא מקדם, 2 בזמן הצבעה חוזר לתשובות בלי צליל,
 *                        ו-Backspace בשאלה הראשונה מתחיל אותה נקייה.
 *   restart              התחלה מחדש מההגדרות כשעומדים בשאלה 1: היא עולה שוב עם הצליל.
 *   startup-license      מאחורי אזהרת הרישיון מקשים ומסך המנחה לא מתחילים את המשחק.
 *   startup-resume       כך גם מאחורי «נמצא משחק פעיל»; «המשך מהנקודה» עולה עם צליל
 *                        השאלה, ו«משחק חדש» חוזר למסך הפתיחה.
 *   host-console         מסך המנחה בלשונית נפרדת מריץ את המשחק, ושותק בעצמו.
 *   live-viewer          מסך הצפייה (‎?view=‎) שומע מה שהאולם שומע, כולל מחיאות כפיים
 *                        מעל הטיימר (#235).
 *
 * דפדפן: playwright-core עם Chromium המותקן (/opt/pw-browsers/chromium אם קיים,
 * אחרת CHROMIUM_PATH או ערוץ chrome), מושתק (‎--mute-audio‎: הניגון והאירועים
 * כרגיל, בלי רעש מהרמקולים). קוד יציאה 1 אם בדיקה כלשהי נכשלה. לעולם לא מריץ
 * playwright install.
 */

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { Server as SocketServer } from 'socket.io';
import { startRelay, viewTokenFor } from '../server/live-relay.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// ארגומנטים
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
/** ערך של ‎--name=value‎ (מחרוזת ריקה ל-‎--name‎ לבד), או undefined. */
function option(name) {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 3);
}
const DIST = resolve(option('dist') ?? join(ROOT, 'dist'));
const OUT = option('out') === undefined ? null : resolve(option('out') || 'sound-e2e');
const VERBOSE = option('verbose') !== undefined;
const ONLY = argv.filter((a) => !a.startsWith('--'));
/** קצב הלחיצות (ms). במחשב איטי אפשר להאט: SOUND_E2E_STEP=400. */
const STEP = Number(process.env.SOUND_E2E_STEP ?? 220);
/** כמה מחכים אחרי כל צעד לפני שבודקים מה נשמע. */
const SETTLE = STEP + 150;
/** אורך מחיאות הכפיים (קצרות בכוונה, כדי לבדוק מה קורה כשהן נגמרות). */
const APPLAUSE_S = 2;
/** אורך סרטון הבדיקה. */
const CLIP_S = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// המשחקים: שאלות טריוויה קצרות וקובץ WAV אחר לכל ערוץ צליל
// ---------------------------------------------------------------------------

/** WAV מונו: צליל סינוס בתדר נתון. */
function wav(seconds, freq) {
  const rate = 8000;
  const n = Math.floor(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 3000), 44 + i * 2);
  }
  return buf;
}

/** הקובץ של כל ערוץ צליל במשחק (setting.sound) ואורכו בשניות. */
const SOUNDS = {
  playersConnectingMediaSound: ['connecting.wav', 20],
  showQuestionMediaSound: ['q-sound.wav', 20],
  timerMediaSound: ['timer.wav', 20],
  inShowAnsMediaSound: ['showans.wav', 20],
  winnersListMediaSound: ['winnerslist.wav', 20],
  winnersMediaSound: ['winners.wav', 20],
  genericMediaSound: ['applause.wav', APPLAUSE_S], // מחיאות הכפיים (מקש 3)
};
const APPLAUSE_FILE = SOUNDS.genericMediaSound[0];

/** שאלת טריוויה: שלוש תשובות, הראשונה נכונה. */
function trivia(id, { time = 15, open = '', autoSkip } = {}) {
  return {
    question: {
      que: `שאלה ${id}`,
      queMode: 'text',
      scoreForQue: 7,
      timeForQue: time,
      src: '',
      answers: [
        { ans: 'א', correct: true, id: 1 },
        { ans: 'ב', correct: false, id: 2 },
        { ans: 'ג', correct: false, id: 3 },
      ],
    },
    openMedia: { src: open },
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
      automaticSkip:
        autoSkip === undefined
          ? { active: false, seconds: '' }
          : { active: true, seconds: autoSkip },
      showInLoop: false,
    },
    type: 'trivia',
    id,
  };
}

/** שקופית וידאו (type: 'media'): הסרטון הוא מדיית הפתיחה שלה, בלי שאלה. */
function videoSlide(id, open) {
  const slide = trivia(id, { open });
  return {
    ...slide,
    question: { que: '', queMode: 'text', scoreForQue: '', timeForQue: '', src: '', answers: [] },
    type: 'media',
  };
}

/**
 * קובץ המשחק של תרחיש. spec: slides (לכל שאלה time / open / autoSkip),
 * leadersEvery (setting.showWinnersListAfter), backgrounds (סרטון רקע למסך
 * הפתיחה, לטבלת המובילים ולמסך המנצחים), noQuestionSound, room (מצב טלפונים), autoTransition
 * (setting.autoTransition).
 */
function gameFile(name, spec) {
  const url = (file) => (file ? `${BASE}/fx/${file}` : '');
  return {
    name: `בדיקת צליל: ${name}`,
    id: `sound-e2e-${name}`,
    cloudinaryFolder: 'test',
    setting: {
      titleThroughoutGame: 'בדיקת צליל',
      ansIsNumber: true,
      multiWinners: 3,
      showWinnersListAfter: spec.leadersEvery ?? null,
      mainColor: '#EBBD34',
      secondaryColor: '#3A00F8',
      gameMedia: { src: url(spec.backgrounds ? 'bg-game.webm' : '') },
      logo: { src: '' },
      triviaMedia: { src: '' },
      winnersMedia: { src: url(spec.backgrounds ? 'bg-winners.webm' : '') },
      winnersListMedia: { src: url(spec.backgrounds ? 'bg-leaders.webm' : '') },
      sound: Object.fromEntries(
        Object.entries(SOUNDS).map(([key, [file]]) => [
          key,
          { src: spec.noQuestionSound && key === 'showQuestionMediaSound' ? '' : url(file) },
        ]),
      ),
      limit: { type: spec.room === undefined ? 'clickers' : 'phones', number: 100 },
      ...(spec.autoTransition === undefined ? {} : { autoTransition: spec.autoTransition }),
    },
    questions: spec.slides.map((s, i) =>
      s.video ? videoSlide(i + 1, url(s.video)) : trivia(i + 1, { ...s, open: url(s.open) }),
    ),
    users: '{}',
    ...(spec.room === undefined ? {} : { room: spec.room }),
  };
}

// ---------------------------------------------------------------------------
// השרת: dist, קובצי הבדיקה (‎/fx/‎) ושרת גיבוי מדומה (‎/backup/‎)
// ---------------------------------------------------------------------------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

const FX = mkdtempSync(join(tmpdir(), 'sound-e2e-'));
/** מזהה משחק → מה ש-GET של הגיבוי מחזיר ({} = אין גיבוי). */
const backups = new Map();
/** כל מה שהמשחק שלח לשרת הגיבוי: { path, id }. */
const backupPosts = [];

function serveFile(req, res, file) {
  const size = statSync(file).size;
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) {
    const start = range[1] === '' ? 0 : Number(range[1]);
    const end = range[2] === '' ? size - 1 : Math.min(Number(range[2]), size - 1);
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes',
    });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  createReadStream(file).pipe(res);
}

/** GET ‎/save-backup/<id>‎ מחזיר את הגיבוי של התרחיש; כל POST נרשם ומאושר. */
function backupApi(req, res, path) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const reply = (value) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (req.method === 'GET' && path.startsWith('/save-backup/')) {
      reply(backups.get(decodeURIComponent(path.slice('/save-backup/'.length))) ?? {});
      return;
    }
    if (req.method === 'POST') {
      let id = null;
      try {
        id = JSON.parse(Buffer.concat(chunks).toString('utf8')).id ?? null;
      } catch {
        /* גוף לא תקין — נרשם בלי מזהה */
      }
      backupPosts.push({ path, id });
      reply({});
      return;
    }
    res.writeHead(404);
    res.end();
  });
}

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  if (path.startsWith('/backup/')) {
    backupApi(req, res, path.slice('/backup'.length));
    return;
  }
  const [root, rel] = path.startsWith('/fx/')
    ? [FX, path.slice('/fx/'.length)]
    : [DIST, path === '/' ? 'index.html' : path.slice(1)];
  const file = normalize(join(root, rel));
  if (!file.startsWith(root + sep) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  serveFile(req, res, file);
});

/**
 * שרת הצבעות מדומה (socket.io, הפרוטוקול של SocketVoteAdapter): המשחק מצטרף
 * לחדר שלו (join/room), ו-vote() שולח לחדר הקשה של טלפון, כאילו שחקן לחץ.
 */
async function startVoteServer() {
  const http = createServer();
  const io = new SocketServer(http, { transports: ['websocket'] });
  io.on('connection', (socket) => {
    socket.on('join/room', (data) => {
      const room = String(data?.gameId ?? '');
      void socket.join(room);
      socket.emit('room/joined', { gameId: room });
    });
  });
  await new Promise((r) => http.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${http.address().port}`,
    /** טלפון מצביע: מספר הטלפון והתשובה (answer.id). */
    vote(room, phone, answer) {
      io.to(String(room)).emit('voting', {
        gameId: String(room),
        phone,
        vote: answer,
        playerName: `שחקן ${phone.slice(-2)}`,
      });
    },
    close: () => new Promise((r) => io.close(() => r())),
  };
}

// ---------------------------------------------------------------------------
// הדפדפן: רישום הצלילים בכל דף, וסרטון הבדיקה
// ---------------------------------------------------------------------------

/**
 * נטען בכל דף לפני הקוד שלו. הצלילים של AudioManager (וגם של מסך הצפייה) הם
 * <audio> שאינם בדף: כל play/pause שלהם נרשם, וגם מתי play() באמת התחיל
 * (started) או נדחה. המדיה שבדף (סרטון פתיחה, רקעים) נרשמת לפי האירועים שלה —
 * autoplay לא קורא ל-play().
 */
function instrument() {
  let n = 0;
  const log = [];
  const tracked = new Set();
  window.__soundLog = log;
  const name = (el) => (el.getAttribute('src') ?? '').split('?')[0].split('/').pop() || '(ריק)';
  const managed = (el) => el instanceof HTMLAudioElement && !el.isConnected;
  const track = (el) => {
    tracked.add(el);
    return (el.__soundId ??= ++n);
  };
  const play = HTMLMediaElement.prototype.play;
  const pause = HTMLMediaElement.prototype.pause;
  HTMLMediaElement.prototype.play = function (...args) {
    if (!managed(this)) return play.apply(this, args);
    const id = track(this);
    const src = name(this);
    log.push({ op: 'PLAY', id, src });
    const p = play.apply(this, args);
    p.then(
      () => log.push({ op: 'started', id, src }),
      (e) => log.push({ op: 'rejected', id, src, why: e?.name }),
    );
    return p;
  };
  HTMLMediaElement.prototype.pause = function (...args) {
    // רק עצירה שמשנה משהו — pause() על צליל שכבר עצור אינו אירוע
    if (managed(this) && !this.paused) log.push({ op: 'PAUSE', id: track(this), src: name(this) });
    return pause.apply(this, args);
  };
  for (const type of ['playing', 'pause', 'ended']) {
    document.addEventListener(
      type,
      (e) => {
        const el = e.target;
        if (el instanceof HTMLMediaElement && el.isConnected) {
          const t = Math.round(el.currentTime * 10) / 10;
          log.push({ op: `${el.tagName.toLowerCase()}:${type}`, src: name(el), t });
        }
      },
      true,
    );
  }
  window.__soundNow = () =>
    [...tracked]
      .filter(
        (el) =>
          !el.paused && !el.ended && el.error === null && (el.getAttribute('src') ?? '') !== '',
      )
      .map((el) => ({
        src: name(el),
        t: Math.round(el.currentTime * 10) / 10,
        v: Math.round(el.volume * 100) / 100,
      }));
  window.__pageMedia = () =>
    [...document.querySelectorAll('video, audio')].map((el) => ({
      tag: el.tagName.toLowerCase(),
      src: name(el),
      playing: !el.paused && !el.ended,
      muted: el.muted,
      t: Math.round(el.currentTime * 10) / 10,
    }));
}

/** מה על המסך עכשיו — מה שהבדיקות צריכות. */
function readScreen() {
  const q = (sel) => document.querySelector(sel);
  return {
    sound: window.__soundNow(),
    media: window.__pageMedia(),
    counter: q('.slide-counter')?.textContent?.trim() ?? '',
    leaders: q('.leaders-overlay') !== null,
    winners: q('.winners-podium-screen') !== null,
    scoreboard: q('.all-scores-screen') !== null,
    podium: document.querySelectorAll('.podium-slot.is-shown').length,
    question: q('.q-question:not(.reveal-hidden)') !== null,
    answers: document.querySelectorAll('.q-card:not(.reveal-hidden)').length,
    correct: document.querySelectorAll('.q-card--correct').length,
    timer: q('.q-count-num')?.textContent?.trim() ?? null,
    /** «ענו» בשקופית: כמה הצבעות המנוע קלט. */
    answered: Number(q('.q-answered-num')?.textContent ?? 0),
    /** הניקוד בכל כרטיס של טבלת המובילים. */
    leaderScores: [...document.querySelectorAll('.leader-card .leader-score')].map((el) =>
      parseInt(el.textContent ?? '', 10),
    ),
    dialogs: [...document.querySelectorAll('.license-modal h2')].map((h) => h.textContent.trim()),
  };
}

/** מקליט סרטון (VP8 + Opus) מקנבס וצליל סינוס. רץ בתוך הדף; מחזיר base64. */
async function recordClip(ms) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  document.body.append(canvas);
  const g = canvas.getContext('2d');
  const ac = new AudioContext();
  await ac.resume();
  const osc = ac.createOscillator();
  osc.frequency.value = 440;
  const gain = ac.createGain();
  gain.gain.value = 0.1;
  const dest = ac.createMediaStreamDestination();
  osc.connect(gain).connect(dest);
  osc.start();
  const stream = new MediaStream([
    ...canvas.captureStream(25).getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' });
  const chunks = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise((r) => (rec.onstop = r));
  let frame = 0;
  const draw = () => {
    g.fillStyle = `hsl(${(frame++ * 9) % 360} 70% 50%)`;
    g.fillRect(0, 0, 320, 180);
  };
  draw();
  const timer = setInterval(draw, 40);
  rec.start(200);
  await new Promise((r) => setTimeout(r, ms));
  rec.stop();
  await stopped;
  clearInterval(timer);
  osc.stop();
  await ac.close();
  const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

let browser;
let clipReady = null;
/** סרטון הבדיקה, פעם אחת לריצה: clip.webm לשקופיות, ועותקים בשמות הרקעים. */
function ensureClip() {
  clipReady ??= (async () => {
    const page = await browser.newPage();
    try {
      const bytes = Buffer.from(await page.evaluate(recordClip, CLIP_S * 1000), 'base64');
      for (const file of ['clip.webm', 'bg-game.webm', 'bg-leaders.webm', 'bg-winners.webm'])
        writeFileSync(join(FX, file), bytes);
    } finally {
      await page.close();
    }
  })();
  return clipReady;
}

// ---------------------------------------------------------------------------
// הבודק: פתיחת משחק, צעדים ובדיקות
// ---------------------------------------------------------------------------

const names = (sound) => sound.map((s) => s.src).sort();
const listText = (list) => (list.length === 0 ? 'שקט' : list.join(' + '));

/**
 * בודק צעד מול הציפיות:
 *   sound    בדיוק מה שנשמע אחרי הצעד ([] = שקט)
 *   started  { קובץ: כמה פעמים התחיל להישמע בצעד הזה }
 *   quiet    שום צליל לא התחיל או נעצר בצעד הזה
 *   check    (screen, events) → מחרוזת או מערך: כל מחרוזת היא בעיה (true ו-null עוברים)
 */
function judge(expect, events, screen) {
  const problems = [];
  const now = names(screen.sound);
  const channels = screen.sound.filter((s) => s.src !== APPLAUSE_FILE);
  const claps = screen.sound.length - channels.length;
  if (channels.length > 1 || claps > 1) problems.push(`שני צלילים יחד: ${listText(now)}`);
  for (const s of channels) {
    if (claps > 0 && s.v >= 1) problems.push(`${s.src} לא הונמך מתחת למחיאות הכפיים`);
    if (claps === 0 && s.v < 1) problems.push(`${s.src} נשאר מונמך (${s.v}) בלי מחיאות כפיים`);
  }
  if (expect.sound !== undefined) {
    const want = [...expect.sound].sort();
    if (now.join() !== want.join()) problems.push(`נשמע ${listText(now)} במקום ${listText(want)}`);
  }
  for (const [file, want] of Object.entries(expect.started ?? {})) {
    const got = events.filter((e) => e.op === 'started' && e.src === file).length;
    if (got !== want) problems.push(`${file} התחיל ${got} פעמים במקום ${want}`);
  }
  if (expect.quiet && events.some((e) => e.op === 'PLAY' || e.op === 'PAUSE')) {
    problems.push('הצליל השתנה, ולא היה אמור');
  }
  if (expect.check) {
    for (const p of [].concat(expect.check(screen, events)))
      if (typeof p === 'string') problems.push(p);
  }
  return problems;
}

function eventsText(events) {
  return (
    events
      .filter((e) => e.op !== 'started')
      .map((e) =>
        e.op === 'PLAY' || e.op === 'PAUSE' || e.op === 'rejected'
          ? `${e.op} ${e.src}${e.why ? ` (${e.why})` : ''}`
          : `${e.op} ${e.src}@${e.t}`,
      )
      .join(' → ') || '(כלום)'
  );
}

function makeTester(scenario, context, result) {
  let page = null;
  let host = null;
  let viewer = null;
  const downloads = [];
  /** הורדות בחלון מסך המנחה (קובץ התוצאות יורד שם ולא מול הקהל). */
  const hostDownloads = [];
  const drain = (p) => p.evaluate(() => window.__soundLog.splice(0));

  const t = {
    get page() {
      return page;
    },
    downloads,
    hostDownloads,
    /** מה שהמשחק של התרחיש שלח לשרת הגיבוי. */
    backupPosts: () => backupPosts.filter((p) => p.id === `sound-e2e-${scenario.name}`),

    /**
     * טוען את המשחק ולוחץ «התחל משחק». license: 'ack' — סוגר את אזהרת
     * הרישיון (משחק בלי קוד חדר); 'leave' — משאיר אותה. backup: הגיבוי ש-GET
     * יחזיר (מפעיל את שרת הגיבוי המדומה). relayBase: ממסר מסך הצפייה.
     * voteServer: שרת ההצבעות המדומה (startVoteServer), למשחק עם קוד חדר.
     */
    async open(spec, { license = 'ack', backup, relayBase, voteServer } = {}) {
      if (spec.slides.some((s) => s.open || s.video) || spec.backgrounds) await ensureClip();
      const game = gameFile(scenario.name, spec);
      mkdirSync(join(FX, scenario.name), { recursive: true });
      writeFileSync(join(FX, scenario.name, 'game.json'), JSON.stringify(game));
      backups.set(game.id, backup ?? {});
      const query = new URLSearchParams({ game: `${BASE}/fx/${scenario.name}/game.json` });
      const phones = spec.room !== undefined;
      if (phones) {
        // משחק עם קוד חדר מתחבר לשרת ההצבעות, משדר לממסר ומגבה — הכול לכתובות
        // מקומיות, כדי ששום דבר לא יגיע לשרתים האמיתיים. בלי voteServer שרת
        // ההצבעות בכתובת מתה: אין הצבעות, והמשחק עצמו רץ כרגיל.
        query.set('voteServer', voteServer ?? 'http://127.0.0.1:9');
        query.set('liveRelay', relayBase ?? 'http://127.0.0.1:9/live');
      } else {
        query.set('demo', '1');
      }
      if (backup !== undefined || phones) query.set('backupUrl', `${BASE}/backup`);
      if (page === null) {
        page = await context.newPage();
        page.on('pageerror', (e) => result.errors.push(`מסך המשחק: ${String(e)}`));
        page.on('dialog', (d) => void d.accept());
        page.on('download', (d) => downloads.push(d.suggestedFilename()));
      }
      await page.goto(`${BASE}/?${query}`);
      await page.getByRole('button', { name: /התחל משחק/ }).click({ timeout: 20000 });
      // המשחק עולה אחרי הכנה של כמה שניות — מחכים למסך הפתיחה שלו
      await page.locator('.lobby-screen').waitFor({ timeout: 20000 });
      if (license === 'ack' && !phones) {
        await page.getByRole('button', { name: 'הבנתי' }).click({ timeout: 10000 });
      }
      await sleep(700);
      return game;
    },

    /** מסך המנחה (‎?host=1‎) בלשונית נוספת — מדבר עם המשחק דרך BroadcastChannel. */
    async openHostConsole() {
      host = await context.newPage();
      host.on('pageerror', (e) => result.errors.push(`מסך המנחה: ${String(e)}`));
      host.on('download', (d) => hostDownloads.push(d.suggestedFilename()));
      await host.goto(`${BASE}/?host=1`);
      await host.getByRole('button', { name: /קדימה/ }).waitFor({ timeout: 20000 });
      await sleep(500);
      await drain(host);
    },

    /** מסך הצפייה, בהקשר דפדפן נפרד (צופה במחשב אחר). */
    async openViewer(viewerContext, url) {
      viewer = await viewerContext.newPage();
      viewer.on('pageerror', (e) => result.errors.push(`מסך הצפייה: ${String(e)}`));
      await viewer.goto(url);
      await viewer
        .getByRole('button', { name: /רק לצפות/ })
        .click({ timeout: 15000 })
        .catch(() => undefined);
      await viewer.getByRole('button', { name: /הפעלת צליל/ }).click({ timeout: 15000 });
      await sleep(900);
    },

    /**
     * צעד: פעולה, המתנה, ובדיקה. expect כמו ב-judge; expect.viewer — אותן
     * ציפיות למסך הצפייה. settle — כמה לחכות אחרי הפעולה.
     */
    async step(name, action, expect = {}, settle = SETTLE) {
      await action();
      await sleep(settle);
      const events = await drain(page);
      const screen = await page.evaluate(readScreen);
      const problems = judge(expect, events, screen);
      const step = { name, events, screen, problems };
      if (host !== null) {
        const hostEvents = await drain(host);
        if (hostEvents.some((e) => e.op === 'PLAY')) {
          problems.push(`מסך המנחה השמיע צליל: ${eventsText(hostEvents)}`);
        }
      }
      if (viewer !== null) {
        const vEvents = await drain(viewer);
        const vScreen = await viewer.evaluate(readScreen);
        step.viewer = { events: vEvents, screen: vScreen };
        if (expect.viewer) {
          for (const p of judge(expect.viewer, vEvents, vScreen)) problems.push(`צופה: ${p}`);
        }
      }
      result.steps.push(step);
      return screen;
    },

    key:
      (k, times = 1) =>
      async () => {
        for (let i = 0; i < times; i++) {
          await page.keyboard.press(k);
          if (i < times - 1) await sleep(STEP);
        }
      },
    space: (times = 1) => t.key('Space', times),
    /** כמה מקשים ברצף, למשל ['Space', '1', 'KeyW']. */
    keys: (list) => async () => {
      for (const k of list) {
        await page.keyboard.press(k);
        await sleep(STEP);
      }
    },
    wait: (ms) => () => sleep(ms),
    click: (name) => () => page.getByRole('button', { name }).click({ timeout: 5000 }),
    /** כפתור במסך המנחה לפי שמו. */
    hostClick: (name) => () => host.getByRole('button', { name }).click({ timeout: 5000 }),
    /** «קדימה ▶» במסך המנחה. */
    forward:
      (times = 1) =>
      async () => {
        for (let i = 0; i < times; i++) {
          await host.getByRole('button', { name: /קדימה/ }).click();
          if (i < times - 1) await sleep(STEP);
        }
      },
    /** «התחלת המשחק מחדש» ממסך ההגדרות (⚙). */
    restartFromSettings: () => async () => {
      await page.getByTitle('הגדרות').click();
      await sleep(300);
      await page.locator('.settings-restart').click();
      await sleep(300);
    },
    /** שאלה מהתשובות ועד חשיפת התשובה הנכונה: 3 תשובות, הצבעה, סגירה, חשיפה. */
    async playToReveal(label) {
      await t.step(`${label}: התשובות`, t.space(3));
      await t.step(`${label}: הצבעה`, t.space(1));
      await t.step(`${label}: סגירה וחשיפה`, t.space(2));
    },
  };
  return t;
}

// בדיקות קטנות למסך: כל אחת מחזירה true או את תיאור הבעיה
const onSlide = (counter) => (s) =>
  s.counter === counter || `שקופית ${s.counter || '—'} במקום ${counter}`;
const onOpening = (s) => s.counter === '' || `שקופית ${s.counter} במקום מסך הפתיחה`;
const timerValue = (s) => (s.timer === null || s.timer === '⏸' ? null : Number(s.timer));
const slideVideo = (s) => s.media.find((m) => m.tag === 'video' && m.src === 'clip.webm');

// ---------------------------------------------------------------------------
// התרחישים
// ---------------------------------------------------------------------------

const Q = (extra = {}) => extra;
const SCENARIOS = [
  {
    name: 'question-sound',
    title: 'צליל השאלה אחרי כל כיסוי (#234)',
    async run(t) {
      await t.open({ leadersEvery: 2, slides: [Q(), Q(), Q(), Q(), Q()] });
      await t.step('מסך הפתיחה', t.wait(0), { sound: ['connecting.wav'], check: onOpening });
      await t.step('שאלה 1 אחרי מסך הפתיחה', t.space(), {
        started: { 'q-sound.wav': 1 },
        sound: ['q-sound.wav'],
        check: (s) => [onSlide('1/5')(s), s.question || 'השאלה לא מוצגת'],
      });
      await t.step('התשובות — המנגינה ממשיכה', t.space(3), {
        started: { 'q-sound.wav': 0 },
        sound: ['q-sound.wav'],
      });
      await t.step('הצבעה', t.space(), { sound: ['timer.wav'] });
      await t.step('סגירה וחשיפה', t.space(2), {
        started: { 'q-sound.wav': 0 },
        check: (s) => s.correct > 0 || 'התשובה הנכונה לא סומנה',
      });
      await t.step('שאלה 2 — כניסה רגילה', t.space(), {
        started: { 'q-sound.wav': 1 },
        sound: ['q-sound.wav'],
        check: onSlide('2/5'),
      });
      await t.playToReveal('שאלה 2');
      await t.step('שאלה 3 עולה מאחורי הטבלה האוטומטית', t.space(), {
        started: { 'q-sound.wav': 0 },
        sound: ['winnerslist.wav'],
        check: (s) => s.leaders || 'הטבלה לא נפתחה',
      });
      await t.step('הטבלה נסגרה — צליל השאלה פעם אחת', t.space(), {
        started: { 'q-sound.wav': 1 },
        sound: ['q-sound.wav'],
        check: (s) => !s.leaders || 'הטבלה עדיין פתוחה',
      });
      await t.step('טבלה ידנית (1) מעל השאלה', t.key('1'), { sound: ['winnerslist.wav'] });
      await t.step('הטבלה נסגרה (1) — צליל השאלה שוב', t.key('1'), {
        started: { 'q-sound.wav': 1 },
        sound: ['q-sound.wav'],
      });
      await t.step('התשובות', t.space(3), { sound: ['q-sound.wav'] });
      await t.step('הצבעה', t.space(), { sound: ['timer.wav'] });
      await t.step('טבלה (1) בזמן ההצבעה', t.key('1'), { sound: ['winnerslist.wav'] });
      await t.step('הטבלה נסגרה — הטיימר ממשיך', t.key('1'), {
        started: { 'q-sound.wav': 0 },
        sound: ['timer.wav'],
      });
      await t.step('סגירה וחשיפה', t.space(2));
      await t.step('שאלה 4 — כניסה רגילה', t.space(), {
        started: { 'q-sound.wav': 1 },
        sound: ['q-sound.wav'],
      });
      await t.step('מסך ההתחברות (X) — המנגינה ממשיכה מתחתיו', t.key('KeyX'), {
        quiet: true,
        sound: ['q-sound.wav'],
      });
      await t.step('מסך ההתחברות נסגר — בלי צליל נוסף', t.space(), {
        quiet: true,
        sound: ['q-sound.wav'],
      });
      await t.step('תצוגת המנצחים (W)', t.key('KeyW'), { sound: ['winners.wav'] });
      await t.step('חזרה מהתצוגה (W) — צליל השאלה פעם אחת', t.key('KeyW'), {
        started: { 'q-sound.wav': 1 },
        sound: ['q-sound.wav'],
      });
      await t.step('התחלה מחדש מההגדרות', t.restartFromSettings(), {
        sound: ['connecting.wav'],
        check: onOpening,
      });
      await t.step('אחרי ההתחלה מחדש: שאלה 1 עם הצליל', t.space(), {
        started: { 'q-sound.wav': 1 },
        sound: ['q-sound.wav'],
        check: (s) => [onSlide('1/5')(s), s.question || 'השאלה לא מוצגת'],
      });
    },
  },
  {
    name: 'no-question-sound',
    title: 'משחק בלי צליל שאלה: מחיאות כפיים מתחת לטבלה',
    async run(t) {
      await t.open({ leadersEvery: 1, noQuestionSound: true, slides: [Q(), Q(), Q()] });
      await t.step('שאלה 1 — אין צליל שאלה, שקט', t.space(), { sound: [] });
      await t.playToReveal('שאלה 1');
      await t.step('שאלה 2 מאחורי הטבלה האוטומטית', t.space(), { sound: ['winnerslist.wav'] });
      await t.step('מחיאות כפיים (3) מתחת לטבלה — מעל המוזיקה שלה', t.key('3'), {
        sound: ['applause.wav', 'winnerslist.wav'],
      });
      await t.step('הטבלה נסגרה באמצע — מחיאות הכפיים ממשיכות', t.space(), {
        sound: ['applause.wav'],
        check: (s, ev) =>
          !ev.some((e) => e.op === 'PAUSE' && e.src === 'applause.wav') || 'מחיאות הכפיים נעצרו',
      });
      await t.step('הן נגמרו — שקט, מוזיקת הטבלה לא חוזרת', t.wait(APPLAUSE_S * 1000 + 800), {
        sound: [],
      });
    },
  },
  {
    name: 'applause',
    title: 'מחיאות כפיים מעל המוזיקה',
    async run(t) {
      /** הצליל ממשיך מאותה נקודה ולא מתחיל מחדש. */
      const keeps = (file, from) => (s) => {
        const it = s.sound.find((x) => x.src === file);
        return it === undefined || it.t >= from || `${file} התחיל מחדש (${it.t}s)`;
      };
      await t.open({ slides: [Q({ time: 30 }), Q()] });
      await t.step('מסך הפתיחה', t.wait(1500), { sound: ['connecting.wav'] });
      await t.step('מחיאות כפיים (3) במסך הפתיחה — מעל המוזיקה', t.key('3'), {
        sound: ['applause.wav', 'connecting.wav'],
        started: { 'connecting.wav': 0 },
        check: keeps('connecting.wav', 1.4),
      });
      await t.step('הן נגמרו — מוזיקת הפתיחה בווליום מלא, מאותה נקודה', t.wait(APPLAUSE_S * 1000 + 800), {
        sound: ['connecting.wav'],
        started: { 'connecting.wav': 0 },
        check: keeps('connecting.wav', 1.4 + APPLAUSE_S),
      });
      await t.step('שאלה 1', t.space(), { sound: ['q-sound.wav'] });
      await t.step('התשובות', t.space(3), { sound: ['q-sound.wav'] });
      await t.step('הצבעה (30 שניות)', t.space(), { sound: ['timer.wav'] });
      await t.step('מחיאות כפיים בזמן ההצבעה', t.key('3'), {
        sound: ['applause.wav', 'timer.wav'],
        started: { 'timer.wav': 0 },
        check: (s) => timerValue(s) !== null || 'הספירה נעצרה',
      });
      await t.step('הן נגמרו — צליל הטיימר בווליום מלא', t.wait(APPLAUSE_S * 1000 + 800), {
        sound: ['timer.wav'],
        started: { 'timer.wav': 0 },
      });
      await t.step('שוב מחיאות כפיים', t.key('3'), { sound: ['applause.wav', 'timer.wav'] });
      await t.step('ההצבעה נסגרה בזמנן — המחיאות ממשיכות', t.space(), { sound: ['applause.wav'] });
      await t.step('הן נגמרו — שקט, הטיימר לא חוזר', t.wait(APPLAUSE_S * 1000 + 800), {
        sound: [],
      });
    },
  },
  {
    name: 'media-under-leaders',
    title: 'סרטון פתיחה מתחת לטבלה האוטומטית',
    async run(t) {
      // «ניגון עד הסוף»: כשהסרטון נגמר השאלה עולה לבד
      const playToEnd = { media: { video: { playToEnd: true } } };
      await t.open({
        leadersEvery: 1,
        autoTransition: playToEnd,
        slides: [Q(), Q({ open: 'clip.webm' }), Q()],
      });
      await t.step('שאלה 1', t.space());
      await t.playToReveal('שאלה 1');
      const waits = (s) => {
        const v = slideVideo(s);
        return v === undefined
          ? 'הסרטון לא נטען'
          : (!v.playing && v.t <= 0.3) || `הסרטון רץ מתחת לטבלה (${v.t}s)`;
      };
      await t.step(
        'שקופית 2 (סרטון פתיחה) עולה מאחורי הטבלה — הסרטון מחכה',
        t.space(),
        {
          sound: ['winnerslist.wav'],
          check: (s) => [s.leaders || 'הטבלה לא נפתחה', waits(s)],
        },
        1200,
      );
      await t.step('הטבלה עדיין למעלה — הסרטון עדיין מחכה', t.wait(3000), {
        sound: ['winnerslist.wav'],
        check: waits,
      });
      await t.step(
        'הטבלה נסגרה — הסרטון מתחיל מההתחלה, עם קול',
        t.space(),
        {
          sound: [],
          check: (s) => {
            const v = slideVideo(s);
            if (v === undefined) return 'הסרטון נעלם';
            return [
              v.playing || 'הסרטון לא מתנגן',
              !v.muted || 'הסרטון מושתק',
              v.t <= 2 || `הסרטון לא התחיל מההתחלה (${v.t}s)`,
            ];
          },
        },
        1200,
      );
      await t.step('הסרטון נגמר — השאלה עם הצליל שלה', t.wait(CLIP_S * 1000), {
        started: { 'q-sound.wav': 1 },
        sound: ['q-sound.wav'],
        check: (s) => s.question || 'השאלה לא מוצגת',
      });
    },
  },
  {
    name: 'video-slide-under-leaders',
    title: 'שקופית וידאו מתחת לטבלה האוטומטית',
    async run(t) {
      await t.open({ leadersEvery: 1, slides: [Q(), Q({ video: 'clip.webm' }), Q()] });
      await t.step('שאלה 1', t.space());
      await t.playToReveal('שאלה 1');
      const waits = (s) => {
        const v = slideVideo(s);
        return v === undefined
          ? 'הסרטון לא נטען'
          : (!v.playing && v.t <= 0.3) || `הסרטון רץ מתחת לטבלה (${v.t}s)`;
      };
      await t.step(
        'שקופית 2 (וידאו) עולה מאחורי הטבלה — הסרטון מחכה',
        t.space(),
        {
          sound: ['winnerslist.wav'],
          check: (s) => [s.leaders || 'הטבלה לא נפתחה', onSlide('2/3')(s), waits(s)],
        },
        1200,
      );
      await t.step('הטבלה עדיין למעלה — הסרטון עדיין מחכה', t.wait(3000), {
        sound: ['winnerslist.wav'],
        check: waits,
      });
      await t.step(
        'הטבלה נסגרה — הסרטון מתחיל מההתחלה, עם קול',
        t.space(),
        {
          sound: [],
          check: (s) => {
            const v = slideVideo(s);
            if (v === undefined) return 'הסרטון נעלם';
            return [
              v.playing || 'הסרטון לא מתנגן',
              !v.muted || 'הסרטון מושתק',
              v.t <= 2 || `הסרטון לא התחיל מההתחלה (${v.t}s)`,
            ];
          },
        },
        1200,
      );
    },
  },
  {
    name: 'media-under-manual',
    title: 'סרטון פתיחה מתחת לטבלה הידנית (1 ואז N)',
    async run(t) {
      await t.open({ slides: [Q(), Q({ open: 'clip.webm' }), Q()] });
      await t.step('שאלה 1', t.space(), { sound: ['q-sound.wav'] });
      await t.step('טבלה (1)', t.key('1'), { sound: ['winnerslist.wav'] });
      await t.step(
        'N מתחת לטבלה — שקופית 2 עם סרטון פתיחה, שמחכה',
        t.key('KeyN'),
        {
          sound: ['winnerslist.wav'],
          check: (s) => {
            const v = slideVideo(s);
            return [
              onSlide('2/3')(s),
              v === undefined
                ? 'הסרטון לא נטען'
                : (!v.playing && v.t <= 0.3) || `הסרטון רץ מתחת לטבלה (${v.t}s)`,
            ];
          },
        },
        1200,
      );
      await t.step(
        'הטבלה נסגרה (1) — הסרטון מתנגן, עם קול',
        t.key('1'),
        {
          sound: [],
          check: (s) => {
            const v = slideVideo(s);
            return v === undefined
              ? 'הסרטון נעלם'
              : [v.playing || 'הסרטון לא מתנגן', !v.muted || 'הסרטון מושתק'];
          },
        },
        1200,
      );
    },
  },
  {
    name: 'cover-backgrounds',
    title: 'הרקעים של המסכים המכסים ממשיכים לנגן',
    async run(t) {
      await t.open({
        leadersEvery: 1,
        backgrounds: true,
        slides: [Q(), Q({ open: 'clip.webm' }), Q()],
      });
      const bgPlays = (file) => (s) => {
        const v = s.media.find((m) => m.src === file);
        return v === undefined
          ? `הרקע ${file} לא מוצג`
          : [v.playing || `הרקע ${file} עצור`, v.muted || `הרקע ${file} לא מושתק`];
      };
      await t.step('מסך הפתיחה — הרקע שלו מתנגן', t.wait(1500), {
        sound: ['connecting.wav'],
        check: bgPlays('bg-game.webm'),
      });
      await t.step('שאלה 1', t.space());
      await t.step(
        'טבלה (1) — הרקע שלה מתנגן',
        t.key('1'),
        { sound: ['winnerslist.wav'], check: bgPlays('bg-leaders.webm') },
        1500,
      );
      await t.step('הטבלה נסגרה', t.key('1'));
      await t.playToReveal('שאלה 1');
      await t.step(
        'שקופית 2 מאחורי הטבלה האוטומטית — הרקע של הטבלה מתנגן, הסרטון של השקופית מחכה',
        t.space(),
        {
          sound: ['winnerslist.wav'],
          check: (s) => {
            const v = slideVideo(s);
            return [
              bgPlays('bg-leaders.webm')(s),
              v === undefined ? 'הסרטון לא נטען' : !v.playing || 'הסרטון רץ מתחת לטבלה',
            ];
          },
        },
        1500,
      );
      await t.step(
        'הטבלה נסגרה — הסרטון של השקופית מתנגן',
        t.space(),
        {
          check: (s) => slideVideo(s)?.playing || 'הסרטון לא מתנגן',
        },
        1000,
      );
      await t.step(
        'תצוגת המנצחים (W) — הרקע שלה מתנגן',
        t.key('KeyW'),
        { sound: ['winners.wav'], check: bgPlays('bg-winners.webm') },
        1500,
      );
      await t.step(
        'חזרה מהתצוגה (W) — הסרטון של השקופית מתנגן',
        t.key('KeyW'),
        { check: (s) => slideVideo(s)?.playing || 'הסרטון לא מתנגן' },
        1000,
      );
    },
  },
  {
    name: 'timer-under-leaders',
    title: 'טיימר ההצבעה מתחת לטבלה, ומקש 6',
    async run(t) {
      await t.open({ slides: [Q({ time: 30 }), Q()] });
      await t.step('שאלה 1', t.space());
      await t.step('התשובות', t.space(3));
      await t.step('הצבעה (30 שניות)', t.space(), { sound: ['timer.wav'] });
      await t.step(
        'טבלה (1) בזמן ההצבעה — הטיימר נעצר',
        t.key('1'),
        { sound: ['winnerslist.wav'] },
        800,
      );
      await t.step(
        '6 מתחת לטבלה — צליל הטיימר לא קוטע את הטבלה',
        t.key('6'),
        { sound: ['winnerslist.wav'] },
        1000,
      );
      await t.step('הטבלה נסגרה — הטיימר נשאר עצור (6)', t.key('1'), {
        sound: [],
        check: (s) => s.timer === '⏸' || `הטיימר ${s.timer ?? 'לא מוצג'} במקום עצור`,
      });
      await t.step('6 — הטיימר ממשיך', t.key('6'), {
        sound: ['timer.wav'],
        check: (s) => timerValue(s) !== null || 'הטיימר לא ממשיך',
      });
    },
  },
  {
    name: 'votes-during-pause',
    title: 'הצבעות שנשלחות בזמן עצירה (6) או מתחת לטבלה נספרות',
    async run(t) {
      const votes = await startVoteServer();
      try {
        const room = 5150;
        await t.open(
          { room, slides: [Q({ time: 8 }), Q({ time: 30 }), Q({ time: 30 }), Q()] },
          { voteServer: votes.url },
        );
        const LIVE = 700; // ההקשה עוברת דרך שרת ההצבעות
        const vote =
          (...pairs) =>
          async () => {
            for (const [phone, answer] of pairs) votes.vote(room, phone, answer);
          };
        const answered = (n) => (s) => s.answered === n || `ענו ${s.answered} במקום ${n}`;
        const scored = (n) => (s) => {
          const got = s.leaderScores.filter((score) => score > 0).length;
          return got === n || `בטבלה ${got} עם ניקוד במקום ${n} (${s.leaderScores.join(', ')})`;
        };
        const closed = (s) => s.timer === null || `הטיימר ${s.timer} עדיין מוצג`;

        // שאלה 1: אחד עונה לפני העצירה, שניים בזמנה, ואף אחד אחריה; הטיימר נגמר לבד
        await t.step('שאלה 1', t.space());
        await t.step('התשובות', t.space(3));
        await t.step('הצבעה (8 שניות)', t.space(), { sound: ['timer.wav'] });
        await t.step('טלפון 1 עונה נכון', vote(['0500000001', 1]), { check: answered(1) }, LIVE);
        await t.step('6 — עצירה', t.key('6'), {
          sound: [],
          check: (s) => s.timer === '⏸' || `הטיימר ${s.timer ?? 'לא מוצג'} במקום עצור`,
        });
        await t.step(
          'טלפונים 2 (נכון) ו-3 (לא נכון) עונים בזמן העצירה',
          vote(['0500000002', 1], ['0500000003', 2]),
          { sound: [] },
          LIVE,
        );
        await t.step('6 — ממשיכים, ואף אחד לא עונה אחרי: שלוש ההצבעות נקלטות', t.key('6'), {
          sound: ['timer.wav'],
          check: answered(3),
        });
        await t.step('הטיימר נגמר', t.wait(8500), {
          sound: [],
          check: (s) => [closed(s), answered(3)(s)],
        });
        await t.step('חשיפה', t.space());
        await t.step('טבלה (1): שני מי שענו נכון', t.key('1'), { check: scored(2) }, 600);
        await t.step('סגירת הטבלה', t.key('1'));

        // שאלה 2: שניים עונים בזמן העצירה, והמנחה סוגר את ההצבעה כשהיא עדיין עצורה
        await t.step('שאלה 2', t.space());
        await t.step('התשובות', t.space(3));
        await t.step('הצבעה', t.space(), { sound: ['timer.wav'] });
        await t.step('6 — עצירה', t.key('6'), { sound: [] });
        await t.step(
          'טלפונים 2 ו-4 עונים נכון בזמן העצירה',
          vote(['0500000002', 1], ['0500000004', 1]),
          {},
          LIVE,
        );
        await t.step('סגירת ההצבעה (רווח) בזמן העצירה: שתי ההצבעות נקלטות', t.space(), {
          check: (s) => [closed(s), answered(2)(s)],
        });
        await t.step('חשיפה', t.space());
        await t.step('טבלה (1): שלושה עם ניקוד', t.key('1'), { check: scored(3) }, 600);
        await t.step('סגירת הטבלה', t.key('1'));

        // שאלה 3: אחד עונה מתחת לטבלה שנפתחה בזמן ההצבעה, ואף אחד אחריו
        await t.step('שאלה 3', t.space());
        await t.step('התשובות', t.space(3));
        await t.step('הצבעה', t.space(), { sound: ['timer.wav'] });
        await t.step('טבלה (1) בזמן ההצבעה', t.key('1'), { sound: ['winnerslist.wav'] }, 600);
        await t.step('טלפון 3 עונה נכון מתחת לטבלה', vote(['0500000003', 1]), {}, LIVE);
        await t.step('הטבלה נסגרה, ואף אחד לא עונה אחרי: ההצבעה נקלטת', t.key('1'), {
          sound: ['timer.wav'],
          check: answered(1),
        });
        await t.step('סגירה וחשיפה', t.space(2), { check: answered(1) });
        await t.step('טבלה (1): ארבעה עם ניקוד', t.key('1'), { check: scored(4) }, 600);
      } finally {
        await votes.close();
      }
    },
  },
  {
    name: 'back-after-leaders',
    title: 'חזרה לשקופית שאחריה נפתחה טבלה אוטומטית',
    async run(t) {
      await t.open({ leadersEvery: 2, slides: [Q(), Q(), Q(), Q(), Q()] });
      await t.step('שאלה 1', t.space());
      await t.playToReveal('שאלה 1');
      await t.step('שאלה 2', t.space());
      await t.playToReveal('שאלה 2');
      await t.step('שאלה 3 מאחורי הטבלה האוטומטית', t.space(), {
        check: (s) => s.leaders || 'הטבלה לא נפתחה',
      });
      await t.step('הטבלה נסגרה', t.space(), { sound: ['q-sound.wav'] });
      await t.playToReveal('שאלה 3');
      await t.step('שאלה 4', t.space(), { check: onSlide('4/5') });
      await t.step(
        'Backspace — חזרה לשאלה 3, בלי הטבלה שוב',
        t.key('Backspace'),
        {
          started: { 'q-sound.wav': 1 },
          sound: ['q-sound.wav'],
          check: (s) => [onSlide('3/5')(s), !s.leaders || 'הטבלה נפתחה שוב'],
        },
        800,
      );
    },
  },
  {
    name: 'refresh-lobby',
    title: 'רענון קובץ המשחק במסך הפתיחה',
    async run(t) {
      await t.open({ slides: [Q(), Q()] });
      await t.step('מסך הפתיחה', t.wait(1000), { sound: ['connecting.wav'] });
      await t.step(
        'Shift+R — המוזיקה ממשיכה, לא מתחילה מחדש',
        t.key('Shift+KeyR'),
        {
          quiet: true,
          sound: ['connecting.wav'],
        },
        2000,
      );
    },
  },
  {
    name: 'auto-skip',
    title: 'מעבר אוטומטי סופר מהחשיפה, ולא מתחת לטבלה',
    async run(t) {
      await t.open({ slides: [Q({ autoSkip: 2 }), Q({ autoSkip: 3 }), Q(), Q()] });
      await t.step('שאלה 1 (מעבר אוטומטי אחרי 2 שניות)', t.space());
      await t.step('התשובות', t.space(3));
      await t.step('הצבעה', t.space());
      await t.step('סגירת ההצבעה, בלי חשיפה', t.space());
      await t.step('3 שניות בלי חשיפה — נשארים', t.wait(3000), { check: onSlide('1/4') });
      await t.step('חשיפה', t.space(), { check: (s) => s.correct > 0 || 'התשובה הנכונה לא סומנה' });
      await t.step('שנייה אחרי החשיפה — עוד לא', t.wait(1000), { check: onSlide('1/4') });
      await t.step('אחרי 2 שניות — שאלה 2, עם הצליל', t.wait(2500), {
        started: { 'q-sound.wav': 1 },
        check: onSlide('2/4'),
      });
      await t.playToReveal('שאלה 2 (מעבר אוטומטי אחרי 3 שניות)');
      await t.step('טבלה (1) מיד אחרי החשיפה', t.key('1'));
      await t.step('4 שניות מתחת לטבלה — נשארים', t.wait(4000), { check: onSlide('2/4') });
      await t.step('הטבלה נסגרה (1)', t.key('1'));
      await t.step('שנייה וחצי אחרי — עוד לא (הספירה מתחילה מחדש)', t.wait(1500), {
        check: onSlide('2/4'),
      });
      await t.step('אחרי 3 שניות — שאלה 3', t.wait(3000), { check: onSlide('3/4') });
    },
  },
  {
    name: 'winners-voting',
    title: 'תצוגת המנצחים (W) בזמן הצבעה',
    async run(t) {
      await t.open({ slides: [Q({ time: 30 }), Q()] });
      await t.step('שאלה 1', t.space());
      await t.step('התשובות', t.space(3));
      await t.step('הצבעה (30 שניות)', t.space(), { sound: ['timer.wav'] });
      let before = null;
      await t.step('הטיימר רץ', t.wait(1500), {
        check: (s) => (before = timerValue(s)) !== null || 'אין טיימר',
      });
      await t.step(
        'W — מוזיקת המנצחים, הטיימר מחכה',
        t.key('KeyW'),
        {
          sound: ['winners.wav'],
          check: (s) => s.winners || 'מסך המנצחים לא מוצג',
        },
        600,
      );
      await t.step('שתי שניות וחצי על התצוגה', t.wait(2500), { sound: ['winners.wav'] });
      const resumed = (s) => {
        const now = timerValue(s);
        if (now === null) return `אין טיימר (${s.timer ?? 'ההצבעה נסגרה'})`;
        const was = before;
        before = now;
        return [
          now <= was || `הטיימר התחיל מחדש (${was} → ${now})`,
          now >= was - 2 || `הטיימר רץ מתחת לתצוגה (${was} → ${now})`,
          s.answers === 3 || 'התשובות לא מוצגות',
        ];
      };
      await t.step('W שוב — חזרה לאותה הצבעה, הטיימר ממשיך מאיפה שעצר', t.key('KeyW'), {
        sound: ['timer.wav'],
        check: resumed,
      });
      await t.step('W שוב', t.key('KeyW'), { sound: ['winners.wav'] }, 600);
      await t.step('שתי שניות על התצוגה', t.wait(2000));
      await t.step('2 — חזרה לאותה הצבעה, הטיימר ממשיך', t.key('2'), {
        sound: ['timer.wav'],
        check: resumed,
      });
      await t.step('סגירת ההצבעה', t.space(), {
        sound: [],
        check: (s) => s.timer === null || 'הטיימר עדיין מוצג',
      });
    },
  },
  {
    name: 'winners-end',
    title: 'סוף המשחק אחרי תצוגת מנצחים, ו-2 במסך המנצחים',
    async run(t) {
      await t.open({ slides: [Q(), Q(), Q()] }, { backup: {} });
      await t.step('שאלה 1', t.space(), { sound: ['q-sound.wav'] });
      await t.step('W', t.key('KeyW'), { sound: ['winners.wav'] }, 600);
      await t.step(
        '2 — חזרה מהתצוגה, צליל השאלה פעם אחת',
        t.key('2'),
        {
          started: { 'q-sound.wav': 1 },
          sound: ['q-sound.wav'],
          check: (s) => [onSlide('1/3')(s), !s.winners || 'מסך המנצחים עדיין מוצג'],
        },
        600,
      );
      await t.playToReveal('שאלה 1');
      for (const n of [2, 3]) {
        await t.step(`שאלה ${n}`, t.space());
        await t.playToReveal(`שאלה ${n}`);
      }
      await t.step(
        'סוף המשחק — מסך המנצחים וסגירת הגיבוי, בלי הורדה מול הקהל',
        t.space(),
        {
          sound: ['winners.wav'],
          check: (s) => [
            s.winners || 'מסך המנצחים לא מוצג',
            // התוצאות נשמרות בשרת, ולכן הקובץ לא יורד מעצמו בחלון שעל המקרן.
            t.downloads.length === 0 || `קובץ התוצאות ירד ${t.downloads.length} פעמים מול הקהל`,
            t.backupPosts().some((p) => p.path === '/save-backup/game-over') ||
              'סוף המשחק לא נשלח לגיבוי',
          ],
        },
        2500,
      );
      await t.step(
        '2 במסך המנצחים האמיתי — לא קורה כלום',
        t.key('2'),
        {
          quiet: true,
          sound: ['winners.wav'],
          check: (s) => s.winners || 'מסך המנצחים נעלם',
        },
        800,
      );
      await t.step('רווח — חושף מנצח', t.space(), { check: (s) => s.podium > 0 || 'לא נחשף מנצח' });
      await t.openHostConsole();
      await t.step(
        'מסך המנחה: «הורדת קובץ התוצאות» — יורד שם, לא בחלון המשחק',
        t.hostClick(/הורדת קובץ התוצאות/),
        {
          quiet: true,
          check: () => [
            t.hostDownloads.length === 1 ||
              `קובץ התוצאות ירד ${t.hostDownloads.length} פעמים במסך המנחה`,
            t.downloads.length === 0 || 'קובץ התוצאות ירד גם בחלון המשחק',
          ],
        },
        1500,
      );
      await t.step(
        'תפריט המפעיל: «הורדת קובץ התוצאות»',
        async () => {
          await t.key('Escape')();
          await sleep(300);
          await t.click(/הורדת קובץ התוצאות/)();
        },
        {
          quiet: true,
          check: () => t.downloads.length === 1 || `קובץ התוצאות ירד ${t.downloads.length} פעמים`,
        },
        1500,
      );
    },
  },
  {
    name: 'fast-forward-end',
    title: 'N בשקופית האחרונה מתחת לטבלה',
    async run(t) {
      await t.open({ slides: [Q(), Q(), Q()] });
      for (const n of [1, 2]) {
        await t.step(`שאלה ${n}`, t.space());
        await t.playToReveal(`שאלה ${n}`);
      }
      await t.step('שאלה 3 (האחרונה)', t.space());
      await t.step('טבלה (1)', t.key('1'), { sound: ['winnerslist.wav'] });
      await t.step(
        'N — מסך המנצחים, והטבלה נסגרה',
        t.key('KeyN'),
        {
          sound: ['winners.wav'],
          check: (s) => s.winners || 'מסך המנצחים לא מוצג',
        },
        1000,
      );
      await t.step('רווח — חושף מנצח', t.space(), {
        check: (s) => s.podium === 1 || `נחשפו ${s.podium} מנצחים במקום 1`,
      });
    },
  },
  {
    name: 'going-back',
    title: 'חזרה אחורה: 2 ו-Backspace',
    async run(t) {
      await t.open({ slides: [Q({ time: 30 }), Q(), Q()] });
      await t.step('שאלה 1', t.space(), { sound: ['q-sound.wav'] });
      await t.step('2 — השאלה מוסתרת', t.key('2'), {
        check: (s) => !s.question || 'השאלה עדיין מוצגת',
      });
      await t.step('2 שוב בשאלה הראשונה — לא קורה כלום', t.key('2'), {
        quiet: true,
        check: (s) => [onSlide('1/3')(s), !s.question || 'השאלה עלתה שוב'],
      });
      await t.step('רווח — השאלה חוזרת', t.space(), {
        check: (s) => s.question || 'השאלה לא מוצגת',
      });
      await t.step('התשובות', t.space(3));
      await t.step('הצבעה', t.space(), { sound: ['timer.wav'] });
      await t.step('2 בזמן ההצבעה — חזרה לכל התשובות, בלי צליל', t.key('2'), {
        started: { 'q-sound.wav': 0 },
        sound: [],
        check: (s) => [
          s.question || 'השאלה לא מוצגת',
          s.answers === 3 || `מוצגות ${s.answers} תשובות במקום 3`,
          s.timer === null || 'הטיימר עדיין מוצג',
          s.correct === 0 || 'התשובה הנכונה מסומנת',
        ],
      });
      await t.step('רווח — ההצבעה נפתחת מההתחלה', t.space(), {
        sound: ['timer.wav'],
        check: (s) => (timerValue(s) ?? 0) >= 29 || `הטיימר ${s.timer} במקום 30`,
      });
      await t.step('סגירה וחשיפה', t.space(2), {
        check: (s) => s.correct > 0 || 'התשובה הנכונה לא סומנה',
      });
      await t.step(
        'Backspace בשאלה הראשונה — היא מתחילה נקייה, עם הצליל',
        t.key('Backspace'),
        {
          started: { 'q-sound.wav': 1 },
          sound: ['q-sound.wav'],
          check: (s) => [
            onSlide('1/3')(s),
            s.correct === 0 || 'התשובה הנכונה עדיין מסומנת',
            s.answers === 0 || `מוצגות ${s.answers} תשובות`,
          ],
        },
        800,
      );
      await t.step('רווח — התשובה הראשונה', t.space(), {
        check: (s) => [
          s.answers === 1 || `מוצגות ${s.answers} תשובות במקום 1`,
          s.correct === 0 || 'התשובה הנכונה מסומנת',
        ],
      });
    },
  },
  {
    name: 'restart',
    title: 'התחלה מחדש כשעומדים בשאלה 1',
    async run(t) {
      await t.open({ slides: [Q(), Q(), Q()] });
      await t.step('שאלה 1', t.space(), { sound: ['q-sound.wav'] });
      await t.step('התחלה מחדש מההגדרות', t.restartFromSettings(), {
        sound: ['connecting.wav'],
        check: onOpening,
      });
      await t.step('רווח — שאלה 1 עולה שוב, עם הצליל', t.space(), {
        started: { 'q-sound.wav': 1 },
        sound: ['q-sound.wav'],
        check: (s) => [onSlide('1/3')(s), s.question || 'השאלה לא מוצגת'],
      });
    },
  },
  {
    name: 'startup-license',
    title: 'מקשים ומסך המנחה מאחורי אזהרת הרישיון',
    async run(t) {
      await t.open({ slides: [Q(), Q()] }, { license: 'leave' });
      await t.openHostConsole();
      await t.step('אזהרת הרישיון על המסך', t.wait(0), {
        sound: ['connecting.wav'],
        check: (s) => s.dialogs.includes('אין רישיון פעיל') || 'האזהרה לא מוצגת',
      });
      await t.step(
        'מקשים מאחוריה — לא קורה כלום',
        t.keys(['Space', 'Space', 'Digit1', 'Digit3', 'KeyW', 'KeyN', 'Digit6']),
        {
          quiet: true,
          sound: ['connecting.wav'],
          check: (s) => [onOpening(s), !s.leaders || 'הטבלה נפתחה'],
        },
      );
      await t.step('«קדימה» במסך המנחה — לא קורה כלום', t.forward(2), {
        quiet: true,
        check: onOpening,
      });
      await t.step('«הבנתי»', t.click('הבנתי'), {
        sound: ['connecting.wav'],
        check: (s) => s.dialogs.length === 0 || 'האזהרה עדיין מוצגת',
      });
      await t.step('רווח — שאלה 1 עם הצליל', t.space(), {
        started: { 'q-sound.wav': 1 },
        sound: ['q-sound.wav'],
        check: onSlide('1/2'),
      });
      await t.step('«קדימה» במסך המנחה — תשובה', t.forward(), {
        check: (s) => s.answers === 1 || `מוצגות ${s.answers} תשובות`,
      });
    },
  },
  {
    name: 'startup-resume',
    title: 'מקשים מאחורי «נמצא משחק פעיל», ושתי התשובות',
    async run(t) {
      const saved = {
        id: 'sound-e2e-startup-resume',
        users: '{}',
        questions: '{}',
        groups: '[]',
        meta: JSON.stringify({ currentQueId: 2, phase: 'showing', startedAt: Date.now() - 60_000 }),
        completed: false,
      };
      // גיבוי יש רק למשחק עם קוד חדר (רישיון) — ולכן גם בלי אזהרת הרישיון
      const spec = { room: 4321, slides: [Q(), Q(), Q(), Q()] };
      await t.open(spec, { backup: saved });
      await t.openHostConsole();
      await t.step('«נמצא משחק פעיל» על המסך', t.wait(800), {
        sound: ['connecting.wav'],
        check: (s) => s.dialogs.includes('נמצא משחק פעיל') || 'החלון לא מוצג',
      });
      await t.step(
        'מקשים מאחוריו — לא קורה כלום',
        t.keys(['Space', 'Space', 'Digit1', 'KeyW', 'KeyN']),
        {
          quiet: true,
          check: onOpening,
        },
      );
      await t.step('«קדימה» במסך המנחה — לא קורה כלום', t.forward(2), {
        quiet: true,
        check: onOpening,
      });
      await t.step(
        '«המשך מהנקודה» — שקופית 2 עם צליל השאלה',
        t.click(/המשך מהנקודה/),
        {
          started: { 'q-sound.wav': 1 },
          sound: ['q-sound.wav'],
          check: (s) => [onSlide('2/4')(s), s.question || 'השאלה לא מוצגת'],
        },
        800,
      );
      await t.open(spec, { backup: saved });
      await t.step('טעינה מחדש — החלון שוב', t.wait(800), {
        check: (s) => s.dialogs.includes('נמצא משחק פעיל') || 'החלון לא מוצג',
      });
      await t.step('«משחק חדש» — מסך הפתיחה, המוזיקה ממשיכה', t.click('משחק חדש'), {
        quiet: true,
        sound: ['connecting.wav'],
        check: onOpening,
      });
      await t.step('רווח — שאלה 1 עם הצליל', t.space(), {
        started: { 'q-sound.wav': 1 },
        sound: ['q-sound.wav'],
        check: onSlide('1/4'),
      });
    },
  },
  {
    name: 'host-console',
    title: 'מסך המנחה בלשונית נפרדת',
    async run(t) {
      await t.open({ leadersEvery: 1, slides: [Q(), Q(), Q()] });
      await t.openHostConsole();
      await t.step('«קדימה» — שאלה 1 עם הצליל', t.forward(), {
        started: { 'q-sound.wav': 1 },
        sound: ['q-sound.wav'],
      });
      await t.step('התשובות', t.forward(3), { sound: ['q-sound.wav'] });
      await t.step('הצבעה', t.forward(), { sound: ['timer.wav'] });
      await t.step('סגירה וחשיפה', t.forward(2));
      await t.step('שאלה 2 מאחורי הטבלה האוטומטית', t.forward(), {
        started: { 'q-sound.wav': 0 },
        sound: ['winnerslist.wav'],
      });
      await t.step('«קדימה» סוגר את הטבלה — צליל השאלה פעם אחת', t.forward(), {
        started: { 'q-sound.wav': 1 },
        sound: ['q-sound.wav'],
      });
    },
  },
  {
    name: 'live-viewer',
    title: 'מסך הצפייה שומע מה שהאולם שומע (#235)',
    async run(t, { newContext }) {
      const relay = startRelay({ port: 0 });
      try {
        const address = await relay.ready;
        const relayBase = `http://127.0.0.1:${address.port}/live`;
        const room = 4321;
        const game = await t.open(
          { leadersEvery: 1, room, slides: [Q({ time: 30 }), Q(), Q()] },
          { relayBase },
        );
        const publishKey = createHash('sha256')
          .update(`trivia-live-pub:v1:${game.id}:${room}`)
          .digest('hex');
        const viewUrl = `${BASE}/?view=${viewTokenFor(publishKey)}&liveRelay=${encodeURIComponent(relayBase)}`;
        await t.openViewer(await newContext(), viewUrl);
        const LIVE = 900; // הצופה מקבל את העדכונים דרך הממסר
        const both = (expect) => ({ ...expect, viewer: expect });
        await t.step('מסך הפתיחה', t.wait(0), both({ sound: ['connecting.wav'] }), LIVE);
        await t.step(
          'שאלה 1',
          t.space(),
          both({ started: { 'q-sound.wav': 1 }, sound: ['q-sound.wav'] }),
          LIVE,
        );
        await t.step('התשובות', t.space(3), both({ sound: ['q-sound.wav'] }), LIVE);
        await t.step('הצבעה', t.space(), both({ sound: ['timer.wav'] }), LIVE);
        await t.step(
          'מחיאות כפיים (3) בזמן ההצבעה — מעל הטיימר, אצל כולם',
          t.key('3'),
          both({ sound: ['applause.wav', 'timer.wav'] }),
          LIVE,
        );
        await t.step(
          'הן נגמרו — הטיימר בווליום מלא אצל כולם',
          t.wait(APPLAUSE_S * 1000),
          both({ sound: ['timer.wav'] }),
          LIVE,
        );
        await t.step('סגירה וחשיפה', t.space(2), {}, LIVE);
        await t.step(
          'שאלה 2 מאחורי הטבלה האוטומטית',
          t.space(),
          both({ sound: ['winnerslist.wav'] }),
          LIVE,
        );
        await t.step(
          'הטבלה נסגרה — צליל השאלה אצל כולם',
          t.space(),
          both({ started: { 'q-sound.wav': 1 }, sound: ['q-sound.wav'] }),
          LIVE,
        );
      } finally {
        await relay.close();
      }
    },
  },
];

// ---------------------------------------------------------------------------
// הרצה ודיווח
// ---------------------------------------------------------------------------

function screenText(s) {
  const marks = [
    s.leaders && 'טבלה',
    s.winners && `מנצחים${s.podium ? ` ${s.podium}` : ''}`,
    s.scoreboard && 'ניקוד',
    s.dialogs.length > 0 && s.dialogs.join('/'),
    s.timer !== null && `טיימר ${s.timer}`,
    s.answered > 0 && `ענו ${s.answered}`,
    s.correct > 0 && 'נכונה מסומנת',
  ].filter(Boolean);
  const media = s.media
    .map((m) => `${m.src}${m.playing ? ' מתנגן' : ' עצור'}${m.muted ? ' מושתק' : ''} ${m.t}s`)
    .join('; ');
  // מונה השקופיות מוצג רק בזמן המשחק; בלעדיו ובלי מסך מנצחים — מסך הפתיחה
  const place = s.counter || (s.winners || s.scoreboard ? '' : 'פתיחה');
  const head = [place, ...marks].filter(Boolean).join(' · ');
  return `[${head}] נשמע: ${listText(names(s.sound))}${media ? ` | מדיה: ${media}` : ''}`;
}

function report(scenario, result) {
  const failed = result.steps.filter((s) => s.problems.length > 0).length + (result.crash ? 1 : 0);
  const lines = [`━━ ${scenario.name} — ${scenario.title}`];
  for (const s of result.steps) {
    lines.push(`  ${s.problems.length === 0 ? '✓' : '✗'} ${s.name}`);
    lines.push(`      ${eventsText(s.events)}`);
    lines.push(`      ${screenText(s.screen)}`);
    if (s.viewer)
      lines.push(`      צופה: ${eventsText(s.viewer.events)} · ${screenText(s.viewer.screen)}`);
    for (const p of s.problems) lines.push(`      ✗ ${p}`);
  }
  if (result.crash) lines.push(`  ✗ התרחיש נפל: ${result.crash}`);
  if (result.errors.length > 0)
    lines.push(`  שגיאות בדף: ${result.errors.slice(0, 5).join(' | ')}`);
  return { failed, text: lines.join('\n') };
}

if (argv.includes('--list')) {
  for (const s of SCENARIOS) console.log(`${s.name.padEnd(22)}${s.title}`);
  process.exit(0);
}
const unknown = ONLY.filter((n) => !SCENARIOS.some((s) => s.name === n));
if (unknown.length > 0) {
  console.error(`תרחיש לא מוכר: ${unknown.join(', ')} (npm run e2e:sound -- --list)`);
  process.exit(2);
}
if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`אין בנייה ב-${DIST} — קודם npm run build (או ‎--dist=‎)`);
  process.exit(2);
}

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
Object.values(SOUNDS).forEach(([file, seconds], i) =>
  writeFileSync(join(FX, file), wav(seconds, 360 + 60 * i)),
);

browser = await chromium.launch({
  ...(existsSync('/opt/pw-browsers/chromium')
    ? { executablePath: '/opt/pw-browsers/chromium' }
    : process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : { channel: 'chrome' }),
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const contextOptions = {
  viewport: { width: 1280, height: 720 },
  serviceWorkers: 'block',
  acceptDownloads: true,
};
const newContext = async () => {
  const context = await browser.newContext(contextOptions);
  await context.addInitScript(instrument);
  return context;
};

if (OUT !== null) mkdirSync(OUT, { recursive: true });
const selected = ONLY.length > 0 ? SCENARIOS.filter((s) => ONLY.includes(s.name)) : SCENARIOS;
const summary = [];
for (const scenario of selected) {
  const result = { steps: [], errors: [], crash: null };
  const contexts = [await newContext()];
  const t = makeTester(scenario, contexts[0], result);
  try {
    await scenario.run(t, {
      newContext: async () => {
        const c = await newContext();
        contexts.push(c);
        return c;
      },
    });
  } catch (err) {
    result.crash = err instanceof Error ? err.message.split('\n')[0] : String(err);
  } finally {
    for (const c of contexts) await c.close();
  }
  const { failed, text } = report(scenario, result);
  summary.push({ name: scenario.name, failed, steps: result.steps.length });
  if (failed > 0 || VERBOSE) console.log(`${text}\n`);
  else console.log(`✓ ${scenario.name} — ${scenario.title} (${result.steps.length} צעדים)`);
  if (OUT !== null) writeFileSync(join(OUT, `${scenario.name}.txt`), `${text}\n`);
}

await browser.close();
server.close();
rmSync(FX, { recursive: true, force: true });

const bad = summary.filter((s) => s.failed > 0);
const log = OUT ? ` · יומן: ${OUT}` : '';
const passed = summary.length === 1 ? 'התרחיש עבר' : `כל ${summary.length} התרחישים עברו`;
console.log(
  bad.length === 0
    ? `\n${passed}${log}`
    : `\n${bad.length} מתוך ${summary.length} תרחישים נכשלו: ${bad.map((s) => s.name).join(', ')}${log}`,
);
process.exit(bad.length === 0 ? 0 : 1);
