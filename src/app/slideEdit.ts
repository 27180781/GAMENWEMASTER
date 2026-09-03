/**
 * פעולות עריכת שקופיות טהורות (למסך המנחה — שלב ב׳). כל פונקציה מקבלת GameFile
 * ומחזירה GameFile חדש (אימוטבילי) — קל לבדיקה, ומוזרם לתצוגה שמריצה
 * engine.updateGame (hot-swap, לסשן בלבד). התוצאה עוברת פענוח סלחני בתצוגה,
 * כך ששקופית פגומה זמנית לא מפילה את המשחק.
 */

import type { z } from 'zod';
import type { GameFile, Slide, SlideType } from '../engine/index.ts';
import { functionConfigSchema } from '../engine/schema.ts';
import { describeObject, type FieldNode } from './schemaForm.ts';

/** הקונפיג של שקופית "פעולת מערכת", כפי שהסכימה מגדירה אותו. */
type FunctionConfig = NonNullable<Slide['function']>;

const clone = <T>(x: T): T => structuredClone(x);

/** מזהה שקופית פנוי חדש (מקסימום + 1). */
export function nextSlideId(game: GameFile): number {
  return game.questions.reduce((m, q) => Math.max(m, q.id), 0) + 1;
}

/** הזזת שקופית מקום אחד למעלה (‎-1) או למטה (‎+1). */
export function moveSlide(game: GameFile, index: number, dir: -1 | 1): GameFile {
  const j = index + dir;
  if (index < 0 || index >= game.questions.length || j < 0 || j >= game.questions.length) return game;
  const questions = clone(game.questions);
  const tmp = questions[index]!;
  questions[index] = questions[j]!;
  questions[j] = tmp;
  return { ...game, questions };
}

/** מחיקת שקופית (לא מוחקים את האחרונה — חייבת להישאר לפחות אחת). */
export function removeSlide(game: GameFile, index: number): GameFile {
  if (game.questions.length <= 1 || index < 0 || index >= game.questions.length) return game;
  return { ...game, questions: game.questions.filter((_, i) => i !== index) };
}

/** שכפול שקופית (עם מזהה חדש) מיד אחרי המקור. */
export function duplicateSlide(game: GameFile, index: number): GameFile {
  const slide = game.questions[index];
  if (!slide) return game;
  const copy: Slide = { ...clone(slide), id: nextSlideId(game) };
  const questions = [...game.questions];
  questions.splice(index + 1, 0, copy);
  return { ...game, questions };
}

/**
 * הוספת שקופית טריוויה חדשה מיד אחרי המיקום. נבנית על בסיס מבנה שקופית קיימת
 * (‏setting/רקע תקינים) עם טקסט מרוקן ושתי תשובות — כדי שתעבור ולידציה מיד.
 */
export function addSlide(game: GameFile, index: number): GameFile {
  const base = game.questions[index] ?? game.questions[0];
  if (!base) return game;
  const blank: Slide = {
    ...clone(base),
    id: nextSlideId(game),
    type: 'trivia',
    question: {
      ...clone(base.question),
      que: 'שאלה חדשה',
      src: '',
      answers: [
        { ans: 'תשובה 1', correct: true, id: 1 },
        { ans: 'תשובה 2', correct: false, id: 2 },
      ],
    },
    openMedia: { src: '' },
    endMedia: { src: '' },
  };
  const questions = [...game.questions];
  questions.splice(index + 1, 0, blank);
  return { ...game, questions };
}

/**
 * סוגי השקופיות שאפשר לבחור בעורך, עם שם קריא, אייקון והסבר קצר.
 * הסדר הוא סדר התצוגה — מהנפוץ לנדיר.
 */
