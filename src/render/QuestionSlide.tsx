/**
 * שקופית שאלה — עיצוב מסך הטריוויה החי (hifi, לפי triviascreen_1.html).
 *
 * מבנה: כותרת עליונה (לוגו + שם המשחק במרכז · מונה שאלה מימין · מונה עונים
 * משמאל) · אזור ראשי (ספירה-לאחור + כרטיס שאלה + גריד תשובות עם "מטבעות") ·
 * כותרת תחתית (פס טיימר דו-גוני בזמן ההצבעה → פס מובילים בחשיפה) · אווטרים
 * שמתעופפים בכל תשובה שנכנסת.
 *
 * הזרימה בשליטת המנחה: השאלה נחשפת, אחר כך התשובות אחת-אחת, ההצבעה נפתחת
 * עם הטיימר, ובחשיפה נפרדת נחשפת התשובה הנכונה + האחוזים בתוך המטבעות.
 *
 * צבעי המסך (רקע/כרטיסים/כותרת) מגיעים מ-mainColor/secondaryColor שבקובץ
 * המשחק. צבעי המטבעות (A ירוק, B אדום, C לבן, D זהב, E כחול, F כתום) קבועים
 * ומייצגים את כפתורי השלט — אינם מושפעים מהערכה.
 */

import { useEffect, useRef, useState } from 'react';
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

/** שחקן במסילה/מובילים/אווטר — כבר עבר רזולוציה לשם דרך המרשם. */
export interface RailPlayer {
  id: string;
  name: string;
  initial: string;
  color: string;
}

/** תגי התשובות כשאינן מספרים — אותיות לטיניות A, B, C, D… (לפי ansIsNumber ב-JSON). */
const ANSWER_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/** צבעי המטבעות הקבועים — מייצגים את כפתורי השלט (רקע + צבע טקסט). */
const COIN_COLORS = [
  { bg: '#38B24A', fg: '#0b2b16' }, // A ירוק
  { bg: '#E23B3B', fg: '#ffffff' }, // B אדום
  { bg: '#F5F5F5', fg: '#111827' }, // C לבן
  { bg: '#F5C518', fg: '#3a2c05' }, // D זהב
  { bg: '#3B82F6', fg: '#ffffff' }, // E כחול
  { bg: '#F97316', fg: '#3a1a02' }, // F כתום
];

const STAR_PATH = 'M12 2l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.8 5.9 21l1.2-6.6L2.3 9.8l6.6-.9z';

interface QuestionSlideProps {
  slide: Slide;
  state: GameState;
  ansIsNumber: boolean;
  timer: TimerView | null;
  reveal: RevealState;
  /** מספר השאלה מתוך סך השאלות (שקופיות המצביעות), לתצוגת הכותרת. */
  questionNumber: number;
  questionTotal: number;
  /** עונים אחרונים (החדש ראשון) — מזינים את האווטרים המתעופפים. */
  players: RailPlayer[];
  /** חמשת הראשונים שענו נכונה על השקופית (המהיר ראשון) — לפס המובילים בחשיפה. */
  leaders: RailPlayer[];
  /** שם המשחק לכל אורכו (setting.titleThroughoutGame). */
  title: string;
  /** לוגו המשחק (setting.logo) — עיגול בכותרת; ריק ⇐ מוסתר. */
  logo: string;
}

/** אווטרים שמתעופפים כלפי מעלה בכל תשובה חדשה שנכנסת. */
function Flyers({ players }: { players: RailPlayer[] }) {
  interface Flyer {
    key: number;
    name: string;
    initial: string;
    color: string;
    left: number;
    variant: number;
  }
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const keyRef = useRef(0);

  useEffect(() => {
    if (players.length === 0) {
      seenRef.current = new Set(); // מעבר שקופית — איפוס
      return;
    }
    const fresh = players.filter((p) => !seenRef.current.has(p.id));
    if (fresh.length === 0) return;
    fresh.forEach((p) => seenRef.current.add(p.id));
    const additions = fresh.map((p) => ({
      key: (keyRef.current += 1),
      name: p.name,
      initial: p.initial,
      color: p.color,
      // מרוכזים בפס השמאלי; השמות נפתחים לתוך שטח פנוי (overflow גלוי) בלי חיתוך
      left: 14 + Math.floor(Math.random() * 260),
      variant: Math.floor(Math.random() * 3),
    }));
    setFlyers((prev) => [...prev, ...additions]);
  }, [players]);

  const remove = (key: number) => setFlyers((prev) => prev.filter((f) => f.key !== key));

  return (
    <div className="q-flyers">
      {flyers.map((f) => (
        <div
          key={f.key}
          className={`q-flyer q-flyer--${f.variant}`}
          style={{ left: `${f.left}px` }}
          onAnimationEnd={() => remove(f.key)}
        >
          <span className="q-flyer-av" style={{ background: f.color }}>
            {f.initial}
          </span>
          <span className="q-flyer-nm">{f.name}</span>
        </div>
      ))}
    </div>
  );
}

