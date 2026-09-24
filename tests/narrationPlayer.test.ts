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
  /** מצב ההקשר ביצירה: running = autoplay מותר; suspended = נעול עד אינטראקציה. */
  static initialState: 'running' | 'suspended' = 'running';
  /**
   * resume "איטי" כמו בדפדפן אמיתי: כשזה מערך, כל resume() נפתח רק כשהבדיקה
   * קוראת לאחת הפונקציות שנאספו בו.
   */
  static pendingResumes: (() => void)[] | null = null;
  state: 'running' | 'suspended' = FakeContext.initialState;
  onstatechange: (() => void) | null = null;
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
    const open = () => {
      if (!FakeContext.resumeWorks || this.state === 'running') return;
      this.state = 'running';
      this.onstatechange?.();
    };
    if (FakeContext.pendingResumes !== null) {
      const pending = FakeContext.pendingResumes;
      return new Promise((resolve) => pending.push(() => (open(), resolve())));
    }
    open();
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

let winListeners: Record<string, () => void> = {};
/** האם המאזין נרשם בשלב ה-capture (לפני המאזינים של האפליקציה עצמה). */
let winCapture: Record<string, boolean> = {};

function setup(): NarrationPlayer {
  durations = { 'a.mp3': 1, 'b.mp3': 2, 'c.mp3': 0.5 };
  broken = new Set();
  fetched = [];
  winListeners = {};
  winCapture = {};
  FakeContext.instances = [];
  FakeContext.resumeWorks = true;
  FakeContext.initialState = 'running';
  FakeContext.pendingResumes = null;
  vi.stubGlobal('window', {
    addEventListener: (type: string, cb: () => void, capture?: boolean) => {
      winListeners[type] = cb;
      winCapture[type] = capture === true;
    },
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

  it('★ hasFailed מדווח רק על קטע שהטעינה שלו כבר נכשלה', async () => {
    const player = setup();
    broken.add('b.mp3');
    expect(player.hasFailed('b.mp3')).toBe(false); // עוד לא נוסה
    await player.preload(['a.mp3', 'b.mp3']);
    expect(player.hasFailed('b.mp3')).toBe(true);
    expect(player.hasFailed('a.mp3')).toBe(false);
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

  /** נגן שההקשר שלו נוצר נעול (דפדפן בלי אינטראקציה), אחרי טעינה מוקדמת. */
  const lockedPlayer = async () => {
    const player = setup();
    FakeContext.initialState = 'suspended';
    await player.preload(['a.mp3', 'b.mp3']); // יוצר את ההקשר — נעול
    return player;
  };

  it('★ הקשר נעול נפתח רק באינטראקציה — ומודיע על כך פעם אחת', async () => {
    const player = await lockedPlayer();
    const opened: number[] = [];
    player.onUnlock(() => opened.push(1));
    expect(player.isUnlocked()).toBe(false);
    winListeners.keydown?.();
    expect(player.isUnlocked()).toBe(true);
    winListeners.click?.();
    await flush();
    expect(opened).toEqual([1]);
  });

  it('★ נפתח בקליק ובמקש, בשלב ה-capture — ולא ב-pointerdown שמקדים את הקליק', () => {
    setup();
    expect(Object.keys(winListeners).sort()).toEqual(['click', 'keydown']);
    expect(winCapture).toEqual({ click: true, keydown: true });
  });

  it('★ הפתיחה מסומנת מיד, אבל ההודעה יוצאת רק אחרי שהאירוע סיים את דרכו', async () => {
    const player = await lockedPlayer();
    const opened: boolean[] = [];
    player.onUnlock(() => opened.push(player.isUnlocked()));
    winListeners.click?.(); // הקליק על "הבא" — ה-onClick של הכפתור רץ אחרי המאזין שלנו
    // מה שהקליק עצמו מחליף כבר רואה אודיו פתוח (ה-host קורא את isUnlocked בצעד)...
    expect(player.isUnlocked()).toBe(true);
    // ...והצעד שההודעה מריצה מגיע רק אחריו, על המסך החדש — ולא בלובי שנעלם.
    expect(opened).toEqual([]);
    await flush();
    expect(opened).toEqual([true]);
  });

  it('★ מקש שאינו אינטראקציה בעיני הדפדפן (Esc, מקש שינוי) — אינו פותח', async () => {
    const activation = { hasBeenActive: false, isActive: false };
    vi.stubGlobal('navigator', { userActivation: activation });
    const player = await lockedPlayer();
    FakeContext.resumeWorks = false; // ה-resume של Esc נתקע עד מגע אמיתי
    winListeners.keydown?.();
    await flush();
    expect(player.isUnlocked()).toBe(false);
    player.say(['a.mp3']);
    await flush();
    expect(ctx().sources).toHaveLength(0); // נזרק — לא ממתין ל-resume שלא יגיע
    // קליק אמיתי בתוך התפריט
    activation.hasBeenActive = true;
    activation.isActive = true;
    FakeContext.resumeWorks = true;
    winListeners.click?.();
    expect(player.isUnlocked()).toBe(true);
  });

  it('★ הקשר שרץ בלי אינטראקציה (autoplay מותר, כמו ב-EXE) — פתוח מיד', async () => {
    const player = setup();
    const opened: number[] = [];
    player.onUnlock(() => opened.push(1));
    await player.preload(['a.mp3']);
    expect(player.isUnlocked()).toBe(true);
    await flush();
    expect(opened).toEqual([1]);
  });

  it('★ הקשר שנפתח מעצמו מאוחר יותר (statechange) — גם הוא פתיחה', async () => {
    const player = await lockedPlayer();
    FakeContext.pendingResumes = [];
    player.say(['a.mp3']); // מבקש resume — שעוד לא הסתיים
    await flush();
    expect(player.isUnlocked()).toBe(false);
    FakeContext.pendingResumes.forEach((open) => open());
    expect(player.isUnlocked()).toBe(true);
  });

  it('★ לפני כל אינטראקציה — המשפט נזרק, ולא מתנגן גם אחרי הפתיחה', async () => {
    const player = await lockedPlayer();
    FakeContext.resumeWorks = false;
    player.say(['a.mp3']);
    await flush();
    FakeContext.resumeWorks = true;
    winListeners.keydown?.();
    await flush();
    expect(ctx().sources).toHaveLength(0);
  });

  it('★ אחרי האינטראקציה, משפט שמקדים את סוף ה-resume ממתין לו ומתנגן', async () => {
    const player = await lockedPlayer();
    FakeContext.pendingResumes = [];
    winListeners.keydown?.(); // המקש שפותח את האודיו (וגם מחליף מסך)
    player.say(['a.mp3', 'b.mp3']); // המשפט של המסך החדש — ה-resume עוד בדרך
    await flush();
    expect(ctx().sources).toHaveLength(0);
    FakeContext.pendingResumes.forEach((open) => open());
    await flush();
    expect(ctx().sources).toHaveLength(2);
    expect(player.isSpeaking()).toBe(true);
  });

  it('★ משפט שממתין ל-resume ובוטל בינתיים (המסך השתנה) — לא מתנגן', async () => {
    const player = await lockedPlayer();
    FakeContext.pendingResumes = [];
    winListeners.keydown?.();
    player.say(['a.mp3']);
    await flush();
    player.cancel();
    FakeContext.pendingResumes.forEach((open) => open());
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
    expect(winListeners.click).toBeUndefined();
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
