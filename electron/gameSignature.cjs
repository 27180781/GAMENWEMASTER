// @ts-check
/**
 * חתימת השרת על קובצי המשחק — פער 5 בסקירת האבטחה של תוכנת האופליין (אושר
 * 2026-10-11).
 *
 * הבעיה: לקוח יכול היה לפתוח את data.json (או את game.json שבתוך EXE סגור),
 * להעלות את setting.limit.number ולשחק עם כמה שלטים שירצה.
 *
 * מעכשיו כל חבילה שמערכת יצירת המשחקים בונה (get-offline-manifest,
 * download-by-code והחבילות שנשלחות למחשבים) נושאת `signature`: חתימת Ed25519
 * של השרת על התוכן ועל תנאי הרישיון שאיתו נבנתה. המפתח הפרטי קיים רק בשרת; כאן
 * יש רק המפתחות הציבוריים (PUBLIC_KEYS), והבדיקה רצה במחשב עצמו בכל טעינת משחק,
 * בלי רשת: שום דבר באירוע אינו תלוי בשרת (דרישה של נסים).
 *
 * מה עושים עם התוצאה (signaturePolicy):
 *   valid    — כרגיל. במשחק סגור (EXE חתום) התצורה שבסוף ה-EXE מצומצמת לתנאים
 *              החתומים (boundSealConfig), ולכן עריכה שלה כבר לא מעלה את המגבלה.
 *   invalid  — הקובץ שונה אחרי שנחתם: שחקני דמה בלבד, אלא אם המנהל אישר את
 *              המחשב לבנייה או לעריכה של משחקים.
 *   unsigned — בלי חתימה (הורד לפני שהמערכת התחילה לחתום, נבנה כאן או נשמר
 *              בעורך שכאן): כרגיל, אלא אם המתג «לחייב חתימה על קובצי משחק» דולק
 *              והמחשב לא אושר. המחשב לומד על המתג רק בבדיקה מול המערכת
 *              (deviceSync.cjs), ולכן מחשב שלא מתחבר אף פעם פותח כל קובץ כרגיל.
 *   error    — תקלה בבדיקה עצמה: כרגיל. תקלה לעולם אינה נועלת משחק.
 * חתימה שאי אפשר לקרוא, מגרסה לא מוכרת או במפתח שהתוכנה לא מכירה נחשבת "בלי
 * חתימה" ולא "שונה": מחיקת השדה עושה בדיוק אותו דבר, והחמרה הייתה פוגעת רק
 * בקובץ שנחתם במפתח חדש יותר מהתוכנה.
 *
 * הפורמט, זהה בייט לבייט ל-_shared/offlineSignature.ts במערכת:
 *   signature = { v: 1, kid, payload, sig }
 *   payload   = canonicalJson({ v: 1, game, content, seal, admin }), המחרוזת שנחתמה (UTF-8)
 *   content   = sha256 (hex) של canonicalJson(המשחק בלי signature, metadata, users ו-pendingUsers)
 *   sig       = base64 של 64 בתי החתימה
 *   kid       = 16 תווי ה-hex הראשונים של sha256(המפתח הציבורי הגולמי, 32 בתים)
 * `metadata` משתנה בכל בנייה. המשתתפים אינם תנאי רישיון (המגבלה היא
 * setting.limit.number), והם משתנים אחרי ההורדה — בבונה, וגם כאן כשמספרי שלטים
 * נקלטים בלחיצה. הגיבוב הוא על הצורה הקנונית ולא על בתי הקובץ, ולכן הזחה אחרת
 * (data.json של ההורדה, game.json של EXE סגור) אינה שוברת אותו, ושינוי של מספר
 * כן. **שינוי בצורה הקנונית או ברשימת השדות שמחוץ לחתימה שובר כל קובץ שבשטח**:
 * הווקטורים ב-tests/gameSignature.test.ts זהים לאלה שבמערכת
 * (scripts/test-edge-shared.mjs), ומשנים את שניהם יחד.
 *
 * קבצים שהורדו לפני החתימה: בבדיקה מול המערכת התוכנה שולחת את מזהה המשחק, את
 * הרישיון שאיתו נבנה הקובץ (`credit`) ואת ה-hash של התוכן, ומקבלת את החתימה של
 * החבילה שהמערכת הייתה בונה היום לאותו משחק ולאותו רישיון, רק אם התוכן זהה
 * (surveyFiles, applySignatures). החתימה נשמרת ליד הקובץ ולא בתוכו, ב-
 * signatures/<hash>.json בתיקיית הנתונים, ולכן הקובץ עצמו לא משתנה. היא נבדקת
 * כאן מול המפתחות המוטבעים כמו כל חתימה אחרת, כך ששרת מזויף (TRIVIA_REMOTE_URL)
 * אינו יכול לחתום.
 *
 * Chromium שבגרסת ה-Electron הזו אינו מכיר Ed25519 ב-WebCrypto, ולכן הבדיקה כולה
 * בתהליך הראשי (node:crypto). הקובץ אינו נוגע ב-Electron — ראו
 * tests/gameSignature.test.ts.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SIGNATURE_VERSION = 1;
/** השדות שמחוץ לחתימה (ראו למעלה). */
const UNSIGNED_KEYS = Object.freeze(['signature', 'metadata', 'users', 'pendingUsers']);

