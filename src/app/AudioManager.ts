/**
 * AudioManager אחד לכל ערוצי הסאונד (SPEC סעיף 9):
 * - **סאונד חדש עוצר את כל הסאונדים הקודמים** (בכל הערוצים, וגם מחיאות
 *   הכפיים) — לעולם לא מתנגנים כמה במקביל, כדי שלא יתערבבו.
 * - **מחיאות כפיים רק משהות** את מה שמתנגן (הטיימר, מוזיקת הפתיחה, הטבלה),
 *   והוא ממשיך מאותה נקודה כשהן נגמרות. ניגון או עצירה אחרים בינתיים מבטלים
 *   את ההמשך: המשחק כבר עבר למקום אחר.
 * - ווליום מפעיל גלובלי.
 * - autoplay נפתח רק אחרי אינטראקציה ראשונה (מגבלת דפדפן) — עד אז ניסיונות
 *   ניגון נכשלים בשקט ומנוגנים שוב ברגע שהמשתמש מבצע אינטראקציה.
 */

import { debugLog } from './debugLog.ts';

/** קיצור מקור סאונד לתצוגה בלוג (בלי query/base64 ארוך). */
function shortSrc(src: string): string {
  const clean = src.split('?')[0] ?? src;
  const parts = clean.split('/');
  return parts[parts.length - 1] || clean.slice(0, 40);
}

export type SoundChannel =
  | 'playersConnecting'
  | 'showQuestion'
  | 'winners'
  | 'winnersList'
  | 'generic'
  | 'timer'
  | 'inShowAns';

interface PendingPlay {
  src: string;
  loop: boolean;
}

/** מה שהמנהל התבקש לנגן — לשיקוף במסך הצפייה (src/live/soundTrack.ts). */
export type AudioEvent =
  | { type: 'play'; channel: SoundChannel; src: string | null; loop: boolean }
  | { type: 'stop'; channel: SoundChannel }
  | { type: 'stopAll' }
  | { type: 'applause' }
  | { type: 'cue'; kind: 'climb' | 'fall' | 'fanfare' };

// הערה: טעינת הסאונד מראש מטופלת מרוכז ב-mediaLoader (useMediaPreload) יחד עם
// שאר המדיה — כאן רק ניגון בפועל.

/** צליל שמחיאות הכפיים השהו — ממשיך מאותה נקודה כשהן נגמרות. */
interface SuspendedSound extends PendingPlay {
  channel: SoundChannel;
  audio: HTMLAudioElement;
}

export class AudioManager {
  private readonly active = new Map<SoundChannel, HTMLAudioElement>();
  /** מה התבקש לנגן בכל אלמנט — כדי שהמשך אחרי מחיאות כפיים ישוקף לצופים כפי שהיה. */
  private readonly playing = new WeakMap<HTMLAudioElement, PendingPlay>();
  private readonly pending = new Map<SoundChannel, PendingPlay>();
  private suspended: SuspendedSound | null = null;
  /** מחיאות הכפיים האחרונות. סיום של קודמות (או של כאלה שנקטעו) לא ממשיך כלום. */
  private applauseToken = 0;
  /** מחיאות כפיים מקובץ (genericMediaSound) — לא ב-active, כי הן לא "הצליל הנוכחי". */
  private applauseAudio: HTMLAudioElement | null = null;
  private volume = 1;
  private unlocked = false;
  /** האם מאזיני ה-unlock מותקנים כרגע על window (למניעת הוספה/הסרה כפולה). */
  private listening = false;
  private context: AudioContext | null = null;
  private applauseBuffer: AudioBuffer | null = null;
  private applauseSource: AudioBufferSourceNode | null = null;
  /** מאזין הפתיחה (unlock) — נשמר כדי שאפשר יהיה להסירו ב-dispose. */
  private readonly unlockFn: () => void;
  private observer: ((event: AudioEvent) => void) | null = null;

  constructor() {
    // אם ל-document כבר הייתה אינטראקציה (sticky activation) — למשל הקליק על
    // "התחל משחק" שהוביל לכאן — הדפדפן כבר מתיר ניגון, אז פותחים מיד בלי להמתין
    // לאינטראקציה נוספת. (navigator.userActivation לא קיים בכל סביבה — נזהרים.)
    if (typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive === true) {
      this.unlocked = true;
    }
    this.unlockFn = () => {
      this.disarmUnlockListeners();
      if (this.unlocked) return; // כבר פתוח (למשל מ-userActivation) — רק מסירים מאזינים
      this.unlocked = true;
      // ניגון מה שחיכה לאינטראקציה הראשונה (play אקסקלוסיבי — נשאר האחרון)
      const queued = [...this.pending.entries()];
      this.pending.clear();
      debugLog('audio', `אודיו נפתח באינטראקציה — מנגן ${queued.length} שהמתינו`);
      for (const [channel, play] of queued) {
        this.play(channel, play.src, { loop: play.loop });
      }
    };
    // מאזיני הפתיחה מותקנים תמיד — גם אם unlocked כבר true — כדי שאם נצטרך לנעול
    // שוב (חסימת autoplay אמיתית) אינטראקציה עתידית תשחרר מחדש.
    this.armUnlockListeners();
  }

