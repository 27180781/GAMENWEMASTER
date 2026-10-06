/**
 * הצד של מסך הצפייה: קבלת מצב המסך מהממסר (server/live-relay.mjs).
 *
 * החיבור הוא זרם SSE (EventSource). כשמשהו בדרך עוצר את הזרם (פרוקסי ארגוני
 * שאוגר את התשובה, רשת סלולרית שמנתקת חיבורים ארוכים) — עוברים לבקשות המתנה
 * ארוכות (‎/poll‎), שמחזירות כל שינוי ברגע שהוא קורה.
 *
 * כל הודעה נושאת גרסה רצה (`v`). הפרש מוחל רק על הגרסה שלפניו; פער (הודעה
 * שאבדה) מוביל לסנכרון מחדש — מצב מלא מהממסר. כך מסך הצפייה לעולם לא מציג
 * מצב "מורכב" שלא היה קיים במסך הראשי.
 *
 * שעונים: הזמנים במצב (`at`) הם של המחשב של המנחה. הממסר מודד את ההפרש בין
 * שעונו לשעון המנחה (`skew`), והצופה מודד את ההפרש בין שעונו לשעון הממסר
 * (`now` בכל הודעה). `toLocal` מחבר את שניהם — טיימר וסאונד מתוזמנים לפי
 * השעון של הצופה עצמו.
 */

import { applyPatch, isValidPatch, shareEqual, type PatchOp } from './patch.ts';
import { LIVE_SCHEMA, type LiveSnapshot } from './types.ts';

export type ViewerConnection =
  /** עדיין לא התקבל דבר מהממסר. */
  | 'connecting'
  /** הממסר עונה, אבל המסך הראשי לא משדר (המשחק לא נפתח / נסגר). */
  | 'waiting'
  | 'live'
  /** אין חיבור לממסר. */
  | 'offline'
  /** המסך הראשי משדר בגרסה אחרת — צריך לרענן את הדף. */
  | 'outdated';

export interface ViewerUpdate {
  snapshot: LiveSnapshot | null;
  connection: ViewerConnection;
  /** ממיר זמן של המחשב של המנחה לזמן המקומי. */
  toLocal: (hostTime: number) => number;
}

interface KeyFrame {
  v: number;
  t: number;
  data: unknown;
}

interface PatchFrame {
  v: number;
  t: number;
  ops: unknown;
}

interface RelayMessage {
  type: 'sync' | 'key' | 'patch' | 'beat';
  live: boolean;
  skew: number;
  now: number;
  v: number;
  key?: KeyFrame | null;
  patches?: PatchFrame[];
  patch?: PatchFrame;
}

export interface LiveSubscriberOptions {
  relayBase: string;
  viewToken: string;
  onUpdate: (update: ViewerUpdate) => void;
  now?: () => number;
  fetch?: typeof fetch;
  /** null = אין EventSource (סביבת בדיקה) — ישר לבקשות המתנה. */
  EventSource?: typeof EventSource | null;
  /** כמה זמן מחכים להודעה הראשונה בזרם לפני מעבר להמתנה ארוכה. */
  firstMessageMs?: number;
  /** שקט בזרם (הממסר שולח דופק כל 15 שניות) שאחריו מתחברים מחדש. */
  silenceMs?: number;
}

const OFFSET_SAMPLES = 20;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseMessage(text: string): RelayMessage | null {
  try {
    const msg = JSON.parse(text) as unknown;
    if (!isObject(msg)) return null;
    if (!['sync', 'key', 'patch', 'beat'].includes(String(msg.type))) return null;
    if (typeof msg.v !== 'number' || typeof msg.now !== 'number') return null;
    return msg as unknown as RelayMessage;
  } catch {
    return null;
  }
}

export class LiveSubscriber {
  private readonly url: string;
  private readonly onUpdate: (update: ViewerUpdate) => void;
  private readonly now: () => number;
  private readonly fetchImpl: typeof fetch;
  private readonly EventSourceImpl: typeof EventSource | null;
  private readonly firstMessageMs: number;
  private readonly silenceMs: number;
  private readonly vid: string;

