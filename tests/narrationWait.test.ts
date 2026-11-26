/**
 * המתנה לקריין לפני מעבר אוטומטי. שני באגים:
 * 1. מעבר אוטומטי (וסגירת מסך תוצאות ההימור) חיכה שהקריין יסיים, ואם קטע לא
 *    דיווח שנגמר — המשחק האוטומטי נעצר לנצח. לכן יש תקרה.
 * 2. עד 2026-11 ההמתנה התחילה רק כשהקול התחיל, והתקרה הייתה 15 שניות קבועות:
 *    משפט שעוד נטען לא עיכב את חשיפת התשובה הבאה, ומשפט ארוך נחתך באמצע.
 *    עכשיו "עסוק" מתחיל בהחלטה לומר, והתקרה היא הסוף המתוכנן של המשפט.
 */
import { describe, expect, it } from 'vitest';
import {
  betResultsCloseDelayMs,
  NARRATION_END_SLACK_MS,
  NARRATION_LOAD_WAIT_MS,
  narrationSafeDelayMs,
  narratorWaitMs,
} from '../src/app/narrationWait.ts';

describe('כמה זמן הקריין עוד צריך', () => {
  it('שקט — 0', () => {
    expect(narratorWaitMs(null, 1_000)).toBe(0);
  });

  it('עסוק — עד התקרה של המשפט', () => {
    expect(narratorWaitMs({ until: 18_500 }, 1_000)).toBe(17_500);
  });

  it('★ התקרה עברה והמשפט לא דיווח שנגמר — עדיין "עסוק", אבל ממתינים רק טיק', () => {
    // לא 0: 0 פירושו "שקט", והאפקט היה מחכה את ההשהיה הרגילה במקום לרוץ מיד
    expect(narratorWaitMs({ until: 500 }, 1_000)).toBe(1);
  });

  it('התקרות סבירות: טעינה של כמה שניות, ומרווח קטן אחרי הסוף המתוכנן', () => {
    expect(NARRATION_LOAD_WAIT_MS).toBeGreaterThanOrEqual(2_000);
    expect(NARRATION_LOAD_WAIT_MS).toBeLessThanOrEqual(10_000);
    expect(NARRATION_END_SLACK_MS).toBeGreaterThan(0);
    expect(NARRATION_END_SLACK_MS).toBeLessThanOrEqual(5_000);
  });
});

describe('מעבר אוטומטי בזמן שהקריין עסוק', () => {
  it('קריין שקט — ההשהיה הרגילה', () => {
    expect(narrationSafeDelayMs(1200, 0)).toBe(1200);
  });

  it('★ קריין עסוק — ממתינים לו, ולא רק שנייה', () => {
    expect(narrationSafeDelayMs(1000, 4_000)).toBe(4_000);
  });

  it('★ משפט ארוך מ-15 שניות — ממתינים לכולו (עד 2026-11 נחתך ב-15)', () => {
    expect(narrationSafeDelayMs(1000, 19_000)).toBe(19_000);
  });

  it('קריין שלא מסיים — המעבר קורה בכל זאת, אחרי התקרה', () => {
    expect(Number.isFinite(narrationSafeDelayMs(1000, narratorWaitMs({ until: 9_000 }, 0)))).toBe(true);
  });

  it('ההמתנה לקריין לא מקצרת השהיה רגילה ארוכה ממנה', () => {
    expect(narrationSafeDelayMs(30_000, 4_000)).toBe(30_000);
  });
});

describe('סגירת מסך תוצאות ההימור', () => {
  it('בלי קריין — ההשהיה של "השקופית הבאה" ועוד 2 שנ\'', () => {
    expect(betResultsCloseDelayMs(5, 0)).toBe(7000);
    expect(betResultsCloseDelayMs(0, 0)).toBe(3000);
  });

  it('★ קריין עסוק יותר מזה — המסך ממתין לו', () => {
    expect(betResultsCloseDelayMs(5, 12_000)).toBe(12_000);
  });

  it('ההמתנה לקריין לא מקצרת השהיה רגילה ארוכה ממנה', () => {
    expect(betResultsCloseDelayMs(30, 4_000)).toBe(32_000);
  });
});
