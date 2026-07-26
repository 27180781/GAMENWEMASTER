/**
 * לוח "סולמות וחבלים קבוצתי" — מסך הלוח שעולה אחרי כל שאלה.
 *
 * הלוח מצויר כנחש-מסלול (boustrophedon: שורות מתחלפות בכיוון). הסולמות
 * והנחשים מצוירים ב-SVG *בקואורדינטות פיקסלים אמיתיות* (נמדדות ב-ResizeObserver)
 * כדי שהשלבים והעיגולים יישארו מדויקים ולא יימתחו: סולם = שני מוטות + שלבים,
 * נחש = גוף מתפתל עם ראש ועיניים. האורכים והמיקומים מגוונים (ראו snakesLadders.ts).
 *
 * האנימציה בשלבים כדי שהסיפור יהיה קריא:
 *   0 — במיקום ההתחלתי · 1 — הליכה על המסלול · 2 — טיפוס בסולם / החלקה בנחש
 * ואם קבוצה סיימה את הלוח — מסך "הקבוצה המנצחת" משתלט בסוף.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  BOARD_SIZE,
  DEFAULT_LADDERS,
  DEFAULT_SNAKES,
  type BoardState,
  type GroupRoundResult,
} from '../app/snakesLadders.ts';

const COLS = 6;
const ROWS = Math.ceil(BOARD_SIZE / COLS);

/** צבעי הקבוצות (מחזורי) — בולטים ומובחנים על מסך גדול. */
const GROUP_COLORS = ['#e5326b', '#2fa8e0', '#38b24a', '#ffd23f', '#9b5de5', '#ff8c42'];
/** אימוג'י הדמות לכל קבוצה (מחזורי). */
const GROUP_AVATARS = ['🦁', '🐘', '🦊', '🐻', '🦄', '🐢'];

/** מרכז המשבצת באחוזים (0..100) — משבצת 1 בפינה הימנית-תחתונה, נחש מעלה. */
export function cellCenter(cell: number): { x: number; y: number } {
  const clamped = Math.max(1, Math.min(BOARD_SIZE, cell));
  const idx = clamped - 1;
  const row = Math.floor(idx / COLS); // 0 = השורה התחתונה
  const inRow = idx % COLS;
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

// ---------------------------------------------------------------------------
// קובייה מונפשת — מתגלגלת ונעצרת על התוצאה
// ---------------------------------------------------------------------------

/** מיקומי הנקודות (0..1) לכל פאה של קובייה. */
const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.26, 0.26], [0.5, 0.5], [0.74, 0.74]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.26, 0.26], [0.74, 0.26], [0.5, 0.5], [0.26, 0.74], [0.74, 0.74]],
  6: [[0.28, 0.22], [0.72, 0.22], [0.28, 0.5], [0.72, 0.5], [0.28, 0.78], [0.72, 0.78]],
};

/** פאת קובייה עם נקודות. */
function DieFace({ value }: { value: number }) {
  return (
    <div className="sl-die-face">
      {(PIPS[value] ?? PIPS[1]!).map(([x, y], i) => (
        <span key={i} className="sl-die-pip" style={{ left: `${x * 100}%`, top: `${y * 100}%` }} />
      ))}
    </div>
  );
}

/** משך גלגול הקובייה עד לנחיתה על התוצאה (ms). */
const DICE_ROLL_MS = 1500;
/** שהייה אחרי הנחיתה, לפני שהחיילים זזים — זמן לקרוא כמה יצא ולמי. */
const DICE_READ_MS = 1100;
/** התקדמות באחוזים: שהייה קצרה לפני הצעדים (אין הטלה להמתין לה). */
const PERCENT_START_MS = 900;
/** מהצעדים ועד קפיצת הסולם/הנחש. */
const JUMP_MS = 2000;
/** מהקפיצה ועד מסך הקבוצה המנצחת. */
const WIN_MS = 1800;

/**
 * קובייה שמתגלגלת: מציגה פאות אקראיות במהירות, מאטה, ונעצרת על התוצאה עם
 * "נחיתה". כך ההגרלה נראית ומרגישה אמיתית, במקום מספר שקופץ.
 */
