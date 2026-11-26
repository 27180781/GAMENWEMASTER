/**
 * «קלפי האלופים» — קלפים הפוכים במניפה מתחת לזוהר צפוני בצבעי המשחק. כל לחיצה
 * מרימה קלף, הופכת אותו ומנחיתה אותו. קלף המקום הראשון רועד, נשפך ממנו אור,
 * ובסוף התיפוף הוא מתהפך — בצבעים המתחלפים של התשובה הנכונה.
 * הכללים ב-winners.css (.cd-*).
 */

import {
  clamp,
  contrast,
  crownSvg,
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
  type RGB,
} from './core.ts';
import {
  applyPalette,
  avatar,
  css,
  el,
  flashAlpha,
  layer,
  metalVars,
  nameEl,
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
import type { SoundCue } from '../../app/winnersSynth.ts';

const SIZES = {
  champ: [
    [0, 0],
    [440, 616],
    [420, 588],
    [420, 588],
    [380, 532],
    [360, 504],
  ],
  other: [
    [0, 0],
    [0, 0],
    [350, 490],
    [340, 476],
    [306, 428],
    [276, 386],
  ],
} as const;

interface Item {
  rank: number;
  idx: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
  shadow: HTMLDivElement;
  slot: HTMLDivElement;
  card: HTMLDivElement;
  aura: HTMLDivElement;
  front: HTMLDivElement;
  backGloss: HTMLDivElement;
  frontGloss: HTMLDivElement;
  glare: HTMLDivElement;
  score: ScoreView;
  metalLight: RGB;
}

interface CardState {
  ph: RankPhase;
  lift: number;
  flip: number;
  scale: number;
  rot: number;
  glow: number;
  impact: number;
  jx: number;
  jy: number;
  enter: number;
  faceUp: boolean;
}

interface Timing {
  lift: readonly [number, number];
  flip: readonly [number, number];
  land: readonly [number, number];
}
const INSTANT: Timing = { lift: [0, 0.12], flip: [0.12, 0.42], land: [0.42, 0.54] };
const NORMAL: Timing = { lift: [0, 0.28], flip: [0.28, 0.86], land: [0.86, 1.02] };

function create(root: HTMLElement, show: Show, env: ConceptEnv) {
  const { pal, n } = show;
  const { q, family, uid } = env;
  root.classList.add('cd-root');
  applyPalette(root, pal);
  const shakeEl = el('div', 'cd-shake', root);
  const bg = layer(shakeEl, 'cd-bg', q);
  const backLayer = el('div', 'cd-layer', shakeEl);
  const cardsLayer = el('div', 'cd-layer', shakeEl);
  const title = titleEl(shakeEl, show);
  const fx = layer(shakeEl, 'cd-fx', q);
  const flash = el('div', 'cd-flash', root);
  const bctx = bg.ctx;
  const fctx = fx.ctx;
  // הזוהר הצפוני מצויר בקנבס קטן ונמתח — רך מעצמו, וזול
  const small = offscreen(384, 216);
  const sctx = small.ctx;

  // ----------------------------------------------------------- סידור
  const order = rowOrder(n);
  const gap = n >= 4 ? 30 : 46;
  const dims = order.map((r) => (r === 1 ? SIZES.champ[n] : SIZES.other[n]) ?? SIZES.other[5]);
  const total = dims.reduce((a, d) => a + d[0], 0) + gap * (n - 1);
  let x = 960 - total / 2;
  const items: Item[] = [];
  const byRank: Item[] = [];

  const champExists = order.includes(1);
  const rays = champExists ? el('div', 'cd-rays', backLayer) : null;
  const crown = champExists ? el('div', 'cd-crown', cardsLayer, crownSvg(pal, `${uid}cd`)) : null;

  order.forEach((rank, idx) => {
    const [w, h] = dims[idx]!;
    const cx = x + w / 2;
    x += w + gap;
    const ring = ringOf(rank);
    const side = cx < 959 ? -1 : cx > 961 ? 1 : 0;
    const cy = rank === 1 ? (n <= 3 ? 612 : 600) : ring === 1 ? 640 : 672;
    const winner = show.winner(rank);
    const big = rank === 1;
    const shadow = el('div', 'cd-shadow', backLayer, '<i></i>');
    const slot = el('div', 'cd-slot', cardsLayer);
    const card = el('div', big ? 'cd-card is-champ' : 'cd-card', slot);
    metalVars(slot, pal, rank);
    card.style.width = `${w}px`;
    card.style.height = `${h}px`;
    card.style.left = `${-w / 2}px`;
    card.style.top = `${-h / 2}px`;
    const aura = el('div', 'cd-aura', card);
    // גב הקלף
    const bk = el('div', 'cd-face cd-back', card);
    const lbl = el('div', 'cd-lbl', bk);
    lbl.textContent = 'מקום';
    const num = el('div', 'cd-num', bk);
    const numSpan = el('span', '', num);
    numSpan.textContent = String(rank);
    num.style.fontSize = `${Math.round(h * 0.42)}px`;
    const qm = el('div', 'cd-q', bk);
    qm.textContent = '?';
    const metal = pal.metal(rank);
    const star = starSvg(metal.base, metal.deep);
    for (const [px, py] of [
      [28, 28],
      [w - 58, 28],
      [28, h - 58],
      [w - 58, h - 58],
    ] as const) {
      const s = el('div', 'cd-star', bk, star);
      s.style.left = `${px}px`;
      s.style.top = `${py}px`;
    }
    const backGloss = el('div', 'cd-gloss', bk);
    // פני הקלף
    const front = el('div', 'cd-face cd-front', card);
    const inner = el('div', 'cd-in', front);
    const rib = el('div', 'cd-ribbon', inner);
    rib.textContent = placeLabel(rank);
    const s = h / 448; // יחס גודל
    rib.style.height = `${Math.round(66 * s)}px`;
    rib.style.fontSize = `${Math.round(34 * s)}px`;
    const nameMax = Math.round((big ? 70 : 60) * s * (big ? 0.88 : 1));
    const two = fitName(winner.name, w - 56, nameMax, 24, family).lines === 2;
    const avw = el('div', 'cd-avw', inner);
    avw.style.marginTop = `${Math.round((two ? 18 : 26) * s)}px`;
    avatar(
      avw,
      winner.name,
      Math.round((big ? 150 : 128) * s * (big ? 0.85 : 1) * (two ? 0.72 : 1)),
    );
    const nm = nameEl(inner, 'cd-name', winner.name, w - 56, nameMax, 24, family);
    nm.style.marginTop = `${Math.round(18 * s)}px`;
    const sep = el('div', 'cd-sep', inner);
    sep.style.margin = `${Math.round(14 * s)}px 0 ${Math.round(8 * s)}px`;
    const score = scoreEl(inner, 'cd-score');
    score.e.style.fontSize = `${Math.round((big ? 68 : 54) * s * (big ? 0.85 : 1))}px`;
    const frontGloss = el('div', 'cd-gloss', inner);
    const glare = el('div', 'cd-glare', inner);
    const item: Item = {
      rank,
      idx,
      cx,
      cy,
      w,
      h,
      rot: side * (ring === 1 ? 5 : 10),
      shadow,
      slot,
      card,
      aura,
      front,
      backGloss,
      frontGloss,
      glare,
      score,
      metalLight: hexRgb(metal.light),
    };
    items.push(item);
    byRank[rank] = item;
  });

  // ----------------------------------------------------------- קבועים
  const R = rng(5);
  const stars = Array.from({ length: 170 }, () => ({
    x: R() * 1920,
    y: R() * 820,
    r: 0.6 + R() * 1.8,
    ph: R() * 6.28,
    sp: 0.6 + R() * 2.2,
  }));
  const auroraCols = [
    pal.glow,
    contrast(pal.accent, pal.gold) < 1.2 ? pal.soft : pal.accent,
    mix(pal.glow, pal.soft, 0.5),
  ];
  const goldW = mix(hexRgb(METALS.gold.light), pal.white, 0.4);
  const champ = byRank[1] ?? null;

  // הרקע הקבוע — פעם אחת
  const still = offscreen(bg.canvas.width, bg.canvas.height);
  {
    const c = still.ctx;
    c.setTransform(q, 0, 0, q, 0, 0);
    const g = c.createLinearGradient(0, 0, 0, 1080);
    g.addColorStop(0, rgba(pal.deep));
    g.addColorStop(0.45, rgba(pal.dark));
    g.addColorStop(0.8, rgba(mix(pal.dark, pal.mid, 0.4)));
    g.addColorStop(1, rgba(pal.deep));
    c.fillStyle = g;
    c.fillRect(0, 0, 1920, 1080);
  }

  /** מצב הקלף: הרמה (px), היפוך (מעלות), גודל, סיבוב, הילה ונחיתה. */
  function stateOf(it: Item, t: number, te: number): CardState {
    const ph = rankPhase(show, it.rank, t);
    const ent = E.outBack(prog(te, 0.15 + it.idx * 0.09, 0.85 + it.idx * 0.09), 1.4);
    const st: CardState = {
      ph,
      lift: 0,
      flip: 0,
      scale: 1,
      rot: it.rot,
      glow: 0,
      impact: -1,
      jx: 0,
      jy: 0,
      enter: ent,
      faceUp: false,
    };
    if (ph.on) {
      if (it.rank === 1 && !show.instant) {
        const tau = ph.tau;
        const L = E.outCubic(prog(tau, 0, 0.35));
        const tr = prog(tau, 0.3, 1.65);
        const F = E.inOutCubic(prog(tau, 1.62, SUSPENSE));
        st.lift = 130 * L;
        st.scale = 1 + 0.06 * L;
        st.rot = it.rot * (1 - L) + Math.sin(tau * 47) * 2.2 * tr * (1 - F);
        st.jx = Math.sin(tau * 61) * 4 * tr * (1 - F);
        st.jy = Math.cos(tau * 53) * 3 * tr * (1 - F);
        st.glow = 0.2 + 0.8 * tr;
        st.flip = 180 * F;
        if (ph.vis >= 0) {
          const v = ph.vis;
          st.flip = 180;
          st.lift = lerp(130, 46, E.outCubic(prog(v, 0, 0.6)));
          st.scale = lerp(1.06, 1.1, E.outBack(prog(v, 0, 0.55), 2.5));
          st.rot = 0;
          st.jx = 0;
          st.jy = 0;
          st.glow = 1;
          st.impact = v;
          st.faceUp = true;
        }
      } else {
        const T = show.instant ? INSTANT : NORMAL;
        const v = ph.tau;
        const L = E.outCubic(prog(v, T.lift[0], T.lift[1]));
        const F = E.inOutCubic(prog(v, T.flip[0], T.flip[1]));
        const D = E.inQuad(prog(v, T.land[0], T.land[1]));
        const top = show.instant ? 90 : 160;
        st.lift = top * L * (1 - D) + Math.sin(Math.PI * F) * 30 * (1 - D);
        st.scale = 1 + 0.05 * L * (1 - D);
        st.rot = it.rot * (1 - L * (1 - D));
        st.flip = 180 * F;
        st.glow = L * (1 - D) * 0.8;
        if (v >= T.land[1]) {
          const u = v - T.land[1];
          st.lift = Math.abs(wobble(u, 16, 7, 15));
          st.impact = u;
          st.faceUp = true;
        }
      }
    } else if (ph.out < 0.7) {
      const k = E.inOutCubic(prog(ph.out, 0, 0.6));
      st.flip = 180 * (1 - k);
      st.lift = Math.sin(Math.PI * k) * 80;
    }
    return st;
  }

  // ----------------------------------------------------------- קנבסים
  function drawBg(t: number, te: number, sts: CardState[]): void {
    const c = bctx;
    const ent = clamp(te / 0.9);
    c.drawImage(still.canvas, 0, 0, 1920, 1080);
    // זוהר צפוני
    sctx.clearRect(0, 0, 384, 216);
    sctx.globalCompositeOperation = 'lighter';
    sctx.lineCap = 'round';
    auroraCols.forEach((col, k) => {
      const base = 40 + k * 22;
      for (const [lw, al] of [
        [64, 0.07],
        [30, 0.09],
        [12, 0.11],
      ] as const) {
        sctx.strokeStyle = rgba(col, al);
        sctx.lineWidth = lw;
        sctx.beginPath();
        for (let xx = -10; xx <= 394; xx += 6) {
          const y =
            base +
            22 * Math.sin(xx * 0.018 + t * (0.32 + k * 0.07) + k * 1.9) +
            10 * Math.sin(xx * 0.043 - t * (0.5 + k * 0.1) + k);
          if (xx === -10) sctx.moveTo(xx, y);
          else sctx.lineTo(xx, y);
        }
        sctx.stroke();
      }
    });
    c.save();
    c.globalAlpha = 0.9 * ent;
    c.globalCompositeOperation = 'lighter';
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    if (ent > 0) c.drawImage(small.canvas, 0, 0, 1920, 1080);
    c.globalAlpha = 1;
    // כוכבים
    if (ent > 0) {
      for (const s of stars) {
        const a = (0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(t * s.sp + s.ph), 3)) * ent;
        c.fillStyle = rgba(pal.white, a * 0.8);
        c.beginPath();
        c.arc(s.x, s.y, s.r, 0, TAU);
        c.fill();
      }
    }
    // משטח מבריק למטה + זוהר מאחורי הקלפים
    const fg = c.createRadialGradient(960, 900, 0, 960, 900, 1000);
    fg.addColorStop(0, rgba(pal.glow, 0.28 * ent));
    fg.addColorStop(1, rgba(pal.glow, 0));
    c.fillStyle = fg;
    c.fillRect(0, 500, 1920, 580);
    for (const it of items) {
      const s = sts[it.rank]!;
      const pulse = s.faceUp ? 0.55 : 0.22 + 0.1 * Math.sin(t * 1.6 + it.idx) + s.glow * 0.6;
      const rg = c.createRadialGradient(it.cx, it.cy, 0, it.cx, it.cy, it.w * 1.25);
      rg.addColorStop(
        0,
        rgba(it.rank === 1 && s.glow > 0.1 ? goldW : pal.glow, 0.35 * pulse * ent),
      );
      rg.addColorStop(1, rgba(pal.glow, 0));
      c.fillStyle = rg;
      c.fillRect(it.cx - it.w * 1.3, it.cy - it.w * 1.3, it.w * 2.6, it.w * 2.6);
      // גל הדף בנחיתה
      if (s.impact >= 0 && s.impact < 1.0) {
        const k = E.outCubic(prog(s.impact, 0, 1.0));
        c.save();
        c.translate(it.cx, it.cy + it.h / 2 + 10);
        c.scale(1, 0.22);
        c.strokeStyle = rgba(it.rank === 1 ? goldW : pal.white, (1 - k) * 0.7);
        c.lineWidth = 26 * (1 - k) + 2;
        c.beginPath();
        c.arc(0, 0, 60 + k * (it.rank === 1 ? 1100 : 520), 0, TAU);
        c.stroke();
        c.restore();
      }
    }
    c.restore();
  }

  function drawFx(t: number, sts: CardState[]): void {
    const c = fctx;
    c.clearRect(0, 0, 1920, 1080);
    for (const it of items) {
      const s = sts[it.rank]!;
      if (s.impact < 0) continue;
      const t0 = t - s.impact;
      if (it.rank === 1 && !show.instant) {
        drawSparks(
          c,
          {
            t0,
            seed: 41,
            n: 90,
            x: it.cx,
            y: it.cy,
            angle: 0,
            spread: TAU,
            speed: [700, 1700],
            g: 600,
            k: 2.2,
            life: [0.7, 1.5],
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
            t0: t0 + 0.08,
            seed: 42,
            n: 150,
            x: 120,
            y: 1060,
            angle: -1.1,
            spread: 0.5,
            speed: [1500, 2600],
            g: 1500,
            k: 1.5,
            life: [3.2, 4.6],
            size: 22,
          },
          t,
          pal.confetti,
          q,
        );
        drawConfetti(
          c,
          {
            t0: t0 + 0.12,
            seed: 43,
            n: 150,
            x: 1800,
            y: 1060,
            angle: -Math.PI + 1.1,
            spread: 0.5,
            speed: [1500, 2600],
            g: 1500,
            k: 1.5,
            life: [3.2, 4.6],
            size: 22,
          },
          t,
          pal.confetti,
          q,
        );
        drawConfetti(
          c,
          {
            t0: t0 + 0.4,
            seed: 44,
            n: 220,
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
            delay: 2.4,
          },
          t,
          pal.confetti,
          q,
        );
        if (s.impact > 0.7) {
          const R2 = rng(91);
          for (let k = 0; k < 14; k++) {
            const ang = R2() * TAU;
            const rr = it.w * (0.62 + R2() * 0.35);
            const px = it.cx + Math.cos(ang) * rr;
            const py = it.cy + Math.sin(ang) * rr * 1.25;
            const per = 1.5 + R2() * 1.5;
            const off = R2() * per;
            const size = 10 + R2() * 18;
            const u = ((s.impact + off) % per) / per;
            const a = u < 0.4 ? Math.sin(Math.PI * (u / 0.4)) : 0;
            if (a > 0.01) star4(c, px, py, size, rgba(pal.white), a);
          }
          c.globalAlpha = 1;
        }
      } else {
        drawSparks(
          c,
          {
            t0,
            seed: 50 + it.rank,
            n: 34,
            x: it.cx,
            y: it.cy + it.h * 0.25,
            angle: -Math.PI / 2,
            spread: 3.2,
            speed: [400, 1000],
            g: 800,
            k: 2.4,
            life: [0.5, 1.1],
            width: 3.5,
            trail: 0.05,
          },
          t,
          [pal.white, pal.glow, it.metalLight],
        );
      }
    }
  }

  // ----------------------------------------------------------- פריים
  function frame(t: number): void {
    const te = t - show.enterT;
    const sts: CardState[] = [];
    for (const it of items) sts[it.rank] = stateOf(it, t, te);
    drawBg(t, te, sts);
    drawFx(t, sts);
    const cs = champ ? sts[1]! : null;
    const dimOthers =
      cs && cs.ph.on && !show.instant ? clamp(cs.ph.tau / 0.6) * (1 - clamp(cs.ph.vis / 0.6)) : 0;
    for (const it of items) {
      const s = sts[it.rank]!;
      const ent = s.enter;
      const yIn = (1 - ent) * 500;
      const bob = s.faceUp && s.impact > 1.2 ? Math.sin(t * 1.4 + it.idx * 1.3) * 4 : 0;
      const op = clamp(ent * 1.6) * (it.rank === 1 ? 1 : 1 - 0.45 * dimOthers);
      css(it.slot, 'opacity', op.toFixed(3));
      css(
        it.slot,
        'transform',
        `translate(${(it.cx + s.jx).toFixed(1)}px,${(it.cy + yIn + s.jy + bob).toFixed(1)}px) rotate(${s.rot.toFixed(2)}deg)`,
      );
      css(
        it.card,
        'transform',
        `translateZ(${s.lift.toFixed(1)}px) rotateY(${s.flip.toFixed(2)}deg) scale(${s.scale.toFixed(4)})`,
      );
      // הילה סביב הקלף
      const gl = s.glow;
      const gc = it.rank === 1 ? '255,214,120' : pal.glowA;
      css(
        it.aura,
        'box-shadow',
        gl > 0.01
          ? `0 0 ${Math.round(30 + 70 * gl)}px ${Math.round(6 + 18 * gl)}px rgba(${gc},${(0.65 * gl).toFixed(3)})`
          : 'none',
      );
      // צל על הרצפה
      const sh = 1 - clamp(s.lift / 200) * 0.6;
      css(
        it.shadow,
        'transform',
        `translate(${it.cx}px,${(it.cy + it.h / 2 + 18 + yIn).toFixed(1)}px) scale(${((it.w / 400) * (0.75 + 0.25 * sh)).toFixed(3)},1)`,
      );
      css(it.shadow, 'opacity', (ent * sh * 0.9).toFixed(3));
      // ברק שעובר על הקלף
      const gp = s.faceUp ? (s.impact * 0.55) % 3.2 : (t * 0.3 + it.idx * 0.37) % 2.6;
      css(
        it.frontGloss,
        'transform',
        `translateX(${lerp(-120, it.w + 60, clamp(gp / 1.0)).toFixed(1)}px) skewX(-8deg)`,
      );
      css(
        it.backGloss,
        'transform',
        `translateX(${lerp(-120, it.w + 60, clamp(((t * 0.35 + it.idx * 0.41) % 2.2) / 0.9)).toFixed(1)}px)`,
      );
      css(it.glare, 'opacity', s.impact >= 0 ? (0.75 * Math.exp(-s.impact * 6)).toFixed(3) : '0');
      if (s.faceUp || s.flip > 90)
        setScore(it.score, show.winner(it.rank).score * E.outCubic(prog(s.impact, 0.08, 1.2)));
      if (it.rank === 1) css(it.front, '--ang', `${((t * 70) % 360).toFixed(1)}deg`);
    }
    if (rays && crown && champ) {
      const s = sts[1]!;
      let a = 0;
      if (s.ph.on && !show.instant)
        a =
          s.ph.vis < 0
            ? 0.55 * clamp((s.ph.tau - 0.3) / 1.2) * (0.7 + 0.3 * Math.sin(s.ph.tau * 25))
            : 0.9;
      else if (s.impact >= 0) a = 0.9 * clamp(s.impact / 0.4);
      const spin = s.ph.on && s.ph.vis < 0 ? s.ph.tau * s.ph.tau * 25 : t * 8;
      css(rays, 'opacity', a.toFixed(3));
      css(rays, 'visibility', a > 0.001 ? 'visible' : 'hidden');
      css(
        rays,
        'transform',
        `translate(${champ.cx}px,${champ.cy}px) rotate(${(spin % 360).toFixed(2)}deg)`,
      );
      const k = prog(s.impact, 0.35, 0.85);
      const cy =
        champ.cy -
        (champ.h * 1.1) / 2 +
        8 +
        lerp(-300, 0, E.outCubic(k)) +
        wobble(s.impact - 0.85, 14, 5, 20);
      const crownOp = s.impact >= 0 ? clamp(k * 4) : 0;
      css(crown, 'opacity', crownOp.toFixed(3));
      css(crown, 'visibility', crownOp > 0.001 ? 'visible' : 'hidden');
      css(
        crown,
        'transform',
        `translate(${champ.cx}px,${cy.toFixed(1)}px) rotate(${(wobble(s.impact - 0.8, 9, 3.5, 11) + (s.impact > 2 ? Math.sin(t * 1.7) * 2.5 : 0)).toFixed(2)}deg)`,
      );
    }
    const tk = E.outCubic(prog(te, 0.05, 0.8));
    css(title, 'opacity', tk.toFixed(3));
    css(title, 'transform', `translateY(${((1 - tk) * -50).toFixed(1)}px)`);
    css(flash, 'opacity', flashAlpha(show, t, 0.8, 0.16, show.instant ? 0.54 : 1.02).toFixed(3));
    const [sx, sy] = shake(show, t, show.instant ? 0.54 : 1.02);
    css(shakeEl, 'transform', `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`);
  }

  return {
    frame,
    destroy() {
      root.replaceChildren();
    },
  };
}

