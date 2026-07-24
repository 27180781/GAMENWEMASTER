/**
 * תפריט מפעיל (ESC — SPEC סעיף 9): קפיצה לשקופית, פתיחת/סגירת הצבעה,
 * סטטוס חיבור, ווליום, קהל סינתטי, סיום משחק. סטטוס הורדות וניקוי מטמון
 * יגיעו ב-M4 (Preload/Cache).
 */

import type { GameEngine, GameState } from '../engine/index.ts';

interface OperatorMenuProps {
  engine: GameEngine;
  state: GameState;
  volume: number;
  onVolumeChange: (volume: number) => void;
  syntheticCrowd: boolean;
  onSyntheticCrowdChange: (on: boolean) => void;
  hostVoterId?: string;
  /** מצב קליקרים (EXE): הקפצת חלון תוכנת הקליטה לחזית — הגדרת טווח / Connect. */
  onShowReceiver?: () => void;
  /** אופליין (EXE): פתיחת תיקיית קבצי התוצאות (אקסל). */
  onOpenReports?: () => void;
  onEndGame: () => void;
  onClose: () => void;
}

export function OperatorMenu({
  engine,
  state,
  volume,
  onVolumeChange,
  syntheticCrowd,
  onSyntheticCrowdChange,
  hostVoterId = '',
  onShowReceiver,
  onOpenReports,
  onEndGame,
  onClose,
}: OperatorMenuProps) {
  const slides = engine.getGame().questions;

  return (
    <div className="operator-menu" dir="rtl">
      <div className="operator-menu-panel">
        <header className="operator-menu-header">
          <h2>תפריט מפעיל</h2>
          <button onClick={onClose}>סגור (ESC)</button>
        </header>

        <section className="operator-controls">
          <button
            onClick={() => engine.dispatch({ type: 'ADVANCE', at: Date.now() })}
            disabled={state.phase === 'ended'}
          >
            {state.phase === 'voting' ? 'סגור הצבעה' : state.phase === 'showing' ? 'פתח הצבעה / המשך' : 'המשך'}
          </button>
          <button onClick={() => engine.dispatch({ type: 'BACK', at: Date.now() })}>שקופית קודמת</button>
          <button onClick={onEndGame}>סיום משחק ומעבר לזוכים</button>
          {onShowReceiver && (
            <button className="operator-clicker-btn" onClick={onShowReceiver}>
              🎛️ חלון קליטת שלטים (טווח / Connect)
            </button>
          )}
          {onOpenReports && (
            <button className="operator-clicker-btn" onClick={onOpenReports}>
              📊 פתח תיקיית תוצאות (אקסל)
            </button>
          )}
          <label>
            ווליום:{' '}
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={syntheticCrowd}
              onChange={(e) => onSyntheticCrowdChange(e.target.checked)}
            />{' '}
            קהל סינתטי (Replay)
          </label>
          <p className="operator-status">
            מקור הצבעות: {syntheticCrowd ? 'קהל סינתטי (דמו)' : 'שרת ההצבעות'}
            {hostVoterId !== '' && ` · שלט מנחה: ${hostVoterId}`}
          </p>
          <p className="operator-status">
            <strong>פקודות מנחה (מקלדת / שלט):</strong> רווח או 0 — השלב הבא · 2 — שלב
            אחורה · 1 — מסך מובילים/חזרה · 3 — מחיאות כפיים · 4 — ‏10+ שניות לטיימר ·
            5 — ‏10- שניות · 6 — עצירת/המשך טיימר והצבעה
          </p>
        </section>

        <section className="operator-slides">
          <h3>קפיצה לשקופית</h3>
          <ul>
            {slides.map((slide, index) => (
              <li key={slide.id}>
                <button
                  className={slide.id === state.currentSlideId ? 'current' : ''}
                  onClick={() => {
                    engine.dispatch({ type: 'GOTO', slideId: slide.id, at: Date.now() });
                    onClose();
                  }}
                >
                  {index + 1}. [{slide.type}] {slide.question.que.slice(0, 40) || '(מדיה)'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
