#!/usr/bin/env node
/**
 * בדיקת הקריינות מול המעבר האוטומטי ומקש N, מקצה לקצה: המשחק האמיתי (dist, אחרי
 * npm run build) ב-Chromium, עם קובץ משחק שיש בו קריינות. כל קטע קריינות שמתחיל
 * להתנגן (Web Audio) נרשם עם השעה והאורך שלו, וגם כל קטע שנעצר לפני סופו. לצדם
 * נרשמים המעברים האוטומטיים, המקשים והמסך (כמה תשובות גלויות), וכך רואים אם
 * הקריין הספיק לסיים לפני שהמסך זז.
 *
 *   npm run build && node tools/narration-e2e.mjs              # כל התרחישים
 *   node tools/narration-e2e.mjs auto-reveal fast-next          # רק אלה
 *   node tools/narration-e2e.mjs --verbose                      # כל ציר הזמן גם כשהכול עבר
 *   node tools/narration-e2e.mjs --list                         # רשימת התרחישים
 *
 * הקטעים הם צלילי סינוס (WAV) באורך ידוע, והשרת המקומי יכול לעכב כל אחד
 * (‎?d=<ms>‎), כדי לדמות רשת איטית באולם. שום דבר לא יוצא לרשת.
 *
 * דפדפן: playwright-core עם Chromium המותקן (/opt/pw-browsers/chromium אם קיים,
 * אחרת CHROMIUM_PATH או ערוץ chrome), מושתק (‎--mute-audio‎: הניגון והאירועים
 * כרגיל, בלי רעש). קוד יציאה 1 אם בדיקה כלשהי נכשלה. לעולם לא מריץ playwright install.
 */

