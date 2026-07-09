/**
 * פרמטרים בכתובת האפליקציה:
 *
 *   ?game=<URL של game.json>   — טעינת קובץ המשחק מהכתובת ופתיחתו ישירות.
 *   &demo=1                    — מצב דמו: ההצבעות מגיעות משחקני דמה במקום
 *                                מהסוקט, אחרי מסך הגדרות (כמות שחקנים,
 *                                מהירות הצבעה וכו').
 *
 * דוגמה: https://host/?game=https://example.com/game.json&demo=1
 */

export interface AppParams {
  /** כתובת קובץ משחק חיצוני, או null אם לא סופקה. */
  gameUrl: string | null;
  /** האם התבקש מצב דמו. */
  demo: boolean;
}

const TRUTHY = new Set(['', '1', 'true', 'yes', 'on']);

export function parseAppParams(search: string): AppParams {
  const params = new URLSearchParams(search);
  const rawGame = params.get('game');
  const gameUrl = rawGame !== null && rawGame.trim() !== '' ? rawGame.trim() : null;
  const rawDemo = params.get('demo');
  const demo = rawDemo !== null && TRUTHY.has(rawDemo.trim().toLowerCase());
  return { gameUrl, demo };
}

/** הגדרות מצב הדמו — נקבעות במסך ההגדרות שנפתח ראשון. */
export interface DemoConfig {
  /** כמות שחקני הדמה. */
  voterCount: number;
  /** בתוך איזה חלק מחלון ההצבעה מגיעות כל ההצבעות (0–1; קטן = מהיר). */
  speedFactor: number;
  /** הסתברות לבחירת התשובה הנכונה ב-trivia (0–1). */
  correctBias: number;
  /** קצב שליחת snapshots ב-ms (השרת האמיתי שולח ~250ms). */
  intervalMs: number;
  /**
   * שלט מנחה: מזהה קליקר / מספר טלפון שההקשות שלו הן פקודות מנחה (1–6)
   * ולא הצבעות — הוא לא משתתף במשחק. ריק = אין שלט מנחה.
   */
  hostVoterId: string;
}

export const DEFAULT_DEMO_CONFIG: DemoConfig = {
  voterCount: 40,
  speedFactor: 0.6,
  correctBias: 0.55,
  intervalMs: 300,
  hostVoterId: '',
};
