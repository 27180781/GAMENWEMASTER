/**
 * "מעבר אוטומטי" (setting.automaticSkip) — ההגדרה המתקדמת האחרונה שלא הייתה
 * לה בדיקת התנהגות. עד כה נבדק רק שהשדה *נטען* נכון; כאן נבדק שהוא **פועל**.
 */

import { describe, expect, it } from 'vitest';
import { autoSkipDelayMs } from '../src/app/autoSkip.ts';
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

describe('מעבר אוטומטי — האם ההגדרה פועלת', () => {
  it('★ דלוק בשקופית טריוויה אחרי החשיפה — מדלג אחרי מספר השניות שנקבע', () => {
    expect(autoSkipDelayMs(slideOf('trivia', on(12)), 'results', false)).toBe(12_000);
  });

  it('★ כבוי — לא מדלג לעולם', () => {
    for (const phase of ['showing', 'voting', 'results'] as const) {
      expect(autoSkipDelayMs(slideOf('trivia', off), phase, false), phase).toBeNull();
    }
  });

  it('★ בשקופית שאין בה הצבעה (טקסט/מדיה) — מדלג כבר בהצגה', () => {
    expect(autoSkipDelayMs(slideOf('subject', on(5)), 'showing', false)).toBe(5_000);
  });

  it('בטריוויה לא מדלגים בהצגת השאלה ולא בזמן ההצבעה — שם הטיימר אחראי', () => {
    expect(autoSkipDelayMs(slideOf('trivia', on(12)), 'showing', false)).toBeNull();
    expect(autoSkipDelayMs(slideOf('trivia', on(12)), 'voting', false)).toBeNull();
  });

  it('★ מדיה מתנגנת — לא קוטעים אותה באמצע', () => {
    expect(autoSkipDelayMs(slideOf('trivia', on(12)), 'results', true)).toBeNull();
  });

  it('שניות ריקות/אפס — עדיין מדלג, אבל לא באותו רגע', () => {
    // כלל הריקון הופך "" ל-0. דילוג מיידי היה עלול להריץ שרשרת שקופיות בבת אחת.
    expect(autoSkipDelayMs(slideOf('subject', on('')), 'showing', false)).toBe(1_000);
  });

  it('הטווח שהעורך מתיר (1–300 שניות) עובר כמו שהוא', () => {
    expect(autoSkipDelayMs(slideOf('subject', on(1)), 'showing', false)).toBe(1_000);
    expect(autoSkipDelayMs(slideOf('subject', on(300)), 'showing', false)).toBe(300_000);
  });
});
