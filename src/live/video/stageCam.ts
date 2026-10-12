/**
 * «במה» אצל המשתתף (קישור הצפייה): המצלמה שלו, בלי מיקרופון, נשלחת
 * ל-Cloudflare. בהתחלה רק המנחה רואה אותה, בתצוגה המקדימה שלו; המנחה יכול
 * להעלות אותה לבמה, ואז כל הצופים רואים אותה, או לכבות אותה. השרת:
 * server/live-stage.mjs.
 *
 * - הדלקה רק בלחיצה של המשתתף (`start`), וכיבוי בלחיצה (`stop`), או כשהבמה
 *   נסגרת (מצב המסך, והדופק שלנו).
 * - נפל החיבור, או שהשרת שכח את המצלמה (הופעל מחדש) — מדליקים מחדש לבד, עם
 *   אותו מזהה פרטי (cid), ולכן המשתתף נשאר על הבמה.
 * - המנחה כיבה, הבמה נסגרה, או שאותו משתתף הדליק בחלון אחר — המצלמה נכבית,
 *   והמשתתף רואה למה.
 */

import {
  backoffMs,
  DEFAULT_ICE,
  errorOf,
  iceServersOf,
  sleep,
  videoBeacon,
  videoCall,
  waitForConnected,
  waitForIceGathering,
  type IceServer,
  type VideoReply,
} from './api.ts';
import { mediaErrorOf, type MediaDeps } from './hostVideo.ts';

export type StageCamPhase = 'off' | 'starting' | 'live' | 'reconnecting' | 'ended' | 'error';

/** למה המצלמה כבתה בלי שהמשתתף כיבה אותה. */
export type StageCamEnd =
  /** המנחה כיבה אותה (ואי אפשר להדליק שוב עד שעובר זמן). */
  | 'blocked'
  /** הבמה נסגרה. */
  | 'closed'
  /** אותו משתתף הדליק מצלמה בחלון אחר. */
  | 'replaced'
  /** יותר מדי מצלמות דלוקות במשחק. */
  | 'full';

export type StageCamError =
  | 'permission'
  | 'no-devices'
  | 'busy'
  /** המצלמה נסגרה באמצע (נותקה, או שמערכת ההפעלה לקחה אותה). */
  | 'lost'
  | 'unsupported'
  /** אין וידאו בשרת הזה. */
  | 'not-configured'
  | 'failed';

export interface StageCamState {
  phase: StageCamPhase;
  ended: StageCamEnd | null;
  error: StageCamError | null;
  /** המזהה הציבורי של המצלמה: מה שהמנחה והצופים מכירים. */
  id: string | null;
  /** המנחה העלה אותה לבמה, וכל הצופים רואים אותה. */
  onStage: boolean;
  /** התצוגה המקדימה אצל המשתתף. */
  stream: MediaStream | null;
}

export const STAGE_CAM_OFF: StageCamState = {
  phase: 'off',
  ended: null,
  error: null,
  id: null,
  onStage: false,
  stream: null,
};

export function stageCamOn(state: StageCamState): boolean {
  return state.phase === 'starting' || state.phase === 'live' || state.phase === 'reconnecting';
}

/** חלון קטן ברשת של עד 9: פחות מוידאו המנחה, ו-15 תמונות בשנייה מספיקות. */
export function stageCamConstraints(): MediaTrackConstraints {
  return {
    width: { ideal: 640 },
    height: { ideal: 360 },
    frameRate: { ideal: 15, max: 15 },
    facingMode: 'user',
  };
}

/** שתי שכבות: לחלון גדול (המסך הראשי, במה של 1–2), ורבע ממנה לרשת של הצופים. */
export const STAGE_CAM_ENCODINGS: RTCRtpEncodingParameters[] = [
  { rid: 'a', maxBitrate: 350_000, maxFramerate: 15 },
  { rid: 'b', scaleResolutionDownBy: 2, maxBitrate: 110_000, maxFramerate: 15 },
];

export interface StageCamOptions {
  relayBase: string;
  viewToken: string;
  /** המזהה הפרטי של הדף (stageCid). */
  cid: string;
  fetch?: typeof fetch;
  media?: Partial<MediaDeps>;
  sendBeacon?: (url: string, body: string) => boolean;
  beatMs?: number;
  connectTimeoutMs?: number;
  onState?: (state: StageCamState) => void;
}

