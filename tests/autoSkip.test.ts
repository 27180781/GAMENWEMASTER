/**
 * "מעבר אוטומטי" (setting.automaticSkip) — ההגדרה המתקדמת האחרונה שלא הייתה
 * לה בדיקת התנהגות. עד כה נבדק רק שהשדה *נטען* נכון; כאן נבדק שהוא **פועל**.
 */

import { describe, expect, it } from 'vitest';
import { autoSkipDelayMs, type AutoSkipScreen } from '../src/app/autoSkip.ts';
import type { Slide } from '../src/engine/index.ts';
import { makeGame, rawSlide } from './helpers.ts';

const ANSWERS = [
  { ans: 'א', correct: true, id: 1 },
  { ans: 'ב', correct: false, id: 2 },
];

function slideOf(type: 'trivia' | 'subject', settings: Record<string, unknown>): Slide {
  const game = makeGame([
    rawSlide({
      id: 1,
      type,
      que: 'שאלה',
      answers: type === 'trivia' ? ANSWERS : [],
      settings,
    }),
  ]);
  return game.questions[0]!;
}

const on = (seconds: number | '') => ({ automaticSkip: { active: true, seconds } });
const off = { automaticSkip: { active: false, seconds: '' as const } };

/** מסך פנוי: התשובה כבר נחשפה, אין מדיה, אין שכבה, הקריין שקט. */
const free: AutoSkipScreen = {
  mediaPlaying: false,
  answerRevealed: true,
  covered: false,
  narratorWaitMs: 0,
};
const screen = (patch: Partial<AutoSkipScreen>): AutoSkipScreen => ({ ...free, ...patch });

describe('מעבר אוטומטי — האם ההגדרה פועלת', () => {
  it('★ דלוק בשקופית טריוויה אחרי החשיפה — מדלג אחרי מספר השניות שנקבע', () => {
    expect(autoSkipDelayMs(slideOf('trivia', on(12)), 'results', free)).toBe(12_000);
  });

  it('★ כבוי — לא מדלג לעולם', () => {
    for (const phase of ['showing', 'voting', 'results'] as const) {
      expect(autoSkipDelayMs(slideOf('trivia', off), phase, free), phase).toBeNull();
    }
  });

  it('★ בשקופית שאין בה הצבעה (טקסט/מדיה) — מדלג כבר בהצגה', () => {
    expect(autoSkipDelayMs(slideOf('subject', on(5)), 'showing', free)).toBe(5_000);
  });

  it('בטריוויה לא מדלגים בהצגת השאלה ולא בזמן ההצבעה — שם הטיימר אחראי', () => {
    expect(autoSkipDelayMs(slideOf('trivia', on(12)), 'showing', free)).toBeNull();
    expect(autoSkipDelayMs(slideOf('trivia', on(12)), 'voting', free)).toBeNull();
  });

  it('★ מדיה מתנגנת — לא קוטעים אותה באמצע', () => {
    expect(
      autoSkipDelayMs(slideOf('trivia', on(12)), 'results', screen({ mediaPlaying: true })),
    ).toBeNull();
  });

  it('שניות ריקות/אפס — עדיין מדלג, אבל לא באותו רגע', () => {
    // כלל הריקון הופך "" ל-0. דילוג מיידי היה עלול להריץ שרשרת שקופיות בבת אחת.
    expect(autoSkipDelayMs(slideOf('subject', on('')), 'showing', free)).toBe(1_000);
  });

  it('הטווח שהעורך מתיר (1–300 שניות) עובר כמו שהוא', () => {
    expect(autoSkipDelayMs(slideOf('subject', on(1)), 'showing', free)).toBe(1_000);
    expect(autoSkipDelayMs(slideOf('subject', on(300)), 'showing', free)).toBe(300_000);
  });
});

describe('מעבר אוטומטי — לא לפני שהחדר ראה, ולא מתחת לכיסוי', () => {
  it('★ ההצבעה נסגרה והתשובה עוד לא נחשפה — לא מדלגים (הספירה מתחילה מהחשיפה)', () => {
    // עד התיקון הספירה התחילה בסגירת ההצבעה: השקופית התחלפה בלי שהחדר ראה
    // את התשובה הנכונה, או קטעה את צליל החשיפה שבא רגע לפני.
    expect(
      autoSkipDelayMs(slideOf('trivia', on(5)), 'results', screen({ answerRevealed: false })),
    ).toBeNull();
    expect(autoSkipDelayMs(slideOf('trivia', on(5)), 'results', free)).toBe(5_000);
  });

  it('בשקופית בלי הצבעה אין חשיפה, והיא לא מעכבת את הדילוג', () => {
    expect(
      autoSkipDelayMs(slideOf('subject', on(5)), 'showing', screen({ answerRevealed: false })),
    ).toBe(5_000);
  });

  it('★ שכבה חוסמת פתוחה (טבלה, פירוט הצבעות, תפריט) — לא מדלגים מתחתיה', () => {
    expect(
      autoSkipDelayMs(slideOf('trivia', on(3)), 'results', screen({ covered: true })),
    ).toBeNull();
    expect(
      autoSkipDelayMs(slideOf('subject', on(3)), 'showing', screen({ covered: true })),
    ).toBeNull();
  });

  it('הקריין עסוק — ממתינים לסוף המשפט (לכל היותר עד התקרה שלו)', () => {
    expect(
      autoSkipDelayMs(slideOf('trivia', on(3)), 'results', screen({ narratorWaitMs: 9_500 })),
    ).toBe(9_500);
    // השהיה ארוכה ממה שהקריין עוד צריך נשארת כמו שהיא
    expect(
      autoSkipDelayMs(slideOf('subject', on(60)), 'showing', screen({ narratorWaitMs: 9_500 })),
    ).toBe(60_000);
  });
});

describe('מעבר אוטומטי — «מסך מנצחים» בשקופית פונקציה', () => {
  const winnersScreen = (seconds: number): Slide =>
    makeGame([
      {
        ...rawSlide({ id: 1, type: 'media', settings: on(seconds) }),
        type: 'function',
        function: { action: 'screen', screen: { type: 'winners' } },
      },
    ]).questions[0]!;

  it('★ כל עוד יש מקומות לחשוף — לא מדלגים (החשיפה ממשיכה לבד)', () => {
    expect(autoSkipDelayMs(winnersScreen(5), 'showing', screen({ revealPending: true }))).toBeNull();
  });

  it('★ כולם על המסך — ההשהיה שהוגדרה נספרת מהרגע שהמקום הראשון עלה', () => {
    expect(autoSkipDelayMs(winnersScreen(5), 'showing', screen({ revealPending: false, holdMs: 2400 }))).toBe(7_400);
  });

  it('בלי השדות החדשים — בדיוק כמו קודם', () => {
    expect(autoSkipDelayMs(winnersScreen(5), 'showing', free)).toBe(5_000);
    expect(autoSkipDelayMs(winnersScreen(5), 'showing', screen({ holdMs: -100 }))).toBe(5_000);
  });
});
