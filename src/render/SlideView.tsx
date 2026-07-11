/**
 * תצוגת השקופית הנוכחית: מדיה חוסמת (openMedia/endMedia) במסך מלא,
 * רקע שכבתי (backgroundMedia / slidBackgroundMedia / triviaMedia),
 * ותוכן לפי סוג השקופית.
 */

import { isVotableSlide, type GameEngine, type GameState, type Slide } from '../engine/index.ts';
import { MediaPlayer } from './MediaPlayer.tsx';
import { QuestionSlide, type RailPlayer, type RevealState } from './QuestionSlide.tsx';
import { SubjectSlide } from './SubjectSlide.tsx';
import type { TimerView } from './TimerRing.tsx';

interface SlideViewProps {
  engine: GameEngine;
  state: GameState;
  timer: TimerView | null;
  reveal: RevealState;
  /** מסילת המצטרפים — עונים אחרונים (שכבר עברו רזולוציה לשם). */
  players: RailPlayer[];
}

/**
 * רקע השקופית. תמונת השאלה (question.src) אינה רקע — בחלק מהקבצים
 * backgroundMedia מצביע לאותה תמונה; במקרה כזה מתעלמים ממנה ונופלים
 * לרקע הרגיל (triviaMedia). רקע ספציפי אמיתי הוא ערך שונה מתמונת השאלה.
 */
export function slideBackgroundSrc(slide: Slide, triviaMedia: string): string {
  const questionImage = slide.question.src;
  const isNotQuestionImage = (src: string) => src !== '' && src !== questionImage;

  if (isNotQuestionImage(slide.backgroundMedia.src)) return slide.backgroundMedia.src;
  if (isNotQuestionImage(slide.setting.slidBackgroundMedia.src)) {
    return slide.setting.slidBackgroundMedia.src;
  }
  const votable = slide.type === 'trivia' || slide.type === 'survey' || slide.type === 'ans_images';
  if (votable) return triviaMedia;
  return '';
}

export function SlideView({ engine, state, timer, reveal, players }: SlideViewProps) {
  const slide = engine.getCurrentSlide();

  // מדיה חוסמת — מסך מלא. מנוגנת אוטומטית; המעבר ממנה הוא ידני (רווח/0),
  // ולכן אין onEnded שמדלג אוטומטית ומשאיר מסך ריק.
  if (state.activeMedia !== null) {
    const src = state.activeMedia === 'open' ? slide.openMedia.src : slide.endMedia.src;
    return (
      <div className="screen slide-media-screen">
        <MediaPlayer src={src} />
      </div>
    );
  }

  const background = slideBackgroundSrc(slide, engine.getGame().setting.triviaMedia.src);
  const votableSlides = engine.getGame().questions.filter(isVotableSlide);

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
          // שקופית מדיה בלי מדיה פעילה — מצב חולף בלבד (רקע נקי, בלי טקסט)
          <span aria-hidden="true" />
        ) : (
          <QuestionSlide
            slide={slide}
            state={state}
            ansIsNumber={engine.getGame().setting.ansIsNumber}
            timer={timer}
            reveal={reveal}
            questionNumber={votableSlides.findIndex((s) => s.id === slide.id) + 1}
            questionTotal={votableSlides.length}
            players={players}
          />
        )}
      </div>
    </div>
  );
}