/**
 * המפתחות הציבוריים של המערכת: kid → המפתח הגולמי (base64url, ה-x של ה-JWK),
 * כפי ש-offline-device { action: 'signingKey' } מחזירה אותם. מפתח חדש נכנס לכאן
 * בגרסה של התוכנה *לפני* שהמערכת מתחילה לחתום בו. ריק = כל קובץ נקרא "בלי
 * חתימה", בדיוק כמו בגרסה ישנה.
 * @type {Readonly<Record<string, string>>}
 */
const PUBLIC_KEYS = Object.freeze({
  // המפתח הראשון, שהוגרל במסד ב-2026-10-11 (offline_signing_keys).
  a4047b835871cda9: 'FNxsbUo9VeMRnsiTCB8MgvT_fa-APpkAvYIHtE9CoB0',
});

/** קובץ שהמערכת סירבה לחתום (השתנה מאז, אין רישיון) — לא שואלים שוב לפני שעבר שבוע. */
const REFUSAL_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
/** כמה קבצים נשלחים לחתימה בכל בדיקה, כמו MAX_SIGN בשרת: כל אחד בונה שם חבילה שלמה. */
const MAX_SIGN = 5;

const CONTENT_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 64 בתים ב-base64, בצורה היחידה שהשרת כותב. */
const SIG_RE = /^[A-Za-z0-9+/]{86}==$/;

/**
 * @typedef {{ clickers: boolean, phones: boolean, room: string | null, limit: number | null }} SealTerms
 * @typedef {{ v: unknown, game: unknown, content: unknown, seal: unknown, admin: unknown }} SignaturePayload
 * @typedef {(
 *   | { state: 'valid', kid: string, payload: SignaturePayload }
 *   | { state: 'invalid', reason: 'signature' | 'content' | 'game' }
 *   | { state: 'unsigned', reason: 'missing' | 'malformed' | 'version' | 'unknown_key' }
 *   | { state: 'error', reason: string }
 * )} SignatureCheck
 * @typedef {SignatureCheck & { content: string | null, sidecar?: boolean }} GameCheck
 * content: ה-hash של התוכן (null כשהבדיקה לא הגיעה לחישוב). sidecar: החתימה
 * התקינה היא זו ששמורה ליד הקובץ ולא זו שבתוכו.
 * @typedef {{ gameId: string, license: string, content: string }} SignRequest
 * @typedef {(
 *   | { gameId: string, content: string, signature: Record<string, unknown> }
 *   | { gameId: string, content: string, reason: string }
 * )} SignResult
 */

// ---------------------------------------------------------------------------
// הצורה הקנונית וה-hash
// ---------------------------------------------------------------------------

/** @param {unknown} value @returns {string} */
function canon(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  const obj = /** @type {Record<string, unknown>} */ (value);
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canon(obj[k])}`)
    .join(',')}}`;
}

/**
 * JSON עם המפתחות של כל אובייקט ממוינים (לפי יחידות UTF-16, המיון של ברירת
 * המחדל) ובלי רווחים. הערך עובר קודם דרך JSON, ולכן מה שמגובב הוא בדיוק מה
 * שמי שקורא את הקובץ מקבל בחזרה — כמו במערכת.
 * @param {unknown} value
 */
function canonicalJson(value) {
  const plain = JSON.stringify(value);
  return plain === undefined ? 'null' : canon(JSON.parse(plain));
}

/** @param {string | Buffer} data */
const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');

/**
 * ה-hash של התוכן שהחתימה מכסה.
 * @param {Record<string, unknown>} gameJson
 */
function contentHash(gameJson) {
  /** @type {Record<string, unknown>} */
  const content = { ...gameJson };
  for (const key of UNSIGNED_KEYS) delete content[key];
  return sha256Hex(canonicalJson(content));
}

