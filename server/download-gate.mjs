/**
 * שער ההורדה של הגרסה הניידת ושל כלי החתימה — רץ בתוך מכולת האתר, מאחורי
 * nginx (ראו nginx.conf ו-docker-entrypoint.sh).
 *
 * הגרסה הניידת (‏TriviaEngine-Portable.exe, וגם בשמות SealEXE.exe ו-
 * HavayaBeClick-<גרסה>.exe — אותו קובץ) היא גם כלי החתימה: מי שמחזיק אותה
 * יכול לסגור כל ZIP של משחק ל-EXE עם כל מגבלת משתתפים. לכן בעמוד ההורדה היא
 * נפתחת רק אחרי קוד גישה. המתקין הרגיל והעדכונים פתוחים לכולם.
 *
 *   POST /unlock  {code}  קוד נכון: עוגייה חתומה לשעה (HttpOnly). ב-nginx: ‎/download/unlock‎
 *   GET  /unlock          האם הדפדפן הזה כבר פתח (לעמוד ההורדה)
 *   GET  /check           בדיקת nginx (auth_request) לכל בקשה לקובץ נעול: 204 או 403
 *   GET  /health
 *
 * הקוד עצמו אינו נשמר בשום מקום. בריפו, שהוא ציבורי, יש רק גיבוב scrypt עם
 * מלח (server/download-gate.json), במחיר שהופך ניחוש מחוץ לשרת לאיטי מאוד.
 * בשרת: מגבלת ניסיונות שגויים לכל כתובת ולכולם יחד, ובדיקה אחת בכל רגע
 * (כל בדיקה תופסת ‎~128MB זיכרון לשבריר שנייה).
 *
 * כלי החתימה מוריד את ‎/desktop/TriviaEngine-Portable.exe‎ בעצמו — הבסיס שעליו
 * הוא חותם, וגם העדכון העצמי שלו (SEAL_BASE_URL ב-electron/main.cjs) — בלי
 * עוגייה. בקשה כזו מזוהה לפי ה-User-Agent של Electron ומותרת לנתיב הזה בלבד,
 * אחרת כל כלי חתימה שכבר אצל לקוחות היה מפסיק להתעדכן. זה לא סוד: מי שמתחזה
 * ל-Electron יקבל את הקובץ, וגם המהדורה הציבורית ב-GitHub מגישה אותו. המטרה
 * היא שהכפתור בעמוד ושקישור ישיר בדפדפן לא יורידו את הקובץ בלי קוד.
 *
 * החלפת הקוד (הקוד נקרא מהקלט, כדי שלא יישאר בהיסטוריית הפקודות):
 *   node server/download-gate.mjs hash > server/download-gate.json
 * בדיקה איזה קוד מוגדר:
 *   node server/download-gate.mjs verify
 *
 * בלי תלויות — רק Node.
 */

import { createServer } from 'node:http';
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** הפורט המקומי. nginx.conf פונה אליו (נבדק ב-tests/downloadGate.test.ts). */
export const DEFAULT_PORT = 8788;

/** שם העוגייה שמעידה שהדפדפן הזה הקליד את הקוד. */
export const COOKIE = 'dl_unlock';

/** הנתיב שכלי החתימה מוריד בעצמו — SEAL_BASE_URL ב-electron/main.cjs. */
export const SEAL_BASE_PATH = '/desktop/TriviaEngine-Portable.exe';

/**
 * עלות הגיבוב. הגיבוב יושב בריפו ציבורי, והקוד הוא ספרות בלבד, ולכן העלות
 * גבוהה בכוונה: ‎2^17·8·128 = 128MB ו-‎~0.3 שנ׳ לכל ניסיון, במחשב התוקף כמו
 * בשרת. ב-tests/downloadGate.test.ts יש בדיקה שהקובץ שבריפו לא נחלש.
 */
export const KDF = { N: 2 ** 17, r: 8, p: 1, keyLen: 32, saltBytes: 16 };

