/**
 * סגירה אוטומטית של מסך תוצאות ההימור. הבאג: המסך חיכה שהקריין יסיים, ואם קטע
 * לא דיווח שנגמר — המסך נשאר למעלה לנצח והמשחק האוטומטי נעצר.
 */
import { describe, expect, it } from 'vitest';
import { BET_NARRATION_SAFETY_MS, betResultsCloseDelayMs } from '../src/app/betOverlayTiming.ts';

describe('סגירת מסך תוצאות ההימור', () => {
  it('בלי קריין — ההשהיה של "השקופית הבאה" ועוד 2 שנ\'', () => {
    expect(betResultsCloseDelayMs(5, false)).toBe(7000);
    expect(betResultsCloseDelayMs(0, false)).toBe(3000);
  });

  it('★ קריין שלא מסיים — המסך נסגר בכל זאת אחרי התקרה', () => {
    const d = betResultsCloseDelayMs(5, true);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBe(BET_NARRATION_SAFETY_MS);
    expect(BET_NARRATION_SAFETY_MS).toBeLessThanOrEqual(15_000);
  });

  it('התקרה לא מקצרת השהיה רגילה ארוכה ממנה', () => {
    expect(betResultsCloseDelayMs(30, true)).toBe(32_000);
  });
});
