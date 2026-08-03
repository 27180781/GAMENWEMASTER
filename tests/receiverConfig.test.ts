/**
 * הגדרות תוכנת הקליטה RF317SocketForm (‏RF317SocketForm.exe.config).
 *
 * הקובץ הזה נארז לצד ה-EXE ומספק את *ברירות המחדל* של התוכנה (ההגדרות
 * user-scoped, ולכן טווח שהמשתמש שינה ידנית נשמר ב-user.config שלו וגובר).
 * הבדיקות כאן שומרות על שתי נקודות שקל לאבד בעדכון הבינארי של הריסיבר:
 * הפורט חייב להתאים לשרת שלנו, והטווח חייב להישאר 1–600.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { DEFAULT_PORT } = require('../electron/clickerServer.cjs');

const CONFIG = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../electron/receiver/RF317SocketForm.exe.config',
);
const xml = fs.readFileSync(CONFIG, 'utf8');

/** שולף ערך הגדרה לפי שם מתוך מקטע ה-userSettings. */
function setting(name: string): string {
  const m = new RegExp(`<setting name="${name}"[^>]*>\\s*<value>([^<]*)</value>`).exec(xml);
  if (m === null) throw new Error(`ההגדרה "${name}" לא נמצאה ב-${path.basename(CONFIG)}`);
  return m[1]!.trim();
}

describe('הגדרות ברירת המחדל של תוכנת הקליטה', () => {
  it('הפורט זהה לפורט שרת הקליקרים שלנו', () => {
    expect(setting('port')).toBe(String(DEFAULT_PORT));
  });

  it('טווח מזהי השלטים הוא 1–600 (ולא 1–10 שדרש הגדרה ידנית בכל אירוע)', () => {
    // מתחיל ב-1 כדי שגם ערכות שלטים שממוספרות מ-1 ייקלטו בלי הגדרה ידנית.
    expect(setting('min')).toBe('1');
    expect(setting('max')).toBe('600');
    expect(Number(setting('min'))).toBeLessThan(Number(setting('max')));
  });

  it('ההגדרות נשארות user-scoped — כך ששינוי ידני של המשתמש גובר על הקובץ', () => {
    expect(xml).toContain('allowExeDefinition="MachineToLocalUser"');
  });

  it('הקובץ נשאר XML תקין עם BOM (‏.NET קורא אותו כ-UTF-8)', () => {
    expect(fs.readFileSync(CONFIG).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    // מבנה בסיסי — פותח ונסגר כראוי
    expect(xml).toContain('<configuration>');
    expect(xml.trimEnd().endsWith('</configuration>')).toBe(true);
  });
});
