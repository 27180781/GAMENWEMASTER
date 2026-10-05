/**
 * בניית משחק חדש מאפס בתוכנה (בלי מערכת יצירת המשחקים): שם ורישיון, ומשם
 * ישר לעורך. הרישיון נערך גם אחר כך, בעורך (LicenseFields משותף לשניהם).
 *
 * ברירת המחדל לבקשת נסים: קליקרים, ללא הגבלת משתתפים.
 */

import { useEffect, useRef, useState } from 'react';
import { Overlay } from './GateDialog.tsx';
import {
  DEFAULT_LICENSE,
  includesPhones,
  LICENSE_KINDS,
  licenseProblem,
  suggestRoomCode,
  type GameLicense,
} from '../app/gameLicense.ts';
import { JOIN_DIAL_DISPLAY } from '../app/urlParams.ts';

/** שדות הרישיון: סוג ההפעלה, מגבלת המשתתפים וקוד החדר לטלפונים. */
export function LicenseFields({
  value,
  onChange,
}: {
  value: GameLicense;
  onChange: (next: GameLicense) => void;
}) {
  const phones = includesPhones(value.kind);
  /** הטקסט שבשדה המשתתפים — כדי ששדה ריק בזמן הקלדה לא יקפוץ חזרה ל"ללא הגבלה". */
  const [limitText, setLimitText] = useState(value.limit === null ? '' : String(value.limit));

  const setKind = (kind: GameLicense['kind']) => {
    // טלפונים בלי קוד חדר לא יעבדו — מציעים קוד מיד, ואפשר להחליף.
    const room = includesPhones(kind) && value.room.trim() === '' ? suggestRoomCode() : value.room;
    onChange({ ...value, kind, room });
  };

  return (
    <div className="lic">
      <div className="lic-kinds" role="radiogroup" aria-label="סוג הרישיון">
        {LICENSE_KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            role="radio"
            aria-checked={value.kind === k.value}
            className={value.kind === k.value ? 'lic-kind is-on' : 'lic-kind'}
            title={k.hint}
            onClick={() => setKind(k.value)}
          >
            <span className="lic-kind-icon" aria-hidden="true">
              {k.icon}
            </span>
            <span className="lic-kind-label">{k.label}</span>
          </button>
        ))}
      </div>

      <label className="lic-check">
        <input
          type="checkbox"
          checked={value.limit === null}
          onChange={(e) => {
            if (e.target.checked) {
              onChange({ ...value, limit: null });
              setLimitText('');
            } else {
              onChange({ ...value, limit: 100 });
              setLimitText('100');
            }
          }}
        />
        <span>ללא הגבלת משתתפים</span>
      </label>
      {value.limit !== null && (
        <label className="lic-field">
          <span>מספר משתתפים מרבי</span>
          <input
            type="number"
            dir="ltr"
            min={1}
            step={1}
            value={limitText}
            onChange={(e) => {
              setLimitText(e.target.value);
              const n = Number(e.target.value);
              // שדה ריק או לא תקין נשמר כ-0, ובדיקת הרישיון מסמנת אותו.
              onChange({ ...value, limit: e.target.value.trim() === '' || !Number.isFinite(n) ? 0 : n });
            }}
          />
        </label>
      )}

      {phones && (
        <>
          <label className="lic-field">
            <span>קוד החדר לטלפונים</span>
            <span className="lic-room">
              <input
                type="text"
                dir="ltr"
                inputMode="numeric"
                maxLength={6}
                value={value.room}
                onChange={(e) => onChange({ ...value, room: e.target.value.replace(/\D/g, '') })}
              />
              <button
                type="button"
                className="lic-dice"
                title="קוד אחר"
                onClick={() => onChange({ ...value, room: suggestRoomCode() })}
              >
                🎲
              </button>
            </span>
          </label>
          <p className="lic-hint">
            המשתתפים מחייגים ל-<b dir="ltr">{JOIN_DIAL_DISPLAY}</b> ומקישים את הקוד. ההצבעה
            מהטלפון דורשת אינטרנט במחשב בזמן המשחק. יש לכם רישיון טלפונים מהאתר? אפשר
            להקליד כאן את הקוד שלו. שני משחקים שרצים באותו זמן עם אותו קוד יקבלו את
            אותן הצבעות.
          </p>
        </>
      )}
    </div>
  );
}

/** חלון "משחק חדש". `onCreate` מחזיר הודעת שגיאה, או null כשהמשחק נוצר. */
export function NewGameDialog({
  onCreate,
  onClose,
}: {
  onCreate: (name: string, license: GameLicense) => Promise<string | null>;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [license, setLicense] = useState<GameLicense>(DEFAULT_LICENSE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  const create = async () => {
    if (busy) return;
    if (name.trim() === '') {
      setError('תנו למשחק שם');
      return;
    }
    const problem = licenseProblem(license);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setBusy(true);
    const failure = await onCreate(name.trim(), license);
    setBusy(false);
    if (failure !== null) setError(failure);
  };

  return (
    <Overlay {...(busy ? {} : { onClose })}>
      <div
        className="gate-box new-game-box"
        role="dialog"
        aria-modal="true"
        aria-label="משחק חדש"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="gate-title">✨ משחק חדש</h2>
        <p className="gate-lead">
          משחק ריק שנבנה כאן במחשב, בלי מערכת יצירת המשחקים. אחרי היצירה נפתח העורך
          להוספת שאלות, מדיה ועיצוב.
        </p>
        <label className="gate-field new-game-name">
          <span>שם המשחק</span>
          <input
            ref={first}
            type="text"
            value={name}
            maxLength={120}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
          />
        </label>
        <div className="new-game-section">
          <h3 className="new-game-sub">🔑 רישיון</h3>
          <LicenseFields
            value={license}
            onChange={(next) => {
              setLicense(next);
              setError(null);
            }}
          />
        </div>
        {error !== null && <p className="gate-error">{error}</p>}
        <div className="gate-actions">
          <button type="button" className="gate-primary" disabled={busy} onClick={() => void create()}>
            {busy ? 'יוצר…' : '✨ צור משחק ופתח עריכה'}
          </button>
          <button type="button" className="gate-plain" disabled={busy} onClick={onClose}>
            ביטול
          </button>
        </div>
        <p className="gate-note">
          המשחק נשמר במחשב הזה ברשימת המשחקים שבמסך הפתיחה. אין לו עותק באתר, ולכן מחיקה
          שלו היא סופית. את הרישיון אפשר לשנות אחר כך בעורך.
        </p>
      </div>
    </Overlay>
  );
}
