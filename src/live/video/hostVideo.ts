/**
 * הצד של המנחה בווידאו המנחה: המצלמה והמיקרופון של המחשב משודרים ל-Cloudflare
 * (WebRTC), ומשם לכל מי שפתח את קישור הצפייה. השרת שלנו (server/live-video.mjs)
 * בודק שהרישיון כולל את התוספת, מעביר את ה-SDP ושומר את הסוד.
 *
 * - הפעלה היא תמיד בלחיצה של המנחה (`start`). מצלמה ומיקרופון נכבים ונדלקים
 *   בלי לנתק (`setCam` / `setMic`): הרצועה ממשיכה לשלוח שחור / שקט, וכך
 *   Cloudflare לא סוגר אותה ואין חיבור מחדש אצל הצופים.
 * - נפל החיבור, או שהשרת הופעל מחדש — פותחים שידור חדש לבד, עם אותה מצלמה.
 *   מזהה השידור (gen) מתחלף, והצופים מתחברים אליו מחדש לפי מצב המסך.
 * - שני מסכים ראשיים לאותו משחק: לחיצה בשני מעבירה אליו את השידור, והראשון
 *   מקבל "superseded" ומשחרר את המצלמה. ניסיון אוטומטי לא דוחק מסך חדש יותר.
 *
 * שום כשל כאן לא נוגע במשחק עצמו.
 */

import {
  backoffMs,
  DEFAULT_ICE,
  errorOf,
  iceServersOf,
  randomId,
  sleep,
  videoCall,
  waitForConnected,
  waitForIceGathering,
  type IceServer,
  type LiveVideo,
  type VideoKind,
} from './api.ts';

export type HostVideoPhase = 'off' | 'starting' | 'live' | 'reconnecting' | 'superseded' | 'error';

export type HostVideoError =
  /** אין מפתחות Cloudflare בשרת. */
  | 'not-configured'
  /** הרישיון לא כולל וידאו מנחה (או שאינו רישיון טלפונים בתוקף). */
  | 'not-entitled'
  /** הדפדפן / מערכת ההפעלה לא נתנו גישה למצלמה ולמיקרופון. */
  | 'permission'
  | 'no-devices'
  /** המצלמה / המיקרופון תפוסים (למשל בזום) או נכשלו בפתיחה. */
  | 'busy'
  | 'unsupported'
  | 'failed';

export interface HostVideoState {
  phase: HostVideoPhase;
  error: HostVideoError | null;
  gen: string | null;
  hasCam: boolean;
  hasMic: boolean;
  /** המצלמה משודרת (קיימת ודלוקה). */
  cam: boolean;
  mic: boolean;
  viewers: number;
  maxViewers: number | null;
  /** לתצוגה המקדימה אצל המנחה. */
  stream: MediaStream | null;
}

/**
 * מה שנשלח לצופים במצב המסך, או null כשאין שידור. גם בזמן חיבור מחדש — עם
 * מזהה השידור הקודם, עד שיש חדש.
 */
export function liveVideoOf(state: HostVideoState): LiveVideo | null {
  const on = state.phase === 'live' || state.phase === 'reconnecting';
  return on && state.gen !== null ? { gen: state.gen, cam: state.cam, mic: state.mic } : null;
}

export const HOST_VIDEO_OFF: HostVideoState = {
  phase: 'off',
  error: null,
  gen: null,
  hasCam: false,
  hasMic: false,
  cam: false,
  mic: false,
  viewers: 0,
  maxViewers: null,
  stream: null,
};

export interface MediaDeps {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createPeerConnection: (config: RTCConfiguration) => RTCPeerConnection;
}

export interface HostVideoOptions {
  relayBase: string;
  viewToken: string;
  publishKey: string;
  gameId: string;
  room: string;
  fetch?: typeof fetch;
  media?: Partial<MediaDeps>;
  beatMs?: number;
  connectTimeoutMs?: number;
  onState?: (state: HostVideoState) => void;
}

