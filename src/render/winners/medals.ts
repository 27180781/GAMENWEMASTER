/**
 * «טקס המדליות» — מדליות יורדות על סרטים בפסים של צבעי המשחק, מסתובבות,
 * מתנדנדות ונעצרות; מתחתיהן נפרש סרט עם השם. זיקוקים בשמי לילה.
 * הכללים ב-winners.css (.md-*).
 */

import {
  clamp,
  drawConfetti,
  drawSparks,
  ease as E,
  fitName,
  hexRgb,
  lerp,
  METALS,
  mix,
  placeLabel,
  prog,
  rgba,
  ringOf,
  rng,
  rowOrder,
  star4,
  starSvg,
  SUSPENSE,
  TAU,
  wobble,
  type Palette,
  type RGB,
} from './core.ts';
import {
  applyPalette,
  css,
  el,
  flashAlpha,
  layer,
  metalVars,
  offscreen,
  rankPhase,
  scoreEl,
  setScore,
  shake,
  titleEl,
  type Concept,
  type ConceptEnv,
  type RankPhase,
  type ScoreView,
  type Show,
} from './show.ts';
import { NOTES, type SoundCue } from '../../app/winnersSynth.ts';

const SPACING = [0, 0, 540, 480, 410, 352];
const DIAM = { champ: [0, 320, 310, 300, 270, 250], other: [0, 0, 236, 228, 208, 190] };
const CY = [0, 430, 474, 506];

const f1 = (v: number): string => v.toFixed(1);

