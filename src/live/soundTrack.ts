/**
 * מה המסך הראשי מנגן — כדי שמסך הצפייה ישמיע את אותו דבר.
 *
 * הצד של המנחה: SoundTrack מקבל כל בקשה של AudioManager (setObserver) ושומר
 * את הסאונד הנוכחי — הסאונדים במנוע בלעדיים, כך שתמיד יש אחד לכל היותר — ואת
 * האפקטים הקצרים האחרונים, שמתנגנים לצידו.
 *
 * הצד של הצופה: playMirroredSound מחליט, מול מה שכבר נוגן אצלו, מה לנגן עכשיו.
 * סאונד בלולאה (מוזיקת הלובי, הטיימר) מתחיל גם אצל מי שנכנס באמצע; סאונד חד
 * פעמי — רק אם הוא טרי, אחרת הצופה היה שומע "פתיחת שאלה" של לפני דקה.
 */

import type { AudioEvent } from '../app/AudioManager.ts';
import type { LiveCue, LiveSound } from './types.ts';

/** כמה אפקטים אחרונים נשמרים (שניים יכולים לקרות יחד — סולם וחבל). */
const CUES_KEPT = 4;
/** סאונד או אפקט חד-פעמי ישן מזה (ms) לא מתנגן אצל צופה שרק עכשיו קיבל אותו. */
export const FRESH_SOUND_MS = 3000;

export const SILENCE: LiveSound = {
  seq: 0,
  kind: 'none',
  channel: '',
  src: '',
  loop: false,
  at: 0,
};

export class SoundTrack {
  sound: LiveSound = SILENCE;
  cues: LiveCue[] = [];
  private seq = 0;
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  /** רושם בקשה; מחזיר true כשמשהו שהצופה צריך לדעת השתנה. */
  record(event: AudioEvent): boolean {
    const at = this.now();
    switch (event.type) {
      case 'play':
        if (event.src === null || event.src === '') return this.silence();
        this.seq += 1;
        this.sound = {
          seq: this.seq,
          kind: 'play',
          channel: event.channel,
          src: event.src,
          loop: event.loop,
          at,
        };
        return true;
      case 'stop':
        if (this.sound.kind !== 'play' || this.sound.channel !== event.channel) return false;
        return this.silence();
      case 'stopAll':
        return this.silence();
      case 'applause':
        this.seq += 1;
        this.sound = { seq: this.seq, kind: 'applause', channel: '', src: '', loop: false, at };
        return true;
      case 'cue': {
        this.seq += 1;
        this.cues = [...this.cues, { seq: this.seq, kind: event.kind, at }].slice(-CUES_KEPT);
        return true;
      }
    }
  }

  private silence(): boolean {
    if (this.sound.kind === 'none') return false;
    this.seq += 1;
    this.sound = { ...SILENCE, seq: this.seq, at: this.now() };
    return true;
  }
}

/** מה שהצופה צריך לעשות עכשיו כדי להשמיע את מה שהמסך הראשי משמיע. */
export type SoundAction =
  | { type: 'play'; channel: string; src: string; loop: boolean }
  | { type: 'applause' }
  | { type: 'stop' }
  | { type: 'cue'; kind: LiveCue['kind'] };

/**
 * ההחלטה (טהורה): מה לנגן מול מה שכבר נוגן. `lastSeq` = הסאונד האחרון שהצופה
 * כבר טיפל בו; `lastCueSeq` = האפקט האחרון. `toLocal` ממיר זמן של המנחה לזמן
 * של הצופה. מחזיר גם את ה-seq החדשים לשמירה.
 */
export function mirrorSoundActions(
  sound: LiveSound,
  cues: readonly LiveCue[],
  lastSeq: number,
  lastCueSeq: number,
  now: number,
  toLocal: (hostTime: number) => number,
): { actions: SoundAction[]; lastSeq: number; lastCueSeq: number } {
  const actions: SoundAction[] = [];
  let nextSeq = lastSeq;
  if (sound.seq !== lastSeq) {
    nextSeq = sound.seq;
    const fresh = now - toLocal(sound.at) <= FRESH_SOUND_MS;
    if (sound.kind === 'play' && (sound.loop || fresh)) {
      actions.push({ type: 'play', channel: sound.channel, src: sound.src, loop: sound.loop });
    } else if (sound.kind === 'applause' && fresh) {
      actions.push({ type: 'applause' });
    } else {
      actions.push({ type: 'stop' });
    }
  }
  let nextCue = lastCueSeq;
  for (const cue of cues) {
    if (cue.seq <= lastCueSeq) continue;
    nextCue = Math.max(nextCue, cue.seq);
    if (now - toLocal(cue.at) <= FRESH_SOUND_MS) actions.push({ type: 'cue', kind: cue.kind });
  }
  return { actions, lastSeq: nextSeq, lastCueSeq: nextCue };
}
