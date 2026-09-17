/**
 * סכמות Zod לקובץ המשחק + נרמול (SPEC סעיף 3).
 *
 * עקרונות:
 * - שדות מספריים ריקים מגיעים כ-"" ומנורמלים לברירות מחדל בתוך transform
 *   (time=15, score=0, seconds=0) — קובץ תקין לעולם לא נופל על זה.
 * - מספר תשובות משתנה (3/4/5) — אין הנחת 4.
 * - צבעים: HEX של 6 או 8 ספרות (עם אלפא).
 * - assets[].type לא אמין (YouTube רשום כ-"image") — הזיהוי האמיתי נעשה
 *   לפי URL ב-classify.ts, והסכמה לא מגבילה את הערך.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// עזרי נרמול
// ---------------------------------------------------------------------------

/** מספר שיכול להגיע כמחרוזת ריקה — מנורמל לברירת מחדל. */
const emptyableNumber = (defaultValue: number) =>
  z
    .union([z.number(), z.literal('')], {
      errorMap: () => ({ message: 'חייב להיות מספר או מחרוזת ריקה ("")' }),
    })
    .transform((v) => (v === '' ? defaultValue : v));

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/, 'חייב להיות צבע HEX של 6 או 8 ספרות (עם אלפא)');

const mediaRef = z.object({ src: z.string() });
const soundRef = z.object({ src: z.string().nullable() });

// ---------------------------------------------------------------------------
// קריינות אוטומטית (ENGINE-narration.md) — שכבה אופציונלית לחלוטין
// ---------------------------------------------------------------------------

/**
 * הגדרות הקריין ברמת המשחק. **קובץ בלי `narration` נטען ומתנהג בדיוק כמו
 * היום** — כל השדות אופציונליים עם ברירת מחדל, ו-`bank` הוא מילון
 * `bank_key → url` של הביטויים הקבועים של הקול שנבחר (מפתח חסר = המנוע מדלג
 * על הביטוי בשקט).
 */
export const narrationSettingSchema = z
  .object({
    enabled: z.boolean().optional().default(true),
    voice: z.string().optional().default(''),
    announceQuestionNumber: z.boolean().optional().default(true),
    /** האם להנמיך את סאונד המשחק בזמן שהקריין מדבר (ברירת מחדל: לא נוגעים בו). */
    duck: z.boolean().optional().default(false),
    bankVersion: z.number().optional().default(1),
    bank: z.record(z.string()).optional().default({}),
    /**
     * קטעי שמות הקבוצות של המשחק הזה (`שם הקבוצה בדיוק כמו במרשם → כתובת`).
     * שמות קבוצות אינם בבנק כי הם משתנים ממשחק למשחק; שם חסר = הקריין אומר
     * את הביטוי הכללי בלי השם.
     */
    groups: z.record(z.string()).optional().default({}),
  })
  .passthrough();

