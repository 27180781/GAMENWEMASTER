/**
 * מסך "תוצאות ההימור" — עולה אחרי חשיפת התשובה הנכונה בשאלה שהכריעה הימור
 * (צעד נוסף ברווח, ראו GameHost). המשחק "עוצר" כל עוד המסך פתוח, ורווח סוגר
 * וממשיך. שתי עמודות: מי זכה (ירוק) ומי הפסיד (אדום), ספירות, וההימור הגדול.
 */

import { useEffect, useState } from 'react';
import { betOutcomeSummary, type BetOutcome } from '../engine/index.ts';
import { FitText } from './FitText.tsx';

interface BetResultsOverlayProps {
  outcomes: Readonly<Record<string, BetOutcome>>;
  nameOf: (voterId: string) => string;
  /** נוסח ההימור (הנחיית שקופית ההימור) — לכותרת. */
  title?: string;
  onClose: () => void;
}

/** כמה שמות מוצגים בכל עמודה; השאר מסוכמים בשורה אחת. */
const PER_COLUMN = 6;

/** מספר שנספר מאפס לערכו — הדרמה של "כמה זה יצא". */
function CountUp({ value, durationMs = 900 }: { value: number; durationMs?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return (
    <span dir="ltr">
      {sign}
      {Math.abs(shown).toLocaleString('en-US')}
    </span>
  );
}

export function BetResultsOverlay({ outcomes, nameOf, title = '', onClose }: BetResultsOverlayProps) {
  const s = betOutcomeSummary(outcomes);
  const winners = s.winners.slice(0, PER_COLUMN);
  const losers = s.losers.slice(0, PER_COLUMN);
  const moreW = s.winners.length - winners.length;
  const moreL = s.losers.length - losers.length;

  return (
    <div className="bet-overlay" onClick={onClose}>
      <div className="bet-panel" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="bet-head">
          <h2 className="bet-title">🎲 תוצאות ההימור</h2>
          <span className="bet-counts">
            <span className="bet-counts-win">{s.won} זכו</span>
            <span className="bet-counts-sep">·</span>
            <span className="bet-counts-lose">{s.lost} הפסידו</span>
          </span>
          <button className="bet-close" title="סגירה (רווח)" onClick={onClose}>
            ✕
          </button>
        </div>
        {title.trim() !== '' && <p className="bet-subtitle">{title}</p>}

        {s.won + s.lost === 0 ? (
          <p className="bet-empty">אף אחד לא הימר בסיבוב הזה.</p>
        ) : (
          <div className="bet-cols">
            <section className="bet-col bet-col--win">
              <header className="bet-col-head">
                <span>זכו</span>
                <span className="bet-col-sum" dir="ltr">
                  +{s.totalWon.toLocaleString('en-US')}
                </span>
              </header>
              <ol className="bet-rows">
                {winners.map((w, i) => (
                  <li key={w.voterId} className="bet-row" style={{ animationDelay: `${i * 0.08}s` }}>
                    <span className="bet-row-rank">{i + 1}</span>
                    <FitText className="bet-row-name" min={12}>
                      {nameOf(w.voterId)}
                    </FitText>
                    <span className="bet-row-delta">
                      <CountUp value={w.delta} />
                    </span>
                  </li>
                ))}
                {winners.length === 0 && <li className="bet-row bet-row--empty">— אף אחד —</li>}
                {moreW > 0 && <li className="bet-row bet-row--more">ועוד {moreW} שזכו</li>}
              </ol>
            </section>
            <section className="bet-col bet-col--lose">
              <header className="bet-col-head">
                <span>הפסידו</span>
                <span className="bet-col-sum" dir="ltr">
                  −{s.totalLost.toLocaleString('en-US')}
                </span>
              </header>
              <ol className="bet-rows">
                {losers.map((l, i) => (
                  <li key={l.voterId} className="bet-row" style={{ animationDelay: `${i * 0.08}s` }}>
                    <span className="bet-row-rank">{i + 1}</span>
                    <FitText className="bet-row-name" min={12}>
                      {nameOf(l.voterId)}
                    </FitText>
                    <span className="bet-row-delta">
                      <CountUp value={l.delta} />
                    </span>
                  </li>
                ))}
                {losers.length === 0 && <li className="bet-row bet-row--empty">— אף אחד —</li>}
                {moreL > 0 && <li className="bet-row bet-row--more">ועוד {moreL} שהפסידו</li>}
              </ol>
            </section>
          </div>
        )}

        {s.biggest !== null && (
          <div className="bet-big">
            <span className="bet-big-lbl">ההימור הגדול</span>
            <FitText className="bet-big-name" min={14}>
              {nameOf(s.biggest.voterId)}
            </FitText>
            <span className="bet-big-delta">
              <CountUp value={s.biggest.delta} durationMs={1400} />
            </span>
          </div>
        )}

        <div className="bet-foot">רווח — המשך למשחק</div>
      </div>
    </div>
  );
}
