/**
 * שקופית שאלה: trivia / survey / ans_images (SPEC סעיף 9), בזרימת חשיפה
 * מדורגת בשליטת המנחה: קודם השאלה, אחר כך כל תשובה בלחיצה, ההצבעה נפתחת עם
 * חשיפת התשובה האחרונה, ובסוף — חשיפת התשובה הנכונה בלחיצה נפרדת.
 */

import type { GameState, Slide } from '../engine/index.ts';
import { TimerRing, type TimerView } from './TimerRing.tsx';

export interface RevealState {
  /** השאלה נחשפה (שלב 2 במחזור). */
  questionShown: boolean;
  /** כמה תשובות נחשפו (לפי סדר המערך). */
  answersShown: number;
  /** התשובה הנכונה נחשפה (אחרי סגירת ההצבעה). */
  revealCorrect: boolean;
}

interface QuestionSlideProps {
  slide: Slide;
  state: GameState;
  ansIsNumber: boolean;
  timer: TimerView | null;
  reveal: RevealState;
}

export function QuestionSlide({ slide, state, ansIsNumber, timer, reveal }: QuestionSlideProps) {
  const isResults = state.phase === 'results';
  const isImages = slide.type === 'ans_images';
  const answers = slide.question.answers;
  const counts = state.liveVotes?.counts ?? {};
  const total = state.liveVotes?.total ?? 0;
  const showBars = state.phase === 'voting' || isResults;

  return (
    <div className="question-slide">
      <header className={`question-header${reveal.questionShown ? '' : ' reveal-hidden'}`}>
        <h1 className="question-text">{slide.question.que}</h1>
        {slide.question.src !== '' && (
          <img className="question-image" src={slide.question.src} alt="" />
        )}
      </header>

      {state.phase === 'voting' && timer && <TimerRing {...timer} />}

      <ul className={`answers ${isImages ? 'answers--images' : ''} answers--${answers.length}`}>
        {answers.map((answer, index) => {
          const revealed = index < reveal.answersShown;
          const count = counts[String(answer.id)] ?? 0;
          const percent = total > 0 ? Math.round((count / total) * 100) : 0;
          const highlight = isResults && reveal.revealCorrect && answer.correct;
          const dimmed =
            isResults && reveal.revealCorrect && slide.type === 'trivia' && !answer.correct;
          return (
            <li
              key={answer.id}
              className={`answer${revealed ? '' : ' reveal-hidden'}${highlight ? ' answer--correct' : ''}${dimmed ? ' answer--dimmed' : ''}`}
            >
              {ansIsNumber && <span className="answer-number">{answer.id}</span>}
              {isImages ? (
                <img className="answer-image" src={answer.ans} alt={`תשובה ${answer.id}`} />
              ) : (
                <span className="answer-text">{answer.ans}</span>
              )}
              {showBars && (
                <span className="answer-bar-wrap">
                  <span className="answer-bar" style={{ width: `${percent}%` }} />
                  <span className="answer-percent">{percent}%</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {showBars && <footer className="votes-total">{total} הצבעות</footer>}
    </div>
  );
}
