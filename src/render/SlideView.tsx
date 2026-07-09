/**
 * תצוגת השקופית הנוכחית: מדיה חוסמת (openMedia/endMedia) במסך מלא,
 * רקע שכבתי (backgroundMedia / slidBackgroundMedia / triviaMedia),
 * ותוכן לפי סוג השקופית.
 */

import type { GameEngine, GameState, Slide } from '../engine/index.ts';
import { MediaPlayer } from './MediaPlayer.tsx';
import { QuestionSlide } from './QuestionSlide.tsx';
import { SubjectSlide } from './SubjectSlide.tsx';

interface SlideViewProps {
  engine: GameEngine;
  state: GameState;
  timer: { remaining: number; total: number } | null;
}

function backgroundSrc(slide: Slide, engine: GameEngine): string {
  if (slide.backgroundMedia.src !== '') return slide.backgroundMedia.src;
  if (slide.setting.slidBackgroundMedia.src !== '') return slide.setting.slidBackgroundMedia.src;
  const votable = slide.type === 'trivia' || slide.type === 'survey' || slide.type === 'ans_images';
  if (votable) return engine.getGame().setting.triviaMedia.src;
  return '';
}

export function SlideView({ engine, state, timer }: SlideViewProps) {
  const slide = engine.getCurrentSlide();

  // מדיה חוסמת — מסך מלא
  if (state.activeMedia !== null) {
    const src = state.activeMedia === 'open' ? slide.openMedia.src : slide.endMedia.src;
    return (
      <div className="screen slide-media-screen">
        <MediaPlayer src={src} onEnded={() => engine.dispatch({ type: 'MEDIA_ENDED', at: Date.now() })} />
      </div>
    );
  }

  const background = backgroundSrc(slide, engine);

  return (
    <div className="screen slide-screen">
      {background !== '' && (
        <div className="screen-background">
          <MediaPlayer src={background} asBackground />
        </div>
      )}
      <div className="screen-content slide-content">
        {slide.type === 'subject' ? (
          <SubjectSlide slide={slide} command={state.subjectCommand} />
        ) : slide.type === 'media' ? (
          <div className="subject-slide">
            <p className="subject-text subject-text--muted">
              {/* מדיה שהסתיימה/דולגה — ממתין למפעיל */}
              ⏸ ממתין להמשך...
            </p>
          </div>
        ) : (
          <QuestionSlide
            slide={slide}
            state={state}
            ansIsNumber={engine.getGame().setting.ansIsNumber}
            timer={timer}
          />
        )}
      </div>
    </div>
  );
}
