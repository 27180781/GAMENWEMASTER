/**
 * הכפתורים של המנחה לווידאו המנחה: סקציה בתפריט המפעיל (`HostVideoPanel` —
 * הפעלה, מצלמה, מיקרופון, בחירת מכשירים ותצוגה מקדימה), ותג קטן בפינת המסך
 * הראשי (`HostVideoChip`) להפעלה ולכיבוי מהיר באמצע המשחק.
 *
 * הכפתורים לא לוקחים פוקוס (mousedown → preventDefault): רווח הוא «השלב
 * הבא» של המנחה, ולחיצה עליו אחרי לחיצה על כפתור הייתה מפעילה גם את הכפתור.
 */

import { useEffect, useRef, type MouseEvent } from 'react';
import type { HostVideoError, HostVideoState } from './hostVideo.ts';
import type { DeviceOption, HostVideoHandle } from './useHostVideo.ts';
import './hostVideo.css';

const keepFocus = (event: MouseEvent) => event.preventDefault();

const ERROR_TEXT: Record<HostVideoError, string> = {
  'not-configured': 'וידאו המנחה עוד לא הופעל בשרת.',
  'not-entitled': 'הרישיון של המשחק לא כולל וידאו מנחה.',
  permission:
    'הדפדפן לא קיבל גישה למצלמה ולמיקרופון. אשרו גישה (סמל המצלמה בשורת הכתובת) ונסו שוב.',
  'no-devices': 'לא נמצאו מצלמה או מיקרופון במחשב.',
  busy: 'המצלמה או המיקרופון תפוסים בתוכנה אחרת (למשל זום). סגרו אותה ונסו שוב.',
  unsupported: 'הדפדפן הזה לא תומך בשידור וידאו. נסו בכרום.',
  failed: 'ההפעלה נכשלה. נסו שוב.',
};

const ERROR_SHORT: Record<HostVideoError, string> = {
  'not-configured': 'לא זמין בשרת',
  'not-entitled': 'לא כלול ברישיון',
  permission: 'אין גישה למצלמה',
  'no-devices': 'לא נמצאה מצלמה',
  busy: 'המצלמה תפוסה',
  unsupported: 'הדפדפן לא תומך',
  failed: 'נכשל, נסו שוב',
};

function isOn(state: HostVideoState): boolean {
  return state.phase === 'starting' || state.phase === 'live' || state.phase === 'reconnecting';
}

function viewersText(state: HostVideoState): string {
  const cap = state.maxViewers === null ? '' : ` (עד ${state.maxViewers})`;
  return state.viewers === 1 ? `צופה אחד בווידאו${cap}` : `${state.viewers} צופים בווידאו${cap}`;
}

function statusText(state: HostVideoState): string {
  switch (state.phase) {
    case 'off':
      return 'כבוי. הצופים רואים רק את מסך המשחק.';
    case 'starting':
      return 'מפעילים מצלמה ומיקרופון…';
    case 'live':
      return `🔴 משודר לצופים · ${viewersText(state)}`;
    case 'reconnecting':
      return 'החיבור נפל, מתחברים מחדש…';
    case 'superseded':
      return 'השידור עבר למסך אחר שפתוח עם המשחק הזה.';
    case 'error':
      return ERROR_TEXT[state.error ?? 'failed'];
  }
}

/** המכשיר שבשימוש בפועל — הבחירה שנשמרה אולי כבר לא מחוברת. */
function activeDevice(stream: MediaStream | null, kind: 'video' | 'audio'): string | null {
  const track = kind === 'video' ? stream?.getVideoTracks()[0] : stream?.getAudioTracks()[0];
  return track?.getSettings().deviceId ?? null;
}

function DeviceSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: DeviceOption[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  if (options.length < 2) return null;
  return (
    <label className="host-video-device">
      {label}:{' '}
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        {value === null && <option value="">ברירת המחדל</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** התצוגה המקדימה — כמו מראה, כמו בכל תוכנת שיחות. */
function SelfPreview({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.srcObject = stream;
    void el.play().catch(() => {});
  }, [stream]);
  return <video ref={ref} className="host-video-preview" autoPlay playsInline muted />;
}

export function HostVideoPanel({ video }: { video: HostVideoHandle }) {
  const { state } = video;
  const on = isOn(state);
  const live = state.phase === 'live' || state.phase === 'reconnecting';
  const camera = activeDevice(state.stream, 'video') ?? video.camera;
  const mic = activeDevice(state.stream, 'audio') ?? video.mic;
  const missing =
    live && (!state.hasCam || !state.hasMic)
      ? !state.hasCam
        ? 'לא נמצאה מצלמה, או שהיא תפוסה בתוכנה אחרת. הצופים שומעים אתכם בלבד.'
        : 'לא נמצא מיקרופון, או שהוא תפוס בתוכנה אחרת. הצופים רואים אתכם בלי קול.'
      : null;

  return (
    <section className="host-video-panel">
      <h3>📹 וידאו וקול של המנחה במסך הצפייה</h3>
      <div className="host-video-body">
        <div className="host-video-main">
          <p className={`host-video-status${state.phase === 'error' ? ' is-error' : ''}`}>
            {statusText(state)}
          </p>
          {missing !== null && <p className="host-video-hint">{missing}</p>}
          <div className="host-video-buttons">
            {on ? (
              <button onMouseDown={keepFocus} onClick={video.stop}>
                ⏹ כיבוי הווידאו
              </button>
            ) : (
              <button className="host-video-start" onMouseDown={keepFocus} onClick={video.start}>
                ▶ הפעלת וידאו וקול
              </button>
            )}
            {live && (
              <>
                <button
                  onMouseDown={keepFocus}
                  onClick={() => video.setCam(!state.cam)}
                  disabled={!state.hasCam}
                >
                  {state.cam ? '📷 מצלמה: דלוקה' : '🚫 מצלמה: כבויה'}
                </button>
                <button
                  onMouseDown={keepFocus}
                  onClick={() => video.setMic(!state.mic)}
                  disabled={!state.hasMic}
                >
                  {state.mic ? '🎤 מיקרופון: דלוק' : '🔇 מיקרופון: כבוי'}
                </button>
              </>
            )}
          </div>
          {live && (
            <div className="host-video-devices">
              <DeviceSelect
                label="מצלמה"
                options={video.cameras}
                value={camera}
                onChange={(id) => video.choose('video', id)}
              />
              <DeviceSelect
                label="מיקרופון"
                options={video.mics}
                value={mic}
                onChange={(id) => video.choose('audio', id)}
              />
            </div>
          )}
        </div>
        {state.stream !== null && state.cam && <SelfPreview stream={state.stream} />}
      </div>
    </section>
  );
}

/** התג בפינת המסך הראשי. */
export function HostVideoChip({ video }: { video: HostVideoHandle }) {
  const { state } = video;
  if (!isOn(state)) {
    const error = state.phase === 'error' ? ERROR_SHORT[state.error ?? 'failed'] : null;
    return (
      <div className="host-video-chip is-off" dir="rtl">
        <button
          tabIndex={-1}
          onMouseDown={keepFocus}
          onClick={video.start}
          title={
            state.phase === 'error'
              ? ERROR_TEXT[state.error ?? 'failed']
              : 'הפעלת המצלמה והמיקרופון שלכם במסך הצפייה של המשתתפים'
          }
        >
          📹 {error ?? (state.phase === 'superseded' ? 'הווידאו עבר למסך אחר' : 'וידאו לצופים')}
        </button>
      </div>
    );
  }
  const live = state.phase === 'live';
  return (
    <div className="host-video-chip" dir="rtl">
      <span className="host-video-chip-state" title={statusText(state)}>
        {live ? `🔴 ${state.viewers}` : '⏳'}
      </span>
      <button
        tabIndex={-1}
        onMouseDown={keepFocus}
        onClick={() => video.setCam(!state.cam)}
        disabled={!state.hasCam}
        className={state.cam ? '' : 'is-muted'}
        title={state.cam ? 'כיבוי המצלמה' : 'הדלקת המצלמה'}
      >
        {state.cam ? '📷' : '🚫'}
      </button>
      <button
        tabIndex={-1}
        onMouseDown={keepFocus}
        onClick={() => video.setMic(!state.mic)}
        disabled={!state.hasMic}
        className={state.mic ? '' : 'is-muted'}
        title={state.mic ? 'השתקת המיקרופון' : 'הפעלת המיקרופון'}
      >
        {state.mic ? '🎤' : '🔇'}
      </button>
      <button tabIndex={-1} onMouseDown={keepFocus} onClick={video.stop} title="כיבוי הווידאו">
        ⏹
      </button>
    </div>
  );
}
