/**
 * מסך פירוט הצבעות השחקנים על שקופית (פקודת מנחה 5, בשלב חשיפת התשובה).
 * מחולק לפי התשובות: כל תשובה בעמודה משלה, עם התג/צבע שלה (כמו במסך השאלה),
 * טקסט/תמונה, אחוז וכמות, ומתחתיה רשימת השמות של מי שהצביע עליה. עובד לטריוויה
 * (עם סימון התשובה הנכונה), סקר, ותשובות-תמונה (ans_images).
 */

import type { Slide } from '../engine/index.ts';
import { ANSWER_LETTERS, COIN_COLORS } from './QuestionSlide.tsx';
import { FitText } from './FitText.tsx';

interface VotesBreakdownProps {
  slide: Slide;
  /** ההצבעות הסופיות של השקופית: voterId → answerId. */
  votes: Record<string, number>;
  /** שם להצגה של מצביע (מרשם/שרת/מספר). */
  nameOf: (voterId: string) => string;
  /** תגי מספר (1,2,3…) או אותיות (A,B,C…) — לפי ansIsNumber שבקובץ. */
  ansIsNumber: boolean;
  onClose: () => void;
}

/** מקסימום שמות שמוצגים לכל תשובה לפני "ועוד N" — כדי לא לגלוש מהמסך. */
const MAX_NAMES_PER_ANSWER = 80;

export function VotesBreakdown({ slide, votes, nameOf, ansIsNumber, onClose }: VotesBreakdownProps) {
  const isTrivia = slide.type === 'trivia';
  const isImages = slide.type === 'ans_images';
  const total = Object.keys(votes).length;

  // קיבוץ המצביעים לפי answerId, ממוין לפי שם.
  const votersByAnswer = new Map<number, string[]>();
  for (const [voterId, answerId] of Object.entries(votes)) {
    const list = votersByAnswer.get(answerId) ?? [];
    list.push(nameOf(voterId));
    votersByAnswer.set(answerId, list);
  }
  for (const list of votersByAnswer.values()) {
    list.sort((a, b) => a.localeCompare(b, 'he'));
  }

  return (
    <div className="votes-overlay" onClick={onClose}>
      <div className="votes-panel" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="votes-head">
          <h2 className="votes-title">
            <FitText className="votes-question">{slide.question.que || 'הצבעות השחקנים'}</FitText>
          </h2>
          <span className="votes-total">{total} הצבעות</span>
          <button className="votes-close" title="סגירה (5)" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className={`votes-cols${isImages ? ' votes-cols--images' : ''}`}>
          {slide.question.answers.map((answer, index) => {
            const voters = votersByAnswer.get(answer.id) ?? [];
            const count = voters.length;
            const percent = total > 0 ? Math.round((count / total) * 100) : 0;
            const coin = COIN_COLORS[index] ?? COIN_COLORS[0]!;
            const label = ansIsNumber ? answer.id : (ANSWER_LETTERS[index] ?? answer.id);
            const correct = isTrivia && answer.correct;
            const shown = voters.slice(0, MAX_NAMES_PER_ANSWER);
            const extra = count - shown.length;
            return (
              <section
                key={answer.id}
                className={`votes-col${correct ? ' votes-col--correct' : ''}`}
              >
                <header className="votes-col-head">
                  <span className="votes-coin" style={{ background: coin.bg, color: coin.fg }}>
                    {label}
                  </span>
                  {isImages ? (
                    <img className="votes-col-image" src={answer.ans} alt={`תשובה ${answer.id}`} />
                  ) : (
                    <FitText className="votes-col-text">{answer.ans}</FitText>
                  )}
                  {correct && <span className="votes-correct-mark">✓ נכונה</span>}
                  <span className="votes-col-count">
                    {count} · {percent}%
                  </span>
                </header>
                <ul className="votes-names">
                  {shown.map((name, i) => (
                    <li key={`${name}-${i}`} className="votes-name">
                      {name}
                    </li>
                  ))}
                  {extra > 0 && <li className="votes-name votes-name--more">ועוד {extra}…</li>}
                  {count === 0 && <li className="votes-name votes-name--empty">—</li>}
                </ul>
              </section>
            );
          })}
        </div>

        <div className="votes-foot">מקש 5 לסגירה · הצבעה אחת לכל משתתף</div>
      </div>
    </div>
  );
}
