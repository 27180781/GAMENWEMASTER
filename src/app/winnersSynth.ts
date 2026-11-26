/**
 * צלילי מסך המנצחים — הכול מסונתז ב-WebAudio, בלי שום קובץ (עובד גם אופליין).
 * הסולם: סול מז'ור, כדי שהאפקטים ישבו על צליל המנצחים של המשחק.
 *
 * מוזיקת הרקע עצמה היא צליל המנצחים שהוגדר במשחק (setting.sound.winnersMediaSound),
 * ומתנגנת כרגיל בערוץ 'winners' של AudioManager. כאן רק האפקטים שמעליה: תיפוף,
 * חבטה, תרועה, מחיאות כפיים... ותוכנית ההנמכה של המוזיקה בכל חשיפה.
 *
 * כל הפונקציות מקבלות הקשר אודיו מבחוץ ואינן נוגעות ב-window בטעינה.
 */

/** מה המנוע קורא לכל אפקט (בתוכניות של הסגנונות). */
export type CueName =
  | 'whoosh'
  | 'impact'
  | 'shimmer'
  | 'ticks'
  | 'drumroll'
  | 'rise'
  | 'crash'
  | 'fanfare'
  | 'pops'
  | 'applause'
  | 'flip'
  | 'clink'
  | 'launch'
  | 'burst';

export interface CueOpts {
  dur?: number;
  gain?: number;
  from?: number;
  to?: number;
  pan?: number;
  pan0?: number;
  pan1?: number;
  seed?: number;
  low?: number;
  decay?: number;
  notes?: readonly number[];
  step?: number;
  count?: number;
  f0?: number;
  f1?: number;
  ding?: boolean;
  dingGain?: number;
  snap?: number;
  f?: number;
  crackle?: number;
}

export interface SoundCue {
  /** שניות מתחילת האירוע. */
  at: number;
  name: CueName;
  opts?: CueOpts;
}

/** הנמכת מוזיקת הרקע: מ-at, ב-attack שניות לרמה level (יחסית), hold, ואז release. */
export interface DuckSpec {
  at: number;
  level: number;
  hold: number;
  release?: number;
  attack?: number;
}

export interface SoundPlan {
  cues: SoundCue[];
  duck?: DuckSpec;
}

/** עוצמת מוזיקת הרקע ביחס לאפקטים כשמסך המנצחים פתוח (כמו בדוגמאות שאושרו). */
export const WINNERS_BED_LEVEL = 0.62 * 0.92;
/** עוצמת האפקטים (לפני המגביל). */
export const WINNERS_FX_LEVEL = 0.92;

export const NOTES = {
  G2: 98,
  D3: 146.83,
  G3: 196,
  B3: 246.94,
  D4: 293.66,
  G4: 392,
  B4: 493.88,
  D5: 587.33,
  G5: 783.99,
  B5: 987.77,
  D6: 1174.66,
  G6: 1567.98,
  B6: 1975.53,
  D7: 2349.32,
  G7: 3135.96,
} as const;
const N = NOTES;

/** משך התיפוף לפני המקום הראשון — זהה ל-SUSPENSE של המסך. */
const DRUMROLL = 2.0;

// ---------------------------------------------------------------------------
// אקראיות דטרמיניסטית (אותו רעש בכל הפעלה)
// ---------------------------------------------------------------------------

function hash(a: number, b = 0): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// מאגרי שמע — נבנים פעם אחת לכל הקשר
// ---------------------------------------------------------------------------

interface Buffers {
  noise?: AudioBuffer;
  applause?: AudioBuffer;
  crackle?: AudioBuffer;
}
const caches = new WeakMap<BaseAudioContext, Buffers>();
function cacheOf(ctx: BaseAudioContext): Buffers {
  let c = caches.get(ctx);
  if (c === undefined) {
    c = {};
    caches.set(ctx, c);
  }
  return c;
}

function noiseBuf(ctx: BaseAudioContext): AudioBuffer {
  const c = cacheOf(ctx);
  if (c.noise) return c.noise;
  const len = Math.floor(ctx.sampleRate * 3);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const R = rng(9001 + ch * 131);
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = R() * 2 - 1;
  }
  c.noise = b;
  return b;
}