import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const DIST = resolve(argv.find((a) => a.startsWith('--dist='))?.slice(7) ?? join(ROOT, 'dist'));
const VERBOSE = argv.includes('--verbose');
const ONLY = argv.filter((a) => !a.startsWith('--'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// הקטעים: WAV מונו באורך ידוע
// ---------------------------------------------------------------------------

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

const FX = mkdtempSync(join(tmpdir(), 'narration-e2e-'));
let freq = 300;
const written = new Set();
/**
 * כותב קטע באורך נתון (פעם אחת לכל נתיב) ומחזיר את הנתיב. קטעי השקופיות של כל
 * תרחיש יושבים בתיקייה משלו: q1.wav של תרחיש אחד אינו באורך של q1.wav של אחר.
 */
function clipFile(file, seconds) {
  if (!written.has(file)) {
    mkdirSync(dirname(join(FX, file)), { recursive: true });
    writeFileSync(join(FX, file), wav(seconds, (freq += 17)));
    written.add(file);
  }
  return file;
}

// ---------------------------------------------------------------------------
// קובץ המשחק
// ---------------------------------------------------------------------------

/** שאלת טריוויה עם שלוש תשובות וקטעי קריינות לשאלה ולכל תשובה. */
function trivia(id, { time = 8, narration }) {
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
    narration,
    type: 'trivia',
    id,
  };
}

/**
 * spec: slides (לכל שאלה questionSeconds), delay (‎ms‎ לכל קטע, רשת איטית),
 * autoTransition (setting.autoTransition).
 */
function gameFile(name, spec) {
  const delay = spec.delay ?? 0;
  const url = (file) => `${BASE}/fx/${file}${delay > 0 ? `?d=${delay}` : ''}`;
  const bank = {
    flow_question_number: url(clipFile('bank-question-number.wav', 0.9)),
    flow_answer_number: url(clipFile('bank-answer-number.wav', 0.6)),
    num_f_1: url(clipFile('bank-1.wav', 0.4)),
    num_f_2: url(clipFile('bank-2.wav', 0.4)),
    num_f_3: url(clipFile('bank-3.wav', 0.4)),
    flow_vote_open: url(clipFile('bank-vote-open.wav', 0.9)),
    timer_times_up: url(clipFile('bank-times-up.wav', 0.9)),
  };
  return {
    name: `בדיקת קריינות: ${name}`,
    id: `narration-e2e-${name}`,
    cloudinaryFolder: 'test',
    setting: {
      titleThroughoutGame: 'בדיקת קריינות',
      ansIsNumber: true,
      multiWinners: 3,
      showWinnersListAfter: null,
      mainColor: '#EBBD34',
      secondaryColor: '#3A00F8',
      gameMedia: { src: '' },
      logo: { src: '' },
      triviaMedia: { src: '' },
      winnersMedia: { src: '' },
      winnersListMedia: { src: '' },
      sound: Object.fromEntries(
        [
          'genericMediaSound',
          'timerMediaSound',
          'inShowAnsMediaSound',
          'winnersMediaSound',
          'winnersListMediaSound',
          'playersConnectingMediaSound',
          'showQuestionMediaSound',
        ].map((key) => [key, { src: '' }]),
      ),
      limit: { type: 'clickers', number: 100 },
      ...(spec.autoTransition === undefined ? {} : { autoTransition: spec.autoTransition }),
      narration: { enabled: true, voice: 'test', announceQuestionNumber: true, bank, groups: {} },
    },
    questions: spec.slides.map((s, i) => {
      const id = i + 1;
      return trivia(id, {
        time: s.time,
        narration: {
          question: url(clipFile(`${name}/q${id}.wav`, s.questionSeconds ?? 3)),
          answers: [1, 2, 3].map((k) => url(clipFile(`${name}/q${id}-answer${k}.wav`, 1.2))),
          correct: null,
        },
      });
    }),
    users: '{}',
  };
}

// ---------------------------------------------------------------------------
// השרת: dist וקובצי הבדיקה (‎/fx/‎, עם עיכוב ‎?d=‎)
// ---------------------------------------------------------------------------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wav': 'audio/wav',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

const server = createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://localhost');
  const path = decodeURIComponent(u.pathname);
  const [root, rel] = path.startsWith('/fx/')
    ? [FX, path.slice('/fx/'.length)]
    : [DIST, path === '/' ? 'index.html' : path.slice(1)];
  const file = normalize(join(root, rel));
  if (!file.startsWith(root + sep) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  const send = () => {
    const ext = file.slice(file.lastIndexOf('.'));
    res.writeHead(200, {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Content-Length': statSync(file).size,
      'Access-Control-Allow-Origin': '*',
    });
    createReadStream(file).pipe(res);
  };
  const delay = Number(u.searchParams.get('d') ?? 0);
  if (delay > 0) setTimeout(send, delay);
  else send();
});
await new Promise((r) => server.listen(Number(process.env.NARR_PORT ?? 0), '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ---------------------------------------------------------------------------
// המכשור בדף: כל קטע קריינות שמתחיל, כל קטע שנעצר לפני סופו, המעברים והמסך
// ---------------------------------------------------------------------------

function instrument() {
  const log = [];
  window.__narr = log;
  const t0 = performance.now();
  const now = () => Math.round(performance.now() - t0);
  const urlOfBytes = new WeakMap();
  const urlOfBuffer = new WeakMap();
  const name = (url) => (url ? url.split('/').pop().split('?')[0] : '?');

  const arrayBuffer = Response.prototype.arrayBuffer;
  Response.prototype.arrayBuffer = async function () {
    const bytes = await arrayBuffer.call(this);
    urlOfBytes.set(bytes, this.url);
    return bytes;
  };
  const decode = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = function (bytes, ...rest) {
    const url = urlOfBytes.get(bytes);
    return decode.call(this, bytes, ...rest).then((buffer) => {
      if (url) urlOfBuffer.set(buffer, url);
      return buffer;
    });
  };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when = 0, ...rest) {
    const url = urlOfBuffer.get(this.buffer);
    if (url && url.includes('/fx/')) {
      const at = now() + Math.max(0, (when - this.context.currentTime) * 1000);
      const dur = this.buffer.duration * 1000;
      const rec = { op: 'clip', clip: name(url), at: Math.round(at), dur: Math.round(dur), cut: null };
      log.push(rec);
      this.__rec = rec;
    }
    return start.call(this, when, ...rest);
  };
  const stop = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.stop = function (...args) {
    const rec = this.__rec;
    if (rec && rec.cut === null && now() < rec.at + rec.dur - 40) rec.cut = now();
    return stop.apply(this, args);
  };

  const debug = console.debug;
  console.debug = function (...args) {
    const m = /^%c\[(\w+)\]%c (.*)$/s.exec(String(args[0] ?? ''));
    if (m && (m[1] === 'auto' || m[1] === 'narration' || m[1] === 'command')) {
      log.push({ op: m[1], msg: m[2], at: now() });
    }
    return debug.apply(this, args);
  };

  const snap = () => {
    const q = (s) => document.querySelector(s);
    const counter = q('.slide-counter')?.textContent?.trim() ?? '';
    if (counter === '') return '';
    const question = q('.q-question:not(.reveal-hidden)') !== null;
    const answers = document.querySelectorAll('.q-card:not(.reveal-hidden)').length;
    const timer = q('.q-count-num') !== null;
    return `שקופית ${counter} · ${question ? 'שאלה' : 'בלי שאלה'} · ${answers} תשובות${timer ? ' · טיימר' : ''}`;
  };
  let last = '';
  const observe = () => {
    new MutationObserver(() => {
      const s = snap();
      if (s !== last) {
        last = s;
        if (s !== '') log.push({ op: 'screen', msg: s, at: now() });
      }
    }).observe(document.documentElement, {
      subtree: true,
      childList: true,
      // מונה השקופית מתחלף בתוך אותו צומת טקסט (בלי שום שינוי מבנה או class)
      characterData: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  };
  if (document.documentElement) observe();
  else document.addEventListener('DOMContentLoaded', observe);
}

// ---------------------------------------------------------------------------
// הבודק
// ---------------------------------------------------------------------------

async function openGame(context, scenario, spec) {
  const game = gameFile(scenario.name, spec);
  writeFileSync(join(FX, `${scenario.name}.json`), JSON.stringify(game));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => void d.accept());
  const query = new URLSearchParams({ game: `${BASE}/fx/${scenario.name}.json`, demo: '1' });
  await page.goto(`${BASE}/?${query}`);
  try {
    await page.getByRole('button', { name: /התחל משחק/ }).click({ timeout: 20000 });
  } catch (err) {
    const text = await page.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => '');
    throw new Error(`אין «התחל משחק» (${errors.join(' | ') || 'בלי שגיאות'}): ${text.replace(/\s+/g, ' ')}`);
  }
  await page.locator('.lobby-screen').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'הבנתי' }).click({ timeout: 10000 });
  await sleep(spec.lobbyMs ?? 1500);
  await page.evaluate(() => window.__narr.splice(0)); // מתחילים את היומן מתחילת המשחק
  return { page, errors };
}