  private armUnlockListeners(): void {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener('pointerdown', this.unlockFn);
    window.addEventListener('keydown', this.unlockFn);
  }

  private disarmUnlockListeners(): void {
    if (!this.listening) return;
    this.listening = false;
    window.removeEventListener('pointerdown', this.unlockFn);
    window.removeEventListener('keydown', this.unlockFn);
  }

  /**
   * מקבל כל בקשת ניגון/עצירה — כך מסך הצפייה שומע מה שהמסך הראשי מנגן. כשל
   * של המאזין לעולם לא פוגע בסאונד של המשחק עצמו.
   */
  setObserver(observer: ((event: AudioEvent) => void) | null): void {
    this.observer = observer;
  }

  private emit(event: AudioEvent): void {
    try {
      this.observer?.(event);
    } catch {
      /* מסך הצפייה הוא תוספת — לא עוצרים בגללו את הסאונד */
    }
  }

  /** ניקוי מלא בעזיבת המשחק: עצירת כל הסאונדים והסרת מאזיני ה-unlock מ-window. */
  dispose(): void {
    this.stopAll();
    this.disarmUnlockListeners();
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    for (const audio of this.active.values()) audio.volume = this.volume;
    if (this.suspended) this.suspended.audio.volume = this.volume;
    if (this.applauseAudio) this.applauseAudio.volume = this.volume;
  }