/** סרט V: שתי רצועות בפסים ראשי-משני-ראשי, מהתקרה עד הטבעת. */
function ribbonSvg(D: number, pal: Palette, id: string): { W: number; L: number; html: string } {
  const L = 1100;
  const sw = D * 0.26;
  const sep = D * 0.62;
  const M = rgba(pal.M);
  const S = rgba(pal.S);
  const W = sep + sw * 2 + 40;
  const ox = W / 2;
  const oy = L;
  const pts = (list: readonly (readonly [number, number])[]): string =>
    list.map((p) => `${f1(p[0])},${f1(p[1])}`).join(' ');
  const strap = (side: number): string => {
    const tx = (side * sep) / 2;
    const bx = side * sw * 0.18;
    const A0 = [ox + tx - sw / 2, 0] as const;
    const B0 = [ox + tx + sw / 2, 0] as const;
    const A1 = [ox + bx - sw * 0.42, oy] as const;
    const B1 = [ox + bx + sw * 0.42, oy] as const;
    const P = (f: number, top: boolean): [number, number] => {
      const a = top ? A0 : A1;
      const b = top ? B0 : B1;
      return [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
    };
    const quad = (fa: number, fb: number, fill: string): string =>
      `<polygon points="${pts([P(fa, true), P(fb, true), P(fb, false), P(fa, false)])}" fill="${fill}"/>`;
    const all = pts([A0, B0, B1, A1]);
    return (
      quad(0, 0.3, M) +
      quad(0.3, 0.7, S) +
      quad(0.7, 1, M) +
      `<polygon points="${all}" fill="url(#rs${id}${side > 0 ? 'r' : 'l'})"/>` +
      `<polygon points="${all}" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="2"/>`
    );
  };
  const grad = (
    side: number,
  ): string => `<linearGradient id="rs${id}${side > 0 ? 'r' : 'l'}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#000" stop-opacity=".35"/><stop offset=".35" stop-color="#fff" stop-opacity=".18"/>
      <stop offset=".55" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#000" stop-opacity=".4"/></linearGradient>`;
  return {
    W,
    L,
    html: `<svg width="${W.toFixed(0)}" height="${L}" viewBox="0 0 ${f1(W)} ${L}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>${grad(-1)}${grad(1)}</defs>${strap(-1)}${strap(1)}</svg>`,
  };
}

/** זר דפנה מוזהב סביב מדליית המקום הראשון. */
function laurelSvg(D: number, id: string): { S: number; html: string } {
  const S = D * 1.5;
  const c = S / 2;
  const r = D * 0.6;
  let leaves = '';
  for (const side of [-1, 1]) {
    for (let k = 0; k < 11; k++) {
      const a = (100 + k * 15) * (Math.PI / 180);
      const x = c + side * Math.sin(a) * r;
      const y = c - Math.cos(a) * r;
      const rot = side * (180 - (100 + k * 15));
      const sz = D * (0.085 - k * 0.0028);
      leaves += `<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="${f1(sz * 0.48)}" ry="${f1(sz)}" transform="rotate(${f1(rot + side * 28)} ${f1(x)} ${f1(y)})" fill="url(#lg${id})" stroke="#704600" stroke-width="2"/>`;
      const x2 = c + side * Math.sin(a + 0.07) * (r + sz * 0.9);
      const y2 = c - Math.cos(a + 0.07) * (r + sz * 0.9);
      leaves += `<ellipse cx="${f1(x2)}" cy="${f1(y2)}" rx="${f1(sz * 0.42)}" ry="${f1(sz * 0.9)}" transform="rotate(${f1(rot - side * 32)} ${f1(x2)} ${f1(y2)})" fill="url(#lg${id})" stroke="#704600" stroke-width="2"/>`;
    }
  }
  return {
    S,
    html: `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" aria-hidden="true"><defs><linearGradient id="lg${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF3B8"/><stop offset=".45" stop-color="#F4B92E"/><stop offset="1" stop-color="#9A6406"/></linearGradient></defs>${leaves}</svg>`,
  };
}

interface Item {
  rank: number;
  idx: number;
  cx: number;
  cy: number;
  D: number;
  ph: HTMLDivElement;
  col: HTMLDivElement;
  medal: HTMLDivElement;
  shine: HTMLDivElement;
  shine2: HTMLDivElement;
  banner: HTMLDivElement;
  bh: number;
  bannerY: number;
  score: ScoreView;
  metalLight: RGB;
}

interface MedalState {
  ph: RankPhase;
  on: boolean;
  /** הזזה אנכית מהמקום (נפילה מלמעלה). */
  dy: number;
  spin: number;
  swing: number;
  /** שניות מאז שהסרט עם השם התחיל להיפרש (‎-1 = נאסף). */
  banner: number;
  score: number;
  impact: number;
  /** שקיפות המקום השמור. */
  phA: number;
  /** התקדמות התיפוף (0–1) לפני שהמדליה של המקום הראשון יורדת. */
  susp: number;
  out: boolean;
}

type Volley = readonly [dt: number, x: number, y: number, scale: number];
const VOLLEY: readonly Volley[] = [
  [0.05, 960, 250, 1.25],
  [0.32, 470, 230, 1],
  [0.5, 1450, 210, 1],
  [0.9, 720, 150, 0.9],
  [1.1, 1220, 170, 0.95],
  [1.6, 960, 120, 1.1],
  [2.2, 380, 190, 0.9],
  [2.45, 1540, 170, 0.9],
];

function create(root: HTMLElement, show: Show, env: ConceptEnv) {
  const { pal, n } = show;
  const { q, family, uid } = env;
  root.classList.add('md-root');
  applyPalette(root, pal);
  const shakeEl = el('div', 'md-shake', root);
  const bg = layer(shakeEl, 'md-bg', q);
  const fw = layer(shakeEl, 'md-fw', q);
  const under = el('div', 'md-layer', shakeEl);
  const front = el('div', 'md-layer', shakeEl);
  const title = titleEl(shakeEl, show, 'md-title');
  const fx = layer(shakeEl, 'md-fx', q);
  const flash = el('div', 'md-flash', root);
  const bctx = bg.ctx;
  const wctx = fw.ctx;
  const fctx = fx.ctx;

  // ----------------------------------------------------------- סידור
  const order = rowOrder(n);
  const spacing = SPACING[n] ?? SPACING[5]!;
  const items: Item[] = [];
  const byRank: Item[] = [];
  const rays = order.includes(1) ? el('div', 'md-rays', under) : null;

  order.forEach((rank, idx) => {
    const cx = 960 + (idx - (n - 1) / 2) * spacing;
    const big = rank === 1;
    const D = (big ? DIAM.champ[n] : DIAM.other[n]) ?? DIAM.other[5]!;
    const cy = CY[Math.min(3, big ? 1 : ringOf(rank) + 1)]!;
    const winner = show.winner(rank);
    // המקום השמור
    const ph = el('div', 'md-ph', under);
    ph.textContent = String(rank);
    ph.style.width = `${D}px`;
    ph.style.height = `${D}px`;
    ph.style.fontSize = `${Math.round(D * 0.42)}px`;
    // העמודה המתנדנדת: סרט + טבעת + (זר) + מדליה
    const col = el('div', 'md-col', front);
    metalVars(col, pal, rank);
    col.style.transformOrigin = `0px ${-(cy + 260)}px`;
    const rib = ribbonSvg(D, pal, `${uid}m${rank}`);
    const loopD = D * 0.2;
    const ribEl = el('div', 'md-rib', col, rib.html);
    ribEl.style.left = `${-rib.W / 2}px`;
    ribEl.style.top = `${-D / 2 - loopD * 0.7 - rib.L}px`;
    const loop = el('div', 'md-loop', col);
    loop.style.width = `${loopD}px`;
    loop.style.height = `${loopD}px`;
    loop.style.borderWidth = `${Math.round(loopD * 0.2)}px`;
    loop.style.left = `${-loopD / 2}px`;
    loop.style.top = `${-D / 2 - loopD * 0.78}px`;
    if (big) {
      const lv = laurelSvg(D, `${uid}m`);
      const la = el('div', 'md-laurel', col, lv.html);
      la.style.left = `${-lv.S / 2}px`;
      la.style.top = `${-lv.S / 2}px`;
    }
    const hold = el('div', 'md-hold', col);
    const medal = el('div', 'md-medal', hold);
    medal.style.width = `${D}px`;
    medal.style.height = `${D}px`;
    medal.style.left = `${-D / 2}px`;
    medal.style.top = `${-D / 2}px`;
    const face = el('div', 'md-face', medal);
    el('div', 'md-rim', face);
    const core = el('div', 'md-core', face);
    const num = el('div', 'md-num', core);
    num.textContent = String(rank);
    num.style.fontSize = `${Math.round(D * 0.46)}px`;
    const back = el('div', 'md-face md-backf', medal);
    el('div', 'md-rim', back);
    const metal = pal.metal(rank);
    el('div', 'md-core', back, starSvg(metal.light, metal.dark));
    const shine = el('div', 'md-shine', face);
    const shine2 = el('div', 'md-shine', back);
    // הסרט עם השם
    const bw = big ? (n === 1 ? 560 : Math.min(560, spacing + 20)) : spacing - 36;
    const bh = big ? 150 : 124;
    const banner = el('div', big ? 'md-banner is-champ' : 'md-banner', front);
    metalVars(banner, pal, rank);
    banner.style.width = `${bw}px`;
    banner.style.height = `${bh}px`;
    banner.style.marginLeft = `${-bw / 2}px`;
    const notch = 30;
    const edge = el('div', 'md-bn-edge', banner);
    edge.style.clipPath = `polygon(0 0,100% 0,calc(100% - ${notch}px) 50%,100% 100%,0 100%,${notch}px 50%)`;
    const fill = el('div', 'md-bn-fill', banner);
    fill.style.clipPath = `polygon(0 0,100% 0,calc(100% - ${notch - 4}px) 50%,100% 100%,0 100%,${notch - 4}px 50%)`;
    const lbl = el('div', 'md-lbl', fill);
    lbl.textContent = placeLabel(rank);
    const fit = fitName(winner.name, bw - notch * 2 - 30, big ? 64 : n >= 5 ? 42 : 50, 22, family);
    const nm = el('div', 'md-name', fill);
    nm.textContent = fit.text;
    nm.style.fontSize = `${fit.lines === 2 ? Math.min(fit.size, Math.floor((bh - 44) / 2.15)) : fit.size}px`;
    const score = scoreEl(front, 'md-score');
    score.e.style.fontSize = `${big ? 46 : 38}px`;
    const item: Item = {
      rank,
      idx,
      cx,
      cy,
      D,
      ph,
      col,
      medal,
      shine,
      shine2,
      banner,
      bh,
      bannerY: cy + D / 2 + (big ? 56 : 40) + bh / 2,
      score,
      metalLight: hexRgb(metal.light),
    };
    items.push(item);
    byRank[rank] = item;
  });

  // ----------------------------------------------------------- קבועים
  const R = rng(3);
  const stars = Array.from({ length: 190 }, () => ({
    x: R() * 1920,
    y: R() * 900,
    r: 0.6 + R() * 1.9,
    ph: R() * 6.28,
    sp: 0.5 + R() * 2.4,
  }));
  const bokeh = Array.from({ length: 18 }, () => ({
    x: R() * 1920,
    y: 860 + R() * 260,
    r: 40 + R() * 110,
    ph: R() * 6.28,
    sp: 0.1 + R() * 0.2,
    c: R(),
  }));
  const goldW = mix(hexRgb(METALS.gold.light), pal.white, 0.35);
  const goldBase = hexRgb(METALS.gold.base);
  const fwCols = (it: Item): RGB[] => [pal.white, pal.glow, it.metalLight, pal.accent];
  const champ = byRank[1] ?? null;

  // שמי הלילה — פעם אחת
  const still = offscreen(bg.canvas.width, bg.canvas.height);
  {
    const c = still.ctx;
    c.setTransform(q, 0, 0, q, 0, 0);
    const g = c.createLinearGradient(0, 0, 0, 1080);
    g.addColorStop(0, rgba(pal.deep));
    g.addColorStop(0.55, rgba(pal.dark));
    g.addColorStop(0.85, rgba(mix(pal.mid, pal.dark, 0.3)));
    g.addColorStop(1, rgba(mix(pal.mid, pal.glow, 0.2)));
    c.fillStyle = g;
    c.fillRect(0, 0, 1920, 1080);
  }

  /** מצב המדליה: נפילה, סיבוב, נדנוד, הסרט, הניקוד והנחיתה. */
  function stateOf(it: Item, t: number, te: number): MedalState {
    const ph = rankPhase(show, it.rank, t);
    const st: MedalState = {
      ph,
      on: false,
      dy: -1400,
      spin: 0,
      swing: 0,
      banner: 0,
      score: -1,
      impact: -1,
      phA: clamp(te / 0.8) * 0.9,
      susp: 0,
      out: false,
    };
    const top = -(it.cy + it.D + 150);
    if (ph.on) {
      const isChamp = it.rank === 1 && !show.instant;
      const land = isChamp ? 0 : show.instant ? 0.3 : 0.45;
      const v = isChamp ? ph.vis : ph.tau;
      const start = isChamp ? -0.38 : 0;
      if (isChamp && ph.vis < -0.38) {
        st.susp = prog(ph.tau, 0, SUSPENSE - 0.38);
        return st;
      }
      st.on = true;
      const fall = E.inQuad(prog(v, start, land));
      st.dy = lerp(top, 0, fall);
      if (v >= land) {
        const u = v - land;
        st.dy = 34 * Math.exp(-4.5 * u) * Math.sin(13 * u) * (isChamp ? 1.2 : 0.8);
        st.swing = wobble(u, isChamp ? 3.2 : 4.5, 1.3, 4.1, 0.6);
        st.impact = u;
        st.banner = u;
        st.score = u - 0.35;
      }
      st.spin =
        (isChamp ? 900 : show.instant ? 360 : 720) *
        (1 - E.outCubic(prog(v, start, land + (isChamp ? 0.95 : 0.75))));
      st.phA = clamp(1 - fall * 1.5) * 0.9;
    } else if (ph.out < 0.7) {
      const k = E.inCubic(prog(ph.out, 0, 0.55));
      st.on = true;
      st.dy = lerp(0, top, k);
      st.out = true;
      st.banner = -1;
      st.phA = k * 0.9;
    }
    return st;
  }

  function rocket(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    t0: number,
    t: number,
    colr: RGB,
  ): void {
    const a = t - (t0 - 0.55);
    if (a < 0 || a > 0.58) return;
    const u = E.outQuad(clamp(a / 0.55));
    const yy = lerp(1100, y, u);
    const xx = x + Math.sin(a * 9) * 6;
    const lg = c.createLinearGradient(xx, yy, xx, yy + 180);
    lg.addColorStop(0, rgba(colr, 0.9));
    lg.addColorStop(1, rgba(colr, 0));
    c.strokeStyle = lg;
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(xx, yy);
    c.lineTo(x, yy + 180);
    c.stroke();
    star4(c, xx, yy, 12, rgba(pal.white), 0.9);
    c.globalAlpha = 1;
  }

  function firework(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    t0: number,
    t: number,
    seed: number,
    cols: readonly RGB[],
    scale = 1,
  ): void {
    const a = t - t0;
    if (a < 0 || a > 2.4) return;
    // הבזק
    if (a < 0.35) {
      const rg = c.createRadialGradient(x, y, 0, x, y, 260 * scale);
      rg.addColorStop(0, rgba(pal.white, 0.55 * (1 - a / 0.35)));
      rg.addColorStop(1, rgba(pal.white, 0));
      c.fillStyle = rg;
      c.fillRect(x - 260 * scale, y - 260 * scale, 520 * scale, 520 * scale);
    }
    drawSparks(
      c,
      {
        t0,
        seed,
        n: Math.round(110 * scale),
        x,
        y,
        angle: 0,
        spread: TAU,
        speed: [380 * scale, 760 * scale],
        g: 260,
        k: 1.6,
        life: [1.2, 2.1],
        width: 3.6,
        trail: 0.12,
        twinkle: true,
      },
      t,
      cols,
    );
    drawSparks(
      c,
      {
        t0: t0 + 0.05,
        seed: seed + 1,
        n: Math.round(50 * scale),
        x,
        y,
        angle: 0,
        spread: TAU,
        speed: [150 * scale, 330 * scale],
        g: 200,
        k: 1.4,
        life: [0.9, 1.6],
        width: 2.6,
        trail: 0.08,
        twinkle: true,
      },
      t,
      [pal.white],
    );
  }

  // ----------------------------------------------------------- קנבסים
  function drawBg(t: number, te: number, sts: MedalState[]): void {
    const c = bctx;
    const ent = clamp(te / 0.9);
    c.drawImage(still.canvas, 0, 0, 1920, 1080);
    c.save();
    c.globalCompositeOperation = 'lighter';
    if (ent > 0) {
      for (const s of stars) {
        const a = (0.2 + 0.8 * Math.pow(0.5 + 0.5 * Math.sin(t * s.sp + s.ph), 3)) * ent;
        c.fillStyle = rgba(pal.white, a * 0.85);
        c.beginPath();
        c.arc(s.x, s.y, s.r, 0, TAU);
        c.fill();
      }
      // זרקורי טקס שסורקים מלמטה
      for (const [x0, phase] of [
        [180, 0],
        [1740, 2.2],
      ] as const) {
        const ang = -Math.PI / 2 + Math.sin(t * 0.35 + phase) * 0.42;
        const L = 1500;
        const half = 0.07;
        const x1 = x0 + Math.cos(ang - half) * L;
        const y1 = 1100 + Math.sin(ang - half) * L;
        const x2 = x0 + Math.cos(ang + half) * L;
        const y2 = 1100 + Math.sin(ang + half) * L;
        const lg = c.createLinearGradient(
          x0,
          1100,
          x0 + Math.cos(ang) * L,
          1100 + Math.sin(ang) * L,
        );
        lg.addColorStop(0, rgba(pal.soft, 0.22 * ent));
        lg.addColorStop(1, rgba(pal.soft, 0));
        c.fillStyle = lg;
        c.beginPath();
        c.moveTo(x0 - 6, 1100);
        c.lineTo(x1, y1);
        c.lineTo(x2, y2);
        c.lineTo(x0 + 6, 1100);
        c.fill();
      }
      // בוקה של אורות קהל למטה
      for (const b of bokeh) {
        const x = b.x + Math.sin(t * b.sp + b.ph) * 40;
        const colr = b.c < 0.5 ? pal.glow : b.c < 0.8 ? pal.accent : pal.white;
        const rg = c.createRadialGradient(x, b.y, 0, x, b.y, b.r);
        rg.addColorStop(0, rgba(colr, 0.16 * ent));
        rg.addColorStop(0.7, rgba(colr, 0.08 * ent));
        rg.addColorStop(1, rgba(colr, 0));
        c.fillStyle = rg;
        c.fillRect(x - b.r, b.y - b.r, b.r * 2, b.r * 2);
      }
    }
    // זרקור על המקום הראשון בזמן התיפוף
    if (champ) {
      const s = sts[1]!;
      let a = 0;
      if (s.susp > 0) a = 0.25 + 0.55 * s.susp * (0.7 + 0.3 * Math.sin(s.ph.tau * 28));
      if (s.impact >= 0) a = 0.55 + 0.1 * Math.sin(t * 2);
      else if (s.on && s.ph.on) a = 0.8;
      if (a > 0) {
        const lg = c.createLinearGradient(champ.cx, -40, champ.cx, champ.cy + 420);
        lg.addColorStop(0, rgba(goldW, 0.5 * a));
        lg.addColorStop(1, rgba(goldW, 0.04 * a));
        c.fillStyle = lg;
        c.beginPath();
        c.moveTo(champ.cx - 60, -40);
        c.lineTo(champ.cx + 60, -40);
        c.lineTo(champ.cx + 330, champ.cy + 420);
        c.lineTo(champ.cx - 330, champ.cy + 420);
        c.fill();
      }
    }
    c.restore();
  }

  function drawFireworks(t: number, sts: MedalState[]): void {
    const c = wctx;
    c.clearRect(0, 0, 1920, 1080);
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const it of items) {
      const s = sts[it.rank]!;
      if (s.impact < 0) continue;
      const t0 = t - s.impact;
      if (it.rank === 1 && !show.instant) {
        VOLLEY.forEach(([dt, x, y, sc], k) => {
          const cols = k % 2 === 1 ? [goldW, pal.white, goldBase] : fwCols(it);
          if (dt > 0.3) rocket(c, x, y, t0 + dt, t, cols[0]!);
          firework(c, x, y, t0 + dt, t, 300 + k * 7, cols, sc);
        });
      } else {
        firework(
          c,
          it.cx,
          it.cy - it.D * 0.9,
          t0 + 0.06,
          t,
          200 + it.rank * 5,
          fwCols(it),
          show.instant ? 0.7 : 0.85,
        );
      }
    }
    c.restore();
  }

  function drawFx(t: number, sts: MedalState[]): void {
    const c = fctx;
    c.clearRect(0, 0, 1920, 1080);
    if (champ) {
      const s = sts[1]!;
      // ניצוצות שמתכנסים אל המקום הראשון בזמן התיפוף
      if (s.susp > 0 || (s.ph.on && !show.instant && s.ph.vis < 0)) {
        const tau = s.ph.tau;
        const k = prog(tau, 0, SUSPENSE);
        const R2 = rng(17);
        c.save();
        c.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 70; i++) {
          const a0 = R2() * TAU;
          const r0 = 300 + R2() * 700;
          const sp = 1.2 + R2() * 2;
          const delay = R2() * 0.8;
          const pickGold = R2() < 0.5;
          const u = clamp((tau - delay) / (SUSPENSE - delay));
          if (u <= 0) continue;
          const rr = r0 * (1 - E.inCubic(u));
          const a = a0 + u * sp * 3;
          const x = champ.cx + Math.cos(a) * rr;
          const y = champ.cy + Math.sin(a) * rr * 0.8;
          star4(c, x, y, 5 + 9 * k, rgba(pickGold ? goldW : pal.white), clamp(u * 3) * 0.9);
        }
        c.restore();
        c.globalAlpha = 1;
      }
      if (s.impact >= 0 && !show.instant) {
        const t0 = t - s.impact;
        drawSparks(
          c,
          {
            t0,
            seed: 61,
            n: 80,
            x: champ.cx,
            y: champ.cy,
            angle: 0,
            spread: TAU,
            speed: [700, 1600],
            g: 600,
            k: 2.2,
            life: [0.6, 1.4],
            width: 5,
            trail: 0.06,
            twinkle: true,
          },
          t,
          [goldW, pal.white, pal.glow],
        );
        drawConfetti(
          c,
          {
            t0: t0 + 0.3,
            seed: 62,
            n: 240,
            x: 960,
            y: -60,
            w: 2100,
            angle: Math.PI / 2,
            spread: 0.4,
            speed: [80, 260],
            g: 340,
            k: 1.1,
            life: [4.8, 6.6],
            size: 19,
            delay: 2.6,
          },
          t,
          pal.confetti,
          q,
        );
        drawConfetti(
          c,
          {
            t0: t0 + 0.1,
            seed: 63,
            n: 140,
            x: 110,
            y: 1060,
            angle: -1.1,
            spread: 0.5,
            speed: [1500, 2500],
            g: 1500,
            k: 1.5,
            life: [3, 4.4],
            size: 21,
          },
          t,
          pal.confetti,
          q,
        );
        drawConfetti(
          c,
          {
            t0: t0 + 0.14,
            seed: 64,
            n: 140,
            x: 1810,
            y: 1060,
            angle: -Math.PI + 1.1,
            spread: 0.5,
            speed: [1500, 2500],
            g: 1500,
            k: 1.5,
            life: [3, 4.4],
            size: 21,
          },
          t,
          pal.confetti,
          q,
        );
      }
    }
    for (const it of items) {
      const s = sts[it.rank]!;
      if (s.impact < 0 || (it.rank === 1 && !show.instant)) continue;
      const t0 = t - s.impact;
      drawSparks(
        c,
        {
          t0,
          seed: 70 + it.rank,
          n: 26,
          x: it.cx,
          y: it.cy,
          angle: 0,
          spread: TAU,
          speed: [300, 800],
          g: 500,
          k: 2.5,
          life: [0.4, 0.9],
          width: 3.2,
          trail: 0.05,
        },
        t,
        [pal.white, it.metalLight],
      );
    }
  }

  // ----------------------------------------------------------- פריים
  function frame(t: number): void {
    const te = t - show.enterT;
    const sts: MedalState[] = [];
    for (const it of items) sts[it.rank] = stateOf(it, t, te);
    drawBg(t, te, sts);
    drawFireworks(t, sts);
    drawFx(t, sts);
    for (const it of items) {
      const s = sts[it.rank]!;
      const ent = E.outBack(prog(te, 0.2 + it.idx * 0.08, 0.8 + it.idx * 0.08), 1.6);
      let phA = s.phA * clamp(ent * 1.4);
      let phS = 0.6 + 0.4 * ent;
      const drum = it.rank === 1 && s.susp > 0;
      if (drum) {
        phA = 0.9;
        phS = 1 + 0.06 * s.susp * Math.sin(s.ph.tau * 28);
      }
      css(it.ph, 'opacity', phA.toFixed(3));
      css(
        it.ph,
        'transform',
        `translate(${it.cx - it.D / 2}px,${it.cy - it.D / 2}px) scale(${phS.toFixed(3)}) rotate(${((t * (drum ? 40 + 200 * s.susp : 6)) % 360).toFixed(2)}deg)`,
      );
      css(it.col, 'opacity', s.on ? '1' : '0');
      css(it.col, 'visibility', s.on ? 'visible' : 'hidden');
      if (s.on) {
        const idle = s.impact > 2.5 ? Math.sin(t * 1.1 + it.idx) * 0.9 : 0;
        css(
          it.col,
          'transform',
          `translate(${it.cx}px,${(it.cy + s.dy).toFixed(1)}px) rotate(${(s.swing + idle).toFixed(3)}deg)`,
        );
        css(it.medal, 'transform', `rotateY(${(s.spin % 360).toFixed(1)}deg)`);
        const shx =
          Math.sin((s.spin * Math.PI) / 180) * 60 +
          (s.impact > 0 ? ((s.impact * 40) % 260) - 130 : 0);
        css(it.shine, 'transform', `translateX(${shx.toFixed(1)}px)`);
        css(it.shine2, 'transform', `translateX(${(-shx).toFixed(1)}px)`);
      }
      // סרט השם
      let bo = 0;
      let bsx = 0.05;
      if (s.banner >= 0) {
        const k = prog(s.banner, 0.1, 0.55);
        bo = clamp(k * 4);
        bsx = lerp(0.05, 1, E.outBack(k, 1.4));
      }
      css(it.banner, 'opacity', bo.toFixed(3));
      css(it.banner, 'visibility', bo > 0.001 ? 'visible' : 'hidden');
      css(
        it.banner,
        'transform',
        `translate(${it.cx}px,${it.bannerY - it.bh / 2}px) scale(${bsx.toFixed(4)},${(0.6 + 0.4 * Math.min(1, bsx)).toFixed(4)})`,
      );
      // ניקוד
      const so = s.score >= 0 ? clamp(s.score / 0.3) : 0;
      css(it.score.e, 'opacity', so.toFixed(3));
      css(it.score.e, 'visibility', so > 0.001 ? 'visible' : 'hidden');
      css(
        it.score.e,
        'transform',
        `translate(${it.cx}px,${(it.bannerY + it.bh / 2 + 16 + (1 - so) * 20).toFixed(1)}px) translateX(-50%)`,
      );
      if (s.score >= 0)
        setScore(it.score, show.winner(it.rank).score * E.outCubic(prog(s.score, 0, 1.1)));
    }
    if (rays && champ) {
      const s = sts[1]!;
      const a = s.impact >= 0 ? clamp(s.impact / 0.5) * 0.9 : 0;
      css(rays, 'opacity', a.toFixed(3));
      css(rays, 'visibility', a > 0.001 ? 'visible' : 'hidden');
      css(
        rays,
        'transform',
        `translate(${champ.cx}px,${champ.cy}px) rotate(${((t * 8) % 360).toFixed(2)}deg)`,
      );
    }
    const tk = E.outCubic(prog(te, 0.1, 0.9));
    css(title, 'opacity', tk.toFixed(3));
    css(title, 'transform', `translateY(${((1 - tk) * 40).toFixed(1)}px)`);
    css(flash, 'opacity', flashAlpha(show, t, 0.8, 0.14, show.instant ? 0.3 : 0.45).toFixed(3));
    const [sx, sy] = shake(show, t, show.instant ? 0.3 : 0.45);
    css(shakeEl, 'transform', `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`);
  }

  return {
    frame,
    destroy() {
      root.replaceChildren();
    },
  };
}

