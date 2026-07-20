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
// שקופית (SPEC 3.2 + 3.3)
// ---------------------------------------------------------------------------

export const answerSchema = z.object({
  ans: z.string(),
  correct: z.boolean(),
  id: z.number(),
});

export const slideSettingsSchema = z.object({
  allowChangeVote: z.boolean(),
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
  slidBackgroundMedia: mediaRef,
  automaticSkip: z.object({
    active: z.boolean(),
    seconds: emptyableNumber(0),
  }),
  showInLoop: z.boolean(),
});

export const slideTypeSchema = z.enum(['trivia', 'survey', 'ans_images', 'media', 'subject', 'function']);

const VOTABLE_TYPES = new Set(['trivia', 'survey', 'ans_images']);

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
const functionConfigSchema = z.object({
  action: z.string().default('api'),
  api: z
    .object({
      url: z.string().default(''),
      method: z.string().default('GET'),
    })
    .optional(),
  screen: z
    .object({
      type: z.string().default('winners'),
    })
    .optional(),
  score: z
    .object({
      operation: z.string().default('reset_all'),
    })
    .optional(),
  players: z
    .object({
      mode: z.string().default('remove'),
      unit: z.string().default('percent'),
      // amount נדרש רק ל-random/top/bottom; בבחירת "groups" הוא לא נשלח.
      amount: emptyableNumber(0).optional(),
      selection: z.string().default('random'),
      groups: z.array(z.string()).optional().default([]),
    })
    .optional(),
});

export const slideSchema = z
  .object({
    id: z.number(),
    type: slideTypeSchema,
    question: z.object({
      que: z.string(),
      scoreForQue: emptyableNumber(0),
      timeForQue: emptyableNumber(15),
      answers: z.array(answerSchema),
      src: z.string(),
    }),
    openMedia: mediaRef,
    endMedia: mediaRef,
    backgroundMedia: mediaRef,
    setting: slideSettingsSchema,
    // רק בשקופית "פונקציה"; אופציונלי כדי לא לפגוע בשאר סוגי השקופיות.
    function: functionConfigSchema.optional(),
  })
  .superRefine((slide, ctx) => {
    if (VOTABLE_TYPES.has(slide.type)) {
      if (slide.question.answers.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['question', 'answers'],
          message: `שקופית מסוג ${slide.type} חייבת לפחות 2 תשובות`,
        });
      }
      if (slide.type === 'trivia' && !slide.question.answers.some((a) => a.correct)) {
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
    if (slide.question.answers.every((a, i) => a.id === i + 1)) return slide;
    return {
      ...slide,
      question: {
        ...slide.question,
        answers: slide.question.answers.map((a, i) => ({ ...a, id: i + 1 })),
      },
    };
  });

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
export type SlideSettings = z.infer<typeof slideSettingsSchema>;
export type SlideType = z.infer<typeof slideTypeSchema>;
export type Slide = z.infer<typeof slideSchema>;
export type GlobalSettings = z.infer<typeof globalSettingsSchema>;
export type AssetEntry = z.infer<typeof assetEntrySchema>;
export type GameFile = z.infer<typeof gameFileSchema>;

export function isVotableSlide(slide: Slide): boolean {
  return VOTABLE_TYPES.has(slide.type);
}
