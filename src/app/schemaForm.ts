/**
 * תיאור טופס מתוך סכימת Zod — הלב של הדרישה ש"כל מה שיתווסף לתוכנה בעתיד גם
 * אפשרות העריכה שלו תתווסף".
 *
 * במקום לכתוב טופס ביד לכל שדה (מה שתמיד מפגר אחרי הסכימה), אנחנו קוראים את
 * הסכימה עצמה — שהיא ממילא מקור האמת של מה שהמנוע מקבל — ובונים ממנה עץ שדות.
 * שדה חדש ב-schema.ts יופיע בעורך בלי לגעת בקוד העורך.
 *
 * הקובץ טהור (בלי React) כדי שיהיה ניתן לבדיקת יחידה.
 */

import { z } from 'zod';

/** עלה = שדה עריכה בודד; object = קבוצה מקוננת. */
export type FieldNode =
  | { kind: 'object'; key: string; label: string; children: FieldNode[] }
  | { kind: 'string'; key: string; label: string; optional: boolean }
  /**
   * `empty` = מה נכתב כשמנקים את השדה. לא תמיד null: הסכימה משתמשת בתבנית
   * `emptyableNumber` שמצפה למחרוזת ריקה, ובשדה חובה ריקון פירושו 0.
   */
  | { kind: 'number'; key: string; label: string; optional: boolean; empty: number | '' | null }
  | { kind: 'boolean'; key: string; label: string; optional: boolean }
  /** בחירה מרשימה. `options` נגזר מ-z.enum או ממטא-דאטה `choice:` שבסכימה. */
  | {
      kind: 'enum';
      key: string;
      label: string;
      optional: boolean;
      options: { value: string; label: string }[];
    }
  /** טיפוס שאין לו עורך ייעודי (מערך/union מורכב) — מוצג כ-JSON גולמי. */
  | { kind: 'json'; key: string; label: string; optional: boolean };

/**
 * מסיר עטיפות (optional/default/nullable/effects) ומחזיר את הטיפוס הפנימי.
 * `description` נאסף תוך כדי הפירוק, כי `.describe()` יושב על העטיפה שעליה
 * הוא הופעל — ולכן היה הולך לאיבוד אילו היינו קוראים רק את הטיפוס הפנימי.
 */
function unwrap(type: z.ZodTypeAny): {
  inner: z.ZodTypeAny;
  optional: boolean;
  description: string | undefined;
} {
  let current = type;
  let optional = false;
  let description: string | undefined;
  // הגנה מפני עטיפה מעגלית/עמוקה מדי — לא אמור לקרות, אבל לא נתקע.
  for (let i = 0; i < 20; i += 1) {
    const def = current._def as {
      typeName?: string;
      innerType?: z.ZodTypeAny;
      schema?: z.ZodTypeAny;
      description?: string;
    };
    if (description === undefined && typeof def.description === 'string') description = def.description;
    const name = def.typeName;
    if (name === 'ZodOptional' || name === 'ZodNullable' || name === 'ZodDefault') {
      optional = true;
      current = def.innerType as z.ZodTypeAny;
      continue;
    }
    if (name === 'ZodEffects') {
      current = def.schema as z.ZodTypeAny;
      continue;
    }
    break;
  }
  return { inner: current, optional, description };
}

/** התחילית שמסמנת מטא-דאטה של רשימת בחירה בתיאור השדה (ראו `choice` ב-schema.ts). */
const CHOICE_PREFIX = 'choice:';

/**
 * קורא רשימת בחירה מתיאור השדה. הפורמט: `choice:{"value":"תווית",…}`.
 * מוחזר null כשאין מטא-דאטה כזו — ואז השדה נשאר טקסט חופשי כרגיל.
 */
function parseChoice(description: string | undefined): { value: string; label: string }[] | null {
  if (description === undefined || !description.startsWith(CHOICE_PREFIX)) return null;
  try {
    const raw: unknown = JSON.parse(description.slice(CHOICE_PREFIX.length));
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const options = Object.entries(raw as Record<string, unknown>).map(([value, label]) => ({
      value,
      label: typeof label === 'string' && label !== '' ? label : value,
    }));
    return options.length > 0 ? options : null;
  } catch {
    return null;
  }
}

/**
 * תוויות בעברית לשדות מוכרים. שדה שאין לו תווית מוצג בשמו האנגלי — כך שדה
 * חדש בסכימה עדיין ניתן לעריכה מיד, ורק ההתייפות דורשת עדכון.
 */
