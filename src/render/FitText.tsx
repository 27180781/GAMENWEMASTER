/**
 * טקסט שמתכווץ אוטומטית כדי להיכנס במלואו לשדה שלו. משתמש בגודל הפונט מה-CSS
 * כתקרה, ומקטין (חיפוש בינארי) עד שהתוכן לא גולש (לא ברוחב ולא בגובה) או עד
 * הגודל המינימלי. האלמנט חייב overflow:hidden ומידות תחומות (כפי שיש למחלקות
 * הקיימות: q-card-text, winner-name וכו').
 */

import { useLayoutEffect, useRef, type ReactNode } from 'react';

interface FitTextProps {
  children: ReactNode;
  className?: string;
  dir?: string;
  /** גודל מינימלי (px). ברירת מחדל: 45% מגודל ה-CSS, לא פחות מ-12. */
  min?: number;
  /** מזהה תלות נוסף לחישוב מחדש (מעבר לתוכן) — למשל כשהמכל משנה גודל. */
  deps?: unknown;
}

export function FitText({ children, className, dir, min, deps }: FitTextProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.style.fontSize = ''; // איפוס לגודל שמגיע מה-CSS
    const cssSize = parseFloat(getComputedStyle(el).fontSize) || 20;
    const minSize = Math.max(12, min ?? cssSize * 0.45);
    const fits = () => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1;
    if (fits()) return; // כבר נכנס — נשארים בגודל ה-CSS

    let lo = minSize;
    let hi = cssSize;
    let best = minSize;
    while (lo <= hi) {
      const mid = (lo + hi) / 2;
      el.style.fontSize = `${mid}px`;
      if (fits()) {
        best = mid;
        lo = mid + 0.5;
      } else {
        hi = mid - 0.5;
      }
    }
    el.style.fontSize = `${best}px`;
  }, [children, min, deps]);

  return (
    <span ref={ref} className={className} {...(dir !== undefined ? { dir } : {})}>
      {children}
    </span>
  );
}
