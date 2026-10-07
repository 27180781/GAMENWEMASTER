/**
 * הצד של הצופה בווידאו המנחה: עותק של המצלמה והמיקרופון של המנחה, מ-Cloudflare.
 * השרת (server/live-video.mjs) פותח לכל צופה חיבור משלו ומחזיר הצעת SDP;
 * הדפדפן עונה, והשרת מעביר את התשובה.
 *
 * - מתחילים כשמצב המסך מכריז על שידור (`video.gen`), ומתחילים מחדש כשהוא
 *   מתחלף. החיבור נפל, או שהשרת שכח אותנו (דופק "gone") — מתחברים שוב לבד.
 * - הצפייה מלאה (תקרת הרישיון) — מנסים שוב מדי פעם, אולי מישהו עזב.
 * - יציאה מהדף / הסתרת הווידאו — `leave` ב-sendBeacon, כדי שהמקום יתפנה מיד
 *   ו-Cloudflare יפסיק לשלוח (ולגבות).
 */

import {
  backoffMs,
  errorOf,
  iceServersOf,
  randomId,
  sleep,
  videoCall,
  waitForConnected,
  waitForIceGathering,
} from './api.ts';

export type ReceiverPhase =
  | 'idle'
  | 'connecting'
  | 'playing'
  /** מצב המסך אומר שיש שידור, והשרת עוד לא (או כבר לא) מכיר אותו. */
  | 'waiting'
  /** הגענו לתקרת הצופים של הרישיון. */
  | 'full'
  /** אין וידאו בשרת הזה (בלי מפתחות). */
  | 'unavailable';

export interface ReceiverState {
  phase: ReceiverPhase;
  stream: MediaStream | null;
  gen: string | null;
}

export const RECEIVER_IDLE: ReceiverState = { phase: 'idle', stream: null, gen: null };

export interface ReceiverOptions {
  relayBase: string;
  viewToken: string;
  fetch?: typeof fetch;
  createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection;
  createStream?: () => MediaStream;
  sendBeacon?: (url: string, body: string) => boolean;
  pingMs?: number;
  connectTimeoutMs?: number;
  fullRetryMs?: number;
  onState?: (state: ReceiverState) => void;
}

type Attempt = 'playing' | 'no-video' | 'full' | 'unavailable' | 'retry';

export class HostVideoReceiver {
  private readonly opts: ReceiverOptions;
  private readonly fetchImpl: typeof fetch;
  /** מזהה הדף — חיבור חדש שלו מפנה את הקודם בשרת. */
  private readonly vid = randomId();
  private state: ReceiverState = RECEIVER_IDLE;
  private run: AbortController | null = null;
  private pc: RTCPeerConnection | null = null;
  private handle: string | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lost: (() => void) | null = null;

