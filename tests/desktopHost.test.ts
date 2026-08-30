/**
 * כתובת ההורדה/העדכון של תוכנת האופליין מופיעה בשלושה מקומות שחייבים להסכים
 * זה עם זה. חוסר התאמה אינו מתפוצץ בשום מקום — הוא פשוט אומר שהתוכנה המותקנת
 * מחפשת עדכונים בכתובת שאיש לא מפרסם אליה, והעדכון נפסק בשקט.
 *
 * בנוסף נבדק כאן העיקרון עצמו: אף כתובת שהלקוח פונה אליה אינה מצביעה ל-GitHub.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DESKTOP_BASE_URL } = require('../electron/desktopHost.cjs') as { DESKTOP_BASE_URL: string };

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('כתובת ההורדה והעדכון', () => {
  it('★ פיד העדכונים שב-electron-builder זהה ל-DESKTOP_BASE_URL', () => {
    const yml = read('electron-builder.yml');
    const url = /^\s*url:\s*(\S+)\s*$/m.exec(yml)?.[1];
    expect(url).toBe(DESKTOP_BASE_URL);
  });

  it('★ הלקוח אינו פונה ל-GitHub — לא בעדכון ולא בהורדה', () => {
    // זו כל המטרה: התעבורה אצל הלקוח מגיעה מהשרת שלנו בלבד.
    expect(DESKTOP_BASE_URL).not.toContain('github');

    const yml = read('electron-builder.yml');
    const publishUrl = /^\s*url:\s*(\S+)\s*$/m.exec(yml)?.[1] ?? '';
    expect(publishUrl).not.toContain('github');

    // עמוד ההורדה — קישורים יחסיים, ולכן תמיד מהשרת שהגיש את העמוד עצמו.
    const page = read('public/download/index.html');
    const links = [...page.matchAll(/href="([^"]+\.exe)"/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) {
      expect(href, href).toMatch(/^\/desktop\//);
    }

    // ה-EXE הבסיסי של כלי החתימה נגזר מאותה כתובת, ולא מ-URL קשיח.
    const main = read('electron/main.cjs');
    expect(main).toContain("require('./desktopHost.cjs')");
    expect(main).not.toMatch(/const SEAL_BASE_URL\s*=\s*'https:\/\/github/);
  });

  it('הכתובת מוחלטת, ב-https, ובלי לוכסן מיותר בסוף', () => {
    // electron-updater מחבר '/latest.yml' לכתובת; לוכסן כפול שובר חלק
    // מהשרתים, ו-http היה חושף את ההורדה לשינוי בדרך.
    expect(DESKTOP_BASE_URL).toMatch(/^https:\/\//);
    expect(DESKTOP_BASE_URL.endsWith('/')).toBe(false);
  });

  it('הנתיב הוא זה ש-Dockerfile באמת ממלא', () => {
    // הקבצים נכתבים ל-dist/desktop, ולכן חייבים להיות מוגשים תחת /desktop.
    expect(new URL(DESKTOP_BASE_URL).pathname).toBe('/desktop');
    expect(read('Dockerfile')).toContain('dist/desktop');
  });
});