  /** מנגן src בערוץ נתון; קודם עוצר כל סאונד אחר שמתנגן. src ריק/null עוצר בלבד. */
  play(channel: SoundChannel, src: string | null, { loop = false } = {}): void {
    this.emit({ type: 'play', channel, src, loop });
    // סאונד חדש עוצר את כל הקודמים (כל הערוצים + מחיאות כפיים) — בלי ערבוב.
    // מה שמחיאות הכפיים השהו כבר לא ימשיך: המשחק עבר הלאה.
    this.dropSuspended();
    this.stopActiveSounds();
    this.pending.clear();
    if (!src) return;
    if (!this.unlocked) {
      this.pending.set(channel, { src, loop });
      debugLog('audio', `${channel} ממתין (אודיו עדיין נעול עד אינטראקציה)`, { src: shortSrc(src) });
      return;
    }
    const audio = new Audio(src);
    audio.loop = loop;
    audio.volume = this.volume;
    audio.addEventListener('ended', () => {
      if (this.active.get(channel) === audio) this.active.delete(channel);
    });
    this.active.set(channel, audio);
    this.playing.set(audio, { src, loop });
    debugLog('audio', `${channel} מנגן`, { src: shortSrc(src), loop });
    audio.play().catch((err: unknown) => {
      const name = err instanceof DOMException ? err.name : String(err);
      if (this.active.get(channel) === audio) this.active.delete(channel);
      // AbortError = הניגון הופסק ע"י סאונד אקסקלוסיבי חדש/‏stop — לא שגיאה. מתעלמים.
      if (name === 'AbortError') return;
      // חסימת autoplay אמיתית — ורק היא — נועלת את המנהל ושומרת לניסיון אחרי
      // אינטראקציה. מחזירים את מאזיני ה-unlock כדי שאינטראקציה הבאה תשחרר שוב;
      // בלעדיהם היינו נשארים נעולים לצמיתות אחרי הפתיחה הראשונה.
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        this.unlocked = false;
        this.pending.set(channel, { src, loop });
        this.armUnlockListeners();
        debugLog('audio', `${channel} נחסם (autoplay) — יְנוגן אחרי האינטראקציה הבאה`, {
          src: shortSrc(src),
        });
        return;
      }
      // כל שאר השגיאות (טעינה/פורמט/רשת של קובץ בודד — NotSupportedError וכו') —
      // *לא* נועלות את מערכת הסאונד; מדלגים רק על הסאונד הזה כדי ששאר הסאונדים
      // ימשיכו לעבוד. (זו הייתה נעילת-שווא: כשל טעינה של קובץ אחד השתיק את הכול.)
      debugLog('audio', `${channel} נכשל (${name}) — מדלגים על הסאונד הזה`, { src: shortSrc(src) });
    });
  }

  stop(channel: SoundChannel): void {
    this.emit({ type: 'stop', channel });
    this.pending.delete(channel);
    this.dropSuspended(channel);
    const audio = this.active.get(channel);
    if (audio) {
      audio.pause();
      audio.src = '';
      this.active.delete(channel);
    }
  }

  /** עוצר כל סאונד שמתנגן כרגע (ערוצים + מחיאות כפיים) בלי לגעת ב-pending. */
  private stopActiveSounds(): void {
    for (const audio of this.active.values()) {
      audio.pause();
      audio.src = '';
    }
    this.active.clear();
    this.stopApplause();
  }

  /** עוצר מחיאות כפיים שמתנגנות, כך שהסיום שלהן כבר לא ימשיך את מה שהושהה. */
  private stopApplause(): void {
    this.applauseToken += 1;
    if (this.applauseSource) {
      try {
        this.applauseSource.stop();
      } catch {
        /* כבר הסתיים */
      }
      this.applauseSource = null;
    }
    if (this.applauseAudio) {
      this.applauseAudio.pause();
      this.applauseAudio.src = '';
      this.applauseAudio = null;
    }
  }

  /** מבטל את ההמשך של מה שמחיאות הכפיים השהו (כל צליל, או רק בערוץ הזה). */
  private dropSuspended(channel?: SoundChannel): void {
    const s = this.suspended;
    if (s === null || (channel !== undefined && s.channel !== channel)) return;
    this.suspended = null;
    s.audio.pause();
    s.audio.src = '';
  }

  stopAll(): void {
    this.emit({ type: 'stopAll' });
    this.dropSuspended();
    this.stopActiveSounds();
    this.pending.clear();
  }

  /**
   * מחיאות כפיים (פקודת מנחה 3): הקובץ שהוגדר ב-genericMediaSound, ובלעדיו
   * מחיאות מסונתזות ב-WebAudio — מאות "כפיים" של רעש לבן קצר עם מעטפת דעיכה,
   * בפיזור אקראי שמתדלדל לקראת הסוף.
   *
   * מה שמתנגן כרגע מושהה ולא נעצר, וממשיך מאותה נקודה כשהמחיאות נגמרות: בלי
   * זה הטיימר שתק עד סוף ההצבעה, ומוזיקת הפתיחה עד שהמשחק התחיל.
   */
  playApplause(file?: string | null): void {
    const src = file !== undefined && file !== null && file.trim() !== '' ? file : null;
    // לצופים זה נשאר בדיוק כמו קודם: קובץ = ניגון בערוץ generic, אחרת "applause".
    this.emit(
      src !== null ? { type: 'play', channel: 'generic', src, loop: false } : { type: 'applause' },
    );
    this.suspendCurrent();
    this.pending.clear();
    const token = this.applauseToken;
    const done = () => {
      if (token === this.applauseToken) this.resumeSuspended();
    };
    if (src !== null) {
      if (!this.unlocked) {
        // אודיו נעול — המחיאות ממתינות לאינטראקציה כמו כל צליל, בלי המשך.
        this.dropSuspended();
        this.pending.set('generic', { src, loop: false });
        return;
      }
      const audio = new Audio(src);
      audio.volume = this.volume;
      audio.addEventListener('ended', done);
      audio.addEventListener('error', done);
      this.applauseAudio = audio;
      debugLog('audio', 'generic מנגן (מחיאות כפיים)', { src: shortSrc(src) });
      audio.play().catch((err: unknown) => {
        const name = err instanceof DOMException ? err.name : String(err);
        if (name !== 'AbortError') done();
      });
      return;
    }
    try {
      this.context ??= new AudioContext();
      const ctx = this.context;
      if (ctx.state === 'suspended') void ctx.resume();
      this.applauseBuffer ??= buildApplauseBuffer(ctx);

      const source = ctx.createBufferSource();
      source.buffer = this.applauseBuffer;
      const gain = ctx.createGain();
      gain.gain.value = this.volume;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.onended = () => {
        if (this.applauseSource === source) this.applauseSource = null;
        done();
      };
      this.applauseSource = source;
      source.start();
      debugLog('audio', 'מחיאות כפיים (WebAudio)');
    } catch {
      // סביבה בלי אודיו — מתעלמים בשקט, ומה שהושהה ממשיך מיד
      done();
    }
  }

  /**
   * משהה את הצליל שמתנגן (יש לכל היותר אחד) ושומר אותו להמשך, ועוצר את כל
   * השאר. מחיאות כפיים בזמן מחיאות כפיים משאירות מושהה את מה שהיה לפניהן.
   */
  private suspendCurrent(): void {
    if (this.suspended === null) {
      for (const [channel, audio] of this.active) {
        const info = this.playing.get(audio);
        if (info === undefined || audio.paused || audio.ended) continue;
        this.active.delete(channel);
        audio.pause();
        this.suspended = { channel, audio, ...info };
        break;
      }
    }
    this.stopActiveSounds();
  }

  /** מחיאות הכפיים נגמרו: הצליל שהושהה ממשיך מאותה נקודה, וגם אצל הצופים. */
  private resumeSuspended(): void {
    const s = this.suspended;
    if (s === null) return;
    this.suspended = null;
    this.emit({ type: 'play', channel: s.channel, src: s.src, loop: s.loop });
    this.active.set(s.channel, s.audio);
    s.audio.volume = this.volume;
    debugLog('audio', `${s.channel} ממשיך אחרי מחיאות הכפיים`, { src: shortSrc(s.src) });
    s.audio.play().catch(() => {
      if (this.active.get(s.channel) === s.audio) this.active.delete(s.channel);
    });
  }

  /**
   * אפקט קצר מסונתז (WebAudio) — עובד גם אופליין בלי שום קובץ מדיה:
   *   'climb'   — ארפג'יו עולה (טיפוס בסולם).
   *   'fall'    — גלישה יורדת (החלקה בחבל).
   *   'fanfare' — תרועת ניצחון.
   * בניגוד ל-play/playApplause, אפקטים אלו *אינם* עוצרים סאונד אחר: הם קצרים,
   * ולעיתים שני אפקטים קורים יחד (קבוצה מטפסת בזמן שאחרת נופלת).
   */
  playCue(kind: 'climb' | 'fall' | 'fanfare'): void {
    this.emit({ type: 'cue', kind });
    try {
      this.context ??= new AudioContext();
      const ctx = this.context;
      if (ctx.state === 'suspended') void ctx.resume();
      const now = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.value = this.volume * 0.5;
      master.connect(ctx.destination);

      /** צליל בודד עם מעטפת רכה (בלי קליקים). */
      const tone = (freq: number, at: number, dur: number, type: OscillatorType = 'triangle') => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, now + at);
        gain.gain.setValueAtTime(0.0001, now + at);
        gain.gain.exponentialRampToValueAtTime(0.9, now + at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
        osc.connect(gain);
        gain.connect(master);
        osc.start(now + at);
        osc.stop(now + at + dur + 0.05);
      };

      if (kind === 'climb') {
        // דו-מי-סול-דו עולה — תחושת טיפוס
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.08, 0.22));
      } else if (kind === 'fall') {
        // גלישה יורדת רציפה — תחושת נפילה
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(700, now);
        osc.frequency.exponentialRampToValueAtTime(120, now + 0.55);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.6, now + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
        osc.connect(gain);
        gain.connect(master);
        osc.start(now);
        osc.stop(now + 0.65);
      } else {
        // תרועה: שלוש הכרזות ואז אקורד מנצח
        [392, 392, 523.25].forEach((f, i) => tone(f, i * 0.16, 0.16, 'square'));
        [523.25, 659.25, 783.99].forEach((f) => tone(f, 0.5, 0.9, 'square'));
      }
      debugLog('audio', `אפקט ${kind} (WebAudio)`);
    } catch {
      // סביבה בלי אודיו — מתעלמים בשקט
    }
  }
}

function buildApplauseBuffer(ctx: AudioContext): AudioBuffer {
  const durationSeconds = 2.8;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(durationSeconds * sampleRate);
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const claps = 260;

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < claps; i++) {
      // צפיפות גבוהה בהתחלה שהולכת ומתדלדלת
      const start = Math.floor(Math.pow(Math.random(), 1.4) * (durationSeconds - 0.15) * sampleRate);
      const clapLength = Math.floor((0.01 + Math.random() * 0.03) * sampleRate);
      const amplitude = 0.25 + Math.random() * 0.5;
      for (let j = 0; j < clapLength && start + j < length; j++) {
        const envelope = Math.exp((-5 * j) / clapLength);
        data[start + j] = (data[start + j] ?? 0) + (Math.random() * 2 - 1) * amplitude * envelope;
      }
    }
    // נרמול עדין למניעת חיתוך
    for (let i = 0; i < length; i++) {
      data[i] = Math.max(-1, Math.min(1, data[i]! * 0.7));
    }
  }
  return buffer;
}