  private snapshot: LiveSnapshot | null = null;
  private version = -1;
  private live = false;
  private heard = false;
  private transportDown = false;
  private outdated = false;
  private skew = 0;
  private offsets: number[] = [];
  private mode: 'sse' | 'poll';
  private source: EventSource | null = null;
  private sseFailures = 0;
  private lastMessageAt = 0;
  private openedAt = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private pollAbort: AbortController | null = null;
  private pollFailures = 0;
  private stopped = false;

  constructor(options: LiveSubscriberOptions) {
    this.url = `${options.relayBase.replace(/\/+$/, '')}/${options.viewToken}`;
    this.onUpdate = options.onUpdate;
    this.now = options.now ?? (() => Date.now());
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.EventSourceImpl =
      options.EventSource !== undefined
        ? options.EventSource
        : typeof EventSource === 'undefined'
          ? null
          : EventSource;
    this.firstMessageMs = options.firstMessageMs ?? 6000;
    this.silenceMs = options.silenceMs ?? 35_000;
    this.vid = Math.random().toString(36).slice(2, 12);
    this.mode = this.EventSourceImpl === null ? 'poll' : 'sse';
  }

  start(): void {
    this.watchdog = setInterval(() => this.checkHealth(), 2000);
    if (this.mode === 'sse') this.openStream();
    else void this.pollLoop();
  }

  stop(): void {
    this.stopped = true;
    if (this.watchdog !== null) clearInterval(this.watchdog);
    this.source?.close();
    this.source = null;
    this.pollAbort?.abort();
  }

  /** זמן של המחשב של המנחה → זמן מקומי. */
  readonly toLocal = (hostTime: number): number => {
    const offset = this.offsets.length === 0 ? 0 : Math.min(...this.offsets);
    return hostTime + this.skew + offset;
  };

  // -------------------------------------------------------------------------
  // SSE
  // -------------------------------------------------------------------------

  private openStream(): void {
    if (this.stopped || this.EventSourceImpl === null) return;
    this.source?.close();
    const source = new this.EventSourceImpl(`${this.url}/events`);
    this.source = source;
    this.openedAt = this.now();
    this.lastMessageAt = 0;
    source.onmessage = (event: MessageEvent) => {
      if (this.source !== source) return;
      this.sseFailures = 0;
      const msg = parseMessage(String(event.data));
      if (msg !== null) this.handle(msg, () => this.openStream());
    };
    source.onerror = () => {
      if (this.source !== source) return;
      // EventSource מתחבר מחדש בעצמו; אם הוא נסגר לגמרי — פותחים מחדש.
      if (source.readyState === 2) {
        this.sseFailures += 1;
        if (this.sseFailures >= 3) this.switchToPoll();
        else setTimeout(() => this.source === source && this.openStream(), 2000);
      }
      this.markDown();
    };
  }

  private switchToPoll(): void {
    if (this.mode === 'poll' || this.stopped) return;
    this.mode = 'poll';
    this.source?.close();
    this.source = null;
    void this.pollLoop();
  }

  private checkHealth(): void {
    if (this.stopped) return;
    const at = this.now();
    if (this.mode === 'sse') {
      // הזרם נפתח אבל שום דבר לא הגיע — משהו בדרך אוגר אותו.
      if (this.lastMessageAt === 0 && at - this.openedAt > this.firstMessageMs) {
        this.switchToPoll();
        return;
      }
      if (this.lastMessageAt > 0 && at - this.lastMessageAt > this.silenceMs) {
        this.sseFailures += 1;
        if (this.sseFailures >= 3) this.switchToPoll();
        else this.openStream();
      }
    }
    if (this.lastMessageAt > 0 && at - this.lastMessageAt > this.silenceMs) this.markDown();
  }

  // -------------------------------------------------------------------------
  // המתנה ארוכה
  // -------------------------------------------------------------------------