const isSlideClip = (c) => /^q\d+(-answer\d)?\.wav$/.test(c.clip);

/** ציר הזמן לקריאה: אירועים, קטעים, וסימון ✂ לקטע שנקטע. */
function timeline(log) {
  const lines = [];
  for (const e of [...log].sort((a, b) => a.at - b.at)) {
    if (e.op === 'clip') {
      const end = e.at + e.dur;
      const cut =
        e.cut === null
          ? ''
          : e.cut <= e.at
            ? '  ✂ בוטל לפני שהתחיל'
            : `  ✂ נקטע אחרי ${((e.cut - e.at) / 1000).toFixed(1)} מתוך ${(e.dur / 1000).toFixed(1)} שנ׳`;
      lines.push(`${String(e.at).padStart(6)}  ♪ ${e.clip} (${(e.dur / 1000).toFixed(1)} שנ׳, עד ${end})${cut}`);
    } else {
      const mark = { auto: '⏩', narration: '🎙', command: '⌨', screen: '🖥' }[e.op] ?? '·';
      lines.push(`${String(e.at).padStart(6)}  ${mark} ${e.msg}`);
    }
  }
  return lines.join('\n');
}

/** כל קטע של שקופית (שאלה / תשובה) שנקטע או בוטל. */
function cutSlideClips(log) {
  return log
    .filter((e) => e.op === 'clip' && isSlideClip(e) && e.cut !== null)
    .map((e) =>
      e.cut <= e.at ? `${e.clip} בוטל לפני שהתחיל` : `${e.clip} נקטע אחרי ${((e.cut - e.at) / 1000).toFixed(1)} שנ׳`,
    );
}

