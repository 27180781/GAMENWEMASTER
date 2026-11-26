/**
 * «מסך מנצחים» בשקופית פונקציה (function.action "screen", ו-screen.type שאינו
 * "leaderboard"): מסך המנצחים שמוצב באמצע המשחק או בסוף שלב. עד 2026-11-26 כל
 * המנצחים עלו בו יחד; מאז (בקשת נסים) הם נחשפים אחד-אחד, מהמקום האחרון לראשון,
 * בדיוק כמו במסך המנצחים שבסוף המשחק — אותו מסך (src/render/winners/), באותו
 * סגנון (setting.winnersStyle), עם התיפוף לפני המקום הראשון.
 *
 *   • רווח (או 0 בשלט המנחה) חושף את המקום הבא. רק אחרי שכולם על המסך הרווח
 *     עובר לשקופית הבאה, ולא בתוך WINNERS_CHAMPION_GUARD_MS מחשיפת המקום הראשון:
 *     התיפוף והחבטה לא נקטעים בלחיצה כפולה.
 *   • צעד אחורה (2) מסתיר את המקום האחרון שנחשף; בלי חשופים — השקופית הקודמת.
 *   • כל כניסה לשקופית (גם חזרה אליה) מתחילה בלי אף מקום חשוף, כמו שאלה שמתחילה
 *     נקייה.
 *   • במעבר אוטומטי — של המשחק (autoTransition.nextSlide) או של השקופית
 *     (automaticSkip) — החשיפה ממשיכה לבד, וההשהיה שהוגדרה עד השקופית הבאה נספרת
 *     מהרגע שהמקום הראשון כבר על המסך. בלי זה המעבר היה יוצא מהשקופית לפני שאיש
 *     נחשף (או נתקע אחרי החשיפה הראשונה).
 *
 * מוזיקת המנצחים (winnersMediaSound) נשארת של מסך הסיום בלבד, כמו קודם; כאן
 * מתנגנים אפקטי החשיפה של הסגנון. הקריין שותק כאן, כמו קודם. מסך המובילים
 * (screen.type "leaderboard") לא השתנה.
 *
 * הכללים כאן טהורים (בלי React ובלי טיימרים), ו-GameHost מחבר אותם.
 */

import {
  WINNERS_CHAMPION_GUARD_MS,
  WINNERS_CHAMPION_SPEAK_MS,
  winnersShownCount,
  type Slide,
} from '../engine/index.ts';

/** האם השקופית היא «מסך מנצחים» של שקופית פונקציה (כמו ההחלטה ב-SlideView). */
export function isWinnersScreenSlide(slide: Slide): boolean {
  if (slide.type !== 'function') return false;
  const fn = slide.function;
  return fn?.action === 'screen' && fn.screen?.type !== 'leaderboard';
}

/** כמה מקומות המסך מציג: multiWinners מתוך מי שיש לו ניקוד, עד WINNERS_MAX. */
export function screenWinnersTotal(winnersAvailable: number): number {
  return winnersShownCount(winnersAvailable);
}

/** מה הרווח עושה במסך: חושף מקום, ממתין לסוף התיפוף, או עובר לשקופית הבאה. */
export type ScreenForward = 'reveal' | 'wait' | 'next';

/**
 * @param shown כמה מקומות כבר נחשפו בכניסה הזאת לשקופית.
 * @param total כמה מקומות במסך (screenWinnersTotal). 0 = «אין משתתפים עם ניקוד».
 * @param sinceChampionMs כמה זמן עבר מהלחיצה שחשפה את המקום הראשון.
 */
export function screenForward(shown: number, total: number, sinceChampionMs: number): ScreenForward {
  if (shown < total) return 'reveal';
  if (total > 0 && sinceChampionMs < WINNERS_CHAMPION_GUARD_MS) return 'wait';
  return 'next';
}

/** מה הצעד אחורה עושה במסך: מסתיר את המקום האחרון שנחשף, או חוזר לשקופית הקודמת. */
export function screenBack(shown: number): 'hide' | 'previous' {
  return shown > 0 ? 'hide' : 'previous';
}

/** כמה מקומות חשופים אחרי צעד (1 קדימה, ‎-1 אחורה), בין 0 ל-total. */
export function screenShownAfter(shown: number, delta: 1 | -1, total: number): number {
  return Math.max(0, Math.min(total, Math.min(shown, total) + delta));
}

/** הרווח הבא חושף את המקום הזה (למשל 3, ואז 2 ואז 1), או null כשכולם על המסך. */
export function screenNextPlace(shown: number, total: number): number | null {
  return shown < total ? total - shown : null;
}

/** במעבר אוטומטי: ההמתנה מהכניסה לשקופית עד החשיפה הראשונה (המסך נכנס). */
export const SCREEN_AUTO_FIRST_MS = 1500;
/** במעבר אוטומטי: בין חשיפה לחשיפה (האפקטים של מקום נמשכים בערך שנייה וחצי). */
export const SCREEN_AUTO_REVEAL_MS = 2200;

/** במעבר אוטומטי: כמה זמן עד החשיפה הבאה, או null כשכולם כבר נחשפו. */
export function screenAutoRevealMs(shown: number, total: number): number | null {
  if (shown >= total) return null;
  return shown === 0 ? SCREEN_AUTO_FIRST_MS : SCREEN_AUTO_REVEAL_MS;
}

/**
 * זמן שנוסף להשהיה של המעבר האוטומטי לשקופית הבאה: השם של המקום הראשון עולה רק
 * אחרי התיפוף (ראו WINNERS_CHAMPION_SPEAK_MS), וההשהיה שהוגדרה נספרת משם. במסך
 * בלי מנצחים — כלום, כמו קודם.
 */
export function screenAutoHoldMs(total: number): number {
  return total > 0 ? WINNERS_CHAMPION_SPEAK_MS : 0;
}

/**
 * כמה מקומות חשופים בכניסה הנוכחית לשקופית. הרשומה שומרת לאיזו שקופית ולאיזו
 * כניסה (GameState.slideEntry) היא שייכת, ולכן כל כניסה מתחילה מ-0 בלי איפוס נפרד.
 */
export interface ScreenReveal {
  slideId: number;
  entry: number;
  shown: number;
  /** מתי (performance.now) נחשף המקום הראשון; ‎-Infinity כשעוד לא. */
  championAt: number;
}

export const NO_SCREEN_REVEAL: ScreenReveal = {
  slideId: -1,
  entry: -1,
  shown: 0,
  championAt: Number.NEGATIVE_INFINITY,
};

/** המקומות החשופים בכניסה הזאת, ומתי נחשף המקום הראשון — או 0 לכניסה אחרת. */
export function screenRevealFor(
  rec: ScreenReveal,
  slideId: number,
  entry: number,
): { shown: number; championAt: number } {
  return rec.slideId === slideId && rec.entry === entry
    ? { shown: rec.shown, championAt: rec.championAt }
    : { shown: 0, championAt: Number.NEGATIVE_INFINITY };
}

/** הרשומה אחרי צעד במסך (`now` = performance.now של הצעד). */
export function screenRevealStep(
  rec: ScreenReveal,
  slideId: number,
  entry: number,
  delta: 1 | -1,
  total: number,
  now: number,
): ScreenReveal {
  const current = screenRevealFor(rec, slideId, entry);
  const shown = screenShownAfter(current.shown, delta, total);
  const championAt =
    total > 0 && shown >= total
      ? current.shown >= total
        ? current.championAt // כבר היה חשוף — הזמן שלו לא זז
        : now
      : Number.NEGATIVE_INFINITY;
  return { slideId, entry, shown, championAt };
}
