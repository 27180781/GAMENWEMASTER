/**
 * טיפוסי הליבה של המנוע: אירועים, מצב, snapshot, והצבעות.
 * הקובץ הזה (וכל src/engine/) טהור — אסור לייבא כאן React או DOM.
 */

import type { GameFile, Slide } from './schema.ts';

// ---------------------------------------------------------------------------
// הצבעות (SPEC סעיף 6)
// ---------------------------------------------------------------------------

/** Snapshot מצטבר של הצבעות כפי שמגיע מהשרת (~כל 250ms). */
export interface VoteSnapshot {
  /** מספר רץ — פערים מזוהים ע"י ה-adapter (M3), המנוע רק מתעלם מ-seq ישן. */
  seq: number;
  slideId: number;
  /** answerId → מספר הצבעות */
  counts: Record<string, number>;
  total: number;
  /** voterId → answerId (לניקוד; יכול להגיע רק בסגירת החלון) */
  voters?: Record<string, number>;
  /** ל-firstClicker */
  firstVoter?: string;
}

export interface VoteAdapter {
  connect(roomId: string): Promise<void>;
  disconnect(): void;
  onVoteSnapshot(cb: (snapshot: VoteSnapshot) => void): void;
  onStatusChange(cb: (status: 'connected' | 'reconnecting' | 'offline') => void): void;
  requestFullState(): Promise<VoteSnapshot>;
}

// ---------------------------------------------------------------------------
// אירועי המנוע
// ---------------------------------------------------------------------------

/**
 * כל האירועים נושאים `at` אופציונלי — חותמת זמן (ms) שמוזרקת מבחוץ.
 * המנוע טהור ואין לו שעון משלו; `at` נדרש רק ללוגיקת scoringReduction
 * (בלעדיו — לא מופעלת הפחתה). VOTING_TIMEOUT מגיע מבחוץ — המנוע לא מריץ
 * setTimeout בעצמו.
 */
export type GameEvent =
  | { type: 'ADVANCE'; at?: number }
  | { type: 'BACK'; at?: number }
  | { type: 'GOTO'; slideId: number; at?: number }
  | { type: 'VOTE_SNAPSHOT'; snapshot: VoteSnapshot; at?: number }
  | { type: 'VOTING_TIMEOUT'; at?: number }
  | { type: 'MEDIA_ENDED'; at?: number }
  /** פתיחת הצבעה מפורשת, בדילוג על שלב המדיה (ה-host קורא לזה אחרי חשיפת התשובות). */
  | { type: 'OPEN_VOTING'; at?: number };

// ---------------------------------------------------------------------------
// מצב המנוע
// ---------------------------------------------------------------------------

/** הפאזות בהתאם ל-GameSnapshot בסעיף 7.1 של המפרט. */
export type GamePhase = 'showing' | 'voting' | 'results' | 'ended';

/** מדיה חוסמת שמתנגנת כרגע (openMedia לפני השאלה / endMedia אחרי התוצאות). */
export type ActiveMedia = 'open' | 'end' | null;

/** פקודת מערכת שמופקת משקופית subject "קסם" (SPEC סעיף 4). ביצוע ה-side effect הוא באחריות ה-host. */
export type SubjectCommand =
  | { kind: 'dynamic-image'; url: string }
  | { kind: 'send-data' }
  | null;

/** המצב המלא שהמנוע פולט. אובייקט immutable — מוחלף בכל שינוי. */
export interface GameState {
  phase: GamePhase;
  /** id של השקופית הנוכחית (id-ים בקבצים הם 1..n אך המנוע לא מניח זאת). */
  currentSlideId: number;
  /** אינדקס השקופית במערך questions. */
  currentSlideIndex: number;
  /** מדיה חוסמת שמתנגנת כרגע. */
  activeMedia: ActiveMedia;
  /** האם openMedia כבר נוגן בשקופית הנוכחית (שלב שהושלם). */
  openMediaPlayed: boolean;
  /** האם endMedia כבר נוגן בשקופית הנוכחית (כדי לא לנגן שוב). */
  endMediaPlayed: boolean;
  /** פקודת מערכת פעילה משקופית subject (או null). */
  subjectCommand: SubjectCommand;
  /** ה-snapshot האחרון שהתקבל עבור השקופית הנוכחית — לתצוגת מונים חיה. */
  liveVotes: { counts: Record<string, number>; total: number } | null;
  /** ניקוד מצטבר: voterId → נקודות. */
  scores: Record<string, number>;
  /** slideId → voterId → answerId (הצבעות סופיות של שקופיות שנסגרו + הנוכחית). */
  votesBySlide: Record<number, Record<string, number>>;
  /** id-ים של שקופיות שהושלמו (עברנו מהן הלאה). */
  slidesCompleted: number[];
  /** slideId → voterId של הזוכה ב-firstClicker. */
  firstClickWinners: Record<number, string>;
}

// ---------------------------------------------------------------------------
// Snapshot לגיבוי/שחזור (SPEC סעיף 7.1)
// ---------------------------------------------------------------------------

export interface GameSnapshot {
  version: 1;
  gameId: string;
  roomId: string | null;
  /** אינקרמנט בכל שמירה. */
  seq: number;
  /** ISO */
  savedAt: string;
  currentSlideId: number;
  phase: GamePhase;
  scores: Record<string, number>;
  votesBySlide: Record<number, Record<string, number>>;
  slidesCompleted: number[];
  firstClickWinners: Record<number, string>;
}

// ---------------------------------------------------------------------------
// עזרים
// ---------------------------------------------------------------------------

export interface EngineOptions {
  /**
   * ניקוד השתתפות ל-survey/ans_images כאשר scoreForQue מוגדר (SPEC 5.2:
   * "להשאיר את זה מאחורי קונפיג"). ברירת מחדל: כבוי.
   */
  surveyParticipationScoring?: boolean;
  roomId?: string | null;
}

export type { GameFile, Slide };
