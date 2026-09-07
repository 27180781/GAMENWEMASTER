/**
 * קוד הגישה להחלפת המשחק ולעריכתו.
 *
 * שני חלונות: הגדרה ראשונית (פעם אחת, בהתקנה) ופתיחה (לפני כל פעולה חסומה).
 * הלוגיקה עצמה יושבת ב-main (electron/gameGate.cjs) — כאן רק התצוגה.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * החלונות מוצגים דרך portal ל-body, ולא במקום שבו הם נכתבים בעץ.
 * הסיבה: מסכי התוכנה יושבים בתוך "הבמה" שמוקטנת ב-transform: scale, ו-
 * position: fixed בתוך אב עם transform מתנהג כמו absolute — כלומר החלון היה
 * נכלא בתוך הבמה ומוקטן איתה, במקום למלא את החלון.
 */
function Overlay({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  return createPortal(
    <div className="gate-backdrop" role="presentation" {...(onClose ? { onClick: onClose } : {})}>
      {children}
    </div>,
    document.body,
  );
}

/**
 * חלון ההגדרה הראשוני. מוצג פעם אחת, כשהתוכנה עוד לא נשאלה — כולל בהתקנות
 * קיימות שמתעדכנות לגרסה הזו, שם אין עדיין קובץ הגדרות.
 *
 * "בלי קוד" הוא בחירה לגיטימית ומוצג באותה בולטות: לא כל אירוע צריך מחסום,
 * ומחסום שנקבע בהיסח הדעת ונשכח — משבית.
 */
export function GateSetup({ onDone }: { onDone: (code: string | null) => void }) {
  const [code, setCode] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  const save = () => {
    const clean = code.trim();
    if (clean === '') {
      setError('הקלידו קוד, או בחרו "המשך בלי קוד"');
      return;
    }
    if (clean !== again.trim()) {
      setError('שני הקודים אינם זהים');
      return;
    }
    onDone(clean);
  };

  return (
    <Overlay>
      <div className="gate-box" role="dialog" aria-modal="true" aria-label="קוד גישה">
        <h2 className="gate-title">🔒 קוד גישה</h2>
        <p className="gate-lead">
          קוד שחוסם <b>החלפה ועריכה</b> של קובץ המשחק, כדי שלא ישנו אותו בטעות
          במחשב שבאולם. <b>לשחק אפשר תמיד בלי קוד</b> — גם אם שכחתם אותו.
        </p>
        <label className="gate-field">
          <span>קוד</span>
          <input
            ref={first}
            type="password"
            dir="ltr"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
            }}
          />
        </label>
        <label className="gate-field">
          <span>שוב, לאימות</span>
          <input
            type="password"
            dir="ltr"
            value={again}
            onChange={(e) => {
              setAgain(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </label>
        {error !== null && <p className="gate-error">{error}</p>}
        <div className="gate-actions">
          <button type="button" className="gate-primary" onClick={save}>
            שמירת הקוד
          </button>
          <button type="button" className="gate-plain" onClick={() => onDone(null)}>
            המשך בלי קוד
          </button>
        </div>
        <p className="gate-note">
          אפשר לשנות או להסיר את הקוד מאוחר יותר במסך הפתיחה. הקוד נשמר במחשב
          הזה בלבד ונשאר גם אחרי עדכון התוכנה.
        </p>
      </div>
    </Overlay>
  );
}

/** חלון פתיחה לפני פעולה חסומה. `what` מתאר מה נחסם ("החלפת המשחק"…). */
export function GateUnlock({
  what,
  onVerify,
  onClose,
}: {
  what: string;
  onVerify: (code: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = () => {
    if (busy) return;
    setBusy(true);
    void onVerify(code.trim()).then((ok) => {
      setBusy(false);
      if (!ok) {
        setError('קוד שגוי');
        setCode('');
        input.current?.focus();
      }
    });
  };

  return (
    <Overlay onClose={onClose}>
      <div
        className="gate-box"
        role="dialog"
        aria-modal="true"
        aria-label="קוד גישה"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="gate-title">🔒 {what}</h2>
        <p className="gate-lead">הפעולה הזו מוגנת בקוד. הקלידו אותו כדי להמשיך.</p>
        <label className="gate-field">
          <span>קוד</span>
          <input
            ref={input}
            type="password"
            dir="ltr"
            value={code}
            disabled={busy}
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>
        {error !== null && <p className="gate-error">{error}</p>}
        <div className="gate-actions">
          <button type="button" className="gate-primary" disabled={busy} onClick={submit}>
            אישור
          </button>
          <button type="button" className="gate-plain" onClick={onClose}>
            ביטול
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/** שינוי או הסרה של הקוד — דורש את הקוד הנוכחי. */
export function GateChange({
  onChange,
  onClose,
}: {
  onChange: (current: string, next: string | null) => Promise<boolean>;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);

  const apply = (value: string | null) => {
    void onChange(current.trim(), value).then((ok) => {
      if (!ok) setError('הקוד הנוכחי שגוי');
    });
  };

  return (
    <Overlay onClose={onClose}>
      <div
        className="gate-box"
        role="dialog"
        aria-modal="true"
        aria-label="שינוי קוד"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="gate-title">🔒 שינוי קוד הגישה</h2>
        <label className="gate-field">
          <span>הקוד הנוכחי</span>
          <input
            type="password"
            dir="ltr"
            value={current}
            onChange={(e) => {
              setCurrent(e.target.value);
              setError(null);
            }}
          />
        </label>
        <label className="gate-field">
          <span>קוד חדש</span>
          <input
            type="password"
            dir="ltr"
            value={next}
            onChange={(e) => {
              setNext(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && next.trim() !== '' && apply(next.trim())}
          />
        </label>
        {error !== null && <p className="gate-error">{error}</p>}
        <div className="gate-actions">
          <button
            type="button"
            className="gate-primary"
            disabled={next.trim() === ''}
            onClick={() => apply(next.trim())}
          >
            שמירה
          </button>
          <button type="button" className="gate-plain" onClick={() => apply(null)}>
            הסרת הקוד
          </button>
          <button type="button" className="gate-plain" onClick={onClose}>
            ביטול
          </button>
        </div>
      </div>
    </Overlay>
  );
}