/** kid של מפתח ציבורי גולמי (base64url). @param {string} publicKey */
function keyIdFor(publicKey) {
  return sha256Hex(Buffer.from(publicKey, 'base64url')).slice(0, 16);
}

// ---------------------------------------------------------------------------
// הבדיקה
// ---------------------------------------------------------------------------

/** @type {Map<string, crypto.KeyObject>} */
const keyObjects = new Map();

/** @param {string} x */
function publicKeyObject(x) {
  let key = keyObjects.get(x);
  if (key === undefined) {
    key = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });
    keyObjects.set(x, key);
  }
  return key;
}

/**
 * הבדיקה של חתימה מול מזהה המשחק וה-hash של התוכן: אותם כללים ובאותו סדר כמו
 * checkOfflineSignature במערכת. זורקת רק על מפתח פגום ב-keys.
 * @param {unknown} signature השדה `signature` של הקובץ, או חתימה ששמורה לידו
 * @param {string} gameId `id` של הקובץ, כמחרוזת
 * @param {string} content contentHash של הקובץ
 * @param {Readonly<Record<string, string>>} keys
 * @returns {SignatureCheck}
 */
function verifySignature(signature, gameId, content, keys) {
  if (signature === undefined || signature === null) return { state: 'unsigned', reason: 'missing' };
  const s = /** @type {Record<string, unknown>} */ (signature);
  if (typeof s !== 'object' || typeof s.kid !== 'string' || typeof s.payload !== 'string' || typeof s.sig !== 'string') {
    return { state: 'unsigned', reason: 'malformed' };
  }
  if (s.v !== SIGNATURE_VERSION) return { state: 'unsigned', reason: 'version' };
  const publicKey = Object.prototype.hasOwnProperty.call(keys, s.kid) ? keys[s.kid] : undefined;
  if (!publicKey) return { state: 'unsigned', reason: 'unknown_key' };
  if (!SIG_RE.test(s.sig)) return { state: 'unsigned', reason: 'malformed' };
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(s.payload);
  } catch {
    return { state: 'unsigned', reason: 'malformed' };
  }
  if (parsed === null || typeof parsed !== 'object') return { state: 'unsigned', reason: 'malformed' };
  const payload = /** @type {SignaturePayload} */ (parsed);
  const sig = Buffer.from(s.sig, 'base64');
  if (!crypto.verify(null, Buffer.from(s.payload, 'utf8'), publicKeyObject(publicKey), sig)) {
    return { state: 'invalid', reason: 'signature' };
  }
  if (payload.v !== SIGNATURE_VERSION) return { state: 'unsigned', reason: 'version' };
  if (payload.game !== gameId) return { state: 'invalid', reason: 'game' };
  if (payload.content !== content) return { state: 'invalid', reason: 'content' };
  return { state: 'valid', kid: s.kid, payload };
}

/**
 * ה-`id` של הקובץ כמחרוזת, כמו בבונה (מזהה משחק הוא תמיד מחרוזת). מה שאינו
 * מחרוזת, מספר או בוליאני — '': String() של מערך מקונן עמוק היה זורק.
 * @param {unknown} id
 */
function idText(id) {
  if (typeof id === 'string') return id;
  return typeof id === 'number' || typeof id === 'boolean' ? String(id) : '';
}

/**
 * הבדיקה של קובץ משחק שפוענח (החתימה שבתוכו). לעולם אינה זורקת: תקלה היא
 * 'error', ותקלה לעולם אינה נועלת.
 * @param {unknown} gameJson
 * @param {Readonly<Record<string, string>>} [keys]
 * @returns {GameCheck}
 */
function checkGame(gameJson, keys = PUBLIC_KEYS) {
  try {
    if (gameJson === null || typeof gameJson !== 'object' || Array.isArray(gameJson)) {
      return { state: 'error', reason: 'not_a_game', content: null };
    }
    const g = /** @type {Record<string, unknown>} */ (gameJson);
    /** @type {string} */
    let content;
    try {
      content = contentHash(g);
    } catch {
      // קובץ שאי אפשר לגבב (קינון עמוק מהמחסנית: JSON.parse מקבל אותו, והמנוע
      // מתעלם ממנו בשדה לא מוכר) אינו קובץ שהמערכת חתמה — היא גיבבה אותו כדי
      // לחתום. לא 'error': תקלה לעולם אינה נועלת, וכאן התקלה בידי הקובץ. החתימה
      // נבדקת מול תוכן שאינו תואם אף חתימה, כך שבלי מפתח מוכר (וגם בגרסה בלי
      // מפתחות) התוצאה היא "בלי חתימה", כמו כל קובץ אחר.
      const check = verifySignature(g.signature, idText(g.id), '', keys);
      return check.state === 'valid'
        ? { state: 'invalid', reason: 'content', content: null }
        : { ...check, content: null };
    }
    return { ...verifySignature(g.signature, idText(g.id), content, keys), content };
  } catch (err) {
    return { state: 'error', reason: /** @type {Error} */ (err).message, content: null };
  }
}

