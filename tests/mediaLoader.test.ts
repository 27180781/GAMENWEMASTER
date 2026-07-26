/**
 * orderedMediaUrls — איסוף כל מדיית המשחק בסדר עדיפות לטעינה מוקדמת.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { orderedMediaUrls, preloadMediaList } from '../src/app/mediaLoader.ts';
import { fourAnswers, makeGame, rawSlide } from './helpers.ts';

describe('orderedMediaUrls', () => {
  it('סדר: לובי → שקופיות → זוכים → סאונדים; בלי כפילויות/YouTube/blob/data', () => {
    const game = makeGame([
      rawSlide({
        id: 1,
        type: 'trivia',
        answers: fourAnswers(1),
        questionSrc: 'https://cdn/q1.png',
        openMediaSrc: 'https://cdn/open1.mp4',
      }),
      rawSlide({
        id: 2,
        type: 'trivia',
        answers: fourAnswers(2),
        questionSrc: 'https://youtu.be/x', // YouTube — מדולג
        openMediaSrc: 'blob:xyz', // אופליין — מדולג
      }),
    ]);
    game.setting.gameMedia = { src: 'https://cdn/lobby.png' };
    game.setting.logo = { src: 'https://cdn/logo.png' };
    game.setting.winnersMedia = { src: 'https://cdn/podium.png' };
    game.setting.sound.timerMediaSound = { src: 'https://cdn/timer.mp3' };
    game.setting.sound.showQuestionMediaSound = { src: 'https://cdn/lobby.png' }; // כפילות

    const urls = orderedMediaUrls(game);

    expect(urls[0]).toBe('https://cdn/lobby.png'); // לובי קודם
    expect(urls[1]).toBe('https://cdn/logo.png');
    expect(urls).toContain('https://cdn/q1.png');
    expect(urls).toContain('https://cdn/open1.mp4');
    expect(urls).toContain('https://cdn/podium.png');
    expect(urls).toContain('https://cdn/timer.mp3');
    // דילוגים
    expect(urls).not.toContain('https://youtu.be/x');
    expect(urls).not.toContain('blob:xyz');
    // dedup — lobby.png פעם אחת בלבד
    expect(urls.filter((u) => u === 'https://cdn/lobby.png')).toHaveLength(1);
    // סדר עדיפות: שקופית לפני זוכים לפני סאונד
    expect(urls.indexOf('https://cdn/podium.png')).toBeGreaterThan(urls.indexOf('https://cdn/q1.png'));
    expect(urls.indexOf('https://cdn/timer.mp3')).toBeGreaterThan(urls.indexOf('https://cdn/podium.png'));
  });

  it('ans_images — כולל את תמונות התשובות', () => {
    const game = makeGame([
      rawSlide({
        id: 1,
        type: 'ans_images',
        answers: [
          { ans: 'https://cdn/a1.png', correct: false, id: 1 },
          { ans: 'https://cdn/a2.png', correct: true, id: 2 },
        ],
      }),
    ]);
    const urls = orderedMediaUrls(game);
    expect(urls).toContain('https://cdn/a1.png');
    expect(urls).toContain('https://cdn/a2.png');
  });

  it('משחק בלי מדיה (הכל ריק) → רשימה ריקה', () => {
    const game = makeGame([rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1) })]);
    expect(orderedMediaUrls(game)).toEqual([]);
  });
});

/**
 * טעינה מוקדמת של נכס כבד: ההבחנה החשובה היא בין קובץ *גדול* (שממשיכים
 * להמתין לו — אחרת הנגינה תזרים חי ותקרטע) לבין זרם *תקוע* (שמוותרים עליו
 * מהר — אחרת פתיחת המשחק נתקעת על כתובת מתה).
 */
describe('preloadMediaList — נכס כבד: גדול מול תקוע', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
  });

  /** גוף שמזרים `chunks` נתחים במרווח `gapMs`, ואז מסתיים (או נתקע לנצח). */
  function streamBody(chunks: number, gapMs: number, hang = false) {
    let sent = 0;
    return {
      getReader: () => ({
        read: () =>
          new Promise<{ done: boolean; value?: Uint8Array }>((resolve) => {
            if (hang && sent >= chunks) return; // לעולם לא נפתר — זרם תקוע
            setTimeout(() => {
              if (sent >= chunks) return resolve({ done: true });
              sent += 1;
              resolve({ done: false, value: new Uint8Array(1024) });
            }, gapMs);
          }),
      }),
    };
  }

  it('וידאו גדול שממשיך להגיע — ממתינים עד שהוא באמת נגמר', async () => {
    // 12 נתחים במרווח 300ms = 3.6 שניות: הרבה מעבר לתקרה הישנה של תמונה,
    // אך הזרם מתקדם ולכן חייבים להמתין לו עד הסוף.
    globalThis.fetch = (() =>
      Promise.resolve({ ok: true, body: streamBody(12, 300) })) as unknown as typeof fetch;
    const t0 = Date.now();
    const res = await preloadMediaList(['https://cdn/big.mp4'], { timeoutMs: 500 });
    expect(res).toEqual({ total: 1, loaded: 1, failed: 0 });
    expect(Date.now() - t0).toBeGreaterThan(3000); // באמת חיכה, לא ויתר מוקדם
  }, 20000);

  it('זרם תקוע — מוותרים אחרי שתיקה, ולא ממתינים לתקרה המלאה', async () => {
    globalThis.fetch = (() =>
      Promise.resolve({ ok: true, body: streamBody(1, 50, true) })) as unknown as typeof fetch;
    const t0 = Date.now();
    const res = await preloadMediaList(['https://cdn/hangs.mp4'], { timeoutMs: 500 });
    const elapsed = Date.now() - t0;
    expect(res.loaded + res.failed).toBe(1);
    expect(elapsed).toBeGreaterThan(10000); // חיכה לשתיקה (12ש׳), לא ויתר מיד
    expect(elapsed).toBeLessThan(30000); // ולא נתקע עד התקרה (180ש׳)
  }, 40000);

  it('תשובה שאינה ok — כשל מיידי (בלי המתנה)', async () => {
    globalThis.fetch = (() => Promise.resolve({ ok: false })) as unknown as typeof fetch;
    const res = await preloadMediaList(['https://cdn/404.mp4'], { timeoutMs: 200 });
    expect(res.failed).toBe(1);
  }, 20000);
});
