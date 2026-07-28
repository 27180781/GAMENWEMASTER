/**
 * לוח הזמנים של "גלגל" ההגרלה — טהור, ולכן נבדק ביחידה. האנימציה עצמה היא
 * תצוגה בלבד: המוגרל נבחר לפניה, כך שאי אפשר להשפיע על התוצאה בעצירה.
 */
import { describe, expect, it } from 'vitest';
import { spinSchedule } from '../src/render/RaffleOverlay.tsx';

describe('spinSchedule', () => {
  it('סכום ההשהיות שווה למשך המבוקש', () => {
    const gaps = spinSchedule(30, 4200);
    const total = gaps.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(4200, 6);
  });

  it('מספר ההחלפות כמבוקש', () => {
    expect(spinSchedule(30, 4200)).toHaveLength(30);
    expect(spinSchedule(8, 1000)).toHaveLength(8);
  });

  it('מאט בהדרגה — כל השהיה ארוכה מקודמתה', () => {
    const gaps = spinSchedule(30, 4200);
    for (let i = 1; i < gaps.length; i++) {
      expect(gaps[i]!).toBeGreaterThan(gaps[i - 1]!);
    }
  });

  it('מתחיל מהר ונגמר איטי — יחס משמעותי בין הקצוות', () => {
    const gaps = spinSchedule(30, 4200);
    expect(gaps[0]!).toBeLessThan(60); // ההתחלה מהבהבת
    expect(gaps[gaps.length - 1]!).toBeGreaterThan(400); // הסוף מתוח
    expect(gaps[gaps.length - 1]! / gaps[0]!).toBeGreaterThan(10);
  });

  it('אורך חריג (החלפה אחת) לא מפיל ולא מחלק באפס', () => {
    const gaps = spinSchedule(1, 500);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toBeCloseTo(500, 6);
  });
});
