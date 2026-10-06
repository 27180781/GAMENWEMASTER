/**
 * שלט ההצבעה של מסך הצפייה, וחלונית השם שלפניו. הכללים (מתי פתוח, אילו
 * כפתורים, מה נשלח) ב-votePad.ts.
 */

import { useRef, useState, type FormEvent } from 'react';
import type { LiveSnapshot } from './types.ts';
import {
  PLAYER_NAME_MAX,
  cleanPlayerName,
  padRoom,
  padView,
  playerNameProblem,
  postToVoteServer,
  readSavedPlayerName,
  voteFields,
  type PadKey,
  type PadMode,
  type PadView,
} from './votePad.ts';

/** חלונית השם: בהתחלה, ובכל פעם שהצופה בוחר להחליף שם או לחזור להצבעה. */
export function JoinCard({
  initialName,
  gameName,
  changing,
  onJoin,
  onWatch,
}: {
  /** השם הנוכחי כשמחליפים; null — השם ששמור מהביקור הקודם, אם יש. */
  initialName: string | null;
  gameName: string;
  /** החלפת שם באמצע (ולא כניסה ראשונה). */
  changing: boolean;
  onJoin: (name: string) => void;
  onWatch: () => void;
}) {
  const [name, setName] = useState(() => initialName ?? readSavedPlayerName());
  // מקלדת נפתחת רק כשבאמת צריך להקליד — לא כשהשם כבר ממולא מהביקור הקודם.
  const [focusInput] = useState(() => changing || name === '');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const clean = cleanPlayerName(name);
    const problem = playerNameProblem(clean);
    if (problem !== null) {
      setError(problem);
      return;
    }
    onJoin(clean);
  };

  return (
    <div
      className="live-join"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="live-join-title"
    >
      <form className="live-join-box" onSubmit={submit}>
        <div className="live-join-icon" aria-hidden="true">
          🙋
        </div>
        <h2 id="live-join-title">{changing ? 'החלפת שם' : 'רוצים לענות מכאן?'}</h2>
        <p className="live-join-sub">
          {changing
            ? 'שם חדש נכנס למשחק כמשתתף חדש, בלי הניקוד שצברתם עד עכשיו.'
            : `כתבו את השם שלכם, ושלט הצבעה יופיע ליד המסך${gameName !== '' ? ` של «${gameName}»` : ''}.`}
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
          autoFocus={focusInput}
        />
        {error !== null ? (
          <p className="live-join-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="live-join-hint">השם יופיע במשחק ומזהה אתכם בו, אז כדאי שיהיה רק שלכם.</p>
        )}
        <button type="submit" className="live-join-go">
          {changing ? 'שמירה' : 'כניסה למשחק'}
        </button>
        <button type="button" className="live-join-watch" onClick={onWatch}>
          {changing ? 'ביטול' : 'רק לצפות'}
        </button>
      </form>
    </div>
  );
}

type SendStatus = 'sending' | 'sent' | 'failed';

interface Choice {
  windowKey: string;
  key: PadKey;
  status: SendStatus;
  seq: number;
}

/** אותו חלון, אותם כפתורים — כדי לא לעדכן מצב בכל עדכון של המסך הראשי. */
function sameView(a: PadView | null, b: PadView): boolean {
  return (
    a !== null &&
    a.mode === b.mode &&
    a.windowKey === b.windowKey &&
    a.changeable === b.changeable &&
    a.keys.length === b.keys.length &&
    a.keys.every((k, i) => {
      const o = b.keys[i]!;
      return k.value === o.value && k.label === o.label && k.bg === o.bg;
    })
  );
}

