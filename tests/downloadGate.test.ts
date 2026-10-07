/**
 * שער ההורדה של הגרסה הניידת וכלי החתימה (server/download-gate.mjs), וההסכמה
 * בינו לבין nginx.conf, ה-Dockerfile, עמוד ההורדה וכלי החתימה עצמו.
 *
 * מה שחשוב כאן מעבר לקוד: שום שם של הגרסה הניידת לא יוצא בלי קוד, המתקין
 * והעדכונים לא נחסמים, וכלי החתימה שכבר אצל לקוחות ממשיך להוריד את הבסיס שלו.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  COOKIE,
  DEFAULT_PORT,
  KDF,
  SEAL_BASE_PATH,
  isSealerRequest,
  issueToken,
  loadHashRecord,
  makeHashRecord,
  normalizeCode,
  parseHashRecord,
  startDownloadGate,
  tokenExpiry,
  verifyCode,
  // @ts-expect-error — שרת ב-JS, בלי הצהרות טיפוסים
} from '../server/download-gate.mjs';

interface HashRecord {
  N: number;
  r: number;
  p: number;
  salt: string;
  hash: string;
}

interface GateHandle {
  ready: Promise<{ port: number }>;
  close: () => Promise<void>;
}

const require = createRequire(import.meta.url);
const { DESKTOP_BASE_URL } = require('../electron/desktopHost.cjs') as { DESKTOP_BASE_URL: string };

/** קבצים מהריפו, בשורות של לינוקס גם כשה-checkout ב-Windows הפך אותן ל-CRLF. */
const read = (p: string) =>
  readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** User-Agent אמיתי של net.request ב-Electron 33 (נמדד מהתוכנה, 7.10.2026). */
const ELECTRON_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HavayaBeClick/0.1.201 Chrome/130.0.6723.191 Electron/33.4.11 Safari/537.36';
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const BROWSER_UAS = [
  CHROME_UA,
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  'curl/8.5.0',
  '',
];

const CODE = '13572468';
/** עלות נמוכה לבדיקות — הקובץ שבריפו נבדק בנפרד שהוא בעלות המלאה. */
const CHEAP = { N: 2 ** 10, r: 8, p: 1 };
let record: HashRecord;

beforeAll(async () => {
  record = (await makeHashRecord(CODE, CHEAP)) as HashRecord;
});