const LABELS: Record<string, string> = {
  titleThroughoutGame: 'כותרת קבועה במשחק',
  ansIsNumber: 'תשובות ממוספרות (במקום אותיות)',
  allowChangeVote: 'אפשר שינוי הצבעה בזמן הטיימר',
  multiWinners: 'מספר הזוכים במסך הסיום',
  showWinnersListAfter: 'הצגת טבלת מובילים כל N שאלות',
  winnersListCount: 'כמה מובילים בטבלה',
  mainColor: 'צבע ראשי',
  secondaryColor: 'צבע משני',
  gameMedia: 'מדיית פתיחה',
  logo: 'לוגו',
  triviaMedia: 'מדיית שאלות',
  winnersListMedia: 'מדיית טבלת מובילים',
  winnersMedia: 'מדיית מנצחים',
  sound: 'צלילים',
  playersConnectingMediaSound: 'צליל התחברות שחקנים',
  showQuestionMediaSound: 'צליל הצגת שאלה',
  winnersMediaSound: 'צליל מנצחים',
  winnersListMediaSound: 'צליל טבלת מובילים',
  genericMediaSound: 'צליל כללי',
  timerMediaSound: 'צליל טיימר',
  inShowAnsMediaSound: 'צליל חשיפת תשובה',
  limit: 'רישיון ומגבלות',
  type: 'סוג',
  number: 'מספר מרבי',
  autoTransition: 'מעברים אוטומטיים',
  nextSlide: 'מעבר לשקופית הבאה',
  gameType: 'סוג המשחק',
  gameTypeSettings: 'הגדרות סוג המשחק',
  snakesLadders: 'סולמות ונחשים',
  progression: 'אופן ההתקדמות',
  src: 'קובץ / קישור',
  active: 'פעיל',
  seconds: 'שניות',
  score: 'ניקוד',
  slideStartVoting: 'פתיחת הצבעה מיד',
  playAfterClicking: 'ניגון אחרי לחיצה',
  exitGame: 'סיום המשחק בשקופית זו',
  correctlyAnsweredBefore: 'רק מי שענה נכון קודם',
  firstClicker: 'הראשון שלוחץ בלבד',
  answerIsSequenceClicks: 'תשובה כרצף לחיצות',
  fullscreen: 'מסך מלא',
  scoringReduction: 'הפחתת ניקוד לפי זמן',
  slidBackgroundMedia: 'רקע השקופית',
  automaticSkip: 'דילוג אוטומטי',
  showInLoop: 'הצגה בלולאה',
  groupRestriction: 'הגבלה לקבוצה',
  groupName: 'שם הקבוצה',
  showAnswersAfterQuestion: 'הצגת תשובות אחרי השאלה',
  startTimerAfterLastAnswer: 'הפעלת טיימר אחרי התשובה האחרונה',
  showCorrectAnswerAfterTimer: 'חשיפת התשובה בסיום הטיימר',
  media: 'מדיה',
  image: 'תמונה',
  video: 'וידאו',
  playToEnd: 'ניגון עד הסוף',
  // שקופית "פעולת מערכת" (function)
  action: 'הפעולה',
  api: 'קריאת API (webhook)',
  url: 'כתובת (URL)',
  method: 'שיטת שליחה',
  screen: 'מסך להצגה',
  operation: 'הפעולה על הניקוד',
  players: 'משתתפים',
  mode: 'מה לעשות בנבחרים',
  unit: 'יחידת הכמות',
  amount: 'כמות',
  selection: 'לפי מה בוחרים',
  groups: 'שמות הקבוצות',
};

/** תווית להצגה: עברית אם מוכר, אחרת שם השדה עצמו. */
export function labelFor(key: string): string {
  return LABELS[key] ?? key;
}

/**
 * בונה עץ שדות מסכימת אובייקט. שדות שאין להם עורך ייעודי מקבלים 'json' —
 * כך שגם הם ניתנים לעריכה, ושום דבר בסכימה אינו בלתי-נגיש.
 * @param schema סכימת האובייקט
 * @param skip שמות שדות ברמה העליונה שכבר נערכים בטופס ייעודי
 */
export function describeObject(schema: z.ZodTypeAny, skip: string[] = []): FieldNode[] {
  const { inner } = unwrap(schema);
  const def = inner._def as { typeName?: string; shape?: () => Record<string, z.ZodTypeAny> };
  if (def.typeName !== 'ZodObject' || typeof def.shape !== 'function') return [];
  const skipSet = new Set(skip);
  const out: FieldNode[] = [];
  for (const [key, child] of Object.entries(def.shape())) {
    if (skipSet.has(key)) continue;
    const node = describeField(key, child);
    if (node !== null) out.push(node);
  }
  return out;
}