  constructor(options: ReceiverOptions) {
    this.opts = options;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  get current(): ReceiverState {
    return this.state;
  }

  /** התחלה (או התחלה מחדש — שידור חדש של המנחה). */
  start(): void {
    this.release();
    const run = new AbortController();
    this.run = run;
    this.setState({ phase: 'connecting', stream: null, gen: null });
    void this.loop(run.signal);
  }

  stop(): void {
    this.release();
    this.setState(RECEIVER_IDLE);
  }

  private async loop(signal: AbortSignal): Promise<void> {
    let failures = 0;
    while (!signal.aborted) {
      const attempt = await this.once(signal);
      if (signal.aborted) return;
      if (attempt === 'playing') {
        failures = 0;
        await this.untilLost(signal);
        if (signal.aborted) return;
        this.dropConnection();
        this.setState({ phase: 'connecting', stream: null, gen: null });
        continue;
      }
      if (attempt === 'unavailable') {
        this.setState({ phase: 'unavailable', stream: null, gen: null });
        return;
      }
      failures += 1;
      if (attempt === 'full') {
        this.setState({ phase: 'full', stream: null, gen: null });
        await sleep(this.opts.fullRetryMs ?? 20_000, signal);
      } else if (attempt === 'no-video') {
        this.setState({ phase: 'waiting', stream: null, gen: null });
        await sleep(Math.min(backoffMs(failures), 5000), signal);
      } else {
        this.setState({ phase: 'connecting', stream: null, gen: null });
        await sleep(backoffMs(failures), signal);
      }
    }
  }

  private async once(signal: AbortSignal): Promise<Attempt> {
    const reply = await videoCall(this.fetchImpl, this.opts.relayBase, this.opts.viewToken, 'sub', {
      vid: this.vid,
    });
    const handle = reply.body?.handle;
    if (signal.aborted) {
      if (typeof handle === 'string') this.sendLeave(handle);
      return 'retry';
    }
    if (reply.status !== 200) {
      const error = errorOf(reply);
      if (error === 'no-video') return 'no-video';
      if (error === 'full') return 'full';
      if (error === 'not-configured') return 'unavailable';
      return 'retry';
    }
    const offer = reply.body?.sdp;
    const gen = reply.body?.gen;
    if (typeof handle !== 'string' || typeof offer !== 'string' || typeof gen !== 'string') {
      return 'retry';
    }
    this.handle = handle;

    let pc: RTCPeerConnection;
    const stream = this.opts.createStream?.() ?? new MediaStream();
    try {
      const config: RTCConfiguration = {
        iceServers: iceServersOf(reply.body?.iceServers) as RTCIceServer[],
        bundlePolicy: 'max-bundle',
      };
      pc = this.opts.createPeerConnection?.(config) ?? new RTCPeerConnection(config);
    } catch {
      this.sendLeave(handle);
      this.handle = null;
      return 'unavailable';
    }
    this.pc = pc;
    pc.addEventListener('track', (event) => {
      if (!stream.getTracks().includes(event.track)) stream.addTrack(event.track);
    });

    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: offer });
      await pc.setLocalDescription(await pc.createAnswer());
      await waitForIceGathering(pc, 2000);
    } catch {
      this.dropConnection();
      return 'retry';
    }
    if (signal.aborted || this.pc !== pc) return 'retry';

    const answer = await videoCall(
      this.fetchImpl,
      this.opts.relayBase,
      this.opts.viewToken,
      'answer',
      { handle, sdp: pc.localDescription?.sdp ?? '' },
    );
    if (signal.aborted || this.pc !== pc) return 'retry';
    if (answer.status !== 200) {
      this.dropConnection();
      return 'retry';
    }
    try {
      await waitForConnected(pc, this.opts.connectTimeoutMs ?? 15_000);
    } catch {
      this.dropConnection();
      return 'retry';
    }
    if (signal.aborted || this.pc !== pc) return 'retry';
    this.setState({ phase: 'playing', stream, gen });
    return 'playing';
  }

  /** עד שהחיבור נופל, או שהשרת אומר שהצפייה הזו כבר לא קיימת. */
  private untilLost(signal: AbortSignal): Promise<void> {
    const pc = this.pc;
    const handle = this.handle;
    return new Promise((resolve) => {
      if (pc === null || handle === null || signal.aborted) {
        resolve();
        return;
      }
      const done = () => {
        if (this.pingTimer !== null) clearInterval(this.pingTimer);
        this.pingTimer = null;
        pc.removeEventListener('connectionstatechange', onChange);
        signal.removeEventListener('abort', done);
        this.lost = null;
        resolve();
      };
      this.lost = done;
      const onChange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') done();
      };
      pc.addEventListener('connectionstatechange', onChange);
      signal.addEventListener('abort', done, { once: true });
      this.pingTimer = setInterval(() => {
        void videoCall(
          this.fetchImpl,
          this.opts.relayBase,
          this.opts.viewToken,
          'ping',
          { handle },
          null,
          { timeoutMs: 10_000 },
        ).then((reply) => {
          if (reply.status === 404) done();
        });
      }, this.opts.pingMs ?? 20_000);
    });
  }

  private sendLeave(handle: string): void {
    const url = `${this.opts.relayBase}/${this.opts.viewToken}/video/leave`;
    const body = JSON.stringify({ handle });
    const beacon =
      this.opts.sendBeacon ??
      (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
        ? (u: string, b: string) => navigator.sendBeacon(u, b)
        : null);
    if (beacon !== null && beacon(url, body)) return;
    void videoCall(
      this.fetchImpl,
      this.opts.relayBase,
      this.opts.viewToken,
      'leave',
      { handle },
      null,
      {
        keepalive: true,
      },
    );
  }

  /** סוגר את החיבור הנוכחי ומודיע לשרת — בלי לעצור את הלולאה. */
  private dropConnection(): void {
    const pc = this.pc;
    this.pc = null;
    if (pc !== null) {
      try {
        pc.close();
      } catch {
        /* כבר סגור */
      }
    }
    if (this.handle !== null) this.sendLeave(this.handle);
    this.handle = null;
  }

  private release(): void {
    this.run?.abort();
    this.run = null;
    this.lost?.();
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.dropConnection();
  }

  private setState(next: ReceiverState): void {
    const s = this.state;
    if (s.phase === next.phase && s.stream === next.stream && s.gen === next.gen) return;
    this.state = next;
    this.opts.onState?.(next);
  }
}
