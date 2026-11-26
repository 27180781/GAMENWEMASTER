/**
 * מסך המנצחים — מצב ההצגה (מה נחשף ומתי), רכיבי DOM משותפים לשלושת הסגנונות,
 * וחישובי האפקטים המשותפים (הבזק, רעידה).
 *
 * החשיפה כמו במנוע: רווח חושף מקום אחד, מהאחרון לראשון; אחורה מסתיר. כל הזמנים
 * בשניות (performance.now()/1000), וכל סגנון מצייר את עצמו מהזמן בלבד.
 */

import { railInitial } from '../avatar.ts';
import type { SoundPlan } from '../../app/winnersSynth.ts';
import { fitName, fmt, H, SUSPENSE, W, wobble, type Palette } from './core.ts';

export interface ShowWinner {
  name: string;
  score: number;
  /** 1 = המקום הראשון. */
  rank: number;
}

export class Show {
  readonly n: number;
  readonly winners: readonly ShowWinner[];
  readonly pal: Palette;
  readonly title: string;
  /** מתי כל מקום נחשף (שניות). */
  readonly revealT: Record<number, number> = {};
  /** מתי כל מקום הוסתר (אחורה). */
  readonly hideT: Record<number, number> = {};
  /** כמה מקומות חשופים. */
  k = 0;
  /** מתי המסך נכנס. */
  enterT = 0;
  /** «הכול יחד» (שקופית מסך באמצע המשחק): בלי תיפוף ובלי מתח. */
  instant = false;

  constructor(winners: readonly { name: string; score: number }[], pal: Palette, title: string) {
    this.winners = winners.map((w, i) => ({ name: w.name, score: w.score, rank: i + 1 }));
    this.n = this.winners.length;
    this.pal = pal;
    this.title = title;
  }

  winner(rank: number): ShowWinner {
    return this.winners[rank - 1] ?? { name: '', score: 0, rank };
  }

  /** המקום שייחשף ברווח הבא (null כשכולם חשופים). */
  get nextRank(): number | null {
    return this.k < this.n ? this.n - this.k : null;
  }

  next(t: number): number | null {
    if (this.k >= this.n) return null;
    this.instant = false;
    const rank = this.n - this.k;
    this.k += 1;
    this.revealT[rank] = t;
    delete this.hideT[rank];
    return rank;
  }

  back(t: number): number | null {
    if (this.k === 0) return null;
    const rank = this.n - this.k + 1;
    this.k -= 1;
    delete this.revealT[rank];
    this.hideT[rank] = t;
    return rank;
  }

  /** כמו שקופית «מסך מנצחים» באמצע משחק: כולם יחד, בלי תיפוף. */
  all(t: number): void {
    this.instant = true;
    for (let r = this.n; r >= 1; r--) {
      if (this.revealT[r] !== undefined) continue;
      this.revealT[r] = t + (this.n - r) * 0.16;
      delete this.hideT[r];
    }
    this.k = this.n;
  }
}

// ---------------------------------------------------------------------------
// מצב החשיפה של מקום בזמן t
// ---------------------------------------------------------------------------

export interface RankPhase {
  /** האם המקום חשוף כרגע (או בתיפוף לקראת חשיפה). */
  on: boolean;
  /** שניות מאז שהמנחה לחץ על החשיפה (‎-1 אם מוסתר). */
  tau: number;
  /** שניות מאז החשיפה החזותית (במקום 1 — אחרי התיפוף). */
  vis: number;
  /** שניות מאז שהוסתר (Infinity אם לא הוסתר). */
  out: number;
}

export function rankPhase(show: Show, rank: number, t: number): RankPhase {
  const rt = show.revealT[rank];
  const ht = show.hideT[rank];
  const susp = rank === 1 && !show.instant ? SUSPENSE : 0;
  if (rt !== undefined) {
    const tau = t - rt;
    return { on: true, tau, vis: tau - susp, out: Infinity };
  }
  return { on: false, tau: -1, vis: -1, out: ht !== undefined ? t - ht : Infinity };
}

/** הבזק לבן — הערך הגבוה מבין כל החשיפות שבתהליך. */
export function flashAlpha(
  show: Show,
  t: number,
  peakChamp = 0.85,
  peakOther = 0.22,
  otherAt = 0,
): number {
  let a = 0;
  for (let r = 1; r <= show.n; r++) {
    const ph = rankPhase(show, r, t);
    if (!ph.on) continue;
    const v = r === 1 ? ph.vis : ph.vis - otherAt;
    if (v < 0 || v > 1.2) continue;
    const peak = r === 1 && !show.instant ? peakChamp : show.instant ? 0.3 : peakOther;
    a = Math.max(a, peak * Math.exp(-v * (r === 1 ? 4.5 : 8)));
  }
  return a;
}

/** רעידת מצלמה קצרה בכל נחיתה. */
export function shake(show: Show, t: number, impactAt: number): [number, number] {
  let x = 0;
  let y = 0;
  for (let r = 1; r <= show.n; r++) {
    const ph = rankPhase(show, r, t);
    if (!ph.on) continue;
    const v = ph.vis - (r === 1 && !show.instant ? 0 : impactAt);
    if (v < 0 || v > 0.6) continue;
    const amp = r === 1 && !show.instant ? 11 : 4;
    x += wobble(v, amp, 7, 47);
    y += wobble(v, amp * 0.8, 7, 61, 1.3);
  }
  return [x, y];
}

