/**
 * «הבמה» (ברירת המחדל) — פודיום תלת-ממדי על במה מבריקה, וזרקורים שמחפשים את
 * המנצח. הקוביות והלוחות הם CSS 3D; הרקע, הרצפה, האלומות והקונפטי — קנבס.
 * הכללים ב-winners.css (.st-*).
 */

import {
  clamp,
  crownSvg,
  drawConfetti,
  drawSparks,
  ease as E,
  fitName,
  hexRgb,
  lerp,
  METALS,
  mix,
  prog,
  rgba,
  rng,
  rowOrder,
  spring,
  star4,
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

const P = 1800;
const POX = 960;
const POY = 250;
const FLOOR = 905;
const DEPTH = 190;
const WALL_Z = -700;
const LIP_Z = 300;
const WIDTHS = [0, 480, 440, 420, 360, 316];
const HEIGHTS = [0, 270, 210, 166, 132, 106];
const GAP = 26;
const LAMPS = [150, 470, 790, 1130, 1450, 1770];

/** הקרנה של נקודה תלת-ממדית לבמה (אותה פרספקטיבה של .st-scene). */
function proj(x: number, y: number, z: number): [number, number, number] {
  const s = P / (P - z);
  return [POX + (x - POX) * s, POY + (y - POY) * s, s];
}

interface Face {
  el: HTMLDivElement;
  shade: HTMLDivElement;
}

interface Item {
  rank: number;
  idx: number;
  cx: number;
  w: number;
  h: number;
  box: HTMLDivElement;
  faces: Face[];
  front: Face;
  top: Face;
  left: Face;
  right: Face;
  numSpan: HTMLSpanElement;
  lastH: number;
  crown: HTMLDivElement | null;
  plate: HTMLDivElement;
  score: ScoreView;
  fit: number;
  metalLight: RGB;
}

interface RankState {
  ph: RankPhase;
  h: number;
  lit: number;
  plate: number;
  suspense: number;
  impact: number;
}

interface Beam {
  lx: number;
  tx: number;
  ty: number;
  inten: number;
  col: RGB;
  narrow: number;
}

function create(root: HTMLElement, show: Show, env: ConceptEnv) {
  const { pal, n } = show;
  const { q, family, uid } = env;
  root.classList.add('st-root');
  applyPalette(root, pal);
  const shakeEl = el('div', 'st-shake', root);
  const bg = layer(shakeEl, 'st-bg', q);
  const scene = el('div', 'st-scene', shakeEl);
  const beamsCv = layer(shakeEl, 'st-beams', q);
  const platesLayer = el('div', 'st-plates', shakeEl);
  const title = titleEl(shakeEl, show);
  const fx = layer(shakeEl, 'st-fx', q);
  const flash = el('div', 'st-flash', root);
  const bctx = bg.ctx;
  const mctx = beamsCv.ctx;
  const fctx = fx.ctx;

  // ----------------------------------------------------------- סידור
  const order = rowOrder(n);
  const w = WIDTHS[n] ?? WIDTHS[5]!;
  const total = n * w + (n - 1) * GAP;
  const items: Item[] = [];
  const byRank: Item[] = [];
  let raysEl: HTMLDivElement | null = null;

  order.forEach((rank, idx) => {
    const winner = show.winner(rank);
    const cx = POX - total / 2 + w / 2 + idx * (w + GAP);
    const h = HEIGHTS[rank] ?? HEIGHTS[5]!;
    // ---- הקובייה
    const box = el('div', 'st-box', scene);
    metalVars(box, pal, rank);
    const mk = (cls: string): Face => {
      const f = el('div', `st-face ${cls}`, box);
      return { el: f, shade: el('div', 'st-shade', f) };
    };
    const front = mk('st-front');
    const top = mk('st-top');
    const left = mk('st-side');
    const right = mk('st-side');
    const num = el('div', 'st-num');
    const numSpan = el('span', '', num);
    numSpan.textContent = String(rank);
    front.el.insertBefore(num, front.shade);

    // ---- הלוח עם השם
    if (rank === 1) raysEl = el('div', 'st-rays', platesLayer);
    const plate = el('div', rank === 1 ? 'st-plate is-champ' : 'st-plate', platesLayer);
    metalVars(plate, pal, rank);
    const nameW = rank === 1 ? Math.max(w + 90, 520) : w + 8;
    const nameMax = rank === 1 ? 76 : n >= 5 ? 44 : n === 4 ? 50 : 58;
    const twoLines = fitName(winner.name, nameW - 60, nameMax, 28, family).lines === 2;
    // שם בשתי שורות: עיגול קטן יותר, כדי שהלוח לא יתנשא עד הכותרת
    const avSize =
      rank === 1 ? (twoLines ? 124 : 176) : n >= 5 ? 110 : n === 4 ? 122 : twoLines ? 112 : 136;
    let crown: HTMLDivElement | null = null;
    if (rank === 1) {
      crown = el('div', 'st-crown', plate, crownSvg(pal, `${uid}st`));
      crown.style.top = '-92px';
    }
    avatar(plate, winner.name, avSize);
    nameEl(plate, 'st-name', winner.name, nameW - 60, nameMax, 28, family);
    const score = scoreEl(plate, 'st-score');
    score.e.style.fontSize = `${rank === 1 ? 64 : n >= 5 ? 42 : 50}px`;

    const item: Item = {
      rank,
      idx,
      cx,
      w,
      h,
      box,
      faces: [front, top, left, right],
      front,
      top,
      left,
      right,
      numSpan,
      lastH: -1,
      crown,
      plate,
      score,
      fit: 1,
      metalLight: hexRgb(pal.metal(rank).light),
    };
    items.push(item);
    byRank[rank] = item;
  });
  // לוח גבוה מדי (שם ארוך בשתי שורות) מוקטן כדי שהכתר לא יעלה על הכותרת
  for (const it of items) {
    const room = FLOOR - it.h - 8 - 182 - (it.crown ? 96 : 0);
    it.fit = Math.min(1, room / Math.max(1, it.plate.offsetHeight));
  }

  // ----------------------------------------------------------- קבועים
  const R = rng(7);
  const motes = Array.from({ length: 80 }, () => ({
    x: R() * 1920,
    y: R() * 1080,
    vx: (R() - 0.5) * 14,
    vy: 8 + R() * 18,
    r: 0.8 + R() * 2.2,
    ph: R() * 6.28,
  }));
  const glowW = mix(pal.glow, pal.white, 0.6);
  const goldW = mix(hexRgb(METALS.gold.light), pal.white, 0.45);
  const wallY = proj(0, FLOOR, WALL_Z)[1];
  const lipY = proj(0, FLOOR, LIP_Z)[1];
  const champ = byRank[1] ?? null;

  // הקיר והרצפה עם הרשת לא משתנים — מצוירים פעם אחת לקנבס צדדי
  const still = offscreen(bg.canvas.width, bg.canvas.height);
  {
    const c = still.ctx;
    c.setTransform(q, 0, 0, q, 0, 0);
    const g = c.createLinearGradient(0, 0, 0, wallY);
    g.addColorStop(0, rgba(pal.deep));
    g.addColorStop(0.55, rgba(pal.dark));
    g.addColorStop(1, rgba(mix(pal.mid, pal.dark, 0.25)));
    c.fillStyle = g;
    c.fillRect(0, 0, 1920, wallY + 1);
    const fg = c.createLinearGradient(0, wallY, 0, 1080);
    fg.addColorStop(0, rgba(mix(pal.mid, pal.deep, 0.35)));
    fg.addColorStop(0.5, rgba(pal.dark));
    fg.addColorStop(1, rgba(pal.deep));
    c.fillStyle = fg;
    c.fillRect(0, wallY, 1920, 1080 - wallY);
    c.globalCompositeOperation = 'lighter';
    // רשת הרצפה בפרספקטיבה
    c.lineWidth = 1.5;
    for (let z = WALL_Z; z <= LIP_Z; z += 100) {
      const y = proj(0, FLOOR, z)[1];
      c.strokeStyle = rgba(pal.glow, 0.05 + 0.1 * prog(z, WALL_Z, LIP_Z));
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(1920, y);
      c.stroke();
    }
    for (let j = -22; j <= 22; j++) {
      const x = 960 + j * 160;
      const [x1, y1] = proj(x, FLOOR, WALL_Z);
      const [x2, y2] = proj(x, FLOOR, LIP_Z);
      const lg = c.createLinearGradient(0, y1, 0, y2);
      lg.addColorStop(0, rgba(pal.glow, 0.02));
      lg.addColorStop(1, rgba(pal.glow, 0.16));
      c.strokeStyle = lg;
      c.beginPath();
      c.moveTo(x1, y1);
      c.lineTo(x2, y2);
      c.stroke();
    }
    c.globalCompositeOperation = 'source-over';
  }

  function setBox(it: Item, h: number): void {
    if (Math.abs(h - it.lastH) < 0.05) return;
    it.lastH = h;
    const bw = it.w;
    const d = DEPTH;
    css(it.box, 'transform', `translate3d(${it.cx}px,${FLOOR}px,0)`);
    const fr = it.front.el.style;
    const tp = it.top.el.style;
    const lf = it.left.el.style;
    const rt = it.right.el.style;
    fr.width = `${bw}px`;
    fr.height = `${h}px`;
    fr.transform = `translate3d(${-bw / 2}px,${-h}px,${d / 2}px)`;
    tp.width = `${bw}px`;
    tp.height = `${d}px`;
    tp.transform = `translate3d(${-bw / 2}px,${-d / 2 - h}px,0) rotateX(90deg)`;
    lf.width = `${d}px`;
    lf.height = `${h}px`;
    lf.transform = `translate3d(${-d / 2 - bw / 2}px,${-h}px,0) rotateY(-90deg)`;
    rt.width = `${d}px`;
    rt.height = `${h}px`;
    rt.transform = `translate3d(${-d / 2 + bw / 2}px,${-h}px,0) rotateY(90deg)`;
    css(it.numSpan, 'font-size', `${Math.round(clamp(h * 0.66, 0, it.rank === 1 ? 190 : 150))}px`);
  }

  /** מצב כל מקום בזמן t. */
  function stateOf(it: Item, t: number, te: number): RankState {
    const ph = rankPhase(show, it.rank, t);
    const h0 = it.h * 0.34;
    const ent = E.outBack(prog(te, 0.1 + it.idx * 0.07, 0.8 + it.idx * 0.07), 1.2);
    let h = h0 * ent;
    let lit = 0;
    let plate = 0;
    let suspense = 0;
    let impact = -1;
    if (ph.on) {
      const champSusp = it.rank === 1 && !show.instant;
      if (champSusp && ph.vis < 0) {
        suspense = prog(ph.tau, 0, SUSPENSE);
        h = h0 + it.h * 0.05 * suspense + Math.sin(ph.tau * 60) * 2 * suspense;
        lit = 0.25 * suspense;
      } else {
        const v = Math.max(0, ph.vis);
        h = lerp(h0, it.h, spring(v, 11, 0.42));
        lit = clamp(v / 0.2);
        plate = v;
        impact = v;
      }
    } else if (ph.out < 0.7) {
      const k = E.inOutCubic(prog(ph.out, 0, 0.55));
      h = lerp(it.h, h0, k);
      lit = 1 - k;
      plate = -1 - ph.out; // יציאה
    }
    return { ph, h, lit, plate, suspense, impact };
  }

  // ----------------------------------------------------------- זרקורים
  function beams(t: number, st: RankState[]): Beam[] {
    const res: Beam[] = [];
    const revealed = items.filter((it) => st[it.rank]!.lit > 0.5);
    let conv: Item | null = null;
    let convW = 0;
    let search = 0;
    let champDone = false;
    for (const it of items) {
      const s = st[it.rank]!;
      if (s.suspense > 0) search = Math.max(search, clamp(s.suspense * 3));
      if (s.impact >= 0) {
        const wv = s.impact < 1.1 ? 1 : 1 - E.inOutQuad(prog(s.impact, 1.1, 2.4));
        if (wv > convW) {
          convW = wv;
          conv = it;
        }
        if (it.rank === 1 && s.impact > 2.4) champDone = true;
      }
    }
    LAMPS.forEach((lx, i) => {
      let tx = POX + 700 * Math.sin(0.31 * t + i * 1.7);
      let inten = 0.55;
      let tgt: Item | null = null;
      if (revealed.length > 0) {
        tgt = revealed.reduce((a, b) => (Math.abs(b.cx - lx) < Math.abs(a.cx - lx) ? b : a));
        tx = tgt.cx + 45 * Math.sin(0.8 * t + i * 1.9);
        inten = 0.72;
      }
      if (champDone && champ) {
        const sw = (i % 2 ? 1 : -1) * 260 * Math.sin(1.05 * t + i * 0.8);
        tx = i === 2 || i === 3 ? champ.cx + sw * 0.25 : (tgt ? tgt.cx : POX) + sw;
      }
      if (search > 0) {
        const sx = POX + 820 * Math.sin(2.7 * t * (1 + i * 0.13) + i * 2.1);
        tx = lerp(tx, sx, search);
        inten = lerp(inten, 0.5 + 0.5 * Math.abs(Math.sin(t * 13 + i * 2.3)), search);
      }
      let col = glowW;
      if (conv) {
        tx = lerp(tx, conv.cx + (i - 2.5) * 6, convW);
        inten = lerp(inten, conv.rank === 1 ? 1.25 : 1.05, convW);
        if (conv.rank === 1) col = mix(glowW, goldW, convW);
      }
      if ((i === 2 || i === 3) && champDone) col = goldW;
      res.push({ lx, tx, ty: FLOOR, inten, col, narrow: conv ? convW : 0 });
    });
    return res;
  }

  // ----------------------------------------------------------- קנבסים
  function drawBg(t: number, te: number, st: RankState[], bm: Beam[]): void {
    const c = bctx;
    const ent = clamp(te / 0.8);
    c.drawImage(still.canvas, 0, 0, 1920, 1080);
    c.save();
    // הקיר: ערפל, עמודי אור וטבעת הפורטל — רק מעל קו הרצפה
    c.beginPath();
    c.rect(0, 0, 1920, wallY);
    c.clip();
    c.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 3; k++) {
      const hx = 960 + Math.sin(t * 0.07 + k * 2.1) * 620;
      const hy = 360 + k * 90;
      const rg = c.createRadialGradient(hx, hy, 0, hx, hy, 620);
      rg.addColorStop(0, rgba(pal.glow, 0.09 * ent));
      rg.addColorStop(1, rgba(pal.glow, 0));
      c.fillStyle = rg;
      c.fillRect(0, 0, 1920, wallY);
    }
    // עמודי אור ברקע, עם גל אור שיוצא מכל חשיפה
    for (let k = -6; k <= 6; k++) {
      if (k === 0) continue;
      const x = 960 + Math.sign(k) * (Math.abs(k) * 142 - 50);
      let a = 0.1 + 0.05 * Math.sin(t * 1.3 + k);
      for (const it of items) {
        const s = st[it.rank]!;
        if (s.impact < 0 || s.impact > 2) continue;
        const d = Math.abs(x - it.cx) / 260 - s.impact * 7;
        a += (it.rank === 1 ? 0.75 : 0.45) * Math.exp(-d * d);
      }
      const lg = c.createLinearGradient(0, 120, 0, wallY);
      lg.addColorStop(0, rgba(pal.glow, 0));
      lg.addColorStop(0.5, rgba(glowW, clamp(a) * 0.55 * ent));
      lg.addColorStop(1, rgba(pal.glow, clamp(a) * 0.2 * ent));
      c.fillStyle = lg;
      c.fillRect(x - 7, 120, 14, wallY - 120);
    }
    // טבעת הפורטל מאחורי המקום הראשון
    if (champ) {
      const s = st[1]!;
      const cy = 470;
      const rr = 360;
      let a = 0.14 * ent;
      let spin = t * 0.15;
      if (s.suspense > 0) {
        a += 0.35 * s.suspense * (0.6 + 0.4 * Math.sin(s.ph.tau * 30));
        spin += s.suspense * s.ph.tau * 2.2;
      }
      if (s.impact >= 0) a = Math.max(a, 0.75);
      c.lineCap = 'round';
      for (const [lw, al] of [
        [22, 0.1],
        [9, 0.28],
        [3, 0.95],
      ] as const) {
        c.strokeStyle = rgba(s.impact >= 0 ? goldW : glowW, a * al);
        c.lineWidth = lw;
        for (let k = 0; k < 12; k++) {
          const a0 = spin + (k / 12) * TAU;
          c.beginPath();
          c.arc(960, cy, rr, a0, a0 + (TAU / 12) * 0.62);
          c.stroke();
        }
      }
      // גל הדף בחשיפה
      if (s.impact >= 0 && s.impact < 1.1) {
        const k = E.outCubic(prog(s.impact, 0, 1.1));
        c.strokeStyle = rgba(goldW, (1 - k) * 0.9);
        c.lineWidth = 30 * (1 - k) + 2;
        c.beginPath();
        c.arc(960, cy, 120 + k * 1100, 0, TAU);
        c.stroke();
      }
    }
    c.restore();

    c.save();
    c.globalCompositeOperation = 'lighter';
    // שלוליות אור מתחת לאלומות
    for (const b of bm) {
      const [px, py, s] = proj(b.tx, FLOOR, 30);
      const rx = (250 - 70 * b.narrow) * s;
      c.save();
      c.translate(px, py);
      c.scale(1, 0.24);
      const rg = c.createRadialGradient(0, 0, 0, 0, 0, rx);
      rg.addColorStop(0, rgba(b.col, 0.32 * b.inten * ent));
      rg.addColorStop(1, rgba(b.col, 0));
      c.fillStyle = rg;
      c.fillRect(-rx, -rx, rx * 2, rx * 2);
      c.restore();
    }
    // השתקפות הקוביות ברצפה המבריקה
    for (const it of items) {
      const s = st[it.rank]!;
      const [xl, yl] = proj(it.cx - it.w / 2, FLOOR, DEPTH / 2);
      const [xr] = proj(it.cx + it.w / 2, FLOOR, DEPTH / 2);
      const hh = Math.min(it.lastH * 0.75, 1080 - yl);
      if (hh > 0) {
        const lg = c.createLinearGradient(0, yl, 0, yl + hh);
        lg.addColorStop(0, rgba(mix(pal.plate, pal.white, 0.15), 0.08 + 0.2 * s.lit));
        lg.addColorStop(1, rgba(pal.plate, 0));
        c.fillStyle = lg;
        c.fillRect(xl, yl, xr - xl, hh);
      }
      c.fillStyle = rgba(it.metalLight, 0.1 + 0.25 * s.lit);
      c.fillRect(xl, yl + 2, xr - xl, 3);
    }
    // פס הלד בקצה הבמה
    for (const [lw, al] of [
      [16, 0.1],
      [6, 0.3],
      [2, 0.9],
    ] as const) {
      c.strokeStyle = rgba(glowW, al * ent);
      c.lineWidth = lw;
      c.beginPath();
      c.moveTo(0, lipY);
      c.lineTo(1920, lipY);
      c.stroke();
    }
    c.restore();
    c.fillStyle = rgba(pal.deep, 0.85);
    c.fillRect(0, lipY + 2, 1920, 1080 - lipY);
  }

  function drawBeams(t: number, te: number, bm: Beam[]): void {
    const c = mctx;
    const ent = clamp((te - 0.2) / 1.0);
    c.clearRect(0, 0, 1920, 1080);
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const b of bm) {
      const sx = b.lx;
      const sy = -90;
      const tx = b.tx;
      const ty = b.ty;
      const dx = tx - sx;
      const dy = ty - sy;
      const L = Math.hypot(dx, dy);
      const nx = -dy / L;
      const ny = dx / L;
      const ht = 165 - 55 * b.narrow;
      const hs = 12;
      const I = b.inten * ent;
      if (I <= 0.001) continue;
      const lg = c.createLinearGradient(sx, sy, tx, ty);
      lg.addColorStop(0, rgba(b.col, 0.42 * I));
      lg.addColorStop(0.3, rgba(b.col, 0.15 * I));
      lg.addColorStop(1, rgba(b.col, 0.05 * I));
      c.fillStyle = lg;
      c.beginPath();
      c.moveTo(sx + nx * hs, sy + ny * hs);
      c.lineTo(tx + nx * ht, ty + ny * ht);
      c.lineTo(tx - nx * ht, ty - ny * ht);
      c.lineTo(sx - nx * hs, sy - ny * hs);
      c.fill();
      // ליבה בהירה
      const lg2 = c.createLinearGradient(sx, sy, tx, ty);
      lg2.addColorStop(0, rgba(pal.white, 0.3 * I));
      lg2.addColorStop(1, rgba(pal.white, 0));
      c.fillStyle = lg2;
      c.beginPath();
      c.moveTo(sx + nx * 4, sy + ny * 4);
      c.lineTo(tx + nx * ht * 0.3, ty + ny * ht * 0.3);
      c.lineTo(tx - nx * ht * 0.3, ty - ny * ht * 0.3);
      c.lineTo(sx - nx * 4, sy - ny * 4);
      c.fill();
      // בוהק הפנס בקצה העליון
      const rg = c.createRadialGradient(sx, 0, 0, sx, 0, 120);
      rg.addColorStop(0, rgba(pal.white, 0.55 * I));
      rg.addColorStop(0.4, rgba(b.col, 0.2 * I));
      rg.addColorStop(1, rgba(b.col, 0));
      c.fillStyle = rg;
      c.fillRect(sx - 120, 0, 240, 120);
    }
    // חלקיקי אבק שמנצנצים בתוך האלומות
    if (ent > 0) {
      for (const m of motes) {
        const x = (((m.x + m.vx * t) % 1920) + 1920) % 1920;
        const y = (((m.y - m.vy * t) % 1080) + 1080) % 1080;
        let near = 0;
        for (const b of bm) {
          const sx = b.lx;
          const sy = -90;
          const dx = b.tx - sx;
          const dy = b.ty - sy;
          const u = clamp(((x - sx) * dx + (y - sy) * dy) / (dx * dx + dy * dy));
          const px = sx + dx * u;
          const py = sy + dy * u;
          const half = 12 + (150 - 50 * b.narrow) * u;
          const d = Math.hypot(x - px, y - py) / half;
          near = Math.max(near, (1 - clamp(d)) * b.inten);
        }
        const a = (0.05 + 0.75 * near) * (0.6 + 0.4 * Math.sin(t * 2 + m.ph)) * ent;
        if (a < 0.02) continue;
        c.fillStyle = rgba(pal.white, a);
        c.beginPath();
        c.arc(x, y, m.r, 0, TAU);
        c.fill();
      }
    }
    c.restore();
  }

  function drawFx(t: number, st: RankState[]): void {
    const c = fctx;
    c.clearRect(0, 0, 1920, 1080);
    const colors = pal.confetti;
    for (const it of items) {
      const s = st[it.rank]!;
      if (s.impact < 0) continue;
      const t0 = t - s.impact; // רגע הנחיתה
      const top = FLOOR - it.h;
      if (it.rank === 1 && !show.instant) {
        drawConfetti(
          c,
          {
            t0: t0 + 0.12,
            seed: 11,
            n: 170,
            x: 80,
            y: 1050,
            angle: -1.13,
            spread: 0.5,
            speed: [1500, 2700],
            g: 1500,
            k: 1.5,
            life: [3.2, 4.8],
            size: 22,
          },
          t,
          colors,
          q,
        );
        drawConfetti(
          c,
          {
            t0: t0 + 0.16,
            seed: 12,
            n: 170,
            x: 1840,
            y: 1050,
            angle: -Math.PI + 1.13,
            spread: 0.5,
            speed: [1500, 2700],
            g: 1500,
            k: 1.5,
            life: [3.2, 4.8],
            size: 22,
          },
          t,
          colors,
          q,
        );
        drawConfetti(
          c,
          {
            t0: t0 + 0.45,
            seed: 13,
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
            delay: 2.4,
          },
          t,
          colors,
          q,
        );
        drawSparks(
          c,
          {
            t0,
            seed: 14,
            n: 70,
            x: it.cx,
            y: top - 170,
            angle: 0,
            spread: TAU,
            speed: [600, 1500],
            g: 700,
            k: 2.4,
            life: [0.6, 1.4],
            width: 4.5,
            trail: 0.06,
            twinkle: true,
          },
          t,
          [goldW, pal.white, glowW],
        );
        // נצנוצים סביב האלוף
        if (s.impact > 0.8) {
          const R2 = rng(99);
          for (let k = 0; k < 12; k++) {
            const px = it.cx + (R2() - 0.5) * 560;
            const py = top - 60 - R2() * 300;
            const per = 1.6 + R2() * 1.4;
            const off = R2() * per;
            const size = 10 + R2() * 16;
            const u = ((s.impact + off) % per) / per;
            const a = Math.sin(Math.PI * clamp(u / 0.4)) * (u < 0.4 ? 1 : 0);
            if (a > 0.01) star4(c, px, py, size, rgba(pal.white), a * 0.95);
          }
          c.globalAlpha = 1;
        }
      } else {
        drawSparks(
          c,
          {
            t0,
            seed: 20 + it.rank,
            n: 26,
            x: it.cx,
            y: top - 4,
            angle: -Math.PI / 2,
            spread: 2.2,
            speed: [400, 900],
            g: 900,
            k: 2.6,
            life: [0.5, 1.0],
            width: 3.5,
            trail: 0.05,
          },
          t,
          [pal.white, glowW, it.metalLight],
        );
        drawConfetti(
          c,
          {
            t0: t0 + 0.02,
            seed: 30 + it.rank,
            n: 36,
            x: it.cx,
            y: top,
            w: it.w * 0.8,
            angle: -Math.PI / 2,
            spread: 1.0,
            speed: [500, 900],
            g: 1100,
            k: 1.8,
            life: [1.6, 2.4],
            size: 16,
          },
          t,
          colors,
          q,
        );
      }
    }
  }

  // ----------------------------------------------------------- פריים
  function frame(t: number): void {
    const te = t - show.enterT;
    const st: RankState[] = [];
    for (const it of items) st[it.rank] = stateOf(it, t, te);
    const bm = beams(t, st);
    for (const it of items) setBox(it, Math.max(0.5, st[it.rank]!.h));
    drawBg(t, te, st, bm);
    drawBeams(t, te, bm);
    drawFx(t, st);

    for (const it of items) {
      const s = st[it.rank]!;
      const dark = clamp(0.62 - s.lit * 0.62 + (1 - clamp(te / 0.6)) * 0.4);
      for (const f of it.faces) css(f.shade, 'opacity', dark.toFixed(3));
      // הלוח
      let op = 0;
      let sc = 0.5;
      let ty = 40;
      if (s.plate >= 0) {
        const k = prog(s.plate, 0.12, 0.62);
        op = clamp(k * 3);
        sc = lerp(0.45, 1, E.outBack(k, 2.2));
        ty = lerp(60, 0, E.outCubic(k));
        setScore(it.score, show.winner(it.rank).score * E.outCubic(prog(s.plate, 0.5, 1.7)));
      } else if (s.plate < -1) {
        const k = clamp((-1 - s.plate) / 0.3);
        op = 1 - k;
        sc = 1 - 0.2 * k;
        ty = 30 * k;
      }
      const bob = s.plate > 1.8 ? Math.sin(t * 1.6 + it.rank) * 3 : 0;
      css(it.plate, 'opacity', op.toFixed(3));
      css(it.plate, 'visibility', op > 0.001 ? 'visible' : 'hidden');
      css(
        it.plate,
        'transform',
        `translate(${it.cx}px,${(FLOOR - s.h - 8 + ty + bob).toFixed(1)}px) translate(-50%,-100%) scale(${(sc * it.fit).toFixed(4)})`,
      );
      if (it.crown) {
        const k = prog(s.plate, 0.45, 1.05);
        const y = lerp(-260, 0, E.outCubic(k)) + wobble(s.plate - 1.05, 16, 5, 20);
        const rot =
          wobble(s.plate - 0.9, 10, 3.5, 11) + (s.plate > 2 ? Math.sin(t * 1.8) * 2.5 : 0);
        css(it.crown, 'opacity', clamp(k * 4).toFixed(3));
        css(it.crown, 'transform', `translateY(${y.toFixed(1)}px) rotate(${rot.toFixed(2)}deg)`);
      }
    }
    const rays = raysEl as HTMLDivElement | null;
    if (rays && champ) {
      const s = st[1]!;
      const a = s.impact >= 0 ? clamp(s.impact / 0.5) * (0.85 + 0.15 * Math.sin(t * 2)) : 0;
      css(rays, 'opacity', a.toFixed(3));
      css(rays, 'visibility', a > 0.001 ? 'visible' : 'hidden');
      css(
        rays,
        'transform',
        `translate(${champ.cx}px,${(FLOOR - s.h - 230).toFixed(1)}px) rotate(${((t * 9) % 360).toFixed(2)}deg)`,
      );
    }
    // הכותרת
    const tk = E.outCubic(prog(te, 0.05, 0.8));
    css(title, 'opacity', tk.toFixed(3));
    css(title, 'transform', `translateY(${((1 - tk) * -50).toFixed(1)}px)`);
    css(flash, 'opacity', flashAlpha(show, t, 0.85, 0.2, 0).toFixed(3));
    const [sx, sy] = shake(show, t, 0.05);
    css(shakeEl, 'transform', `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`);
  }

  return {
    frame,
    destroy() {
      root.replaceChildren();
    },
  };
}