export const cardsConcept: Concept = {
  create,
  sound: {
    reveal: () => ({
      cues: [
        {
          at: 0.02,
          name: 'whoosh',
          opts: { dur: 0.3, from: 300, to: 2600, gain: 0.28, pan0: 0, pan1: 0 },
        },
        { at: 0.3, name: 'flip', opts: { snap: 0.5 } },
        { at: 1.02, name: 'impact', opts: { gain: 0.7 } },
        { at: 1.03, name: 'shimmer', opts: { gain: 0.13 } },
        { at: 1.1, name: 'ticks', opts: { dur: 1.12, count: 16 } },
      ],
      duck: { at: 0.9, level: 0.65, hold: 0.7, release: 1 },
    }),
    champion: () => ({
      cues: [
        { at: 0, name: 'drumroll', opts: { dur: SUSPENSE } },
        { at: 0.3, name: 'rise', opts: { dur: SUSPENSE - 0.3 } },
        { at: SUSPENSE - 0.4, name: 'flip', opts: { snap: 0.36, gain: 0.45 } },
        { at: SUSPENSE, name: 'impact', opts: { gain: 1, decay: 1.1 } },
        { at: SUSPENSE, name: 'crash' },
        { at: SUSPENSE + 0.02, name: 'shimmer', opts: { gain: 0.16 } },
        { at: SUSPENSE + 0.05, name: 'fanfare' },
        { at: SUSPENSE + 0.1, name: 'pops' },
        { at: SUSPENSE + 0.5, name: 'applause', opts: { gain: 0.42 } },
        { at: SUSPENSE + 0.1, name: 'ticks', opts: { dur: 1.12, count: 18, gain: 0.05 } },
      ],
      duck: { at: 0, level: 0.3, hold: SUSPENSE + 2.6, release: 1.6, attack: 0.5 },
    }),
    all: (n) => {
      const cues: SoundCue[] = [];
      for (let k = 0; k < n; k++)
        cues.push({
          at: k * 0.16 + 0.1,
          name: 'flip',
          opts: { snap: 0.3, gain: 0.3, pan: (k / Math.max(1, n - 1) - 0.5) * 1.2 },
        });
      const end = (n - 1) * 0.16 + 0.54;
      cues.push({ at: end, name: 'impact', opts: { gain: 0.85 } });
      cues.push({ at: end, name: 'crash', opts: { gain: 0.3 } });
      cues.push({ at: end + 0.02, name: 'shimmer' });
      cues.push({ at: end + 0.1, name: 'pops', opts: { gain: 0.35 } });
      cues.push({ at: end + 0.3, name: 'applause', opts: { gain: 0.35 } });
      return { cues, duck: { at: 0, level: 0.5, hold: 2.4, release: 1.4 } };
    },
  },
};