  private async pollLoop(): Promise<void> {
    while (!this.stopped && this.mode === 'poll') {
      const abort = new AbortController();
      this.pollAbort = abort;
      const timeout = setTimeout(() => abort.abort(), 40_000);
      try {
        const res = await this.fetchImpl(`${this.url}/poll?after=${this.version}&vid=${this.vid}`, {
          cache: 'no-store',
          signal: abort.signal,
        });
        if (!res.ok) throw new Error(`poll ${res.status}`);
        const msg = parseMessage(await res.text());
        this.pollFailures = 0;
        if (msg !== null) {
          // פער בהמתנה ארוכה נסגר מעצמו: הבקשה הבאה מבקשת מצב מלא (after=-1).
          this.handle(msg, () => {
            this.version = -1;
          });
        }
      } catch {
        if (this.stopped) return;
        this.pollFailures += 1;
        this.markDown();
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(10_000, 1000 * this.pollFailures)),
        );
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  // -------------------------------------------------------------------------
  // החלת הודעות
  // -------------------------------------------------------------------------

  /** `resync` — מה עושים כשהתגלה פער (הודעה שלא הגיעה). */
  private handle(msg: RelayMessage, resync: () => void): void {
    const at = this.now();
    this.lastMessageAt = at;
    this.heard = true;
    this.transportDown = false;
    this.offsets.push(at - msg.now);
    if (this.offsets.length > OFFSET_SAMPLES) this.offsets.shift();
    if (Number.isFinite(msg.skew)) this.skew = msg.skew;
    this.live = msg.live === true;

    let ok = true;
    if (msg.type === 'sync') {
      if (msg.key !== undefined && msg.key !== null) ok = this.applyKey(msg.key);
      for (const patch of msg.patches ?? []) {
        if (!ok) break;
        ok = this.applyPatchFrame(patch);
      }
      if (ok && msg.key === null && (msg.patches?.length ?? 0) === 0 && msg.v < this.version) {
        // הממסר הופעל מחדש ואין לו כלום — מה שיש לנו כבר לא בתוקף.
        this.version = msg.v;
      }
    } else if (msg.type === 'key' && msg.key !== undefined && msg.key !== null) {
      ok = this.applyKey(msg.key);
    } else if (msg.type === 'patch' && msg.patch !== undefined) {
      ok = this.applyPatchFrame(msg.patch);
    } else if (msg.type === 'beat') {
      ok = msg.v === this.version || (msg.v === 0 && this.version <= 0);
    }
    if (!ok) resync();
    this.emit();
  }

  private applyKey(key: KeyFrame): boolean {
    if (!isObject(key.data) || typeof key.v !== 'number') return false;
    this.version = key.v;
    // מבנה מגרסה אחרת של המנוע — לא מנסים להציג אותו (ראו LIVE_SCHEMA).
    this.outdated = key.data.schema !== LIVE_SCHEMA;
    const data = key.data as unknown as LiveSnapshot;
    this.snapshot = this.outdated
      ? null
      : this.snapshot === null
        ? data
        : shareEqual(this.snapshot, data);
    return true;
  }

  private applyPatchFrame(patch: PatchFrame): boolean {
    if (typeof patch.v !== 'number') return false;
    if (patch.v <= this.version) return true; // כבר הוחל
    if (patch.v !== this.version + 1) return false;
    if (this.outdated) {
      this.version = patch.v;
      return true;
    }
    if (this.snapshot === null || !isValidPatch(patch.ops)) return false;
    this.snapshot = applyPatch(this.snapshot, patch.ops as PatchOp[]);
    this.version = patch.v;
    return true;
  }

  get connection(): ViewerConnection {
    if (this.outdated) return 'outdated';
    if (this.transportDown) return 'offline';
    if (!this.heard) return 'connecting';
    if (!this.live) return 'waiting';
    return this.snapshot === null ? 'connecting' : 'live';
  }

  private markDown(): void {
    if (this.transportDown) return;
    this.transportDown = true;
    this.emit();
  }

  private emit(): void {
    this.onUpdate({ snapshot: this.snapshot, connection: this.connection, toLocal: this.toLocal });
  }
}
