/**
 * מסך הגדרות מצב דמו — נפתח ראשון כשנכנסים עם ‎&demo=1 (או מסמנים "מצב דמו"
 * בבחירת קובץ). ההצבעות יגיעו משחקני דמה במקום מהסוקט, לפי ההגדרות כאן —
 * כך אפשר לבחון את ביצועי המערכת בעומסים שונים.
 */

import { useState } from 'react';
import type { GameFile } from '../engine/index.ts';
import { DEFAULT_DEMO_CONFIG, type DemoConfig } from '../app/urlParams.ts';

const SPEED_PRESETS: { label: string; value: number }[] = [
  { label: 'איטי — מפוזר על כל חלון ההצבעה', value: 1 },
  { label: 'רגיל — רוב ההצבעות בתחילת החלון', value: 0.6 },
  { label: 'מהיר — כולם עונים בשליש הראשון', value: 0.3 },
  { label: 'בזק — מתקפת הצבעות מיידית (בדיקת עומס)', value: 0.12 },
];

export function DemoSettingsScreen({
  game,
  onStart,
}: {
  game: GameFile;
  onStart: (config: DemoConfig) => void;
}) {
  const [voterCount, setVoterCount] = useState(DEFAULT_DEMO_CONFIG.voterCount);
  const [speedFactor, setSpeedFactor] = useState(DEFAULT_DEMO_CONFIG.speedFactor);
  const [correctPercent, setCorrectPercent] = useState(
    Math.round(DEFAULT_DEMO_CONFIG.correctBias * 100),
  );
  const [intervalMs, setIntervalMs] = useState(DEFAULT_DEMO_CONFIG.intervalMs);

  const clampedVoters = Math.min(5000, Math.max(1, Math.floor(voterCount) || 1));

  return (
    <div className="screen">
      <div className="screen-content demo-settings">
        <h1 className="opening-title">מצב דמו 🧪</h1>
          <p className="demo-game-name">
            משחק: <strong>{game.name}</strong> · {game.questions.length} שקופיות
          </p>

          <div className="demo-form">
            <label className="demo-field">
              <span>כמות שחקני דמה: {clampedVoters.toLocaleString()}</span>
              <input
                type="range"
                min="1"
                max="5000"
                step="1"
                value={clampedVoters}
                onChange={(e) => setVoterCount(Number(e.target.value))}
              />
              <input
                type="number"
                min="1"
                max="5000"
                value={clampedVoters}
                onChange={(e) => setVoterCount(Number(e.target.value))}
              />
            </label>

            <label className="demo-field">
              <span>מהירות הצבעה</span>
              <select
                value={speedFactor}
                onChange={(e) => setSpeedFactor(Number(e.target.value))}
              >
                {SPEED_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="demo-field">
              <span>אחוז עונים נכון (בשאלות trivia): {correctPercent}%</span>
              <input
                type="range"
                min="0"
                max="100"
                value={correctPercent}
                onChange={(e) => setCorrectPercent(Number(e.target.value))}
              />
            </label>

            <label className="demo-field">
              <span>קצב עדכוני הצבעות (ms; השרת האמיתי ≈250)</span>
              <input
                type="number"
                min="50"
                max="2000"
                step="50"
                value={intervalMs}
                onChange={(e) => setIntervalMs(Number(e.target.value))}
              />
            </label>
          </div>

          <button
            className="picker-button demo-start"
            onClick={() =>
              onStart({
                voterCount: clampedVoters,
                speedFactor,
                correctBias: correctPercent / 100,
                intervalMs: Math.min(2000, Math.max(50, intervalMs || 300)),
              })
            }
          >
            ▶ התחל משחק דמו
          </button>
          <p className="opening-hint" style={{ opacity: 0.6 }}>
            ההבדל היחיד ממשחק אמיתי: ההצבעות מגיעות משחקני הדמה במקום מהסוקט
          </p>
      </div>
    </div>
  );
}