export interface DeviceChoice {
  camera?: string | null;
  mic?: string | null;
}

/** תמונה קטנה וחסכונית — חלון בצד המסך, לא מסך מלא. ~600 kbps בשכבה העליונה. */
export function cameraConstraints(deviceId: string | null): MediaTrackConstraints {
  return {
    width: { ideal: 640 },
    height: { ideal: 360 },
    frameRate: { ideal: 24, max: 30 },
    ...(deviceId === null ? {} : { deviceId: { exact: deviceId } }),
  };
}

export function micConstraints(deviceId: string | null): MediaTrackConstraints {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    ...(deviceId === null ? {} : { deviceId: { exact: deviceId } }),
  };
}

/** שתי שכבות: מלאה, ורבע ממנה לטלפון בקליטה חלשה (Cloudflare בוחר לכל צופה). */
export const SIMULCAST_ENCODINGS: RTCRtpEncodingParameters[] = [
  { rid: 'a', maxBitrate: 600_000, maxFramerate: 24 },
  { rid: 'b', scaleResolutionDownBy: 2, maxBitrate: 150_000, maxFramerate: 15 },
];

function mediaErrorOf(err: unknown): HostVideoError {
  const name = (err as { name?: string } | null)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-devices';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  return 'failed';
}

function fatalOf(reply: {
  status: number;
  body: Record<string, unknown> | null;
}): HostVideoError | null {
  const error = errorOf(reply);
  if (error === 'not-configured') return 'not-configured';
  if (error === 'not-entitled' || error === 'bad-key') return 'not-entitled';
  return null;
}

type Attempt = 'live' | 'retry' | 'superseded' | { fatal: HostVideoError };

export class HostVideoPublisher {
  private readonly opts: HostVideoOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly media: MediaDeps;
  private readonly sid = randomId();
  private readonly started = Date.now();
  private state: HostVideoState = HOST_VIDEO_OFF;
  private stream: MediaStream | null = null;
  private pc: RTCPeerConnection | null = null;
  private readonly senders: Record<VideoKind, RTCRtpSender | null> = { video: null, audio: null };
  private run: AbortController | null = null;
  private iceServers: IceServer[] = DEFAULT_ICE;
  private beatTimer: ReturnType<typeof setInterval> | null = null;
  private recovering = false;
  private wantCam = true;
  private wantMic = true;
  private choice: { camera: string | null; mic: string | null } = { camera: null, mic: null };

