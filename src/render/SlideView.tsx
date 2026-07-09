/**
 * תצוגת השקופית הנוכחית: מדיה חוסמת (openMedia/endMedia) במסך מלא,
 * רקע שכבתי (backgroundMedia / slidBackgroundMedia / triviaMedia),
 * ותוכן לפי סוג השקופית.
 */

import type { GameEngine, GameState, Slide } from '../engine/index.ts';
import { MediaPlayer } from './MediaPlayer.tsx';
import { QuestionSlide, type RevealState } from './QuestionSlide.tsx';
import { SubjectSlide } from './SubjectSlide.tsx';
import type { TimerView } from './TimerRing.tsx';

interface SlideViewProps {
  engine: GameEngine;
  state: GameState;
  timer: TimerView | null;
  reveal: RevealState;
}

function backgroundSrc(slide: Slide, engine: GameEngine): string {
  if (slide.backgroundMedia.src !== '') return slide.backgroundMedia.src;
  if (slide.setting.slidBackgroundMedia.src !== '') return slide.setting.slidBackgroundMedia.src;
  const votable = slide.type === 'trivia' || slide.type === 'survey' || slide.type === 'ans_images';
  if (votable) return engine.getGame().setting.triviaMedia.src;
  return '';
}

export function SlideView({ engine, state, timer, reveal }: SlideViewProps) {
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
          /* הקהל רואה רקע נקי; רמז עדין למפעיל בלבד בתחתית */
          <p className="media-standby-hint">
            {state.openMediaPlayed ? 'רווח — לשקופית הבאה' : 'רווח — ניגון המדיה'}
          </p>
        ) : (
          <QuestionSlide
            slide={slide}
            state={state}
            ansIsNumber={engine.getGame().setting.ansIsNumber}
            timer={timer}
            reveal={reveal}
          />
        )}
      </div>
    </div>
  );
}