export const DEFAULT_LIMITS = {
  /** כמה זמן הדפדפן נשאר פתוח אחרי קוד נכון. */
  unlockMs: 60 * 60 * 1000,
  /** ניסיונות שגויים מכתובת אחת, בחלון. */
  ipFailures: 5,
  ipWindowMs: 15 * 60 * 1000,
  /**
   * ניסיונות שגויים מכל הכתובות יחד, בחלון. זו התקרה האמיתית לניחוש: כתובות
   * אפשר להחליף. כשהיא מתמלאת גם קוד נכון מחכה לסוף החלון.
   */
  totalFailures: 100,
  totalWindowMs: 60 * 60 * 1000,
  /** בקשות שממתינות לבדיקה (כולל זו שרצה). מעבר לזה: "עסוק". */
  maxQueue: 4,
  codeChars: 64,
  bodyBytes: 1024,
  /** כמה כתובות נזכרות לכל היותר (ישנות נמחקות קודם). */
  maxTrackedIps: 10_000,
};

/** זיהוי כלי החתימה: Electron כותב ‎`Electron/<גרסה>`‎ ב-User-Agent של net.request. */
const ELECTRON_UA = /\bElectron\/\d/;

/**
 * הבקשה של כלי החתימה לבסיס שלו (ולא של דפדפן). נתיב הבסיס בלבד, כפי ש-nginx
 * קיבל אותו (בלי מחרוזת שאילתה).
 * @param {string | undefined} uri
 * @param {string | undefined} userAgent
 */
export function isSealerRequest(uri, userAgent) {
  const path = String(uri ?? '').split('?')[0];
  return path === SEAL_BASE_PATH && ELECTRON_UA.test(String(userAgent ?? ''));
}

/** רווחים שהוקלדו בטעות בתוך הקוד או סביבו לא נחשבים. */
export function normalizeCode(raw) {
  return String(raw ?? '').replace(/\s+/g, '');
}

/** @param {{N: number, r: number, p: number}} params */
function maxmemFor({ N, r, p }) {
  return 256 * N * r * p; // scrypt נכשל מעל ‎~128·N·r; מרווח כפול
}

/**
 * גיבוב scrypt של קוד. אסינכרוני — הבדיקה רצה מחוץ ללולאת האירועים, כך
 * שבקשות ההורדה שמחכות לבדיקת nginx לא נעצרות בזמנה.
 * @param {string} code
 * @param {{N: number, r: number, p: number, salt: string, keyLen?: number}} params
 * @returns {Promise<Buffer>}
 */