export const SLIDE_TYPES: { value: SlideType; label: string; icon: string; hint: string }[] = [
  { value: 'trivia', label: 'שאלת טריוויה', icon: '📄', hint: 'תשובות עם תשובה נכונה אחת — ניקוד לפי נכונות ומהירות' },
  { value: 'survey', label: 'סקר', icon: '◔', hint: 'תשובות בלי נכון/לא נכון — מציג התפלגות' },
  { value: 'ans_images', label: 'תשובות תמונה', icon: '🖼', hint: 'כמו טריוויה, אבל כל תשובה היא תמונה' },
  { value: 'media', label: 'מדיה', icon: '🎬', hint: 'תמונה/וידאו במסך מלא, בלי הצבעה' },
  { value: 'subject', label: 'כותרת / נושא', icon: '📒', hint: 'טקסט גדול על המסך, בלי הצבעה' },
  { value: 'function', label: 'פעולת מערכת', icon: '⚡', hint: 'איפוס ניקוד, מסך מנצחים, קריאת API, הסרת משתתפים' },
];

/** התיאור של סוג שקופית (אייקון/תווית) — עם נפילה שקטה לסוג שאינו ברשימה. */
export function slideTypeInfo(type: string): { label: string; icon: string; hint: string } {
  return SLIDE_TYPES.find((t) => t.value === type) ?? { label: type, icon: '❓', hint: '' };
}

/**
 * שורת המשנה בכרטיס השקופית — מה שעוזר לזהות אותה ברשימה בלי לפתוח:
 * בשקופית מצביעה התשובה הנכונה (או התשובות), בפעולה — הפעולה, ואחרת סוג השקופית.
 */
export function slideSubtitle(slide: Slide): string {
  if (slide.type === 'function') {
    const action = slide.function?.action ?? '';
    const label = ACTION_LABELS.find((o) => o.value === action)?.label;
    return label ?? slideTypeInfo(slide.type).label;
  }
  if (!VOTABLE_TYPES.has(slide.type)) return slideTypeInfo(slide.type).label;
  // בסקר אין תשובה נכונה. הדגל `correct` עדיין יכול להיות שם — הוא נשמר בכוונה
  // בהחלפת סוג — ולכן חייבים לסנן לפי הסוג, אחרת הכרטיס היה מסמן ✓ בסקר.
  if (slide.type !== 'survey') {
    const text = slide.question.answers.find((a) => a.correct)?.ans.trim();
    if (text !== undefined && text !== '') return `✓ ${text}`;
  }
  const all = slide.question.answers.map((a) => a.ans.trim()).filter((a) => a !== '');
  return all.length > 0 ? all.join(' · ') : slideTypeInfo(slide.type).label;
}

/** הוספת שקופית מסוג מבוקש מיד אחרי המיקום (הרכבה של addSlide + changeSlideType). */
export function addSlideOfType(game: GameFile, index: number, type: SlideType): GameFile {
  const added = addSlide(game, index);
  if (added === game) return game;
  return changeSlideType(added, Math.min(index + 1, added.questions.length - 1), type);
}

/** האם השקופית מקבלת הצבעות (ולכן צריכה תשובות). */
export const VOTABLE_TYPES = new Set<string>(['trivia', 'survey', 'ans_images']);

/** תוויות הפעולות — נגזרות מהסכימה פעם אחת (ראו functionConfigSchema). */
const ACTION_LABELS: { value: string; label: string }[] = (() => {
  const node = describeObject(functionConfigSchema).find((n) => n.key === 'action');
  return node?.kind === 'enum' ? node.options : [];
})();

/**
 * החלפת סוג השקופית — עם השלמת מה שהסוג החדש *מחייב*.
 *
 * הסכימה אוכפת מגבלות לפי סוג (שקופית מצביעה חייבת ≥2 תשובות, ו-trivia חייבת
 * תשובה נכונה אחת לפחות), ולכן החלפה "נאיבית" של השדה הייתה יכולה לייצר קובץ
 * שלא ייטען יותר. הפונקציה משלימה את החסר, ו**אינה מוחקת** נתונים של הסוג
 * הקודם — כך שהחלפה הלוך-ושוב מחזירה את המצב, ולא מאבדת תשובות שנכתבו.
 */
