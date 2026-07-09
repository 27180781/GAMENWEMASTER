import { describe, expect, it } from 'vitest';
import { slideBackgroundSrc } from '../src/render/SlideView.tsx';
import { fourAnswers, makeGame, rawSlide } from './helpers.ts';

const TRIVIA_MEDIA = 'https://cdn/trivia-bg.mp4';

function slideWith(overrides: {
  questionSrc?: string;
  backgroundSrc?: string;
  slidBackgroundSrc?: string;
}) {
  const game = makeGame([
    rawSlide({
      id: 1,
      type: 'survey',
      answers: fourAnswers(0),
      questionSrc: overrides.questionSrc ?? '',
      settings: overrides.slidBackgroundSrc
        ? { slidBackgroundMedia: { src: overrides.slidBackgroundSrc } }
        : {},
    }),
  ]);
  const slide = game.questions[0]!;
  if (overrides.backgroundSrc !== undefined) {
    // backgroundMedia אינו נגזר מ-rawSlide — נזריק ידנית
    (slide as { backgroundMedia: { src: string } }).backgroundMedia = {
      src: overrides.backgroundSrc,
    };
  }
  return slide;
}

describe('slideBackgroundSrc — תמונת השאלה אינה רקע', () => {
  it('backgroundMedia זהה לתמונת השאלה → מתעלמים, נופלים לרקע הרגיל', () => {
    const image = 'https://cdn/q-image.jpg';
    const slide = slideWith({ questionSrc: image, backgroundSrc: image });
    expect(slideBackgroundSrc(slide, TRIVIA_MEDIA)).toBe(TRIVIA_MEDIA);
  });

  it('backgroundMedia שונה מתמונת השאלה → משמש כרקע ספציפי', () => {
    const slide = slideWith({
      questionSrc: 'https://cdn/q-image.jpg',
      backgroundSrc: 'https://cdn/real-bg.mp4',
    });
    expect(slideBackgroundSrc(slide, TRIVIA_MEDIA)).toBe('https://cdn/real-bg.mp4');
  });

  it('בלי רקע ספציפי — רקע השאלות הכללי', () => {
    const slide = slideWith({ questionSrc: 'https://cdn/q-image.jpg' });
    expect(slideBackgroundSrc(slide, TRIVIA_MEDIA)).toBe(TRIVIA_MEDIA);
  });

  it('slidBackgroundMedia זהה לתמונת השאלה → מתעלמים', () => {
    const image = 'https://cdn/q-image.jpg';
    const slide = slideWith({ questionSrc: image, slidBackgroundSrc: image });
    expect(slideBackgroundSrc(slide, TRIVIA_MEDIA)).toBe(TRIVIA_MEDIA);
  });
});
