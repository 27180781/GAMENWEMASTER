/**
 * שמירת מספרי השלטים שנקלטו בלחיצה חזרה במערכת יצירת המשחקים.
 *
 * משתתף שהגיע מהבונה בלי מספר (`pendingUsers`) ונקשר כאן לשלט בלחיצה נשלח ל-
 * save-clicker-numbers, וכך המספר נשמר בבונה ומגיע לכל מחשב שמריץ את המשחק.
 * השרת רק משלים: משתתף שכבר יש לו מספר בבונה, או מספר שכבר שייך שם למשתתף
 * אחר, אינם משתנים. ההכרעה חוזרת בתשובה ומוצגת במרשם.
 *
 * אין כאן תור שצריך לשמור בנפרד: מה שעוד לא נשמר נגזר בכל רגע מהמרשם (שחקן עם
 * participantId שעדיין ממתין בקובץ) פחות מה שהשרת כבר ענה עליו (נשמר ב-
 * localStorage לפי משחק). לכן מחשב בלי אינטרנט, או תוכנה שנסגרה באמצע,
 * ממשיכים מאותה נקודה כשהרשת חוזרת.
 */

import type { BackupConfig } from './backup.ts';
import type { GamePendingUser, RosterData } from './roster.ts';

/** התשובה של השרת לכל שיוך (ושתי תשובות שחלות על כל הבקשה). */
export type ClickerSaveStatus =
  | 'saved' // נשמר עכשיו
  | 'already' // כבר היה שמור, אותו מספר
  | 'has_number' // למשתתף כבר יש בבונה מספר אחר
  | 'taken' // המספר כבר שייך בבונה למשתתף אחר
  | 'unknown' // המשתתף כבר לא במשחק
  | 'invalid' // מספר או מזהה לא תקינים
  | 'no_license' // אין למשחק רישיון קליקרים בתוקף
  | 'game_not_found'; // המשחק נמחק

const STATUSES: ReadonlySet<string> = new Set<ClickerSaveStatus>([
  'saved',
  'already',
  'has_number',
  'taken',
  'unknown',
  'invalid',
  'no_license',
  'game_not_found',
]);

const OK: ReadonlySet<ClickerSaveStatus> = new Set<ClickerSaveStatus>(['saved', 'already']);

export interface ClickerAssignment {
  participantId: string;
  clickerId: string;
}

/** התשובה האחרונה מהשרת למשתתף: לאיזה מספר, ומה הוכרע. */
export interface SettledAssignment {
  clickerId: string;
  status: ClickerSaveStatus;
}

/** participantId → התשובה האחרונה. */
export type SettledMap = Record<string, SettledAssignment>;

/** מספר שלט אמיתי (הריסיבר מדווח 1–9999). */
export function isClickerNumber(id: string): boolean {
  return /^[1-9][0-9]{0,3}$/.test(id);
}

function waitingIds(pending: readonly GamePendingUser[]): Set<string> {
  return new Set(pending.map((u) => u.id).filter((id) => id !== ''));
}

/**
 * מה עוד צריך לשלוח: שלטים שנקשרו כאן למשתתף שהבונה עדיין מחכה לו, ושהשרת לא
 * ענה עליהם כבר על אותו מספר. שיוך שהשתנה כאן (שלט אחר לאותו משתתף) נשלח שוב.
 */
export function assignmentsToSend(
  roster: RosterData,
  pending: readonly GamePendingUser[],
  settled: SettledMap,
): ClickerAssignment[] {
  const waiting = waitingIds(pending);
  const out: ClickerAssignment[] = [];
  const seen = new Set<string>();
  for (const p of roster.players) {
    const participantId = p.participantId;
    if (participantId === undefined || !waiting.has(participantId) || seen.has(participantId)) continue;
    if (!isClickerNumber(p.id)) continue;
    seen.add(participantId);
    if (settled[participantId]?.clickerId === p.id) continue;
    out.push({ participantId, clickerId: p.id });
  }
  return out;
}

/** לשורת המצב במרשם. */
export interface ClickerSaveSummary {
  /** שמורים בבונה (מהמחשב הזה). */
  saved: number;
  /** ממתינים לשליחה. */
  waiting: number;
  /** השרת סירב (למשתתף כבר יש מספר, המספר תפוס, המשתתף נמחק). */
  rejected: number;
  /** הסירוב הוא כי אין רישיון קליקרים בתוקף. */
  noLicense: boolean;
}

export function summarizeClickerSave(
  roster: RosterData,
  pending: readonly GamePendingUser[],
  settled: SettledMap,
): ClickerSaveSummary {
  const waiting = waitingIds(pending);
  const summary: ClickerSaveSummary = { saved: 0, waiting: 0, rejected: 0, noLicense: false };
  for (const p of roster.players) {
    const participantId = p.participantId;
    if (participantId === undefined) continue;
    const answer = settled[participantId];
    if (answer !== undefined && answer.clickerId === p.id) {
      if (OK.has(answer.status)) summary.saved += 1;
      else {
        summary.rejected += 1;
        if (answer.status === 'no_license') summary.noLicense = true;
      }
    } else if (waiting.has(participantId) && isClickerNumber(p.id)) {
      summary.waiting += 1;
    }
  }
  return summary;
}