  constructor(options: HostVideoOptions) {
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

  get current(): HostVideoState {
    return this.state;
  }

  /** מה שנשלח לצופים במצב המסך, או null כשאין שידור. */
  get live(): LiveVideo | null {
    return liveVideoOf(this.state);
  }

  /** לחיצה של המנחה: בדיקת הרישיון, מצלמה ומיקרופון, ושידור. */
  async start(choice: DeviceChoice = {}): Promise<void> {
    const phase = this.state.phase;
    if (phase === 'starting' || phase === 'live' || phase === 'reconnecting') return;
    if (choice.camera !== undefined) this.choice.camera = choice.camera;
    if (choice.mic !== undefined) this.choice.mic = choice.mic;
    this.run?.abort();
    const run = new AbortController();
    this.run = run;
    this.setState({ ...HOST_VIDEO_OFF, phase: 'starting' });

    if (
      typeof RTCPeerConnection === 'undefined' &&
      this.opts.media?.createPeerConnection === undefined
    ) {
      this.fail('unsupported');
      return;
    }

    const config = await videoCall(
      this.fetchImpl,
      this.opts.relayBase,
      this.opts.viewToken,
      'config',
      { gameId: this.opts.gameId, room: this.opts.room },
      this.opts.publishKey,
    );
    if (run.signal.aborted) return;
    if (config.status !== 200) {
      this.fail(fatalOf(config) ?? 'failed');
      return;
    }
    this.iceServers = iceServersOf(config.body?.iceServers);
    const maxViewers = typeof config.body?.maxViewers === 'number' ? config.body.maxViewers : null;

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
    this.watchTracks(stream);
    this.setState({ ...this.trackState(), stream, maxViewers });
    await this.publishLoop(true, run.signal);
  }

  /** לחיצה של המנחה: סוף השידור, והמצלמה נכבית. */
  stop(): void {
    const gen = this.state.gen;
    this.teardown();
    if (gen !== null) {
      void videoCall(
        this.fetchImpl,
        this.opts.relayBase,
        this.opts.viewToken,
        'stop',
        { gen },
        this.opts.publishKey,
        { keepalive: true },
      );
    }
    this.setState(HOST_VIDEO_OFF);
  }

  /** הדף נסגר / המשחק הוחלף — כמו stop, בלי לעדכן אף אחד. */
  dispose(): void {
    const gen = this.state.gen;
    this.teardown();
    if (gen !== null) {
      void videoCall(
        this.fetchImpl,
        this.opts.relayBase,
        this.opts.viewToken,
        'stop',
        { gen },
        this.opts.publishKey,
        { keepalive: true },
      );
    }
    this.state = HOST_VIDEO_OFF;
  }

  setCam(on: boolean): void {
    this.wantCam = on;
    this.stream?.getVideoTracks().forEach((t) => {
      t.enabled = on;
    });
    this.setState(this.trackState());
  }

  setMic(on: boolean): void {
    this.wantMic = on;
    this.stream?.getAudioTracks().forEach((t) => {
      t.enabled = on;
    });
    this.setState(this.trackState());
  }

  /**
   * החלפת מצלמה / מיקרופון. באמצע שידור — רצועה במקום רצועה, בלי לנתק.
   * מכשיר מסוג שלא היה בכלל (למשל מצלמה שחוברה אחרי ההפעלה) — שידור מחדש.
   */
  async switchDevice(kind: VideoKind, deviceId: string | null): Promise<void> {
    if (kind === 'video') this.choice.camera = deviceId;
    else this.choice.mic = deviceId;
    const stream = this.stream;
    if (stream === null) return;
    let fresh: MediaStreamTrack | undefined;
    try {
      const got = await this.media.getUserMedia(
        kind === 'video'
          ? { video: cameraConstraints(deviceId) }
          : { audio: micConstraints(deviceId) },
      );
      fresh = kind === 'video' ? got.getVideoTracks()[0] : got.getAudioTracks()[0];
    } catch {
      return; // המכשיר הקודם ממשיך
    }
    if (fresh === undefined || this.stream !== stream) {
      fresh?.stop();
      return;
    }
    fresh.enabled = kind === 'video' ? this.wantCam : this.wantMic;
    const old = kind === 'video' ? stream.getVideoTracks() : stream.getAudioTracks();
    old.forEach((t) => {
      stream.removeTrack(t);
      t.stop();
    });
    stream.addTrack(fresh);
    this.watchTracks(stream);
    const sender = this.senders[kind];
    if (sender !== null) {
      await sender.replaceTrack(fresh).catch(() => {});
      this.setState({ ...this.trackState(), stream });
      return;
    }
    this.setState({ ...this.trackState(), stream });
    if (this.state.phase === 'live' || this.state.phase === 'reconnecting') this.recover(true);
  }

  // ------------------------------------------------------------------------

  private async capture(): Promise<MediaStream> {
    const { camera, mic } = this.choice;
    // מכשיר שנבחר ונעלם, או שאין מצלמה / מיקרופון — מנסים עם מה שיש.
    const attempts: MediaStreamConstraints[] = [
      { video: cameraConstraints(camera), audio: micConstraints(mic) },
      ...(camera !== null || mic !== null
        ? [{ video: cameraConstraints(null), audio: micConstraints(null) }]
        : []),
      { audio: micConstraints(null) },
      { video: cameraConstraints(null) },
    ];
    let last: unknown = null;
    for (const constraints of attempts) {
      try {
        return await this.media.getUserMedia(constraints);
      } catch (err) {
        if (mediaErrorOf(err) === 'permission') throw err;
        last = err;
      }
    }
    throw last;
  }

  private watchTracks(stream: MediaStream): void {
    for (const track of stream.getTracks()) {
      track.enabled = track.kind === 'video' ? this.wantCam : this.wantMic;
      track.onended = () => {
        if (this.stream === stream) this.setState(this.trackState());
      };
    }
  }

  private trackState(): Pick<HostVideoState, 'hasCam' | 'hasMic' | 'cam' | 'mic'> {
    const live = (t: MediaStreamTrack) => t.readyState !== 'ended';
    const hasCam = (this.stream?.getVideoTracks() ?? []).some(live);
    const hasMic = (this.stream?.getAudioTracks() ?? []).some(live);
    return { hasCam, hasMic, cam: hasCam && this.wantCam, mic: hasMic && this.wantMic };
  }

  private async publishLoop(force: boolean, signal: AbortSignal): Promise<void> {
    let failures = 0;
    while (!signal.aborted) {
      const attempt = await this.publishOnce(force, signal);
      if (signal.aborted) return;
      if (attempt === 'live') return;
      if (attempt === 'superseded') {
        this.teardown();
        this.setState({ ...HOST_VIDEO_OFF, phase: 'superseded' });
        return;
      }
      if (typeof attempt === 'object') {
        this.fail(attempt.fatal);
        return;
      }
      failures += 1;
      this.setState({ phase: this.state.phase === 'starting' ? 'starting' : 'reconnecting' });
      await sleep(backoffMs(failures), signal);
    }
  }

  private async publishOnce(force: boolean, signal: AbortSignal): Promise<Attempt> {
    const stream = this.stream;
    if (stream === null) return { fatal: 'no-devices' };
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

    const tracks: Array<{ mid: string | null; kind: VideoKind; tx: RTCRtpTransceiver }> = [];
    try {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack !== undefined) {
        let tx: RTCRtpTransceiver;
        try {
          tx = pc.addTransceiver(videoTrack, {
            direction: 'sendonly',
            streams: [stream],
            sendEncodings: SIMULCAST_ENCODINGS,
          });
        } catch {
          tx = pc.addTransceiver(videoTrack, {
            direction: 'sendonly',
            streams: [stream],
            sendEncodings: [{ maxBitrate: 600_000, maxFramerate: 24 }],
          });
        }
        tracks.push({ mid: null, kind: 'video', tx });
        this.senders.video = tx.sender;
      } else {
        this.senders.video = null;
      }
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack !== undefined) {
        const tx = pc.addTransceiver(audioTrack, { direction: 'sendonly', streams: [stream] });
        tracks.push({ mid: null, kind: 'audio', tx });
        this.senders.audio = tx.sender;
      } else {
        this.senders.audio = null;
      }
      if (tracks.length === 0) return { fatal: 'no-devices' };

      await pc.setLocalDescription(await pc.createOffer());
      await waitForIceGathering(pc);
    } catch {
      return 'retry';
    }
    if (signal.aborted || this.pc !== pc) return 'retry';
    const sdp = pc.localDescription?.sdp ?? '';
    const sent = tracks
      .map((t) => ({ mid: t.tx.mid, kind: t.kind }))
      .filter((t): t is { mid: string; kind: VideoKind } => t.mid !== null);
    const simulcast =
      this.senders.video !== null && /a=simulcast:\s*send/.test(sdp) ? ['a', 'b'] : [];

