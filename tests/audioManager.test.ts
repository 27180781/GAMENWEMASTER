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
