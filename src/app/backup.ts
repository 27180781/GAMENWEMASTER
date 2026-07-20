/**
 * גיבוי ותוצאות מול Supabase Edge Functions (מסמך האינטגרציה).
 *
 * שלושה endpoints:
 *   GET  /save-backup/<gameId>   — שליפת גיבוי חי (null = אין).
 *   POST /save-backup            — שמירת מצב (users/questions/groups כמחרוזות
 *                                  JSON; השרת ממזג רק את מה שנשלח).
 *   POST /save-backup/game-over  — נעילת הגיבוי והעברתו לארכיון התוצאות.
 *
 * מפתח ה-anon של Supabase הוא ציבורי מעצם הגדרתו (מוגן ב-RLS בצד השרת) —
 * לכן מותר להטמיעו בלקוח. ניתן לעקוף בזמן build דרך משתני סביבה, או בזמן ריצה
 * דרך פרמטר הכתובת ‎?backupUrl=‎ (לבדיקות מול שרת מקומי).
 */

import { debugLog } from './debugLog.ts';

const DEFAULT_BASE_URL = 'https://oousxptmdrrkybadikec.supabase.co/functions/v1';
const DEFAULT_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vdXN4cHRtZHJya3liYWRpa2VjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMDc3NzcsImV4cCI6MjA5Mjc4Mzc3N30.9Qb5TZeI-yn3ueuTXh6-XDoFA31FV7EvKGYMu_1QY8c';

/** קריאת ברירת המחדל ממשתני סביבה של Vite (אם הוגדרו), אחרת מהקבועים לעיל. */
function envOr(key: string, fallback: string): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const value = env?.[key];
  return value !== undefined && value !== '' ? value : fallback;
}

export interface BackupConfig {
  baseUrl: string;
  anonKey: string;
}

export const DEFAULT_BACKUP_CONFIG: BackupConfig = {
  baseUrl: envOr('VITE_SUPABASE_BACKUP_URL', DEFAULT_BASE_URL),
  anonKey: envOr('VITE_SUPABASE_ANON_KEY', DEFAULT_ANON_KEY),
};

/** ההקשר להחלטה אם/כיצד לגבות: משחק אונליין מורשה שאינו דמו/אופליין. */
export interface BackupContext {
  offline: boolean;
  gameId: string;
  /** יש קוד חדר (room) — משחק אונליין מורשה. */
  hasRoom: boolean;
  /** שחקני דמה דלוקים — אין גיבוי אמיתי בדמו. */
  crowdEnabled: boolean;
  /** עקיפת כתובת דרך ‎?backupUrl=‎ (לבדיקות מול שרת מקומי), או null. */
  backupUrlOverride: string | null;
}

/**
 * מחזיר את קונפיגורציית הגיבוי למשחק, או null כשאין לגבות (אופליין/דמו/בלי
 * קוד חדר/בלי id). מרכז את ההחלטה כדי שגם מסך ההגדרות (prefetch) וגם המשחק
 * ישתמשו באותו כלל בדיוק.
 */
export function resolveBackupConfig(ctx: BackupContext): BackupConfig | null {
  if (ctx.offline || ctx.gameId === '') return null;
  if (ctx.backupUrlOverride !== null) {
    return { baseUrl: ctx.backupUrlOverride, anonKey: DEFAULT_BACKUP_CONFIG.anonKey };
  }
  return ctx.hasRoom && !ctx.crowdEnabled ? DEFAULT_BACKUP_CONFIG : null;
}

export interface BackupUser {
  name: string;
  score: number;
  groupId: string | null;
  numAnswers: number;
  numCorrect: number;
  details: {
    lastQue: number | null;
    lastVote: number | null;
    /**
     * כל ההצבעות של המשתתף (slideId → answerId) — לשחזור מלא של votesBySlide
     * אחרי קריסה, כדי שסינון correctlyAnsweredBefore ימשיך לעבוד. נשמר בתוך
     * users (מחרוזת JSON שהשרת מחזיר תמיד במלואה). אופציונלי — גיבויים ישנים
     * בלעדיו משוחזרים כמו קודם.
     */
    votes?: Record<string, number>;
  };
}

export interface BackupQuestion {
  queId: number;
  type: string;
  display: boolean;
  numVotes: number;
  correctVotes: number;
  answers: Record<string, number>;
}

export interface BackupGroup {
  id: string;
  name: string;
  score: number;
  memberIds: string[];
}

/** מטא-דאטה לשחזור מדויק (איפה המשחק אחז). */
export interface BackupMeta {
  currentQueId: number | null;
  phase: string;
  startedAt: number;
  /**
   * משתתפים שהוסרו מהמשחק (שקופית function · players) — כדי שההסרה תשרוד
   * קריסה/רענון. best-effort: אם השרת משמיט את ה-meta, ההסרה אובדת (כמו קודם).
   */
  removedIds?: string[];
}

/** המטען שנשמר (POST /save-backup). האובייקטים ממורים ל-JSON לפני השליחה. */
export interface BackupPayload {
  users: Record<string, BackupUser>;
  questions: Record<string, BackupQuestion>;
  groups: BackupGroup[];
  meta: BackupMeta;
}

/** הגיבוי כפי שנשלף (GET) — האובייקטים כבר מפוענחים ממחרוזות ה-JSON. */
export interface BackupData extends BackupPayload {
  id: string;
  completed: boolean;
}

