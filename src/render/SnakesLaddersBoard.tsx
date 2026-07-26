/**
 * לוח "סולמות וחבלים קבוצתי" — מסך הלוח שעולה אחרי כל שאלה.
 *
 * הלוח מצויר כנחש-מסלול (boustrophedon: שורות מתחלפות בכיוון), עם סולמות
 * וחבלים מצוירים כקווים מעל המשבצות, ודמות ענק לכל קבוצה שמטפסת/נופלת
 * באנימציה חלקה מהמיקום הקודם לחדש.
 *
 * האנימציה בשני שלבים כדי שהסיפור יהיה קריא: קודם הליכה על המסלול
 * (from → landed), ואז — אם נחתנו על סולם/חבל — קפיצה ליעד (landed → to).
 */

import { useEffect, useState } from 'react';
import {
  BOARD_SIZE,
  DEFAULT_LADDERS,
  DEFAULT_SNAKES,
  type BoardState,
  type GroupRoundResult,
} from '../app/snakesLadders.ts';

/** כמה משבצות בשורה — 6×5 = 30. */
const COLS = 6;
const ROWS = Math.ceil(BOARD_SIZE / COLS);

/** צבעי הקבוצות (מחזורי) — בולטים ומובחנים על מסך גדול. */
const GROUP_COLORS = ['#e5326b', '#2fa8e0', '#38b24a', '#ffd23f', '#9b5de5', '#ff8c42'];

/** אימוג'י הדמות לכל קבוצה (מחזורי). */
const GROUP_AVATARS = ['🦁', '🐘', '🦊', '🐻', '🦄', '🐢'];

interface Props {
  board: BoardState;
  /** שמות הקבוצות לפי מזהה — לתצוגה. */
  groups: { id: string; name: string }[];
  /** האם להציג את שלב "אחרי הקפיצה" (מופעל אחרי השהיה קצרה). */
  progression: 'dice' | 'percent';
  onClose?: () => void;
}

/** מרכז המשבצת באחוזים (0..100) — משבצת 1 בפינה הימנית-תחתונה, נחש מעלה. */
export function cellCenter(cell: number): { x: number; y: number } {
  const clamped = Math.max(1, Math.min(BOARD_SIZE, cell));
  const idx = clamped - 1;
  const row = Math.floor(idx / COLS); // 0 = השורה התחתונה
  const inRow = idx % COLS;
  // שורות זוגיות מימין לשמאל, אי-זוגיות משמאל לימין (מסלול רציף)
  const col = row % 2 === 0 ? COLS - 1 - inRow : inRow;
  return {
    x: ((col + 0.5) / COLS) * 100,
    y: ((ROWS - 1 - row + 0.5) / ROWS) * 100,
  };
}

/** מיקום דמות לפני תחילת הלוח (משבצת 0) — מחוץ למסלול, בפינה. */
function avatarPos(cell: number): { x: number; y: number } {
  if (cell <= 0) {
    const start = cellCenter(1);
    return { x: Math.min(99, start.x + 9), y: Math.min(99, start.y + 7) };
  }
  return cellCenter(cell);
}