function RollingDice({ value }: { value: number }) {
  const [face, setFace] = useState(1);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    setSettled(false);
    let alive = true;
    let delay = 60;
    let elapsed = 0;
    const tick = () => {
      if (!alive) return;
      setFace(1 + Math.floor(Math.random() * 6));
      elapsed += delay;
      delay *= 1.16; // האטה הדרגתית — תחושת גלגול שנחלש
      if (elapsed < DICE_ROLL_MS) {
        window.setTimeout(tick, delay);
      } else {
        setFace(value); // נעצרת על התוצאה האמיתית
        setSettled(true);
      }
    };
    const first = window.setTimeout(tick, 60);
    return () => {
      alive = false;
      window.clearTimeout(first);
    };
  }, [value]);

  return (
    <div className={`sl-die${settled ? ' sl-die--settled' : ' sl-die--rolling'}`} aria-label={`קובייה ${value}`}>
      <DieFace value={face} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ציור סולמות ונחשים (SVG בפיקסלים אמיתיים)
// ---------------------------------------------------------------------------

interface Pt { x: number; y: number }

/** סולם: שני מוטות מקבילים + שלבים לרוחב, לאורך הקו שבין שתי המשבצות. */
function Ladder({ a, b }: { a: Pt; b: Pt }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy; // נורמל
  const py = ux;
  const w = 13; // חצי-רוחב הסולם
  const rungGap = 34;
  const rungs = Math.max(2, Math.floor(len / rungGap));
  return (
    <g className="sl-ladder">
      <line x1={a.x + px * w} y1={a.y + py * w} x2={b.x + px * w} y2={b.y + py * w} />
      <line x1={a.x - px * w} y1={a.y - py * w} x2={b.x - px * w} y2={b.y - py * w} />
      {Array.from({ length: rungs + 1 }, (_, i) => {
        const t = i / rungs;
        const cx = a.x + dx * t;
        const cy = a.y + dy * t;
        return (
          <line key={i} className="sl-rung"
            x1={cx + px * w} y1={cy + py * w} x2={cx - px * w} y2={cy - py * w} />
        );
      })}
    </g>
  );
}

/** נחש: גוף מתפתל (עקומת בזייה) עם ראש ועיניים בכניסה וזנב מתחדד ביעד. */
function Snake({ a, b, index }: { a: Pt; b: Pt; index: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  // עקמומיות לפי אורך — נחש ארוך מתפתל יותר; כיוון מתחלף בין נחשים
  const amp = Math.min(90, len * 0.28) * (index % 2 === 0 ? 1 : -1);
  const c1 = { x: a.x + dx * 0.3 + px * amp, y: a.y + dy * 0.3 + py * amp };
  const c2 = { x: a.x + dx * 0.7 - px * amp, y: a.y + dy * 0.7 - py * amp };
  const d = `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
  // כיוון הראש — לאורך המשיק ההתחלתי
  const hx = c1.x - a.x;
  const hy = c1.y - a.y;
  const hlen = Math.hypot(hx, hy) || 1;
  const eyeSide = { x: (-hy / hlen) * 7, y: (hx / hlen) * 7 };
  return (
    <g className="sl-snake">
      <path className="sl-snake-body" d={d} />
      <path className="sl-snake-belly" d={d} />
      <circle className="sl-snake-head" cx={a.x} cy={a.y} r={17} />
      <circle className="sl-snake-eye" cx={a.x + eyeSide.x} cy={a.y + eyeSide.y} r={3.4} />
      <circle className="sl-snake-eye" cx={a.x - eyeSide.x} cy={a.y - eyeSide.y} r={3.4} />
    </g>
  );
}

// ---------------------------------------------------------------------------
// הלוח
// ---------------------------------------------------------------------------

interface Props {
  board: BoardState;
  groups: { id: string; name: string }[];
  progression: 'dice' | 'percent';
  /** אפקט קולי (מסונתז) — מוזרק כדי שהרכיב יישאר נטול-תלות. */
  onCue?: (kind: 'climb' | 'fall' | 'fanfare') => void;
  onClose?: () => void;
}

export function SnakesLaddersBoard({ board, groups, progression, onCue, onClose }: Props) {
  const [phase, setPhase] = useState(0);
  const [showWinner, setShowWinner] = useState(false);
  const boardElRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // מדידת הלוח בפיקסלים — כדי לצייר סולמות/נחשים בפרופורציות נכונות.
  useLayoutEffect(() => {
    const el = boardElRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** קבוצות שסיימו את הלוח בסבב הזה. */
  const finishers = board.lastRound.filter((r) => r.to >= BOARD_SIZE);

  /** בהתקדמות בקובייה: האם ההטלה כבר נחתה (ורק אז מציגים למי היא שייכת). */
  const [diceLanded, setDiceLanded] = useState(false);

  useEffect(() => {
    setPhase(0);
    setShowWinner(false);
    setDiceLanded(false);
    const timers: number[] = [];
    // בהתקדמות בקובייה החיילים ממתינים לה: קודם ההטלה מסתיימת ונקראת, ורק אז
    // הצעדים. בלי ההמתנה הזו הם היו זזים בזמן שהקובייה עוד מתגלגלת, ולא היה
    // ברור מאיפה הגיע מספר הצעדים.
    const rolling = progression === 'dice' && board.lastDice !== null;
    const stepAt = rolling ? DICE_ROLL_MS + DICE_READ_MS : PERCENT_START_MS;
    if (rolling) timers.push(window.setTimeout(() => setDiceLanded(true), DICE_ROLL_MS));
    timers.push(window.setTimeout(() => setPhase(1), stepAt));
    timers.push(
      window.setTimeout(() => {
        setPhase(2);
        // אפקטים: מי שטיפס ומי שנפל — יכולים להישמע יחד
        if (board.lastRound.some((r) => r.jump === 'ladder')) onCue?.('climb');
        if (board.lastRound.some((r) => r.jump === 'snake')) onCue?.('fall');
      }, stepAt + JUMP_MS),
    );
    if (finishers.length > 0) {
      timers.push(
        window.setTimeout(() => {
          setShowWinner(true);
          onCue?.('fanfare');
        }, stepAt + JUMP_MS + WIN_MS),
      );
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);

  const resultById = new Map<string, GroupRoundResult>(board.lastRound.map((r) => [r.groupId, r]));
  const shownCell = (groupId: string): number => {
    const r = resultById.get(groupId);
    if (!r) return board.positions[groupId] ?? 0;
    if (phase === 0) return r.from;
    if (phase === 1) return r.landed;
    return r.to;
  };
  /** מרכז משבצת בפיקסלים (לציור ה-SVG). */
  const pt = (cell: number): Pt => {
    const c = cellCenter(cell);
    return { x: (c.x / 100) * size.w, y: (c.y / 100) * size.h };
  };
  const colorOf = (groupId: string) => {
    const i = groups.findIndex((g) => g.id === groupId);
    return GROUP_COLORS[(i === -1 ? 0 : i) % GROUP_COLORS.length]!;
  };
  const avatarOf = (groupId: string) => {
    const i = groups.findIndex((g) => g.id === groupId);
    return GROUP_AVATARS[(i === -1 ? 0 : i) % GROUP_AVATARS.length]!;
  };

  // מסך "הקבוצה המנצחת" — משתלט בסוף האנימציה
  if (showWinner && finishers.length > 0) {
    const winners = [...finishers].sort((a, b) => b.percent - a.percent);
    return (
      <div className="sl-overlay sl-overlay--win" onClick={onClose}>
        <div className="sl-win" dir="rtl" onClick={(e) => e.stopPropagation()}>
          <div className="sl-win-confetti" aria-hidden="true">
            {Array.from({ length: 40 }, (_, i) => (
              <span
                key={i}
                className="sl-confetti"
                style={{
                  left: `${(i * 37) % 100}%`,
                  background: GROUP_COLORS[i % GROUP_COLORS.length],
                  animationDelay: `${(i % 10) * 0.18}s`,
                  animationDuration: `${2.4 + (i % 5) * 0.4}s`,
                }}
              />
            ))}
          </div>
          <div className="sl-win-crown">👑</div>
          <h1 className="sl-win-title">
            {winners.length > 1 ? 'הקבוצות המנצחות!' : 'הקבוצה המנצחת!'}
          </h1>
          <div className="sl-win-groups">
            {winners.map((w) => (
              <div key={w.groupId} className="sl-win-group">
                <span className="sl-win-avatar" style={{ background: colorOf(w.groupId) }}>
                  {avatarOf(w.groupId)}
                </span>
                <span className="sl-win-name">{w.name}</span>
              </div>
            ))}
          </div>
          <p className="sl-win-sub">הגיעה לסוף הלוח 🏁</p>
          <div className="sl-foot">רווח להמשך</div>
        </div>
      </div>
    );
  }

  return (
    <div className="sl-overlay" onClick={onClose}>
      <div className="sl-panel" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="sl-head">
          <h2 className="sl-title">מרוץ הקבוצות</h2>
          {progression === 'dice' && board.lastDice !== null && (
            <div className="sl-dice-wrap">
              <RollingDice value={board.lastDice} />
              {board.diceWinner !== null && (
                // מוצג רק אחרי שהקובייה נחתה — קודם רואים כמה יצא, ואז למי.
                <span className={`sl-dice-who${diceLanded ? ' is-in' : ''}`}>
                  {board.lastRound.find((r) => r.groupId === board.diceWinner)?.name ?? ''}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="sl-body">
          <div className="sl-board" ref={boardElRef}>
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
                  {isEnd && <span className="sl-cell-icon">🏁</span>}
                </div>
              );
            })}

            {/* סולמות ונחשים — בפיקסלים אמיתיים, בלי מתיחה */}
            {size.w > 0 && (
              <svg className="sl-links" width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`}>
                {Object.entries(DEFAULT_LADDERS).map(([from, to]) => (
                  <Ladder key={`l${from}`} a={pt(Number(from))} b={pt(to)} />
                ))}
                {Object.entries(DEFAULT_SNAKES).map(([from, to], i) => (
                  <Snake key={`s${from}`} a={pt(Number(from))} b={pt(to)} index={i} />
                ))}
              </svg>
            )}

            {/* מספרי המשבצות — שכבה נפרדת *מעל* הסולמות/הנחשים, אחרת הגרפיקה
                מסתירה אותם והלוח נעשה לא-קריא. */}
            {Array.from({ length: BOARD_SIZE }, (_, i) => {
              const cell = i + 1;
              const { x, y } = cellCenter(cell);
              return (
                <span key={`n${cell}`} className="sl-cell-num" style={{ left: `${x}%`, top: `${y}%` }}>
                  {cell}
                </span>
              );
            })}

            {/* דמויות הקבוצות */}
            {groups.map((g, i) => {
              const cell = shownCell(g.id);
              const { x, y } = avatarPos(cell);
              const r = resultById.get(g.id);
              const jumping = phase === 2 && r?.jump !== null && r?.jump !== undefined;
              const spread = (i - (groups.length - 1) / 2) * 3.2;
              return (
                <div
                  key={g.id}
                  className={`sl-avatar${jumping ? ` sl-avatar--${r!.jump}` : ''}`}
                  style={{
                    left: `calc(${x}% + ${spread}px)`,
                    top: `${y}%`,
                    background: GROUP_COLORS[i % GROUP_COLORS.length]!,
                  }}
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
                .map((r) => (
                  <li key={r.groupId} className="sl-result">
                    <span className="sl-result-dot" style={{ background: colorOf(r.groupId) }} />
                    <span className="sl-result-name">{r.name}</span>
                    <span className="sl-result-pct">{r.percent}%</span>
                    <span className="sl-result-steps">
                      {r.steps > 0 ? `+${r.steps}` : '—'}
                      {r.jump === 'ladder' && ' 🪜'}
                      {r.jump === 'snake' && ' 🐍'}
                    </span>
                    <span className="sl-result-pos">משבצת {r.to}</span>
                  </li>
                ))}
            </ul>
          </div>
        </div>

        <div className="sl-foot">רווח להמשך</div>
      </div>
    </div>
  );
}