export function changeSlideType(game: GameFile, index: number, type: SlideType): GameFile {
  return updateSlide(game, index, (slide) => {
    const next: Slide = { ...slide, type };

    if (VOTABLE_TYPES.has(type)) {
      const answers = [...next.question.answers];
      // ≥2 תשובות — אחרת הקובץ נפסל בטעינה
      while (answers.length < 2) {
        answers.push({ ans: `תשובה ${answers.length + 1}`, correct: false, id: answers.length + 1 });
      }
      // trivia — חייבת תשובה נכונה אחת לפחות
      if (type === 'trivia' && !answers.some((a) => a.correct)) {
        answers[0] = { ...answers[0]!, correct: true };
      }
      next.question = { ...next.question, answers };
    }

    // פעולת מערכת — בלי קונפיג היא לא תעשה דבר; ברירת מחדל שמישה ובטוחה
    // (מסך מנצחים — עושה משהו נראה לעין מיד, בניגוד ל-API בלי כתובת).
    if (type === 'function' && next.function === undefined) {
      next.function = withActionDefaults({ action: 'screen' });
    }
    return next;
  });
}

/**
 * השלמת תת-הקונפיג של הפעולה הנבחרת מברירות המחדל **של הסכימה**.
 *
 * `api`/`screen`/`score`/`players` הם אופציונליים בסכימה, ולכן בבחירת פעולה
 * חדשה בעורך הבלוק שלה היה מוצג ריק (ובזמן ריצה המנוע היה מדווח שגיאה על
 * קונפיג חסר). כאן ממלאים אותו בדיוק במה שהסכימה מגדירה — בלי טבלת ברירות
 * מחדל משוכפלת שתפגר אחריה.
 */
export function withActionDefaults(config: FunctionConfig): FunctionConfig {
  const action = config.action;
  const bag = config as unknown as Record<string, unknown>;
  if (action === '' || bag[action] !== undefined) return config;
  const shape = functionConfigSchema.shape as unknown as Record<string, z.ZodTypeAny | undefined>;
  const field = shape[action];
  if (field === undefined) return config; // פעולה שאין לה תת-קונפיג בסכימה
  const parsed = field.safeParse({});
  if (!parsed.success || parsed.data === undefined) return config;
  return { ...config, [action]: parsed.data } as FunctionConfig;
}

/**
 * חלוקת שדות טופס הפעולה: מה שמוצג תמיד (בורר הפעולה, וכל שדה עתידי שאינו
 * בלוק), והבלוק של הפעולה הנבחרת בלבד — כדי שהמנחה לא יראה במקביל את הגדרות
 * ה-API, המסך והניקוד כשהוא בכלל בחר "הסרת משתתפים".
 * פעולה שאין לה בלוק בסכימה (ערך מקובץ ישן) מחזירה את הכול, כדי ששום הגדרה
 * שנמצאת בקובץ לא תהפוך לבלתי-נגישה.
 */
export function functionFormNodes(
  nodes: FieldNode[],
  action: string,
): { top: FieldNode[]; section: FieldNode | null } {
  const section = nodes.find((n) => n.key === action && n.kind === 'object') ?? null;
  if (section === null) return { top: nodes, section: null };
  return { top: nodes.filter((n) => n.kind !== 'object'), section };
}

/**
 * מריץ את ההשלמה על שקופית "פעולת מערכת" שבמיקום נתון. נקרא אחרי כל שינוי
 * בטופס הפעולה, כך שבחירת פעולה אחרת מביאה איתה מיד את השדות שלה.
 */
export function normalizeFunctionSlide(game: GameFile, index: number): GameFile {
  const slide = game.questions[index];
  if (!slide || slide.type !== 'function' || slide.function === undefined) return game;
  const next = withActionDefaults(slide.function);
  if (next === slide.function) return game;
  return updateSlide(game, index, (s) => ({ ...s, function: next }));
}

