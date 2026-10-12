/**
 * «במה» אצל המסך הראשי: המנחה פותח וסוגר אותה, ובוחר מי עולה (עד 9). השרת
 * (server/live-stage.mjs) מחזיק את הבמה רק כל עוד המנחה שואל עליה — כאן שואלים
 * כל 2 שניות, ושולחים בכל פעם את כל מה שהמנחה רוצה: פתוחה או סגורה, ומי על
 * הבמה. מהתשובה: המצלמות הדלוקות ומי מהן על הבמה בפועל.
 *
 * - פותחים רק כשווידאו המנחה משודר (`setGen`). כשהוא נכבה, הבמה נסגרת (גם בשרת).
 * - תקלה בדרך (רשת, השרת הופעל מחדש, השידור מתחבר מחדש) לא סוגרת את הבמה כאן:
 *   מצב המסך ממשיך להראות אותה, הסקר הבא פותח אותה שוב בשרת, והמשתתפים מתחברים
 *   שוב לבד.
 * - משתתף שהמצלמה שלו כבתה לרגע נשאר בבחירה של המנחה (`keepWanted`), וחוזר
 *   לבמה כשהוא מתחבר שוב.
 */

import { backoffMs, errorOf, videoCall, type VideoReply, type VideoStage } from './api.ts';
import { keepWanted, liveStageOf, STAGE_GRACE_MS, STAGE_MAX } from './stage.ts';

export type StageHostPhase = 'closed' | 'opening' | 'open';

export type StageHostError =
  /** הבמה נפתחת רק כשהווידאו של המנחה משודר. */
  | 'no-video'
  /** הרישיון לא כולל במה. */
  | 'not-entitled'
  /** אין וידאו בשרת הזה. */
  | 'not-configured';

/** מצלמה דלוקה של משתתף, כמו שהשרת מחזיר. */
export interface StageCam {
  id: string;
  name: string;
  /** מתי הודלקה (בשרת). מצלמה שהתחלפה (המשתתף התחבר מחדש) — זמן חדש. */
  at: number;
}

export interface StageHostState {
  phase: StageHostPhase;
  error: StageHostError | null;
  /** גרסת הבמה בשרת. */
  v: number;
  /** על הבמה בפועל, בסדר שהמנחה בחר. */
  ids: string[];
  /** מי שהמנחה בחר — כולל מי שהמצלמה שלו כבתה לרגע. */
  wanted: string[];
  /** המצלמות הדלוקות, לפי הסדר שבו הודלקו. */
  cams: StageCam[];
  maxOnStage: number;
  maxCams: number;
  maxPreview: number;
}

export const STAGE_HOST_CLOSED: StageHostState = {
  phase: 'closed',
  error: null,
  v: 0,
  ids: [],
  wanted: [],
  cams: [],
  maxOnStage: STAGE_MAX,
  maxCams: 50,
  maxPreview: 12,
};

/** מה שנשלח לצופים במצב המסך, או null כשהבמה סגורה. */
export function liveStageOfHost(state: StageHostState): VideoStage | null {
  return state.phase === 'open' ? liveStageOf(state.v, state.ids, state.cams) : null;
}

export interface StageHostOptions {
  relayBase: string;
  viewToken: string;
  publishKey: string;
  gameId: string;
  room: string;
  fetch?: typeof fetch;
  pollMs?: number;
  graceMs?: number;
  now?: () => number;
  onState?: (state: StageHostState) => void;
}

const PID_RE = /^[0-9a-f]{16}$/;

function idsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string' && PID_RE.test(id))
    : [];
}

function camsOf(value: unknown): StageCam[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const { id, name, at } = (entry ?? {}) as { id?: unknown; name?: unknown; at?: unknown };
    if (typeof id !== 'string' || !PID_RE.test(id)) return [];
    return [
      { id, name: typeof name === 'string' ? name : '', at: typeof at === 'number' ? at : 0 },
    ];
  });
}

