/**
 * ערוצי ה-IPC בין ה-preload ל-main.
 *
 * שני הצדדים מחוברים אך ורק במחרוזת: `ipcRenderer.invoke('game:library')` מול
 * `ipcMain.handle('game:library')`. טעות אות אחת אינה נכשלת בבנייה, אינה
 * נכשלת בהידור, ואפילו לא זורקת בזמן ריצה — ה-invoke פשוט נתקע/מחזיר שגיאה,
 * והפיצ'ר "לא עובד" בלי שום רמז למה.
 *
 * הבדיקה קוראת את שני הקבצים ומוודאת שכל ערוץ שה-preload קורא לו אכן מטופל.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (file: string) => readFileSync(new URL(`../electron/${file}`, import.meta.url), 'utf8');

/** כל המחרוזות שמופיעות בקריאה נתונה (invoke/handle/on). */
function channels(source: string, call: string): string[] {
  const re = new RegExp(`${call}\\(\\s*['"]([^'"]+)['"]`, 'g');
  return [...new Set([...source.matchAll(re)].map((m) => m[1]!))].sort();
}

const preload = read('preload.cjs');
const main = read('main.cjs');

describe('כל ערוץ שה-preload קורא לו — מטופל ב-main', () => {
  const invoked = channels(preload, 'ipcRenderer\\.invoke');
  const handled = new Set(channels(main, 'ipcMain\\.handle'));

  it('נמצאו ערוצים בשני הצדדים (שהבדיקה עצמה לא תהיה ריקה)', () => {
    expect(invoked.length).toBeGreaterThan(20);
    expect(handled.size).toBeGreaterThan(20);
  });

  it.each(invoked)('★ %s', (channel) => {
    expect(handled.has(channel)).toBe(true);
  });

  it('★ ערוצי ספריית המשחקים קיימים בשני הצדדים', () => {
    for (const c of ['game:library', 'game:librarySelect', 'game:libraryDelete']) {
      expect(invoked, `${c} — preload`).toContain(c);
      expect(handled.has(c), `${c} — main`).toBe(true);
    }
  });
});

describe('כל ערוץ שידור שה-preload מאזין לו — נשלח מ-main', () => {
  const listened = channels(preload, 'ipcRenderer\\.on');
  // ב-main משדרים בשלוש דרכים: העוזר sendToRenderer, webContents.send, ו-
  // e.sender.send (חיווי התקדמות שחוזר לחלון ששאל). כולן נספרות — אחרת
  // הבדיקה הייתה נכשלת על קוד תקין לגמרי.
  const sent = new Set([...channels(main, 'sendToRenderer'), ...channels(main, '\\.send')]);

  it('נמצאו ערוצי שידור (שהבדיקה עצמה לא תהיה ריקה)', () => {
    expect(listened.length).toBeGreaterThan(3);
  });

  it.each(listened)('★ %s', (channel) => {
    expect(sent.has(channel)).toBe(true);
  });
});