/**
 * N נחת על השאלה בלבד: בשנייה שאחרי הלחיצה, כל מה שהמסך הציג בשקופית `id` הוא
 * השאלה בלי תשובות. (קומיט המעבר עצמו מציג 0 תשובות גם בגרסה הישנה, שחשפה את
 * כולן קומיט אחד אחריו — ולכן לא מספיק לבדוק את המסך הראשון.)
 */
function landedOnQuestion(log, id) {
  const pressedAt = log.find((e) => e.op === 'command' && e.msg.startsWith('N'))?.at;
  if (pressedAt === undefined) return 'N לא נרשם';
  const screens = log.filter(
    (e) => e.op === 'screen' && e.msg.startsWith(`שקופית ${id}/`) && e.at <= pressedAt + 1000,
  );
  if (screens.length === 0) return `שקופית ${id} לא הוצגה אחרי N`;
  const wrong = screens.find((e) => !e.msg.includes('· שאלה · 0 תשובות'));
  return wrong === undefined || `N נחת על: ${wrong.msg}`;
}

/** הקטעים של שקופית שנשמעו (התחילו להתנגן), לפי הסדר. */
const heard = (log, id) =>
  log
    .filter((e) => e.op === 'clip' && e.clip.startsWith(`q${id}`) && (e.cut === null || e.cut > e.at))
    .sort((a, b) => a.at - b.at)
    .map((e) => e.clip.replace('.wav', ''));

const AUTO_ANSWERS = {
  showAnswersAfterQuestion: true,
  startTimerAfterLastAnswer: false,
  showCorrectAnswerAfterTimer: false,
  nextSlide: { active: false, seconds: 6 },
};