function limitOf(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

export class StageHostController {
  private readonly opts: StageHostOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private state: StageHostState = STAGE_HOST_CLOSED;
  private gen: string | null = null;
  private wantOpen = false;
  private wanted: string[] = [];
  private missingSince = new Map<string, number>();
  /** מצלמות שהמנחה כיבה ועוד לא נשלחו לשרת. */
  private readonly off = new Set<string>();
  private inFlight = false;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private disposed = false;

  constructor(options: StageHostOptions) {
    this.opts = options;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
  }

  get current(): StageHostState {
    return this.state;
  }

  /** מה שנשלח לצופים במצב המסך, או null כשהבמה סגורה. */
  get live(): VideoStage | null {
    return liveStageOfHost(this.state);
  }

  /** מזהה השידור של וידאו המנחה, או null כשהוא כבוי. */
  setGen(gen: string | null): void {
    if (gen === this.gen) return;
    this.gen = gen;
    if (gen === null) {
      // הווידאו נכבה (או עבר למסך אחר): השרת סוגר את הבמה בעצמו.
      this.wantOpen = false;
      this.forget();
      this.stopTimer();
      if (this.state.phase !== 'closed' || this.state.error !== null) this.reset(null);
      return;
    }
    if (this.wantOpen) void this.sync();
  }

  open(): void {
    if (this.disposed) return;
    if (this.gen === null) {
      this.setState({ phase: 'closed', error: 'no-video' });
      return;
    }
    this.wantOpen = true;
    if (this.state.phase === 'closed') this.setState({ phase: 'opening', error: null });
    void this.sync();
  }

  close(): void {
    const wasOpen = this.wantOpen;
    this.wantOpen = false;
    this.forget();
    this.reset(null);
    if (wasOpen) void this.sync();
  }

  /** להעלות לבמה (בסוף התור). */
  put(id: string): void {
    if (!this.wantOpen || this.wanted.includes(id)) return;
    if (this.wanted.length >= this.state.maxOnStage) return;
    this.wanted = [...this.wanted, id];
    this.changed();
  }

  /** להוריד מהבמה. המצלמה נשארת דלוקה, ורק המנחה רואה אותה. */
  remove(id: string): void {
    if (!this.wanted.includes(id)) return;
    this.wanted = this.wanted.filter((w) => w !== id);
    this.missingSince.delete(id);
    this.changed();
  }

  /** לכבות את המצלמה: יורדת מהבמה, והמשתתף לא יכול להדליק שוב לזמן מה. */
  block(id: string): void {
    if (!this.wantOpen) return;
    this.wanted = this.wanted.filter((w) => w !== id);
    this.missingSince.delete(id);
    this.off.add(id);
    this.setState({
      wanted: this.wanted,
      ids: this.state.ids.filter((i) => i !== id),
      cams: this.state.cams.filter((c) => c.id !== id),
    });
    void this.sync();
  }

  /** כולם יורדים מהבמה. */
  clear(): void {
    if (this.wanted.length === 0) return;
    this.wanted = [];
    this.missingSince.clear();
    this.changed();
  }

  /** הדף נסגר / המשחק הוחלף. הבמה נסגרת בשרת עם הווידאו (stop של המנחה). */
  dispose(): void {
    this.disposed = true;
    this.stopTimer();
  }

  // ------------------------------------------------------------------------

  private changed(): void {
    this.setState({ wanted: this.wanted });
    void this.sync();
  }

  private forget(): void {
    this.wanted = [];
    this.missingSince.clear();
    this.off.clear();
  }

  private reset(error: StageHostError | null): void {
    const { maxOnStage, maxCams, maxPreview } = this.state;
    this.setState({ ...STAGE_HOST_CLOSED, maxOnStage, maxCams, maxPreview, error });
  }

  private stopTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** בקשה אחת בכל פעם; שינוי באמצע — עוד בקשה מיד אחריה. */
  private async sync(): Promise<void> {
    if (this.disposed) return;
    if (this.inFlight) {
      this.dirty = true;
      return;
    }
    this.stopTimer();
    const gen = this.gen;
    if (gen === null) return;
    const open = this.wantOpen;
    const off = [...this.off];
    this.inFlight = true;
    const reply = await videoCall(
      this.fetchImpl,
      this.opts.relayBase,
      this.opts.viewToken,
      'stage',
      { gameId: this.opts.gameId, room: this.opts.room, gen, open, ids: this.wanted, off },
      this.opts.publishKey,
      { timeoutMs: 8000 },
    );
    this.inFlight = false;
    if (this.disposed) return;
    if (reply.status === 200) off.forEach((id) => this.off.delete(id));
    const keepPolling = this.apply(reply, open);
    if (this.dirty) {
      this.dirty = false;
      void this.sync();
      return;
    }
    if (keepPolling && this.wantOpen) {
      const wait = Math.max(this.opts.pollMs ?? 2000, backoffMs(this.failures, 10_000));
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.sync();
      }, wait);
    }
  }

  /** התשובה: מה מוצג עכשיו. false = אין טעם להמשיך לשאול. */
  private apply(reply: VideoReply, sentOpen: boolean): boolean {
    if (sentOpen !== this.wantOpen) return true; // המנחה שינה את דעתו בינתיים
    if (reply.status === 200) {
      this.failures = 0;
      if (!sentOpen) return false;
      if (reply.body?.open !== true) return true;
      const cams = camsOf(reply.body.cams);
      const kept = keepWanted(
        this.wanted,
        new Set(cams.map((c) => c.id)),
        this.missingSince,
        this.now(),
        this.opts.graceMs ?? STAGE_GRACE_MS,
      );
      if (kept.wanted.length !== this.wanted.length) this.dirty = true; // מי שלא חזר — יורד גם בשרת
      this.wanted = kept.wanted;
      this.missingSince = kept.missingSince;
      const v = reply.body.v;
      this.setState({
        phase: 'open',
        error: null,
        v: typeof v === 'number' && Number.isFinite(v) ? v : this.state.v,
        ids: idsOf(reply.body.ids),
        wanted: this.wanted,
        cams,
        maxOnStage: limitOf(reply.body.maxOnStage, this.state.maxOnStage),
        maxCams: limitOf(reply.body.maxCams, this.state.maxCams),
        maxPreview: limitOf(reply.body.maxPreview, this.state.maxPreview),
      });
      return true;
    }
    const error = errorOf(reply);
    if (error === 'not-entitled' || error === 'bad-key' || error === 'not-configured') {
      this.wantOpen = false;
      this.forget();
      this.reset(error === 'not-configured' ? 'not-configured' : 'not-entitled');
      return false;
    }
    // ‏no-video (השידור מתחבר מחדש, או שהשרת הופעל מחדש), superseded (רגע
    // ההחלפה של מזהה השידור), רשת: הבמה נשארת כמו שהיא, והסקר הבא ינסה שוב.
    this.failures += 1;
    return true;
  }

  private setState(patch: Partial<StageHostState>): void {
    this.state = { ...this.state, ...patch };
    this.opts.onState?.(this.state);
  }
}
