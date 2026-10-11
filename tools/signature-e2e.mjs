#!/usr/bin/env node
/**
 * בדיקה מקצה לקצה של חתימת קובצי המשחק (electron/gameSignature.cjs) בתוכנה
 * האמיתית (Electron, אחרי npm run build), מול שרת מדומה של מערכת יצירת המשחקים
 * ובמפתח הבדיקה של RFC 8032 — לעולם לא מפתח אמיתי. מפתח שאינו מוטבע בתוכנה
 * מתקבל רק בהרצת פיתוח (TRIVIA_TEST_SIGNING_KEYS, ראו electron/runMode.cjs).
 *
 *   npm run build && xvfb-run -a npm run e2e:signature      # בלינוקס בלי מסך
 *   npm run e2e:signature -- ./signature-e2e                 # שומר צילומים ויומן
 *
 * מה נבדק, לפי הסדר:
 *   1. משחק חתום שנשלח למחשב יורד ונפתח כרגיל: שלטים וטלפונים, בלי נעילה.
 *   2. המגבלה הועלתה בקובץ שבמחשב: בפתיחה הבאה שחקני דמה בלבד, עם ההסבר.
 *   3. המנהל אישר את המחשב לעריכה: אותו קובץ נפתח כרגיל.
 *   4. קובץ שהורד לפני החתימה, המתג כבוי: נפתח כרגיל, והמחשב מבקש לו חתימה.
 *   5. המתג נדלק והמערכת חותמת: החתימה נשמרת ליד הקובץ (שאינו משתנה), והוא נפתח כרגיל.
 *   6. המתג דולק, וקובץ בלי חתימה ששונה: שחקני דמה בלבד, והסירוב של המערכת נשמר.
 *   7. ZIP מהדיסק (הבדיקה עוברת דרך ה-renderer): חתום — כרגיל; ששונה — דמה בלבד.
 *   8. EXE סגור: התצורה שבסופו מצומצמת לתנאים החתומים.
 *   9. EXE סגור שקובץ המשחק בו שונה: שחקני דמה בלבד, עם ההסבר של EXE סגור.
 *  10. EXE סגור בלי חתימה (נבנה לפני החתימה): נפתח כרגיל.
 *
 * ב-Windows התוכנה כותבת לתיקיית הנתונים האמיתית (%APPDATA%\trivia-engine), ולכן
 * שם הבדיקה רצה רק ב-CI (CI=true), על מכונה נקייה.
 *
 * קוד יציאה 1 אם בדיקה כלשהי נכשלה. לעולם לא מריץ playwright install.
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';
import JSZip from 'jszip';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const sig = require(path.join(ROOT, 'electron/gameSignature.cjs'));
const { sealPayload } = require(path.join(ROOT, 'electron/sealPayload.cjs'));

if (process.platform === 'win32' && process.env.CI !== 'true') {
  console.error('ב-Windows הבדיקה כותבת לתיקיית הנתונים האמיתית של התוכנה — רק ב-CI (CI=true).');
  process.exit(2);
}

const OUT = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'signature-e2e-')));
fs.mkdirSync(OUT, { recursive: true });

// --- המפתח, והחתימה כמו signPackageFor במערכת ------------------------------
const RFC_SEED = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const TEST_X = '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo';
const KID = sig.keyIdFor(TEST_X);
const KEYS = { [KID]: TEST_X };
const privateKey = crypto.createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(RFC_SEED, 'hex')]),
  format: 'der',
  type: 'pkcs8',
});
const BOTH = { clickers: true, phones: true, room: '2047', limit: 20 };
const signGame = (game, seal = BOTH) => {
  const payload = sig.canonicalJson({ v: 1, game: game.id, content: sig.contentHash(game), seal, admin: false });
  return { v: 1, kid: KID, payload, sig: crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64') };
};

const GAME_ID = '5d1f0c3e-7c1a-4c55-9a51-2b1e3f6a9d10';
const LICENSE = 'b0a6f1d2-3c4e-4f5a-8b6c-7d8e9f0a1b2c';
const CODE = '654321';

// משחק אמיתי מהקבועים, בלי כתובות חיצוניות (הבדיקה לא יוצאת לרשת).
const blank = (v) => {
  if (typeof v === 'string') return /^https?:\/\//.test(v) ? '' : v;
  if (Array.isArray(v)) return v.map(blank);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blank(x)]));
  return v;
};
const base = blank(JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/neuwirth.json'), 'utf8')));
base.questions = base.questions.slice(0, 4);
base.id = GAME_ID;
base.name = 'חידון חתימה מקצה לקצה';
base.credit = LICENSE;
base.room = '2047';
base.setting.limit = { type: 'clickers', number: 20 };
base.assets = [];
const CONTENT = sig.contentHash(base);
/** החבילה שהמערכת בונה: חתומה, ו-metadata (מחוץ לחתימה) נוסף אחרי החתימה. */
const pkg = () => ({ ...structuredClone(base), signature: signGame(base), metadata: { isOffline: true, version: 'v1' } });
const unsignedPkg = (over = {}) => {
  const g = { ...pkg(), ...over };
  delete g.signature;
  return g;
};

