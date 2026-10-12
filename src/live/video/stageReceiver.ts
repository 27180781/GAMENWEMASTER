/**
 * צפייה ב«במה»: עותק של המצלמות שעל הבמה, מ-Cloudflare — לכל צופה בקישור
 * הצפייה, ולמסך הראשי (חלונית הבמה, והתצוגה המקדימה של המנחה). השרת
 * (server/live-stage.mjs) פותח חיבור עם רצועה לכל מצלמה ומחזיר הצעת SDP;
 * הדפדפן עונה, והשרת מעביר את התשובה.
 *
 * - `want(ids, version, layer)`: מי על הבמה עכשיו (ממצב המסך). כשמשהו משתנה
 *   מתחברים מחדש, אחרי השהיה קטנה ואקראית (כל הצופים מתחברים בבת אחת), והחיבור
 *   הקודם ממשיך לנגן עד שהחדש מנגן, ועוד קצת אחריו — עד שבחלונות יש תמונה
 *   מהחדש (StageVideo.tsx). בלי מסך שחור באמצע.
 * - מצלמה שירדה מהבמה נחתכת בשרת מיד; הדופק אומר שהחיבור כבר לא מעודכן
 *   (`stale`), ואז מתחברים מחדש גם בלי מצב מסך חדש.
 * - המסך הראשי שולח את המפתח שלו (`publishKey`) ויכול לראות כל מצלמה דלוקה.
 */

import {
  backoffMs,
  errorOf,
  iceServersOf,
  randomId,
  videoBeacon,
  videoCall,
  waitForConnected,
  waitForIceGathering,
} from './api.ts';

export type StageLayer = 'high' | 'low';

export type StageViewPhase =
  | 'idle'
  | 'connecting'
  | 'playing'
  /** הצפייה בבמה מלאה (תקרת הצופים). */
  | 'full'
  /** אין וידאו בשרת הזה. */
  | 'unavailable';

export interface StageViewState {
  phase: StageViewPhase;
  /** מזהה מצלמה ← התמונה שלה, בחיבור שמנגן עכשיו. */
  streams: ReadonlyMap<string, MediaStream>;
}

export const STAGE_VIEW_IDLE: StageViewState = { phase: 'idle', streams: new Map() };

export interface StageReceiverOptions {
  relayBase: string;
  viewToken: string;
  /** המסך הראשי: המפתח שלו — רואה כל מצלמה דלוקה, ולא רק את מי שעל הבמה. */
  publishKey?: string | null;
  fetch?: typeof fetch;
  createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection;
  createStream?: (tracks: MediaStreamTrack[]) => MediaStream;
  sendBeacon?: (url: string, body: string) => boolean;
  pingMs?: number;
  connectTimeoutMs?: number;
  /** כמה לחכות אחרי שינוי לפני שמתחברים (עוד שינוי באמצע — מחכים מחדש). */
  debounceMs?: number;
  /** עד כמה להוסיף באקראי, כדי שכל הצופים לא יתחברו באותו רגע. */
  jitterMs?: number;
  fullRetryMs?: number;
  /** כמה זמן החיבור הקודם ממשיך אחרי שהחדש מנגן (StageVideo.tsx מחכה לתמונה). */
  overlapMs?: number;
  random?: () => number;
  onState?: (state: StageViewState) => void;
}

interface Target {
  ids: string[];
  version: string;
  layer: StageLayer;
}

interface Connection {
  pc: RTCPeerConnection;
  handle: string;
  target: Target;
}

type Attempt = 'playing' | 'retry' | 'slow-down' | 'full' | 'unavailable';

/** נדחית כשהניסיון בוטל — כדי לא לחכות לחיבור שכבר לא רוצים. */
function whenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(new Error('aborted'));
    else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}

function sameTarget(a: Target | null, b: Target | null): boolean {
  return (
    a !== null &&
    b !== null &&
    a.version === b.version &&
    a.layer === b.layer &&
    a.ids.length === b.ids.length &&
    a.ids.every((id, i) => id === b.ids[i])
  );
}

export class StageReceiver {
  private readonly opts: StageReceiverOptions;
  private readonly fetchImpl: typeof fetch;
  /** מזהה הדף: חיבור חדש שלו מחליף את הקודם בשרת (עד שניים בבת אחת). */
  private readonly vid = randomId();
  private state: StageViewState = STAGE_VIEW_IDLE;
  private target: Target | null = null;
  private active: Connection | null = null;
  /** החיבור הקודם, בזמן שהחלונות עוברים לחדש. */
  private retiring: { connection: Connection; timer: ReturnType<typeof setTimeout> } | null = null;
  private attempt: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private failures = 0;