/** תוצאת שליחה: תשובות לשיוכים, או "לנסות שוב אחר כך" (רשת, שרת, פונקציה שעוד לא עלתה). */
export type SendOutcome = { kind: 'answered'; settled: SettledMap } | { kind: 'retry'; reason: string };

/**
 * פענוח התשובה של save-clicker-numbers. 200 = תשובה לכל שיוך; 403 / 404 עם
 * השגיאה שלנו חלים על כל הבקשה ונרשמים כתשובה (לא שולחים שוב סתם); כל השאר,
 * כולל 404 של שער Supabase כשהפונקציה עוד לא עלתה, = לנסות שוב.
 */
export function parseSaveResponse(status: number, body: unknown, sent: readonly ClickerAssignment[]): SendOutcome {
  const obj = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const all = (answer: ClickerSaveStatus): SendOutcome => ({
    kind: 'answered',
    settled: Object.fromEntries(sent.map((a) => [a.participantId, { clickerId: a.clickerId, status: answer }])),
  });
  if (status === 403 && obj.error === 'no_license') return all('no_license');
  if (status === 404 && obj.error === 'game_not_found') return all('game_not_found');
  if (status === 400 && obj.error === 'invalid_request') return all('invalid');
  if (status !== 200 || !Array.isArray(obj.results)) return { kind: 'retry', reason: `HTTP ${status}` };

  const settled: SettledMap = {};
  const byParticipant = new Map(sent.map((a) => [a.participantId, a.clickerId]));
  for (const entry of obj.results) {
    if (entry === null || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const participantId = typeof e.participantId === 'string' ? e.participantId : '';
    const clickerId = byParticipant.get(participantId);
    if (clickerId === undefined || typeof e.status !== 'string' || !STATUSES.has(e.status)) continue;
    settled[participantId] = { clickerId, status: e.status as ClickerSaveStatus };
  }
  // שיוך שלא חזרה עליו תשובה — נשלח שוב בפעם הבאה (לא נרשם).
  return { kind: 'answered', settled };
}

/** שליחה אחת לשרת. לא זורקת: כל כישלון רשת הוא "לנסות שוב". */
export async function postClickerNumbers(
  cfg: BackupConfig,
  gameId: string,
  assignments: readonly ClickerAssignment[],
  fetchFn: typeof fetch = fetch,
): Promise<SendOutcome> {
  try {
    const res = await fetchFn(`${cfg.baseUrl}/save-clicker-numbers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.anonKey,
        Authorization: `Bearer ${cfg.anonKey}`,
      },
      body: JSON.stringify({ gameId, assignments }),
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return parseSaveResponse(res.status, body, assignments);
  } catch (err) {
    return { kind: 'retry', reason: (err as Error).message || 'network' };
  }
}

// ---------------------------------------------------------------------------
// התשובות שכבר התקבלו, לפי משחק
// ---------------------------------------------------------------------------

const SETTLED_PREFIX = 'trivia-clicker-saved:';

export function settledStorageKey(gameId: string): string {
  return SETTLED_PREFIX + (gameId.trim() === '' ? 'default' : gameId);
}

export function normalizeSettled(raw: unknown): SettledMap {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: SettledMap = {};
  for (const [participantId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    if (typeof v.clickerId !== 'string' || typeof v.status !== 'string' || !STATUSES.has(v.status)) continue;
    out[participantId] = { clickerId: v.clickerId, status: v.status as ClickerSaveStatus };
  }
  return out;
}

export function loadSettled(gameId: string): SettledMap {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(settledStorageKey(gameId));
    return raw === null ? {} : normalizeSettled(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveSettled(gameId: string, settled: SettledMap): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(settledStorageKey(gameId), JSON.stringify(settled));
  } catch {
    /* מכסת אחסון חריגה — מתעלמים; השליחה תחזור ותקבל "already" */
  }
}

// ---------------------------------------------------------------------------
// המנגנון שרץ כל עוד המשחק טעון
// ---------------------------------------------------------------------------

/** המתנה אחרי כישלון: 15 שנ', 30 שנ', דקה, 2, 5, ואז כל 10 דקות. */
export const RETRY_DELAYS_MS = [15_000, 30_000, 60_000, 120_000, 300_000, 600_000] as const;

/** גודל בקשה אחת. */
export const SAVE_BATCH = 200;

export interface ClickerSaveView extends ClickerSaveSummary {
  sending: boolean;
  /** הניסיון האחרון נכשל (אין רשת / השרת לא ענה) — ננסה שוב לבד. */
  failing: boolean;
}

export interface ClickerSaverOptions {
  pending: readonly GamePendingUser[];
  readRoster: () => RosterData;
  readSettled: () => SettledMap;
  writeSettled: (settled: SettledMap) => void;
  send: (assignments: ClickerAssignment[]) => Promise<SendOutcome>;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
}

export class ClickerSaver {
  private readonly opts: ClickerSaverOptions;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly now: () => number;
  private timer: unknown = null;
  private timerAt = 0;
  private sending = false;
  private failures = 0;
  private stopped = false;
  /** התבקשה שליחה באמצע שליחה. */
  private again = false;
  private readonly listeners = new Set<() => void>();

  constructor(opts: ClickerSaverOptions) {
    this.opts = opts;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.now = opts.now ?? (() => Date.now());
  }

  view(): ClickerSaveView {
    const summary = summarizeClickerSave(this.opts.readRoster(), this.opts.pending, this.opts.readSettled());
    return { ...summary, sending: this.sending, failing: this.failures > 0 };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * המרשם השתנה (לחיצה, שם שנוסף לתור, רענון). שולחים בעוד רגע — אבל אחרי
   * כישלון מחכים לתור הניסיון הבא, כדי שכל לחיצה בלי רשת לא תשלח בקשה.
   */
  nudge(delayMs = 1500): void {
    this.emit();
    if (this.stopped || this.failures > 0) return;
    this.schedule(delayMs);
  }

  /** הרשת חזרה — מנסים מיד. */
  retryNow(): void {
    if (this.stopped) return;
    this.failures = 0;
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.listeners.clear();
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }

  private schedule(ms: number): void {
    const at = this.now() + ms;
    if (this.timer !== null) {
      if (this.timerAt <= at) return;
      this.clearTimer(this.timer);
    }
    this.timerAt = at;
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  /** שליחת כל מה שממתין. רצה אחת בכל פעם; קריאה באמצע שליחה תרוץ אחריה. */
  async flush(): Promise<void> {
    if (this.stopped) return;
    if (this.sending) {
      this.again = true;
      return;
    }
    const todo = assignmentsToSend(this.opts.readRoster(), this.opts.pending, this.opts.readSettled());
    if (todo.length === 0) {
      if (this.failures > 0) {
        this.failures = 0;
        this.emit();
      }
      return;
    }
    this.sending = true;
    this.again = false;
    this.emit();
    let failed = false;
    try {
      for (let i = 0; i < todo.length && !failed; i += SAVE_BATCH) {
        const chunk = todo.slice(i, i + SAVE_BATCH);
        const out = await this.opts.send(chunk);
        if (this.stopped) return;
        if (out.kind === 'retry') {
          failed = true;
        } else {
          this.opts.writeSettled({ ...this.opts.readSettled(), ...out.settled });
          // תשובה שדילגה על שיוך — כמו כישלון, אחרת היינו שולחים אותו שוב ושוב.
          if (chunk.some((a) => out.settled[a.participantId] === undefined)) failed = true;
        }
      }
    } catch {
      failed = true;
    } finally {
      this.sending = false;
    }
    if (this.stopped) return;
    if (failed) {
      this.failures += 1;
      this.schedule(RETRY_DELAYS_MS[Math.min(this.failures, RETRY_DELAYS_MS.length) - 1]!);
    } else {
      this.failures = 0;
      const more = assignmentsToSend(this.opts.readRoster(), this.opts.pending, this.opts.readSettled());
      if (more.length > 0) this.schedule(this.again ? 0 : 1500);
    }
    this.emit();
  }
}

// ---------------------------------------------------------------------------
// הנוסח לשורת המצב במרשם
// ---------------------------------------------------------------------------

function count(n: number): string {
  return n === 1 ? 'מספר שלט אחד' : `${n} מספרי שלטים`;
}

/** הפועל לפי המספר: נשמר / נשמרו. */
function verb(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** שורות המצב במרשם (ריק = אין מה להציג). */
export function clickerSaveLines(view: ClickerSaveView | null): { tone: 'ok' | 'wait' | 'warn'; text: string }[] {
  if (view === null) return [];
  const lines: { tone: 'ok' | 'wait' | 'warn'; text: string }[] = [];
  if (view.waiting > 0) {
    const n = view.waiting;
    lines.push({
      tone: 'wait',
      text: view.failing
        ? `⏳ ${count(n)} ${verb(n, 'ממתין', 'ממתינים')} לשמירה במערכת. אין חיבור כרגע, וננסה שוב לבד.`
        : `⏳ שומר במערכת ${count(n)}…`,
    });
  } else if (view.saved > 0) {
    const n = view.saved;
    lines.push({
      tone: 'ok',
      text: `✓ ${count(n)} ${verb(n, 'נשמר', 'נשמרו')} במערכת, וכל מחשב שמריץ את המשחק יקבל ${verb(n, 'אותו', 'אותם')}.`,
    });
  }
  if (view.rejected > 0) {
    const n = view.rejected;
    const here = verb(n, 'כאן הוא עובד כרגיל', 'כאן הם עובדים כרגיל');
    lines.push({
      tone: 'warn',
      text: view.noLicense
        ? `⚠️ ${count(n)} ${verb(n, 'לא נשמר', 'לא נשמרו')} במערכת: אין למשחק רישיון קליקרים בתוקף. ${here}.`
        : `⚠️ ${count(n)} ${verb(n, 'לא נשמר', 'לא נשמרו')} במערכת, כי רשימת המשתתפים שם השתנתה בינתיים. ${here}, ואפשר לבדוק בניהול המשתתפים.`,
    });
  }
  return lines;
}
