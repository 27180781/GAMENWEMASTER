/**
 * מסך המנצחים בקוד (src/render/winners/): הסגנון בקובץ המשחק, הכללים הטהורים של
 * החשיפה (כמה מקומות, צעדים, מפתח המפרט, רזולוציית הקנבסים), תוכניות הצליל של
 * שלושת הסגנונות, וצליל המנצחים ב-AudioManager כמוזיקת רקע שמתכופפת.
 *
 * הציור עצמו נבדק בדפדפן אמיתי (npm run shots, tools/sound-e2e.mjs).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeWinnersStyle,
  WINNERS_CHAMPION_GUARD_MS,
  WINNERS_CHAMPION_SPEAK_MS,
  WINNERS_MAX,
  WINNERS_STYLES,
  WINNERS_STYLE_LABELS,
  winnersShownCount,
  type WinnersStyle,
} from '../src/engine/index.ts';
import { HIDDEN_SETTINGS, SETTINGS_SECTIONS } from '../src/app/editorLayout.ts';
import { AudioManager } from '../src/app/AudioManager.ts';
import {
  CUE_NAMES,
  duckEnd,
  duckLevelAt,
  WINNERS_BED_LEVEL,
  type DuckSpec,
  type SoundPlan,
} from '../src/app/winnersSynth.ts';
import { makePalette, SUSPENSE } from '../src/render/winners/core.ts';
import { Show, rankPhase } from '../src/render/winners/show.ts';
import {
  CONCEPTS,
  LANDED,
  REVEAL_STAGGER,
  canvasScale,
  revealSteps,
  specKey,
  type WinnersSpec,
} from '../src/render/winners/runner.ts';
import { makeGame, rawGame, rawSlide, fourAnswers } from './helpers.ts';

function gameWith(setting: Record<string, unknown>, drop: string[] = []) {
  const base = rawGame([rawSlide({ id: 1, type: 'trivia', que: 'שאלה', answers: fourAnswers(2) })]);
  const merged: Record<string, unknown> = {
    ...(base['setting'] as Record<string, unknown>),
    ...setting,
  };
  for (const key of drop) delete merged[key];
  return makeGame(base['questions'] as Record<string, unknown>[], { setting: merged });
}

describe('setting.winnersStyle', () => {
  it('חסר ⇒ «הבמה» (גם קובץ ישן מקבל את המסך החדש)', () => {
    expect(gameWith({}, ['winnersStyle']).setting.winnersStyle).toBe('stage');
  });

  it.each(WINNERS_STYLES)('הסגנון %s נשמר', (style) => {
    expect(gameWith({ winnersStyle: style }).setting.winnersStyle).toBe(style);
  });

  it('ערך לא מוכר או שאינו מחרוזת ⇒ «הבמה», בלי לפסול את הקובץ', () => {
    for (const v of ['disco', 'Stage', '', 42, true, null, { style: 'cards' }]) {
      expect(normalizeWinnersStyle(v)).toBe('stage');
      expect(gameWith({ winnersStyle: v }).setting.winnersStyle).toBe('stage');
    }
  });

  it('לכל סגנון יש שם בעברית', () => {
    for (const style of WINNERS_STYLES)
      expect(WINNERS_STYLE_LABELS[style].length).toBeGreaterThan(0);
  });
});

describe('setting.winnersMedia (רקע המסך הישן)', () => {
  it('קובץ בלי השדה נטען, עם רקע ריק', () => {
    const game = gameWith({}, ['winnersMedia']);
    expect(game.setting.winnersMedia.src).toBe('');
  });

  it('קובץ שעדיין שולח אותו (בונה ישן או חדש) נטען כרגיל', () => {
    const game = gameWith({ winnersMedia: { src: 'https://cdn/podium.mp4' } });
    expect(game.setting.winnersMedia.src).toBe('https://cdn/podium.mp4');
  });

  it('העורך המקומי לא מציע אותו, ומציע את הסגנון תחת «עיצוב»', () => {
    expect(HIDDEN_SETTINGS).toContain('winnersMedia');
    const design = SETTINGS_SECTIONS.find((s) => s.id === 'design');
    expect(design?.keys).toContain('winnersStyle');
    for (const section of SETTINGS_SECTIONS) expect(section.keys).not.toContain('winnersMedia');
  });
});

describe('כמה מקומות מוצגים', () => {
  it('לא יותר מ-5 ולא יותר ממי שיש', () => {
    expect(WINNERS_MAX).toBe(5);
    expect(winnersShownCount(0)).toBe(0);
    expect(winnersShownCount(3)).toBe(3);
    expect(winnersShownCount(5)).toBe(5);
    expect(winnersShownCount(40)).toBe(5);
    expect(winnersShownCount(-2)).toBe(0);
  });

  it('הרווח אחרי המקום הראשון מחכה לסוף התיפוף', () => {
    expect(WINNERS_CHAMPION_GUARD_MS).toBeGreaterThanOrEqual(SUSPENSE * 1000);
  });

  it('הקריין מכריז על המקום הראשון אחרי התיפוף, ולפני שרווח יכול לעבור למסך הניקוד', () => {
    expect(WINNERS_CHAMPION_SPEAK_MS).toBeGreaterThan(SUSPENSE * 1000);
    expect(WINNERS_CHAMPION_SPEAK_MS).toBeLessThanOrEqual(WINNERS_CHAMPION_GUARD_MS);
  });
});

describe('revealSteps — רווח אחד, לחיצה כפולה, דילוג וחזרה', () => {
  it('מקום אחד: חשיפה מיד, עם צליל', () => {
    expect(revealSteps(0, 1)).toEqual([{ kind: 'next', at: 0, sound: true }]);
  });

  it('שתי חשיפות יחד: השנייה מעט אחרי הראשונה, שתיהן עם צליל', () => {
    expect(revealSteps(1, 3)).toEqual([
      { kind: 'next', at: 0, sound: true },
      { kind: 'next', at: REVEAL_STAGGER, sound: true },
    ]);
  });

  it('דילוג על כמה מקומות: הקודמים נוחתים בשקט, רק האחרון באנימציה', () => {
    expect(revealSteps(0, 4)).toEqual([
      { kind: 'next', at: LANDED, sound: false },
      { kind: 'next', at: LANDED, sound: false },
      { kind: 'next', at: LANDED, sound: false },
      { kind: 'next', at: 0, sound: true },
    ]);
  });

  it('חזרה: צעד אחורה לכל מקום שהוסתר', () => {
    expect(revealSteps(3, 1)).toEqual([{ kind: 'back' }, { kind: 'back' }]);
    expect(revealSteps(2, 2)).toEqual([]);
  });
});

describe('canvasScale — רזולוציית הקנבסים לפי הגודל האמיתי', () => {
  it('מסך מלא 1920 — רזולוציה מלאה', () => {
    expect(canvasScale(1920, 1)).toBe(1);
  });

  it('חלון קטן — פחות פיקסלים, לא פחות מחצי', () => {
    expect(canvasScale(1280, 1)).toBe(0.67);
    expect(canvasScale(960, 1)).toBe(0.5);
    expect(canvasScale(400, 1)).toBe(0.5);
  });

  it('מסך צפוף (dpr 2) — עד הרזולוציה המלאה ולא יותר', () => {
    expect(canvasScale(1280, 2)).toBe(1);
    expect(canvasScale(1920, 3)).toBe(1);
  });

  it('גודל לא ידוע (עדיין לא בעמוד) — מלא', () => {
    expect(canvasScale(0, 1)).toBe(1);
    expect(canvasScale(Number.NaN, 1)).toBe(1);
  });
});

describe('specKey — בונים מחדש רק כשמשהו השתנה', () => {
  const base: WinnersSpec = {
    style: 'stage',
    winners: [
      { name: 'משה כהן', score: 30 },
      { name: 'שרה לוי', score: 21 },
    ],
    main: '#6d28d9',
    secondary: '#ffffff',
    title: 'חידון',
  };

  it('אותו תוכן — אותו מפתח (גם אובייקט חדש בכל רינדור)', () => {
    expect(specKey({ ...base, winners: base.winners.map((w) => ({ ...w })) })).toBe(specKey(base));
  });

  it('כל שינוי — מפתח אחר', () => {
    const k = specKey(base);
    expect(specKey({ ...base, style: 'cards' })).not.toBe(k);
    expect(specKey({ ...base, main: '#000000' })).not.toBe(k);
    expect(specKey({ ...base, secondary: '#000000' })).not.toBe(k);
    expect(specKey({ ...base, title: 'אחר' })).not.toBe(k);
    expect(
      specKey({ ...base, winners: [{ name: 'משה כהן', score: 31 }, base.winners[1]!] }),
    ).not.toBe(k);
    expect(specKey({ ...base, winners: [base.winners[0]!] })).not.toBe(k);
  });
});

describe('Show — סדר החשיפה והתיפוף', () => {
  const winners = [
    { name: 'א', score: 30 },
    { name: 'ב', score: 20 },
    { name: 'ג', score: 10 },
  ];
  const fresh = () => new Show(winners, makePalette('#6d28d9', '#ffffff'), 'חידון');

  it('מהמקום האחרון לראשון, וחזרה מסתירה את האחרון שנחשף', () => {
    const show = fresh();
    expect(show.next(10)).toBe(3);
    expect(show.next(11)).toBe(2);
    expect(show.back(12)).toBe(2);
    expect(show.next(13)).toBe(2);
    expect(show.next(14)).toBe(1);
    expect(show.next(15)).toBeNull();
    expect(show.k).toBe(3);
  });

  it('המקום הראשון נחשף אחרי התיפוף; השאר מיד', () => {
    const show = fresh();
    show.next(0);
    show.next(1);
    show.next(2);
    expect(rankPhase(show, 3, 5).vis).toBe(5);
    expect(rankPhase(show, 1, 5).vis).toBe(3 - SUSPENSE);
    expect(rankPhase(show, 1, 5).tau).toBe(3);
  });

  it('«כולם יחד» (שקופית «מסך»): בלי תיפוף, במדרגות קצרות מהאחרון', () => {
    const show = fresh();
    show.all(100);
    expect(show.k).toBe(3);
    expect(show.instant).toBe(true);
    expect(show.revealT[3]).toBe(100);
    expect(show.revealT[1]).toBeGreaterThan(show.revealT[2]!);
    expect(rankPhase(show, 1, 101).vis).toBeCloseTo(101 - show.revealT[1]!);
  });

  it('מקום שלא נחשף — לא דולק', () => {
    const show = fresh();
    show.next(0);
    const ph = rankPhase(show, 1, 5);
    expect(ph.on).toBe(false);
    expect(ph.out).toBe(Infinity);
  });
});

describe('תוכניות הצליל של שלושת הסגנונות', () => {
  const known = new Set<string>(CUE_NAMES);

  function checkPlan(plan: SoundPlan, label: string): void {
    expect(plan.cues.length, label).toBeGreaterThan(0);
    for (const cue of plan.cues) {
      expect(known.has(cue.name), `${label}: ${cue.name}`).toBe(true);
      expect(Number.isFinite(cue.at) && cue.at >= 0, `${label}: at=${cue.at}`).toBe(true);
    }
    if (plan.duck !== undefined) {
      const d: DuckSpec = plan.duck;
      expect(d.level, label).toBeGreaterThanOrEqual(0);
      expect(d.level, label).toBeLessThanOrEqual(1);
      expect(d.hold, label).toBeGreaterThanOrEqual(0);
      expect(duckEnd(d), label).toBeLessThan(30);
    }
  }

  const styles = Object.keys(CONCEPTS) as WinnersStyle[];

  it('יש סגנון לכל ערך', () => {
    expect([...styles].sort()).toEqual([...WINNERS_STYLES].sort());
  });

  it.each(styles)('%s: כל חשיפה, המקום הראשון ו«כולם יחד», לכל מספר מנצחים', (style) => {
    const sound = CONCEPTS[style].sound;
    for (let n = 1; n <= WINNERS_MAX; n++) {
      for (let rank = 2; rank <= n; rank++)
        checkPlan(sound.reveal(rank, n), `${style} reveal ${rank}/${n}`);
      checkPlan(sound.champion(n), `${style} champion ${n}`);
      checkPlan(sound.all(n), `${style} all ${n}`);
    }
  });

  it.each(styles)('%s: המקום הראשון — תיפוף ואז החבטה, והמוזיקה מתכופפת', (style) => {
    const plan = CONCEPTS[style].sound.champion(3);
    expect(plan.duck).toBeDefined();
    const last = Math.max(...plan.cues.map((c) => c.at));
    expect(last).toBeGreaterThanOrEqual(SUSPENSE - 0.2);
  });
});

describe('הנמכת צליל המנצחים בזמן חשיפה', () => {
  const duck: DuckSpec = { at: 0.5, level: 0.3, hold: 1, attack: 0.2, release: 1 };

  it('לפני — מהרמה הנוכחית; בשיא — ברמת ההנמכה; אחרי — חוזר למלא', () => {
    expect(duckLevelAt(duck, 0, 1)).toBe(1);
    expect(duckLevelAt(duck, 0.2, 0.6)).toBe(0.6);
    expect(duckLevelAt(duck, 0.8, 1)).toBe(0.3);
    expect(duckLevelAt(duck, duckEnd(duck) + 0.01, 1)).toBe(1);
  });

  it('עולה בהדרגה בשחרור', () => {
    let prev = duckLevelAt(duck, 1.7, 1);
    for (let s = 1.8; s < duckEnd(duck); s += 0.1) {
      const v = duckLevelAt(duck, s, 1);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

// ---------------------------------------------------------------------------
// AudioManager — צליל המנצחים כמוזיקת רקע (Audio ו-window מדומים לסביבת Node)
// ---------------------------------------------------------------------------

class FakeAudio {
  static instances: FakeAudio[] = [];
  paused = false;
  playing = false;
  loop = false;
  volume = 1;
  ended = false;
  constructor(public src: string) {
    FakeAudio.instances.push(this);
  }
  addEventListener(): void {}
  play(): Promise<void> {
    this.playing = true;
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.playing = false;
    this.paused = true;
  }
}

function setupAudio(): AudioManager {
  FakeAudio.instances = [];
  const listeners: Record<string, () => void> = {};
  vi.stubGlobal('window', {
    addEventListener: (type: string, cb: () => void) => (listeners[type] = cb),
    removeEventListener: (type: string) => delete listeners[type],
  });
  vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio);
  const manager = new AudioManager();
  listeners['keydown']?.();
  return manager;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AudioManager — מסך המנצחים', () => {
  it('בזמן המסך צליל המנצחים מעט נמוך יותר, ושאר הערוצים לא', () => {
    const manager = setupAudio();
    manager.setWinnersScreen(true);
    manager.play('winners', 'w.mp3', { loop: true });
    const bed = FakeAudio.instances[0]!;
    expect(bed.volume).toBeCloseTo(WINNERS_BED_LEVEL);
    manager.play('winnersList', 'l.mp3');
    expect(FakeAudio.instances[1]!.volume).toBe(1);
  });

  it('כשהמסך יורד — חוזר לווליום המלא', () => {
    const manager = setupAudio();
    manager.play('winners', 'w.mp3', { loop: true });
    const bed = FakeAudio.instances[0]!;
    expect(bed.volume).toBe(1);
    manager.setWinnersScreen(true);
    expect(bed.volume).toBeCloseTo(WINNERS_BED_LEVEL);
    manager.setWinnersScreen(false);
    expect(bed.volume).toBe(1);
  });

  it('חשיפה מכופפת את המוזיקה וחוזרת, ו-stopAll מחזיר מיד', () => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'],
    });
    const manager = setupAudio();
    manager.setWinnersScreen(true);
    manager.play('winners', 'w.mp3', { loop: true });
    const bed = FakeAudio.instances[0]!;
    // בלי AudioContext (Node) האפקטים מדלגים — אבל ההנמכה עדיין חלה
    expect(() =>
      manager.playWinnersSound({
        cues: [{ name: CUE_NAMES[0]!, at: 0 }],
        duck: { at: 0, level: 0.4, hold: 1 },
      }),
    ).not.toThrow();
    vi.advanceTimersByTime(600);
    expect(bed.volume).toBeCloseTo(WINNERS_BED_LEVEL * 0.4, 2);
    vi.advanceTimersByTime(3000);
    expect(bed.volume).toBeCloseTo(WINNERS_BED_LEVEL);

    manager.playWinnersSound({ cues: [], duck: { at: 0, level: 0.2, hold: 5 } });
    vi.advanceTimersByTime(500);
    expect(bed.volume).toBeLessThan(WINNERS_BED_LEVEL * 0.5);
    manager.stopWinnersSound();
    expect(bed.volume).toBeCloseTo(WINNERS_BED_LEVEL);
  });

  it('בלי המסך — חשיפה לא נוגעת בווליום', () => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'],
    });
    const manager = setupAudio();
    manager.play('winners', 'w.mp3', { loop: true });
    manager.playWinnersSound({ cues: [], duck: { at: 0, level: 0.2, hold: 1 } });
    vi.advanceTimersByTime(500);
    expect(FakeAudio.instances[0]!.volume).toBe(1);
  });

  it('ווליום המפעיל חל גם על צליל המנצחים בזמן המסך', () => {
    const manager = setupAudio();
    manager.setWinnersScreen(true);
    manager.play('winners', 'w.mp3', { loop: true });
    manager.setVolume(0.5);
    expect(FakeAudio.instances[0]!.volume).toBeCloseTo(0.5 * WINNERS_BED_LEVEL);
  });
});
