/**
 * חשיפה הדרגתית של תמונת השאלה (setting.imageReveal): לפני ההצבעה מטושטשת,
 * בהצבעה מתבהרת ברציפות לפי הזמן, ואחריה חדה. הנוסחה (imageReveal.ts)
 * משותפת לתצוגה; כאן נועלים אותה, את הסכימה ואת התנאים שבהם האפקט פעיל.
 */

import { describe, expect, it } from 'vitest';
import {
  imageRevealBlurAt,
  imageRevealBlurFor,
  imageRevealOf,
} from '../src/engine/index.ts';
import { fourAnswers, makeGame, rawSlide } from './helpers.ts';

const slideWith = (settings: Record<string, unknown>, questionSrc = 'https://x.dev/pic.jpg') =>
  makeGame([
    rawSlide({ id: 1, type: 'trivia', que: 'מה בתמונה?', answers: fourAnswers(1), scoreForQue: 7, timeForQue: 10, questionSrc, settings }),
  ]).questions[0]!;

describe('סכימה — setting.imageReveal', () => {
  it('★ חסר בקובץ — כבוי, ברירת מחדל 48 (קבצים שנוצרו לפני השדה)', () => {
    expect(slideWith({}).setting.imageReveal).toEqual({ active: false, blur: 48 });
  });

  it('★ ‎""‎ ב-blur (כלל הריקון) → 48; מספר נשמר; אובייקט חלקי מושלם', () => {
    expect(slideWith({ imageReveal: { active: true, blur: '' } }).setting.imageReveal).toEqual({ active: true, blur: 48 });
    expect(slideWith({ imageReveal: { active: true, blur: 80 } }).setting.imageReveal).toEqual({ active: true, blur: 80 });
    expect(slideWith({ imageReveal: { active: true } }).setting.imageReveal).toEqual({ active: true, blur: 48 });
  });
});

describe('imageRevealOf — מתי האפקט פעיל', () => {
  it('★ דולק ויש תמונת שאלה — עוצמה ומשך לפי timeForQue', () => {
    expect(imageRevealOf(slideWith({ imageReveal: { active: true, blur: 48 } }))).toEqual({ blur: 48, durationMs: 10_000 });
  });

  it('כבוי, או עוצמה אפס — null', () => {
    expect(imageRevealOf(slideWith({ imageReveal: { active: false, blur: 48 } }))).toBeNull();
    expect(imageRevealOf(slideWith({ imageReveal: { active: true, blur: 0 } }))).toBeNull();
  });

  it('★ בלי תמונת שאלה אין מה לטשטש — null, והשקופית מוצגת כרגיל', () => {
    expect(imageRevealOf(slideWith({ imageReveal: { active: true, blur: 48 } }, ''))).toBeNull();
  });
});

describe('imageRevealBlurAt — הנוסחה', () => {
  it('★ מלא בפתיחה, חד בסוף, ליניארי באמצע', () => {
    expect(imageRevealBlurAt(48, 0, 10_000)).toBe(48);
    expect(imageRevealBlurAt(48, 2_500, 10_000)).toBe(36);
    expect(imageRevealBlurAt(48, 5_000, 10_000)).toBe(24);
    expect(imageRevealBlurAt(48, 10_000, 10_000)).toBe(0);
    expect(imageRevealBlurAt(48, 12_000, 10_000)).toBe(0);
  });

  it('זמן שלילי/לא תקין = מלא; בלי טיימר או בלי עוצמה — חד', () => {
    expect(imageRevealBlurAt(48, -5, 10_000)).toBe(48);
    expect(imageRevealBlurAt(48, Number.NaN, 10_000)).toBe(48);
    expect(imageRevealBlurAt(48, 1_000, 0)).toBe(0);
    expect(imageRevealBlurAt(0, 0, 10_000)).toBe(0);
  });
});

describe('imageRevealBlurFor — לפי שלב השקופית', () => {
  it('★ לפני ההצבעה מלא, גם כשעדיין אין דגימת זמן', () => {
    expect(imageRevealBlurFor('showing', 48, null, 10_000)).toBe(48);
    expect(imageRevealBlurFor('showing', 48, 9_000, 10_000)).toBe(48);
    expect(imageRevealBlurFor('voting', 48, null, 10_000)).toBe(48);
  });

  it('★ בהצבעה לפי הזמן; אחרי הסגירה חד', () => {
    expect(imageRevealBlurFor('voting', 48, 5_000, 10_000)).toBe(24);
    expect(imageRevealBlurFor('results', 48, 1_000, 10_000)).toBe(0);
    expect(imageRevealBlurFor('ended', 48, 0, 10_000)).toBe(0);
  });
});
