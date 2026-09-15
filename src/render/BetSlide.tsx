/**
 * שקופית הימור (type: "bet") — אותה במה של שקופית שאלה, עם משמעות אחרת:
 * הכרטיסים הם אפשרויות ההימור על השאלה המנוקדת הבאה, ולא תשובות.
 *
 * הזרימה זהה לשאלה (המנחה חושף את ההנחיה, את הכרטיסים אחד-אחד, פותח את
 * ההצבעה עם הטיימר וסוגר), ובחשיפה — במקום תשובה נכונה — מוצג פילוח
 * ההימורים בדיוק כמו בסקר (עוגה + כמה מהמרים על כל כרטיס), כמה נקודות על
 * הכף ומי המהמרים הגדולים. אין כאן כרטיס "נכון" או "מנצח": כל משתתף מהמר על
 * הכרטיס שהוא עצמו בחר, ולכן שום כרטיס אינו מודגש. ההכרעה עצמה מוצגת אחרי
 * חשיפת התשובה בשאלה הבאה (BetResultsOverlay).
 */

import type { CSSProperties } from 'react';
import {
  betConfigOf,
  betOptionFor,
  betSummary,
  describeBetOption,
  type GameState,
  type Slide,
} from '../engine/index.ts';
import { slideGroupRestriction } from '../app/groupRestriction.ts';
import { FitText } from './FitText.tsx';
import { displayText } from './multiline.ts';
import { ANSWER_LETTERS, COIN_COLORS, Flyers, SurveyPie, type RailPlayer, type RevealState } from './QuestionSlide.tsx';
import type { TimerView } from './TimerRing.tsx';

/** ההנחיה כשהמחבר השאיר את הנוסח ריק. */
export const DEFAULT_BET_PROMPT = 'על כמה מהנקודות שלכם אתם מהמרים?';

interface BetSlideProps {
  slide: Slide;
  state: GameState;
  ansIsNumber: boolean;
  timer: TimerView | null;
  reveal: RevealState;
  players: RailPlayer[];
  title: string;
  logo: string;
  nameOf: (voterId: string) => string;
  gameType?: string;
}

