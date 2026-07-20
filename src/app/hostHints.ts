/**
 * רמזי מקשים למנחה לפי מצב המשחק — פונקציה טהורה (נבדקת ביחידה). מחזירה את
 * הפעולה של הרווח בשלב הנוכחי + מקשי המספרים הרלוונטיים כרגע, כדי שפס ההנחיות
 * התחתון יראה למנחה בדיוק מה אפשר ללחוץ ("רווח: הצגת תשובה · 1: מובילים · ...").
 * הלוגיקה של הרווח משקפת את advanceStep ב-GameHost.
 */

import type { GamePhase, ActiveMedia } from '../engine/types.ts';

export interface HostHint {
  /** תווית המקש (למשל "רווח", "1", "4/5", "N"). */
  key: string;
  /** מה המקש עושה בשלב הנוכחי. */
  label: string;
}

export interface HostHintInput {
  phase: GamePhase;
  activeMedia: ActiveMedia;
  slideType: string;
  votable: boolean;
  totalAnswers: number;
  questionShown: boolean;
  answersShown: number;
  revealCorrect: boolean;
  /** האם יש שקופית הבאה (אחרת "רווח" מסיים למסך המנצחים). */
  hasNextSlide: boolean;
}

/** מה עושה הרווח (מקש 0) בשלב הנוכחי. */
function spaceAction(a: HostHintInput): string {
  if (a.activeMedia !== null) return 'המשך (סיום המדיה)';
  if (a.phase === 'showing' && a.votable) {
    if (!a.questionShown) return 'הצגת השאלה';
    if (a.answersShown < a.totalAnswers) return 'הצגת תשובה';
    return 'פתיחת ההצבעה + טיימר';
  }
  if (a.phase === 'showing') return a.hasNextSlide ? 'השקופית הבאה' : 'סיום המשחק';
  if (a.phase === 'voting') return 'סיום ההצבעה';
  if (a.phase === 'results') {
    if (!a.revealCorrect) return a.slideType === 'trivia' ? 'חשיפת התשובה הנכונה' : 'חשיפת התוצאות';
    return a.hasNextSlide ? 'השקופית הבאה' : 'סיום המשחק';
  }
  return 'המשך';
}

/**
 * רשימת רמזי המקשים לשלב הנוכחי: רווח (פעולה משתנה) + מקשי מספרים לפי הקשר.
 * 4/5 (‎±10 שניות) ו-6 (השהיה) רלוונטיים רק בזמן הצבעה; 1/2/3/N תמיד במשחק.
 */
export function hostKeyHints(a: HostHintInput): HostHint[] {
  const hints: HostHint[] = [{ key: 'רווח', label: spaceAction(a) }];
  if (a.phase === 'voting') {
    hints.push({ key: '4/5', label: '‎+10 / ‎−10 שניות' });
    hints.push({ key: '6', label: 'השהיה / המשך' });
  }
  hints.push({ key: '1', label: 'טבלת מובילים' });
  hints.push({ key: '2', label: 'צעד אחורה' });
  hints.push({ key: '3', label: 'מחיאות כפיים' });
  hints.push({ key: 'N', label: a.hasNextSlide ? 'דילוג לשקופית הבאה' : 'סיום המשחק' });
  return hints;
}
