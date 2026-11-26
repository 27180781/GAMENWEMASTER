/**
 * "מעבר אוטומטי" (setting.automaticSkip) — ההגדרה המתקדמת שמאפשרת לשקופית
 * להתקדם מעצמה אחרי X שניות, בלי לחיצת מפעיל.
 *
 * ההחלטה מופרדת מ-GameHost כדי שתהיה ניתנת לבדיקה: זו ההגדרה המתקדמת היחידה
 * שלא הייתה לה בדיקת התנהגות, ולכן "מעבר אוטומטי שהפסיק לעבוד" היה יכול
 * לעבור בשקט. הלוגיקה טהורה — בלי React, בלי טיימרים.
 *
 * מתי כן מדלגים:
 *   • השקופית סיימה את תפקידה — `results` אחרי שהתשובה הנכונה (או הפילוח)
 *     נחשפה, או `showing` בשקופית שאין בה הצבעה כלל (טקסט/מדיה/פונקציה).
 *     בשלב `results` החשיפה היא לחיצה נפרדת של המנחה, ולכן הספירה מתחילה
 *     ממנה. קודם היא התחילה בסגירת ההצבעה, והשקופית יכלה להתחלף לפני שהחדר
 *     ראה את התשובה, או לקטוע את צליל החשיפה.
 * מתי לא:
 *   • `voting` — שם הטיימר של השאלה אחראי לסיום, ולא הדילוג.
 *   • כשמתנגנת מדיה (`activeMedia`) — אסור לקטוע סרטון באמצע.
 *   • כששכבה חוסמת פתוחה (טבלת מובילים, פירוט הצבעות, תפריט…) — המשחק
 *     ממתין מתחתיה, כמו המעברים האוטומטיים של המנוע, והספירה מתחילה מחדש
 *     כשהיא נסגרת.
 *   • ב«מסך מנצחים» של שקופית פונקציה, כל עוד יש מקומות לחשוף — הם נחשפים לבד,
 *     והספירה מתחילה מהרגע שהמקום הראשון על המסך (screenWinners.ts).
 * ובזמן שהקריין מדבר — ממתינים לסוף המשפט, עם אותה תקרה כמו המעברים
 * האוטומטיים (narrationWait.ts).
 */

import { isVotableSlide, type GamePhase, type Slide } from '../engine/index.ts';
import { narrationSafeDelayMs } from './narrationWait.ts';

/** מה שמוצג עכשיו, מעבר לשקופית ולשלב. */
export interface AutoSkipScreen {
  /** מדיה חוסמת מתנגנת (activeMedia). */
  mediaPlaying: boolean;
  /** בשלב results: התשובה הנכונה (או הפילוח) כבר נחשפה. */
  answerRevealed: boolean;
  /** שכבה חוסמת פתוחה מעל השקופית. */
  covered: boolean;
  /** הקריין באמצע משפט. */
  narratorSpeaking: boolean;
  /**
   * «מסך מנצחים» בשקופית פונקציה (screenWinners.ts) שעוד חושף מקומות: לא מדלגים
   * עד שכולם על המסך (החשיפה עצמה ממשיכה לבד). חסר = לא.
   */
  revealPending?: boolean;
  /**
   * זמן שנוסף לפני ההשהיה: במסך המנצחים, עד שהמקום הראשון על המסך (אחרי התיפוף),
   * כך שההשהיה שהוגדרה נספרת משם. חסר = 0.
   */
  holdMs?: number;
}

/**
 * ההשהיה במילישניות עד למעבר האוטומטי, או null כשאין לדלג.
 *
 * `seconds: 0` (או שלילי) עדיין מדלג — אחרי טיק אחד, ולא מיידית: מעבר בתוך
 * אותו רינדור היה עלול להריץ שרשרת שקופיות בבת אחת.
 */
export function autoSkipDelayMs(
  slide: Slide,
  phase: GamePhase,
  screen: AutoSkipScreen,
): number | null {
  if (screen.mediaPlaying || screen.covered || screen.revealPending === true) return null;
  const skip = slide.setting.automaticSkip;
  if (!skip.active) return null;
  const done =
    (phase === 'results' && screen.answerRevealed) ||
    (phase === 'showing' && !isVotableSlide(slide));
  if (!done) return null;
  return narrationSafeDelayMs(
    Math.max(1, skip.seconds) * 1000 + Math.max(0, screen.holdMs ?? 0),
    screen.narratorSpeaking,
  );
}
