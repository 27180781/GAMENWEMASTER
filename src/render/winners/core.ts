/**
 * מסך המנצחים — ליבה משותפת לשלושת הסגנונות: צבעים, תנועה, אקראיות דטרמיניסטית
 * וחלקיקים. הכול נגזר מזמן t (שניות) בלבד, כך שאותו t תמיד מצייר אותה תמונה.
 *
 * אין כאן גישה ל-DOM בטעינת המודול (הבדיקות מייבאות את המסכים בסביבת node):
 * קנבס המדידה נוצר רק בקריאה הראשונה.
 */

export const W = 1920;
export const H = 1080;
/** כמה זמן (שניות) התיפוף לפני חשיפת המקום הראשון. */
export const SUSPENSE = 2.0;
export const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// מתמטיקה ותנועה
// ---------------------------------------------------------------------------

export const clamp = (v: number, a = 0, b = 1): number => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** התקדמות מנורמלת 0..1 של v בין a ל-b. */
export const prog = (v: number, a: number, b: number): number => clamp((v - a) / (b - a));

export const ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuart: (t: number) => 1 - Math.pow(1 - t, 4),
  inQuart: (t: number) => t * t * t * t,
  outExpo: (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  outBack: (t: number, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
  inBack: (t: number, s = 1.70158) => (s + 1) * t * t * t - s * t * t,
};

/** קפיץ מרוסן מ-0 ל-1 (עם חריגה מעל 1 ב-zeta קטן). */
export function spring(tau: number, omega = 12, zeta = 0.5): number {
  if (tau <= 0) return 0;
  if (zeta >= 1) return 1 - Math.exp(-omega * tau) * (1 + omega * tau);
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  return (
    1 -
    Math.exp(-zeta * omega * tau) *
      (Math.cos(wd * tau) + ((zeta * omega) / wd) * Math.sin(wd * tau))
  );
}

/** תנודה דועכת: A·e^(-kτ)·sin(ωτ+φ). */
export const wobble = (tau: number, A: number, k: number, w: number, phi = 0): number =>
  tau <= 0 ? 0 : A * Math.exp(-k * tau) * Math.sin(w * tau + phi);

// ---------------------------------------------------------------------------
// אקראיות דטרמיניסטית
// ---------------------------------------------------------------------------

export function hash(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// צבעים
// ---------------------------------------------------------------------------

export interface RGB {
  r: number;
  g: number;
  b: number;
}
interface HSL {
  h: number;
  s: number;
  l: number;
}

export function parseHex(hex: string): RGB | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3 || h.length === 4)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return null;
  const v = parseInt(h.slice(0, 6), 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

/** כמו parseHex, לצבעים קבועים בקוד (שתמיד תקינים). */
export function hexRgb(hex: string): RGB {
  return parseHex(hex) ?? { r: 0, g: 0, b: 0 };
}

function rgbToHsl({ r, g, b }: RGB): HSL {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): RGB {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export const rgba = (c: RGB, a = 1): string =>
  `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${+clamp(a).toFixed(3)})`;

export const toHex = (c: RGB): string =>
  '#' +
  [c.r, c.g, c.b]
    .map((v) =>
      Math.round(clamp(v, 0, 255))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');

export const mix = (a: RGB, b: RGB, t: number): RGB => ({
  r: lerp(a.r, b.r, t),
  g: lerp(a.g, b.g, t),
  b: lerp(a.b, b.b, t),
});

function relLum({ r, g, b }: RGB): number {
  const f = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a: RGB, b: RGB): number {
  const la = relLum(a);
  const lb = relLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const chroma = (hsl: HSL): number => hsl.s * (1 - Math.abs(2 * hsl.l - 1));
const hueDist = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

export interface Metal {
  hi: string;
  light: string;
  base: string;
  dark: string;
  deep: string;
  ink: string;
}

/** מתכות לשלושת המקומות הראשונים (אוניברסלי, לא תלוי בצבעי המשחק). */
export const METALS: { gold: Metal; silver: Metal; bronze: Metal } = {
  gold: {
    hi: '#FFF8D6',
    light: '#FFE27A',
    base: '#F4B92E',
    dark: '#B67C0C',
    deep: '#704600',
    ink: '#4F3200',
  },
  silver: {
    hi: '#FFFFFF',
    light: '#EEF2F7',
    base: '#C3CCD8',
    dark: '#828D9D',
    deep: '#4D5767',
    ink: '#353D49',
  },
  bronze: {
    hi: '#FFE6CC',
    light: '#F6B780',
    base: '#D2823F',
    dark: '#8F4F1D',
    deep: '#5A2B0A',
    ink: '#47220A',
  },
};

export interface Palette {
  M: RGB;
  S: RGB;
  deep: RGB;
  dark: RGB;
  mid: RGB;
  glow: RGB;
  soft: RGB;
  accent: RGB;
  gold: RGB;
  white: RGB;
  plate: RGB;
  plateText: RGB;
  plateHi: RGB;
  plateLo: RGB;
  plateSide: RGB;
  /** לוח בהיר (מילוי לבן או פסטל): כיתובים בצבע מתכת עוברים לגוון הכהה שלה. */
  plateLight: boolean;
  champ: RGB;
  champText: RGB;
  champHi: RGB;
  champLo: RGB;
  scoreInk: RGB;
  steel: Metal;
  confetti: RGB[];
  /** "r,g,b" של glow — לצללים שקופים ב-CSS. */
  glowA: string;
  metal(rank: number): Metal;
  vars(): Record<string, string>;
}

/**
 * הפלטה של המסך — נגזרת ישירות משני צבעי המשחק:
 *   mainColor  = מילוי התיבות במשחק → כאן מילוי הלוחות, והגוון של כל הרקע.
 *   secondaryColor = הטקסט על התיבות → כאן הטקסט על הלוחות.
 * במקום הראשון הם מתחלפים, כמו בתשובה הנכונה במשחק.
 */
export function makePalette(mainHex: string, secHex: string): Palette {
  const M = parseHex(mainHex) ?? hexRgb('#30034A');
  const S = parseHex(secHex) ?? hexRgb('#FFFFFF');
  const hm = rgbToHsl(M);
  const hs = rgbToHsl(S);
  // הגוון של הרקע: מהצבע הראשי, אלא אם הוא אפור/לבן/שחור — אז מהמשני, ואם גם
  // הוא אפור — כחול-לילה ניטרלי.
  let src: HSL;
  if (chroma(hm) >= 0.1) src = hm;
  else if (chroma(hs) >= 0.1) src = hs;
  else src = { h: 226, s: 0.42, l: 0.3 };
  const hue = src.h;
  const sat = src.s;
  const C = (s: number, l: number) => hslToRgb(hue, clamp(s, 0, 1), l);
  const deep = C(clamp(sat * 0.85, 0.32, 0.8), 0.055);
  const dark = C(clamp(sat * 0.9, 0.36, 0.85), 0.12);
  const mid = C(clamp(sat, 0.42, 0.9), 0.24);
  const glow = C(clamp(sat * 1.1, 0.62, 1), 0.6);
  const soft = C(clamp(sat, 0.5, 0.95), 0.82);
  const gold = hexRgb(METALS.gold.base);
  const accent = chroma(hs) >= 0.2 && hueDist(hs.h, hue) > 28 ? S : gold;

  // הלוחות — לפי כלל המשחק: מילוי = ראשי, טקסט = משני.
  const plate = { r: M.r, g: M.g, b: M.b };
  let plateText = { r: S.r, g: S.g, b: S.b };
  if (contrast(plate, plateText) < 2.4)
    plateText = relLum(plate) > 0.4 ? hexRgb('#141414') : hexRgb('#FFFFFF');
  const hp = rgbToHsl(plate);
  const shade = (c: RGB, dl: number) => {
    const h = rgbToHsl(c);
    return hslToRgb(h.h, h.s, clamp(h.l + dl, 0.02, 0.97));
  };
  const plateHi = shade(plate, hp.l > 0.85 ? -0.02 : 0.1);
  const plateLo = shade(plate, hp.l > 0.85 ? -0.12 : -0.1);
  const plateSide = shade(plate, hp.l > 0.85 ? -0.2 : -0.17);

  // המקום הראשון — הצבעים מתחלפים (כמו בתשובה הנכונה).
  let champ = { r: S.r, g: S.g, b: S.b };
  let champText = { r: M.r, g: M.g, b: M.b };
  if (contrast(champ, champText) < 2.4) {
    champ = hexRgb(METALS.gold.light);
    champText = hexRgb('#3A2400');
  }
  const champL = rgbToHsl(champ).l;
  const champHi = shade(champ, champL > 0.85 ? 0 : 0.1);
  const champLo = shade(champ, champL > 0.85 ? -0.13 : -0.1);
  // מספר הניקוד: הדגשה על הלוח (צבע ההדגשה אם הוא קריא, אחרת הטקסט).
  const scoreInk = contrast(plate, accent) >= 2.6 ? accent : plateText;

  // מתכת "פלדה" למקומות 4 ומטה — בגוון של המשחק.
  const steelBase = mix(glow, hexRgb('#8C96A6'), 0.5);
  const black = hexRgb('#000000');
  const white = { r: 255, g: 255, b: 255 };
  const steel: Metal = {
    hi: '#FFFFFF',
    light: toHex(mix(steelBase, white, 0.65)),
    base: toHex(steelBase),
    dark: toHex(mix(steelBase, black, 0.4)),
    deep: toHex(mix(steelBase, black, 0.65)),
    ink: toHex(mix(steelBase, black, 0.72)),
  };

  const confetti = [
    glow,
    accent,
    gold,
    white,
    soft,
    mix(glow, accent, 0.5),
    hexRgb(METALS.gold.light),
  ];
  const glowA = `${Math.round(glow.r)},${Math.round(glow.g)},${Math.round(glow.b)}`;
  return {
    M,
    S,
    deep,
    dark,
    mid,
    glow,
    soft,
    accent,
    gold,
    white,
    plate,
    plateText,
    plateHi,
    plateLo,
    plateSide,
    plateLight: relLum(plate) > 0.45,
    champ,
    champText,
    champHi,
    champLo,
    scoreInk,
    steel,
    confetti,
    glowA,
    metal(rank: number): Metal {
      return rank === 1
        ? METALS.gold
        : rank === 2
          ? METALS.silver
          : rank === 3
            ? METALS.bronze
            : steel;
    },
    vars(): Record<string, string> {
      return {
        '--deep': rgba(deep),
        '--dark': rgba(dark),
        '--mid': rgba(mid),
        '--glow': rgba(glow),
        '--glow-a': glowA,
        '--soft': rgba(soft),
        '--accent': rgba(accent),
        '--plate': rgba(plate),
        '--plate-hi': rgba(plateHi),
        '--plate-lo': rgba(plateLo),
        '--plate-side': rgba(plateSide),
        '--plate-text': rgba(plateText),
        '--champ': rgba(champ),
        '--champ-hi': rgba(champHi),
        '--champ-lo': rgba(champLo),
        '--champ-text': rgba(champText),
        '--score-ink': rgba(scoreInk),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// סידור: מקום 1 באמצע, 2 משמאלו, 3 מימינו, 4 משמאל ל-2... (כמו תמיד: 4·2·1·3·5)
// ---------------------------------------------------------------------------

export function rowOrder(n: number): number[] {
  const left: number[] = [];
  const right: number[] = [];
  for (let r = 2; r <= n; r++) (r % 2 === 0 ? left : right).push(r);
  return [...left.reverse(), 1, ...right];
}

/** מרחק המקום מהמרכז (0 למקום 1, 1 ל-2/3, 2 ל-4/5...). */
export const ringOf = (rank: number): number => Math.floor(rank / 2);

const PLACE_WORDS = [
  '',
  'ראשון',
  'שני',
  'שלישי',
  'רביעי',
  'חמישי',
  'שישי',
  'שביעי',
  'שמיני',
  'תשיעי',
  'עשירי',
];
export const placeLabel = (rank: number): string => `מקום ${PLACE_WORDS[rank] ?? String(rank)}`;

export const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

// ---------------------------------------------------------------------------
// התאמת טקסט: גודל הגופן הגדול ביותר (עד max) שבו השם נכנס ברוחב.
// ---------------------------------------------------------------------------

let measureCtx: CanvasRenderingContext2D | null | undefined;

function textWidth(text: string, size: number, family: string): number {
  if (measureCtx === undefined) {
    measureCtx =
      typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }
  if (measureCtx === null) return text.length * size * 0.55;
  measureCtx.font = `700 ${size}px ${family}`;
  return measureCtx.measureText(text).width;
}

export function fitSize(
  text: string,
  width: number,
  max: number,
  min: number,
  family: string,
): number {
  const w = textWidth(text, max, family);
  if (w <= width) return max;
  return Math.max(min, Math.floor((max * width) / w));
}

export interface FitResult {
  size: number;
  lines: 1 | 2;
  /** הטקסט להצגה (בשתי שורות — עם ירידת שורה במקום הפיצול). */
  text: string;
}

/** שם ארוך: שורה אחת אם נכנס ב-72% מהגודל, אחרת שתי שורות בגודל המתאים. */
export function fitName(
  text: string,
  width: number,
  max: number,
  min: number,
  family: string,
): FitResult {
  const trimmed = text.trim();
  const one = fitSize(trimmed, width, max, min, family);
  if (one >= max * 0.72 || !/\s/.test(trimmed)) return { size: one, lines: 1, text: trimmed };
  // שתי שורות — מפצלים בכל אחד מהרווחים ובוחרים את הפיצול עם הגופן הגדול ביותר
  const words = trimmed.split(/\s+/);
  let best: FitResult | null = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const s = Math.min(fitSize(a, width, max, min, family), fitSize(b, width, max, min, family));
    if (best === null || s > best.size) best = { size: s, lines: 2, text: `${a}\n${b}` };
  }
  // שורה אחת שנתקעה במינימום גולשת מהמסגרת, ולכן שתי שורות עדיפות גם באותו גודל
  if (best !== null && (best.size > one * 1.15 || (one <= min && best.size >= one))) return best;
  return { size: one, lines: 1, text: trimmed };
}

// ---------------------------------------------------------------------------
// חלקיקים — כל חלקיק מחושב אנליטית מזמן הפליטה (בלי סימולציה מצטברת).
// ---------------------------------------------------------------------------

/** מיקום בזריקה עם גרר (k) וכבידה (g, למטה חיובי). */
export function ballistic(
  x0: number,
  y0: number,
  vx: number,
  vy: number,
  g: number,
  k: number,
  t: number,
): [number, number] {
  if (k < 1e-4) return [x0 + vx * t, y0 + vy * t + 0.5 * g * t * t];
  const e = 1 - Math.exp(-k * t);
  return [x0 + (vx / k) * e, y0 + ((vy - g / k) / k) * e + (g / k) * t];
}

export interface Burst {
  t0: number;
  seed: number;
  n: number;
  x: number;
  y: number;
  /** פיזור מקום ההתחלה (רוחב/גובה). */
  w?: number;
  h?: number;
  /** כיוון ברדיאנים (‎-π/2 = למעלה). */
  angle: number;
  spread: number;
  speed: [number, number];
  g: number;
  k: number;
  life: [number, number];
  /** פיזור זמני הפליטה (שניות). */
  delay?: number;
}

export interface ConfettiBurst extends Burst {
  size: number;
}

export interface SparkBurst extends Burst {
  width: number;
  trail?: number;
  twinkle?: boolean;
}

const pick = <T>(list: readonly T[], r: number): T =>
  list[Math.min(list.length - 1, Math.floor(r * list.length))]!;

/** קונפטי. q = יחס הרזולוציה של הקנבס (כל הקואורדינטות לוגיות, 1920×1080). */
export function drawConfetti(
  ctx: CanvasRenderingContext2D,
  burst: ConfettiBurst,
  t: number,
  colors: readonly RGB[],
  q: number,
): void {
  const age0 = t - burst.t0;
  if (age0 < 0) return;
  const R = rng(burst.seed);
  ctx.save();
  for (let i = 0; i < burst.n; i++) {
    const delay = R() * (burst.delay ?? 0);
    const ang = burst.angle + (R() - 0.5) * burst.spread;
    const sp = lerp(burst.speed[0], burst.speed[1], R());
    const life = lerp(burst.life[0], burst.life[1], R());
    const w = burst.size * (0.7 + R() * 0.8);
    const h = w * (0.45 + R() * 0.35);
    const spin = (R() - 0.5) * 14;
    const flip = 4 + R() * 9;
    const flutA = 10 + R() * 34;
    const flutW = 2 + R() * 3;
    const ph = R() * TAU;
    const col = pick(colors, R());
    const ox = burst.x + (R() - 0.5) * (burst.w ?? 0);
    const oy = burst.y + (R() - 0.5) * (burst.h ?? 0);
    const age = age0 - delay;
    if (age < 0 || age > life) continue;
    const [bx, y] = ballistic(
      ox,
      oy,
      Math.cos(ang) * sp,
      Math.sin(ang) * sp,
      burst.g,
      burst.k,
      age,
    );
    const x = bx + Math.sin(age * flutW + ph) * flutA * clamp(age * 1.5);
    if (y > H + 40 || x < -60 || x > W + 60) continue;
    const a = clamp((life - age) / 0.6) * clamp(age / 0.05);
    const rot = ph + spin * age;
    const f = Math.cos(ph + flip * age);
    const shadeK = 0.55 + 0.45 * Math.abs(f);
    ctx.globalAlpha = a;
    ctx.fillStyle = rgba({ r: col.r * shadeK, g: col.g * shadeK, b: col.b * shadeK });
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    ctx.setTransform(c * q, s * q, -s * f * q, c * f * q, x * q, y * q);
    ctx.fillRect(-w / 2, -h / 2, w, h);
  }
  ctx.restore();
  ctx.setTransform(q, 0, 0, q, 0, 0);
}

/** ניצוצות (קווים קצרים לאורך התנועה), במצב 'lighter'. */
export function drawSparks(
  ctx: CanvasRenderingContext2D,
  burst: SparkBurst,
  t: number,
  colors: readonly RGB[],
): void {
  const age0 = t - burst.t0;
  if (age0 < 0 || age0 > burst.life[1] + (burst.delay ?? 0) + 0.1) return;
  const R = rng(burst.seed);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (let i = 0; i < burst.n; i++) {
    const delay = R() * (burst.delay ?? 0);
    const ang = burst.angle + (R() - 0.5) * burst.spread;
    const sp = lerp(burst.speed[0], burst.speed[1], R());
    const life = lerp(burst.life[0], burst.life[1], R());
    const col = pick(colors, R());
    const wid = burst.width * (0.6 + R() * 0.8);
    const tw = R() * TAU;
    const age = age0 - delay;
    if (age < 0 || age > life) continue;
    const vx = Math.cos(ang) * sp;
    const vy = Math.sin(ang) * sp;
    const [x, y] = ballistic(burst.x, burst.y, vx, vy, burst.g, burst.k, age);
    const [px, py] = ballistic(
      burst.x,
      burst.y,
      vx,
      vy,
      burst.g,
      burst.k,
      Math.max(0, age - (burst.trail ?? 0.05)),
    );
    let a = Math.pow(1 - age / life, 1.3);
    if (burst.twinkle === true && age > life * 0.45)
      a *= 0.35 + 0.65 * Math.abs(Math.sin(age * 38 + tw));
    ctx.globalAlpha = clamp(a);
    ctx.strokeStyle = rgba(col);
    ctx.lineWidth = wid;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  ctx.restore();
}

/** כוכב בעל 4 קרניים (נצנוץ). */
export function star4(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  a: number,
): void {
  ctx.globalAlpha = a;
  ctx.fillStyle = color;
  ctx.beginPath();
  const k = r * 0.18;
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + k, y - k, x + r, y);
  ctx.quadraticCurveTo(x + k, y + k, x, y + r);
  ctx.quadraticCurveTo(x - k, y + k, x - r, y);
  ctx.quadraticCurveTo(x - k, y - k, x, y - r);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// עיטורים (SVG). המזהים הפנימיים ייחודיים לכל מופע — בגלריה מוצגים כמה מסכים יחד.
// ---------------------------------------------------------------------------

/** כתר — זהב עם אבני חן בצבעי המשחק. */
export function crownSvg(pal: Palette, id: string): string {
  const g = METALS.gold;
  const gem1 = rgba(pal.glow);
  const gem2 = rgba(pal.accent);
  return `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient id="cg${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${g.hi}"/><stop offset=".35" stop-color="${g.light}"/>
        <stop offset=".7" stop-color="${g.base}"/><stop offset="1" stop-color="${g.dark}"/>
      </linearGradient>
      <linearGradient id="cb${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${g.light}"/><stop offset="1" stop-color="${g.dark}"/>
      </linearGradient>
    </defs>
    <path d="M18 112 L8 34 L56 74 L100 10 L144 74 L192 34 L182 112 Z" fill="url(#cg${id})" stroke="${g.deep}" stroke-width="4" stroke-linejoin="round"/>
    <rect x="16" y="106" width="168" height="26" rx="8" fill="url(#cb${id})" stroke="${g.deep}" stroke-width="4"/>
    <circle cx="8" cy="32" r="9" fill="${g.light}" stroke="${g.deep}" stroke-width="3"/>
    <circle cx="100" cy="9" r="10" fill="${g.light}" stroke="${g.deep}" stroke-width="3"/>
    <circle cx="192" cy="32" r="9" fill="${g.light}" stroke="${g.deep}" stroke-width="3"/>
    <circle cx="100" cy="119" r="8" fill="${gem1}" stroke="${g.deep}" stroke-width="2.5"/>
    <circle cx="58" cy="119" r="6" fill="${gem2}" stroke="${g.deep}" stroke-width="2.5"/>
    <circle cx="142" cy="119" r="6" fill="${gem2}" stroke="${g.deep}" stroke-width="2.5"/>
    <path d="M100 40 L112 72 L100 92 L88 72 Z" fill="${gem1}" stroke="${g.deep}" stroke-width="2.5"/>
    <path d="M30 50 L40 92" stroke="${g.hi}" stroke-width="5" stroke-linecap="round" opacity=".7"/>
  </svg>`;
}

/** כוכב חמש קצוות לעיטורים. */
export const starSvg = (fill: string, stroke: string): string =>
  `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 4 L62 37 L97 38 L69 59 L79 93 L50 73 L21 93 L31 59 L3 38 L38 37 Z" fill="${fill}" stroke="${stroke}" stroke-width="5" stroke-linejoin="round"/></svg>`;
