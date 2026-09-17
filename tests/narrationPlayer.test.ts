/**
 * נגן הקריינות — שכבה נפרדת מ-AudioManager (ENGINE-narration.md סעיף 2).
 * הבדיקות מדמות AudioContext/fetch מלאים (סביבת Node) ומוודאות את ההתנהגויות
 * שהמשחק החי תלוי בהן: שיבוץ רציף של הקטעים, ביטול מיידי כשהמסך משתנה, קטע
 * שנכשל שמדולג בשקט, השתקה, ונעילת autoplay שאינה מייצרת תור.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NarrationPlayer } from '../src/app/narration/NarrationPlayer.ts';

/** אורך "הקובץ" לכל כתובת (שניות) — נקבע לכל בדיקה. */
let durations: Record<string, number> = {};
/** כתובות שהטעינה שלהן נכשלת. */
let broken = new Set<string>();
let fetched: string[] = [];

class FakeSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stopped = false;
  connected = false;
  connect(): void {
    this.connected = true;
  }
  disconnect(): void {
    this.connected = false;
  }
  start(at: number): void {
    this.startedAt = at;
  }
  stop(): void {
    this.stopped = true;
  }
}

class FakeGain {
  gain = { value: 1 };
  connect(): void {}
  disconnect(): void {}
}

class FakeContext {
  static instances: FakeContext[] = [];
  /** האם resume() באמת פותח את ההקשר (בדפדפן חסום הוא נשאר suspended). */
  static resumeWorks = true;
  state: 'running' | 'suspended' = 'running';
  currentTime = 10;
  destination = {};
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  closed = false;
  constructor() {
    FakeContext.instances.push(this);
  }
  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  decodeAudioData(bytes: unknown): Promise<{ duration: number }> {
    const url = String(bytes);
    return Promise.resolve({ duration: durations[url] ?? 1 });
  }
  resume(): Promise<void> {
    if (FakeContext.resumeWorks) this.state = 'running';
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

let winListeners: Record<string, () => void> = {};

function setup(): NarrationPlayer {
  durations = { 'a.mp3': 1, 'b.mp3': 2, 'c.mp3': 0.5 };
  broken = new Set();
  fetched = [];
  winListeners = {};
  FakeContext.instances = [];
  FakeContext.resumeWorks = true;
  vi.stubGlobal('window', {
    addEventListener: (type: string, cb: () => void) => (winListeners[type] = cb),
    removeEventListener: (type: string) => delete winListeners[type],
  });
  vi.stubGlobal('AudioContext', FakeContext as unknown as typeof AudioContext);
  vi.stubGlobal('fetch', (url: string) => {
    fetched.push(url);
    if (broken.has(url)) return Promise.resolve({ ok: false } as unknown as Response);
    return Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(url as unknown as ArrayBuffer),
    } as unknown as Response);
  });
  return new NarrationPlayer();
}

/** משחרר את כל ה-microtasks של הטעינה/הפענוח. */
const flush = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const ctx = () => FakeContext.instances[0]!;

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  FakeContext.instances = [];
});

describe('NarrationPlayer — שיבוץ רצף', () => {
  it('★ הקטעים מתנגנים אחד אחרי השני לפי אורכם (בלי חור בין קטעי מספר)', async () => {
    const player = setup();
    player.say(['a.mp3', 'b.mp3', 'c.mp3']);
    await flush();
    const started = ctx().sources.map((s) => s.startedAt);
    const t0 = started[0]!;
    expect(started).toEqual([t0, t0 + 1, t0 + 3]); // 1ש׳ ואז 2ש׳
    expect(t0).toBeGreaterThanOrEqual(ctx().currentTime);
  });

  it('רווח מוגדר מוסיף השהיה בין הקטעים', async () => {
    const player = setup();
    player.say(['a.mp3', 'b.mp3'], { gapMs: 120 });
    await flush();
    const started = ctx().sources.map((s) => s.startedAt);
    expect(started[1]! - started[0]!).toBeCloseTo(1.12, 5);
  });

  it('כל קטע נטען ומפוענח פעם אחת בלבד (מטמון לפי כתובת)', async () => {
    const player = setup();
    player.say(['a.mp3', 'a.mp3']);
    await flush();
    player.say(['a.mp3']);
    await flush();
    expect(fetched.filter((u) => u === 'a.mp3')).toHaveLength(1);
  });

  it('מדבר בזמן ההשמעה, ומודיע על כך', async () => {
    const player = setup();
    const seen: boolean[] = [];
    player.onSpeakingChange((speaking) => seen.push(speaking));
    expect(player.isSpeaking()).toBe(false);
    player.say(['a.mp3']);
    await flush();
    expect(player.isSpeaking()).toBe(true);
    expect(seen).toEqual([true]);
    ctx().sources[0]!.onended?.();
    expect(player.isSpeaking()).toBe(false);
    expect(seen).toEqual([true, false]);
  });
});