/** קטעי הקריינות של שקופית: השאלה, קטע לכל תשובה (באותו סדר), והתשובה הנכונה. */
export const slideNarrationSchema = z
  .object({
    question: z.string().nullable().optional().default(null),
    answers: z.array(z.string().nullable()).optional().default([]),
    correct: z.string().nullable().optional().default(null),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// שקופית (SPEC 3.2 + 3.3)
// ---------------------------------------------------------------------------

export const answerSchema = z.object({
  ans: z.string(),
  correct: z.boolean(),
  id: z.number(),
});

export const slideSettingsSchema = z.object({
  // שינוי הצבעה בזמן הטיימר (ההצבעה האחרונה קובעת) — פעיל רק כשמסומן במפורש
  // ב-JSON. חסר/false = כמו קודם, ההצבעה הראשונה ננעלת ואי אפשר לשנות. אופציונלי
  // עם ברירת מחדל false כדי שקבצים בלי השדה ייטענו כרגיל (בלי אפשרות שינוי).
  allowChangeVote: z.boolean().optional().default(false),
  /**
   * מונה הצבעות חי: בזמן ההצבעה מוצג ליד כל תשובה כמה בחרו בה (ואחוז), כדי
   * שהקהל יראה איפה הרוב ואם יש "אפקט עדר". חסר/false = כמו קודם — המספרים
   * נחשפים רק אחרי סגירת ההצבעה.
   */
  liveVoteCounts: z.boolean().optional().default(false),
  /**
   * "הרוב קובע": אין תשובה נכונה מראש — בסגירת ההצבעה התשובה (או התשובות,
   * בתיקו) שקיבלה הכי הרבה קולות נעשית הנכונה, ומי שבחר בה מקבל את הניקוד.
   * דגלי `correct` שהגיעו בקובץ מתאפסים בטעינה. ראו majority.ts.
   */
  majorityDecides: z.boolean().optional().default(false),
  slideStartVoting: z.boolean(),
  playAfterClicking: z.boolean(),
  exitGame: z.boolean(),
  correctlyAnsweredBefore: z.boolean(),
  firstClicker: z.boolean(),
  answerIsSequenceClicks: z.boolean(),
  fullscreen: z.boolean(),
  scoringReduction: z.object({
    active: z.boolean(),
    seconds: emptyableNumber(0),
    score: emptyableNumber(0),
  }),
  /**
   * ניקוד יורד: הניקוד צולל ברציפות מ-`maxScore` לאפס לאורך `timeForQue`, ומי
   * שעונה נכון מקבל את הערך שהיה על המסך ברגע הלחיצה (ראו scoring.ts). כשדולק
   * הוא מחליף את `scoreForQue` ואת `scoringReduction`. אופציונלי עם ברירת מחדל
   * כבויה — קבצים שנוצרו לפני השדה נטענים כרגיל; ‎""‎ ב-`maxScore` הוא כלל
   * הריקון של מערכת יצירת המשחקים ומנורמל ל-1000, כמו ברירת המחדל בעורך שלה.
   */
  descendingScore: z
    .object({
      active: z.boolean().optional().default(false),
      maxScore: emptyableNumber(1000).optional().default(1000),
    })
    .optional()
    .default({ active: false, maxScore: 1000 }),
  /**
   * חשיפה הדרגתית של תמונת השאלה: מטושטשת ב-`blur` פיקסלים לפני ההצבעה,
   * מתבהרת ברציפות לאורך `timeForQue` וחדה כשההצבעה נסגרת (ראו imageReveal.ts).
   * אופציונלי עם ברירת מחדל כבויה; ‎""‎ ב-`blur` (כלל הריקון) מנורמל ל-48.
   */
  imageReveal: z
    .object({
      active: z.boolean().optional().default(false),
      blur: emptyableNumber(48).optional().default(48),
    })
    .optional()
    .default({ active: false, blur: 48 }),
  slidBackgroundMedia: mediaRef,
  automaticSkip: z.object({
    active: z.boolean(),
    seconds: emptyableNumber(0),
  }),
  showInLoop: z.boolean(),
  /**
   * הגבלת שקופית לקבוצה אחת: רק משתתפים ששייכים ל-groupName יכולים להצביע
   * בשקופית הזו; הקשות של השאר נזרקות (הניקוד שלהם נשאר כפי שהוא — הם פשוט
   * לא משתתפים בשאלה). `groupName` הוא שם הקבוצה בדיוק כפי שהוא מופיע בשדה
   * `users` של קובץ המשחק. אופציונלי עם ברירת מחדל כבויה, כדי שקבצים בלי
   * השדה (וגרסאות מנוע ישנות) ימשיכו לעבוד ללא שינוי.
   */
  groupRestriction: z
    .object({
      active: z.boolean().optional().default(false),
      groupName: z.string().optional().default(''),
    })
    .optional()
    .default({ active: false, groupName: '' }),
})
  /**
   * כמו ב-question ובשקופית: שדות שאיננו מכירים נשמרים. מערכת יצירת המשחקים
   * שולחת כאן למשל `typingAnswer` לשקופיות "הקלדה" — שדה שהמנוע אינו משתמש
   * בו, אבל מחיקתו בשמירה מהעורך המקומי הייתה משנה את הקובץ של הלקוח.
   */
  .passthrough();

/**
 * שמות-סוג חלופיים שמערכת יצירת המשחקים מייצרת, ממופים לסוגים של המנוע —
 * כדי לקבל קבצים "כמו שהם" בלי לדרוש שינוי במערכת החיצונית. הבולט: `multiselect`
 * (שאלת רב-ברירה עם תשובה נכונה) = `trivia` אצלנו.
 */
const SLIDE_TYPE_ALIASES: Record<string, string> = {
  multiselect: 'trivia',
  multi_select: 'trivia',
  multiple: 'trivia',
  multichoice: 'trivia',
  quiz: 'trivia',
  poll: 'survey',
  images: 'ans_images',
  ans_image: 'ans_images',
  image_answers: 'ans_images',
  text: 'subject',
};

export const slideTypeSchema = z.preprocess(
  (v) => (typeof v === 'string' && SLIDE_TYPE_ALIASES[v] !== undefined ? SLIDE_TYPE_ALIASES[v] : v),
  z.enum(['trivia', 'survey', 'ans_images', 'media', 'subject', 'function', 'bet']),
);

/** שקופיות שמקבלות הצבעות. ההימור מצביע כמו סקר (בלי תשובה נכונה) — ראו bet.ts. */
const VOTABLE_TYPES = new Set(['trivia', 'survey', 'ans_images', 'bet']);

/**
 * שקופית "פונקציה" (type: "function") — כשמגיעים אליה היא מבצעת פעולת מערכת:
 *   • action "api"    — שולחת את כל נתוני המשחק ל-webhook (function.api).
 *   • action "screen" — מציגה במקום השקופית מסך מנצחים/מובילים
 *                        (function.screen.type: "winners" | "leaderboard").
 *   • action "score"  — פעולת ניקוד (function.score.operation: "reset_all"
 *                        לאיפוס ניקוד כל המשתתפים; פתוח להרחבה).
 *   • action "players"— הסרת/השארת משתתפים (function.players: mode/unit/
 *                        amount/selection) כך שלא ישתתפו יותר.
 * הקונפיג נשמר ברמת השקופית תחת `function` (לא בתוך setting). כל השדות
 * סלחניים כדי לתמוך בקבצים שנוצרו לפני שהוגדרו כל האפשרויות.
 */
/**
 * שדה מחרוזת עם ערכים מוכרים. הוולידציה נשארת `z.string()` **בכוונה**: קובץ
 * משחק קיים שנשמר עם ערך אחר ימשיך להיטען (המנוע ממילא נופל לברירת מחדל),
 * ורק העורך מציג בורר במקום שדה טקסט חופשי. הרשימה נשמרת ב-`describe` ולכן
 * נגזרת מהסכימה כמו כל השאר — ראו parseChoice ב-schemaForm.ts.
 */
function choice(options: Record<string, string>, fallback: string) {
  return z.string().describe(`choice:${JSON.stringify(options)}`).default(fallback);
}

export const functionConfigSchema = z.object({
  action: choice(
    {
      api: 'שליחת נתוני המשחק ל-API',
      screen: 'הצגת מסך (מנצחים / מובילים)',
      score: 'פעולה על הניקוד',
      players: 'הסרת משתתפים מהמשחק',
    },
    'api',
  ),
  api: z
    .object({
      url: z.string().default(''),
      method: choice({ GET: 'GET', POST: 'POST' }, 'GET'),
    })
    .optional(),
  screen: z
    .object({
      type: choice({ winners: 'מסך מנצחים', leaderboard: 'טבלת מובילים' }, 'winners'),
    })
    .optional(),
  score: z
    .object({
      operation: choice({ reset_all: 'איפוס הניקוד של כל המשתתפים' }, 'reset_all'),
    })
    .optional(),
  players: z
    .object({
      mode: choice({ remove: 'להסיר את הנבחרים', keep: 'להשאיר רק את הנבחרים' }, 'remove'),
      unit: choice({ percent: 'אחוזים', count: 'מספר משתתפים' }, 'percent'),
      // amount נדרש רק ל-random/top/bottom; בבחירת "groups" הוא לא נשלח.
      amount: emptyableNumber(0).optional(),
      selection: choice(
        {
          random: 'אקראי',
          top: 'בעלי הניקוד הגבוה',
          bottom: 'בעלי הניקוד הנמוך',
          groups: 'לפי שיוך לקבוצות',
        },
        'random',
      ),
      groups: z.array(z.string()).optional().default([]),
    })
    .optional(),
});

/**
 * שקופית "הימור" (type: "bet") — שקופית הצבעה שבה הכרטיסים הם אפשרויות
 * הימור על השאלה המנוקדת הבאה. `question.answers` הם הכיתובים על הכרטיסים
 * (וכפתורי ההצבעה 1..N, כמו בסקר), ו-`bet.options` — באותו סדר — המשמעות של
 * כל כרטיס: `none` (בלי הימור) · `percent` (value = אחוז מהניקוד) · `fixed`
 * (value = נקודות) · `all` (כל הניקוד). `payout` הוא מכפיל הזכייה (1 = כפול
 * או כלום), ניתן לדריסה לכל אפשרות; `allowNegative` מאפשר לרדת מתחת לאפס.
 * הכללים המלאים ב-bet.ts ו-SPEC §5.3. סלחני כמו function: קונפיג חסר או קצר
 * מושלם ב"בלי הימור", כדי שקובץ לא ייפסל בגלל השדה הזה.
 */
export const betOptionSchema = z
  .object({
    kind: choice(
      { none: 'בלי הימור', percent: 'אחוז מהניקוד', fixed: 'סכום קבוע', all: 'כל הניקוד' },
      'none',
    ),
    value: emptyableNumber(0).optional(),
    payout: emptyableNumber(1).optional(),
  })
  .passthrough();

export const betConfigSchema = z
  .object({
    options: z.array(betOptionSchema).optional().default([]),
    payout: emptyableNumber(1).optional().default(1),
    allowNegative: z.boolean().optional().default(false),
  })
  .passthrough();

type BetConfigParsed = z.infer<typeof betConfigSchema>;

/** משלים/מקצר את רשימת האפשרויות למספר הכרטיסים — אפשרות חסרה = "בלי הימור". */
function normalizeBetConfig(config: BetConfigParsed | undefined, answerCount: number): BetConfigParsed {
  const base = config ?? { options: [], payout: 1, allowNegative: false };
  const options = base.options.slice(0, answerCount);
  while (options.length < answerCount) options.push({ kind: 'none' });
  return { ...base, options };
}

/**
 * ניקוד ברירת המחדל לשקופית מנוקדת שהגיעה בלי ערך ניקוד.
 *
 * מערכת יצירת המשחקים מציגה למחבר 7 כשלא נבחר ניקוד, ולכן 7 הוא הערך הנכון.
 * (בעבר המסלול המקוון נפל ל-7 והמסלול האופליין ל-3, ואותה שקופית הייתה שווה
 * ניקוד שונה לפי הדרך שבה הרצת את המשחק. תוקן אצלם ל-7 בשני המסלולים.)
 *
 * חל **רק על שקופיות מנוקדות**: בטקסט/מדיה/פונקציה ‎""‎ הוא כלל הריקון הרגיל
 * ומשמעותו "אין ניקוד", ושם הוא נשאר 0.
 */
const DEFAULT_SCORE_FOR_VOTABLE = 7;

export const slideSchema = z
  .preprocess((raw) => {
    // רשת ביטחון בלבד: בקבצים אמיתיים שקופית מנוקדת תמיד נושאת מספר. אם בכל
    // זאת יגיע ‎""‎, עדיף להסכים עם המסלול המקוון מאשר לשתוק ולנקד באפס.
    if (typeof raw !== 'object' || raw === null) return raw;
    const slide = raw as Record<string, unknown>;
    const question = slide['question'];
    if (typeof question !== 'object' || question === null) return raw;
    if ((question as Record<string, unknown>)['scoreForQue'] !== '') return raw;
    const type = slideTypeSchema.safeParse(slide['type']);
    if (!type.success || !VOTABLE_TYPES.has(type.data)) return raw;
    // הימור מצביע אבל אינו מנוקד — "" הוא כלל הריקון הרגיל, לא ניקוד חסר.
    if (type.data === 'bet') return raw;
    return {
      ...slide,
      question: { ...question, scoreForQue: DEFAULT_SCORE_FOR_VOTABLE },
    };
  }, z
  .object({
    id: z.number(),
    type: slideTypeSchema,
    question: z.object({
      que: z.string(),
      /**
       * האם נוסח השאלה הוא טקסט או **תמונה**. במצב 'image' מערכת יצירת המשחקים
       * שולחת ‎que: ""‎ ואת התמונה ב-`src`, והיא מוצגת במקום נוסח השאלה —
       * התשובות, הזמן והניקוד נשארים כרגיל. חסר = 'text', כמו כל הקבצים שנוצרו
       * עד עכשיו. סלחני בכוונה (z.string ולא enum): ערך לא מוכר נופל ל'טקסט'
       * בזמן ההצגה במקום לפסול את הקובץ כולו.
       */
      queMode: choice({ text: 'טקסט', image: 'תמונה' }, 'text'),
      scoreForQue: emptyableNumber(0),
      timeForQue: emptyableNumber(15),
      answers: z.array(answerSchema),
      src: z.string(),
    })
      /**
       * שדות שאיננו מכירים נשמרים ולא נמחקים. Zod מסנן כברירת מחדל מפתחות
       * לא ידועים, והעורך המקומי שומר את האובייקט ה*מפוענח* — כלומר כל שדה
       * שמערכת יצירת המשחקים תוסיף היה נמחק מהקובץ לצמיתות ברגע שמישהו יערוך
       * אותו כאן. עדיף לשמור נתון שאיננו מציגים מאשר להשמיד אותו.
       */
      .passthrough(),
    openMedia: mediaRef,
    endMedia: mediaRef,
    backgroundMedia: mediaRef,
    setting: slideSettingsSchema,
    // רק בשקופית "פונקציה"; אופציונלי כדי לא לפגוע בשאר סוגי השקופיות.
    function: functionConfigSchema.optional(),
    // רק בשקופית "הימור"; מנורמל בהמשך למספר הכרטיסים.
    bet: betConfigSchema.optional(),
    /**
     * קטעי הקריינות של השקופית (אופציונלי לגמרי). `catch` מוודא שאובייקט
     * פגום *לא* מפיל את השקופית ואת המשחק כולו — הוא פשוט נזרק, והשקופית
     * מתנהגת כאילו אין לה קריינות.
     */
    narration: slideNarrationSchema.optional().catch(undefined),
  })
  // כמו ב-question: לא מוחקים שדות שאיננו מכירים.
  .passthrough()
  .superRefine((slide, ctx) => {
    if (VOTABLE_TYPES.has(slide.type)) {
      if (slide.question.answers.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['question', 'answers'],
          message: `שקופית מסוג ${slide.type} חייבת לפחות 2 תשובות`,
        });
      }
      if (
        slide.type === 'trivia' &&
        !slide.setting.majorityDecides &&
        !slide.question.answers.some((a) => a.correct)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['question', 'answers'],
          message: 'שקופית trivia חייבת לפחות תשובה נכונה אחת (correct: true)',
        });
      }
    }
  })
  .transform((slide) => {
    // חוזה המערכת: ההצבעה מהטלפון/קליקר היא *מספר הכפתור*, כלומר מיקום התשובה
    // על המסך (1..N). כל השרשרת (ספירה, ניקוד, תצוגה) מצליבה לפי answer.id —
    // לכן מנרמלים כאן את ה-id למיקום התצוגה. בקבצים תקינים (id == מיקום) זה
    // no-op; קובץ עם מזהים לא-רציפים/מעורבבים מיושר, ודגלי correct נשארים
    // צמודים לתשובה שלהם.
    if (!VOTABLE_TYPES.has(slide.type)) return slide;
    let next = slide;
    if (!next.question.answers.every((a, i) => a.id === i + 1)) {
      next = {
        ...next,
        question: {
          ...next.question,
          answers: next.question.answers.map((a, i) => ({ ...a, id: i + 1 })),
        },
      };
    }
    // הימור: אפשרות לכל כרטיס, תמיד — כך התצוגה והניקוד לא בודקים גבולות.
    if (next.type === 'bet') {
      next = { ...next, bet: normalizeBetConfig(next.bet, next.question.answers.length) };
    }
    // "הרוב קובע": הנכונה נקבעת בזמן אמת — סימון שהגיע בקובץ אינו תקף.
    if (next.setting.majorityDecides && next.question.answers.some((a) => a.correct)) {
      next = {
        ...next,
        question: {
          ...next.question,
          answers: next.question.answers.map((a) => ({ ...a, correct: false })),
        },
      };
    }
    return next;
  }));

