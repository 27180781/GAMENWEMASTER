/**
 * AudioManager אחד לכל ערוצי הסאונד (SPEC סעיף 9):
 * - סאונד חדש עוצר את הקודם באותו ערוץ.
 * - ווליום מפעיל גלובלי.
 * - autoplay נפתח רק אחרי אינטראקציה ראשונה (מגבלת דפדפן) — עד אז ניסיונות
 *   ניגון נכשלים בשקט ומנוגנים שוב ברגע שהמשתמש מבצע אינטראקציה.
 */

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

export class AudioManager {
  private readonly active = new Map<SoundChannel, HTMLAudioElement>();
  private readonly pending = new Map<SoundChannel, PendingPlay>();
  private volume = 1;
  private unlocked = false;
  private context: AudioContext | null = null;
  private applauseBuffer: AudioBuffer | null = null;

  constructor() {
    const unlock = () => {
      this.unlocked = true;
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      // ניגון כל מה שחיכה לאינטראקציה הראשונה
      for (const [channel, play] of this.pending) {
        this.play(channel, play.src, { loop: play.loop });
      }
      this.pending.clear();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    for (const audio of this.active.values()) audio.volume = this.volume;
  }

  getVolume(): number {
    return this.volume;
  }

  /** מנגן src בערוץ נתון; עוצר את הסאונד הקודם באותו ערוץ. src ריק/null עוצר בלבד. */
  play(channel: SoundChannel, src: string | null, { loop = false } = {}): void {
    this.stop(channel);
    if (!src) return;
    if (!this.unlocked) {
      this.pending.set(channel, { src, loop });
      return;
    }
    const audio = new Audio(src);
    audio.loop = loop;
    audio.volume = this.volume;
    audio.addEventListener('ended', () => {
      if (this.active.get(channel) === audio) this.active.delete(channel);
    });
    this.active.set(channel, audio);
    audio.play().catch(() => {
      // הדפדפן חסם — נשמור לניסיון חוזר אחרי אינטראקציה
      this.unlocked = false;
      this.pending.set(channel, { src, loop });
      this.active.delete(channel);
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

  stopAll(): void {
    for (const channel of [...this.active.keys()]) this.stop(channel);
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

      const source = ctx.createBufferSource();
      source.buffer = this.applauseBuffer;
      const gain = ctx.createGain();
      gain.gain.value = this.volume;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start();
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