/** פס המובילים בחשיפה — עמודות עם כוכבים ושם השחקן. */
function Leaderboard({ leaders }: { leaders: RailPlayer[] }) {
  return (
    <div className="q-board">
      {leaders.map((leader, index) => (
        <div key={leader.id} className="q-board-item" style={{ animationDelay: `${index * 0.08}s` }}>
          <div className="q-board-stars">
            {[26, 34, 26].map((size, si) => (
              <svg key={si} width={size} height={size} viewBox="0 0 24 24" fill="#F5C518" stroke="#a9760a" strokeWidth="1">
                <path d={STAR_PATH} />
              </svg>
            ))}
          </div>
          <div className="q-board-name">{leader.name}</div>
        </div>
      ))}
    </div>
  );
}

/** סימון קטן של עוגת סקר (תלת-מימדי) — ליד השאלה בשקופית סקר. */
function SurveyIcon() {
  return <span className="q-survey-icon" title="שאלת סקר" aria-label="סקר" />;
}

/** פילוח סקר בחשיפה — עוגה צבועה לפי צבעי התשובות + מקראה עם מספר העונים. */
function SurveyPie({
  answers,
  counts,
  total,
}: {
  answers: Slide['question']['answers'];
  counts: Record<string, number>;
  total: number;
}) {
  let acc = 0;
  const segments = answers.map((answer, index) => {
    const value = counts[String(answer.id)] ?? 0;
    const pct = total > 0 ? (value / total) * 100 : 0;
    const from = acc;
    acc += pct;
    return {
      id: answer.id,
      text: answer.ans,
      color: COIN_COLORS[index % COIN_COLORS.length]!.bg,
      value,
      pct: Math.round(pct),
      from,
      to: acc,
    };
  });
  const gradient =
    total > 0
      ? `conic-gradient(${segments.map((s) => `${s.color} ${s.from}% ${s.to}%`).join(', ')})`
      : 'conic-gradient(rgba(255, 255, 255, 0.18) 0% 100%)';
  return (
    <div className="q-survey">
      <div className="q-survey-pie-wrap">
        <div className="q-survey-pie" style={{ background: gradient }} />
      </div>
      <ul className="q-survey-legend">
        {segments.map((s) => (
          <li key={s.id} className="q-survey-legend-item">
            <span className="q-survey-swatch" style={{ background: s.color }} />
            <span className="q-survey-ans">{s.text}</span>
            <span className="q-survey-val">
              {s.pct}% · {s.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
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
  leaders,
  title,
  logo,
}: QuestionSlideProps) {
  const isResults = state.phase === 'results';
  const isVoting = state.phase === 'voting';
  const isTrivia = slide.type === 'trivia';
  const isImages = slide.type === 'ans_images';
  const isSurvey = slide.type === 'survey';
  const answers = slide.question.answers;
  const counts = state.liveVotes?.counts ?? {};
  const total = state.liveVotes?.total ?? 0;

  // אחוזים בתוך המטבעות: בחשיפת התשובה הנכונה (trivia) או בתוצאות (סקר/תמונות).
  const revealed = reveal.revealCorrect || (isResults && !isTrivia);
  // פס מובילים מוצג רק ב-trivia אחרי חשיפת התשובה הנכונה.
  const showBoard = reveal.revealCorrect && isTrivia && leaders.length > 0;

  const hasImage = slide.question.src !== '';
  const low = timer !== null && !timer.paused && timer.remaining <= 5;
  // שבר הטיימר — נותר/סה"כ, מדויק לפי השניות (מתעדכן כל 200ms מ-GameHost).
  const timerFrac = timer && timer.total > 0 ? Math.max(0, timer.remaining / timer.total) : 1;

  // אחוז שענו נכון (מתוך מי שענה) — לפס הירוק/אדום החי בתחתית, בזמן ההצבעה.
  const correctCount = answers
    .filter((a) => a.correct)
    .reduce((sum, a) => sum + (counts[String(a.id)] ?? 0), 0);
  const correctPct = total > 0 ? Math.round((correctCount / total) * 100) : 0;

  return (
    <div className="q-screen">
      <div className="q-content">
        {/* כותרת */}
        <div className="q-header">
          <div className="q-hud-left">
            <div className="q-answered-pill">
              <span className="q-answered-dot" />
              <span className="q-answered-num">{total}</span>
              <span className="q-answered-label">ענו</span>
            </div>
          </div>

          <div className="q-header-center">
            {logo !== '' && (
              <div className="q-logo">
                <img src={logo} alt="" />
              </div>
            )}
            {title !== '' && <div className="q-title-pill">{title}</div>}
          </div>

          <div className="q-hud-right">
            <div className="q-counter" dir="ltr">
              <span>{questionNumber}</span>
              <span className="q-counter-sep">/</span>
              <span>{questionTotal}</span>
            </div>
          </div>
        </div>

        {/* תמונת השאלה — כרטיס ממוסגר בצד המסך (מעוגן ל-q-content, לא לבועת
            השאלה שיש לה transform). מוצגת יחד עם השאלה. */}
        {hasImage && (
          <div className={`q-question-image${reveal.questionShown ? '' : ' reveal-hidden'}`}>
            <img src={slide.question.src} alt="" />
          </div>
        )}

        {/* אזור ראשי */}
        <div className="q-main">
          {/* ספירה לאחור — רק בזמן ההצבעה: עיגול השניות + פס הטיימר שאוזל
              במדויק לפי הזמן שנותר (צבע ראשי/משני). */}
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
              {isSurvey && <SurveyIcon />}
              <h1>{slide.question.que}</h1>
            </div>
          </div>

          {isSurvey && revealed ? (
            <SurveyPie answers={answers} counts={counts} total={total} />
          ) : (
          <ul className={`q-answers${isImages ? ' q-answers--images' : ''}`}>
            {answers.map((answer, index) => {
              const shown = index < reveal.answersShown;
              const count = counts[String(answer.id)] ?? 0;
              const percent = total > 0 ? Math.round((count / total) * 100) : 0;
              const correct = revealed && isTrivia && answer.correct;
              const dim = revealed && isTrivia && !answer.correct;
              const coin = COIN_COLORS[index] ?? COIN_COLORS[0]!;
              const label = ansIsNumber ? answer.id : ANSWER_LETTERS[index] ?? answer.id;
              return (
                <li
                  key={answer.id}
                  className={`q-card${shown ? '' : ' reveal-hidden'}${correct ? ' q-card--correct' : ''}${dim ? ' q-card--dim' : ''}`}
                >
                  <span
                    className={`q-coin${revealed ? ' q-coin--reveal' : ''}`}
                    style={{ background: coin.bg, color: coin.fg }}
                  >
                    {revealed ? `${percent}%` : label}
                  </span>
                  {isImages ? (
                    <img className="q-card-image" src={answer.ans} alt={`תשובה ${answer.id}`} />
                  ) : (
                    <span className="q-card-text">{answer.ans}</span>
                  )}
                </li>
              );
            })}
          </ul>
          )}
        </div>

        {/* כותרת תחתית — פס צדקו/טעו (ירוק/אדום קבוע) חי בזמן ההצבעה, מובילים בחשיפה */}
        <div className={`q-footer${showBoard ? ' q-footer--board' : ''}`}>
          {showBoard ? (
            <Leaderboard leaders={leaders} />
          ) : isVoting && isTrivia ? (
            <div className="q-splitbar">
              {total > 0 ? (
                <>
                  <div className="q-splitbar-correct" style={{ width: `${correctPct}%` }} />
                  <div className="q-splitbar-text">
                    <span>{correctPct}% צדקו</span>
                    <span>{100 - correctPct}% טעו</span>
                  </div>
                </>
              ) : (
                <div className="q-splitbar-text q-splitbar-text--center">ממתינים לתשובות…</div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* אווטרים מתעופפים */}
      <Flyers players={players} />
    </div>
  );
}
