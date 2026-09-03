/**
 * "מעבר אוטומטי" (setting.automaticSkip) — ההגדרה המתקדמת שמאפשרת לשקופית
 * להתקדם מעצמה אחרי X שניות, בלי לחיצת מפעיל.
 *
 * ההחלטה מופרדת מ-GameHost כדי שתהיה ניתנת לבדיקה: זו ההגדרה המתקדמת היחידה
 * שלא הייתה לה בדיקת התנהגות, ולכן "מעבר אוטומטי שהפסיק לעבוד" היה יכול
 * לעבור בשקט. הלוגיקה טהורה — בלי React, בלי טיימרים.
 *
 * מתי כן מדלגים:
 *   • השקופית סיימה את תפקידה — `results` (התשובה כבר נחשפה), או `showing`
 *     בשקופית שאין בה הצבעה כלל (טקסט/מדיה/פונקציה).
 * מתי לא:
 *   • `voting` — שם הטיימר של השאלה אחראי לסיום, ולא הדילוג.
 *   • כשמתנגנת מדיה (`activeMedia`) — אסור לקטוע סרטון באמצע.
 */

import { isVotableSlide, type GamePhase, type Slide } from '../engine/index.ts';

/**
 * ההשהיה במילישניות עד למעבר האוטומטי, או null כשאין לדלג.
 *
 * `seconds: 0` (או שלילי) עדיין מדלג — אחרי טיק אחד, ולא מיידית: מעבר בתוך
 * אותו רינדור היה עלול להריץ שרשרת שקופיות בבת אחת.
 */
export function autoSkipDelayMs(
  slide: Slide,
  phase: GamePhase,
  mediaPlaying: boolean,
): number | null {
  if (mediaPlaying) return null;
  const skip = slide.setting.automaticSkip;
  if (!skip.active) return null;
  const waiting = phase === 'results' || (phase === 'showing' && !isVotableSlide(slide));
  if (!waiting) return null;
  return Math.max(1, skip.seconds) * 1000;
}