export function SnakesLaddersBoard({ board, groups, progression, onClose }: Props) {
  // שלב 0 = במיקום ההתחלתי, 1 = אחרי ההליכה, 2 = אחרי הסולם/חבל.
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    setPhase(0);
    const t1 = window.setTimeout(() => setPhase(1), 400);
    const t2 = window.setTimeout(() => setPhase(2), 1800);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [board]);

  const resultById = new Map<string, GroupRoundResult>(board.lastRound.map((r) => [r.groupId, r]));
  /** המיקום להצגה כרגע, לפי שלב האנימציה. */
  const shownCell = (groupId: string): number => {
    const r = resultById.get(groupId);
    if (!r) return board.positions[groupId] ?? 0;
    if (phase === 0) return r.from;
    if (phase === 1) return r.landed;
    return r.to;
  };

  return (
    <div className="sl-overlay" onClick={onClose}>
      <div className="sl-panel" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="sl-head">
          <h2 className="sl-title">מרוץ הקבוצות</h2>
          {progression === 'dice' && board.lastDice !== null && (
            <div className="sl-dice" title="הטלת הקובייה">
              🎲 <span className="sl-dice-num">{board.lastDice}</span>
            </div>
          )}
        </div>

        <div className="sl-body">
          {/* הלוח */}
          <div className="sl-board">
            {/* משבצות */}
            {Array.from({ length: BOARD_SIZE }, (_, i) => {
              const cell = i + 1;
              const { x, y } = cellCenter(cell);
              const isLadder = DEFAULT_LADDERS[cell] !== undefined;
              const isSnake = DEFAULT_SNAKES[cell] !== undefined;
              const isEnd = cell === BOARD_SIZE;
              return (
                <div
                  key={cell}
                  className={`sl-cell${isLadder ? ' sl-cell--ladder' : ''}${isSnake ? ' sl-cell--snake' : ''}${isEnd ? ' sl-cell--end' : ''}`}
                  style={{ left: `${x}%`, top: `${y}%` }}
                >
                  <span className="sl-cell-num">{cell}</span>
                  {isLadder && <span className="sl-cell-icon">🪜</span>}
                  {isSnake && <span className="sl-cell-icon">🐍</span>}
                  {isEnd && <span className="sl-cell-icon">🏁</span>}
                </div>
              );
            })}

            {/* סולמות וחבלים — קווים מחברים */}
            <svg className="sl-links" viewBox="0 0 100 100" preserveAspectRatio="none">
              {Object.entries(DEFAULT_LADDERS).map(([from, to]) => {
                const a = cellCenter(Number(from));
                const b = cellCenter(to);
                return (
                  <line key={`l${from}`} className="sl-link sl-link--ladder"
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                );
              })}
              {Object.entries(DEFAULT_SNAKES).map(([from, to]) => {
                const a = cellCenter(Number(from));
                const b = cellCenter(to);
                return (
                  <line key={`s${from}`} className="sl-link sl-link--snake"
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                );
              })}
            </svg>

            {/* דמויות הקבוצות */}
            {groups.map((g, i) => {
              const cell = shownCell(g.id);
              const { x, y } = avatarPos(cell);
              const r = resultById.get(g.id);
              const color = GROUP_COLORS[i % GROUP_COLORS.length]!;
              const jumping = phase === 2 && r?.jump !== null && r?.jump !== undefined;
              // פיזור קל כדי שדמויות באותה משבצת לא יסתירו זו את זו
              const spread = (i - (groups.length - 1) / 2) * 3.2;
              return (
                <div
                  key={g.id}
                  className={`sl-avatar${jumping ? ` sl-avatar--${r!.jump}` : ''}`}
                  style={{ left: `calc(${x}% + ${spread}px)`, top: `${y}%`, background: color }}
                  title={g.name}
                >
                  <span className="sl-avatar-face">{GROUP_AVATARS[i % GROUP_AVATARS.length]}</span>
                </div>
              );
            })}
          </div>

          {/* לוח תוצאות הסבב */}
          <div className="sl-side">
            <h3 className="sl-side-title">הסבב האחרון</h3>
            <ul className="sl-results">
              {board.lastRound.length === 0 && <li className="sl-result sl-result--empty">—</li>}
              {[...board.lastRound]
                .sort((a, b) => b.percent - a.percent)
                .map((r, i) => {
                  const idx = groups.findIndex((g) => g.id === r.groupId);
                  const color = GROUP_COLORS[(idx === -1 ? i : idx) % GROUP_COLORS.length]!;
                  return (
                    <li key={r.groupId} className="sl-result">
                      <span className="sl-result-dot" style={{ background: color }} />
                      <span className="sl-result-name">{r.name}</span>
                      <span className="sl-result-pct">{r.percent}%</span>
                      <span className="sl-result-steps">
                        {r.steps > 0 ? `+${r.steps}` : '—'}
                        {r.jump === 'ladder' && ' 🪜'}
                        {r.jump === 'snake' && ' 🐍'}
                      </span>
                      <span className="sl-result-pos">משבצת {r.to}</span>
                    </li>
                  );
                })}
            </ul>
          </div>
        </div>

        <div className="sl-foot">רווח להמשך</div>
      </div>
    </div>
  );
}
