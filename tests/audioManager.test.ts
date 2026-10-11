/**
 * בדיקות ל-AudioManager — סאונד אחד בכל רגע: סאונד חדש עוצר את כל הקודמים,
 * כדי שלא יתערבבו כמה יחד. (Audio ו-window מדומים לסביבת Node.)
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioManager } from '../src/app/AudioManager.ts';

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

describe('AudioManager — מחיאות כפיים משהות ולא עוצרות', () => {
  it('מחיאות מקובץ בזמן הטיימר: הטיימר מושהה, וממשיך מאותה נקודה כשהן נגמרות', () => {
    const manager = setup();
    manager.play('timer', 't.mp3', { loop: true });
    const t = FakeAudio.instances[0]!;
    manager.playApplause('clap.mp3');
    const clap = FakeAudio.instances[1]!;
    expect(t.paused).toBe(true);
    expect(t.src).toBe('t.mp3'); // הושהה, לא נעצר — הרכיב נשאר עם הקובץ
    expect(clap.src).toBe('clap.mp3');
    expect(clap.playing).toBe(true);
    clap.fire('ended');
    expect(t.playing).toBe(true); // אותו רכיב ממשיך, לא ניגון חדש מההתחלה
    expect(FakeAudio.instances).toHaveLength(2);
  });

  it('גם כשקובץ המחיאות נכשל בטעינה — מה שהושהה ממשיך', () => {
    const manager = setup();
    manager.play('playersConnecting', 'lobby.mp3', { loop: true });
    manager.playApplause('broken.mp3');
    FakeAudio.instances[1]!.fire('error');
    expect(FakeAudio.instances[0]!.playing).toBe(true);
  });

  it('ניגון אחר בזמן המחיאות מבטל את ההמשך: המשחק כבר עבר הלאה', () => {
    const manager = setup();
    manager.play('timer', 't.mp3', { loop: true });
    manager.playApplause('clap.mp3');
    const clap = FakeAudio.instances[1]!;
    manager.play('inShowAns', 'reveal.mp3');
    const reveal = FakeAudio.instances[2]!;
    expect(clap.playing).toBe(false);
    clap.fire('ended');
    expect(FakeAudio.instances[0]!.playing).toBe(false);
    expect(FakeAudio.instances[0]!.src).toBe('');
    expect(reveal.playing).toBe(true);
  });

  it('עצירה של הערוץ שהושהה (סוף ההצבעה) מבטלת את ההמשך', () => {
    const manager = setup();
    manager.play('timer', 't.mp3', { loop: true });
    manager.playApplause('clap.mp3');
    manager.stop('timer');
    FakeAudio.instances[1]!.fire('ended');
    expect(FakeAudio.instances[0]!.playing).toBe(false);
  });

  it('עצירה של ערוץ אחר לא נוגעת בהמשך', () => {
    const manager = setup();
    manager.play('timer', 't.mp3', { loop: true });
    manager.playApplause('clap.mp3');
    manager.stop('winnersList');
    FakeAudio.instances[1]!.fire('ended');
    expect(FakeAudio.instances[0]!.playing).toBe(true);
  });

  it('stopAll בזמן המחיאות עוצר הכול, כולל ההמשך', () => {
    const manager = setup();
    manager.play('timer', 't.mp3', { loop: true });
    manager.playApplause('clap.mp3');
    manager.stopAll();
    const clap = FakeAudio.instances[1]!;
    expect(clap.playing).toBe(false);
    clap.fire('ended');
    expect(FakeAudio.instances[0]!.playing).toBe(false);
  });

  it('מחיאות בזמן מחיאות: רק הסיום של האחרונות ממשיך את מה שהיה לפניהן', () => {
    const manager = setup();
    manager.play('timer', 't.mp3', { loop: true });
    manager.playApplause('clap.mp3');
    const first = FakeAudio.instances[1]!;
    manager.playApplause('clap.mp3');
    const second = FakeAudio.instances[2]!;
    expect(first.playing).toBe(false);
    first.fire('ended'); // הראשונות נקטעו — הסיום שלהן לא ממשיך כלום
    expect(FakeAudio.instances[0]!.playing).toBe(false);
    second.fire('ended');
    expect(FakeAudio.instances[0]!.playing).toBe(true);
  });

  it('מחיאות כשלא מתנגן כלום — אין מה להמשיך', () => {
    const manager = setup();
    const events: string[] = [];
    manager.setObserver((e) => events.push(e.type));
    manager.playApplause('clap.mp3');
    FakeAudio.instances[0]!.fire('ended');
    expect(FakeAudio.instances).toHaveLength(1);
    expect(events).toEqual(['play']);
  });

  it('צליל חד-פעמי שכבר נגמר לא חוזר אחרי המחיאות', () => {
    const manager = setup();
    manager.play('showQuestion', 'q.mp3');
    const q = FakeAudio.instances[0]!;
    q.fire('ended'); // נגמר מעצמו
    manager.playApplause('clap.mp3');
    FakeAudio.instances[1]!.fire('ended');
    expect(q.playing).toBe(false);
  });

  it('מסך הצפייה שומע את ההמשך: המחיאות כמו קודם, ואחריהן הצליל שהושהה', () => {
    const manager = setup();
    manager.play('timer', 't.mp3', { loop: true });
    const events: unknown[] = [];
    manager.setObserver((e) => events.push(e));
    manager.playApplause('clap.mp3');
    FakeAudio.instances[1]!.fire('ended');
    expect(events).toEqual([
      { type: 'play', channel: 'generic', src: 'clap.mp3', loop: false },
      { type: 'play', channel: 'timer', src: 't.mp3', loop: true },
    ]);
  });

  it('מחיאות מסונתזות (בלי קובץ): הטיימר מושהה עד שהן נגמרות', () => {
    const manager = setup();
    FakeAudioContext.sources = [];
    vi.stubGlobal('AudioContext', FakeAudioContext as unknown as typeof AudioContext);
    const events: string[] = [];
    manager.play('timer', 't.mp3', { loop: true });
    manager.setObserver((e) => events.push(e.type));
    manager.playApplause(null);
    const t = FakeAudio.instances[0]!;
    const source = FakeAudioContext.sources[0]!;
    expect(source.started).toBe(true);
    expect(t.paused).toBe(true);
    source.onended?.();
    expect(t.playing).toBe(true);
    expect(events).toEqual(['applause', 'play']);
  });

  it('בסביבה בלי אודיו (אין AudioContext) מה שהושהה ממשיך מיד', () => {
    const manager = setup();
    manager.play('timer', 't.mp3', { loop: true });
    manager.playApplause('  ');
    expect(FakeAudio.instances[0]!.playing).toBe(true);
  });

  it('ווליום שמשתנה בזמן המחיאות חל גם עליהן וגם על מה שימשיך', () => {
    const manager = setup();
    manager.play('timer', 't.mp3', { loop: true });
    manager.playApplause('clap.mp3');
    manager.setVolume(0.3);
    expect(FakeAudio.instances[1]!.volume).toBe(0.3);
    FakeAudio.instances[1]!.fire('ended');
    expect(FakeAudio.instances[0]!.volume).toBe(0.3);
  });

  it('אודיו נעול (אין אינטראקציה): המחיאות ממתינות כמו כל צליל, בלי המשך', () => {
    FakeAudio.instances = [];
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
    vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio);
    vi.stubGlobal('navigator', { userActivation: { hasBeenActive: false } });
    const manager = new AudioManager();
    manager.play('playersConnecting', 'lobby.mp3', { loop: true });
    manager.playApplause('clap.mp3');
    expect(FakeAudio.instances).toHaveLength(0);
  });
});