describe('NarrationPlayer — ביטול (המסך מוביל)', () => {
  it('★ cancel עוצר מיד את כל המשובצים', async () => {
    const player = setup();
    player.say(['a.mp3', 'b.mp3']);
    await flush();
    player.cancel();
    expect(ctx().sources.every((s) => s.stopped)).toBe(true);
    expect(player.isSpeaking()).toBe(false);
  });

  it('★ say חדש מבטל את הקודם, וגם משפט שנטען באיחור לא "מתעורר" אחריו', async () => {
    const player = setup();
    player.say(['a.mp3']);
    player.say(['b.mp3']); // הקודם עוד באוויר (טעינה) — חייב להיזנח
    await flush();
    const playing = ctx().sources.filter((s) => !s.stopped);
    expect(playing).toHaveLength(1);
    expect(playing[0]!.buffer).toEqual({ duration: 2 }); // b בלבד
  });

  it('say אחרי cancel עובד כרגיל', async () => {
    const player = setup();
    player.say(['a.mp3']);
    await flush();
    player.cancel();
    player.say(['c.mp3']);
    await flush();
    const playing = ctx().sources.filter((s) => !s.stopped);
    expect(playing).toHaveLength(1);
    expect(playing[0]!.buffer).toEqual({ duration: 0.5 });
  });
});

describe('NarrationPlayer — לעולם לא חוסם', () => {
  it('★ קטע שלא נטען מדולג בשקט, והמשפט ממשיך', async () => {
    const player = setup();
    broken.add('b.mp3');
    player.say(['a.mp3', 'b.mp3', 'c.mp3']);
    await flush();
    expect(ctx().sources).toHaveLength(2);
    const started = ctx().sources.map((s) => s.startedAt);
    expect(started[1]! - started[0]!).toBe(1); // c מיד אחרי a
  });

  it('כישלון נשמר במטמון — לא מנסים שוב באותו משחק', async () => {
    const player = setup();
    broken.add('a.mp3');
    player.say(['a.mp3']);
    await flush();
    player.say(['a.mp3']);
    await flush();
    expect(fetched.filter((u) => u === 'a.mp3')).toHaveLength(1);
    expect(ctx().sources).toHaveLength(0);
  });

  it('משפט שכל קטעיו נכשלו — פשוט שקט', async () => {
    const player = setup();
    broken.add('a.mp3');
    player.say(['a.mp3']);
    await flush();
    expect(player.isSpeaking()).toBe(false);
  });
});

describe('NarrationPlayer — ווליום והשתקה', () => {
  it('הווליום חי דרך ה-GainNode הראשי', async () => {
    const player = setup();
    player.say(['a.mp3']);
    await flush();
    player.setVolume(0.4);
    expect(ctx().gains[0]!.gain.value).toBeCloseTo(0.4, 5);
  });

  it('★ השתקה עוצרת את מה שמתנגן ואינה מנגנת חדש', async () => {
    const player = setup();
    player.say(['a.mp3']);
    await flush();
    player.setMuted(true);
    expect(ctx().sources.every((s) => s.stopped)).toBe(true);
    player.say(['b.mp3']);
    await flush();
    expect(ctx().sources).toHaveLength(1); // לא נוצר מקור חדש
    expect(ctx().gains[0]!.gain.value).toBe(0);
  });
});

describe('NarrationPlayer — נעילת autoplay', () => {
  it('★ משפט שנאמר בזמן נעילה נזרק ואינו נשמר לתור', async () => {
    FakeContext.resumeWorks = false;
    const player = setup();
    FakeContext.resumeWorks = false;
    player.say(['a.mp3']);
    // ההקשר נוצר בטעינה — מסמנים אותו כנעול לפני שהשיבוץ קורה
    ctx().state = 'suspended';
    await flush();
    expect(ctx().sources).toHaveLength(0);
    // אינטראקציה פותחת את ההקשר, אבל המשפט הישן *לא* חוזר לבד
    FakeContext.resumeWorks = true;
    winListeners.keydown?.();
    await flush();
    expect(ctx().sources).toHaveLength(0);
  });

  it('dispose מסיר את המאזינים וסוגר את ההקשר', async () => {
    const player = setup();
    player.say(['a.mp3']);
    await flush();
    player.dispose();
    expect(ctx().closed).toBe(true);
    expect(winListeners.keydown).toBeUndefined();
    expect(ctx().sources.every((s) => s.stopped)).toBe(true);
  });
});

describe('NarrationPlayer — טעינה מוקדמת', () => {
  it('טוענת מראש ולא זורקת גם כשהכול נכשל', async () => {
    const player = setup();
    broken.add('b.mp3');
    await player.preload(['a.mp3', 'b.mp3', '']);
    expect(fetched.sort()).toEqual(['a.mp3', 'b.mp3']);
    // ומה שנטען מראש אינו נמשך שוב באמירה
    player.say(['a.mp3']);
    await flush();
    expect(fetched.filter((u) => u === 'a.mp3')).toHaveLength(1);
  });
});

describe('NarrationPlayer — סביבה בלי Web Audio', () => {
  it('בלי AudioContext הכול שקט, בלי לזרוק', async () => {
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
    vi.stubGlobal('AudioContext', undefined);
    const player = new NarrationPlayer();
    expect(() => player.say(['a.mp3'])).not.toThrow();
    await flush();
    expect(player.isSpeaking()).toBe(false);
    player.dispose();
  });
});