describe('קוד, גיבוב ועוגייה', () => {
  it('רווחים בקוד לא נחשבים', () => {
    expect(normalizeCode(' 135 724 68\n')).toBe(CODE);
    expect(normalizeCode(undefined)).toBe('');
  });

  it('הגיבוב מאשר את הקוד בלבד', async () => {
    expect(await verifyCode(record, CODE)).toBe(true);
    expect(await verifyCode(record, ` ${CODE} `)).toBe(true);
    expect(await verifyCode(record, '13572469')).toBe(false);
    expect(await verifyCode(record, '')).toBe(false);
    // מלח אקראי: אותו קוד, גיבוב אחר בכל פעם
    const again = (await makeHashRecord(CODE, CHEAP)) as HashRecord;
    expect(again.salt).not.toBe(record.salt);
    expect(again.hash).not.toBe(record.hash);
  });

  it('רשומה פגומה נדחית במקום להפיל את השרת', () => {
    expect(parseHashRecord(record)).not.toBeNull();
    expect(parseHashRecord(null)).toBeNull();
    expect(parseHashRecord({ ...record, kdf: 'scrypt', N: 1000 })).toBeNull(); // לא חזקה של 2
    expect(parseHashRecord({ ...record, kdf: 'pbkdf2' })).toBeNull();
    expect(parseHashRecord({ ...record, kdf: 'scrypt', salt: 'zz' })).toBeNull();
    expect(parseHashRecord({ ...record, kdf: 'scrypt', hash: '' })).toBeNull();
    expect(loadHashRecord(new URL('./no-such-file.json', import.meta.url))).toBeNull();
  });

  it('★ הגיבוב שבריפו בעלות המלאה, והקוד עצמו לא שם', () => {
    const text = read('server/download-gate.json');
    const raw = JSON.parse(text) as Record<string, unknown>;
    const committed = parseHashRecord(raw) as HashRecord | null;
    expect(committed).not.toBeNull();
    // הריפו ציבורי: גיבוב זול של קוד ספרות היה נפרץ במחשב ביתי.
    expect(committed!.N).toBeGreaterThanOrEqual(KDF.N);
    expect(committed!.r).toBeGreaterThanOrEqual(KDF.r);
    expect(committed!.salt.length).toBeGreaterThanOrEqual(32);
    expect(committed!.hash.length).toBe(64);
    expect(Object.keys(raw).sort()).toEqual(['N', 'about', 'hash', 'kdf', 'p', 'r', 'salt', 'v']);
  });

  it('עוגייה: חתומה, פגה, ולא נמשכת מעבר לחלון', () => {
    const secret = Buffer.alloc(32, 7);
    const now = 1_000_000;
    const token = issueToken(secret, now + 60_000);
    expect(tokenExpiry(secret, token, now, 3_600_000)).toBe(now + 60_000);
    expect(tokenExpiry(secret, token, now + 60_000, 3_600_000)).toBeNull(); // פגה
    expect(tokenExpiry(Buffer.alloc(32, 8), token, now, 3_600_000)).toBeNull(); // סוד אחר (שרת שעלה מחדש)
    expect(tokenExpiry(secret, token, now, 30_000)).toBeNull(); // מבטיחה יותר מהחלון
    expect(
      tokenExpiry(
        secret,
        token.replace(/.$/, (c: string) => (c === 'A' ? 'B' : 'A')),
        now,
        3_600_000,
      ),
    ).toBeNull();
    expect(tokenExpiry(secret, `v1.${now + 60_000}.${'A'.repeat(43)}`, now, 3_600_000)).toBeNull();
    expect(tokenExpiry(secret, 'garbage', now, 3_600_000)).toBeNull();
    expect(tokenExpiry(secret, undefined, now, 3_600_000)).toBeNull();
  });
});