// ---------------------------------------------------------------------------
// הגדרות גלובליות (SPEC 3.4)
// ---------------------------------------------------------------------------

/**
 * מעברים אוטומטיים — ברירת מחדל למשחק (מגיע מה-JSON, ניתן לדריסה בהגדרות).
 * כל השדות אופציונליים עם ברירת מחדל, כדי שקבצים ישנים (בלי autoTransition)
 * ייטענו כרגיל.
 */
const autoTransitionSchema = z
  .object({
    showAnswersAfterQuestion: z.boolean().default(false),
    startTimerAfterLastAnswer: z.boolean().default(false),
    showCorrectAnswerAfterTimer: z.boolean().default(false),
    nextSlide: z
      .object({
        active: z.boolean().default(false),
        seconds: z.number().default(6),
      })
      .default({ active: false, seconds: 6 }),
    // מעבר אוטומטי של מדיה (חל על *כל* קבצי המדיה: openMedia לפני שאלה,
    // endMedia אחריה, ומסכי מדיה עצמאיים):
    //   image.active/seconds — תמונה עוברת אוטומטית אחרי X שניות.
    //   video.playToEnd — סרטון (אחסון רגיל + יוטיוב) מתנגן עד הסוף ואז עובר.
    // ברירת המחדל שומרת על ההתנהגות הקיימת (מעבר ידני) לקבצים בלי השדה.
    media: z
      .object({
        image: z
          .object({
            active: z.boolean().default(false),
            seconds: z.number().default(5),
          })
          .default({ active: false, seconds: 5 }),
        video: z
          .object({
            playToEnd: z.boolean().default(false),
          })
          .default({ playToEnd: false }),
      })
      .default({ image: { active: false, seconds: 5 }, video: { playToEnd: false } }),
  })
  .default({
    showAnswersAfterQuestion: false,
    startTimerAfterLastAnswer: false,
    showCorrectAnswerAfterTimer: false,
    nextSlide: { active: false, seconds: 6 },
    media: { image: { active: false, seconds: 5 }, video: { playToEnd: false } },
  });