const SCENARIOS = [
  {
    name: 'auto-reveal',
    title: 'חשיפה אוטומטית של התשובות: הקריין מסיים כל קטע לפני שהמסך זז',
    spec: { slides: [{ questionSeconds: 3 }, { questionSeconds: 3 }], autoTransition: AUTO_ANSWERS },
    async run(page) {
      await page.keyboard.press('Space'); // שאלה 1
      await sleep(16000);
    },
    check(log) {
      return [
        ...cutSlideClips(log),
        ...(heard(log, 1).join() === 'q1,q1-answer1,q1-answer2,q1-answer3'
          ? []
          : [`בשקופית 1 נשמעו: ${heard(log, 1).join(', ') || 'כלום'}`]),
      ];
    },
  },
  {
    name: 'auto-reveal-slow',
    title: 'אותו דבר ברשת איטית (כל קטע מגיע אחרי 1.5 שנ׳): השאלה לא נבלעת',
    spec: {
      slides: [{ questionSeconds: 3 }, { questionSeconds: 3 }],
      autoTransition: AUTO_ANSWERS,
      delay: 1500,
      lobbyMs: 800,
    },
    async run(page) {
      await page.keyboard.press('Space'); // שאלה 1, מיד: הקטעים שלה עוד בדרך
      await sleep(22000);
    },
    check(log) {
      return [
        ...cutSlideClips(log),
        ...(heard(log, 1).join() === 'q1,q1-answer1,q1-answer2,q1-answer3'
          ? []
          : [`בשקופית 1 נשמעו: ${heard(log, 1).join(', ') || 'כלום'}`]),
      ];
    },
  },
  {
    name: 'long-question',
    title: 'שאלה ארוכה (17 שנ׳) בחשיפה אוטומטית: התשובה הראשונה מחכה לסוף המשפט',
    spec: { slides: [{ questionSeconds: 17 }, { questionSeconds: 3 }], autoTransition: AUTO_ANSWERS },
    async run(page) {
      await page.keyboard.press('Space');
      await sleep(30000);
    },
    check(log) {
      return cutSlideClips(log);
    },
  },
  {
    name: 'fast-next',
    title: 'N לשקופית הבאה (בלי מעבר אוטומטי): השאלה לבד, וכל תשובה נקראת כשהיא נחשפת',
    spec: { slides: [{ questionSeconds: 2 }, { questionSeconds: 2 }, { questionSeconds: 2 }] },
    async run(page) {
      await page.keyboard.press('Space'); // שאלה 1
      await sleep(4500);
      await page.keyboard.press('KeyN'); // לשקופית 2
      await sleep(4500);
      for (let k = 0; k < 3; k++) {
        await page.keyboard.press('Space'); // תשובה אחרי תשובה, כמו כניסה רגילה
        await sleep(2600);
      }
    },
    check(log) {
      return [
        landedOnQuestion(log, 2),
        heard(log, 2).join() === 'q2,q2-answer1,q2-answer2,q2-answer3' ||
          `בשקופית 2 נשמעו: ${heard(log, 2).join(', ') || 'כלום'}`,
      ].filter((p) => typeof p === 'string');
    },
  },
  {
    name: 'fast-next-auto',
    title: 'N לשקופית הבאה עם חשיפה אוטומטית: התשובות נחשפות לפי כללי המשחק, והקריין מקריא כל אחת',
    spec: {
      slides: [{ questionSeconds: 2 }, { questionSeconds: 2 }, { questionSeconds: 2 }],
      autoTransition: AUTO_ANSWERS,
    },
    async run(page) {
      await page.keyboard.press('Space'); // שאלה 1
      await sleep(1500);
      await page.keyboard.press('KeyN'); // לשקופית 2, באמצע החשיפה של 1
      await sleep(14000);
    },
    check(log) {
      return [
        landedOnQuestion(log, 2),
        heard(log, 2).join() === 'q2,q2-answer1,q2-answer2,q2-answer3' ||
          `בשקופית 2 נשמעו: ${heard(log, 2).join(', ') || 'כלום'}`,
        ...cutSlideClips(log.filter((e) => e.op !== 'clip' || e.clip.startsWith('q2'))),
      ].filter((p) => typeof p === 'string');
    },
  },
];

if (argv.includes('--list')) {
  for (const s of SCENARIOS) console.log(`${s.name.padEnd(18)} ${s.title}`);
  process.exit(0);
}

const browser = await chromium.launch({
  ...(existsSync('/opt/pw-browsers/chromium')
    ? { executablePath: '/opt/pw-browsers/chromium' }
    : process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : { channel: 'chrome' }),
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

const selected = ONLY.length > 0 ? SCENARIOS.filter((s) => ONLY.includes(s.name)) : SCENARIOS;
const failedNames = [];
for (const scenario of selected) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
  await context.addInitScript(instrument);
  let problems = [];
  let log = [];
  try {
    const { page, errors } = await openGame(context, scenario, scenario.spec);
    await scenario.run(page);
    log = await page.evaluate(() => window.__narr.slice());
    problems = [...scenario.check(log), ...errors.map((e) => `שגיאה בדף: ${e}`)];
  } catch (err) {
    problems = [`קרס: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`];
  } finally {
    await context.close();
  }
  const ok = problems.length === 0;
  if (!ok) failedNames.push(scenario.name);
  console.log(`${ok ? '✓' : '✗'} ${scenario.name} — ${scenario.title}`);
  for (const p of problems) console.log(`    ✗ ${p}`);
  if (!ok || VERBOSE) console.log(`${timeline(log)}\n`);
}

await browser.close();
server.close();
rmSync(FX, { recursive: true, force: true });
console.log(
  failedNames.length === 0
    ? `\nכל ${selected.length} התרחישים עברו`
    : `\n${failedNames.length} מתוך ${selected.length} תרחישים נכשלו: ${failedNames.join(', ')}`,
);
process.exit(failedNames.length === 0 ? 0 : 1);
