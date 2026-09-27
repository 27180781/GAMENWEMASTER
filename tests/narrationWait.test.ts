/**
 * המתנה לקריין לפני מעבר אוטומטי. הבאג: מעבר אוטומטי (וסגירת מסך תוצאות
 * ההימור) חיכה שהקריין יסיים, ואם קטע לא דיווח שנגמר — המשחק האוטומטי נעצר
 * לנצח.
 */
import { describe, expect, it } from 'vitest';
import {
  betResultsCloseDelayMs,
  NARRATION_SAFETY_MS,
  narrationSafeDelayMs,
} from '../src/app/narrationWait.ts';

describe('מעבר אוטומטי בזמן שהקריין מדבר', () => {
  it('קריין שקט — ההשהיה הרגילה', () => {
    expect(narrationSafeDelayMs(1200, false)).toBe(1200);
  });

  it('★ קריין שלא מסיים — המעבר קורה בכל זאת אחרי התקרה', () => {
    const d = narrationSafeDelayMs(1200, true);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBe(NARRATION_SAFETY_MS);
    expect(NARRATION_SAFETY_MS).toBeLessThanOrEqual(15_000);
  });

  it('התקרה לא מקצרת השהיה רגילה ארוכה ממנה', () => {
    expect(narrationSafeDelayMs(30_000, true)).toBe(30_000);
  });
});

describe('סגירת מסך תוצאות ההימור', () => {
  it('בלי קריין — ההשהיה של "השקופית הבאה" ועוד 2 שנ\'', () => {
    expect(betResultsCloseDelayMs(5, false)).toBe(7000);
    expect(betResultsCloseDelayMs(0, false)).toBe(3000);
  });

  it('★ קריין שלא מסיים — המסך נסגר בכל זאת אחרי התקרה', () => {
    expect(betResultsCloseDelayMs(5, true)).toBe(NARRATION_SAFETY_MS);
  });

  it('התקרה לא מקצרת השהיה רגילה ארוכה ממנה', () => {
    expect(betResultsCloseDelayMs(30, true)).toBe(32_000);
  });
});