    const reply = await videoCall(
      this.fetchImpl,
      this.opts.relayBase,
      this.opts.viewToken,
      'pub',
      {
        gameId: this.opts.gameId,
        room: this.opts.room,
        sid: this.sid,
        started: this.started,
        force,
        sdp,
        tracks: sent,
        simulcast,
      },
      this.opts.publishKey,
    );
    if (signal.aborted || this.pc !== pc) return 'retry';
    if (reply.status === 409 && errorOf(reply) === 'superseded') return 'superseded';
    const fatal = fatalOf(reply);
    if (fatal !== null) return { fatal };
    const answer = reply.body?.sdp;
    const gen = reply.body?.gen;
    if (reply.status !== 200 || typeof answer !== 'string' || typeof gen !== 'string')
      return 'retry';

    try {
      await pc.setRemoteDescription({ type: 'answer', sdp: answer });
      await waitForConnected(pc, this.opts.connectTimeoutMs ?? 15_000);
    } catch {
      return 'retry';
    }
    if (signal.aborted || this.pc !== pc) return 'retry';

    pc.addEventListener('connectionstatechange', () => {
      if (this.pc === pc && pc.connectionState === 'failed') this.recover(false);
    });
    const maxViewers =
      typeof reply.body?.maxViewers === 'number' ? reply.body.maxViewers : this.state.maxViewers;
    this.setState({
      phase: 'live',
      error: null,
      gen,
      viewers: 0,
      maxViewers,
      ...this.trackState(),
    });
    this.startBeat(gen, signal);
    return 'live';
  }

  private startBeat(gen: string, signal: AbortSignal): void {
    this.stopBeat();
    this.beatTimer = setInterval(() => {
      void (async () => {
        const reply = await videoCall(
          this.fetchImpl,
          this.opts.relayBase,
          this.opts.viewToken,
          'beat',
          { gen },
          this.opts.publishKey,
          { timeoutMs: 8000 },
        );
        if (signal.aborted || this.state.gen !== gen) return;
        if (reply.status === 200) {
          const viewers = typeof reply.body?.viewers === 'number' ? reply.body.viewers : 0;
          if (viewers !== this.state.viewers) this.setState({ viewers });
          return;
        }
        const error = errorOf(reply);
        if (error === 'superseded') {
          this.teardown();
          this.setState({ ...HOST_VIDEO_OFF, phase: 'superseded' });
        } else if (error === 'gone') {
          this.recover(false); // השרת הופעל מחדש, או שהשידור נסגר אצלו
        }
        // רשת: ממשיכים לדפוק; אם נעלמנו מהשרת — נקבל "gone" ונפתח מחדש.
      })();
    }, this.opts.beatMs ?? 10_000);
  }

  private stopBeat(): void {
    if (this.beatTimer !== null) clearInterval(this.beatTimer);
    this.beatTimer = null;
  }

  /** החיבור נפל / השרת שכח אותנו — שידור חדש עם אותה מצלמה. */
  private recover(force: boolean): void {
    const run = this.run;
    if (run === null || run.signal.aborted || this.recovering || this.stream === null) return;
    this.recovering = true;
    this.stopBeat();
    // ‏gen הקודם נשאר עד שיש חדש: הצופים ממשיכים להציג «מתחברים…» במקום
    // שחלון הווידאו ייעלם ויחזור (והמסך שלהם יקפוץ).
    this.setState({ phase: 'reconnecting' });
    void this.publishLoop(force, run.signal).finally(() => {
      this.recovering = false;
    });
  }

  private closePeer(): void {
    const pc = this.pc;
    this.pc = null;
    this.senders.video = null;
    this.senders.audio = null;
    if (pc !== null) {
      try {
        pc.close();
      } catch {
        /* כבר סגור */
      }
    }
  }

  private teardown(): void {
    this.run?.abort();
    this.run = null;
    this.stopBeat();
    this.closePeer();
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.stream = null;
  }

  private fail(error: HostVideoError): void {
    this.teardown();
    this.setState({ ...HOST_VIDEO_OFF, phase: 'error', error });
  }

  private setState(patch: Partial<HostVideoState>): void {
    this.state = { ...this.state, ...patch };
    this.opts.onState?.(this.state);
  }
}
