/**
 * בדיקות ל-collectMediaRefs — אילו הפניות מדיה נאספות מהמשחק ואיזה הקשר.
 * (probeMediaRefs דורש DOM ולכן נבדק ב-E2E בדפדפן.)
 */

import { describe, expect, it } from 'vitest';
import { collectMediaRefs } from '../src/app/mediaCheck.ts';
import { fourAnswers, makeGame, rawSlide } from './helpers.ts';

describe('collectMediaRefs', () => {
  it('אוסף מדיה גלובלית ומדיה של שקופיות עם הקשר', () => {
    const game = makeGame([
      rawSlide({
        id: 1,
        type: 'trivia',
        answers: fourAnswers(1),
        questionSrc: 'https://cdn/q1.png',
        openMediaSrc: 'https://cdn/open1.mp4',
      }),
    ]);
    // מגדירים מדיה גלובלית (השדות ריקים כברירת מחדל)
    game.setting.logo.src = 'https://cdn/logo.png';
    game.setting.triviaMedia.src = 'https://cdn/bg.jpg';

    const refs = collectMediaRefs(game);
    const byCtx = Object.fromEntries(refs.map((r) => [r.context, r.src]));
    expect(byCtx['לוגו']).toBe('https://cdn/logo.png');
    expect(byCtx['רקע שאלות']).toBe('https://cdn/bg.jpg');
    expect(byCtx['שקופית 1 · תמונת שאלה']).toBe('https://cdn/q1.png');
    expect(byCtx['שקופית 1 · מדיית פתיחה']).toBe('https://cdn/open1.mp4');
    // סיווג נכון
    expect(refs.find((r) => r.src === 'https://cdn/open1.mp4')!.kind).toBe('video');
    expect(refs.find((r) => r.src === 'https://cdn/q1.png')!.kind).toBe('image');
  });

  it('מדלג על שדות ריקים', () => {
    const game = makeGame([rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1) })]);
    // בלי מדיה מוגדרת — כל השדות ריקים
    expect(collectMediaRefs(game)).toEqual([]);
  });

  it('ans_images — אוסף את תמונות התשובות עם מספור', () => {
    const game = makeGame([
      rawSlide({
        id: 1,
        type: 'ans_images',
        answers: [
          { ans: 'https://cdn/a1.png', correct: true, id: 1 },
          { ans: 'https://cdn/a2.png', correct: false, id: 2 },
        ],
      }),
    ]);
    const refs = collectMediaRefs(game);
    expect(refs.find((r) => r.context === 'שקופית 1 · תמונת תשובה 1')!.src).toBe('https://cdn/a1.png');
    expect(refs.find((r) => r.context === 'שקופית 1 · תמונת תשובה 2')!.src).toBe('https://cdn/a2.png');
  });
});
