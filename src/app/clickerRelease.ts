/**
 * «שיוך מחדש» מול מערכת יצירת המשחקים: מספרי שלטים שנשמרו בבונה מלחיצה, ושהשיוך
 * שלהם בוטל בתוכנה, נמחקים גם שם (save-clicker-numbers עם `releases`). הבונה
 * מוחק רק מספר שלא שונה שם מאז שנשמר מלחיצה; מספר שהוקלד בבונה נשאר תמיד.
 *
 * עד שהקובץ שנטען כבר לא מחזיק את המספר הישן, הוא עדיין מופיע ב-`users`. בלי
 * הסתרה, כל טעינה של המשחק (פתיחת התוכנה, רענון, החבילה השמורה במחשב אופליין)
 * הייתה מחזירה את המספרים הישנים ומבטלת את השיוך החדש. לכן כל שיוך שבוטל נשמר
 * כאן (localStorage לפי משחק), ו-applyReleases מעביר אותו מ-`users` לרשימת
 * הממתינים לפני המיזוג למרשם ולפני השמירה בבונה. ההסתרה נשארת גם אחרי שהבונה
 * אישר, עד שהקובץ עצמו מראה את השינוי (pruneReleases): קובץ ישן שנשמר במחשב
 * עדיין מחזיק את המספר.
 */

import type { BackupConfig } from './backup.ts';
import { parseGameUsers, type GamePendingUser, type GameUser, type ReleasedClicker } from './roster.ts';

/** מה הבונה ענה על כל שיוך שבוטל (ושתי תשובות שחלות על כל הבקשה). */
export type ReleaseStatus =
  | 'pending' // עוד לא נענה
  | 'released' // נמחק בבונה
  | 'already' // לא היה לו מספר בבונה (השיוך לא נשמר שם), אין מה למחוק
  | 'kept' // המספר בבונה שונה מאז או הוקלד שם, ולכן נשאר
  | 'unknown' // המשתתף כבר לא במשחק
  | 'invalid' // מספר או מזהה לא תקינים
  | 'no_license' // אין למשחק רישיון קליקרים בתוקף
  | 'game_not_found'; // המשחק נמחק

const ANSWERS: ReadonlySet<string> = new Set<ReleaseStatus>([
  'released',
  'already',
  'kept',
  'unknown',
  'invalid',
  'no_license',
  'game_not_found',
]);

/**
 * מתי הקובץ עלול עדיין להחזיק את השיוך הישן, והתוכנה מסתירה אותו. `kept`
 * ו-`invalid` לא מסתירים: שם הבונה נשאר עם המספר שלו, והקובץ קובע.
 */
const HIDES: ReadonlySet<ReleaseStatus> = new Set<ReleaseStatus>([
  'pending',
  'released',
  'already',
  'unknown',
  'no_license',
  'game_not_found',
]);

export interface ReleaseEntry extends ReleasedClicker {
  status: ReleaseStatus;
}

/** `${participantId}|${clickerId}` → השיוך שבוטל. משתתף יכול להופיע עם כמה שלטים. */
export type ReleaseMap = Record<string, ReleaseEntry>;

export function releaseKey(participantId: string, clickerId: string): string {
  return `${participantId}|${clickerId}`;
}

/** שיוכים שבוטלו עכשיו — נשלחים לבונה (גם אם כבר נשלחו בעבר: אולי נשמרו שוב). */
export function addReleases(map: ReleaseMap, entries: readonly ReleasedClicker[]): ReleaseMap {
  if (entries.length === 0) return map;
  const next: ReleaseMap = { ...map };
  for (const e of entries) {
    next[releaseKey(e.participantId, e.clickerId)] = {
      participantId: e.participantId,
      clickerId: e.clickerId,
      status: 'pending',
    };
  }
  return next;
}

export function releasesToSend(map: ReleaseMap): ReleasedClicker[] {
  return Object.values(map)
    .filter((e) => e.status === 'pending')
    .map(({ participantId, clickerId }) => ({ participantId, clickerId }));
}

