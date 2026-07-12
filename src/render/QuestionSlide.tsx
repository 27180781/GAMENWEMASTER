/**
 * שקופית שאלה — עיצוב מסך הטריוויה החי (hifi).
 *
 * מבנה: עמודה ראשית (HUD: מונה שאלה + מונה עונים · פס טיימר · כרטיס שאלה ·
 * גריד תשובות · פס "צדקו/טעו") ולצדה מסילת שחקנים ("מצטרפים").
 *
 * הזרימה נשארת בשליטת המנחה (SPEC): השאלה נחשפת, אחר כך התשובות אחת-אחת,
 * ההצבעה נפתחת עם הטיימר, והתשובה הנכונה + אחוזי התשובות נחשפים בלחיצה נפרדת —
 * אחוזי-התשובות מוצגים רק בחשיפה. הצבעים (רקע התיבות + הטקסט) מגיעים מקובץ המשחק.
 *
 * פס "צדקו/טעו" (אדום/לבן) מופיע רק בזמן ההצבעה (כל עוד הטיימר רץ) וזז בלייב
 * ככל שמגיעות תשובות; עם חשיפת התשובה הנכונה הוא נעלם.
 */

import type { GameState, Slide } from '../engine/index.ts';
import type { TimerView } from './TimerRing.tsx';

export interface RevealState {
  /** השאלה נחשפה (שלב 2 במחזור). */
  questionShown: boolean;
  /** כמה תשובות נחשפו (לפי סדר המערך). */
  answersShown: number;
  /** התשובה הנכונה נחשפה (אחרי סגירת ההצבעה). */
  revealCorrect: boolean;
}

/** שחקן במסילת "מצטרפים" — כבר עבר רזולוציה לשם דרך המרשם. */
export interface RailPlayer {
  id: string;
  name: string;
  initial: string;
  color: string;
}

const HEB_LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];

interface QuestionSlideProps {
  slide: Slide;
  state: GameState;
  ansIsNumber: boolean;
  timer: TimerView | null;
  reveal: RevealState;
  /** מספר השאלה מתוך סך השאלות (שקופיות המצביעות), לתצוגת ה-HUD. */
  questionNumber: number;
  questionTotal: number;
  /** מסילת המצטרפים — עונים אחרונים, החדש ראשון. */
  players: RailPlayer[];
}

