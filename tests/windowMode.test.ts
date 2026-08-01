/**
 * במה שולטים כשלוחצים "מסך מלא"/"מזעור" — ומה קורה ב-EXE ישן.
 */

import { describe, expect, it } from 'vitest';
import { canMinimize, windowMode } from '../src/app/windowMode.ts';

describe('windowMode', () => {
  it('בדפדפן — Fullscreen API, בלי כפתור מזעור', () => {
    expect(windowMode(undefined)).toBe('browser');
    expect(windowMode(null)).toBe('browser');
    expect(canMinimize('browser')).toBe(false);
  });

  it('ב-EXE עם הגשר המלא — שולטים בחלון עצמו', () => {
    const bridge = { setWindowFullscreen: () => {}, minimizeWindow: () => {} };
    expect(windowMode(bridge)).toBe('desktop');
    expect(canMinimize('desktop')).toBe(true);
  });

  it('EXE ישן (בלי הגשר) — נשארים בהתנהגות הקודמת ולא בכפתור שבור', () => {
    // הגשר נוסף בגרסה הזו; EXE שהותקן קודם אינו חושף אותו כלל.
    expect(windowMode({})).toBe('browser');
    // חצי גשר (רק אחד מהשניים) גם הוא לא מספיק — אין מצב ביניים.
    expect(windowMode({ setWindowFullscreen: () => {} })).toBe('browser');
    expect(windowMode({ minimizeWindow: () => {} })).toBe('browser');
  });

  it('שדה שאינו פונקציה אינו נחשב גשר', () => {
    expect(windowMode({ setWindowFullscreen: true, minimizeWindow: 1 })).toBe('browser');
  });
});
