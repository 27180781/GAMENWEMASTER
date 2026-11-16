/**
 * מסך «כל מי שענה נכון» — צעד נוסף ברווח אחרי חשיפת התשובה הנכונה, כשההגדרה
 * setting.showAllCorrect דלוקה (ראו src/app/correctList.ts). השמות לפי סדר
 * המהירות, בעמודות מלמעלה למטה (הראשון למעלה מימין). מעל 40 שמות העמודים
 * מתחלפים לבד. המשחק "עוצר" כל עוד המסך פתוח, ורווח סוגר וממשיך.
 */

import { useEffect, useState } from 'react';
import {
  CORRECT_LIST_PAGE_MS,
  CORRECT_LIST_PER_PAGE,
  correctListLayout,
} from '../app/correctList.ts';
import { FitText } from './FitText.tsx';

interface CorrectListOverlayProps {
  /** מזהי מי שצדק, המהיר ראשון. */
  ids: readonly string[];
  nameOf: (voterId: string) => string;
  /** בלי סגירה (מסך הצפייה) — אין כפתור ואין סגירה בלחיצה. */
  onClose?: (() => void) | undefined;
}

export function CorrectListOverlay({ ids, nameOf, onClose }: CorrectListOverlayProps) {
  const { cols, rows, pages } = correctListLayout(ids.length);
  const [page, setPage] = useState(0);

  // רשימה אחרת (שקופית אחרת, הוסר משתתף) מתחילה שוב מהעמוד הראשון.
  useEffect(() => setPage(0), [ids.length]);
  useEffect(() => {
    if (pages <= 1) return;
    const timer = window.setInterval(() => setPage((p) => (p + 1) % pages), CORRECT_LIST_PAGE_MS);
    return () => window.clearInterval(timer);
  }, [pages]);

  const current = Math.min(page, pages - 1);
  const start = current * CORRECT_LIST_PER_PAGE;
  const shown = ids.slice(start, start + CORRECT_LIST_PER_PAGE);
  const size = cols === 1 ? 'xl' : cols <= 2 ? 'lg' : cols <= 3 ? 'md' : 'sm';

  return (
    <div className="correct-overlay" onClick={onClose}>
      <div className="correct-panel" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="correct-head">
          <h2 className="correct-title">✅ ענו נכון</h2>
          <span className="correct-count">
            {ids.length === 1 ? 'משתתף אחד' : `${ids.length.toLocaleString('en-US')} משתתפים`}
          </span>
          {onClose !== undefined && (
            <button className="correct-close" title="סגירה (רווח)" onClick={onClose}>
              ✕
            </button>
          )}
        </div>

        {ids.length === 0 ? (
          <p className="correct-empty">אף אחד לא ענה נכון על השאלה הזאת.</p>
        ) : (
          <ol
            key={current}
            className={`correct-grid correct-grid--${size}`}
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${rows}, auto)`,
            }}
          >
            {shown.map((id, i) => (
              <li
                key={id}
                className={`correct-row${start + i < 3 ? ' correct-row--top' : ''}`}
                style={{ animationDelay: `${Math.min(i, 40) * 0.04}s` }}
              >
                <span className="correct-rank">{start + i + 1}</span>
                <FitText className="correct-name" min={12}>
                  {nameOf(id)}
                </FitText>
              </li>
            ))}
          </ol>
        )}

        <div className="correct-foot">
          {pages > 1 && (
            <span className="correct-page">
              עמוד {current + 1} מתוך {pages}
            </span>
          )}
          <span>רווח — המשך למשחק</span>
        </div>
      </div>
    </div>
  );
}
