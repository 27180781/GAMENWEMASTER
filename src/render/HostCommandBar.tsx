/**
 * שורת כפתורי פקודה בתחתית המסך (חלופה לפס ההנחיות). כפתורים קטנים בכתב חלש
 * שמתחזק בהובר, אחד לכל פקודת מנחה רלוונטית לשלב הנוכחי — עם *שם הפקודה* (ולא
 * המספר). לחיצה מריצה את הפקודה. הרשימה משתנה לפי מצב המשחק (מגיעה מ-hostKeyHints).
 * "רווח" מוצג כחץ המשך; "4/5" (‎±10 שניות) מפוצל לשני כפתורים.
 */

import type { HostHint } from '../app/hostHints.ts';

interface HostCommandBarProps {
  hints: HostHint[];
  /** מריץ את הפקודה של מקש נתון (אותם מקשים כמו במקלדת: 'רווח','1'..'6','N'). */
  onRun: (key: string) => void;
}

interface CmdButton {
  key: string;
  /** סמל קטן לפני הכיתוב (חץ המשך/חזרה וכו'). */
  icon?: string;
  label: string;
  primary?: boolean;
}

/** ממיר רמז-מקש לכפתור/ים להצגה (מפצל את '4/5' לשניים). */
function toButtons(hint: HostHint): CmdButton[] {
  switch (hint.key) {
    case 'רווח':
      return [{ key: 'רווח', icon: '⏭', label: hint.label, primary: true }];
    case '2':
      return [{ key: '2', icon: '⏮', label: hint.label }];
    case '4/5':
      return [
        { key: '4', icon: '＋', label: '10 שניות' },
        { key: '5', icon: '－', label: '10 שניות' },
      ];
    default:
      return [{ key: hint.key, label: hint.label }];
  }
}

export function HostCommandBar({ hints, onRun }: HostCommandBarProps) {
  const buttons = hints.flatMap(toButtons);
  return (
    <div className="host-cmd-bar" dir="rtl">
      {buttons.map((b) => (
        <button
          key={b.key + b.label}
          className={`host-cmd-btn${b.primary ? ' host-cmd-btn--primary' : ''}`}
          onClick={() => onRun(b.key)}
          title={b.label}
        >
          {b.icon !== undefined && <span className="host-cmd-icon">{b.icon}</span>}
          <span className="host-cmd-label">{b.label}</span>
        </button>
      ))}
    </div>
  );
}
