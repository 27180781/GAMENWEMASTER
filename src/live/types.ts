/**
 * מצב המסך שעובר מהמסך הראשי למסך הצפייה (?view=) — החוזה בין שני הצדדים.
 *
 * זה **לא** מצב המנוע: זה מה שהקהל רואה, אחרי הסתרה. בכל מקום שבו המסך
 * הראשי מציג משהו שתלוי בשחקן, המזהה הוחלף בכינוי (aliases.ts), ו-`names` /
 * `colors` אומרים איך להציג כל כינוי. כל זמן (`at`) הוא שעון המחשב של המנחה;
 * מסך הצפייה מתרגם אותו לשעון שלו (ראו subscriber.ts).
 */

import type {
  ActiveMedia,
  BetOutcome,
  GamePhase,
  GlobalSettings,
  Slide,
  SubjectCommand,
} from '../engine/index.ts';
import type { RailPlayer, RevealState } from '../render/QuestionSlide.tsx';
import type { RaffleEntry } from '../render/RaffleOverlay.tsx';
import type { BoardState } from '../app/snakesLadders.ts';
import type { Category, Group } from '../app/roster.ts';

/** גרסת המבנה. מסך צפייה שמקבל גרסה אחרת מבקש מהצופה לרענן. */
export const LIVE_SCHEMA = 1;

export type LiveStage = 'opening' | 'playing' | 'winners' | 'scoreboard';

/** עוגן הטיימר: הערכים ברגע `at`. מסך הצפייה ממשיך לספור ממנו בעצמו. */
export interface LiveTimer {
  remaining: number;
  total: number;
  paused: boolean;
  elapsedMs: number;
  at: number;
}

export type LiveSoundKind = 'none' | 'play' | 'applause';

/** הסאונד האחרון שהמסך הראשי ניגן (הסאונדים במנוע בלעדיים — אחד בכל רגע). */
export interface LiveSound {
  seq: number;
  kind: LiveSoundKind;
  channel: string;
  src: string;
  loop: boolean;
  at: number;
}

export type LiveCueKind = 'climb' | 'fall' | 'fanfare';

/** אפקטים קצרים (סולמות וחבלים, הימור) — מתנגנים לצד הסאונד ולא במקומו. */
export interface LiveCue {
  seq: number;
  kind: LiveCueKind;
  at: number;
}

/** מצב המנוע כפי שהמסכים קוראים אותו — באותו מבנה, עם כינויים במקום מזהים. */
export interface LiveState {
  phase: GamePhase;
  currentSlideId: number;
  currentSlideIndex: number;
  activeMedia: ActiveMedia;
  openMediaPlayed: boolean;
  endMediaPlayed: boolean;
  subjectCommand: SubjectCommand;
  liveVotes: { counts: Record<string, number>; total: number } | null;
  scores: Record<string, number>;
  answerTimes: Record<string, { totalMs: number; count: number }>;
  votesBySlide: Record<number, Record<string, number>>;
  slidesCompleted: number[];
  firstClickWinners: Record<number, string>;
  betStakes: Record<number, Record<string, number>>;
  betOutcomes: Record<number, Record<string, BetOutcome>>;
  majorityBySlide: Record<number, number[]>;
}

export interface LiveOverlays {
  /** טבלת המובילים באמצע המשחק (מקש 1). */
  leaders: boolean;
  /** פירוט ההצבעות (מקש 5). */
  votes: boolean;
  /** מסך ההתחברות מעל המשחק (מקש X). */
  lobby: boolean;
  /** תוצאות ההימור. */
  bet: { title: string } | null;
  /** דירוג הקבוצות (מקש 4). */
  groups: { categoryIndex: number } | null;
  /** לוח סולמות וחבלים. */
  board: { board: BoardState; groups: Group[]; progression: 'dice' | 'percent' } | null;
  /** מסך ההצטרפות לקבוצות. */
  connect: {
    categoryName: string;
    groups: Group[];
    counts: Record<string, number>;
    total: number;
  } | null;
  /** הגרלה (מקש R). */
  raffle: { entries: RaffleEntry[]; winner: RaffleEntry; run: number } | null;
}

export interface LiveSnapshot {
  schema: typeof LIVE_SCHEMA;
  stage: LiveStage;
  game: {
    name: string;
    setting: GlobalSettings;
    slideCount: number;
    /** השקופית הנוכחית, ושקופית ההימור שהיא מכריעה — לפי מיקום. שאר השקופיות לא נשלחות. */
    slides: Record<string, Slide>;
  };
  state: LiveState;
  reveal: RevealState;
  timer: LiveTimer | null;
  /** כמה ענו נכון — לפס "צדקו/טעו" בזמן ההצבעה, בלי לשלוח איזו תשובה נכונה. */
  liveCorrectCount: number | null;
  players: RailPlayer[];
  leaders: RailPlayer[];
  lobby: RailPlayer[];
  join: { show: boolean; code: string; qr: string };
  overlays: LiveOverlays;
  winnersRevealed: number;
  scoresPage: number;
  fn: { status: 'idle' | 'sending' | 'sent' | 'error'; detail: string };
  /** שכבה חוסמת פתוחה במסך הראשי — המדיה שם עצורה. */
  paused: boolean;
  /** מתי התחילה המדיה החוסמת (פתיחה/סיום) — כדי שמי שנכנס באמצע יראה מאותה נקודה. */
  mediaAt: number | null;
  roster: { categories: Category[]; memberships: Record<string, Record<string, string>> };
  groupBonus: Record<string, number>;
  names: Record<string, string>;
  colors: Record<string, string>;
  sound: LiveSound;
  cues: LiveCue[];
}