/** מה שהמערכת "יודעת" — הבדיקה משנה אותו בין השלבים. */
const NO_PERMISSIONS = { createGame: false, editGame: false };
const server = {
  permissions: NO_PERMISSIONS,
  requireSigned: false,
  /** 'sign' — חותמת כשהתוכן זהה לחבילה שלה; 'unavailable' — תקלה. */
  signMode: 'unavailable',
  syncBodies: [],
  signRequests: [],
};

const http1 = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'POST' && url.pathname === '/offline-device') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      server.syncBodies.push(body);
      const requests = Array.isArray(body.sign) ? body.sign : [];
      server.signRequests.push(...requests);
      // כמו offline-device: חתימה רק לתוכן שזהה לחבילה של המערכת לאותו משחק ורישיון.
      const signatures = requests.map(({ gameId, license, content }) => {
        if (server.signMode === 'unavailable') return { gameId, content, reason: 'unavailable' };
        if (gameId !== GAME_ID || license !== LICENSE) return { gameId, content, reason: 'no_license' };
        return content === CONTENT ? { gameId, content, signature: signGame(base) } : { gameId, content, reason: 'changed' };
      });
      send(200, {
        ok: true,
        registered: true,
        device: { id: body.deviceId, name: null, permissions: server.permissions, blocked: false },
        games: [{ gameId: GAME_ID, name: base.name, code: CODE, version: 'v1', expiresAt: '2099-01-01T00:00:00Z' }],
        pollSeconds: 600,
        requireSignedGames: server.requireSigned,
        signatures,
      });
    });
    return;
  }
  if (url.pathname === '/get-offline-manifest' && url.searchParams.get('code') === CODE) {
    send(200, { gameJson: pkg(), mediaFiles: [], version: 'v1' });
    return;
  }
  send(404, { error: 'not found' });
});
await new Promise((r) => http1.listen(0, '127.0.0.1', r));
const { port } = http1.address();

const config = fs.mkdtempSync(path.join(os.tmpdir(), 'signature-e2e-config-'));
const baseEnv = {
  ...process.env,
  XDG_CONFIG_HOME: config,
  NO_PROXY: '127.0.0.1,localhost',
  TRIVIA_TEST_SIGNING_KEYS: JSON.stringify(KEYS),
};
for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy']) delete baseEnv[k];
const deviceEnv = { ...baseEnv, TRIVIA_REMOTE_URL: `http://127.0.0.1:${port}` };

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const until = async (fn, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 200))) if (await fn()) return true;
  return await fn();
};

const log = path.join(OUT, 'main.log');
/** התוכנה, עם אותה תיקיית נתונים בכל פתיחה (כמו פתיחה מחדש באותו מחשב). */
const launch = async (env) => {
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
  if (win === null) throw new Error('החלון הראשי לא נפתח');
  return { electronApp, win };
};

let app = null;
let page = null;
const open = async (env) => {
  await app?.close().catch(() => {});
  ({ electronApp: app, win: page } = await launch(env));
};
const shot = (n) => page?.screenshot({ path: path.join(OUT, `${n}.png`) });

const INTRO = '.clicker-intro-card';
const LOCK = '.clicker-intro-locked';
/** מסך "איך משחקים?" של המשחק שנפתח, ומה מוצג בו. */
const intro = async () => {
  // הפעלה ראשונה: חלון "קוד גישה" — ממשיכים בלי קוד.
  await page.locator(INTRO).waitFor({ timeout: 40000 });
  const noCode = page.getByRole('button', { name: 'המשך בלי קוד' });
  if (await noCode.isVisible().catch(() => false)) await noCode.click();
  await page.waitForTimeout(300);
  const lock = (await page.locator(LOCK).count()) > 0 ? (await page.locator(LOCK).innerText()).trim() : '';
  return {
    lock,
    clickers: await page.locator('.clicker-choice--remotes').count(),
    phones: await page.locator('.clicker-choice--phones').count(),
    demo: await page.locator('.clicker-choice--demo').count(),
  };
};
const isOpen = (s) => s.lock === '' && s.clickers === 1 && s.phones === 1;
const isDemoOnly = (s, text) => s.lock.includes(text) && s.clickers === 0 && s.phones === 0 && s.demo === 1;

