// @ts-check
/**
 * הבדיקה מול מערכת יצירת המשחקים (פונקציית offline-device): "אני מחשב X, אלה
 * המשחקים שאצלי — מה שויך אליי?". התשובה היא רשימת המשחקים ששויכו למחשב, לכל
 * אחד קוד הקליקרים שלו והגרסה של החבילה שהקוד הזה מוריד. כשהגרסה שונה ממה
 * שבמחשב — יש עדכון.
 *
 * הרשת מוזרקת (post), כדי שהלוגיקה תיבדק בלי Electron — ראו
 * tests/deviceSync.test.ts. מה עושים עם התשובה מחליט ה-renderer
 * (src/app/devicePlan.ts), כי רק הוא יודע מה מוצג עכשיו על המסך.
 */
const identity = require('./deviceIdentity.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Za-z0-9_-]{1,32}$/;
const MAX_GAMES = 200;
const DEFAULT_POLL_SECONDS = 600;

/**
 * @typedef {{
 *   gameId: string,
 *   name: string,
 *   code: string | null,
 *   version: string | null,
 *   expiresAt: string | null,
 *   reason?: 'no_license' | 'unavailable',
 * }} DeviceGame
 * @typedef {{
 *   id: string,
 *   name: string | null,
 *   pendingName: string | null,
 *   registered: boolean,
 *   permissions: import('./deviceIdentity.cjs').Permissions,
 * }} PublicDevice
 * @typedef {{ status: number, body: unknown }} PostResult
 * @typedef {(
 *   | { state: 'ok', device: PublicDevice, games: DeviceGame[], pollSeconds: number }
 *   | { state: 'offline' | 'busy' | 'unavailable' | 'error', device: PublicDevice, error?: string }
 * )} SyncResult
 */

/** בלי הסוד — זה מה שיוצא מהתהליך הראשי ל-renderer. @param {import('./deviceIdentity.cjs').Device} d */
function publicDevice(d) {
  return { id: d.id, name: d.name, pendingName: d.pendingName, registered: d.registered, permissions: { ...d.permissions } };
}

/**
 * מה במחשב: לכל משחק מהמערכת (gameId), הגרסה של העותק החדש ביותר שלו.
 * @param {{ gameId?: string | null, version?: string | null, savedAt?: number, local?: boolean }[]} library
 * @returns {{ gameId: string, version: string | null }[]}
 */
function haveFromLibrary(library) {
  /** @type {Map<string, { version: string | null, savedAt: number }>} */
  const newest = new Map();
  for (const g of library) {
    if (g.local === true || typeof g.gameId !== 'string' || !UUID.test(g.gameId)) continue;
    const id = g.gameId.toLowerCase();
    const savedAt = Number(g.savedAt) || 0;
    const prev = newest.get(id);
    if (prev === undefined || savedAt > prev.savedAt) {
      newest.set(id, { version: typeof g.version === 'string' ? g.version : null, savedAt });
    }
  }
  return [...newest].map(([gameId, v]) => ({ gameId, version: v.version }));
}

/**
 * התשובה מהשרת עוברת סינון לפני שהיא נוגעת בדיסק: קוד שאינו תקין כשם קובץ
 * אינו מגיע להורדה.
 * @param {unknown} raw
 * @returns {DeviceGame[]}
 */
function cleanGames(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {DeviceGame[]} */
  const out = [];
  const seen = new Set();
  for (const item of raw.slice(0, MAX_GAMES)) {
    if (item === null || typeof item !== 'object') continue;
    const g = /** @type {Record<string, unknown>} */ (item);
    if (typeof g.gameId !== 'string' || !UUID.test(g.gameId)) continue;
    const gameId = g.gameId.toLowerCase();
    if (seen.has(gameId)) continue;
    seen.add(gameId);
    const code = typeof g.code === 'string' && CODE.test(g.code) ? g.code : null;
    const version = typeof g.version === 'string' && g.version.length <= 64 ? g.version : null;
    const base = {
      gameId,
      name: typeof g.name === 'string' ? g.name.slice(0, 200) : '',
      expiresAt: typeof g.expiresAt === 'string' ? g.expiresAt : null,
    };
    if (code === null || version === null) {
      out.push({ ...base, code: null, version: null, reason: g.reason === 'unavailable' ? 'unavailable' : 'no_license' });
    } else {
      out.push({ ...base, code, version });
    }
  }
  return out;
}

/** @param {unknown} v */
function pollSeconds(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 60 && n <= 86400 ? Math.round(n) : DEFAULT_POLL_SECONDS;
}

/**
 * @param {{
 *   userData: string,
 *   post: (body: Record<string, unknown>) => Promise<PostResult>,
 *   have: { gameId: string, version: string | null }[],
 *   appVersion?: string,
 *   hostname?: string,
 *   platform?: string,
 *   rand?: import('./deviceIdentity.cjs').Random,
 * }} deps
 * @returns {Promise<SyncResult>}
 */
async function syncDevice(deps) {
  const { userData, post, have, appVersion, hostname, platform, rand } = deps;
  let conflicts = 0;
  for (;;) {
    const device = identity.loadDevice(userData, rand);
    const sentPending = device.pendingName;
    /** @type {PostResult} */
    let res;
    try {
      res = await post({
        action: 'sync',
        deviceId: device.id,
        secret: device.secret,
        hostname,
        appVersion,
        platform,
        have,
        // השם נשלח רק כשהוקלד כאן; בלעדיו השרת שומר את השם שלו.
        ...(typeof sentPending === 'string' ? { name: sentPending } : {}),
      });
    } catch (err) {
      return { state: 'offline', device: publicDevice(device), error: /** @type {Error} */ (err).message };
    }
    const body = /** @type {Record<string, unknown> | null} */ (res.body !== null && typeof res.body === 'object' ? res.body : null);
    if (res.status === 200 && body?.ok === true) {
      const updated = identity.applyServerAnswer(userData, device.id, sentPending, body.device);
      return {
        state: 'ok',
        device: publicDevice(updated),
        games: cleanGames(body.games),
        pollSeconds: pollSeconds(body.pollSeconds),
      };
    }
    if (res.status === 409 && conflicts === 0) {
      // המספר תפוס במחשב אחר — מגרילים מספר חדש ומנסים פעם אחת נוספת.
      conflicts += 1;
      identity.regenerateDevice(userData, device, rand);
      continue;
    }
    if (res.status === 429) return { state: 'busy', device: publicDevice(device) };
    // 404 = הפונקציה עוד לא קיימת בשרת (תוכנה חדשה מול שרת ישן) — אין מה להציג.
    if (res.status === 404) return { state: 'unavailable', device: publicDevice(device) };
    const message = typeof body?.error === 'string' ? body.error : '';
    return { state: 'error', device: publicDevice(device), error: `HTTP ${res.status}${message ? `: ${message}` : ''}` };
  }
}

module.exports = { syncDevice, haveFromLibrary, cleanGames, publicDevice, DEFAULT_POLL_SECONDS };
