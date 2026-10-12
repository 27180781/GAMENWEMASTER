/**
 * «במה» בקישור הצפייה (LiveViewer.tsx):
 * - `StageGrid` — מי שהמנחה העלה לבמה, בעמודה שליד המסך. מי שעל הבמה בעצמו
 *   רואה את עצמו מהמצלמה שלו, כמו מראה, ולא דרך השרת.
 * - `StageCamDialog` — לפני שמדליקים מצלמה: מה יקרה, ובאיזה שם.
 * - `StageCamBar` — המצלמה של המשתתף: דלוקה, על הבמה, או למה כבתה.
 *
 * המצלמה נדלקת רק בלחיצה של המשתתף, בלי מיקרופון, ובהתחלה רק המנחה רואה אותה.
 */

import { useState, type CSSProperties, type FormEvent } from 'react';
import { cleanPlayerName, PLAYER_NAME_MAX, playerNameProblem } from '../votePad.ts';
import type { StageEntry } from './api.ts';
import { stageColumns } from './stage.ts';
import {
  stageCamOn,
  type StageCamEnd,
  type StageCamError,
  type StageCamState,
} from './stageCam.ts';
import type { StageViewState } from './stageReceiver.ts';
import { StageVideo } from './StageVideo.tsx';
import './stage.css';

// ---------------------------------------------------------------- מי על הבמה

export function StageGrid({
  entries,
  view,
  ownId,
  ownStream,
  onHide,
}: {
  entries: readonly StageEntry[];
  view: StageViewState;
  /** המצלמה של הצופה עצמו, אם הוא הדליק. */
  ownId: string | null;
  ownStream: MediaStream | null;
  onHide: () => void;
}) {
  if (entries.length === 0 || view.phase === 'unavailable') return null;
  return (
    <div className="live-stage" dir="rtl">
      <div className="live-stage-head">
        <span>👥 על הבמה</span>
        <button
          type="button"
          className="live-stage-hide"
          onClick={onHide}
          title="הסתרת הבמה (אפשר להחזיר בכפתור «👥 הבמה»)"
          aria-label="הסתרת הבמה"
        >
          ✕
        </button>
      </div>
      {view.phase === 'full' && (
        <p className="live-stage-note">הצפייה בבמה מלאה כרגע. מנסים שוב בעוד רגע…</p>
      )}
      <div
        className="live-stage-grid"
        style={{ '--cols': stageColumns(entries.length) } as CSSProperties}
      >
        {entries.map((entry) => {
          const own = entry.id === ownId;
          const stream = own ? ownStream : (view.streams.get(entry.id) ?? null);
          return (
            <div key={entry.id} className={`live-stage-tile${own ? ' is-own' : ''}`}>
              <StageVideo stream={stream} mirror={own} />
              {stream === null && (
                <span className="live-stage-wait">
                  <span className="spinner" />
                </span>
              )}
              <span className="live-stage-name">{own ? `${entry.name} (אתם)` : entry.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ לפני ההדלקה

export function StageCamDialog({
  initialName,
  onStart,
  onCancel,
}: {
  initialName: string;
  onStart: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const clean = cleanPlayerName(name);
    const problem = playerNameProblem(clean);
    if (problem !== null) {
      setError(problem);
      return;
    }
    onStart(clean);
  };

  return (
    <div
      className="live-join"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="live-cam-title"
    >
      <form className="live-join-box" onSubmit={submit}>
        <div className="live-join-icon" aria-hidden="true">
          📷
        </div>
        <h2 id="live-cam-title">להדליק את המצלמה שלכם?</h2>
        <p className="live-join-sub">
          המנחה יראה אתכם ויוכל להעלות אתכם לבמה. רק מי שעל הבמה מופיע לכל הצופים. בלי מיקרופון: רק
          תמונה.
        </p>
        <input
          className="live-join-input"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          maxLength={PLAYER_NAME_MAX}
          placeholder="השם שלכם"
          aria-label="השם שלכם"
          autoComplete="nickname"
          enterKeyHint="go"
          autoFocus={initialName === ''}
        />
        {error !== null ? (
          <p className="live-join-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="live-join-hint">השם יופיע מתחת לתמונה שלכם.</p>
        )}
        <button type="submit" className="live-join-go">
          📷 הדלקת המצלמה
        </button>
        <button type="button" className="live-join-watch" onClick={onCancel}>
          ביטול
        </button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------ המצלמה שלי

const ENDED_TEXT: Record<StageCamEnd, string> = {
  blocked: 'המצלמה שלכם כובתה על ידי המנחה.',
  closed: 'הבמה נסגרה, והמצלמה כבתה.',
  replaced: 'המצלמה שלכם דלוקה עכשיו בחלון אחר.',
  full: 'יש כבר הרבה מצלמות דלוקות. נסו שוב בעוד כמה דקות.',
};

const ERROR_TEXT: Record<StageCamError, string> = {
  permission: 'הדפדפן לא קיבל גישה למצלמה. אשרו גישה (סמל המצלמה בשורת הכתובת) ונסו שוב.',
  'no-devices': 'לא נמצאה מצלמה במכשיר.',
  busy: 'המצלמה תפוסה באפליקציה אחרת. סגרו אותה ונסו שוב.',
  lost: 'המצלמה נותקה.',
  unsupported: 'הדפדפן הזה לא יכול לשלוח וידאו. נסו בכרום או בספארי עדכני.',
  'not-configured': 'הבמה לא זמינה כרגע.',
  failed: 'ההדלקה נכשלה. נסו שוב.',
};

function camText(state: StageCamState, onStage: boolean): string {
  switch (state.phase) {
    case 'off':
      return '';
    case 'starting':
      return 'מדליקים את המצלמה…';
    case 'live':
      return onStage
        ? '🔴 אתם על הבמה: כל הצופים רואים אתכם.'
        : '📷 המצלמה דלוקה, ורק המנחה רואה אתכם. אם תעלו לבמה, כל הצופים יראו.';
    case 'reconnecting':
      return 'החיבור נפל, מתחברים מחדש…';
    case 'ended':
      return ENDED_TEXT[state.ended ?? 'closed'];
    case 'error':
      return ERROR_TEXT[state.error ?? 'failed'];
  }
}

export function StageCamBar({
  state,
  onStage,
  canRetry,
  onStop,
  onRetry,
}: {
  state: StageCamState;
  /** לפי מצב המסך: המנחה העלה את המצלמה הזאת לבמה. */
  onStage: boolean;
  /** הבמה עדיין פתוחה, ואפשר לנסות שוב. */
  canRetry: boolean;
  /** כיבוי, או סגירת ההודעה. */
  onStop: () => void;
  onRetry: () => void;
}) {
  if (state.phase === 'off') return null;
  const on = stageCamOn(state);
  const retry = canRetry && !on && state.ended !== 'blocked' && state.ended !== 'replaced';
  const tone = on ? (onStage && state.phase === 'live' ? ' is-onstage' : '') : ' is-ended';
  return (
    <div className={`live-stage-cam${tone}`} dir="rtl" role="status">
      {on && state.stream !== null && (
        <div className="live-stage-cam-preview">
          <StageVideo stream={state.stream} mirror />
        </div>
      )}
      <p className="live-stage-cam-text">{camText(state, onStage)}</p>
      <div className="live-stage-cam-buttons">
        {retry && (
          <button type="button" onClick={onRetry}>
            נסו שוב
          </button>
        )}
        <button type="button" onClick={onStop}>
          {on ? 'כיבוי המצלמה' : 'סגירה'}
        </button>
      </div>
    </div>
  );
}
