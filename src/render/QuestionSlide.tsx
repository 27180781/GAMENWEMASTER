/**
 * שקופית שאלה: trivia / survey / ans_images (SPEC סעיף 9).
 * ברים של התפלגות ההצבעות מתעדכנים חלק; ב-results של trivia — הדגשת
 * התשובה הנכונה; ans_images — גריד תמונות עם מספר גדול (ansIsNumber).
 */

import type { GameState, Slide } from '../engine/index.ts';
import { TimerRing } from './TimerRing.tsx';

interface QuestionSlideProps {
  slide: Slide;
  state: GameState;
  ansIsNumber: boolean;
  timer: { remaining: number; total: number } | null;
}

export function QuestionSlide({ slide, state, ansIsNumber, timer }: QuestionSlideProps) {
  const isResults = state.phase === 'results';
  const isImages = slide.type === 'ans_images';
  const answers = slide.question.answers;
  const counts = state.liveVotes?.counts ?? {};
  const total = state.liveVotes?.total ?? 0;

  return (
    <div className="question-slide">
      <header className="question-header">
        <h1 className="question-text">{slide.question.que}</h1>
        {slide.question.src !== '' && (
          <img className="question-image" src={slide.question.src} alt="" />
        )}
      </header>

      {state.phase === 'voting' && timer && (
        <TimerRing remaining={timer.remaining} total={timer.total} />
      )}

      <ul className={`answers ${isImages ? 'answers--images' : ''} answers--${answers.length}`}>
        {answers.map((answer) => {
          const count = counts[String(answer.id)] ?? 0;
          const percent = total > 0 ? Math.round((count / total) * 100) : 0;
          const highlight = isResults && slide.type === 'trivia' && answer.correct;
          const dimmed = isResults && slide.type === 'trivia' && !answer.correct;
          return (
            <li
              key={answer.id}
              className={`answer${highlight ? ' answer--correct' : ''}${dimmed ? ' answer--dimmed' : ''}`}
            >
              {ansIsNumber && <span className="answer-number">{answer.id}</span>}
              {isImages ? (
                <img className="answer-image" src={answer.ans} alt={`תשובה ${answer.id}`} />
              ) : (
                <span className="answer-text">{answer.ans}</span>
              )}
              {(state.phase === 'voting' || isResults) && (
                <span className="answer-bar-wrap">
                  <span className="answer-bar" style={{ width: `${percent}%` }} />
                  <span className="answer-percent">{percent}%</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {(state.phase === 'voting' || isResults) && (
        <footer className="votes-total">{total} הצבעות</footer>
      )}
    </div>
  );
}
