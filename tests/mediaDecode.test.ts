/**
 * slideDecodeUrls — אילו כתובות מפוענחות מראש לשקופית (תמונת שאלה / תמונות
 * תשובה / רקע). הפענוח בפועל (decode/וידאו) דורש DOM ולכן נבדק ב-E2E.
 */

import { describe, expect, it } from 'vitest';
import { parseGameFile } from '../src/engine/index.ts';
import { slideDecodeUrls } from '../src/app/mediaDecode.ts';
import { fourAnswers, makeGame, rawGame, rawSlide } from './helpers.ts';

const VID = 'https://cdn/trivia-bg.mp4';

describe('slideDecodeUrls', () => {
  it('trivia עם תמונת שאלה: מפענח את התמונה ואת הרקע (triviaMedia)', () => {
    const game = makeGame([
      rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1), questionSrc: 'https://cdn/q1.jpg' }),
    ]);
    const urls = slideDecodeUrls(game.questions[0]!, VID);
    expect(urls).toContain('https://cdn/q1.jpg');
    expect(urls).toContain(VID); // הרקע נופל ל-triviaMedia
  });

  it('trivia בלי תמונת שאלה: רק הרקע (הסרטון המשותף)', () => {
    const game = makeGame([rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1) })]);
    expect(slideDecodeUrls(game.questions[0]!, VID)).toEqual([VID]);
  });

  it('ans_images: כולל את תמונות התשובות (והרקע)', () => {
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
    const urls = slideDecodeUrls(game.questions[0]!, VID);
    expect(urls).toContain('https://cdn/a1.png');
    expect(urls).toContain('https://cdn/a2.png');
    expect(urls).toContain(VID);
  });

  it('שקופית רקע-ייעודי גוברת על triviaMedia', () => {
    const raw = rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1) });
    (raw.backgroundMedia as { src: string }).src = 'https://cdn/own-bg.jpg';
    const game = parseGameFile(rawGame([raw]));
    const urls = slideDecodeUrls(game.questions[0]!, VID);
    expect(urls).toContain('https://cdn/own-bg.jpg');
    expect(urls).not.toContain(VID);
  });

  it('subject בלי רקע ייעודי: אין רקע-שאלות (triviaMedia לא נכפה)', () => {
    const game = makeGame([rawSlide({ id: 1, type: 'subject', que: 'טקסט' })]);
    expect(slideDecodeUrls(game.questions[0]!, VID)).toEqual([]);
  });
});