describe('כלי החתימה ממשיך להוריד את הבסיס שלו', () => {
  it('★ הנתיב הפתוח לכלי הוא בדיוק SEAL_BASE_URL של התוכנה', () => {
    const main = read('electron/main.cjs');
    const suffix = /const SEAL_BASE_URL = `\$\{DESKTOP_BASE_URL\}(\/[^`]+)`;/.exec(main)?.[1];
    expect(suffix).toBeDefined();
    expect(new URL(DESKTOP_BASE_URL).pathname + suffix!).toBe(SEAL_BASE_PATH);
  });

  it('Electron — לנתיב הבסיס בלבד; דפדפנים וכלים אחרים — לא', () => {
    expect(isSealerRequest(SEAL_BASE_PATH, ELECTRON_UA)).toBe(true);
    expect(isSealerRequest(`${SEAL_BASE_PATH}?x=1`, ELECTRON_UA)).toBe(true);
    expect(isSealerRequest('/desktop/SealEXE.exe', ELECTRON_UA)).toBe(false);
    expect(isSealerRequest('/desktop/HavayaBeClick-0.1.201.exe', ELECTRON_UA)).toBe(false);
    expect(isSealerRequest('/desktop.new/TriviaEngine-Portable.exe', ELECTRON_UA)).toBe(false);
    for (const ua of BROWSER_UAS) expect(isSealerRequest(SEAL_BASE_PATH, ua), ua).toBe(false);
    expect(isSealerRequest(SEAL_BASE_PATH, undefined)).toBe(false);
  });
});

describe('nginx, Docker ועמוד ההורדה מסכימים עם השער', () => {
  const nginx = read('nginx.conf');
  const gated = /location ~ (\S+) \{([^}]*)\}/.exec(nginx);
  const gatedRe = new RegExp(gated?.[1] ?? '^$');
  const gatedBody = gated?.[2] ?? '';

  it('★ כל שם של הגרסה הניידת נעול, בכל תיקייה', () => {
    expect(gated).not.toBeNull();
    // השמות שהמשיכה יוצרת לקובץ הנייד — כל כינוי חדש חייב להיות נעול גם הוא.
    const fetchTool = read('tools/fetch-desktop-assets.mjs');
    expect(fetchTool).toContain('const portable = `HavayaBeClick-${version}.exe`;');
    const aliases = [...fetchTool.matchAll(/alias\(portable, '([^']+)'\)/g)].map((m) => m[1]!);
    expect(aliases.sort()).toEqual(['SealEXE.exe', 'TriviaEngine-Portable.exe']);
    const names = [...aliases, 'HavayaBeClick-0.1.201.exe', 'HavayaBeClick-0.1.1234.exe'];
    for (const name of names) {
      expect(gatedRe.test(`/desktop/${name}`), name).toBe(true);
      // הרענון מושך קודם ל-desktop.new, שגם היא מתחת לשורש האתר
      expect(gatedRe.test(`/desktop.new/${name}`), name).toBe(true);
    }
  });

  it('★ המתקין, המפות והפיד — פתוחים', () => {
    for (const path of [
      '/desktop/TriviaEngine-Setup.exe',
      '/desktop/HavayaBeClick-Setup-0.1.201.exe',
      '/desktop/HavayaBeClick-Setup-0.1.201.exe.blockmap',
      '/desktop/latest.yml',
      '/desktop/index.json',
      '/desktop/changelog.json',
      '/download/',
      '/download/locked.html',
    ]) {
      expect(gatedRe.test(path), path).toBe(false);
    }
  });

  it('★ חסימה = 403 עם עמוד, ולעולם לא הפניה (כלי החתימה עוקב אחרי הפניות)', () => {
    expect(gatedBody).toMatch(/^\s*auth_request \/_download_gate;$/m);
    expect(gatedBody).toMatch(/^\s*error_page 403 \/download\/locked\.html;$/m);
    expect(gatedBody).not.toMatch(/\breturn\b|=\s*30\d|error_page[^;]*=/);
    expect(gatedBody).toMatch(/Cache-Control "private, no-store" always;/);
    expect(read('public/download/locked.html')).toContain('/download/');
  });

  it('nginx פונה לשער בפורט שלו, ומעביר את הנתיב והכתובת', () => {
    const auth = /location = \/_download_gate \{([^}]*)\}/.exec(nginx)?.[1] ?? '';
    expect(auth).toMatch(/^\s*internal;$/m);
    expect(auth).toContain(`proxy_pass http://127.0.0.1:${DEFAULT_PORT}/check;`);
    expect(auth).toContain('proxy_set_header X-Original-URI $request_uri;');
    expect(auth).toContain('proxy_set_header X-Client-IP $download_gate_client;');
    const unlock = /location = \/download\/unlock \{([^}]*)\}/.exec(nginx)?.[1] ?? '';
    expect(unlock).toContain(`proxy_pass http://127.0.0.1:${DEFAULT_PORT}/unlock;`);
    expect(unlock).toContain('proxy_set_header X-Client-IP $download_gate_client;');
  });

  it('השער נכנס לתמונה ועולה עם המכולה', () => {
    expect(read('Dockerfile')).toContain(
      'COPY server/download-gate.mjs server/download-gate.json /app/server/',
    );
    expect(read('docker-entrypoint.sh')).toMatch(/node \/app\/server\/download-gate\.mjs/);
  });

  it('★ בעמוד ההורדה אין קישור ישיר לגרסה הניידת או לכלי החתימה', () => {
    const page = read('public/download/index.html');
    expect(page).not.toMatch(
      /(?<!data-)href="\/desktop\/(TriviaEngine-Portable|SealEXE|HavayaBeClick-\d)/,
    );
    expect(page).toContain('data-href="/desktop/TriviaEngine-Portable.exe"');
    expect(page).toContain('data-href="/desktop/SealEXE.exe"');
    expect(page).toContain("fetch('/download/unlock'");
    // המתקין נשאר קישור רגיל
    expect(page).toContain('href="/desktop/TriviaEngine-Setup.exe"');
  });
});