/**
 * האם זה איחוד "מספר או ריק" — התבנית `emptyableNumber` שחוזרת בכל הסכימה
 * (`z.union([z.number(), z.literal('')])`, לפעמים גם עם null). בלי הזיהוי הזה
 * שדות כמו "שניות" ו"ניקוד" היו נערכים כ-JSON גולמי במקום כשדה מספר.
 */
function numericUnion(def: { typeName?: string; options?: z.ZodTypeAny[] }): { empty: '' | null } | null {
  if (def.typeName !== 'ZodUnion' || !Array.isArray(def.options)) return null;
  let sawNumber = false;
  let sawEmptyString = false;
  for (const option of def.options) {
    const o = option._def as { typeName?: string; value?: unknown };
    if (o.typeName === 'ZodNumber') {
      sawNumber = true;
      continue;
    }
    if (o.typeName === 'ZodNull') continue;
    if (o.typeName === 'ZodLiteral' && (o.value === '' || typeof o.value === 'number')) {
      if (typeof o.value === 'number') sawNumber = true;
      else sawEmptyString = true;
      continue;
    }
    return null;
  }
  // מחרוזת ריקה מועדפת כשהיא בכלל אפשרית — זו הצורה שהסכימה מנרמלת.
  return sawNumber ? { empty: sawEmptyString ? '' : null } : null;
}

/** בונה צומת יחיד לשדה. מחזיר null לשדות שאין טעם להציג. */
export function describeField(key: string, type: z.ZodTypeAny): FieldNode | null {
  const { inner, optional, description } = unwrap(type);
  const def = inner._def as {
    typeName?: string;
    shape?: () => Record<string, z.ZodTypeAny>;
    values?: string[];
    options?: z.ZodTypeAny[];
  };
  const label = labelFor(key);
  // איחוד מספרי מטופל לפני ה-switch כי הוא נבדק לפי התוכן, לא לפי השם.
  const numeric = numericUnion(def);
  if (numeric !== null) return { kind: 'number', key, label, optional: true, empty: numeric.empty };
  // רשימת בחירה מוצהרת — שדה מחרוזת שהסכימה מציעה לו ערכים מוכרים.
  const choice = parseChoice(description);
  if (choice !== null) return { kind: 'enum', key, label, optional, options: choice };
  switch (def.typeName) {
    case 'ZodObject': {
      const children = describeObject(inner);
      return children.length > 0 ? { kind: 'object', key, label, children } : null;
    }
    case 'ZodString':
      return { kind: 'string', key, label, optional };
    case 'ZodNumber':
      return { kind: 'number', key, label, optional, empty: optional ? null : 0 };
    case 'ZodBoolean':
      return { kind: 'boolean', key, label, optional };
    case 'ZodEnum':
      return {
        kind: 'enum',
        key,
        label,
        optional,
        options: (def.values ?? []).map((v) => ({ value: v, label: v })),
      };
    default:
      // מערכים, union-ים מורכבים וכל טיפוס עתידי — עריכה כ-JSON גולמי, כדי
      // שהשדה יהיה נגיש גם בלי עורך ייעודי.
      return { kind: 'json', key, label, optional };
  }
}

/** קריאת ערך לפי נתיב (['setting','sound','timerMediaSound','src']). */
export function getAt(value: unknown, path: string[]): unknown {
  let cur = value;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * החזרת עותק עם ערך מוחלף בנתיב. אימוטבילי — לא נוגע במקור, כך ש-React מזהה
 * את השינוי ומצב "יש שינויים שלא נשמרו" נשאר אמין.
 */
export function setAt<T>(value: T, path: string[], next: unknown): T {
  if (path.length === 0) return next as T;
  const [head, ...rest] = path;
  // מערך חייב להישאר מערך: נתיב כמו ['questions','0','setting'] עובר דרכו,
  // ו-{...array} היה הופך את questions לאובייקט {0:…,1:…} ושובר את קובץ המשחק.
  const base: Record<string, unknown> = Array.isArray(value)
    ? ([...value] as unknown as Record<string, unknown>)
    : value !== null && typeof value === 'object'
      ? { ...(value as Record<string, unknown>) }
      : {};
  base[head!] = setAt(base[head!], rest, next);
  return base as T;
}