const CLINK_BY_RANK: Record<number, number> = { 2: 1760, 3: 1318.5 };

export const medalsConcept: Concept = {
  create,
  sound: {
    reveal: (rank) => ({
      cues: [
        {
          at: 0,
          name: 'whoosh',
          opts: { dur: 0.45, from: 2400, to: 300, gain: 0.3, pan0: 0, pan1: 0 },
        },
        { at: 0.45, name: 'clink', opts: { f: CLINK_BY_RANK[rank] ?? 1174.66 } },
        { at: 0.45, name: 'impact', opts: { gain: 0.45, low: 50 } },
        { at: 0.51, name: 'burst', opts: { gain: 0.32, pan: 0 } },
        { at: 0.85, name: 'ticks', opts: { dur: 1.1, count: 15 } },
      ],
      duck: { at: 0.4, level: 0.65, hold: 0.8, release: 1 },
    }),
    champion: () => {
      const S = SUSPENSE;
      const cues: SoundCue[] = [
        { at: 0, name: 'drumroll', opts: { dur: S } },
        { at: 0.3, name: 'rise', opts: { dur: S - 0.3 } },
        {
          at: S - 0.38,
          name: 'whoosh',
          opts: { dur: 0.38, from: 2600, to: 300, gain: 0.35, pan0: 0, pan1: 0 },
        },
        { at: S, name: 'impact', opts: { gain: 1, decay: 1.1 } },
        { at: S, name: 'clink', opts: { f: NOTES.G6, gain: 0.26 } },
        { at: S, name: 'crash' },
        { at: S + 0.05, name: 'fanfare' },
        { at: S + 0.08, name: 'burst', opts: { gain: 0.5 } },
        { at: S + 0.5, name: 'applause', opts: { gain: 0.4 } },
        { at: S + 0.35, name: 'ticks', opts: { dur: 1.1, count: 18, gain: 0.05 } },
      ];
      const volley: readonly (readonly [number, number])[] = [
        [0.32, -0.5],
        [0.5, 0.5],
        [0.9, -0.25],
        [1.1, 0.25],
        [1.6, 0],
        [2.2, -0.6],
        [2.45, 0.6],
      ];
      volley.forEach(([dt, pan], k) => {
        cues.push({ at: S + dt - 0.55, name: 'launch', opts: { pan, seed: 80 + k } });
        cues.push({ at: S + dt, name: 'burst', opts: { gain: 0.38, pan, seed: 90 + k } });
      });
      return { cues, duck: { at: 0, level: 0.3, hold: S + 2.8, release: 1.6, attack: 0.5 } };
    },
    all: (n) => {
      const notes = [2093, 1760, 1568, 1318.5, 1174.66];
      const cues: SoundCue[] = [];
      for (let k = 0; k < n; k++)
        cues.push({
          at: k * 0.16 + 0.3,
          name: 'clink',
          opts: { gain: 0.16, pan: (k / Math.max(1, n - 1) - 0.5) * 1.2, f: notes[k % 5]! },
        });
      const end = (n - 1) * 0.16 + 0.3;
      cues.push({ at: 0, name: 'whoosh', opts: { dur: 0.32, from: 2400, to: 400, gain: 0.3 } });
      cues.push({ at: end, name: 'impact', opts: { gain: 0.8 } });
      cues.push({ at: end + 0.06, name: 'burst', opts: { gain: 0.4 } });
      cues.push({ at: end + 0.02, name: 'shimmer' });
      cues.push({ at: end + 0.3, name: 'applause', opts: { gain: 0.35 } });
      return { cues, duck: { at: 0, level: 0.5, hold: 2.2, release: 1.4 } };
    },
  },
};
