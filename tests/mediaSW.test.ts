/** מדיניות זיהוי המדיה של מטמון ה-Service Worker (isMediaUrl) + שמירת סנכרון מול sw.js. */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isMediaUrl } from '../src/app/mediaSW.ts';
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '../src/engine/classify.ts';

describe('isMediaUrl — אילו כתובות נשמרות במטמון המדיה', () => {
  it('סוגי מדיה נפוצים (תמונה/סאונד/וידאו) → true', () => {
    for (const url of [
      'https://cdn.example/x/a.png',
      'https://cdn.example/x/b.JPG',
      'https://cdn.example/x/c.jpeg',
      'https://cdn.example/x/d.webp',
      'https://cdn.example/x/e.svg',
      'https://cdn.example/x/f.mp3',
      'https://cdn.example/x/g.wav',
      'https://cdn.example/x/h.m4a',
      'https://cdn.example/x/i.mp4',
      'https://cdn.example/x/j.webm',
    ]) {
      expect(isMediaUrl(url)).toBe(true);
    }
  });

  it('מדיה עם query string עדיין מזוהה', () => {
    expect(isMediaUrl('https://cdn.example/x/a.png?v=2&sig=abc')).toBe(true);
    // כמו הקבצים האמיתיים — שם ארוך שמסתיים ב-.jpg
    expect(isMediaUrl('https://r2/legacy/face_or_vase_01_optimized.svg-min_243x320.jpg')).toBe(true);
  });

  it('לא-מדיה → false (אפליקציה/JSON/YouTube/API)', () => {
    for (const url of [
      'https://host/index.html',
      'https://host/assets/index-DRT3AzN6.js',
      'https://host/assets/index-DQ0kDind.css',
      'https://host/g.json',
      'https://www.youtube.com/embed/abc123',
      'https://sincnew.example/api/games/webhook',
      'https://host/',
    ]) {
      expect(isMediaUrl(url)).toBe(false);
    }
  });
});

describe('סנכרון sw.js ↔ classify (שומר-סחיפה)', () => {
  // ה-SW הוא קובץ עצמאי שלא יכול לייבא מ-src, ולכן מחזיק עותק-רגקס של רשימות
  // הסיומות. הבדיקה הזו מחלצת את הרגקס מהקובץ ומוודאת ששני הצדדים חופפים —
  // סיומת שתתווסף רק באחד מהם תפיל את הבדיקה.
  const swSource = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf-8');
  const match = /const MEDIA_EXT =\s*(\/[^;]+\/i);/.exec(swSource);
  it('הרגקס MEDIA_EXT קיים ב-sw.js', () => {
    expect(match).not.toBeNull();
  });
  const swRegex = match ? new RegExp(match[1]!.slice(1, -2), 'i') : /$ ^/;
  const allExtensions = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS];

  it('כל סיומת של classify מזוהה גם ע"י הרגקס של ה-SW', () => {
    for (const ext of allExtensions) {
      expect(swRegex.test(`/media/file.${ext}`), `סיומת ${ext} חסרה ב-sw.js`).toBe(true);
    }
  });

  it('כל סיומת שברגקס של ה-SW מוכרת גם ל-classify (דרך isMediaUrl)', () => {
    // מחלצים את קבוצת הסיומות מתוך הרגקס עצמו: (a|b|c...) — כולל פירוק jpe?g
    const group = /\\\.\(([^)]+)\)/.exec(match![1]!)![1]!;
    const swExtensions = group
      .split('|')
      .flatMap((e) => (e === 'jpe?g' ? ['jpg', 'jpeg'] : [e]));
    for (const ext of swExtensions) {
      expect(isMediaUrl(`https://x/f.${ext}`), `סיומת ${ext} ב-sw.js אך לא ב-classify`).toBe(true);
    }
  });
});