/** מחיאות כפיים: מאות מחיאות קצרות בגוונים שונים, רחש קהל ושריקות. */
function applauseBuf(ctx: BaseAudioContext): AudioBuffer {
  const c = cacheOf(ctx);
  if (c.applause) return c.applause;
  const sr = ctx.sampleRate;
  const dur = 6.2;
  const len = Math.floor(dur * sr);
  const b = ctx.createBuffer(2, len, sr);
  const dens = (t: number) =>
    t < 0.35 ? t / 0.35 : t < 2.4 ? 1 : Math.max(0, 1 - (t - 2.4) / (dur - 2.6));
  for (let ch = 0; ch < 2; ch++) {
    const R = rng(4242 + ch * 17);
    const d = b.getChannelData(ch);
    let t = 0.005;
    while (t < dur) {
      const dn = dens(t);
      t += -Math.log(1 - R() * 0.999) / Math.max(1, 46 * dn);
      if (t >= dur) break;
      if (R() > dn + 0.05) continue;
      const start = Math.floor(t * sr);
      const L = Math.floor((0.006 + R() * 0.012) * sr);
      const f = 700 + R() * 2200;
      const q = 0.9 + R() * 1.4;
      // biquad bandpass לכל מחיאה
      const w = (2 * Math.PI * f) / sr;
      const al = Math.sin(w) / (2 * q);
      const a0 = 1 + al;
      const b0 = al / a0;
      const b2 = -al / a0;
      const a1 = (-2 * Math.cos(w)) / a0;
      const a2 = (1 - al) / a0;
      let x1 = 0;
      let x2 = 0;
      let y1 = 0;
      let y2 = 0;
      const amp = (0.35 + R() * 0.65) * (0.45 + 0.55 * dn);
      const tail = Math.floor(L * 3);
      for (let j = 0; j < tail && start + j < len; j++) {
        const x = j < L ? (R() * 2 - 1) * Math.exp((-4 * j) / L) : 0;
        const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        d[start + j] = (d[start + j] ?? 0) + y * amp * 2.2;
      }
    }
    // רחש קהל עמום
    let lp = 0;
    for (let i = 0; i < len; i++) {
      lp += 0.06 * (R() * 2 - 1 - lp);
      d[i] = (d[i] ?? 0) + lp * 0.55 * dens(i / sr);
    }
  }
  // שתי שריקות (עולות ויורדות)
  const R = rng(77);
  const left = b.getChannelData(0);
  const right = b.getChannelData(1);
  for (const [t0, pan] of [
    [0.7, 0.35],
    [1.9, 0.75],
  ] as const) {
    let ph = 0;
    const n0 = Math.floor(t0 * sr);
    const n1 = Math.floor((t0 + 0.62) * sr);
    for (let i = n0; i < n1 && i < len; i++) {
      const u = (i - n0) / (n1 - n0);
      const f = u < 0.4 ? 1500 + 1000 * (u / 0.4) : 2500 - 450 * ((u - 0.4) / 0.6);
      ph += (2 * Math.PI * (f + Math.sin(u * 60) * 18)) / sr;
      const a = 0.09 * Math.sin(Math.PI * Math.min(1, u * 1.05)) * (0.8 + 0.2 * R());
      left[i] = (left[i] ?? 0) + Math.sin(ph) * a * (1 - pan);
      right[i] = (right[i] ?? 0) + Math.sin(ph) * a * pan;
    }
  }
  let peak = 0;
  for (let ch = 0; ch < 2; ch++)
    for (const v of b.getChannelData(ch)) peak = Math.max(peak, Math.abs(v));
  const k = 0.92 / (peak || 1);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (d[i] ?? 0) * k;
  }
  c.applause = b;
  return b;
}

/** פצפוצים של זיקוק — קליקים קצרים שהולכים ומתדלדלים. */
function crackleBuf(ctx: BaseAudioContext): AudioBuffer {
  const c = cacheOf(ctx);
  if (c.crackle) return c.crackle;
  const sr = ctx.sampleRate;
  const dur = 1.8;
  const len = Math.floor(dur * sr);
  const b = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const R = rng(555 + ch);
    const d = b.getChannelData(ch);
    for (let k = 0; k < 90; k++) {
      const t = 0.15 + Math.pow(R(), 1.6) * (dur - 0.3);
      const s = Math.floor(t * sr);
      const L = Math.floor((0.002 + R() * 0.004) * sr);
      const amp = (0.3 + R() * 0.7) * (1 - t / dur);
      let prev = 0;
      for (let j = 0; j < L && s + j < len; j++) {
        const x = (R() * 2 - 1) * Math.exp((-5 * j) / L);
        d[s + j] = (d[s + j] ?? 0) + (x - prev) * amp; // high-pass פשוט
        prev = x;
      }
    }
  }
  c.crackle = b;
  return b;
}

