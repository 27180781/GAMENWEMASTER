/**
 * שליטה בזום. הבאג שזה פותר: Chromium שומר את רמת הזום לכל origin, וכאן יש
 * origin אחד (file://) לכל התוכנה — ולכן זום שנעשה פעם אחת נשאר לתמיד, גם
 * אחרי סגירה ופתיחה מחדש, ובלי דרך ברורה לאפס.
 */

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { STAGE_HEIGHT, STAGE_WIDTH, stageScale } from '../src/render/Stage.tsx';

const require = createRequire(import.meta.url);
const { MIN_ZOOM, MAX_ZOOM, nextZoomFactor, zoomActionFor } = require('../electron/zoom.cjs') as {
  MIN_ZOOM: number;
  MAX_ZOOM: number;
  nextZoomFactor: (current: number, action: 'in' | 'out' | 'reset') => number;
  zoomActionFor: (input: unknown) => 'in' | 'out' | 'reset' | null;
};

/** אירוע מקלדת כפי ש-Electron מוסר אותו ל-before-input-event. */
const key = (over: Record<string, unknown> = {}) => ({
  type: 'keyDown',
  key: '',
  code: '',
  control: false,
  meta: false,
  ...over,
});

describe('nextZoomFactor', () => {
  it('איפוס מחזיר ל-100% מכל מצב — זו הדרך לצאת מזום תקוע', () => {
    expect(nextZoomFactor(0.5, 'reset')).toBe(1);
    expect(nextZoomFactor(2, 'reset')).toBe(1);
    expect(nextZoomFactor(1, 'reset')).toBe(1);
  });

  it('הגדלה והקטנה זזות לשני הכיוונים', () => {
    expect(nextZoomFactor(1, 'in')).toBeGreaterThan(1);
    expect(nextZoomFactor(1, 'out')).toBeLessThan(1);
  });

  it('★ נעצר בגבולות — אי אפשר להגיע למצב בלתי קריא', () => {
    let z = 1;
    for (let i = 0; i < 40; i += 1) z = nextZoomFactor(z, 'out');
    expect(z).toBe(MIN_ZOOM);
    for (let i = 0; i < 60; i += 1) z = nextZoomFactor(z, 'in');
    expect(z).toBe(MAX_ZOOM);
  });

  it('הלוך ושוב חוזר בדיוק ל-100% ולא צובר שארית עשרונית', () => {
    expect(nextZoomFactor(nextZoomFactor(1, 'in'), 'out')).toBe(1);
    expect(nextZoomFactor(nextZoomFactor(1, 'out'), 'in')).toBe(1);
  });

  it('ערך פגום מהחלון אינו מפיל — מתייחסים אליו כ-100%', () => {
    expect(nextZoomFactor(Number.NaN, 'in')).toBeGreaterThan(1);
    expect(nextZoomFactor(0, 'reset')).toBe(1);
    expect(nextZoomFactor(-3, 'out')).toBeLessThan(1);
  });
});

describe('zoomActionFor', () => {
  it('Ctrl+0 מאפס — גם בספרה הרגילה וגם בלוח המספרים', () => {
    expect(zoomActionFor(key({ control: true, key: '0' }))).toBe('reset');
    expect(zoomActionFor(key({ control: true, code: 'Numpad0' }))).toBe('reset');
  });

  it('★ Ctrl ועוד/פחות — בכל הצורות שהמקלדת מייצרת', () => {
    // אותו מקש פיזי מדווח '=' בלי Shift ו-'+' עם Shift, ובפריסות מסוימות
    // מגיע רק ה-code. אם נפספס צורה אחת — המשתמש "לוחץ ולא קורה כלום".
    for (const k of [{ key: '+' }, { key: '=' }, { code: 'Equal' }, { code: 'NumpadAdd' }]) {
      expect(zoomActionFor(key({ control: true, ...k })), JSON.stringify(k)).toBe('in');
    }
    for (const k of [{ key: '-' }, { key: '_' }, { code: 'Minus' }, { code: 'NumpadSubtract' }]) {
      expect(zoomActionFor(key({ control: true, ...k })), JSON.stringify(k)).toBe('out');
    }
  });

  it('Cmd במקום Ctrl (מק) עובד גם הוא', () => {
    expect(zoomActionFor(key({ meta: true, key: '0' }))).toBe('reset');
  });

  it('בלי Ctrl/Cmd לא נוגעים — רווח ומקשי המשחק חייבים להמשיך לעבוד', () => {
    expect(zoomActionFor(key({ key: '0' }))).toBeNull();
    expect(zoomActionFor(key({ key: '-' }))).toBeNull();
    expect(zoomActionFor(key({ key: ' ' }))).toBeNull();
    expect(zoomActionFor(key({ control: true, key: 'x' }))).toBeNull();
  });

  it('רק לחיצה, לא שחרור — אחרת כל צעד היה נספר פעמיים', () => {
    expect(zoomActionFor(key({ type: 'keyUp', control: true, key: '0' }))).toBeNull();
  });

  it('קלט חסר/פגום אינו מפיל', () => {
    expect(zoomActionFor(null)).toBeNull();
    expect(zoomActionFor(undefined)).toBeNull();
    expect(zoomActionFor('x')).toBeNull();
    expect(zoomActionFor({})).toBeNull();
  });
});

/**
 * ★ למה זה הרגיש "תקוע": במסכי המשחק הזום פשוט אינו נראה.
 * הבמה מודדת את חלון הדפדפן ומתאימה את עצמה אליו, וזום משנה את המידה הלוגית
 * בדיוק באותו יחס — כך שהתוצאה הפיזית על המסך זהה. מי שמנסה להקטין תצוגה
 * במסך משחק רואה שכלום לא קורה, בזמן שהזום כן נשמר ומשפיע אחר כך.
 */
describe('הבמה מנטרלת את הזום — ולכן הוא נראה "לא עובד" במשחק', () => {
  /** רוחב הבמה בפיקסלים פיזיים, בהינתן חלון פיזי ורמת זום. */
  const physicalWidth = (winW: number, winH: number, zoom: number) => {
    // בזום, המידות הלוגיות שהדף רואה קטנות פי zoom…
    const cssW = winW / zoom;
    const cssH = winH / zoom;
    // …והבמה מותחת את עצמה אליהן, ואז כל פיקסל לוגי מוצג בגודל zoom.
    return STAGE_WIDTH * stageScale(cssW, cssH) * zoom;
  };

  it('בכל רמת זום הבמה ממלאת את אותו שטח פיזי בדיוק', () => {
    const at100 = physicalWidth(1920, 1080, 1);
    expect(physicalWidth(1920, 1080, 1.5)).toBeCloseTo(at100, 6);
    expect(physicalWidth(1920, 1080, 0.5)).toBeCloseTo(at100, 6);
    expect(physicalWidth(1366, 768, 1.25)).toBeCloseTo(physicalWidth(1366, 768, 1), 6);
  });

  it('גם ביחס מסך שאינו 16:9 — הזום אינו משנה את הגודל הנראה', () => {
    expect(physicalWidth(1920, 1200, 2)).toBeCloseTo(physicalWidth(1920, 1200, 1), 6);
    expect(STAGE_WIDTH / STAGE_HEIGHT).toBeCloseTo(16 / 9, 10);
  });
});
