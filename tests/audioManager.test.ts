/**
 * בדיקות ל-AudioManager — סאונד אחד בכל רגע: סאונד חדש עוצר את כל הקודמים,
 * כדי שלא יתערבבו כמה יחד. (Audio ו-window מדומים לסביבת Node.)
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { APPLAUSE_DUCK, AudioManager } from '../src/app/AudioManager.ts';

class FakeAudio {
  static instances: FakeAudio[] = [];
  /** אם מוגדר — הניגון הבא נכשל עם DOMException בשם הזה (לבדיקת טיפול בשגיאות). */
  static rejectNextWith: string | null = null;
  paused = false;
  playing = false;
  loop = false;
  volume = 1;
  private handlers: Record<string, () => void> = {};

  constructor(public src: string) {
    FakeAudio.instances.push(this);
  }
  addEventListener(type: string, cb: () => void): void {
    this.handlers[type] = cb;
  }
  play(): Promise<void> {
    if (FakeAudio.rejectNextWith !== null) {
      const name = FakeAudio.rejectNextWith;
      FakeAudio.rejectNextWith = null;
      return Promise.reject(new DOMException('נכשל', name));
    }
    this.playing = true;
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.playing = false;
    this.paused = true;
  }
  ended = false;
  /** יורה אירוע של הרכיב (ended / error), כמו שהדפדפן היה עושה. */
  fire(type: string): void {
    if (type === 'ended') {
      // כמו בדפדפן: רכיב שהגיע לסוף מסומן כעצור ושנגמר
      this.playing = false;
      this.paused = true;
      this.ended = true;
    }
    this.handlers[type]?.();
  }
}

/** מאזיני ה-window שנרשמו ע"י ה-AudioManager (keydown/pointerdown) — לירי בבדיקות. */
let winListeners: Record<string, () => void> = {};

function setup(): AudioManager {
  FakeAudio.instances = [];
  FakeAudio.rejectNextWith = null;
  winListeners = {};
  vi.stubGlobal('window', {
    addEventListener: (type: string, cb: () => void) => (winListeners[type] = cb),
    removeEventListener: (type: string) => delete winListeners[type],
  });
  vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio);
  const manager = new AudioManager();
  winListeners.keydown?.(); // שחרור נעילת ה-autoplay (אינטראקציה ראשונה)
  return manager;
}

/** משחרר את ה-microtasks כדי שה-catch של audio.play() ירוץ. */
const flush = () => Promise.resolve().then(() => Promise.resolve());

afterEach(() => vi.unstubAllGlobals());

describe('AudioManager — סאונד אחד בכל רגע', () => {
  it('סאונד חדש עוצר את הקודם, גם בערוץ אחר', () => {
    const manager = setup();
    manager.play('showQuestion', 'q.mp3');
    manager.play('timer', 't.mp3', { loop: true });
    const q = FakeAudio.instances[0]!;
    const t = FakeAudio.instances[1]!;
    expect(q.playing).toBe(false); // הקודם נעצר
    expect(q.paused).toBe(true);
    expect(t.playing).toBe(true); // רק החדש מתנגן
    expect(t.loop).toBe(true);
  });

  it('בכל רגע נתון מתנגן לכל היותר אלמנט אחד', () => {
    const manager = setup();
    manager.play('playersConnecting', 'a.mp3', { loop: true });
    manager.play('showQuestion', 'b.mp3');
    manager.play('timer', 'c.mp3', { loop: true });
    const playing = FakeAudio.instances.filter((a) => a.playing);
    expect(playing).toHaveLength(1);
    expect(playing[0]!.src).toBe('c.mp3');
  });

  it('src ריק/null עוצר את מה שמתנגן', () => {
    const manager = setup();
    manager.play('timer', 't.mp3', { loop: true });
    manager.play('timer', null);
    expect(FakeAudio.instances.every((a) => !a.playing)).toBe(true);
  });

  it('stopAll עוצר הכול', () => {
    const manager = setup();
    manager.play('winners', 'w.mp3');
    manager.stopAll();
    expect(FakeAudio.instances.every((a) => !a.playing)).toBe(true);
  });
});

describe('AudioManager — פתיחה אוטומטית לפי userActivation', () => {
  it('אם ל-document כבר הייתה אינטראקציה — מנגן מיד בלי להמתין לאינטראקציה נוספת', () => {
    FakeAudio.instances = [];
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
    vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio);
    vi.stubGlobal('navigator', { userActivation: { hasBeenActive: true } });

    const manager = new AudioManager(); // בלי לדמות keydown — אמור להיפתח מ-userActivation
    manager.play('playersConnecting', 'connect.mp3', { loop: true });

    const playing = FakeAudio.instances.filter((a) => a.playing);
    expect(playing).toHaveLength(1);
    expect(playing[0]!.src).toBe('connect.mp3');
  });

  it('בלי אינטראקציה קודמת — ממתין (לא מנגן עד אינטראקציה)', () => {
    FakeAudio.instances = [];
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
    vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio);
    vi.stubGlobal('navigator', { userActivation: { hasBeenActive: false } });

    const manager = new AudioManager();
    manager.play('playersConnecting', 'connect.mp3', { loop: true });

    expect(FakeAudio.instances.every((a) => !a.playing)).toBe(true); // הכול בהמתנה
  });
});