// ---------------------------------------------------------------------------
// חתימות ששמורות ליד הקבצים (קבצים שהורדו לפני החתימה)
// ---------------------------------------------------------------------------

/** @param {string} userData */
const signaturesDir = (userData) => path.join(userData, 'signatures');

/** @param {string} userData @param {string} content */
function sidecarPath(userData, content) {
  return CONTENT_RE.test(content) ? path.join(signaturesDir(userData), `${content}.json`) : null;
}

/**
 * מה שמור ליד תוכן מסוים: חתימה, או סירוב של המערכת ומתי. null = כלום.
 * @param {string} userData
 * @param {string} content
 * @returns {{ signature?: unknown, refused?: string, at?: number } | null}
 */
function readSidecar(userData, content) {
  const file = sidecarPath(userData, content);
  if (file === null) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data !== null && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

/**
 * כתיבה זמנית ואז החלפה, כמו device.json. כישלון אינו קריטי: השאלה תחזור בבדיקה הבאה.
 * @param {string} userData
 * @param {string} content
 * @param {Record<string, unknown>} data
 */
function writeSidecar(userData, content, data) {
  const file = sidecarPath(userData, content);
  if (file === null) return false;
  try {
    fs.mkdirSync(signaturesDir(userData), { recursive: true });
    const tmp = `${file}.saving`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

/**
 * הבדיקה של קובץ שנטען: החתימה שבתוכו, ואם אין בו חתימה תקינה — חתימה שהמערכת
 * נתנה לתוכן הזה ונשמרה לידו. לעולם אינה זורקת.
 * @param {unknown} gameJson
 * @param {{ userData?: string | null, keys?: Readonly<Record<string, string>> }} [opts]
 * @returns {GameCheck}
 */
function checkStored(gameJson, opts = {}) {
  const keys = opts.keys ?? PUBLIC_KEYS;
  const own = checkGame(gameJson, keys);
  if (own.state !== 'unsigned' || own.content === null || !opts.userData) return own;
  try {
    const stored = readSidecar(opts.userData, own.content)?.signature;
    if (stored === undefined) return own;
    const id = idText(/** @type {Record<string, unknown>} */ (gameJson).id);
    const viaSidecar = verifySignature(stored, id, own.content, keys);
    return viaSidecar.state === 'valid' ? { ...viaSidecar, content: own.content, sidecar: true } : own;
  } catch {
    return own;
  }
}

// ---------------------------------------------------------------------------
// ההחלטה
// ---------------------------------------------------------------------------

/**
 * מה המשחק רשאי לעשות לפי הבדיקה. `why` אומר למפעיל למה הוא במצב דמה:
 * 'changed' — הקובץ שונה אחרי שנחתם; 'unsigned' — אין חתימה והמתג דולק.
 * @param {{ state: string }} check
 * @param {{ requireSigned: boolean, approved: boolean, sealed: boolean }} ctx
 *   approved: המנהל אישר את המחשב לבנייה או לעריכה. sealed: EXE סגור, שאינו
 *   מתחבר לבדיקת המחשבים ולכן לעולם אינו מקבל את המתג.
 * @returns {{ demoOnly: boolean, why: 'changed' | 'unsigned' | null }}
 */
function signaturePolicy(check, ctx) {
  if (check.state === 'invalid' && !ctx.approved) return { demoOnly: true, why: 'changed' };
  if (check.state === 'unsigned' && ctx.requireSigned && !ctx.approved && !ctx.sealed) {
    return { demoOnly: true, why: 'unsigned' };
  }
  return { demoOnly: false, why: null };
}

/**
 * תנאי הרישיון החתומים, או null: אין חתימה תקינה, או חבילה של מנהל (`admin`),
 * שאין עליה תנאים. כמו signedSealTerms בבונה.
 * @param {{ state: string, payload?: SignaturePayload }} check
 * @returns {SealTerms | null}
 */
function sealTermsOf(check) {
  if (check.state !== 'valid' || !check.payload || check.payload.admin === true) return null;
  const seal = /** @type {Record<string, unknown> | null} */ (
    check.payload.seal !== null && typeof check.payload.seal === 'object' ? check.payload.seal : null
  );
  if (seal === null) return null;
  return {
    clickers: seal.clickers !== false,
    phones: seal.phones !== false,
    room: typeof seal.room === 'string' && seal.room !== '' ? seal.room : null,
    limit: typeof seal.limit === 'number' && seal.limit > 0 ? seal.limit : null,
  };
}

/**
 * תצורת EXE סגור, מצומצמת לתנאים החתומים — אותם כללים כמו boundSealConfig
 * בבונה (src/lib/sealGameExe.ts): מצב שהרישיון לא כולל נכבה, חדר חתום מחליף את
 * החדר שבתצורה, והמגבלה היא לכל היותר החתומה (null = המגבלה של המשחק עצמו,
 * שהחתימה מכסה). מצב שחסר בתצורה מותר, כמו במסך ההגדרות.
 * @template {Record<string, unknown>} T
 * @param {T} config
 * @param {SealTerms | null} terms
 * @returns {T}
 */
function boundSealConfig(config, terms) {
  if (terms === null || config === null || typeof config !== 'object') return config;
  /** @param {unknown} v */
  const allowed = (v) => (v === undefined || v === null ? true : Boolean(v));
  const limit = typeof config.limit === 'number' && Number.isFinite(config.limit) ? config.limit : null;
  return {
    ...config,
    allowClickers: allowed(config.allowClickers) && terms.clickers,
    allowPhones: allowed(config.allowPhones) && terms.phones,
    room: terms.room ?? config.room,
    limit: limit === null || terms.limit === null ? limit : Math.min(limit, terms.limit),
  };
}

// ---------------------------------------------------------------------------
// הקבצים שבמחשב, לבדיקה מול המערכת
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   stamp: string,
 *   ok: boolean,
 *   id: string,
 *   gameId: string | null,
 *   credit: string | null,
 *   own: GameCheck,
 * }} SurveyEntry
 * @type {Map<string, SurveyEntry>}
 */
const surveyCache = new Map();

/**
 * סקירת הקבצים שבמחשב לפני הבדיקה מול המערכת: כמה מהם בלי חתימה תקינה (המנהל
 * רואה את זה לפני שהוא מדליק את המתג), ואילו לשלוח לחתימה — קבצים שאין בהם
 * חתימה בכלל, שלא נבנו או נערכו כאן, עם מזהה משחק ורישיון, ושהמערכת לא סירבה
 * להם בשבוע האחרון. קריאת קובץ מהדיסק וגיבובו נשמרים בזיכרון לפי הנתיב, הגודל
 * והזמן, ולכן רק קובץ חדש או שהשתנה נקרא שוב.
 * @param {{
 *   userData: string,
 *   files: { path: string, local?: boolean, edited?: boolean }[],
 *   readText: (zipPath: string) => string | null,
 *   keys?: Readonly<Record<string, string>>,
 *   now?: number,
 * }} opts
 * @returns {{ unsigned: number, sign: SignRequest[] }}
 */
function surveyFiles(opts) {
  const keys = opts.keys ?? PUBLIC_KEYS;
  const now = opts.now ?? Date.now();
  const keyTag = Object.keys(keys).sort().join(',');
  let unsigned = 0;
  /** @type {SignRequest[]} */
  const sign = [];
  const asked = new Set();
  for (const file of opts.files) {
    /** @type {import('node:fs').Stats} */
    let st;
    try {
      st = fs.statSync(file.path);
    } catch {
      continue;
    }
    const stamp = `${st.size}:${st.mtimeMs}:${keyTag}`;
    let entry = surveyCache.get(file.path);
    if (entry === undefined || entry.stamp !== stamp) {
      entry = surveyEntry(file.path, stamp, opts.readText, keys);
      surveyCache.set(file.path, entry);
    }
    if (!entry.ok) continue;
    if (entry.own.content === null) {
      // קובץ שאי אפשר לגבב (ראו checkGame) — אין מה לשלוח לחתימה, אבל הוא בלי חתימה.
      if (entry.own.state === 'unsigned' || entry.own.state === 'invalid') unsigned += 1;
      continue;
    }
    const content = entry.own.content;
    let state = entry.own.state;
    if (state === 'unsigned') {
      const stored = readSidecar(opts.userData, content);
      try {
        if (stored?.signature !== undefined && verifySignature(stored.signature, entry.id, content, keys).state === 'valid') {
          state = 'valid';
        }
      } catch {
        /* חתימה שמורה פגומה — כאילו אינה */
      }
      const { gameId, credit } = entry;
      if (state === 'unsigned' && gameId !== null && credit !== null) {
        const refusedAt = typeof stored?.refused === 'string' ? Number(stored.at) || 0 : null;
        const candidate =
          entry.own.state === 'unsigned' &&
          entry.own.reason === 'missing' &&
          file.local !== true &&
          file.edited !== true &&
          (refusedAt === null || now - refusedAt >= REFUSAL_RETRY_MS) &&
          !asked.has(content) &&
          sign.length < MAX_SIGN &&
          keyTag !== '';
        if (candidate) {
          asked.add(content);
          sign.push({ gameId, license: credit, content });
        }
      }
    }
    if (state === 'unsigned' || state === 'invalid') unsigned += 1;
  }
  return { unsigned, sign };
}

/**
 * @param {string} zipPath
 * @param {string} stamp
 * @param {(zipPath: string) => string | null} readText
 * @param {Readonly<Record<string, string>>} keys
 * @returns {SurveyEntry}
 */
function surveyEntry(zipPath, stamp, readText, keys) {
  /** @type {SurveyEntry} */
  const bad = { stamp, ok: false, id: '', gameId: null, credit: null, own: { state: 'error', reason: 'unreadable', content: null } };
  /** @type {unknown} */
  let data;
  try {
    const text = readText(zipPath);
    if (text === null) return bad;
    data = JSON.parse(text);
  } catch {
    return bad;
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return bad;
  const g = /** @type {Record<string, unknown>} */ (data);
  /** @param {unknown} v */
  const uuid = (v) => (typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : null);
  return { stamp, ok: true, id: idText(g.id), gameId: uuid(g.id), credit: uuid(g.credit), own: checkGame(g, keys) };
}

/**
 * החתימות שהמערכת החזירה לקבצים שנשלחו (deviceSync.cjs). חתימה שעוברת את
 * הבדיקה מול המפתחות שכאן נשמרת ליד הקובץ. סירוב ('changed', 'no_license'),
 * וגם חתימה שלא עברה (מפתח שהתוכנה לא מכירה, שרת מזויף), נרשמים כדי שלא נשאל
 * שוב לפני שעבר שבוע. 'unavailable' — תקלה בשרת: שואלים שוב בבדיקה הבאה.
 * תשובה על קובץ שלא נשלח בבדיקה הזו — מתעלמים.
 * @param {{
 *   userData: string,
 *   requested: SignRequest[],
 *   results: SignResult[],
 *   keys?: Readonly<Record<string, string>>,
 *   now?: number,
 * }} opts
 * @returns {{ stored: number, refused: number }}
 */
function applySignatures(opts) {
  const keys = opts.keys ?? PUBLIC_KEYS;
  const now = opts.now ?? Date.now();
  const requested = new Map(opts.requested.map((r) => [r.content, r.gameId]));
  let stored = 0;
  let refused = 0;
  for (const r of opts.results) {
    const gameId = requested.get(r.content);
    if (gameId === undefined || gameId !== r.gameId) continue;
    if ('signature' in r) {
      /** @type {SignatureCheck | null} */
      let check = null;
      try {
        check = verifySignature(r.signature, gameId, r.content, keys);
      } catch {
        check = null;
      }
      if (check?.state === 'valid') {
        if (writeSidecar(opts.userData, r.content, { signature: r.signature, at: now })) stored += 1;
      } else if (writeSidecar(opts.userData, r.content, { refused: check?.state === 'unsigned' ? check.reason : 'bad_signature', at: now })) {
        refused += 1;
      }
    } else if (r.reason !== 'unavailable') {
      if (writeSidecar(opts.userData, r.content, { refused: r.reason, at: now })) refused += 1;
    }
  }
  return { stored, refused };
}

module.exports = {
  SIGNATURE_VERSION,
  UNSIGNED_KEYS,
  PUBLIC_KEYS,
  REFUSAL_RETRY_MS,
  MAX_SIGN,
  canonicalJson,
  contentHash,
  keyIdFor,
  verifySignature,
  checkGame,
  checkStored,
  signaturePolicy,
  sealTermsOf,
  boundSealConfig,
  signaturesDir,
  readSidecar,
  surveyFiles,
  applySignatures,
};
