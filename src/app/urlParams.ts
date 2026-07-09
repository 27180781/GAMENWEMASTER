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
  const rawDemo = params.get('demo');
  const demo = rawDemo !== null && TRUTHY.has(rawDemo.trim().toLowerCase());
  return { gameUrl, pushUrl, demo };
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
}

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  crowdEnabled: true,
  voterCount: 40,
  speedFactor: 0.6,
  correctBias: 0.55,
  intervalMs: 300,
  hostVoterId: '',
};