/**
 * בונה מראש את מאגרי השמע (בעיקר מחיאות הכפיים, כ-50 מ"ש של חישוב), כדי שלא
 * יגרמו לקפיצה בתמונה ברגע החשיפה של המקום הראשון.
 */
export function prepareWinnersBuffers(ctx: BaseAudioContext): void {
  noiseBuf(ctx);
  crackleBuf(ctx);
  applauseBuf(ctx);
}

// ---------------------------------------------------------------------------
// עזרים
// ---------------------------------------------------------------------------

const tiny = 0.0001;

function noiseSrc(ctx: BaseAudioContext, t: number, dur: number, seed = 0): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf(ctx);
  const off = (hash(seed, 7) % 2400) / 1000;
  s.start(t, off, Math.min(dur, 2.9 - off) + 0.01);
  return s;
}

function filt(
  ctx: BaseAudioContext,
  type: BiquadFilterType,
  f: number,
  q?: number,
): BiquadFilterNode {
  const n = ctx.createBiquadFilter();
  n.type = type;
  n.frequency.value = f;
  if (q !== undefined) n.Q.value = q;
  return n;
}

function gainNode(ctx: BaseAudioContext, v = 1): GainNode {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

function panTo(ctx: BaseAudioContext, out: AudioNode, p: number | undefined): AudioNode {
  if (p === undefined || p === 0 || typeof ctx.createStereoPanner !== 'function') return out;
  const sp = ctx.createStereoPanner();
  sp.pan.value = p;
  sp.connect(out);
  return sp;
}

/** מעטפת: התקפה מעריכית לשיא ודעיכה מעריכית. */
function ad(
  param: AudioParam,
  t: number,
  attack: number,
  peak: number,
  decay: number,
  hold = 0,
): void {
  param.setValueAtTime(tiny, t);
  param.exponentialRampToValueAtTime(Math.max(tiny * 2, peak), t + attack);
  if (hold > 0) param.setValueAtTime(Math.max(tiny * 2, peak), t + attack + hold);
  param.exponentialRampToValueAtTime(tiny, t + attack + hold + decay);
}

function osc(
  ctx: BaseAudioContext,
  type: OscillatorType,
  f: number,
  t: number,
  stop: number,
): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  o.start(t);
  o.stop(stop);
  return o;
}

// ---------------------------------------------------------------------------
// האפקטים
// ---------------------------------------------------------------------------

type CueFn = (ctx: BaseAudioContext, out: AudioNode, t: number, o: CueOpts) => void;

