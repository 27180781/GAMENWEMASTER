/**
 * בדיקות ל-slidePreloadUrls — אילו כתובות מדיה נטענות מראש לשקופית.
 */

import { describe, expect, it } from 'vitest';
import { slidePreloadUrls } from '../src/app/mediaPreloader.ts';
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