/** השלט עצמו: בצד המסך (לרוחב) או מתחתיו (טלפון לאורך). */
export function VotePad({
  snap,
  name,
  voteServerUrl,
  onChangeName,
  onClose,
}: {
  snap: LiveSnapshot;
  name: string;
  voteServerUrl: string;
  onChangeName: () => void;
  onClose: () => void;
}) {
  const view = padView(snap);
  const room = padRoom(snap);
  // בין שאלה לשאלה מוצגים הכפתורים של השאלה האחרונה, כבויים, עם מה שבחרתם —
  // כדי שבחשיפה יהיה ברור מה עניתם.
  const [lastOpen, setLastOpen] = useState<PadView | null>(null);
  if (view.mode !== 'closed' && !sameView(lastOpen, view)) setLastOpen(view);
  const shown = view.mode !== 'closed' ? view : lastOpen;

  const [choice, setChoice] = useState<Choice | null>(null);
  const seqRef = useRef(0);
  // הצבעה שנפתחת מחדש (גם על אותה שקופית) מתחילה נקייה — כך עושה גם המסך הראשי.
  const [prevMode, setPrevMode] = useState<PadMode>(view.mode);
  if (prevMode !== view.mode) {
    setPrevMode(view.mode);
    if (prevMode === 'closed') setChoice(null);
  }
  const mine =
    choice !== null && shown !== null && choice.windowKey === shown.windowKey ? choice : null;
  const locked = mine !== null && !view.changeable && mine.status !== 'failed';
  const open = view.mode === 'answers' || view.mode === 'groups';
  const disabled = !open || room === null || locked;

  const press = (key: PadKey) => {
    if (disabled || room === null) return;
    seqRef.current += 1;
    const seq = seqRef.current;
    setChoice({ windowKey: view.windowKey, key, status: 'sending', seq });
    navigator.vibrate?.(15);
    void postToVoteServer(
      voteServerUrl,
      '/game/voting',
      voteFields(room, name, key.value, Date.now()),
    ).then((ok) =>
      setChoice((current) =>
        current !== null && current.seq === seq
          ? { ...current, status: ok ? 'sent' : 'failed' }
          : current,
      ),
    );
  };

  let status: string;
  if (view.mode === 'paused') status = '⏸ ההצבעה עצורה כרגע';
  else if (view.mode === 'groups') status = 'הקישו את מספר הקבוצה שלכם';
  else if (view.mode === 'answers')
    status =
      mine === null
        ? 'ההצבעה פתוחה, בחרו תשובה'
        : view.changeable
          ? 'אפשר לשנות עד שההצבעה נסגרת'
          : mine.status === 'failed'
            ? 'ההצבעה פתוחה, בחרו תשובה'
            : 'התשובה שלכם נשלחה';
  else status = lastOpen === null ? 'הכפתורים יופיעו כשתיפתח שאלה' : 'ההצבעה נסגרה';

  const columns = shown !== null && shown.keys.length > 4 ? 3 : 2;

  return (
    <aside className={`live-pad live-pad--${view.mode}`} dir="rtl" aria-label="שלט הצבעה">
      <div className="live-pad-head">
        <div className="live-pad-who">
          <span className="live-pad-name" title={name}>
            👤 {name}
          </span>
          <button type="button" className="live-pad-link" onClick={onChangeName}>
            החלפת שם
          </button>
        </div>
        <button
          type="button"
          className="live-pad-close"
          onClick={onClose}
          title="סגירת השלט"
          aria-label="סגירת השלט"
        >
          ✕
        </button>
      </div>
      <p className={`live-pad-status${open ? ' is-open' : ''}`} role="status">
        {status}
      </p>
      {shown === null ? (
        <div className="live-pad-empty" aria-hidden="true">
          ⏳
        </div>
      ) : (
        <div className="live-pad-keys" style={{ ['--pad-cols' as string]: columns }}>
          {shown.keys.map((key) => {
            const picked = mine !== null && mine.key.value === key.value;
            return (
              <button
                key={`${shown.windowKey}:${key.value}`}
                type="button"
                className={`live-pad-key${picked ? ' is-picked' : ''}`}
                style={{ background: key.bg, color: key.fg }}
                disabled={disabled}
                onClick={() => press(key)}
                aria-pressed={picked}
                aria-label={shown.mode === 'groups' ? `קבוצה ${key.label}` : `תשובה ${key.label}`}
              >
                {key.label}
                {picked && (
                  <span className="live-pad-check" aria-hidden="true">
                    {mine.status === 'failed' ? '!' : mine.status === 'sending' ? '…' : '✓'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <p className="live-pad-note" aria-live="polite">
        {mine === null
          ? ' '
          : mine.status === 'sending'
            ? `שולחים: ${mine.key.label}…`
            : mine.status === 'sent'
              ? `בחרתם: ${mine.key.label}`
              : 'לא נשלח, נסו שוב'}
      </p>
    </aside>
  );
}
