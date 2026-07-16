/**
 * AudioManager אחד לכל ערוצי הסאונד (SPEC סעיף 9):
 * - **סאונד חדש עוצר את כל הסאונדים הקודמים** (בכל הערוצים, וגם מחיאות
 *   הכפיים) — לעולם לא מתנגנים כמה במקביל, כדי שלא יתערבבו.
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

// מטמון מודול-לבל של אלמנטי אודיו שנטענו מראש — נשמרים כדי שלא ייאספו ע"י ה-GC,
// כך שקובצי הסאונד יישארו במטמון הדפדפן והניגון בפועל יהיה מיידי.
const preloadedAudio = new Map<string, HTMLAudioElement>();

/**
 * טעינה מוקדמת של קובצי סאונד (בלי לנגן) — מושכת אותם לזיכרון מראש כדי שכשיגיע
 * רגע הניגון הם כבר במטמון והקול יוצא מיד. אפשר לקרוא כבר במסך ההגדרות (head
 * start). מדלגת על ריקים/כפילויות ו-blob:/data: (אופליין — כבר בזיכרון).
 */
export function preloadAudio(srcs: ReadonlyArray<string | null | undefined>): void {
  if (typeof Audio === 'undefined') return;
  for (const raw of srcs) {
    const src = (raw ?? '').trim();
    if (src === '' || preloadedAudio.has(src)) continue;
    if (src.startsWith('blob:') || src.startsWith('data:')) continue;
    try {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = src;
      preloadedAudio.set(src, audio);
    } catch {
      /* סביבה בלי Audio — מתעלמים */
    }
  }
}

export class AudioManager {
  private readonly active = new Map<SoundChannel, HTMLAudioElement>();
  private readonly pending = new Map<SoundChannel, PendingPlay>();
  private volume = 1;
  private unlocked = false;
  private context: AudioContext | null = null;
  private applauseBuffer: AudioBuffer | null = null;
  private applauseSource: AudioBufferSourceNode | null = null;

  constructor() {
    // אם ל-document כבר הייתה אינטראקציה (sticky activation) — למשל הקליק על
    // "התחל משחק" שהוביל לכאן — הדפדפן כבר מתיר ניגון, אז פותחים מיד בלי להמתין
    // לאינטראקציה נוספת. (navigator.userActivation לא קיים בכל סביבה — נזהרים.)
    if (typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive === true) {
      this.unlocked = true;
    }
    const unlock = () => {
      this.unlocked = true;
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      // ניגון מה שחיכה לאינטראקציה הראשונה (play אקסקלוסיבי — נשאר האחרון)
      const queued = [...this.pending.entries()];
      this.pending.clear();
      debugLog('audio', `אודיו נפתח באינטראקציה — מנגן ${queued.length} שהמתינו`);
      for (const [channel, play] of queued) {
        this.play(channel, play.src, { loop: play.loop });
      }
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    for (const audio of this.active.values()) audio.volume = this.volume;
  }

  /** מנגן src בערוץ נתון; קודם עוצר כל סאונד אחר שמתנגן. src ריק/null עוצר בלבד. */
  play(channel: SoundChannel, src: string | null, { loop = false } = {}): void {
    // סאונד חדש עוצר את כל הקודמים (כל הערוצים + מחיאות כפיים) — בלי ערבוב
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
    debugLog('audio', `${channel} מנגן`, { src: shortSrc(src), loop });
    audio.play().catch((err: unknown) => {
      const name = err instanceof DOMException ? err.name : String(err);
      // AbortError = הניגון הופסק ע"י סאונד אקסקלוסיבי חדש/‏stop — לא חסימת דפדפן.
      // אסור להתייחס אליו כאל חסימת autoplay (אחרת ננעל את המנהל בטעות ונשתיק
      // את הסאונד הבא). מתעלמים בשקט.
      if (name === 'AbortError') {
        if (this.active.get(channel) === audio) this.active.delete(channel);
        return;
      }
      // חסימת autoplay אמיתית (NotAllowedError וכו') — ננעל ונשמור לניסיון אחרי אינטראקציה
      this.unlocked = false;
      this.pending.set(channel, { src, loop });
      if (this.active.get(channel) === audio) this.active.delete(channel);
      debugLog('audio', `${channel} נחסם (${name}) — יְנוגן אחרי האינטראקציה הבאה`, { src: shortSrc(src) });
    });
  }

  stop(channel: SoundChannel): void {
    this.pending.delete(channel);
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
    if (this.applauseSource) {
      try {
        this.applauseSource.stop();
      } catch {
        /* כבר הסתיים */
      }
      this.applauseSource = null;
    }
  }

  stopAll(): void {
    this.stopActiveSounds();
    this.pending.clear();
  }

  /**
   * מחיאות כפיים (פקודת מנחה 3) — מסונתזות ב-WebAudio, בלי קובץ חיצוני:
   * מאות "כפיים" של רעש לבן קצר עם מעטפת דעיכה, בפיזור אקראי שמתדלדל לקראת הסוף.
   */
  playApplause(): void {
    try {
      this.context ??= new AudioContext();
      const ctx = this.context;
      if (ctx.state === 'suspended') void ctx.resume();
      this.applauseBuffer ??= buildApplauseBuffer(ctx);

      // גם מחיאות הכפיים עוצרות את הסאונד הקודם — בלי ערבוב
      this.stopActiveSounds();
      const source = ctx.createBufferSource();
      source.buffer = this.applauseBuffer;
      const gain = ctx.createGain();
      gain.gain.value = this.volume;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.onended = () => {
        if (this.applauseSource === source) this.applauseSource = null;
      };
      this.applauseSource = source;
      source.start();
      debugLog('audio', 'מחיאות כפיים (WebAudio)');
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
