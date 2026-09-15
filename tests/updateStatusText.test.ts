/**
 * נוסח שורת הגרסה — מה המנחה רואה על מצב העדכון האוטומטי.
 * לפני זה החיווי הופיע *רק* כשכבר היה מה להוריד, ולכן לא הייתה שום דרך לדעת
 * אם המנגנון בכלל פועל.
 */

import { describe, expect, it } from 'vitest';
import { downloadSizeText, updateStatusText } from '../src/app/App.tsx';

describe('updateStatusText', () => {
  it('לפני שהגיע דיווח — "בודק"', () => {
    expect(updateStatusText(null)).toBe('בודק עדכון…');
    expect(updateStatusText({ state: 'checking' })).toBe('בודק עדכון…');
  });

  it('אין גרסה חדשה — נאמר במפורש שהתוכנה מעודכנת', () => {
    expect(updateStatusText({ state: 'current', version: '0.1.144' })).toBe('✅ מעודכן');
  });

  it('הורדה — אחוזים', () => {
    expect(updateStatusText({ state: 'downloading', percent: 37 })).toContain('37%');
    expect(updateStatusText({ state: 'downloading' })).toContain('0%');
  });

  it('★ הורדה — גם כמה MB, כדי שרואים שהעדכון ההפרשי מוריד כמה MB ולא את כל המתקין', () => {
    const delta = { state: 'downloading' as const, percent: 50, transferred: 3 * 1048576, total: 6 * 1048576 };
    expect(updateStatusText(delta)).toContain('50%');
    expect(updateStatusText(delta)).toContain('3.0 מתוך 6.0MB');
    const full = { state: 'downloading' as const, percent: 10, transferred: 10.7 * 1048576, total: 107 * 1048576 };
    expect(updateStatusText(full)).toContain('11 מתוך 107MB');
    // בלי סך הורדה ידוע — אין סוגריים ריקים
    expect(downloadSizeText({ state: 'downloading', percent: 5 })).toBe('');
    expect(downloadSizeText({ state: 'downloading', percent: 5, total: 0 })).toBe('');
  });

  it('מוכן — נאמר מתי זה ייכנס לתוקף', () => {
    const text = updateStatusText({ state: 'ready', version: '0.1.150' });
    expect(text).toContain('0.1.150');
    expect(text).toContain('בסגירת התוכנה');
  });

  it('כשל בדיקה — לא שקט, אלא הסבר', () => {
    expect(updateStatusText({ state: 'offline' })).toContain('לא הצלחנו לבדוק');
  });

  it('קבצים שאינם מתעדכנים — כל אחד עם הסיבה שלו', () => {
    expect(updateStatusText({ state: 'unsupported', reason: 'sealed' })).toContain('משחק סגור');
    expect(updateStatusText({ state: 'unsupported', reason: 'portable' })).toContain('הנייד');
    expect(updateStatusText({ state: 'unsupported', reason: 'dev' })).toContain('פיתוח');
  });

  it('כלי החתימה שהחליף את עצמו', () => {
    expect(updateStatusText({ state: 'sealer' })).toContain('בפתיחה הבאה');
  });

  it('אין הרשאת כתיבה — אזהרה עם מה לעשות', () => {
    expect(updateStatusText({ state: 'manual' })).toContain('הורידו מחדש');
  });
});
