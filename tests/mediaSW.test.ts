/** מדיניות זיהוי המדיה של מטמון ה-Service Worker (isMediaUrl). */

import { describe, expect, it } from 'vitest';
import { isMediaUrl } from '../src/app/mediaSW.ts';

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
