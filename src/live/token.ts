/**
 * הקישור למסך הצפייה — ייחודי לכל משחק, ובלי שום סוד בשרת.
 *
 *   מפתח השידור  P = sha256("trivia-live-pub:v1:" + מזהה המשחק + ":" + קוד החדר)
 *   קוד הצפייה   W = 20 התווים הראשונים של sha256("trivia-live-view:v1:" + P)
 *
 * המסך הראשי מכיר את מזהה המשחק ולכן יודע לחשב את P, ומשדר איתו. השרת בודק
 * רק ש-W (בכתובת) נגזר מ-P — כך אף אחד לא יכול לשדר לערוץ של משחק אחר בלי
 * המזהה שלו. מי שמחזיק בקישור הצפייה (W) לא יכול לחזור ממנו ל-P או למזהה
 * המשחק, שפותח את קובץ המשחק כולו (כולל טלפונים).
 *
 * מערכת יצירת המשחקים מחשבת את אותו W ממזהה המשחק ומקוד החדר של הרישיון
 * (src/lib/viewLink.ts שם) ומציגה אותו בהזמנת המשתתפים. **שינוי כאן מחייב
 * שינוי זהה שם** — אחרת הקישורים שנשלחו יפסיקו לעבוד.
 */

export const LIVE_PUB_PREFIX = 'trivia-live-pub:v1:';
export const LIVE_VIEW_PREFIX = 'trivia-live-view:v1:';
export const VIEW_TOKEN_LENGTH = 20;

/** "0123" ו-123 הם אותו חדר: ה-JSON שולח את הקוד כמספר, הרישיון שומר מחרוזת. */
export function normalizeRoom(room: string | number | null | undefined): string {
  const text = String(room ?? '').trim();
  return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, '') : text;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function livePublishKey(gameId: string, room: string | number): Promise<string> {
  return sha256Hex(`${LIVE_PUB_PREFIX}${gameId.trim()}:${normalizeRoom(room)}`);
}

export async function liveViewToken(publishKey: string): Promise<string> {
  return (await sha256Hex(`${LIVE_VIEW_PREFIX}${publishKey}`)).slice(0, VIEW_TOKEN_LENGTH);
}

export function isViewToken(value: string): boolean {
  return new RegExp(`^[0-9a-f]{${VIEW_TOKEN_LENGTH}}$`).test(value);
}

/** השרת שמארח את המנוע ואת ממסר השידור. */
export const LIVE_SERVER_ORIGIN = 'https://gamemwemaster.caprover.clicker.co.il';

/**
 * כתובת הממסר. מהאתר עצמו — אותו מקור; מה-EXE או מכל מקום אחר — השרת.
 * ‎?liveRelay=‎ דורס לבדיקות (למשל ממסר מקומי).
 */
export function liveRelayBase(
  location: { origin: string; search: string } = window.location,
): string {
  const override = new URLSearchParams(location.search).get('liveRelay');
  if (override !== null && /^https?:\/\//.test(override)) return override.replace(/\/+$/, '');
  if (location.origin === LIVE_SERVER_ORIGIN) return `${location.origin}/live`;
  return `${LIVE_SERVER_ORIGIN}/live`;
}

/** הקישור שהמשתתפים פותחים. */
export function liveViewUrl(token: string): string {
  return `${LIVE_SERVER_ORIGIN}/?view=${token}`;
}
