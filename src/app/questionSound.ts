/**
 * צליל הצגת השאלה (setting.sound.showQuestionMediaSound) — מתי מנגנים אותו.
 *
 * הצליל מתנגן ברגע שהשאלה עולה. סאונד במנוע בלעדי (AudioManager.play עוצר את
 * כל השאר), ולכן מסך שמכסה את השאלה עם צליל משלו — מסך הפתיחה
 * (playersConnecting), טבלת המובילים (winnersList), מסכי הסיום — בולע אותו.
 * כך עלו שתי שאלות בכל משחק בלי הצליל שלהן:
 *   • שאלה 1 — היא עולה כבר מאחורי מסך הפתיחה, והרווח שמתחיל את המשחק רק
 *     הוריד את המסך.
 *   • השאלה שאחרי טבלת המובילים האוטומטית (setting.showWinnersListAfter) — הטבלה
 *     נפתחת באותו מעבר שבו השאלה הבאה עולה, והרווח שסוגר אותה רק עצר את צליל
 *     הטבלה.
 *
 * הכלל: שאלה שעולה מאחורי כיסוי לא מנגנת, וכשהכיסוי יורד מנגנים אותה — אם
 * השאלה עדיין במצב "רק עלתה". הלוגיקה טהורה כדי שתהיה ניתנת לבדיקה בנפרד
 * מ-GameHost.
 */

import type { ActiveMedia, GamePhase } from '../engine/index.ts';

export type QuestionSoundStage = 'opening' | 'playing' | 'winners' | 'scoreboard';

/**
 * האם מסך עם צליל משלו מכסה את השאלה: כל שלב שאינו המשחק עצמו (פתיחה,
 * מנצחים, ניקוד כולם), או טבלת המובילים מעליו. שכבות בלי צליל (מסך ההתחברות
 * במקש X, הגדרות, תפריט) אינן נחשבות — צליל השאלה ממשיך מתחתיהן.
 */
export function questionSoundCovered(stage: QuestionSoundStage, leadersOverlay: boolean): boolean {
  return stage !== 'playing' || leadersOverlay;
}

/** מה מוצג בשקופית הנוכחית — מה שההחלטה צריכה. */
export interface QuestionSoundView {
  votable: boolean;
  phase: GamePhase;
  activeMedia: ActiveMedia;
  questionShown: boolean;
  answersShown: number;
  revealCorrect: boolean;
}

/**
 * השאלה במצב "רק עלתה", הרגע שהצליל שייך אליו: מוצגת, אף תשובה עוד לא נחשפה,
 * לפני ההצבעה, ובלי מדיית פתיחה או סיום על המסך (אחרי מדיית פתיחה הצליל
 * מתנגן ממילא ברווח שמסיים אותה).
 */
export function questionJustShown(view: QuestionSoundView): boolean {
  return (
    view.votable &&
    view.phase === 'showing' &&
    view.activeMedia === null &&
    view.questionShown &&
    view.answersShown === 0 &&
    !view.revealCorrect
  );
}

/**
 * האם לנגן את צליל השאלה עכשיו, כשהכיסוי יורד. `slideChanged`: באותו מעבר גם
 * התחלפה השקופית (למשל המשך מגיבוי) — הכניסה לשקופית החדשה כבר ניגנה את
 * הצליל בעצמה, ושלבי החשיפה ב-`view` עוד של השקופית הקודמת.
 */
export function replayQuestionSound(input: {
  wasCovered: boolean;
  covered: boolean;
  slideChanged: boolean;
  view: QuestionSoundView;
}): boolean {
  return input.wasCovered && !input.covered && !input.slideChanged && questionJustShown(input.view);
}