describe('השרת', () => {
  let gate: GateHandle | null = null;
  let base = '';
  let clock = 1_800_000_000_000;

  async function start(options: Record<string, unknown> = {}) {
    gate = startDownloadGate({
      port: 0,
      record,
      now: () => clock,
      quiet: true,
      ...options,
    }) as GateHandle;
    base = `http://127.0.0.1:${(await gate.ready).port}`;
  }

  afterEach(async () => {
    await gate?.close();
    gate = null;
    clock = 1_800_000_000_000;
  });

  const unlock = (code: unknown, ip = '203.0.113.5', extra: Record<string, string> = {}) =>
    fetch(`${base}/unlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-client-ip': ip, ...extra },
      body: JSON.stringify({ code }),
    });

  const check = (headers: Record<string, string>) => fetch(`${base}/check`, { headers });

  /** הערך שהשרת שם בעוגייה, כפי שדפדפן ישלח אותו חזרה. */
  const cookieFrom = (res: Response) => {
    const header = res.headers.get('set-cookie') ?? '';
    return header.split(';')[0]!;
  };

  it('קוד נכון: עוגייה לשעה, והקבצים נפתחים עם העוגייה בלבד', async () => {
    await start();
    const res = await unlock(CODE);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; until: number };
    expect(body).toEqual({ ok: true, until: clock + 3_600_000 });
    const header = res.headers.get('set-cookie') ?? '';
    expect(header).toMatch(new RegExp(`^${COOKIE}=v1\\.`));
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=3600');
    expect(header).not.toContain('Secure'); // בלי https מאחורי CapRover, Secure היה מונע את העוגייה
    expect(res.headers.get('cache-control')).toBe('no-store');

    const cookie = cookieFrom(res);
    for (const uri of [
      '/desktop/TriviaEngine-Portable.exe',
      '/desktop/SealEXE.exe',
      '/desktop/HavayaBeClick-0.1.201.exe',
    ]) {
      expect(
        (await check({ 'x-original-uri': uri, 'user-agent': CHROME_UA, cookie })).status,
        uri,
      ).toBe(204);
      expect((await check({ 'x-original-uri': uri, 'user-agent': CHROME_UA })).status, uri).toBe(
        403,
      );
    }
    // עוגייה אחרת לצד שלנו (אתר אחר באותו דומיין) לא מפריעה
    expect(
      (await check({ 'x-original-uri': '/desktop/SealEXE.exe', cookie: `a=1; ${cookie}; b=2` }))
        .status,
    ).toBe(204);

    const state = await fetch(`${base}/unlock`, { headers: { cookie } });
    expect(await state.json()).toEqual({ ok: true, unlocked: true, until: clock + 3_600_000 });
    const none = await fetch(`${base}/unlock`);
    expect(await none.json()).toEqual({ ok: true, unlocked: false, until: null });

    // שעה אחרי — נעול שוב
    clock += 3_600_000;
    expect((await check({ 'x-original-uri': '/desktop/SealEXE.exe', cookie })).status).toBe(403);
  });

  it('מאחורי https העוגייה Secure', async () => {
    await start();
    const res = await unlock(CODE, '203.0.113.5', { 'x-forwarded-proto': 'https' });
    expect(res.headers.get('set-cookie')).toContain('Secure');
  });

  it('קוד שגוי: 401 ובלי עוגייה; עוגייה מזויפת לא פותחת', async () => {
    await start();
    const res = await unlock('11111111');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'bad_code' });
    expect(res.headers.get('set-cookie')).toBeNull();
    const fake = `${COOKIE}=${issueToken(Buffer.alloc(32, 1), clock + 60_000)}`;
    expect((await check({ 'x-original-uri': '/desktop/SealEXE.exe', cookie: fake })).status).toBe(
      403,
    );
  });

  it('כלי החתימה מקבל את הבסיס בלי עוגייה; דפדפן לא', async () => {
    await start();
    expect(
      (await check({ 'x-original-uri': SEAL_BASE_PATH, 'user-agent': ELECTRON_UA })).status,
    ).toBe(204);
    expect(
      (await check({ 'x-original-uri': '/desktop/SealEXE.exe', 'user-agent': ELECTRON_UA })).status,
    ).toBe(403);
    expect(
      (await check({ 'x-original-uri': SEAL_BASE_PATH, 'user-agent': CHROME_UA })).status,
    ).toBe(403);
    expect((await check({})).status).toBe(403);
  });

  it('בקשה לא תקינה — 400, ולא נספרת כניסיון', async () => {
    await start({ limits: { ipFailures: 1 } });
    for (const body of [
      'not json',
      JSON.stringify({}),
      JSON.stringify({ code: '   ' }),
      JSON.stringify({ code: '1'.repeat(65) }),
    ]) {
      const res = await fetch(`${base}/unlock`, {
        method: 'POST',
        headers: { 'x-client-ip': '203.0.113.9' },
        body,
      });
      expect(res.status, body).toBe(400);
    }
    expect((await unlock(CODE, '203.0.113.9')).status).toBe(200);
  });

  it('★ ניסיונות שגויים: כתובת נחסמת לחלון, ואחרות ממשיכות', async () => {
    await start({ limits: { ipFailures: 3, ipWindowMs: 60_000 } });
    for (let i = 0; i < 3; i += 1)
      expect((await unlock('00000000', '198.51.100.1')).status).toBe(401);
    const blocked = await unlock(CODE, '198.51.100.1'); // גם הקוד הנכון מחכה
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { error: string; retryAfter: number };
    expect(body.error).toBe('rate_limited');
    expect(body.retryAfter).toBe(60);
    expect(blocked.headers.get('retry-after')).toBe('60');
    expect((await unlock(CODE, '198.51.100.2')).status).toBe(200);
    clock += 60_000;
    expect((await unlock(CODE, '198.51.100.1')).status).toBe(200);
  });

  it('קוד נכון מאפס את הספירה של הכתובת', async () => {
    await start({ limits: { ipFailures: 3 } });
    expect((await unlock('00000000', '198.51.100.3')).status).toBe(401);
    expect((await unlock('00000000', '198.51.100.3')).status).toBe(401);
    expect((await unlock(CODE, '198.51.100.3')).status).toBe(200);
    expect((await unlock('00000000', '198.51.100.3')).status).toBe(401);
    expect((await unlock('00000000', '198.51.100.3')).status).toBe(401);
    expect((await unlock(CODE, '198.51.100.3')).status).toBe(200);
  });

  it('★ תקרה לכולם יחד: החלפת כתובות לא מאפשרת ניחוש', async () => {
    await start({ limits: { ipFailures: 100, totalFailures: 4, totalWindowMs: 60_000 } });
    for (let i = 0; i < 4; i += 1)
      expect((await unlock('00000000', `192.0.2.${i}`)).status).toBe(401);
    expect((await unlock('00000000', '192.0.2.99')).status).toBe(429);
    expect((await unlock(CODE, '192.0.2.100')).status).toBe(429);
    clock += 60_000;
    expect((await unlock(CODE, '192.0.2.100')).status).toBe(200);
  });

  it('בדיקה אחת בכל רגע; תור מלא עונה "עסוק"', async () => {
    let running = 0;
    let peak = 0;
    const slow = async (rec: HashRecord, code: string) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 40));
      running -= 1;
      return verifyCode(rec, code) as Promise<boolean>;
    };
    await start({ verify: slow, limits: { maxQueue: 2 } });
    const statuses = (
      await Promise.all([unlock(CODE, '1.1.1.1'), unlock(CODE, '1.1.1.2'), unlock(CODE, '1.1.1.3')])
    ).map((r) => r.status);
    expect(statuses.sort()).toEqual([200, 200, 503]);
    expect(peak).toBe(1);
  });

  it('בלי רשומת קוד תקינה — הכול נשאר נעול', async () => {
    await start({ record: null });
    const res = await unlock(CODE);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: 'not_configured' });
    expect((await check({ 'x-original-uri': '/desktop/SealEXE.exe' })).status).toBe(403);
    expect(
      (await check({ 'x-original-uri': SEAL_BASE_PATH, 'user-agent': ELECTRON_UA })).status,
    ).toBe(204);
  });
});