export const globalSettingsSchema = z.object({
  titleThroughoutGame: z.string(),
  ansIsNumber: z.boolean(),
  /**
   * איך מוצג שם המצביע שמתעופף בצד המסך עם כל הצבעה: 'plain' — טקסט לבן עם צל
   * על הרקע (כפי שהיה תמיד); 'bubble' — בתוך בועת דיבור שמצביעה על האווטר.
   * חסר/לא מוכר = 'plain', כך שקבצים ישנים נראים בדיוק כמו קודם.
   */
  voterNameStyle: z
    .string()
    .optional()
    .default('plain')
    .transform((v) => (v === 'bubble' ? 'bubble' : 'plain'))
    .describe(
      `choice:${JSON.stringify({
        plain: 'טקסט על הרקע',
        bubble: 'בתוך בועת דיבור',
      })}`,
    ),
  // שינוי הצבעה בזמן הטיימר לכל המשחק (ההצבעה האחרונה קובעת) — הגדרה גלובלית
  // שחלה על *כל* השקופיות. חסר/false = כבוי גלובלית, וכל שקופית נקבעת לפי
  // slide.setting.allowChangeVote שלה (התנהגות קודמת). true = כל המשחק מאפשר.
  allowChangeVote: z.boolean().optional().default(false),
  // כמה זוכים מוצגים במסך המנצחים הסופי (בסוף המשחק).
  multiWinners: z.number(),
  // פעם בכמה שאלות להציג אוטומטית את טבלת המובילים באמצע המשחק.
  // null / '' / חסר = מכובה; מספר = כל N שאלות.
  showWinnersListAfter: z
    .union([z.number(), z.literal(''), z.null()])
    .optional()
    .transform((v) => (typeof v === 'number' ? v : null)),
  // כמה מובילים מוצגים בטבלת המובילים בכל הצגה (נפרד מ-multiWinners). ברירת
  // מחדל 5, כדי שקבצים ישנים בלי השדה ימשיכו לעבוד.
  winnersListCount: emptyableNumber(5).optional().default(5),
  mainColor: hexColor,
  secondaryColor: hexColor,
  gameMedia: mediaRef,
  logo: mediaRef,
  triviaMedia: mediaRef,
  winnersListMedia: mediaRef,
  winnersMedia: mediaRef,
  sound: z.object({
    playersConnectingMediaSound: soundRef,
    showQuestionMediaSound: soundRef,
    winnersMediaSound: soundRef,
    winnersListMediaSound: soundRef,
    genericMediaSound: soundRef,
    timerMediaSound: soundRef,
    inShowAnsMediaSound: soundRef,
  }),
  // סוג המשחק (clickers / phones) ומגבלת המשתתפים לפי הרישיון (number).
  // number ריק כ-"" מנורמל, ואם חסר — אין הגבלה (Infinity בפועל).
  limit: z.object({
    type: z.string(),
    number: emptyableNumber(Number.MAX_SAFE_INTEGER).optional(),
  }),
  // מעברים אוטומטיים — ברירת מחדל למשחק (ניתן לדריסה בהגדרות ולשמירה ב-localStorage)
  autoTransition: autoTransitionSchema,
  /**
   * קריינות אוטומטית — קיימת רק כשמערכת יצירת המשחקים שולחת אותה. `catch`
   * שומר על הכלל החשוב: אובייקט קריינות פגום נזרק בשקט ואינו פוסל את המשחק.
   */
  narration: narrationSettingSchema.optional().catch(undefined),
  /**
   * סוג המשחק. חסר/לא מוכר = 'classic' — המשחק הרגיל, בדיוק כפי שהיה. סוגים
   * נוספים מוסיפים שכבת חוויה מעל אותו מנוע שאלות (ראו gameTypeSettings).
   */
  gameType: z
    .string()
    .optional()
    .default('classic')
    .transform((v) => (v === 'snakes_ladders_team' ? v : 'classic'))
    // המטא-דאטה נשמרת גם אחרי ה-transform, כדי שהעורך יציג בורר בעברית ולא
    // תיבת טקסט עם הערך האנגלי הגולמי (ראו parseChoice ב-schemaForm.ts).
    .describe(
      `choice:${JSON.stringify({
        classic: 'משחק קלאסי',
        snakes_ladders_team: 'סולמות וחבלים קבוצתי',
      })}`,
    ),
  /** הגדרות ייעודיות לסוג המשחק. כולן אופציונליות עם ברירות מחדל שמישות. */
  gameTypeSettings: z
    .object({
      snakesLadders: z
        .object({
          /**
           * איך נקבעת ההתקדמות בלוח:
           *   'dice'    — הקבוצה עם אחוז ההצלחה הגבוה ביותר "מטילה קובייה".
           *   'percent' — כל קבוצה מתקדמת לפי אחוז ההצלחה שלה.
           */
          progression: z
            .string()
            .optional()
            .default('percent')
            .transform((v) => (v === 'dice' ? 'dice' : 'percent'))
            .describe(
              `choice:${JSON.stringify({
                percent: 'לפי אחוז ההצלחה של כל קבוצה',
                dice: 'הטלת קובייה לקבוצה המובילה',
              })}`,
            ),
        })
        .optional()
        .default({ progression: 'percent' }),
    })
    .optional()
    .default({ snakesLadders: { progression: 'percent' } }),
});

