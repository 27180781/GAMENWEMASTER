/**
 * פרמטרים בכתובת האפליקציה:
 *
 *   ?game=<URL של game.json>   — טעינת קובץ המשחק מהכתובת ופתיחתו ישירות.
 *   &demo=1                    — מדליק מראש את שחקני הדמה במסך ההגדרות.
 *   &push=<URL>                — ערוץ "פוש רענון": SSE (ברירת מחדל) או
 *                                WebSocket (ws://‎/wss://‎). כשמגיע אות בערוץ,
 *                                המשחק מרענן את התוכן בלי לאבד את מהלך המשחק.
 *
 * דוגמה: https://host/?game=https://example.com/game.json&push=https://example.com/events&demo=1
 */

export interface AppParams {
  /** כתובת קובץ משחק חיצוני, או null אם לא סופקה. */
  gameUrl: string | null;
  /** כתובת ערוץ הפוש (SSE/WebSocket) לרענון יזום, או null. */
  pushUrl: string | null;
  /** עקיפת כתובת שרת ההצבעות (ברירת מחדל: השרת הרשמי), או null. */
  voteServer: string | null;
  /** האם התבקש מצב דמו. */
  demo: boolean;
}

const TRUTHY = new Set(['', '1', 'true', 'yes', 'on']);

export function parseAppParams(search: string): AppParams {
  const params = new URLSearchParams(search);
  const rawGame = params.get('game');
  const gameUrl = rawGame !== null && rawGame.trim() !== '' ? rawGame.trim() : null;
  const rawPush = params.get('push');
  const pushUrl = rawPush !== null && rawPush.trim() !== '' ? rawPush.trim() : null;
  const rawServer = params.get('voteServer');
  const voteServer = rawServer !== null && rawServer.trim() !== '' ? rawServer.trim() : null;
  const rawDemo = params.get('demo');
  const demo = rawDemo !== null && TRUTHY.has(rawDemo.trim().toLowerCase());
  return { gameUrl, pushUrl, voteServer, demo };
}

/** מעברים אוטומטיים — ברירת מחדל מה-JSON, ניתן לדריסה בהגדרות ולשמירה. */
export interface AutoTransition {
  /** הצגת התשובות אוטומטית לאחר הצגת השאלה. */
  showAnswersAfterQuestion: boolean;
  /** התחלת הטיימר אוטומטית לאחר הצגת התשובה האחרונה. */
  startTimerAfterLastAnswer: boolean;
  /** הצגת התשובה הנכונה אוטומטית לאחר סיום הטיימר. */
  showCorrectAnswerAfterTimer: boolean;
  /** מעבר אוטומטי לשקופית הבאה לאחר X שניות. */
  nextSlide: { active: boolean; seconds: number };
}

/**
 * הגדרות המשחק — נקבעות במסך ההגדרות (המסך הראשון, וגם נגיש בכפתור ⚙
 * בכל שלב במשחק).
 */
export interface GameSettings {
  /**
   * שחקני דמה פעילים: ההצבעות מגיעות מקהל מדומה במקום מהסוקט.
   * (עד M3 אין סוקט אמיתי — ולכן ברירת המחדל דלוקה.)
   */
  crowdEnabled: boolean;
  /** כמות שחקני הדמה. */
  voterCount: number;
  /** בתוך איזה חלק מחלון ההצבעה מגיעות כל ההצבעות (0–1; קטן = מהיר). */
  speedFactor: number;
  /** הסתברות לבחירת התשובה הנכונה ב-trivia (0–1). */
  correctBias: number;
  /** קצב שליחת snapshots ב-ms (השרת האמיתי שולח ~250ms). */
  intervalMs: number;
  /**
   * שלט מנחה: מזהה קליקר / מספר טלפון שההקשות שלו הן פקודות מנחה (0–6)
   * ולא הצבעות — הוא לא משתתף במשחק. ריק = אין שלט מנחה.
   */
  hostVoterId: string;
  /** מעברים אוטומטיים (ברירת מחדל מה-JSON, ניתן לדריסה ולשמירה ב-localStorage). */
  autoTransition: AutoTransition;
  /** הצגת QR להתחברות מטלפונים (רק במשחק אונליין עם רישיון, לא דמו). */
  showQr: boolean;
}

/** כתובת ההתחברות מהטלפון עבור קוד QR — לפי קוד המשחק (room). */
export function joinQrUrl(room: string): string {
  return `https://clicker.clicker.co.il/?game=${encodeURIComponent(room)}`;
}

export const DEFAULT_AUTO_TRANSITION: AutoTransition = {
  showAnswersAfterQuestion: false,
  startTimerAfterLastAnswer: false,
  showCorrectAnswerAfterTimer: false,
  nextSlide: { active: false, seconds: 6 },
};

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  // ברירת מחדל: משחק אונליין רגיל (שחקנים אמיתיים). שחקני דמה נדלקים רק
  // כשהקישור כולל ‎?demo=1‎.
  crowdEnabled: false,
  voterCount: 40,
  speedFactor: 0.6,
  correctBias: 0.55,
  intervalMs: 300,
  hostVoterId: '',
  autoTransition: DEFAULT_AUTO_TRANSITION,
  showQr: false,
};

/**
 * דריסת המעברים האוטומטיים נשמרת ב-localStorage לפי מזהה המשחק — כך שהעדפת
 * המפעיל נשמרת בין רענונים, ומשחק חדש (id אחר) חוזר לברירת המחדל שלו מה-JSON.
 */
const AUTO_TRANSITION_KEY = (gameId: string) => `trivia:autoTransition:${gameId}`;

export function loadAutoTransition(gameId: string): AutoTransition | null {
  try {
    const raw = localStorage.getItem(AUTO_TRANSITION_KEY(gameId));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<AutoTransition>;
    return {
      showAnswersAfterQuestion: Boolean(parsed.showAnswersAfterQuestion),
      startTimerAfterLastAnswer: Boolean(parsed.startTimerAfterLastAnswer),
      showCorrectAnswerAfterTimer: Boolean(parsed.showCorrectAnswerAfterTimer),
      nextSlide: {
        active: Boolean(parsed.nextSlide?.active),
        seconds: Number(parsed.nextSlide?.seconds) || 6,
      },
    };
  } catch {
    return null;
  }
}

export function saveAutoTransition(gameId: string, value: AutoTransition): void {
  try {
    localStorage.setItem(AUTO_TRANSITION_KEY(gameId), JSON.stringify(value));
  } catch {
    /* localStorage לא זמין — מתעלמים */
  }
}