function headers(cfg: BackupConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: cfg.anonKey,
    Authorization: `Bearer ${cfg.anonKey}`,
  };
}

/** פענוח שדה שעשוי להגיע כמחרוזת JSON או כאובייקט כבר-מפוענח. */
function parseMaybeJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    if (value.trim() === '') return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

/**
 * שליפת גיבוי חי למשחק. מחזיר null אם אין גיבוי (או בשגיאת רשת — לא מפילים
 * את המשחק). מנרמל את השדות שעשויים להגיע כמחרוזות JSON.
 */
export async function fetchBackup(cfg: BackupConfig, gameId: string): Promise<BackupData | null> {
  try {
    const res = await fetch(`${cfg.baseUrl}/save-backup/${encodeURIComponent(gameId)}`, {
      headers: headers(cfg),
    });
    if (!res.ok) return null;
    const raw: unknown = await res.json();
    if (raw === null || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    // גוף ריק/‏null לוגי → אין גיבוי
    if (Object.keys(obj).length === 0) return null;
    const data: BackupData = {
      id: String(obj.id ?? gameId),
      users: parseMaybeJson(obj.users, {} as Record<string, BackupUser>),
      questions: parseMaybeJson(obj.questions, {} as Record<string, BackupQuestion>),
      groups: parseMaybeJson(obj.groups, [] as BackupGroup[]),
      meta: parseMaybeJson(obj.meta, {
        currentQueId: (obj.currentQueId as number | null) ?? null,
        phase: String(obj.phase ?? 'showing'),
        startedAt: Number(obj.startedAt) || Date.now(),
      }),
      completed: Boolean(obj.completed),
    };
    debugLog('game', `נמצא גיבוי חי למשחק ${gameId}`, {
      phase: data.meta.phase,
      currentQueId: data.meta.currentQueId,
      users: Object.keys(data.users).length,
    });
    return data;
  } catch (err) {
    debugLog('game', `שליפת גיבוי נכשלה (${String(err)})`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Prefetch: בדיקת הגיבוי מתחילה כבר במסך ההגדרות, במקביל לזמן שהמנחה שוהה בו,
// כך שחלון "להמשיך מאותה נקודה?" מופיע מיד עם הכניסה למשחק — בלי להמתין ל-
// round-trip (וקר-סטארט של Supabase Edge Function יכול לקחת כמה שניות).
// ---------------------------------------------------------------------------
const prefetchCache = new Map<string, Promise<BackupData | null>>();

function prefetchKey(cfg: BackupConfig, gameId: string): string {
  return `${cfg.baseUrl}::${gameId}`;
}

/** מתחיל את שליפת הגיבוי ברקע ושומר את ההבטחה למסירה חד-פעמית ל-getBackup. */
export function prefetchBackup(cfg: BackupConfig, gameId: string): void {
  const key = prefetchKey(cfg, gameId);
  if (prefetchCache.has(key)) return; // כבר בדרך — לא כופלים בקשה
  prefetchCache.set(key, fetchBackup(cfg, gameId));
}

/**
 * מחזיר את תוצאת הגיבוי — מעדיף prefetch שכבר רץ (מסירה חד-פעמית, כדי שלא
 * להחזיר תוצאה מיושנת בהמשך), אחרת שולף טרי. כך המשחק מקבל את התוצאה מיד
 * כשההגדרות כבר הריצו prefetch, ועדיין עובד נכון גם בלי prefetch.
 */
export function getBackup(cfg: BackupConfig, gameId: string): Promise<BackupData | null> {
  const key = prefetchKey(cfg, gameId);
  const pending = prefetchCache.get(key);
  if (pending !== undefined) {
    prefetchCache.delete(key);
    return pending;
  }
  return fetchBackup(cfg, gameId);
}

/** שמירת מצב חי. האובייקטים ממורים ל-JSON כנדרש. זורק בשגיאה כדי שהקורא יידע. */
export async function saveBackup(cfg: BackupConfig, gameId: string, payload: BackupPayload): Promise<void> {
  const body = JSON.stringify({
    id: gameId,
    users: JSON.stringify(payload.users),
    questions: JSON.stringify(payload.questions),
    groups: JSON.stringify(payload.groups),
    // מטא בשתי צורות למקסימום תאימות: כאובייקט meta, וגם כשדות שורש (כפי
    // ש"המלצת הזהב" במסמך מציגה) — כדי שהשחזור ישוחזר למיקום/שלב הנכונים.
    meta: JSON.stringify(payload.meta),
    currentQueId: payload.meta.currentQueId,
    phase: payload.meta.phase,
    startedAt: payload.meta.startedAt,
    completed: false,
  });
  const res = await fetch(`${cfg.baseUrl}/save-backup`, { method: 'POST', headers: headers(cfg), body });
  if (!res.ok) throw new Error(`save-backup נכשל: HTTP ${res.status}`);
}

/** סיום משחק — נועל את הגיבוי ומעביר אותו לארכיון התוצאות. */
export async function endGame(cfg: BackupConfig, gameId: string): Promise<void> {
  const res = await fetch(`${cfg.baseUrl}/save-backup/game-over`, {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({ id: gameId }),
  });
  if (!res.ok) throw new Error(`game-over נכשל: HTTP ${res.status}`);
}
