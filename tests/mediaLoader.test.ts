/**
 * orderedMediaUrls — איסוף כל מדיית המשחק בסדר עדיפות לטעינה מוקדמת.
 */

import { describe, expect, it } from 'vitest';
import { orderedMediaUrls } from '../src/app/mediaLoader.ts';
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
