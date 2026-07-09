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

export const slideTypeSchema = z.enum(['trivia', 'survey', 'ans_images', 'media', 'subject']);

const VOTABLE_TYPES = new Set(['trivia', 'survey', 'ans_images']);

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
  });

// ---------------------------------------------------------------------------
// הגדרות גלובליות (SPEC 3.4)
// ---------------------------------------------------------------------------

export const globalSettingsSchema = z.object({
  titleThroughoutGame: z.string(),
  ansIsNumber: z.boolean(),
  multiWinners: z.number(),
  showWinnersListAfter: z.number().nullable(),
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
  limit: z.object({ type: z.string() }),
});

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
  room: z.string().nullable().optional().default(null),
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
