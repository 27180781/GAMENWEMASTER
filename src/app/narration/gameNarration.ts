/**
 * הגשר בין קובץ המשחק לבמאי הקריינות: איסוף הקטעים של שקופית, מספרי השאלות,
 * ורשימת התשובות בצורה שהבמאי מכיר. נפרד מ-narrationDirector כדי שהבמאי יישאר
 * טהור ובלי תלות בסכמת המשחק.
 */

import { isVotableSlide, type GameFile, type Slide } from '../../engine/index.ts';
import { isNarratedQuestionType, type NarrationAnswerView } from './narrationDirector.ts';

/** כל כתובות הקריינות של שקופית (שאלה, תשובות, תשובה נכונה), בלי ריקים. */
export function slideNarrationClips(slide: Slide): string[] {
  const nar = slide.narration;
  if (!nar) return [];
  const urls: string[] = [];
  if (nar.question !== null && nar.question !== '') urls.push(nar.question);
  for (const answer of nar.answers) if (answer !== null && answer !== '') urls.push(answer);
  if (nar.correct !== null && nar.correct !== '') urls.push(nar.correct);
  return urls;
}

/** כל כתובות הבנק של המשחק (הביטויים הקבועים של הקול). */
export function bankClips(game: GameFile): string[] {
  const bank = game.setting.narration?.bank;
  if (!bank) return [];
  return Object.values(bank).filter((url) => url !== '');
}

/** כל כתובות קטעי שמות הקבוצות של המשחק (`setting.narration.groups`). */
export function groupNameClips(game: GameFile): string[] {
  const groups = game.setting.narration?.groups;
  if (!groups) return [];
  return Object.values(groups).filter((url) => url !== '');
}

/**
 * קטעי שמות הקבוצות שעוד אפשר לנגן. קטע שהטעינה שלו כבר נכשלה (נתיב שלא
 * נמצא בחבילה האופליינית, 404, פענוח) יוצא מהמילון, והבמאי אומר את הניסוח
 * בלי השם — במקום "הקבוצה המובילה כרגע…" ושקט. הקטעים נטענים מראש יחד עם
 * הבנק, ולכן עד שמסך הקבוצות עולה הכישלון כבר ידוע.
 */
export function playableGroupClips(
  game: GameFile,
  failed: (url: string) => boolean,
): Record<string, string> {
  const groups = game.setting.narration?.groups ?? {};
  return Object.fromEntries(Object.entries(groups).filter(([, url]) => url !== '' && !failed(url)));
}

/**
 * מספר השאלה להכרזה: המקום של השקופית בין שקופיות השאלה (טריוויה/סקר/תמונות).
 * הימור, טקסט, מדיה ופונקציה אינם שאלות ואינם מזיזים את הספירה. 0 = לא שאלה.
 */
export function questionOrdinal(game: GameFile, slideId: number): number {
  let ordinal = 0;
  for (const slide of game.questions) {
    if (isNarratedQuestionType(slide.type)) ordinal += 1;
    if (slide.id === slideId) return isNarratedQuestionType(slide.type) ? ordinal : 0;
  }
  return 0;
}

/** כמה שקופיות שאלה יש במשחק — ל"עברנו את חצי הדרך" ול"השאלה האחרונה". */
export function questionTotal(game: GameFile): number {
  return game.questions.filter((slide) => isNarratedQuestionType(slide.type)).length;
}

/**
 * פעולת שקופית הפונקציה, מנורמלת לארבע המוכרות (ערך לא מוכר נופל ל-'api',
 * בדיוק כמו ה-host עצמו). null בכל שקופית שאינה פונקציה.
 */
export function narrationFunctionAction(
  slide: Slide,
): 'api' | 'screen' | 'score' | 'players' | null {
  if (slide.type !== 'function') return null;
  const action = slide.function?.action ?? 'api';
  return action === 'screen' || action === 'score' || action === 'players' ? action : 'api';
}

/**
 * האם שלבי החשיפה (`reveal`) שייכים לשקופית שמוצגת עכשיו.
 *
 * ב-GameHost איפוס שלבי החשיפה קורה ב-effect, ולכן יש קומיט אחד שבו
 * `state.currentSlideId` כבר התחלף אבל `reveal` עדיין מתאר את השקופית
 * הקודמת. להאכיל את הבמאי בצמד הזה פירושו לסמן את השאלה ואת כל התשובות
 * כ"כבר נאמרו" בשקופית החדשה, ולבטל קומיט אחר כך את המשפט שהתחיל — כלומר
 * שקט מוחלט מהשקופית השנייה והלאה. ה-host מדלג על הקומיט הזה.
 */
export function narrationRevealMatches(revealSlide: number | null, slideId: number): boolean {
  return revealSlide === slideId;
}

/** התשובות של השקופית בצורה שהבמאי מכיר (דגל נכונה + קטע הקריינות שלה). */
export function narrationAnswers(slide: Slide): NarrationAnswerView[] {
  if (!isVotableSlide(slide)) return [];
  const clips = slide.narration?.answers ?? [];
  return slide.question.answers.map((answer, index) => ({
    correct: answer.correct,
    clip: clips[index] ?? null,
  }));
}
