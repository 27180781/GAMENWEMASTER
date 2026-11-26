/**
 * «תוצאת הדאבל» — צעד ברווח אחרי חשיפת התשובה בשאלת דאבל של הגרלת הווילה
 * (src/app/villaDouble.ts): כמה מבני המשפחה צדקו, כמה כרטיסים זה שווה, ושורה
 * שמשווה לשאר המשפחות בארץ. המשחק "עוצר" כל עוד המסך פתוח, ורווח סוגר וממשיך.
 * גם בקישור הצפייה, בלי כפתור סגירה.
 */

import { VILLA_DOUBLE_MAX_TICKETS, doubleTicketLines, doubleTitle, type DoubleView } from '../app/villaDouble.ts';

interface DoubleResultOverlayProps {
  view: DoubleView;
  /** בלי סגירה (מסך הצפייה) — אין כפתור ואין סגירה בלחיצה. */
  onClose?: (() => void) | undefined;
}

export function DoubleResultOverlay({ view, onClose }: DoubleResultOverlayProps) {
  const pct = view.base > 0 ? Math.round((100 * view.correct) / view.base) : 0;
  const ticketLines = doubleTicketLines(view);

  return (
    <div className="double-overlay" onClick={onClose}>
      <div className="double-panel" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="double-head">
          <span className="double-badge">🎫 {doubleTitle(view.n, view.of)}</span>
          {onClose !== undefined && (
            <button className="double-close" title="סגירה (רווח)" onClick={onClose}>
              ✕
            </button>
          )}
        </div>

        <div className="double-score">
          <div className="double-big">
            <span className="double-num">{view.correct.toLocaleString('en-US')}</span>
            <span className="double-of">מתוך {view.base.toLocaleString('en-US')}</span>
          </div>
          <div className="double-sub">
            {view.correct === 1 ? 'ענה נכון' : 'ענו נכון'} · {pct}%
          </div>
        </div>

        {ticketLines !== null && (
          <>
            <div
              className="double-meter"
              aria-label={`${view.tickets} מתוך ${VILLA_DOUBLE_MAX_TICKETS}`}
            >
              {Array.from({ length: VILLA_DOUBLE_MAX_TICKETS }, (_, i) => (
                <span
                  key={i}
                  className={`double-ticket${i < view.tickets ? ' double-ticket--on' : ''}`}
                  style={{ animationDelay: `${0.25 + i * 0.08}s` }}
                >
                  🎫
                </span>
              ))}
            </div>
            <div className="double-tickets">
              {ticketLines.main}
            </div>
            {ticketLines.note !== null && <div className="double-note">{ticketLines.note}</div>}
          </>
        )}

        <div className="double-compare">{view.comparison}</div>

        <div className="double-foot">רווח — המשך למשחק</div>
      </div>
    </div>
  );
}