describe('AudioManager — טיפול חסין בשגיאות ניגון', () => {
  it('כשל טעינה של קובץ בודד (NotSupportedError) לא נועל את מערכת הסאונד', async () => {
    const manager = setup();
    FakeAudio.rejectNextWith = 'NotSupportedError';
    manager.play('timer', 'bad.mp3', { loop: true }); // ייכשל בטעינה
    await flush();
    // סאונד אחר עדיין מתנגן — לא ננעלנו בגלל כשל של קובץ אחד
    manager.play('showQuestion', 'good.mp3');
    const playing = FakeAudio.instances.filter((a) => a.playing);
    expect(playing).toHaveLength(1);
    expect(playing[0]!.src).toBe('good.mp3');
  });

  it('חסימת autoplay אמיתית (NotAllowedError) נועלת — ואינטראקציה חוזרת משחררת שוב', async () => {
    const manager = setup(); // כבר "נפתח" ב-keydown של setup
    FakeAudio.rejectNextWith = 'NotAllowedError';
    manager.play('timer', 't.mp3', { loop: true }); // ייחסם וייכנס להמתנה
    await flush();
    // עדיין כלום לא מתנגן — ננעלנו והסאונד ממתין
    expect(FakeAudio.instances.every((a) => !a.playing)).toBe(true);
    // מאזין ה-unlock הוחזר → אינטראקציה חוזרת מנגנת את מה שהמתין
    expect(winListeners.keydown).toBeTypeOf('function');
    winListeners.keydown?.();
    await flush();
    const playing = FakeAudio.instances.filter((a) => a.playing);
    expect(playing).toHaveLength(1);
    expect(playing[0]!.src).toBe('t.mp3');
    expect(playing[0]!.loop).toBe(true);
  });
});

/** AudioContext מדומה: מקור מחיאות הכפיים המסונתזות, שהבדיקה מסיימת ידנית. */
class FakeAudioContext {
  static sources: { onended: (() => void) | null; started: boolean; stopped: boolean }[] = [];
  state = 'running';
  sampleRate = 8000;
  destination = {};
  currentTime = 0;
  createBuffer(_channels: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }
  createGain() {
    return { gain: { value: 1 }, connect: () => {} };
  }
  createBufferSource() {
    const source = {
      buffer: null as unknown,
      onended: null as (() => void) | null,
      started: false,
      stopped: false,
      connect: () => {},
      start: () => {
        source.started = true;
      },
      stop: () => {
        source.stopped = true;
      },
    };
    FakeAudioContext.sources.push(source);
    return source;
  }
}