/** כמה זמן מחכים, באמצע חיבור מחדש, לבמה שנסגרה (ראו closedForAMoment). */
export const STAGE_CAM_REOPEN_MS = 90_000;

type Attempt = 'live' | 'retry' | { ended: StageCamEnd } | { fatal: StageCamError };

/** סירוב של השרת שאומר שאין טעם לנסות שוב — או null. */
function refusalOf(reply: VideoReply): Exclude<Attempt, 'live' | 'retry'> | null {
  const error = errorOf(reply);
  if (error === 'blocked') return { ended: 'blocked' };
  if (error === 'closed') return { ended: 'closed' };
  if (error === 'full') return { ended: 'full' };
  if (error === 'not-configured') return { fatal: 'not-configured' };
  if (error === 'bad-message') return { fatal: 'failed' };
  return null;
}

export class StageCamPublisher {
  private readonly opts: StageCamOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly media: MediaDeps;
  private state: StageCamState = STAGE_CAM_OFF;
  private name = '';
  private stream: MediaStream | null = null;
  private pc: RTCPeerConnection | null = null;
  private handle: string | null = null;
  private run: AbortController | null = null;
  private iceServers: IceServer[] = DEFAULT_ICE;
  private beatTimer: ReturnType<typeof setInterval> | null = null;
  private recovering = false;
  /** מתי התחיל החיבור מחדש — כדי לחכות לבמה שנסגרה רק לרגע. */
  private lostAt: number | null = null;

  constructor(options: StageCamOptions) {
    this.opts = options;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.media = {
      getUserMedia:
        options.media?.getUserMedia ??
        ((constraints) => navigator.mediaDevices.getUserMedia(constraints)),
      createPeerConnection:
        options.media?.createPeerConnection ?? ((config) => new RTCPeerConnection(config)),
    };
  }

  get current(): StageCamState {
    return this.state;
  }

  /** לחיצה של המשתתף: האם אפשר, מצלמה, ושליחה למנחה. */
  async start(name: string): Promise<void> {
    if (stageCamOn(this.state)) return;
    this.name = name;
    this.lostAt = null;
    this.run?.abort();
    const run = new AbortController();
    this.run = run;
    this.setState({ ...STAGE_CAM_OFF, phase: 'starting' });

    if (
      this.opts.media?.createPeerConnection === undefined &&
      (typeof RTCPeerConnection === 'undefined' ||
        typeof navigator === 'undefined' ||
        navigator.mediaDevices?.getUserMedia === undefined)
    ) {
      this.fail('unsupported');
      return;
    }

    // קודם שואלים אם אפשר — לפני שמבקשים מהמשתתף גישה למצלמה.
    let config: VideoReply | null = null;
    for (let failures = 1; failures <= 4; failures += 1) {
      config = await this.call('cam-config', { cid: this.opts.cid });
      if (run.signal.aborted) return;
      if (config.status === 200 || refusalOf(config) !== null) break;
      await sleep(backoffMs(failures), run.signal);
      if (run.signal.aborted) return;
    }
    if (config === null || config.status !== 200) {
      this.finish(
        config === null ? { fatal: 'failed' } : (refusalOf(config) ?? { fatal: 'failed' }),
      );
      return;
    }
    this.iceServers = iceServersOf(config.body?.iceServers);
    const id = typeof config.body?.id === 'string' ? config.body.id : null;

    let stream: MediaStream;
    try {
      stream = await this.capture();
    } catch (err) {
      if (!run.signal.aborted) this.fail(mediaErrorOf(err));
      return;
    }
    if (run.signal.aborted) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;
    for (const track of stream.getTracks()) {
      track.onended = () => {
        if (this.stream === stream) this.lose();
      };
    }
    this.setState({ stream, id });
    await this.publishLoop(run.signal);
  }

  /** לחיצה של המשתתף: המצלמה נכבית אצל כולם. */
  stop(): void {
    this.release();
    this.setState(STAGE_CAM_OFF);
  }