/**
 * הקובץ כפי שהתוכנה צריכה לראות אותו אחרי «שיוך מחדש»: שיוך ישן שבוטל יוצא מ-
 * `users` ונכנס לסוף `pendingUsers`, כאילו הבונה כבר מחק אותו. מחזיר את אותו
 * אובייקט כשאין מה להסתיר (וכך גם טביעת האצבע של `users` לא משתנה).
 */
export function applyReleases<T extends { users?: string; pendingUsers: readonly GamePendingUser[] }>(
  file: T,
  map: ReleaseMap,
): T {
  const hide = new Set(
    Object.values(map)
      .filter((e) => HIDES.has(e.status))
      .map((e) => releaseKey(e.participantId, e.clickerId)),
  );
  if (hide.size === 0) return file;
  let raw: unknown;
  try {
    raw = JSON.parse(String(file.users ?? ''));
  } catch {
    return file;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return file;

  const kept: Record<string, unknown> = {};
  const moved: GamePendingUser[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const [user] = parseGameUsers({ [key]: value });
    if (user?.participantId !== undefined && hide.has(releaseKey(user.participantId, user.remoteId))) {
      moved.push({ id: user.participantId, name: user.name, groupName: user.groupName });
    } else {
      kept[key] = value;
    }
  }
  if (moved.length === 0) return file;
  const waiting = new Set(file.pendingUsers.map((u) => u.id));
  return {
    ...file,
    users: JSON.stringify(kept),
    pendingUsers: [...file.pendingUsers, ...moved.filter((u) => !waiting.has(u.id))],
  };
}

/**
 * ניקוי אחרי טעינת קובץ. שיוך שבוטל ונענה יוצא מהרשימה כשהקובץ כבר לא מחזיק
 * אותו (הבונה מחק את המספר או נתן למשתתף מספר אחר), או כשהבונה כבר קיבל מכאן
 * שוב אותו שלט לאותו משתתף (`savedAgain`). `kept` ו-`invalid` יוצאים מיד: הם
 * לא מסתירים דבר. שיוך שעוד לא נענה נשאר עד שיישלח.
 *
 * @param users `users` של הקובץ כמו שהוא, לפני applyReleases.
 */
export function pruneReleases(
  map: ReleaseMap,
  users: readonly GameUser[],
  savedAgain: (participantId: string, clickerId: string) => boolean = () => false,
): ReleaseMap {
  const held = new Set(
    users.flatMap((u) => (u.participantId === undefined ? [] : [releaseKey(u.participantId, u.remoteId)])),
  );
  let changed = false;
  const next: ReleaseMap = {};
  for (const [key, entry] of Object.entries(map)) {
    const drop =
      entry.status !== 'pending' &&
      (!HIDES.has(entry.status) || !held.has(key) || savedAgain(entry.participantId, entry.clickerId));
    if (drop) changed = true;
    else next[key] = entry;
  }
  return changed ? next : map;
}

/** לשורת המצב במרשם. */
export interface ReleaseSummary {
  /** ממתינים למחיקה בבונה. */
  releasing: number;
  /** הבונה השאיר את המספר שלו (שונה שם מאז). */
  kept: number;
  /** לא נמחקו כי אין רישיון קליקרים בתוקף (או שהמשחק נמחק). */
  noLicense: number;
}

export function summarizeReleases(map: ReleaseMap): ReleaseSummary {
  const summary: ReleaseSummary = { releasing: 0, kept: 0, noLicense: 0 };
  for (const e of Object.values(map)) {
    if (e.status === 'pending') summary.releasing += 1;
    else if (e.status === 'kept') summary.kept += 1;
    else if (e.status === 'no_license' || e.status === 'game_not_found') summary.noLicense += 1;
  }
  return summary;
}

/** תשובות לשיוכים שבוטלו, או "לנסות שוב אחר כך". */
export type ReleaseOutcome =
  | { kind: 'answered'; answers: ReleaseEntry[] }
  | { kind: 'retry'; reason: string };

/**
 * פענוח התשובה של save-clicker-numbers לבקשת מחיקה. 200 עם `released` = תשובה
 * לכל שיוך; 403 / 404 עם השגיאה שלנו חלים על כל הבקשה. 400 = שרת שעוד לא מכיר
 * מחיקות (הוא דוחה בקשה בלי שיוכים לשמירה), ולכן כמו כל השאר: לנסות שוב.
 */
export function parseReleaseResponse(
  status: number,
  body: unknown,
  sent: readonly ReleasedClicker[],
): ReleaseOutcome {
  const obj = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const all = (answer: ReleaseStatus): ReleaseOutcome => ({
    kind: 'answered',
    answers: sent.map((e) => ({ ...e, status: answer })),
  });
  if (status === 403 && obj.error === 'no_license') return all('no_license');
  if (status === 404 && obj.error === 'game_not_found') return all('game_not_found');
  if (status !== 200 || !Array.isArray(obj.released)) return { kind: 'retry', reason: `HTTP ${status}` };

  const asked = new Set(sent.map((e) => releaseKey(e.participantId, e.clickerId)));
  const answers: ReleaseEntry[] = [];
  for (const entry of obj.released) {
    if (entry === null || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const participantId = typeof e.participantId === 'string' ? e.participantId : '';
    const clickerId = typeof e.clickerId === 'string' ? e.clickerId : '';
    if (!asked.has(releaseKey(participantId, clickerId))) continue;
    if (typeof e.status !== 'string' || !ANSWERS.has(e.status)) continue;
    answers.push({ participantId, clickerId, status: e.status as ReleaseStatus });
  }
  // שיוך שלא חזרה עליו תשובה נשאר ממתין, ונשלח שוב.
  return { kind: 'answered', answers };
}

/** שליחה אחת לשרת. לא זורקת: כל כישלון רשת הוא "לנסות שוב". */
export async function postReleases(
  cfg: BackupConfig,
  gameId: string,
  releases: readonly ReleasedClicker[],
  fetchFn: typeof fetch = fetch,
): Promise<ReleaseOutcome> {
  try {
    const res = await fetchFn(`${cfg.baseUrl}/save-clicker-numbers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.anonKey,
        Authorization: `Bearer ${cfg.anonKey}`,
      },
      body: JSON.stringify({ gameId, assignments: [], releases }),
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return parseReleaseResponse(res.status, body, releases);
  } catch (err) {
    return { kind: 'retry', reason: (err as Error).message || 'network' };
  }
}

// ---------------------------------------------------------------------------
// השיוכים שבוטלו, לפי משחק
// ---------------------------------------------------------------------------

const RELEASE_PREFIX = 'trivia-clicker-release:';

export function releaseStorageKey(gameId: string): string {
  return RELEASE_PREFIX + (gameId.trim() === '' ? 'default' : gameId);
}

const STATUSES: ReadonlySet<string> = new Set<string>(['pending', ...ANSWERS]);

export function normalizeReleases(raw: unknown): ReleaseMap {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: ReleaseMap = {};
  for (const value of Object.values(raw as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    if (typeof v.participantId !== 'string' || v.participantId === '') continue;
    if (typeof v.clickerId !== 'string' || v.clickerId === '') continue;
    if (typeof v.status !== 'string' || !STATUSES.has(v.status)) continue;
    out[releaseKey(v.participantId, v.clickerId)] = {
      participantId: v.participantId,
      clickerId: v.clickerId,
      status: v.status as ReleaseStatus,
    };
  }
  return out;
}

export function loadReleases(gameId: string): ReleaseMap {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(releaseStorageKey(gameId));
    return raw === null ? {} : normalizeReleases(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveReleases(gameId: string, map: ReleaseMap): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (Object.keys(map).length === 0) localStorage.removeItem(releaseStorageKey(gameId));
    else localStorage.setItem(releaseStorageKey(gameId), JSON.stringify(map));
  } catch {
    /* מכסת אחסון חריגה — מתעלמים */
  }
}