// ---------------------------------------------------------------------------
// סגנון — מה שכל אחד משלושת הסגנונות מממש
// ---------------------------------------------------------------------------

export interface ConceptEnv {
  /** יחס הרזולוציה של הקנבסים (1 = 1920×1080 מלא). */
  q: number;
  /** הגופן שהמסך מוצג בו בפועל (ערכת הנושא) — למדידת השמות. */
  family: string;
  /** מזהה ייחודי למופע (למזהי SVG פנימיים). */
  uid: string;
}

export interface ConceptScene {
  frame(t: number): void;
  destroy(): void;
}

export interface ConceptSound {
  enter?(n: number): SoundPlan;
  reveal(rank: number, n: number): SoundPlan;
  champion(n: number): SoundPlan;
  all(n: number): SoundPlan;
}

export interface Concept {
  create(root: HTMLElement, show: Show, env: ConceptEnv): ConceptScene;
  sound: ConceptSound;
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  parent?: Element | null,
  html?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls !== '') e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

export interface Layer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/**
 * קנבס בגודל הבמה (1920×1080 ב-CSS) ברזולוציה q. הקואורדינטות תמיד לוגיות:
 * הטרנספורם הבסיסי של ההקשר הוא scale(q).
 */
export function layer(parent: Element, cls: string, q: number): Layer {
  const canvas = el('canvas', cls, parent);
  canvas.width = Math.max(1, Math.round(W * q));
  canvas.height = Math.max(1, Math.round(H * q));
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('canvas 2d unavailable');
  ctx.setTransform(q, 0, 0, q, 0, 0);
  return { canvas, ctx };
}

/** קנבס מחוץ למסמך (לשכבות קבועות שמצוירות פעם אחת). */
export function offscreen(width: number, height: number): Layer {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('canvas 2d unavailable');
  return { canvas, ctx };
}

const styleCache = new WeakMap<HTMLElement, Map<string, string>>();

/** קובע style רק כשהערך השתנה (חוסך עבודה לדפדפן בכל פריים). */
export function css(e: HTMLElement, prop: string, value: string): void {
  let cache = styleCache.get(e);
  if (cache === undefined) {
    cache = new Map();
    styleCache.set(e, cache);
  }
  if (cache.get(prop) === value) return;
  cache.set(prop, value);
  e.style.setProperty(prop, value);
}

/** משתני המתכת של מקום (זהב / כסף / ארד / פלדה בגוון המשחק) על אלמנט. */
export function metalVars(e: HTMLElement, pal: Palette, rank: number): void {
  const m = pal.metal(rank);
  e.style.setProperty('--m-hi', m.hi);
  e.style.setProperty('--m-light', m.light);
  e.style.setProperty('--m-base', m.base);
  e.style.setProperty('--m-dark', m.dark);
  e.style.setProperty('--m-deep', m.deep);
  e.style.setProperty('--m-ink', m.ink);
}

export function applyPalette(root: HTMLElement, pal: Palette): void {
  const v = pal.vars();
  for (const k of Object.keys(v)) root.style.setProperty(k, v[k]!);
  root.dataset['plate'] = pal.plateLight ? 'light' : 'dark';
}

/** אווטאר: טבעת מתכת ואות ראשונה, כמו בפס השמות של המנוע. */
export function avatar(parent: Element, name: string, size: number, extraCls = ''): HTMLDivElement {
  const a = el('div', extraCls === '' ? 'ws-av' : `ws-av ${extraCls}`, parent);
  a.style.width = `${size}px`;
  a.style.height = `${size}px`;
  const i = el('i', '', a);
  i.textContent = railInitial(name);
  i.style.fontSize = `${Math.round(size * 0.46)}px`;
  return a;
}

/** שם שמותאם לרוחב (שורה אחת, או שתיים בשם ארוך). */
export function nameEl(
  parent: Element,
  cls: string,
  text: string,
  width: number,
  max: number,
  min: number,
  family: string,
): HTMLDivElement {
  const f = fitName(text, width, max, min, family);
  const e = el('div', cls, parent);
  e.textContent = f.text;
  e.style.fontSize = `${f.size}px`;
  return e;
}

export interface ScoreView {
  e: HTMLDivElement;
  b: HTMLElement;
  last: string | null;
}

export function scoreEl(parent: Element, cls: string): ScoreView {
  const e = el('div', cls, parent);
  const b = el('b', '', e);
  b.textContent = '0';
  const small = el('small', '', e);
  small.textContent = 'נק׳';
  return { e, b, last: null };
}

export function setScore(s: ScoreView, value: number): void {
  const txt = fmt(value);
  if (s.last !== txt) {
    s.b.textContent = txt;
    s.last = txt;
  }
}

/** הכותרת: שם המשחק (קטן) ו«המנצחים». */
export function titleEl(parent: Element, show: Show, cls = ''): HTMLDivElement {
  const t = el('div', cls === '' ? 'ws-title' : `ws-title ${cls}`, parent);
  if (show.title.trim() !== '') {
    const eyebrow = el('div', 'ws-eyebrow', t);
    eyebrow.textContent = show.title;
  }
  const h = el('div', 'ws-h1', t);
  el('span', 'ws-orn', h, '<i></i><b></b>');
  const text = el('span', 'ws-h1-text', h);
  text.textContent = 'המנצחים';
  el('span', 'ws-orn ws-orn-r', h, '<b></b><i></i>');
  return t;
}