  /** מצב המסך אומר שהבמה נסגרה: המצלמה נכבית, והמשתתף רואה למה. */
  closed(): void {
    if (!stageCamOn(this.state)) return;
    this.release();
    this.setState({ ...STAGE_CAM_OFF, phase: 'ended', ended: 'closed' });
  }

  /** הדף נסגר / הרכיב יורד — כמו stop, בלי לעדכן אף אחד. */
  dispose(): void {
    this.release();
    this.state = STAGE_CAM_OFF;
  }

  // ------------------------------------------------------------------------

  private call(action: string, body: Record<string, unknown>): Promise<VideoReply> {
    return videoCall(this.fetchImpl, this.opts.relayBase, this.opts.viewToken, action, body);
  }

  private async capture(): Promise<MediaStream> {
    try {
      return await this.media.getUserMedia({ video: stageCamConstraints(), audio: false });
    } catch (err) {
      // מצלמה שלא עומדת בבקשה (למשל בלי מצלמה קדמית) — כל מצלמה שיש.
      if (mediaErrorOf(err) === 'permission') throw err;
      return this.media.getUserMedia({ video: true, audio: false });
    }
  }

  private async publishLoop(signal: AbortSignal): Promise<void> {
    let failures = 0;
    while (!signal.aborted) {
      const attempt = await this.publishOnce(signal);
      if (signal.aborted) return;
      if (attempt === 'live') return;
      if (attempt !== 'retry' && !this.closedForAMoment(attempt)) {
        this.finish(attempt);
        return;
      }
      failures += 1;
      this.setState({ phase: this.state.phase === 'starting' ? 'starting' : 'reconnecting' });
      await sleep(backoffMs(failures), signal);
    }
  }

  private async publishOnce(signal: AbortSignal): Promise<Attempt> {
    const stream = this.stream;
    const track = stream?.getVideoTracks()[0];
    if (stream === null || track === undefined) return { fatal: 'no-devices' };
    this.closePeer();
    let pc: RTCPeerConnection;
    try {
      pc = this.media.createPeerConnection({
        iceServers: this.iceServers as RTCIceServer[],
        bundlePolicy: 'max-bundle',
      });
    } catch {
      return { fatal: 'unsupported' };
    }
    this.pc = pc;

    let tx: RTCRtpTransceiver;
    try {
      try {
        tx = pc.addTransceiver(track, {
          direction: 'sendonly',
          streams: [stream],
          sendEncodings: STAGE_CAM_ENCODINGS,
        });
      } catch {
        tx = pc.addTransceiver(track, {
          direction: 'sendonly',
          streams: [stream],
          sendEncodings: [{ maxBitrate: 300_000, maxFramerate: 15 }],
        });
      }
      await pc.setLocalDescription(await pc.createOffer());
      await waitForIceGathering(pc);
    } catch {
      return 'retry';
    }
    if (signal.aborted || this.pc !== pc) return 'retry';
    const sdp = pc.localDescription?.sdp ?? '';
    const mid = tx.mid;
    if (mid === null) return 'retry';

    const reply = await this.call('cam', {
      cid: this.opts.cid,
      name: this.name,
      sdp,
      mid,
      simulcast: /a=simulcast:\s*send/.test(sdp) ? ['a', 'b'] : [],
    });
    const handle = reply.body?.handle;
    if (signal.aborted || this.pc !== pc) {
      if (typeof handle === 'string') this.sendStop(handle);
      return 'retry';
    }
    const refusal = refusalOf(reply);
    if (refusal !== null) return refusal;
    const answer = reply.body?.sdp;
    if (reply.status !== 200 || typeof answer !== 'string' || typeof handle !== 'string') {
      return 'retry';
    }
    this.handle = handle;

    try {
      await pc.setRemoteDescription({ type: 'answer', sdp: answer });
      await waitForConnected(pc, this.opts.connectTimeoutMs ?? 15_000);
    } catch {
      return 'retry';
    }
    if (signal.aborted || this.pc !== pc) return 'retry';

    pc.addEventListener('connectionstatechange', () => {
      if (this.pc === pc && pc.connectionState === 'failed') this.recover();
    });
    this.lostAt = null;
    this.setState({
      phase: 'live',
      error: null,
      ended: null,
      id: typeof reply.body?.id === 'string' ? reply.body.id : this.state.id,
      onStage: reply.body?.onStage === true,
    });
    this.startBeat(handle, signal);
    return 'live';
  }