export function BetSlide({
  slide,
  state,
  ansIsNumber,
  timer,
  reveal,
  players,
  title,
  logo,
  nameOf,
  gameType = 'classic',
}: BetSlideProps) {
  const config = betConfigOf(slide) ?? { options: [], payout: 1, allowNegative: false };
  const answers = slide.question.answers;
  const isVoting = state.phase === 'voting';
  const revealed = reveal.revealCorrect;
  const counts = state.liveVotes?.counts ?? {};
  const total = state.liveVotes?.total ?? 0;
  const liveCounts = isVoting && slide.setting.liveVoteCounts;
  const stakes = state.betStakes[slide.id];
  const summary = revealed && stakes !== undefined ? betSummary(stakes, 3) : null;
  const restrictedGroup = slideGroupRestriction(slide, gameType);
  const low = timer !== null && !timer.paused && timer.remaining <= 5;
  const timerFrac = timer && timer.total > 0 ? Math.max(0, timer.remaining / timer.total) : 1;
  const ansRows = Math.max(1, Math.ceil(answers.length / 2));
  const answersGridVars = { '--ans-rows': ansRows } as CSSProperties;
  const prompt = slide.question.que.trim() === '' ? DEFAULT_BET_PROMPT : slide.question.que;

  return (
    <div className="q-screen bet-screen">
      <div className="q-content">
        <div className="q-header">
          <div className="q-hud-left">
            <div className="q-answered-pill">
              <span className="q-answered-dot" />
              <span className="q-answered-num">{total}</span>
              <span className="q-answered-label">הימרו</span>
            </div>
          </div>
          <div className="q-header-center">
            {logo !== '' && (
              <div className="q-logo">
                <img src={logo} alt="" />
              </div>
            )}
            {title !== '' && <div className="q-title-pill">{title}</div>}
            <div className="q-mode-pill q-mode-pill--bet">🎲 הימור — חל על השאלה הבאה</div>
            {restrictedGroup !== null && (
              <div className="q-group-pill">🔒 הימור לקבוצת {restrictedGroup} בלבד</div>
            )}
          </div>
        </div>

        <div className="q-main">
          {isVoting && (
            <div className="q-countdown">
              <div className={`q-count-num${low ? ' q-count-num--low' : ''}`}>
                {timer?.paused ? '⏸' : Math.max(0, Math.ceil(timer?.remaining ?? 0))}
              </div>
              <div className={`q-count-track${low ? ' q-count-track--low' : ''}`}>
                <div className="q-count-fill" style={{ width: `${timerFrac * 100}%` }} />
              </div>
            </div>
          )}

          <div className={`q-question${reveal.questionShown ? '' : ' reveal-hidden'}`}>
            <div className="q-question-row">
              <span className="bet-dice" aria-hidden="true">
                🎲
              </span>
              <FitText className="q-question-text" min={13}>
                {displayText(prompt)}
              </FitText>
            </div>
          </div>

          {revealed ? (
            // בחשיפה — הפילוח, כמו בסקר: כמה מהמרים על כל כרטיס. בלי כרטיס
            // מודגש, כי אין כאן תשובה נכונה — ההימור של כל אחד הוא מה שבחר.
            <SurveyPie answers={answers} counts={counts} total={total} />
          ) : (
          <ul className="q-answers bet-answers" style={answersGridVars}>
            {answers.map((answer, index) => {
              const shown = index < reveal.answersShown;
              const count = counts[String(answer.id)] ?? 0;
              const percent = total > 0 ? Math.round((count / total) * 100) : 0;
              const coin = COIN_COLORS[index] ?? COIN_COLORS[0]!;
              const label = ansIsNumber ? answer.id : ANSWER_LETTERS[index] ?? answer.id;
              const option = betOptionFor(config, answer.id);
              const sub = describeBetOption(option, config);
              const isNone = option === null || option.kind === 'none';
              return (
                <li
                  key={answer.id}
                  className={`q-card bet-card${shown ? '' : ' reveal-hidden'}${isNone ? ' bet-card--none' : ''}`}
                >
                  <span className="q-coin" style={{ background: coin.bg, color: coin.fg }}>
                    {label}
                  </span>
                  <span className="bet-card-body">
                    <FitText className="q-card-text bet-card-text" min={11}>
                      {displayText(answer.ans)}
                    </FitText>
                    {sub !== '' && <span className="bet-card-sub">{sub}</span>}
                  </span>
                  {liveCounts && (
                    <span className="q-live" dir="ltr">
                      <b>{count}</b>
                      <small>{percent}%</small>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          )}
        </div>

        <div className={`q-footer${summary !== null ? ' q-footer--bet' : ''}`}>
          {summary !== null ? (
            <div className="bet-summary">
              <div className="bet-summary-total">
                <span className="bet-summary-num" dir="ltr">
                  {summary.total.toLocaleString('en-US')}
                </span>
                <span className="bet-summary-lbl">נק׳ על הכף · {summary.bettors} מהמרים</span>
              </div>
              {summary.top.length > 0 && (
                <ol className="bet-summary-top">
                  {summary.top.map((t, i) => (
                    <li key={t.voterId} className="bet-summary-chip" style={{ animationDelay: `${i * 0.12}s` }}>
                      <span className="bet-summary-rank">{['🥇', '🥈', '🥉'][i] ?? i + 1}</span>
                      <FitText className="bet-summary-name" min={12}>
                        {nameOf(t.voterId)}
                      </FitText>
                      <span className="bet-summary-stake" dir="ltr">
                        {t.stake.toLocaleString('en-US')}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : isVoting ? (
            <div className="q-splitbar q-splitbar--bet">
              <div className="q-splitbar-text q-splitbar-text--center">
                {total > 0 ? `${total} כבר הימרו · מי שצודק בשאלה הבאה מכפיל, מי שטועה מאבד` : 'בחרו כמה אתם מהמרים…'}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <Flyers players={players} />
    </div>
  );
}
