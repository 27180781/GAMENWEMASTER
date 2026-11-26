/**
 * מריץ את מסך המנצחים: בונה את הסגנון שנבחר בתוך אלמנט, מצייר אותו בכל פריים
 * (requestAnimationFrame), ומתרגם את מספר המקומות החשופים שמגיע מבחוץ לחשיפות
 * עם אנימציה וצליל.
 *
 * הסצנה עצמה נגזרת מהזמן בלבד (Show + frame(t)), ולכן אפשר לבנות אותה מחדש בכל
 * רגע (שינוי גודל החלון, גופן שנטען) בלי לאבד את מצב החשיפה.
 */

import type { WinnersStyle } from '../../engine/winnersStyles.ts';
import { cardsConcept } from './cards.ts';
import { clamp, makePalette } from './core.ts';
import { medalsConcept } from './medals.ts';
import { Show, type Concept, type ConceptScene } from './show.ts';
import type { WinnersSoundSink } from './soundContext.ts';
import { stageConcept } from './stage.ts';

export const CONCEPTS: Record<WinnersStyle, Concept> = {
  stage: stageConcept,
  cards: cardsConcept,
  medals: medalsConcept,
};

export interface WinnersSpec {
  style: WinnersStyle;
  /** מהמקום הראשון והלאה. */
  winners: readonly { name: string; score: number }[];
  main: string;
  secondary: string;
  title: string;
}

/** שתי חשיפות שהגיעו יחד (לחיצה כפולה) — השנייה אחרי הראשונה בהפרש הזה. */
export const REVEAL_STAGGER = 0.45;
/** «נחת מזמן»: מקום שנחשף בלי אנימציה (כניסה באמצע, דילוג על כמה מקומות). */
export const LANDED = -1000;

export type RevealStep = { kind: 'next'; at: number; sound: boolean } | { kind: 'back' };

/**
 * מה עושים כשמספר המקומות החשופים משתנה מ-from ל-to: חשיפה אחת או שתיים — עם
 * אנימציה וצליל (השנייה מעט אחרי הראשונה); יותר משתיים — הקודמות נוחתות בשקט,
 * והאחרונה עם אנימציה. ירידה — הסתרה של המקומות האחרונים שנחשפו.
 */
export function revealSteps(from: number, to: number): RevealStep[] {
  const steps: RevealStep[] = [];
  if (to < from) {
    for (let i = from; i > to; i--) steps.push({ kind: 'back' });
    return steps;
  }
  const diff = to - from;
  if (diff <= 2) {
    for (let i = 0; i < diff; i++)
      steps.push({ kind: 'next', at: i * REVEAL_STAGGER, sound: true });
    return steps;
  }
  for (let i = 0; i < diff - 1; i++) steps.push({ kind: 'next', at: LANDED, sound: false });
  steps.push({ kind: 'next', at: 0, sound: true });
  return steps;
}

/** מפתח להשוואת מפרטים (שם, ניקוד, צבעים...) — כדי לא לבנות מחדש בכל רינדור. */
export function specKey(spec: WinnersSpec): string {
  return JSON.stringify([
    spec.style,
    spec.main,
    spec.secondary,
    spec.title,
    spec.winners.map((w) => [w.name, w.score]),
  ]);
}

/** יחס הרזולוציה של הקנבסים: לפי הגודל האמיתי על המסך, בין חצי למלא. */
export function canvasScale(cssWidth: number, dpr: number): number {
  if (!(cssWidth > 0)) return 1;
  return Math.round(clamp((cssWidth / 1920) * (dpr > 0 ? dpr : 1), 0.5, 1) * 100) / 100;
}

const now = (): number => performance.now() / 1000;
/** טקסט עברי לבדיקת הגופן — גופן עם unicode-range נטען רק בשבילו. */
const FONT_SAMPLE = 'אבגד 123';
let instances = 0;

