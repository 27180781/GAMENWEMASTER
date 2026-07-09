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
}