let dataDir = '';
const libZip = () => path.join(dataDir, 'games', `${CODE}.zip`);
const sidecar = (content) => path.join(dataDir, 'signatures', `${content}.json`);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const savedDevice = () => readJson(path.join(dataDir, 'device.json'));
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** מחליף את קובץ המשחק שבתוך ZIP. */
const writeGameInZip = async (file, game) => {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const name = Object.keys(zip.files).find((n) => /(^|\/)(data|game)\.json$/i.test(n));
  if (name === undefined) throw new Error(`אין קובץ משחק ב-${file}`);
  zip.file(name, JSON.stringify(game, null, 2));
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
};
const gameZip = async (entry, game) => {
  const zip = new JSZip();
  zip.file(entry, JSON.stringify(game, null, 2));
  return zip.generateAsync({ type: 'nodebuffer' });
};
const syncedAfter = (n) => until(() => server.syncBodies.length > n);

try {
  // 1. משחק חתום שנשלח למחשב.
  await open(deviceEnv);
  dataDir = await app.evaluate(({ app: electron }) => electron.getPath('userData'));
  await page.getByText('נפתח המשחק שנשלח למחשב הזה', { exact: false }).waitFor({ timeout: 40000 });
  let s = await intro();
  check('משחק חתום שנשלח למחשב נפתח כרגיל — שלטים וטלפונים', isOpen(s), JSON.stringify(s));
  const first = server.syncBodies[0];
  check('הבדיקה מדווחת 0 קבצים בלי חתימה ואינה מבקשת חתימות', first?.unsignedGames === 0 && first.sign === undefined);
  check('הקובץ שבמחשב נושא את החתימה', fs.existsSync(libZip()));
  await shot('1-signed');

  // 2. המגבלה הועלתה בקובץ שבמחשב (החתימה נשארה).
  await writeGameInZip(libZip(), { ...pkg(), setting: { ...pkg().setting, limit: { type: 'clickers', number: 500 } } });
  let n = server.syncBodies.length;
  await open(deviceEnv);
  s = await intro();
  check('המגבלה הועלתה — שחקני דמה בלבד, עם ההסבר', isDemoOnly(s, 'שונה אחרי שהורד'), JSON.stringify(s));
  await syncedAfter(n);
  const afterTamper = server.syncBodies.at(-1);
  check('קובץ ששונה נספר בלי חתימה ואינו נשלח לחתימה', afterTamper?.unsignedGames === 1 && afterTamper.sign === undefined);
  await shot('2-changed');

  // 3. המנהל אישר את המחשב לעריכה — אותו קובץ נפתח כרגיל.
  server.permissions = { createGame: false, editGame: true };
  await page.evaluate(() => window.triviaDesktop.deviceSync());
  check('האישור נשמר במחשב', savedDevice().permissions.editGame === true);
  await open(deviceEnv);
  s = await intro();
  check('מחשב שאושר לעריכה — הקובץ ששונה נפתח כרגיל', isOpen(s), JSON.stringify(s));
  server.permissions = NO_PERMISSIONS;
  await page.evaluate(() => window.triviaDesktop.deviceSync());
  check('האישור בוטל', savedDevice().permissions.editGame === false);

  // 4. קובץ שהורד לפני החתימה (בלי signature), המתג כבוי.
  await writeGameInZip(libZip(), unsignedPkg());
  n = server.signRequests.length;
  await open(deviceEnv);
  s = await intro();
  check('קובץ בלי חתימה, המתג כבוי — נפתח כרגיל', isOpen(s), JSON.stringify(s));
  const asked = await until(() =>
    server.signRequests.slice(n).some((r) => r.gameId === GAME_ID && r.license === LICENSE && r.content === CONTENT),
  );
  check('המחשב מבקש חתימה לקובץ, עם המשחק, הרישיון וה-hash שלו', asked);
  check('תקלה בשרת — שום דבר לא נשמר', !fs.existsSync(sidecar(CONTENT)));

  // 5. המתג נדלק והמערכת חותמת.
  server.requireSigned = true;
  server.signMode = 'sign';
  const before = sha(libZip());
  await page.evaluate(() => window.triviaDesktop.deviceSync());
  const stored = await until(() => fs.existsSync(sidecar(CONTENT)));
  const kept = stored ? readJson(sidecar(CONTENT)) : {};
  check(
    'החתימה שהמערכת החזירה נשמרת ליד הקובץ ועוברת את הבדיקה',
    stored && sig.verifySignature(kept.signature, GAME_ID, CONTENT, KEYS).state === 'valid',
  );
  check('קובץ המשחק עצמו לא השתנה', sha(libZip()) === before);
  check('המתג נשמר במחשב', savedDevice().requireSigned === true);
  n = server.syncBodies.length;
  await open(deviceEnv);
  s = await intro();
  check('המתג דולק והקובץ קיבל חתימה — נפתח כרגיל', isOpen(s), JSON.stringify(s));
  await syncedAfter(n);
  const afterSign = server.syncBodies.at(-1);
  check('אחרי החתימה — 0 קבצים בלי חתימה, ואין בקשה נוספת', afterSign?.unsignedGames === 0 && afterSign.sign === undefined);
  await shot('5-signed-later');

  // 6. המתג דולק וקובץ בלי חתימה ששונה (שם אחר).
  const changed = unsignedPkg({ name: 'שונה בלי חתימה' });
  const changedContent = sig.contentHash(changed);
  await writeGameInZip(libZip(), changed);
  await open(deviceEnv);
  s = await intro();
  check('המתג דולק, קובץ בלי חתימה — שחקני דמה בלבד, עם ההסבר', isDemoOnly(s, 'אין חתימה של המערכת'), JSON.stringify(s));
  const refused = await until(() => fs.existsSync(sidecar(changedContent)) && readJson(sidecar(changedContent)).refused === 'changed');
  check('המערכת סירבה (התוכן שונה מהחבילה שלה), והסירוב נשמר', refused);
  await shot('6-unsigned-locked');

  // 7. ZIP מהדיסק.
  const signedZip = path.join(OUT, 'signed.zip');
  const changedZip = path.join(OUT, 'changed.zip');
  fs.writeFileSync(signedZip, await gameZip('data.json', pkg()));
  fs.writeFileSync(changedZip, await gameZip('data.json', { ...pkg(), room: '9999' }));
  const loadZip = async (file) => {
    await page.getByRole('button', { name: /טען משחק אחר/ }).click();
    await page.locator('.offline-open-screen').waitFor({ timeout: 20000 });
    await page.locator('input[type=file][accept*=".zip"]').setInputFiles(file);
    return intro();
  };
  s = await loadZip(signedZip);
  check('ZIP חתום מהדיסק — נפתח כרגיל, גם כשהמתג דולק', isOpen(s), JSON.stringify(s));
  s = await loadZip(changedZip);
  check('ZIP מהדיסק ששונה — שחקני דמה בלבד', isDemoOnly(s, 'שונה אחרי שהורד'), JSON.stringify(s));
  await shot('7-zip-changed');
  await app.close().catch(() => {});
  app = null;

  // 8–10. EXE סגור. התצורה שבסופו מבקשת יותר ממה שנחתם: 500 משתתפים וטלפונים.
  const SEAL_TERMS = { clickers: true, phones: false, room: null, limit: 20 };
  const sealedGame = { ...structuredClone(base), signature: signGame(base, SEAL_TERMS) };
  const sealConfig = { room: '9999', allowClickers: true, allowPhones: true, limit: 500, name: 'EXE סגור' };
  const sealExe = async (name, game) => {
    const file = path.join(OUT, name);
    fs.writeFileSync(file, sealPayload(Buffer.from('MZ signature-e2e base'), await gameZip('game.json', game), sealConfig));
    return file;
  };
  const sealedEnv = async (name, game) => ({ ...baseEnv, PORTABLE_EXECUTABLE_FILE: await sealExe(name, game) });

  await open(await sealedEnv('sealed-signed.exe', sealedGame));
  s = await intro();
  const loaded = await page.evaluate(() => window.triviaDesktop.loadSavedGame('sealed'));
  check('EXE סגור חתום — נפתח, בלי טלפונים שלא נחתמו', s.lock === '' && s.clickers === 1 && s.phones === 0, JSON.stringify(s));
  check(
    'התצורה מצומצמת לתנאים החתומים — 20 משתתפים, בלי טלפונים',
    loaded?.config?.limit === 20 && loaded.config.allowPhones === false && loaded.signature?.state === 'valid',
    JSON.stringify(loaded?.config),
  );
  await shot('8-sealed');

  await open(await sealedEnv('sealed-changed.exe', { ...sealedGame, setting: { ...sealedGame.setting, limit: { type: 'clickers', number: 500 } } }));
  s = await intro();
  check('EXE סגור שקובץ המשחק בו שונה — שחקני דמה בלבד, עם ההסבר', isDemoOnly(s, 'צרו את קובץ ה-EXE מחדש'), JSON.stringify(s));
  await shot('9-sealed-changed');

  const oldSealed = { ...structuredClone(base) };
  await open(await sealedEnv('sealed-unsigned.exe', oldSealed));
  s = await intro();
  check('EXE סגור בלי חתימה (נבנה לפני החתימה) — נפתח כרגיל', s.lock === '' && s.clickers === 1, JSON.stringify(s));
} catch (err) {
  check('הריצה', false, err instanceof Error ? err.message.split('\n')[0] : String(err));
  await shot('error')?.catch(() => {});
} finally {
  await app?.close().catch(() => {});
  if (http1.listening) http1.close();
  fs.rmSync(config, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${failed === 0 ? `כל ${results.length} הבדיקות עברו` : `${failed} נכשלו`} · צילומים ויומן: ${OUT}`);
process.exit(failed === 0 ? 0 : 1);
