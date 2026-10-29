/**
 * חלון "להמשיך?" של התוכנה, במקום window.confirm.
 *
 * למה לא window.confirm: ב-Electron ב-Windows, אחרי שחלון האישור המובנה נסגר,
 * המקלדת כבר לא מגיעה לשדות הטקסט של החלון עד שהתוכנה נפתחת מחדש (או עד
 * Alt+Tab). כך, אחרי מחיקת משחק אחד מהרשימה, אי אפשר היה להקליד את קוד הגישה
 * למחיקה הבאה. חלון שמצויר בתוך הדף לא מוציא את המיקוד מהחלון, ולכן אין
 * לו את הבעיה. tests/noNativeConfirm.test.ts שומר שלא יחזור לקוד.
 *
 * askConfirm מחזירה Promise: true באישור, false בביטול, ב-Esc או בלחיצה על הרקע.
 */

import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Overlay } from './GateDialog.tsx';

export interface ConfirmOptions {
  /** כותרת מודגשת מעל ההודעה. בלעדיה מוצגת ההודעה לבדה. */
  title?: string;
  /** הטקסט של כפתור האישור. ברירת מחדל: "אישור". */
  confirmLabel?: string;
  /** פעולה שאי אפשר לבטל (מחיקה): כפתור האישור אדום. */
  danger?: boolean;
}

let open: Promise<boolean> | null = null;

export function askConfirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  // חלון אחד בכל פעם. בקשה שנייה בזמן שחלון פתוח (מקש שנלחץ שוב) נענית "לא".
  if (open !== null || typeof document === 'undefined') return Promise.resolve(false);
  const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  open = new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      root.unmount();
      host.remove();
      open = null;
      if (before?.isConnected) before.focus();
      resolve(ok);
    };
    root.render(<ConfirmBox message={message} options={options} onDone={finish} />);
  });
  return open;
}

function ConfirmBox({
  message,
  options,
  onDone,
}: {
  message: string;
  options: ConfirmOptions;
  onDone: (ok: boolean) => void;
}) {
  const yes = useRef<HTMLButtonElement>(null);
  const no = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    yes.current?.focus();
    // בשלב ה-capture על window, לפני כל מאזין אחר: בזמן שהחלון פתוח, Enter או רווח
    // לא יקדמו את המשחק שמאחור ו-Esc לא יסגור את העורך. Tab נשאר, למעבר בין הכפתורים.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') return;
      e.stopImmediatePropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        onDone(false);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!e.repeat) onDone(document.activeElement !== no.current);
      } else {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onDone]);

  return (
    <Overlay onClose={() => onDone(false)}>
      <div
        className="gate-box confirm-box"
        role="alertdialog"
        aria-modal="true"
        aria-label={options.title ?? 'אישור'}
        onClick={(e) => e.stopPropagation()}
      >
        {options.title !== undefined && <h2 className="gate-title">{options.title}</h2>}
        <p className="gate-lead confirm-message">{message}</p>
        <div className="gate-actions">
          <button
            ref={yes}
            type="button"
            className={options.danger ? 'gate-primary confirm-danger' : 'gate-primary'}
            onClick={() => onDone(true)}
          >
            {options.confirmLabel ?? 'אישור'}
          </button>
          <button ref={no} type="button" className="gate-plain" onClick={() => onDone(false)}>
            ביטול
          </button>
        </div>
      </div>
    </Overlay>
  );
}