export interface RunnerOptions {
  /** כמה מקומות חשופים; undefined = כולם יחד (מסך צפייה של מסך ראשי ישן, הגלריה). */
  revealed: number | undefined;
  sink: WinnersSoundSink | null;
  /** שכבה אחרת (דירוג הקבוצות) מעל המסך — הכניסה מתחילה רק כשהיא יורדת. */
  covered?: boolean;
}

export class WinnersRunner {
  private readonly host: HTMLElement;
  private readonly uid: string;
  private spec: WinnersSpec;
  private key: string;
  private show: Show;
  private revealed: number | undefined;
  private sink: WinnersSoundSink | null;
  private covered: boolean;
  private scene: ConceptScene | null = null;
  private root: HTMLDivElement | null = null;
  private q = 1;
  private family = '';
  /** גופנים שכבר חיכינו להם — גופן שנכשל בטעינה לא יבנה את המסך שוב ושוב. */
  private readonly fontsWaited = new Set<string>();
  private raf = 0;
  private errors = 0;
  private destroyed = false;
  private prepTimer: number | null = null;
  private readonly onResize = () => {
    const q = this.measureScale();
    if (Math.abs(q - this.q) / this.q > 0.15) this.build();
  };
  private readonly tick = () => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.tick);
    if (this.scene === null) return;
    try {
      this.scene.frame(now());
      this.errors = 0;
    } catch (err) {
      // תקלה בציור — לא מציפים את היומן בכל פריים; אחרי כמה ברצף עוצרים בתמונה האחרונה
      this.errors += 1;
      if (this.errors === 1) console.error('winners screen frame failed', err);
      if (this.errors >= 3) cancelAnimationFrame(this.raf);
    }
  };

  constructor(host: HTMLElement, spec: WinnersSpec, opts: RunnerOptions) {
    instances += 1;
    this.uid = `w${instances}`;
    this.host = host;
    this.spec = spec;
    this.key = specKey(spec);
    this.sink = opts.sink;
    this.covered = opts.covered ?? false;
    this.revealed =
      opts.revealed === undefined ? undefined : this.clampCount(opts.revealed, spec.winners.length);
    this.show = this.freshShow(spec);
    const t = now();
    this.show.enterT = t;
    if (this.revealed === undefined) {
      this.show.all(t);
      this.playPlan('all');
    } else {
      for (let i = 0; i < this.revealed; i++) this.show.next(t + LANDED);
    }
    this.build();
    window.addEventListener('resize', this.onResize);
    this.attachSink();
    this.raf = requestAnimationFrame(this.tick);
  }

  /** כמה מקומות חשופים השתנה (לחיצה של המנחה, או צעד אחורה). */
  setRevealed(value: number | undefined): void {
    if (this.destroyed) return;
    const n = this.show.n;
    const t = now();
    if (value === undefined) {
      if (this.revealed === undefined) return;
      this.revealed = undefined;
      this.show.all(t);
      this.playPlan('all');
      return;
    }
    const to = this.clampCount(value, n);
    const from = this.revealed ?? n;
    this.revealed = to;
    let backed = false;
    for (const step of revealSteps(from, to)) {
      if (step.kind === 'back') {
        backed = this.show.back(t) !== null || backed;
        continue;
      }
      const rank = this.show.next(t + step.at);
      if (rank !== null && step.sound) this.playReveal(rank, Math.max(0, step.at));
    }
    if (backed) this.sink?.stopWinnersSound();
  }

  /** המנצחים, הצבעים, הסגנון או הכותרת השתנו. */
  setSpec(spec: WinnersSpec): void {
    if (this.destroyed) return;
    const key = specKey(spec);
    if (key === this.key) return;
    const prev = this.show;
    this.spec = spec;
    this.key = key;
    this.show = this.freshShow(spec);
    const sameCount = prev.n === this.show.n;
    this.show.enterT = prev.enterT;
    this.show.instant = prev.instant;
    if (sameCount) {
      // אותם מקומות — ממשיכים בדיוק מאותה נקודה (גם באמצע אנימציה)
      Object.assign(this.show.revealT, prev.revealT);
      Object.assign(this.show.hideT, prev.hideT);
      this.show.k = prev.k;
    } else if (this.revealed === undefined) {
      this.show.all(now() + LANDED);
    } else {
      const t = now();
      const k = Math.min(prev.k, this.show.n);
      for (let i = 0; i < k; i++) this.show.next(t + LANDED);
      this.revealed = k;
    }
    this.build();
  }

  setSink(sink: WinnersSoundSink | null): void {
    if (this.destroyed || sink === this.sink) return;
    this.detachSink();
    this.sink = sink;
    this.attachSink();
  }

  setCovered(covered: boolean): void {
    if (this.destroyed) return;
    // השכבה שמעל ירדה לפני שנחשף משהו — המסך נכנס עכשיו, מול הקהל
    if (this.covered && !covered && this.show.k === 0 && this.revealed !== undefined)
      this.show.enterT = now();
    this.covered = covered;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.detachSink();
    this.scene?.destroy();
    this.scene = null;
    this.root?.remove();
    this.root = null;
  }

  // -------------------------------------------------------------------------

  private clampCount(value: number, n: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.min(n, Math.floor(value))) : 0;
  }

  private freshShow(spec: WinnersSpec): Show {
    return new Show(spec.winners, makePalette(spec.main, spec.secondary), spec.title);
  }

  private measureScale(): number {
    const rect = this.host.getBoundingClientRect();
    return canvasScale(rect.width, window.devicePixelRatio);
  }

  /** בונה (או בונה מחדש) את הסצנה לפי הגודל והגופן הנוכחיים. */
  private build(): void {
    this.scene?.destroy();
    this.root?.remove();
    this.q = this.measureScale();
    const family = getComputedStyle(this.host).fontFamily || 'Kanuba, sans-serif';
    this.family = family;
    const root = document.createElement('div');
    root.className = 'ws-scene';
    this.host.appendChild(root);
    this.root = root;
    this.scene = CONCEPTS[this.spec.style].create(root, this.show, {
      q: this.q,
      family,
      uid: this.uid,
    });
    this.errors = 0;
    this.scene.frame(now());
    this.waitForFont(family);
  }

  /** השמות נמדדים בגופן של ערכת הנושא; אם עוד לא נטען — בונים שוב כשהוא מוכן. */
  private waitForFont(family: string): void {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (fonts === undefined || this.fontsWaited.has(family)) return;
    const spec = `700 40px ${family}`;
    let ready = true;
    try {
      ready = fonts.check(spec, FONT_SAMPLE);
    } catch {
      return;
    }
    if (ready) return;
    this.fontsWaited.add(family);
    fonts
      .load(spec, FONT_SAMPLE)
      .then(() => {
        if (!this.destroyed && this.family === family) this.build();
      })
      .catch(() => {});
  }

  private attachSink(): void {
    const sink = this.sink;
    if (sink === null) return;
    sink.setWinnersScreen(this.revealed !== undefined);
    // המאגרים נבנים כשיש זמן פנוי, אחרי שהמסך עלה
    this.prepTimer = window.setTimeout(() => {
      this.prepTimer = null;
      if (!this.destroyed && this.sink === sink) sink.prepareWinnersSound();
    }, 400);
  }

  private detachSink(): void {
    if (this.prepTimer !== null) {
      window.clearTimeout(this.prepTimer);
      this.prepTimer = null;
    }
    const sink = this.sink;
    if (sink === null) return;
    sink.stopWinnersSound();
    sink.setWinnersScreen(false);
  }

  private playReveal(rank: number, delay: number): void {
    const sound = CONCEPTS[this.spec.style].sound;
    const n = this.show.n;
    this.sink?.playWinnersSound(rank === 1 ? sound.champion(n) : sound.reveal(rank, n), delay);
  }

  private playPlan(kind: 'all'): void {
    if (kind === 'all' && this.show.n > 0)
      this.sink?.playWinnersSound(CONCEPTS[this.spec.style].sound.all(this.show.n));
  }
}