const CUES: Record<CueName, CueFn> = {
  /** משב אוויר — חשיפה מתקרבת. */
  whoosh(ctx, out, t, o) {
    const dur = o.dur ?? 0.5;
    const g = o.gain ?? 0.5;
    const n = noiseSrc(ctx, t, dur + 0.1, o.seed ?? 1);
    const bp = filt(ctx, 'bandpass', o.from ?? 280, 1.3);
    bp.frequency.setValueAtTime(o.from ?? 280, t);
    bp.frequency.exponentialRampToValueAtTime(o.to ?? 3800, t + dur);
    const gn = gainNode(ctx, 0);
    gn.gain.setValueAtTime(tiny, t);
    gn.gain.exponentialRampToValueAtTime(g, t + dur * 0.72);
    gn.gain.exponentialRampToValueAtTime(tiny, t + dur * 1.08);
    let dest: AudioNode = out;
    if (typeof ctx.createStereoPanner === 'function') {
      const sp = ctx.createStereoPanner();
      sp.pan.setValueAtTime(o.pan0 ?? -0.5, t);
      sp.pan.linearRampToValueAtTime(o.pan1 ?? 0.5, t + dur);
      sp.connect(out);
      dest = sp;
    }
    n.connect(bp).connect(gn).connect(dest);
  },
  /** חבטה קולנועית: תת-בס יורד, גוף ונקישה. */
  impact(ctx, out, t, o) {
    const g = o.gain ?? 0.9;
    const p = panTo(ctx, out, o.pan);
    const sub = osc(ctx, 'sine', 130, t, t + 1.2);
    sub.frequency.exponentialRampToValueAtTime(o.low ?? 38, t + 0.45);
    const sg = gainNode(ctx, 0);
    ad(sg.gain, t, 0.006, g, o.decay ?? 0.85);
    sub.connect(sg).connect(p);
    const n = noiseSrc(ctx, t, 0.5, o.seed ?? 2);
    const lp = filt(ctx, 'lowpass', 900, 0.7);
    const ng = gainNode(ctx, 0);
    ad(ng.gain, t, 0.003, g * 0.55, 0.28);
    n.connect(lp).connect(ng).connect(p);
    const c = noiseSrc(ctx, t, 0.06, (o.seed ?? 2) + 9);
    const hp = filt(ctx, 'highpass', 3200, 0.7);
    const cg = gainNode(ctx, 0);
    ad(cg.gain, t, 0.002, g * 0.3, 0.035);
    c.connect(hp).connect(cg).connect(p);
  },
  /** נצנוץ פעמונים: ארפג'יו סול מז'ור עולה. */
  shimmer(ctx, out, t, o) {
    const notes = o.notes ?? [N.G5, N.B5, N.D6, N.G6, N.B6, N.D7];
    const step = o.step ?? 0.045;
    const g = o.gain ?? 0.16;
    const decay = o.decay ?? 1.5;
    notes.forEach((f, i) => {
      const at = t + i * step;
      const p = panTo(ctx, out, ((i % 2) * 2 - 1) * 0.35);
      const a = osc(ctx, 'sine', f, at, at + decay + 0.1);
      const ag = gainNode(ctx, 0);
      ad(ag.gain, at, 0.004, g, decay);
      a.connect(ag).connect(p);
      const b = osc(ctx, 'sine', f * 2.756, at, at + decay * 0.5);
      const bg = gainNode(ctx, 0);
      ad(bg.gain, at, 0.003, g * 0.32, decay * 0.4);
      b.connect(bg).connect(p);
    });
    const n = noiseSrc(ctx, t, 0.9, o.seed ?? 3);
    const hp = filt(ctx, 'highpass', 7000, 0.6);
    const ng = gainNode(ctx, 0);
    ad(ng.gain, t, 0.02, g * 0.35, 0.7);
    n.connect(hp).connect(ng).connect(out);
  },
  /** תקתוק ספירת הניקוד (צפוף בהתחלה, נדיר בסוף — כמו הספירה) ודינג. */
  ticks(ctx, out, t, o) {
    const dur = o.dur ?? 1.1;
    const count = o.count ?? 16;
    const g = o.gain ?? 0.07;
    for (let i = 0; i < count; i++) {
      const p = count > 1 ? i / (count - 1) : 1;
      const at = t + dur * (1 - Math.pow(1 - p, 1 / 3)) * 0.98;
      const f = (o.f0 ?? 1800) + ((o.f1 ?? 2900) - (o.f0 ?? 1800)) * p;
      const s = osc(ctx, 'triangle', f, at, at + 0.05);
      const sg = gainNode(ctx, 0);
      ad(sg.gain, at, 0.002, g, 0.035);
      s.connect(sg).connect(out);
    }
    if (o.ding !== false) {
      const at = t + dur;
      for (const [f, k, dec] of [
        [N.G6, 1, 0.9],
        [N.D7, 0.45, 0.6],
        [N.G7, 0.18, 0.4],
      ] as const) {
        const s = osc(ctx, 'sine', f, at, at + dec + 0.1);
        const sg = gainNode(ctx, 0);
        ad(sg.gain, at, 0.003, (o.dingGain ?? 0.14) * k, dec);
        s.connect(sg).connect(out);
      }
    }
  },
  /** תיפוף מתגבר לפני המקום הראשון, עם מצילה הפוכה בסוף. */
  drumroll(ctx, out, t, o) {
    const dur = o.dur ?? DRUMROLL;
    const g = o.gain ?? 0.6;
    const n = noiseSrc(ctx, t, dur + 0.1, o.seed ?? 4);
    const bp = filt(ctx, 'bandpass', 2100, 0.8);
    const hp = filt(ctx, 'highpass', 700, 0.7);
    const sn = gainNode(ctx, 0);
    const body = osc(ctx, 'triangle', 196, t, t + dur + 0.1);
    const bodyG = gainNode(ctx, 0);
    const R = rng(31);
    sn.gain.setValueAtTime(tiny, t);
    bodyG.gain.setValueAtTime(tiny, t);
    const rate = 29;
    for (let k = 0; ; k++) {
      const ts = t + k / rate + (R() - 0.5) * 0.004;
      if (ts > t + dur - 0.01) break;
      const p = (ts - t) / dur;
      const amp = g * (0.1 + 0.9 * Math.pow(Math.max(0, p), 1.7)) * (k % 2 ? 0.82 : 1);
      sn.gain.setValueAtTime(amp, ts);
      sn.gain.exponentialRampToValueAtTime(amp * 0.06, ts + 0.03);
      bodyG.gain.setValueAtTime(amp * 0.25, ts);
      bodyG.gain.exponentialRampToValueAtTime(amp * 0.01, ts + 0.025);
    }
    sn.gain.setValueAtTime(tiny, t + dur);
    bodyG.gain.setValueAtTime(tiny, t + dur);
    n.connect(hp).connect(bp).connect(sn).connect(out);
    body.connect(bodyG).connect(out);
    // רעם טימפני מתגבר
    const tim = osc(ctx, 'sine', N.G2 * 0.84, t, t + dur + 0.05);
    const tg = gainNode(ctx, 0);
    tg.gain.setValueAtTime(tiny, t);
    tg.gain.exponentialRampToValueAtTime(g * 0.5, t + dur - 0.05);
    tg.gain.exponentialRampToValueAtTime(tiny, t + dur);
    const lfo = osc(ctx, 'sine', 13, t, t + dur);
    const lg = gainNode(ctx, g * 0.18);
    lfo.connect(lg).connect(tg.gain);
    tim.connect(tg).connect(out);
    // מצילה הפוכה בשנייה האחרונה
    const r = noiseSrc(ctx, t + dur - 1.1, 1.15, (o.seed ?? 4) + 3);
    const rh = filt(ctx, 'highpass', 5200, 0.6);
    const rg = gainNode(ctx, 0);
    rg.gain.setValueAtTime(tiny, t + dur - 1.1);
    rg.gain.exponentialRampToValueAtTime(g * 0.32, t + dur - 0.01);
    rg.gain.setValueAtTime(tiny, t + dur);
    r.connect(rh).connect(rg).connect(out);
  },
  /** מתח עולה (riser). */
  rise(ctx, out, t, o) {
    const dur = o.dur ?? DRUMROLL;
    const g = o.gain ?? 0.07;
    const lp = filt(ctx, 'lowpass', 300, 3);
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(4800, t + dur);
    const gn = gainNode(ctx, 0);
    gn.gain.setValueAtTime(tiny, t);
    gn.gain.exponentialRampToValueAtTime(g, t + dur - 0.02);
    gn.gain.setValueAtTime(tiny, t + dur);
    for (const [f0, f1] of [
      [N.G3, N.G5],
      [N.D4, N.D6],
    ] as const) {
      const s = osc(ctx, 'sawtooth', f0, t, t + dur + 0.02);
      s.frequency.exponentialRampToValueAtTime(f1, t + dur);
      s.connect(lp);
    }
    lp.connect(gn).connect(out);
  },
  /** מצילה. */
  crash(ctx, out, t, o) {
    const g = o.gain ?? 0.42;
    const dec = o.decay ?? 2.6;
    const n = noiseSrc(ctx, t, dec + 0.2, o.seed ?? 5);
    const hp = filt(ctx, 'highpass', 3600, 0.5);
    const ng = gainNode(ctx, 0);
    ad(ng.gain, t, 0.003, g, dec);
    n.connect(hp).connect(ng).connect(out);
    const n2 = noiseSrc(ctx, t, dec * 0.6, (o.seed ?? 5) + 1);
    const bp = filt(ctx, 'bandpass', 9000, 0.8);
    const g2 = gainNode(ctx, 0);
    ad(g2.gain, t, 0.002, g * 0.6, dec * 0.5);
    n2.connect(bp).connect(g2).connect(out);
    const mh = filt(ctx, 'highpass', 5500, 0.7);
    const mg = gainNode(ctx, 0);
    ad(mg.gain, t, 0.002, g * 0.07, dec * 0.6);
    for (const f of [2953, 4187, 5261, 6373, 7111, 8429])
      osc(ctx, 'square', f, t, t + dec).connect(mh);
    mh.connect(mg).connect(out);
  },
  /** תרועת חצוצרות בסול מז'ור + טימפני. */
  fanfare(ctx, out, t, o) {
    const bus = gainNode(ctx, o.gain ?? 0.3);
    bus.connect(out);
    const brass = (f: number, s: number, dur: number, vel = 1, vib = false, pan = 0) => {
      const lp = filt(ctx, 'lowpass', 500, 1.6);
      lp.frequency.setValueAtTime(500, s);
      lp.frequency.exponentialRampToValueAtTime(900 + 2800 * vel, s + 0.045);
      lp.frequency.exponentialRampToValueAtTime(1500 + 600 * vel, s + 0.3);
      const g = gainNode(ctx, 0);
      g.gain.setValueAtTime(tiny, s);
      g.gain.exponentialRampToValueAtTime(0.32 * vel, s + 0.028);
      g.gain.setValueAtTime(0.26 * vel, s + Math.max(0.04, dur));
      g.gain.exponentialRampToValueAtTime(tiny, s + dur + 0.2);
      let lg: GainNode | null = null;
      if (vib) {
        const lfo = osc(ctx, 'sine', 5.4, s, s + dur + 0.25);
        lg = gainNode(ctx, 0);
        lg.gain.setValueAtTime(0, s);
        lg.gain.linearRampToValueAtTime(9, s + 0.35);
        lfo.connect(lg);
      }
      for (const det of [-7, 0, 6]) {
        const v = osc(ctx, 'sawtooth', f, s, s + dur + 0.25);
        v.detune.value = det;
        if (lg) lg.connect(v.detune);
        v.connect(lp);
      }
      lp.connect(g).connect(panTo(ctx, bus, pan));
    };
    const timp = (s: number, f: number = N.G2, k = 1) => {
      const v = osc(ctx, 'sine', f * 1.5, s, s + 1.2);
      v.frequency.exponentialRampToValueAtTime(f, s + 0.08);
      const g = gainNode(ctx, 0);
      ad(g.gain, s, 0.005, 0.9 * k, 1.0);
      v.connect(g).connect(bus);
    };
    // טא-טא-טא-טאאם ... ואקורד
    brass(N.G4, t, 0.09, 0.8);
    brass(N.G4, t + 0.14, 0.09, 0.8);
    brass(N.G4, t + 0.28, 0.09, 0.85);
    brass(N.D5, t + 0.42, 0.34, 1, true);
    brass(N.B4, t + 0.42, 0.34, 0.7, true, -0.2);
    timp(t + 0.42, N.D3 * 0.5, 0.8);
    brass(N.B4, t + 0.82, 0.1, 0.85);
    brass(N.D5, t + 0.96, 0.1, 0.9);
    const c = t + 1.12;
    brass(N.G4, c, 1.5, 1, true, -0.3);
    brass(N.B4, c, 1.5, 0.9, true, 0.25);
    brass(N.D5, c, 1.5, 0.95, true, -0.1);
    brass(N.G5, c, 1.5, 1, true, 0.3);
    brass(N.G3, c, 1.5, 0.8, false);
    timp(c, N.G2, 1);
    timp(c + 0.18, N.G2, 0.5);
  },
  /** תותחי קונפטי: שני פיצוצים ורחש של ניירות. */
  pops(ctx, out, t, o) {
    const g = o.gain ?? 0.5;
    (
      [
        [0, -0.75],
        [0.07, 0.75],
      ] as const
    ).forEach(([dt, pan], i) => {
      const s = t + dt;
      const p = panTo(ctx, out, pan);
      const n = noiseSrc(ctx, s, 0.2, 40 + i);
      const lp = filt(ctx, 'lowpass', 2000, 0.8);
      const ng = gainNode(ctx, 0);
      ad(ng.gain, s, 0.002, g, 0.1);
      n.connect(lp).connect(ng).connect(p);
      const th = osc(ctx, 'sine', 240, s, s + 0.2);
      th.frequency.exponentialRampToValueAtTime(55, s + 0.12);
      const tg = gainNode(ctx, 0);
      ad(tg.gain, s, 0.003, g * 0.8, 0.14);
      th.connect(tg).connect(p);
      const sp = noiseSrc(ctx, s + 0.02, 0.8, 50 + i);
      const hp = filt(ctx, 'highpass', 4500, 0.5);
      const sg = gainNode(ctx, 0);
      ad(sg.gain, s + 0.02, 0.03, g * 0.18, 0.6);
      sp.connect(hp).connect(sg).connect(p);
    });
  },
  applause(ctx, out, t, o) {
    const s = ctx.createBufferSource();
    s.buffer = applauseBuf(ctx);
    const g = gainNode(ctx, 0);
    g.gain.setValueAtTime(tiny, t);
    g.gain.exponentialRampToValueAtTime(o.gain ?? 0.5, t + 0.12);
    s.connect(g).connect(out);
    s.start(t);
  },
  /** היפוך קלף: "פוווט" וסגירה. */
  flip(ctx, out, t, o) {
    const g = o.gain ?? 0.38;
    const n = noiseSrc(ctx, t, 0.25, o.seed ?? 6);
    const bp = filt(ctx, 'bandpass', 700, 1.1);
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.exponentialRampToValueAtTime(5200, t + 0.15);
    const ng = gainNode(ctx, 0);
    ng.gain.setValueAtTime(tiny, t);
    ng.gain.exponentialRampToValueAtTime(g, t + 0.1);
    ng.gain.exponentialRampToValueAtTime(tiny, t + 0.19);
    n.connect(bp)
      .connect(ng)
      .connect(panTo(ctx, out, o.pan));
    const s = t + (o.snap ?? 0.17);
    const c = noiseSrc(ctx, s, 0.06, (o.seed ?? 6) + 2);
    const lp = filt(ctx, 'lowpass', 2600, 0.8);
    const cg = gainNode(ctx, 0);
    ad(cg.gain, s, 0.002, g * 1.1, 0.03);
    c.connect(lp)
      .connect(cg)
      .connect(panTo(ctx, out, o.pan));
    const th = osc(ctx, 'sine', 170, s, s + 0.12);
    th.frequency.exponentialRampToValueAtTime(85, s + 0.08);
    const tg = gainNode(ctx, 0);
    ad(tg.gain, s, 0.003, g * 0.7, 0.08);
    th.connect(tg).connect(panTo(ctx, out, o.pan));
  },
  /** צלצול מתכת של מדליה. */
  clink(ctx, out, t, o) {
    const g = o.gain ?? 0.22;
    const f0 = o.f ?? N.G6;
    const p = panTo(ctx, out, o.pan);
    for (const [dt, k] of [
      [0, 1],
      [0.11, 0.4],
    ] as const) {
      const s = t + dt;
      for (const [m, a, dec] of [
        [1, 1, 1.3],
        [2.72, 0.5, 0.65],
        [4.07, 0.32, 0.4],
        [5.86, 0.2, 0.25],
      ] as const) {
        const v = osc(ctx, 'sine', f0 * m, s, s + dec + 0.1);
        const vg = gainNode(ctx, 0);
        ad(vg.gain, s, 0.002, g * a * k, dec);
        v.connect(vg).connect(p);
      }
      const c = noiseSrc(ctx, s, 0.03, 70 + dt * 100);
      const hp = filt(ctx, 'highpass', 4000, 0.7);
      const cg = gainNode(ctx, 0);
      ad(cg.gain, s, 0.001, g * 0.5 * k, 0.012);
      c.connect(hp).connect(cg).connect(p);
    }
  },
  /** שיגור זיקוק — שריקה עולה. */
  launch(ctx, out, t, o) {
    const dur = o.dur ?? 0.65;
    const g = o.gain ?? 0.06;
    const p = panTo(ctx, out, o.pan);
    const v = osc(ctx, 'sine', 520, t, t + dur + 0.05);
    v.frequency.exponentialRampToValueAtTime(2500, t + dur);
    const lfo = osc(ctx, 'sine', 17, t, t + dur);
    const lg = gainNode(ctx, 35);
    lfo.connect(lg).connect(v.frequency);
    const vg = gainNode(ctx, 0);
    vg.gain.setValueAtTime(tiny, t);
    vg.gain.exponentialRampToValueAtTime(g, t + dur * 0.3);
    vg.gain.exponentialRampToValueAtTime(tiny, t + dur);
    v.connect(vg).connect(p);
    const n = noiseSrc(ctx, t, dur, o.seed ?? 8);
    const hp = filt(ctx, 'highpass', 5000, 0.6);
    const ng = gainNode(ctx, 0);
    ng.gain.setValueAtTime(tiny, t);
    ng.gain.exponentialRampToValueAtTime(g * 0.8, t + dur * 0.5);
    ng.gain.exponentialRampToValueAtTime(tiny, t + dur);
    n.connect(hp).connect(ng).connect(p);
  },
  /** פיצוץ זיקוק: בום ופצפוצים. */
  burst(ctx, out, t, o) {
    const g = o.gain ?? 0.55;
    const p = panTo(ctx, out, o.pan);
    const b = osc(ctx, 'sine', 100, t, t + 1.1);
    b.frequency.exponentialRampToValueAtTime(30, t + 0.9);
    const bg = gainNode(ctx, 0);
    ad(bg.gain, t, 0.005, g, 0.95);
    b.connect(bg).connect(p);
    const n = noiseSrc(ctx, t, 0.7, o.seed ?? 9);
    const lp = filt(ctx, 'lowpass', 1100, 0.7);
    const ng = gainNode(ctx, 0);
    ad(ng.gain, t, 0.003, g * 0.6, 0.55);
    n.connect(lp).connect(ng).connect(p);
    const c = ctx.createBufferSource();
    c.buffer = crackleBuf(ctx);
    const cg = gainNode(ctx, (o.crackle ?? 0.9) * g);
    c.connect(cg).connect(p);
    c.start(t + 0.08);
  },
};

