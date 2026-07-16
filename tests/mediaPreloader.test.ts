/**
 * בדיקות ל-slidePreloadUrls — אילו כתובות מדיה נטענות מראש לשקופית.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefetchMedia, slidePreloadUrls } from '../src/app/mediaPreloader.ts';
import { fourAnswers, makeGame, rawSlide } from './helpers.ts';

function slide(spec: Parameters<typeof rawSlide>[0]) {
  return makeGame([rawSlide(spec)]).questions[0]!;
}

describe('slidePreloadUrls', () => {
  it('אוסף מדיית פתיחה/סיום/תמונת שאלה, בלי כפילויות', () => {
    const s = slide({
      id: 1,
      type: 'trivia',
      answers: fourAnswers(1),
      questionSrc: 'https://cdn/q.png',
      openMediaSrc: 'https://cdn/open.mp4',
      endMediaSrc: 'https://cdn/end.mp4',
    });
    const urls = slidePreloadUrls(s, 'https://cdn/bg.jpg');
    expect(urls).toEqual([
      'https://cdn/open.mp4',
      'https://cdn/end.mp4',
      'https://cdn/q.png',
      'https://cdn/bg.jpg',
    ]);
  });

  it('מדלג על YouTube, blob:, data: וכתובות ריקות', () => {
    const s = slide({
      id: 1,
      type: 'trivia',
      answers: fourAnswers(1),
      openMediaSrc: 'https://youtu.be/abc123',
      endMediaSrc: 'blob:http://x/123',
      questionSrc: 'data:image/png;base64,AAAA',
    });
    expect(slidePreloadUrls(s, '')).toEqual([]);
  });

  it('ans_images — כולל את תמונות התשובות', () => {
    const s = slide({
      id: 1,
      type: 'ans_images',
      answers: [
        { ans: 'https://cdn/a1.png', correct: false, id: 1 },
        { ans: 'https://cdn/a2.png', correct: true, id: 2 },
      ],
    });
    const urls = slidePreloadUrls(s, '');
    expect(urls).toContain('https://cdn/a1.png');
    expect(urls).toContain('https://cdn/a2.png');
  });

  it('בשקופית trivia רגילה תמונות התשובות (טקסט) אינן נאספות', () => {
    const s = slide({
      id: 1,
      type: 'trivia',
      answers: [
        { ans: 'תשובה טקסט', correct: true, id: 1 },
        { ans: 'עוד טקסט', correct: false, id: 2 },
      ],
      questionSrc: 'https://cdn/q.png',
    });
    expect(slidePreloadUrls(s, '')).toEqual(['https://cdn/q.png']);
  });
});

describe('prefetchMedia', () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakeHead() {
    const appended: { rel: string; href: string }[] = [];
    const head = { appendChild: (el: { rel: string; href: string }) => appended.push(el) };
    vi.stubGlobal('document', {
      createElement: () => ({ rel: '', href: '' }),
      head,
    });
    return appended;
  }

  it('יוצר <link rel=prefetch> לכל כתובת תקינה, מדלג על ריק/blob/data/YouTube', () => {
    const appended = fakeHead();
    prefetchMedia([
      'https://cdn/pm-a.png',
      'https://cdn/pm-b.mp4',
      '',                       // ריק — מדולג
      'blob:http://x/1',        // אופליין — מדולג
      'data:image/png;base64,A',// מוטמע — מדולג
      'https://youtu.be/xyzpm', // YouTube — לא ניתן ל-prefetch
    ]);
    expect(appended.map((l) => l.href)).toEqual(['https://cdn/pm-a.png', 'https://cdn/pm-b.mp4']);
    expect(appended.every((l) => l.rel === 'prefetch')).toBe(true);
  });

  it('לא מייצר כפילויות לאותה כתובת (dedup מודול-לבל)', () => {
    const appended = fakeHead();
    prefetchMedia(['https://cdn/pm-dup.png']);
    prefetchMedia(['https://cdn/pm-dup.png', 'https://cdn/pm-new.png']);
    expect(appended.map((l) => l.href)).toEqual(['https://cdn/pm-dup.png', 'https://cdn/pm-new.png']);
  });
});