describe('AudioManager — מחיאות כפיים מעל הצליל', () => {
  it('מחיאות מקובץ בזמן הטיימר: הטיימר ממשיך מונמך, וחוזר לווליום המלא כשהן נגמרות', () => {
    const manager = setup();
    manager.play('timer', 't.mp3', { loop: true });
    const t = FakeAudio.instances[0]!;
    manager.playApplause('clap.mp3');
    const clap = FakeAudio.instances[1]!;
    expect(t.playing).toBe(true); // לא נעצר ולא הושהה
    expect(t.volume).toBe(APPLAUSE_DUCK);
    expect(clap.src).toBe('clap.mp3');
    expect(clap.playing).toBe(true);
    expect(clap.volume).toBe(1);
    clap.fire('ended');
    expect(t.playing).toBe(true);
    expect(t.volume).toBe(1);
    expect(FakeAudio.instances).toHaveLength(2);
  });

  it('גם כשקובץ המחיאות נכשל בטעינה — הצליל חוזר לווליום המלא', () => {
    const manager = setup();
    manager.play('playersConnecting', 'lobby.mp3', { loop: true });
    manager.playApplause('broken.mp3');
    FakeAudio.instances[1]!.fire('error');
    expect(FakeAudio.instances[0]!.playing).toBe(true);
    expect(FakeAudio.instances[0]!.volume).toBe(1);
  });

  it('ניגון חדש בזמן המחיאות עוצר את שניהם, והצליל החדש בווליום מלא', () => {
    const manager = setup();
    manager.play('timer', 't.mp3', { loop: true });
    manager.playApplause('clap.mp3');
    const clap = FakeAudio.instances[1]!;
    manager.play('inShowAns', 'reveal.mp3');
    const reveal = FakeAudio.instances[2]!;
    expect(clap.playing).toBe(false);
    expect(FakeAudio.instances[0]!.playing).toBe(false);
    expect(reveal.playing).toBe(true);
    expect(reveal.volume).toBe(1);
    clap.fire('ended'); // מחיאות שנקטעו לא נוגעות בווליום של הצליל החדש
    expect(reveal.volume).toBe(1);
  });

  it('עצירת ערוץ (סוף ההצבעה) עוצרת רק אותו: המחיאות ממשיכות עד הסוף', () => {
    const manager = setup();
    manager.play('timer', 't.mp3', { loop: true });
    manager.playApplause('clap.mp3');
    manager.stop('timer');
    const clap = FakeAudio.instances[1]!;
    expect(FakeAudio.instances[0]!.playing).toBe(false);
    expect(clap.playing).toBe(true);
    clap.fire('ended');
    expect(FakeAudio.instances[0]!.playing).toBe(false);
  });

  it('stopAll בזמן המחיאות עוצר הכול', () => {
    const manager = setup();
    manager.play('timer', 't.mp3', { loop: true });
    manager.playApplause('clap.mp3');
    manager.stopAll();
    expect(FakeAudio.instances.every((a) => !a.playing)).toBe(true);
  });

  it('מחיאות בזמן מחיאות מתחילות מחדש, והצליל חוזר לווליום רק בסוף האחרונות', () => {
    const manager = setup();
    manager.play('timer', 't.mp3', { loop: true });
    const t = FakeAudio.instances[0]!;
    manager.playApplause('clap.mp3');
    const first = FakeAudio.instances[1]!;
    manager.playApplause('clap.mp3');
    const second = FakeAudio.instances[2]!;
    expect(first.playing).toBe(false);
    expect(second.playing).toBe(true);
    expect(t.volume).toBe(APPLAUSE_DUCK);
    first.fire('ended'); // הראשונות נקטעו — הסיום שלהן לא מחזיר את הווליום
    expect(t.volume).toBe(APPLAUSE_DUCK);
    second.fire('ended');
    expect(t.volume).toBe(1);
    expect(t.playing).toBe(true);
  });

  it('מסך הצפייה מקבל את המחיאות כאירוע משלהן, בלי לגעת בצליל', () => {
    const manager = setup();
    manager.play('timer', 't.mp3', { loop: true });
    const events: unknown[] = [];
    manager.setObserver((e) => events.push(e));
    manager.playApplause('clap.mp3');
    FakeAudio.instances[1]!.fire('ended');
    expect(events).toEqual([{ type: 'applause', src: 'clap.mp3' }]);
  });

  it('מחיאות מסונתזות (בלי קובץ): הטיימר ממשיך מונמך עד שהן נגמרות', () => {
    const manager = setup();
    FakeAudioContext.sources = [];
    vi.stubGlobal('AudioContext', FakeAudioContext as unknown as typeof AudioContext);
    const events: unknown[] = [];
    manager.play('timer', 't.mp3', { loop: true });
    manager.setObserver((e) => events.push(e));
    manager.playApplause(null);
    const t = FakeAudio.instances[0]!;
    const source = FakeAudioContext.sources[0]!;
    expect(source.started).toBe(true);
    expect(t.playing).toBe(true);
    expect(t.volume).toBe(APPLAUSE_DUCK);
    source.onended?.();
    expect(t.volume).toBe(1);
    expect(events).toEqual([{ type: 'applause', src: null }]);
  });

  it('בסביבה בלי אודיו (אין AudioContext) הצליל לא מונמך', () => {
    const manager = setup();
    manager.play('timer', 't.mp3', { loop: true });
    manager.playApplause('  ');
    expect(FakeAudio.instances[0]!.playing).toBe(true);
    expect(FakeAudio.instances[0]!.volume).toBe(1);
  });

  it('ווליום שמשתנה בזמן המחיאות: הן בווליום החדש, והצליל מונמך ממנו', () => {
    const manager = setup();
    manager.play('timer', 't.mp3', { loop: true });
    manager.playApplause('clap.mp3');
    manager.setVolume(0.5);
    expect(FakeAudio.instances[1]!.volume).toBe(0.5);
    expect(FakeAudio.instances[0]!.volume).toBe(0.5 * APPLAUSE_DUCK);
    FakeAudio.instances[1]!.fire('ended');
    expect(FakeAudio.instances[0]!.volume).toBe(0.5);
  });

  it('אודיו נעול (אין אינטראקציה): המחיאות מדלגות, ומה שממתין נשאר', async () => {
    FakeAudio.instances = [];
    winListeners = {};
    vi.stubGlobal('window', {
      addEventListener: (type: string, cb: () => void) => (winListeners[type] = cb),
      removeEventListener: (type: string) => delete winListeners[type],
    });
    vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio);
    vi.stubGlobal('navigator', { userActivation: { hasBeenActive: false } });
    const manager = new AudioManager();
    manager.play('playersConnecting', 'lobby.mp3', { loop: true });
    manager.playApplause('clap.mp3');
    expect(FakeAudio.instances).toHaveLength(0);
    winListeners.keydown?.();
    await flush();
    expect(FakeAudio.instances.map((a) => a.src)).toEqual(['lobby.mp3']);
    expect(FakeAudio.instances[0]!.playing).toBe(true);
  });
});