  constructor(options: StageReceiverOptions) {
    this.opts = options;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  get current(): StageViewState {
    return this.state;
  }

  /** מי על הבמה, באיזו גרסה, ובאיזו שכבה. רשימה ריקה = עצירה. */
  want(ids: readonly string[], version: string, layer: StageLayer): void {
    const unique = ids.filter((id, i) => ids.indexOf(id) === i);
    if (unique.length === 0) {
      this.stop();
      return;
    }
    const next: Target = { ids: unique, version, layer };
    if (sameTarget(this.target, next)) return;
    this.target = next;
    this.failures = 0;
    if (this.active !== null && sameTarget(this.active.target, next)) {
      this.cancelPending();
      return;
    }
    this.schedule((this.opts.debounceMs ?? 300) + this.jitter());
  }

  stop(): void {
    this.target = null;
    this.cancelPending();
    this.dropActive();
    this.setState(STAGE_VIEW_IDLE);
  }

  // ------------------------------------------------------------------------

  private jitter(): number {
    const max = this.opts.jitterMs ?? 0;
    return max > 0 ? Math.floor((this.opts.random ?? Math.random)() * max) : 0;
  }

  private schedule(delay: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.connect();
    }, delay);
  }

  private cancelPending(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.attempt?.abort();
    this.attempt = null;
  }

  private async connect(): Promise<void> {
    const target = this.target;
    if (target === null) return;
    this.attempt?.abort();
    const attempt = new AbortController();
    this.attempt = attempt;
    if (this.active === null) this.setState({ phase: 'connecting', streams: new Map() });
    const result = await this.once(target, attempt.signal);
    if (attempt.signal.aborted) return;
    this.attempt = null;
    // בינתיים הבמה השתנתה, וחיבור חדש כבר מתוזמן.
    if (this.timer !== null) return;
    if (result === 'playing') {
      this.failures = 0;
      return;
    }
    if (result === 'unavailable') {
      this.target = null;
      this.dropActive();
      this.setState({ phase: 'unavailable', streams: new Map() });
      return;
    }
    this.failures += 1;
    if (result === 'full') {
      if (this.active === null) this.setState({ phase: 'full', streams: new Map() });
      this.schedule(this.opts.fullRetryMs ?? 20_000);
      return;
    }
    // הבמה השתנתה בינתיים (stale), נסגרה לרגע, או שהשרת עמוס: עוד ניסיון,
    // עם מה שמצב המסך אומר אז.
    const wait = backoffMs(this.failures, result === 'slow-down' ? 15_000 : 5000);
    this.schedule(wait + (result === 'slow-down' ? this.jitter() : 0));
  }

  private async once(target: Target, signal: AbortSignal): Promise<Attempt> {
    const reply = await videoCall(
      this.fetchImpl,
      this.opts.relayBase,
      this.opts.viewToken,
      'stage-sub',
      { vid: this.vid, ids: target.ids, layer: target.layer },
      this.opts.publishKey ?? null,
    );
    const handle = reply.body?.handle;
    if (signal.aborted) {
      if (typeof handle === 'string') this.sendLeave(handle);
      return 'retry';
    }
    if (reply.status !== 200) {
      const error = errorOf(reply);
      if (error === 'full') return 'full';
      if (error === 'slow-down') return 'slow-down';
      if (error === 'not-configured') return 'unavailable';
      return 'retry';
    }
    const offer = reply.body?.sdp;
    const tracks = Array.isArray(reply.body?.tracks)
      ? (reply.body.tracks as unknown[]).flatMap((t) => {
          const { mid, id } = (t ?? {}) as { mid?: unknown; id?: unknown };
          return typeof mid === 'string' && typeof id === 'string' ? [{ mid, id }] : [];
        })
      : [];
    if (typeof handle !== 'string' || typeof offer !== 'string' || tracks.length === 0) {
      if (typeof handle === 'string') this.sendLeave(handle);
      return 'retry';
    }

    let pc: RTCPeerConnection;
    try {
      const config: RTCConfiguration = {
        iceServers: iceServersOf(reply.body?.iceServers) as RTCIceServer[],
        bundlePolicy: 'max-bundle',
      };
      pc = this.opts.createPeerConnection?.(config) ?? new RTCPeerConnection(config);
    } catch {
      this.sendLeave(handle);
      return 'unavailable';
    }
    const abandon = (): 'retry' => {
      this.closePc(pc);
      this.sendLeave(handle);
      return 'retry';
    };

    const streams = new Map<string, MediaStream>();
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: offer });
      for (const { mid, id } of tracks) {
        const track = pc.getTransceivers().find((tx) => tx.mid === mid)?.receiver.track;
        if (track === undefined) continue;
        streams.set(id, this.opts.createStream?.([track]) ?? new MediaStream([track]));
      }
      await pc.setLocalDescription(await pc.createAnswer());
      await waitForIceGathering(pc, 2000);
    } catch {
      return abandon();
    }
    if (signal.aborted) return abandon();

    const answer = await videoCall(
      this.fetchImpl,
      this.opts.relayBase,
      this.opts.viewToken,
      'stage-answer',
      { handle, sdp: pc.localDescription?.sdp ?? '' },
    );
    if (signal.aborted || answer.status !== 200) return abandon();
    try {
      await Promise.race([
        waitForConnected(pc, this.opts.connectTimeoutMs ?? 15_000),
        whenAborted(signal),
      ]);
    } catch {
      return abandon();
    }
    if (signal.aborted) return abandon();

    // החדש מנגן — רק עכשיו הקודם מתחיל להיסגר.
    this.retireActive();
    const connection: Connection = { pc, handle, target };
    this.active = connection;
    pc.addEventListener('connectionstatechange', () => {
      if (this.active === connection && pc.connectionState === 'failed') this.lost(false);
    });
    this.startPing(connection);
    this.setState({ phase: 'playing', streams });
    return 'playing';
  }

  private startPing(connection: Connection): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      void videoCall(
        this.fetchImpl,
        this.opts.relayBase,
        this.opts.viewToken,
        'stage-ping',
        { handle: connection.handle },
        null,
        { timeoutMs: 10_000 },
      ).then((reply) => {
        if (this.active !== connection) return;
        if (reply.status === 404) this.lost(false);
        else if (reply.status === 200 && reply.body?.stale === true) this.lost(true);
      });
    }, this.opts.pingMs ?? 15_000);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  /**
   * החיבור כבר לא מעודכן: מצלמה ירדה או התחלפה (`keep` — השאר ממשיכים לנגן
   * עד שיש חיבור חדש), או שהוא נפל / השרת שכח אותו.
   */
  private lost(keep: boolean): void {
    if (this.target === null) return;
    if (!keep) {
      this.dropActive();
      this.setState({ phase: 'connecting', streams: new Map() });
    }
    if (this.attempt === null && this.timer === null) this.schedule(this.jitter());
  }

  private sendLeave(handle: string): void {
    videoBeacon(
      this.fetchImpl,
      this.opts.relayBase,
      this.opts.viewToken,
      'stage-leave',
      { handle },
      this.opts.sendBeacon ?? null,
    );
  }

  private closePc(pc: RTCPeerConnection): void {
    try {
      pc.close();
    } catch {
      /* כבר סגור */
    }
  }

  private closeConnection(connection: Connection): void {
    this.closePc(connection.pc);
    this.sendLeave(connection.handle);
  }

  /** סוגר הכול: גם החיבור שמנגן וגם הקודם. */
  private dropActive(): void {
    const active = this.active;
    this.active = null;
    this.stopPing();
    this.dropRetiring();
    if (active !== null) this.closeConnection(active);
  }

  /** החיבור שמנגן מפנה מקום לחדש, ונסגר אחרי `overlapMs`. */
  private retireActive(): void {
    const old = this.active;
    this.active = null;
    this.stopPing();
    this.dropRetiring();
    if (old === null) return;
    const overlap = this.opts.overlapMs ?? 4000;
    if (overlap <= 0) {
      this.closeConnection(old);
      return;
    }
    const timer = setTimeout(() => {
      if (this.retiring?.connection === old) this.retiring = null;
      this.closeConnection(old);
    }, overlap);
    this.retiring = { connection: old, timer };
  }

  private dropRetiring(): void {
    const retiring = this.retiring;
    this.retiring = null;
    if (retiring === null) return;
    clearTimeout(retiring.timer);
    this.closeConnection(retiring.connection);
  }

  private setState(next: StageViewState): void {
    const s = this.state;
    if (s.phase === next.phase && s.streams === next.streams) return;
    if (s.phase === next.phase && s.streams.size === 0 && next.streams.size === 0) return;
    this.state = next;
    this.opts.onState?.(next);
  }
}
