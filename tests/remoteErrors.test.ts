/**
 * הודעות שגיאה מהשרת — מה המנחה רואה כשטעינה לפי קוד נכשלת.
 */

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { remoteErrorMessage, isRetryable } = require_('../electron/remoteErrors.cjs') as {
  remoteErrorMessage: (status: number) => string;
  isRetryable: (status: number) => boolean;
};

describe('remoteErrorMessage', () => {
  it('546 — כשל אריזה בשרת, לא הקוד שהוקלד; ההודעה מפנה לדרך שכן עובדת', () => {
    const msg = remoteErrorMessage(546);
    expect(msg).toContain('כבד מדי');
    expect(msg).toContain('ZIP'); // ★ אומר למנחה מה לעשות עכשיו
    expect(msg).not.toMatch(/546/); // ★ לא מספר סתום
  });

  it('507 ו-413 מקבלים את אותה מסקנה מעשית', () => {
    expect(remoteErrorMessage(507)).toBe(remoteErrorMessage(546));
    expect(remoteErrorMessage(413)).toBe(remoteErrorMessage(546));
  });

  it('404 — קוד/רישיון', () => {
    expect(remoteErrorMessage(404)).toContain('רישיון');
  });

  it('הרשאות והצפה', () => {
    expect(remoteErrorMessage(401)).toContain('הרשאה');
    expect(remoteErrorMessage(403)).toContain('הרשאה');
    expect(remoteErrorMessage(429)).toContain('המתינו');
  });

  it('5xx כללי — נסו שוב', () => {
    expect(remoteErrorMessage(502)).toContain('נסו שוב');
    expect(remoteErrorMessage(503)).toContain('503');
  });

  it('4xx אחר נשאר מפורש', () => {
    expect(remoteErrorMessage(400)).toContain('400');
  });
});

describe('isRetryable', () => {
  it('כשל זיכרון הוא דטרמיניסטי — אין טעם לנסות שוב', () => {
    expect(isRetryable(546)).toBe(false);
    expect(isRetryable(507)).toBe(false);
    expect(isRetryable(413)).toBe(false);
  });

  it('תקלה זמנית — כן', () => {
    expect(isRetryable(429)).toBe(true);
    expect(isRetryable(502)).toBe(true);
  });

  it('שגיאת לקוח — לא', () => {
    expect(isRetryable(404)).toBe(false);
    expect(isRetryable(400)).toBe(false);
  });
});