export type AutoTransition = z.infer<typeof autoTransitionSchema>;

// ---------------------------------------------------------------------------
// Manifest נכסים — type לא אמין, נשמר כמו שהוא לתיעוד בלבד
// ---------------------------------------------------------------------------

export const assetEntrySchema = z.object({
  src: z.string(),
  progress: z.number(),
  name: z.string(),
  type: z.string(),
});

// ---------------------------------------------------------------------------
// המבנה העליון (SPEC 3.1)
// ---------------------------------------------------------------------------

// קובץ משחק אונליין מכיל את כל השדות; קובץ אופליין (data.json ב-ZIP) דק
// יותר. לכן השדות שאינם מהותיים למנוע הם אופציונליים עם ברירת מחדל.
export const gameFileSchema = z.object({
  name: z.string(),
  id: z.string().optional().default(''),
  questions: z.array(slideSchema).min(1, 'קובץ משחק חייב לפחות שקופית אחת'),
  setting: globalSettingsSchema,
  assets: z.array(assetEntrySchema).optional().default([]),
  createdAt: z.string().optional().default(''),
  cloudinaryFolder: z.string().optional().default(''),
  credit: z.string().nullable().optional().default(null),
  users: z.string().optional().default('{}'),
  // room (קוד החדר / קוד המשחק) יכול להגיע כמספר (למשל 2047) או כמחרוזת —
  // מנרמלים למחרוזת (או null) לשימוש כ-GAME_ID מול שרת ההצבעות.
  room: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => (value === null || value === undefined ? null : String(value))),
  baseUrl: z.string().optional().default(''),
  cloudinaryAbsolutePathImage: z.string().optional().default(''),
  cloudinaryAbsolutePathVideo: z.string().optional().default(''),
});

