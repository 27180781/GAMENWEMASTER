/**
 * הצד של המסך הראשי: שידור מצב המסך לממסר (server/live-relay.mjs), שמעביר
 * אותו לכל מי שפתח את קישור הצפייה.
 *
 * - המצב נבנה רק כשמגיע תורו לצאת (לכל היותר פעם ב-`minIntervalMs`), לא בכל
 *   רינדור של המסך — `poke()` רק מסמן שאולי משהו השתנה.
 * - בפעם הראשונה (ובכל פעם שהממסר מבקש) נשלח מצב מלא; אחר כך רק ההפרש מול
 *   מה שהממסר כבר אישר. שידור אחד בכל רגע — הבא יוצא כשהקודם חזר.
 * - כשאין שינוי — דופק כל `beatMs`, כדי שהצופים יידעו שהמסך הראשי עדיין כאן.
 * - שני מסכים ראשיים לאותו משחק: הממסר מקבל רק את זה שנפתח אחרון. מי שנדחק
 *   ממשיך לשלוח דופק, ותופס שוב את השידור אם האחר השתתק.
 *
 * תקלה ברשת אינה עוצרת את המשחק: השידור פשוט מנסה שוב, בהמתנה הולכת וגדלה.
 */

import { diff, type PatchOp } from './patch.ts';
import type { LiveSnapshot } from './types.ts';

export type PublisherState = 'connecting' | 'live' | 'superseded' | 'offline';

export interface PublisherStatus {
  state: PublisherState;
  /** כמה צופים מחוברים כרגע (לפי הממסר). */
  viewers: number;
}

export interface LivePublisherOptions {
  /** כתובת הממסר, למשל ‎https://…/live‎ (ראו liveRelayBase). */
  relayBase: string;
  viewToken: string;
  publishKey: string;
  /** בונה את מצב המסך העדכני; null = אין עדיין מה לשדר. */
  snapshot: () => LiveSnapshot | null;
  fetch?: typeof fetch;
  now?: () => number;
  minIntervalMs?: number;
  beatMs?: number;
  /** מצב מלא אחרי כל כך הרבה הפרשים, גם בלי בקשה מהממסר. */
  keyEvery?: number;
  onStatus?: (status: PublisherStatus) => void;
}

type Body =
  { kind: 'key'; data: LiveSnapshot } | { kind: 'patch'; ops: PatchOp[] } | { kind: 'beat' };
type Outcome = 'ok' | 'need-key' | 'superseded' | 'retry';

interface RelayReply {
  ok?: boolean;
  viewers?: number;
  wantKey?: boolean;
  error?: string;
}

function randomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class LivePublisher {
  private readonly relayBase: string;
  private readonly viewToken: string;
  private readonly publishKey: string;
  private readonly build: () => LiveSnapshot | null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly minIntervalMs: number;
  private readonly beatMs: number;
  private readonly keyEvery: number;
  private readonly onStatus: ((status: PublisherStatus) => void) | undefined;

  private readonly sid = randomId();
  private readonly started: number;
  /** מה שהממסר מחזיק (המצב האחרון שאושר). */
  private acked: LiveSnapshot | null = null;
  private ackedSeq = -1;
  private seq = 0;
  private needKey = true;
  private patchesSinceKey = 0;
  private dirty = true;
  private inFlight = false;
  private failures = 0;
  private lastSentAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly beatTimer: ReturnType<typeof setInterval>;
  private stopped = false;
  private status: PublisherStatus = { state: 'connecting', viewers: 0 };

  constructor(options: LivePublisherOptions) {
    this.relayBase = options.relayBase.replace(/\/+$/, '');
    this.viewToken = options.viewToken;
    this.publishKey = options.publishKey;
    this.build = options.snapshot;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? (() => Date.now());
    this.minIntervalMs = options.minIntervalMs ?? 200;
    this.beatMs = options.beatMs ?? 5000;
    this.keyEvery = options.keyEvery ?? 500;
    this.onStatus = options.onStatus;
    this.started = this.now();
    this.beatTimer = setInterval(() => this.maybeBeat(), Math.min(1000, this.beatMs));
    this.schedule(0);
  }

  get currentStatus(): PublisherStatus {
    return this.status;
  }

  /** משהו במסך אולי השתנה — המצב ייבנה וייבדק בתור הבא. */
  poke(): void {
    this.dirty = true;
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    clearInterval(this.beatTimer);
  }

  private schedule(delay: number): void {
    if (this.stopped || this.inFlight || this.timer !== null) return;
    if (this.status.state === 'superseded') return; // הדופק יחזיר אותנו כשאפשר
    const wait = Math.max(delay, this.lastSentAt + this.minIntervalMs - this.now(), 0);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, wait);
  }

  private async flush(): Promise<void> {
    if (this.stopped || this.inFlight || this.status.state === 'superseded') return;
    if (!this.dirty && !this.needKey) return;
    this.dirty = false;
    let target: LiveSnapshot;
    let ops: PatchOp[] | null = null;
    try {
      const built = this.build();
      if (built === null) return;
      // JSON טהור: מה שלא עובר ברשת (undefined, פונקציות) לא ייכנס להשוואה.
      target = JSON.parse(JSON.stringify(built)) as LiveSnapshot;
      const full = this.needKey || this.acked === null || this.patchesSinceKey >= this.keyEvery;
      if (!full) ops = diff(this.acked, target);
    } catch {
      // שגיאה בבנייה לא מפילה את המשחק — מנסים שוב בשינוי הבא.
      return;
    }
    if (ops === null) {
      await this.send({ kind: 'key', data: target }, target);
      return;
    }
    if (ops.length === 0) return;
    await this.send({ kind: 'patch', ops }, target);
  }

  private maybeBeat(): void {
    if (this.stopped || this.inFlight) return;
    if (this.now() - this.lastSentAt < this.beatMs) return;
    void this.send({ kind: 'beat' }, null);
  }

  private async send(body: Body, target: LiveSnapshot | null): Promise<void> {
    this.inFlight = true;
    this.seq += 1;
    const seq = this.seq;
    const t = this.now();
    this.lastSentAt = t;
    const message = { sid: this.sid, started: this.started, seq, prev: this.ackedSeq, t, ...body };
    let outcome: Outcome = 'retry';
    let reply: RelayReply | null = null;
    try {
      const res = await this.fetchImpl(`${this.relayBase}/${this.viewToken}/pub`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-live-key': this.publishKey },
        body: JSON.stringify(message),
        cache: 'no-store',
      });
      reply = (await res.json().catch(() => null)) as RelayReply | null;
      if (res.ok) outcome = 'ok';
      else if (res.status === 409)
        outcome = reply?.error === 'superseded' ? 'superseded' : 'need-key';
    } catch {
      outcome = 'retry';
    }
    this.inFlight = false;
    if (this.stopped) return;

    const viewers = typeof reply?.viewers === 'number' ? reply.viewers : this.status.viewers;
    switch (outcome) {
      case 'ok':
        this.failures = 0;
        if (body.kind !== 'beat' && target !== null) {
          this.acked = target;
          this.ackedSeq = seq;
          this.patchesSinceKey = body.kind === 'key' ? 0 : this.patchesSinceKey + 1;
          this.needKey = false;
        }
        if (reply?.wantKey === true) this.needKey = true;
        this.setStatus('live', viewers);
        break;
      case 'need-key':
        // הממסר הופעל מחדש, או שתפסנו עכשיו את השידור ממסך אחר.
        this.failures = 0;
        this.needKey = true;
        if (this.status.state !== 'live') this.setStatus('connecting', viewers);
        break;
      case 'superseded':
        this.needKey = true;
        this.setStatus('superseded', 0);
        return;
      case 'retry':
        this.failures += 1;
        this.needKey = true;
        this.setStatus('offline', this.status.viewers);
        break;
    }
    if (this.needKey || this.dirty) this.schedule(this.backoffMs());
  }

  private backoffMs(): number {
    if (this.failures === 0) return 0;
    return Math.min(15_000, 1000 * 2 ** Math.min(this.failures - 1, 4));
  }

  private setStatus(state: PublisherState, viewers: number): void {
    if (this.status.state === state && this.status.viewers === viewers) return;
    this.status = { state, viewers };
    this.onStatus?.(this.status);
  }
}