/** החלת שינוי על שקופית לפי מיקום (updater מקבל עותק ומחזיר שקופית חדשה). */
export function updateSlide(game: GameFile, index: number, updater: (s: Slide) => Slide): GameFile {
  if (index < 0 || index >= game.questions.length) return game;
  const questions = game.questions.map((q, i) => (i === index ? updater(clone(q)) : q));
  return { ...game, questions };
}

/** הוספת תשובה לשקופית (עד שמירה על מבנה תקין). id לפי המיקום (1..N). */
export function addAnswer(slide: Slide): Slide {
  const answers = [...slide.question.answers];
  answers.push({ ans: `תשובה ${answers.length + 1}`, correct: false, id: answers.length + 1 });
  return { ...slide, question: { ...slide.question, answers } };
}

/** הסרת תשובה לפי מיקום — לא יורדים מתחת ל-2 תשובות בשקופית מצביעה. */
export function removeAnswer(slide: Slide, ansIndex: number): Slide {
  if (slide.question.answers.length <= 2) return slide;
  let answers = slide.question.answers.filter((_, i) => i !== ansIndex);
  // מזהים לפי מיקום; ולדאות שנשארת תשובה נכונה אחת בטריוויה.
  answers = answers.map((a, i) => ({ ...a, id: i + 1 }));
  if (slide.type === 'trivia' && !answers.some((a) => a.correct) && answers[0]) {
    answers[0] = { ...answers[0], correct: true };
  }
  return { ...slide, question: { ...slide.question, answers } };
}

/** קביעת התשובה הנכונה (טריוויה) לפי מיקום — בדיוק אחת נכונה. */
export function setCorrect(slide: Slide, ansIndex: number): Slide {
  const answers = slide.question.answers.map((a, i) => ({ ...a, correct: i === ansIndex }));
  return { ...slide, question: { ...slide.question, answers } };
}

/**
 * ערבוב סדר השאלות — כלי מ"כלים" בעורך.
 *
 * מעורבבות **רק שקופיות מצביעות**, וכל אחת נוחתת במקום של שקופית מצביעה אחרת.
 * שקופיות טקסט/מדיה/פונקציה נשארות במקומן: הן משמשות כפתיח, מעבר או סיום, ומשחק
 * שבו "ברוכים הבאים" קופץ לאמצע אינו ערבוב אלא תקלה.
 *
 * `rand` מוזרק כדי שהבדיקה תוכל לקבע את התוצאה.
 */
export function shuffleSlides(game: GameFile, rand: () => number = Math.random): GameFile {
  const spots: number[] = [];
  game.questions.forEach((q, i) => {
    if (VOTABLE_TYPES.has(q.type)) spots.push(i);
  });
  if (spots.length < 2) return game;
  const pool = spots.map((i) => game.questions[i]!);
  // Fisher–Yates
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const questions = [...game.questions];
  spots.forEach((slot, k) => {
    questions[slot] = pool[k]!;
  });
  return { ...game, questions };
}

/**
 * החלת זמן תגובה וניקוד על **כל השקופיות המצביעות** בבת אחת — כלי מ"כלים".
 * שדה שלא נמסר אינו נוגע בקובץ, כך שאפשר להחיל ניקוד בלי לדרוס זמנים.
 */
export function applyToAllSlides(
  game: GameFile,
  values: { timeForQue?: number; scoreForQue?: number },
): GameFile {
  const questions = game.questions.map((q) => {
    if (!VOTABLE_TYPES.has(q.type)) return q;
    return {
      ...q,
      question: {
        ...q.question,
        ...(values.timeForQue === undefined ? {} : { timeForQue: values.timeForQue }),
        ...(values.scoreForQue === undefined ? {} : { scoreForQue: values.scoreForQue }),
      },
    };
  });
  return { ...game, questions };
}