// ---------------------------------------------------------------------------
// טיפוסים מנורמלים (אחרי transform — כל השדות המספריים הם number)
// ---------------------------------------------------------------------------

export type Answer = z.infer<typeof answerSchema>;
export type NarrationSetting = z.infer<typeof narrationSettingSchema>;
export type SlideNarration = z.infer<typeof slideNarrationSchema>;
export type SlideSettings = z.infer<typeof slideSettingsSchema>;
export type SlideType = z.infer<typeof slideTypeSchema>;
export type Slide = z.infer<typeof slideSchema>;
export type GlobalSettings = z.infer<typeof globalSettingsSchema>;
export type AssetEntry = z.infer<typeof assetEntrySchema>;
export type GameFile = z.infer<typeof gameFileSchema>;

export function isVotableSlide(slide: Slide): boolean {
  return VOTABLE_TYPES.has(slide.type);
}

/** האם לשקופית יש ולו קטע קריינות אחד (שאלה / תשובה / תשובה נכונה). */
export function slideHasNarrationClips(slide: Slide): boolean {
  const n = slide.narration;
  if (!n) return false;
  return (
    (n.question !== null && n.question !== '') ||
    (n.correct !== null && n.correct !== '') ||
    n.answers.some((a) => a !== null && a !== '')
  );
}

/**
 * האם המשחק מגיע עם קריינות פעילה: אובייקט `setting.narration` קיים, דלוק, ויש
 * לו ולו קטע אחד לנגן (ביטוי מהבנק או קטע של שקופית). כל תשובה אחרת = המנוע
 * מתנהג בדיוק כמו קובץ בלי קריינות.
 */
export function hasNarration(game: GameFile): boolean {
  const narration = game.setting.narration;
  if (!narration || !narration.enabled) return false;
  if (Object.keys(narration.bank).length > 0) return true;
  return game.questions.some(slideHasNarrationClips);
}