export function QuestionSlide({
  slide,
  state,
  ansIsNumber,
  timer,
  reveal,
  questionNumber,
  questionTotal,
  players,
}: QuestionSlideProps) {
  const isResults = state.phase === 'results';
  /** ההצבעה פתוחה והטיימר רץ — רק אז מוצג פס "צדקו/טעו" החי. */
  const votingLive = state.phase === 'voting';
  const isTrivia = slide.type === 'trivia';
  const isImages = slide.type === 'ans_images';
  const answers = slide.question.answers;
  const counts = state.liveVotes?.counts ?? {};
  const total = state.liveVotes?.total ?? 0;
  // התפלגות (אחוזים) מוצגת רק בחשיפת התשובה הנכונה (trivia); בסקר/תמונות —
  // בתוצאות (אין תשובה נכונה).
  const showDistribution = reveal.revealCorrect || (isResults && !isTrivia);

  const hasImage = slide.question.src !== '';
  const cols = answers.length >= 6 ? 3 : answers.length === 3 ? 3 : 2;

  // פס "צדקו/טעו" — רק ל-trivia; האחוז נחשף רק בחשיפת התשובה הנכונה.
  const correctCount = answers
    .filter((a) => a.correct)
    .reduce((sum, a) => sum + (counts[String(a.id)] ?? 0), 0);
  const correctPct = total > 0 ? Math.round((correctCount / total) * 100) : 0;

  const low = timer !== null && !timer.paused && timer.remaining <= 5;
  const timerFrac = timer && timer.total > 0 ? Math.max(0, timer.remaining / timer.total) : 0;

  return (
    <div className="q-screen">
      <div className="q-main">
        {/* HUD */}
        <div className="q-hud">
          <div className="q-pill q-pill--counter">
            <span className="q-pill-badge">?</span>
            <span className="q-pill-text">
              שאלה <b>{questionNumber}</b> / {questionTotal}
            </span>
          </div>
          <div className="q-pill q-pill--answered">
            <span className="q-answered-dot" />
            <span className="q-answered-num">{total}</span>
            <span className="q-answered-label">ענו</span>
          </div>
        </div>

        {/* פס טיימר */}
        {timer !== null && (
          <div className="q-timer">
            <div className="q-timer-track">
              <div
                className={`q-timer-fill${low ? ' q-timer-fill--low' : ''}`}
                style={{ width: `${timerFrac * 100}%` }}
              />
            </div>
            <div className={`q-timer-readout${low ? ' q-timer-readout--low' : ''}`}>
              {timer.paused ? '⏸' : Math.ceil(timer.remaining)}
            </div>
          </div>
        )}

        {/* כרטיס השאלה */}
        <div className={`q-card${hasImage ? ' q-card--with-image' : ''}${reveal.questionShown ? '' : ' reveal-hidden'}`}>
          <div className="q-card-text">{slide.question.que}</div>
          {hasImage && (
            <div className="q-card-image-box">
              <img className="q-card-image" src={slide.question.src} alt="" />
            </div>
          )}
        </div>

        {/* גריד התשובות */}
        <ul className={`q-answers q-answers--cols${cols}${isImages ? ' q-answers--images' : ''}`}>
          {answers.map((answer, index) => {
            const revealed = index < reveal.answersShown;
            const count = counts[String(answer.id)] ?? 0;
            const percent = total > 0 ? Math.round((count / total) * 100) : 0;
            const highlight = isResults && reveal.revealCorrect && answer.correct;
            const dimmed =
              isResults && reveal.revealCorrect && isTrivia && !answer.correct;
            const badge = ansIsNumber ? answer.id : HEB_LETTERS[index] ?? answer.id;
            return (
              <li
                key={answer.id}
                className={`q-answer${revealed ? '' : ' reveal-hidden'}${highlight ? ' q-answer--correct' : ''}${dimmed ? ' q-answer--dim' : ''}`}
              >
                <span
                  className={`q-answer-fill${highlight ? ' q-answer-fill--correct' : ''}`}
                  style={{ width: showDistribution ? `${percent}%` : '0%' }}
                />
                <span className="q-answer-badge">{badge}</span>
                {isImages ? (
                  <img className="q-answer-image" src={answer.ans} alt={`תשובה ${answer.id}`} />
                ) : (
                  <span className="q-answer-text">{answer.ans}</span>
                )}
                {showDistribution && (
                  <span className="q-answer-pct">
                    {highlight && <span className="q-answer-check">✓</span>}
                    <span>{percent}%</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {/* פס צדקו/טעו — trivia בלבד: מופיע וזז בלייב בזמן ההצבעה, ונעלם בחשיפת
            התשובה. המעטפת נשארת תמיד (שומרת גובה) כדי שהגריד לא יקפוץ. */}
        {isTrivia && (
          <div className={`q-split${votingLive && total === 0 ? ' q-split--waiting' : ''}`}>
            {votingLive && (
              <>
                <span className="q-split-label">
                  <span className="q-split-label-dot" />
                  בזמן אמת
                </span>
                <div className="q-split-bar">
                  {total > 0 ? (
                    <>
                      <div className="q-split-correct" style={{ width: `${correctPct}%` }} />
                      <div className="q-split-text">
                        <span>{correctPct}% צדקו</span>
                        <span>{100 - correctPct}% טעו</span>
                      </div>
                    </>
                  ) : (
                    <div className="q-split-text q-split-text--center">ממתינים לתשובות…</div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* מסילת מצטרפים */}
      <aside className="q-rail">
        <div className="q-rail-head">מצטרפים</div>
        <div className="q-rail-divider" />
        <div className="q-rail-list">
          {players.map((player) => (
            <div key={player.id} className="q-rail-chip">
              <span className="q-rail-avatar" style={{ background: player.color }}>
                {player.initial}
              </span>
              <span className="q-rail-name">{player.name}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