export const stageConcept: Concept = {
  create,
  sound: {
    reveal: () => ({
      cues: [
        { at: 0, name: 'whoosh', opts: { dur: 0.32, from: 400, to: 3600, gain: 0.35 } },
        { at: 0.03, name: 'impact', opts: { gain: 0.75 } },
        { at: 0.12, name: 'shimmer', opts: { gain: 0.12 } },
        { at: 0.5, name: 'ticks', opts: { dur: 1.2, count: 16 } },
      ],
      duck: { at: 0, level: 0.65, hold: 0.8, release: 1 },
    }),
    champion: () => ({
      cues: [
        { at: 0, name: 'drumroll', opts: { dur: SUSPENSE } },
        { at: 0.4, name: 'rise', opts: { dur: SUSPENSE - 0.4 } },
        { at: SUSPENSE, name: 'impact', opts: { gain: 1, decay: 1.1 } },
        { at: SUSPENSE, name: 'crash' },
        { at: SUSPENSE + 0.02, name: 'shimmer', opts: { gain: 0.16 } },
        { at: SUSPENSE + 0.05, name: 'fanfare' },
        { at: SUSPENSE + 0.12, name: 'pops' },
        { at: SUSPENSE + 0.5, name: 'applause', opts: { gain: 0.42 } },
        { at: SUSPENSE + 0.5, name: 'ticks', opts: { dur: 1.2, count: 18, gain: 0.05 } },
      ],
      duck: { at: 0, level: 0.3, hold: SUSPENSE + 2.6, release: 1.6, attack: 0.5 },
    }),
    all: (n) => ({
      cues: [
        { at: 0, name: 'whoosh', opts: { dur: 0.4, gain: 0.4 } },
        { at: 0.05, name: 'impact', opts: { gain: 0.8 } },
        { at: (n - 1) * 0.16, name: 'impact', opts: { gain: 0.9 } },
        { at: (n - 1) * 0.16, name: 'crash', opts: { gain: 0.3 } },
        { at: (n - 1) * 0.16 + 0.02, name: 'shimmer' },
        { at: (n - 1) * 0.16 + 0.1, name: 'pops', opts: { gain: 0.35 } },
        { at: (n - 1) * 0.16 + 0.3, name: 'applause', opts: { gain: 0.35 } },
      ],
      duck: { at: 0, level: 0.5, hold: 2, release: 1.4 },
    }),
  },
};