export function hashCode(code, { N, r, p, salt, keyLen = KDF.keyLen }) {
  return new Promise((resolve, reject) => {
    scrypt(
      normalizeCode(code),
      Buffer.from(salt, 'hex'),
      keyLen,
      { N, r, p, maxmem: maxmemFor({ N, r, p }) },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

/**
 * רשומת הגיבוב שנשמרת ב-server/download-gate.json. `params` לבדיקות בלבד.
 * @param {string} code
 * @param {Partial<typeof KDF>} [params]
 */
export async function makeHashRecord(code, params = {}) {
  const { N, r, p, keyLen, saltBytes } = { ...KDF, ...params };
  if (normalizeCode(code) === '') throw new Error('קוד ריק');
  const salt = randomBytes(saltBytes).toString('hex');
  const hash = (await hashCode(code, { N, r, p, salt, keyLen })).toString('hex');
  return { v: 1, kdf: 'scrypt', N, r, p, salt, hash };
}

/**
 * רשומה תקינה, או null. רשומה פגומה לא מפילה את השרת: כל ניסיון פתיחה עונה
 * "לא מוגדר", והקבצים נשארים נעולים.
 * @param {unknown} raw
 */
export function parseHashRecord(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const rec = /** @type {Record<string, unknown>} */ (raw);
  const int = (v) => (Number.isSafeInteger(v) && Number(v) > 0 ? Number(v) : null);
  const N = int(rec.N);
  const r = int(rec.r);
  const p = int(rec.p);
  if (rec.kdf !== 'scrypt' || N === null || r === null || p === null) return null;
  if ((N & (N - 1)) !== 0) return null; // scrypt דורש חזקה של 2
  if (typeof rec.salt !== 'string' || !/^(?:[0-9a-f]{2}){8,}$/.test(rec.salt)) return null;
  if (typeof rec.hash !== 'string' || !/^(?:[0-9a-f]{2}){16,}$/.test(rec.hash)) return null;
  return { N, r, p, salt: rec.salt, hash: rec.hash };
}

/** @param {string | URL} file */
export function loadHashRecord(file) {
  try {
    return parseHashRecord(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}

/**
 * @param {{N: number, r: number, p: number, salt: string, hash: string}} record
 * @param {string} code
 */
export async function verifyCode(record, code) {
  const want = Buffer.from(record.hash, 'hex');
  const got = await hashCode(code, { ...record, keyLen: want.length });
  return got.length === want.length && timingSafeEqual(got, want);
}

function sign(secret, exp) {
  return createHmac('sha256', secret).update(`v1.${exp}`).digest('base64url');
}

/** ערך העוגייה: מתי היא פגה, וחתימה עליו בסוד שנוצר בעליית השרת. */
export function issueToken(secret, exp) {
  return `v1.${exp}.${sign(secret, exp)}`;
}

/**
 * מתי עוגייה פגה, או null אם היא לא חתומה כאן, פגה, או מבטיחה יותר מ-maxMs
 * קדימה. סוד חדש בכל עליית שרת — אחרי הפעלה מחדש מקלידים שוב.
 */
export function tokenExpiry(secret, token, now, maxMs) {
  const m = /^v1\.(\d{1,16})\.([A-Za-z0-9_-]{43})$/.exec(String(token ?? ''));
  if (m === null) return null;
  const exp = Number(m[1]);
  if (!Number.isSafeInteger(exp) || exp <= now || exp > now + maxMs) return null;
  const want = Buffer.from(sign(secret, exp));
  const got = Buffer.from(m[2]);
  return want.length === got.length && timingSafeEqual(want, got) ? exp : null;
}

/** כל הערכים של עוגייה בשם הזה (יכולות להיות כמה, מנתיבים שונים). */
function cookieValues(header, name) {
  const out = [];
  for (const part of String(header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) out.push(part.slice(eq + 1).trim());
  }
  return out;
}

function headerOf(req, name) {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function sendJson(res, status, body, extra = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
    ...extra,
  });
  res.end(text);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const log = (msg) => console.log(`[download-gate] ${new Date().toISOString()} ${msg}`);

/**
 * @param {{
 *   record: {N: number, r: number, p: number, salt: string, hash: string} | null,
 *   now?: () => number,
 *   secret?: Buffer,
 *   limits?: Partial<typeof DEFAULT_LIMITS>,
 *   verify?: (record: any, code: string) => Promise<boolean>,
 *   quiet?: boolean,
 * }} options
 */
export function createDownloadGate({
  record,
  now = () => Date.now(),
  secret = randomBytes(32),
  limits = {},
  verify = verifyCode,
  quiet = false,
}) {
  const cfg = { ...DEFAULT_LIMITS, ...limits };
  const say = quiet ? () => {} : log;
  /** @type {Map<string, {count: number, resetAt: number}>} */
  const failures = new Map();
  let total = { count: 0, resetAt: 0 };
  /** בדיקה אחת בכל רגע: כל אחת תופסת ‎~128MB. */
  let chain = Promise.resolve();
  let pending = 0;

  /** כמה זמן (ms) הכתובת הזו — או כולם — חסומים כרגע. 0 = אפשר לנסות. */
  function blockedFor(ip, t) {
    const e = failures.get(ip);
    const mine = e !== undefined && e.resetAt > t && e.count >= cfg.ipFailures ? e.resetAt - t : 0;
    const all = total.resetAt > t && total.count >= cfg.totalFailures ? total.resetAt - t : 0;
    return Math.max(mine, all);
  }

  function recordFailure(ip, t) {
    let e = failures.get(ip);
    if (e === undefined || e.resetAt <= t) {
      failures.delete(ip); // חוזרת לסוף הסדר — הישנות נמחקות קודם
      e = { count: 0, resetAt: t + cfg.ipWindowMs };
      failures.set(ip, e);
    }
    e.count += 1;
    if (total.resetAt <= t) total = { count: 0, resetAt: t + cfg.totalWindowMs };
    total.count += 1;
    if (failures.size > cfg.maxTrackedIps) {
      for (const [key, value] of failures) {
        if (value.resetAt <= t) failures.delete(key);
      }
      for (const key of failures.keys()) {
        if (failures.size <= cfg.maxTrackedIps) break;
        failures.delete(key);
      }
    }
  }

  /** מתי הפתיחה של הדפדפן הזה פגה, או null. */
  function unlockedUntil(req) {
    const t = now();
    let best = null;
    for (const value of cookieValues(headerOf(req, 'cookie'), COOKIE)) {
      const exp = tokenExpiry(secret, value, t, cfg.unlockMs);
      if (exp !== null && (best === null || exp > best)) best = exp;
    }
    return best;
  }

  function clientIp(req) {
    const v = String(headerOf(req, 'x-client-ip') ?? '').trim();
    return (v !== '' ? v : String(req.socket?.remoteAddress ?? '')).slice(0, 64);
  }

  function tooMany(res, ms) {
    const retryAfter = Math.max(1, Math.ceil(ms / 1000));
    sendJson(
      res,
      429,
      { ok: false, error: 'rate_limited', retryAfter },
      { 'retry-after': String(retryAfter) },
    );
  }

  /** @returns {Promise<{ blocked: number } | { ok: boolean }> | null} */
  function enqueue(ip, code) {
    if (pending >= cfg.maxQueue) return null;
    pending += 1;
    const run = chain.then(async () => {
      // נבדק שוב בתור: כמה בקשות מאותה כתובת יכלו להיכנס יחד לפני שנחסמה.
      const blocked = blockedFor(ip, now());
      if (blocked > 0) return { blocked };
      return { ok: await verify(record, code) };
    });
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run.finally(() => {
      pending -= 1;
    });
  }

  async function unlock(req, res) {
    if (record === null) {
      sendJson(res, 503, { ok: false, error: 'not_configured' });
      return;
    }
    let code;
    try {
      const body = JSON.parse(await readBody(req, cfg.bodyBytes));
      code = normalizeCode(body?.code);
    } catch (err) {
      sendJson(res, /** @type {any} */ (err).status === 413 ? 413 : 400, {
        ok: false,
        error: 'bad_request',
      });
      return;
    }
    if (code === '' || code.length > cfg.codeChars) {
      sendJson(res, 400, { ok: false, error: 'bad_request' });
      return;
    }
    const ip = clientIp(req);
    const blocked = blockedFor(ip, now());
    if (blocked > 0) {
      tooMany(res, blocked);
      return;
    }
    const run = enqueue(ip, code);
    if (run === null) {
      sendJson(res, 503, { ok: false, error: 'busy' }, { 'retry-after': '5' });
      return;
    }
    const result = await run;
    if ('blocked' in result) {
      tooMany(res, result.blocked);
      return;
    }
    if (!result.ok) {
      recordFailure(ip, now());
      say(`קוד שגוי מ-${ip}`);
      sendJson(res, 401, { ok: false, error: 'bad_code' });
      return;
    }
    failures.delete(ip);
    const until = now() + cfg.unlockMs;
    const secure =
      String(headerOf(req, 'x-forwarded-proto') ?? '')
        .split(',')[0]
        .trim() === 'https';
    const cookie = [
      `${COOKIE}=${issueToken(secret, until)}`,
      'Path=/',
      `Max-Age=${Math.floor(cfg.unlockMs / 1000)}`,
      'HttpOnly',
      'SameSite=Lax',
      ...(secure ? ['Secure'] : []),
    ].join('; ');
    say(`נפתח מ-${ip}`);
    sendJson(res, 200, { ok: true, until }, { 'set-cookie': cookie });
  }

  async function handle(req, res) {
    const path = new URL(req.url ?? '/', 'http://gate').pathname;
    try {
      if (path === '/check') {
        const allowed =
          unlockedUntil(req) !== null ||
          isSealerRequest(headerOf(req, 'x-original-uri'), headerOf(req, 'user-agent'));
        res.writeHead(allowed ? 204 : 403, { 'cache-control': 'no-store' });
        res.end();
        return;
      }
      if (path === '/unlock' && req.method === 'POST') {
        await unlock(req, res);
        return;
      }
      if (path === '/unlock' && (req.method === 'GET' || req.method === 'HEAD')) {
        const until = unlockedUntil(req);
        sendJson(res, 200, { ok: true, unlocked: until !== null, until });
        return;
      }
      if (path === '/health') {
        sendJson(res, 200, { ok: true, configured: record !== null });
        return;
      }
      sendJson(res, 404, { ok: false, error: 'not_found' });
    } catch (err) {
      say(`שגיאה: ${/** @type {Error} */ (err).message}`);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal' });
      else res.destroy();
    }
  }

  return { handle, config: cfg };
}

/** @param {{port?: number, host?: string} & Parameters<typeof createDownloadGate>[0]} options */
export function startDownloadGate({ port = DEFAULT_PORT, host = '127.0.0.1', ...options }) {
  const gate = createDownloadGate(options);
  const server = createServer((req, res) => void gate.handle(req, res));
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  const ready = new Promise((resolve) =>
    server.listen(port, host, () => resolve(server.address())),
  );
  return {
    server,
    gate,
    ready,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve(undefined));
      }),
  };
}

/** הקוד מהקלט (צינור או הקלדה), בלי לעבור דרך שורת הפקודה. */
async function readCodeFromStdin() {
  if (process.stdin.isTTY) process.stderr.write('קוד: ');
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
    if (process.stdin.isTTY && String(chunk).includes('\n')) break;
  }
  return normalizeCode(Buffer.concat(chunks).toString('utf8'));
}

const DEFAULT_FILE = fileURLToPath(new URL('./download-gate.json', import.meta.url));

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const command = process.argv[2];
  const file = process.env.DOWNLOAD_GATE_FILE ?? DEFAULT_FILE;
  if (command === 'hash') {
    const code = await readCodeFromStdin();
    if (code === '') {
      console.error('קוד ריק — לא נכתב דבר');
      process.exit(1);
    }
    const about =
      'גיבוב scrypt של קוד הגישה לגרסה הניידת ולכלי החתימה (server/download-gate.mjs). הקוד עצמו אינו כאן.';
    process.stdout.write(
      `${JSON.stringify({ about, ...(await makeHashRecord(code)) }, null, 2)}\n`,
    );
  } else if (command === 'verify') {
    const record = loadHashRecord(file);
    if (record === null) {
      console.error(`אין רשומה תקינה ב-${file}`);
      process.exit(2);
    }
    const match = await verifyCode(record, await readCodeFromStdin());
    console.log(match ? 'הקוד תואם' : 'הקוד אינו תואם');
    process.exit(match ? 0 : 1);
  } else {
    const record = loadHashRecord(file);
    if (record === null) log(`⚠ אין רשומת קוד תקינה ב-${file} — הקבצים נשארים נעולים לכולם`);
    const port = Number(process.env.DOWNLOAD_GATE_PORT ?? DEFAULT_PORT);
    const host = process.env.DOWNLOAD_GATE_HOST ?? '127.0.0.1';
    const { ready } = startDownloadGate({ port, host, record });
    void ready.then((address) => {
      log(
        `מאזין ב-${typeof address === 'object' && address ? `${address.address}:${address.port}` : address}`,
      );
    });
  }
}