  private startBeat(handle: string, signal: AbortSignal): void {
    this.stopBeat();
    this.beatTimer = setInterval(() => {
      void (async () => {
        const reply = await videoCall(
          this.fetchImpl,
          this.opts.relayBase,
          this.opts.viewToken,
          'cam-beat',
          { handle },
          null,
          { timeoutMs: 8000 },
        );
        if (signal.aborted || this.handle !== handle) return;
        if (reply.status === 200) {
          const onStage = reply.body?.onStage === true;
          if (onStage !== this.state.onStage) this.setState({ onStage });
          return;
        }
        if (reply.status !== 404) return; // רשת: ממשיכים לדפוק
        const reason = errorOf(reply);
        if (reason === 'blocked' || reason === 'closed' || reason === 'replaced') {
          this.finish({ ended: reason });
        } else {
          this.recover(); // השרת הופעל מחדש, או שהמצלמה שתקה יותר מדי
        }
      })();
    }, this.opts.beatMs ?? 10_000);
  }

  private stopBeat(): void {
    if (this.beatTimer !== null) clearInterval(this.beatTimer);
    this.beatTimer = null;
  }

  /**
   * באמצע חיבור מחדש «הבמה סגורה» יכולה להיות רגעית: השרת הופעל מחדש, או
   * שהמסך הראשי איבד לרגע את החיבור, והמנחה יפתח אותה שוב בסקר הבא. סגירה של
   * המנחה מגיעה אחרת — בדופק ובמצב המסך.
   */
  private closedForAMoment(attempt: Exclude<Attempt, 'live' | 'retry'>): boolean {
    return (
      'ended' in attempt &&
      attempt.ended === 'closed' &&
      this.lostAt !== null &&
      Date.now() - this.lostAt < STAGE_CAM_REOPEN_MS
    );
  }

  /** החיבור נפל / השרת שכח אותנו — אותה מצלמה, חיבור חדש, אותו מקום על הבמה. */
  private recover(): void {
    const run = this.run;
    if (run === null || run.signal.aborted || this.recovering || this.stream === null) return;
    this.recovering = true;
    this.lostAt = Date.now();
    this.stopBeat();
    this.handle = null;
    this.setState({ phase: 'reconnecting' });
    void this.publishLoop(run.signal).finally(() => {
      this.recovering = false;
    });
  }

  /** המצלמה עצמה נסגרה (נותקה, או שהמערכת לקחה אותה). */
  private lose(): void {
    this.release();
    this.setState({ ...STAGE_CAM_OFF, phase: 'error', error: 'lost' });
  }

  private sendStop(handle: string): void {
    videoBeacon(
      this.fetchImpl,
      this.opts.relayBase,
      this.opts.viewToken,
      'cam-stop',
      { handle },
      this.opts.sendBeacon ?? null,
    );
  }

  private closePeer(): void {
    const pc = this.pc;
    this.pc = null;
    if (pc !== null) {
      try {
        pc.close();
      } catch {
        /* כבר סגור */
      }
    }
  }

  /** עוצר הכול: מצלמה, חיבור, דופק — ומודיע לשרת. */
  private release(): void {
    this.run?.abort();
    this.run = null;
    this.stopBeat();
    if (this.handle !== null) this.sendStop(this.handle);
    this.handle = null;
    this.closePeer();
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.stream = null;
  }

  /** השרת סירב או כבר כיבה את המצלמה — אין מה להודיע לו. */
  private finish(outcome: Exclude<Attempt, 'live' | 'retry'>): void {
    this.handle = null;
    if ('ended' in outcome) {
      this.release();
      this.setState({ ...STAGE_CAM_OFF, phase: 'ended', ended: outcome.ended });
    } else {
      this.fail(outcome.fatal);
    }
  }

  private fail(error: StageCamError): void {
    this.release();
    this.setState({ ...STAGE_CAM_OFF, phase: 'error', error });
  }

  private setState(patch: Partial<StageCamState>): void {
    this.state = { ...this.state, ...patch };
    this.opts.onState?.(this.state);
  }
}
