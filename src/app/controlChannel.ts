/**
 * ערוץ שליטה בין המסך הגדול (התצוגה) ל"מסך המנחה" הנפרד — שניהם על אותו מחשב:
 *   • אונליין — טאב/חלון נוסף באותו דפדפן → BroadcastChannel (בלי שרת).
 *   • אופליין (EXE) — חלון Electron נוסף → ממסר דרך תהליך ה-main (IPC), כי
 *     BroadcastChannel אינו אמין בין חלונות file://.
 *
 * התצוגה היא מקור-האמת (מריצה את המנוע): היא מפרסמת תמונת-מצב (state), ומסך
 * המנחה שולח פקודות (cmd/host/goto/roster). ערוץ יחיד למכונה (משחק אחד חי בכל
 * רגע), כדי שלא יידרש לדעת את מזהה המשחק מראש. הפרוטוקול קטן ומפורש — קל
 * להרחיב אותו בהמשך (עריכת שקופיות וכו').
 */

import type { GameFile } from '../engine/index.ts';

/** תמצית שקופית לרשימה במסך המנחה. */
export interface SlideBrief {
  id: number;
  index: number;
  type: string;
  que: string;
  votable: boolean;
}

/** תמונת-מצב שהתצוגה מפרסמת למסך המנחה. */
export interface HostStateSnapshot {
  t: 'state';
  gameId: string;
  gameName: string;
  stage: string;
  phase: string;
  currentSlideId: number;
  currentSlideIndex: number;
  slides: SlideBrief[];
  /** הצבעות חיות על השקופית הנוכחית: כמה הצביעו מתוך כמה מחוברים. */
  votesTotal: number;
  connected: number;
  /** מובילים כלליים (שם + ניקוד), כבר עם שמות מהמרשם. */
  leaders: { name: string; score: number }[];
  reveal: { questionShown: boolean; answersShown: number; revealCorrect: boolean };
}

/** המשחק המלא (לעריכה במסך המנחה) — נשלח מהתצוגה בנפרד מ-state התכוף. */
export interface HostGameMessage {
  t: 'game';
  game: GameFile;
}

/** פקודות שמסך המנחה שולח לתצוגה. */
export type HostCommand =
  | { t: 'hello' } // בקשה לתצוגה לפרסם מיד את מצבה הנוכחי
  | { t: 'cmd'; cmd: 'advance' | 'back' | 'nextSlide' }
  | { t: 'host'; n: number } // runHostCommand(n) — 0..6
  | { t: 'goto'; slideId: number }
  | { t: 'roster' } // המרשם (localStorage) עודכן במסך המנחה — לטעון מחדש
  | { t: 'setGame'; game: GameFile } // עריכה חיה — החלת משחק מעודכן (hot-swap)
  | { t: 'connect'; categoryId: string | null }; // מסך התחברות לקבוצות בתצוגה (null = סגירה)

export type ControlMessage = HostStateSnapshot | HostGameMessage | HostCommand;

export interface ControlChannel {
  post: (msg: ControlMessage) => void;
  close: () => void;
}

const CHANNEL_NAME = 'trivia-control';

/** כל כמה זמן התצוגה מפרסמת פעימת-לב (מצב) גם בלי שינוי. */
export const HOST_HEARTBEAT_MS = 3000;
/** אחרי כמה שקט מסך המנחה מכריז על ניתוק (2.5 פעימות — סובלני לעיכוב). */
export const HOST_STALE_MS = 8000;

interface DesktopControlBridge {
  controlPost?: (msg: unknown) => void;
  onControl?: (cb: (msg: unknown) => void) => () => void;
}

function desktopControl(): DesktopControlBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  const d = (window as unknown as { triviaDesktop?: DesktopControlBridge }).triviaDesktop;
  return typeof d?.onControl === 'function' && typeof d.controlPost === 'function' ? d : undefined;
}

/** האם ערוץ שליטה זמין (EXE עם ממסר, או דפדפן עם BroadcastChannel). */
export function canControlChannel(): boolean {
  return desktopControl() !== undefined || typeof BroadcastChannel !== 'undefined';
}

/**
 * פותח את ערוץ השליטה. `onMessage` מקבל כל הודעה מהצד השני. מחזיר `post`
 * לשליחה ו-`close` לניקוי. no-op בטוח אם אין תשתית.
 */
export function openControlChannel(onMessage: (msg: ControlMessage) => void): ControlChannel {
  const bridge = desktopControl();
  if (bridge !== undefined) {
    // EXE — ממסר דרך main (משדר רק לחלונות האחרים, בלי הד לעצמנו).
    const off = bridge.onControl!((raw) => onMessage(raw as ControlMessage));
    return { post: (msg) => bridge.controlPost!(msg), close: off };
  }
  if (typeof BroadcastChannel !== 'undefined') {
    const ch = new BroadcastChannel(CHANNEL_NAME);
    ch.onmessage = (ev: MessageEvent) => onMessage(ev.data as ControlMessage);
    return { post: (msg) => ch.postMessage(msg), close: () => ch.close() };
  }
  return { post: () => {}, close: () => {} };
}
