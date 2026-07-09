/**
 * מסך ההגדרות — המסך הראשון אחרי טעינת משחק, ונגיש גם באמצע משחק בכפתור ⚙
 * (נפתח כשכבה מעל; מצב המשחק נשמר). כאן נקבעים שחקני הדמה, מהירות ההצבעה,
 * ושלט המנחה.
 */

import { useState } from 'react';
import type { GameFile } from '../engine/index.ts';
import type { GameSettings } from '../app/urlParams.ts';

const SPEED_PRESETS: { label: string; value: number }[] = [
  { label: 'איטי — מפוזר על כל חלון ההצבעה', value: 1 },
  { label: 'רגיל — רוב ההצבעות בתחילת החלון', value: 0.6 },
  { label: 'מהיר — כולם עונים בשליש הראשון', value: 0.3 },
  { label: 'בזק — מתקפת הצבעות מיידית (בדיקת עומס)', value: 0.12 },
];

interface SettingsScreenProps {
  game: GameFile;
  initial: GameSettings;
  /** 'start' — לפני תחילת המשחק; 'ingame' — נפתח מכפתור ההגדרות בזמן משחק. */
  mode: 'start' | 'ingame';
  onSave: (settings: GameSettings) => void;
}

export function SettingsScreen({ game, initial, mode, onSave }: SettingsScreenProps) {
  const [crowdEnabled, setCrowdEnabled] = useState(initial.crowdEnabled);
  const [voterCount, setVoterCount] = useState(initial.voterCount);
  const [speedFactor, setSpeedFactor] = useState(initial.speedFactor);
  const [correctPercent, setCorrectPercent] = useState(Math.round(initial.correctBias * 100));
  const [intervalMs, setIntervalMs] = useState(initial.intervalMs);
  const [hostVoterId, setHostVoterId] = useState(initial.hostVoterId);

  const clampedVoters = Math.min(5000, Math.max(1, Math.floor(voterCount) || 1));

  return (
    <div className="screen settings-screen">
      <div className="screen-content demo-settings">
        <h1 className="opening-title">הגדרות משחק ⚙</h1>
        <p className="demo-game-name">
          משחק: <strong>{game.name}</strong> · {game.questions.length} שקופיות
        </p>

        <div className="demo-form">
          <label className="demo-field demo-field--row">
            <input
              type="checkbox"
              checked={crowdEnabled}
              onChange={(e) => setCrowdEnabled(e.target.checked)}
            />
            <span>שחקני דמה (מצב דמו) — הצבעות מקהל מדומה במקום מהסוקט</span>
          </label>

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
            <select value={speedFactor} onChange={(e) => setSpeedFactor(Number(e.target.value))}>
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

          <label className="demo-field">
            <span>שלט מנחה — מזהה קליקר / מספר טלפון (אופציונלי)</span>
            <input
              type="text"
              dir="ltr"
              placeholder="למשל: 0501234567"
              value={hostVoterId}
              onChange={(e) => setHostVoterId(e.target.value)}
            />
            <span style={{ fontSize: 18, opacity: 0.7 }}>
              ההקשות שלו הן פקודות מנחה (0 קדימה, 2 אחורה, 1 מובילים...) — הוא לא משתתף בהצבעות
            </span>
          </label>
        </div>

        <button
          className="picker-button demo-start"
          onClick={() =>
            onSave({
              crowdEnabled,
              voterCount: clampedVoters,
              speedFactor,
              correctBias: correctPercent / 100,
              intervalMs: Math.min(2000, Math.max(50, intervalMs || 300)),
              hostVoterId: hostVoterId.trim(),
            })
          }
        >
          {mode === 'start' ? '▶ התחל משחק' : '💾 שמירה וחזרה למשחק'}
        </button>
      </div>
    </div>
  );
}