export const CUE_NAMES = Object.keys(CUES) as CueName[];

/** מתזמן אפקט אחד. תקלה באפקט אחד לעולם אינה עוצרת את השאר. */
export function scheduleCue(
  ctx: BaseAudioContext,
  out: AudioNode,
  name: CueName,
  at: number,
  opts?: CueOpts,
): void {
  try {
    CUES[name](ctx, out, at, opts ?? {});
  } catch {
    /* סביבה בלי חלק מהיכולות — מדלגים על האפקט הזה */
  }
}

// ---------------------------------------------------------------------------
// ערוץ האפקטים
// ---------------------------------------------------------------------------

export interface EffectsBus {
  /** לכאן מתחברים האפקטים. */
  input: GainNode;
  /** עוצמה (ווליום המפעיל × WINNERS_FX_LEVEL). */
  master: GainNode;
  /** הצומת האחרון בשרשרת — ניתוק שלו משתיק הכול מיד. */
  output: GainNode;
}

/**
 * מדחס עדין ומגביל בסוף: האפקטים יחד (תיפוף + מצילה + תרועה + מחיאות) לא
 * יחרגו ויישמעו שבורים ברמקולים של אולם.
 */
export function makeEffectsBus(ctx: BaseAudioContext, dest: AudioNode, level: number): EffectsBus {
  const input = gainNode(ctx, 0.9);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 10;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.25;
  const master = gainNode(ctx, level);
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -4;
  lim.knee.value = 0;
  lim.ratio.value = 20;
  lim.attack.value = 0.002;
  lim.release.value = 0.12;
  // המדחס מוסיף הגברה אוטומטית, ולכן מורידים אחריו כדי שהשיא יישאר מתחת ל-0dB
  const output = gainNode(ctx, 0.78);
  input.connect(comp).connect(master).connect(lim).connect(output).connect(dest);
  return { input, master, output };
}

/** רמת ההנמכה (יחסית, 0–1) של מוזיקת הרקע s שניות אחרי תחילת ההנמכה. */
export function duckLevelAt(d: DuckSpec, s: number, from = 1): number {
  const attack = d.attack ?? 0.25;
  const release = d.release ?? 1.2;
  const t = s - d.at;
  if (t <= 0) return from;
  if (t < attack) return from + (d.level - from) * (t / attack);
  if (t < attack + d.hold) return d.level;
  const r = t - attack - d.hold;
  if (r < release) return d.level + (1 - d.level) * (r / release);
  return 1;
}

/** כמה זמן (שניות) ההנמכה נמשכת עד שהמוזיקה חוזרת לגמרי. */
export function duckEnd(d: DuckSpec): number {
  return d.at + (d.attack ?? 0.25) + d.hold + (d.release ?? 1.2);
}
