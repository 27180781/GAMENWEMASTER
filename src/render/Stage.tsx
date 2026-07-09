/**
 * ה"במה" — משטח עיצוב לוגי קבוע של 1920×1080 (16:9).
 * כל המסכים מעוצבים במידות פיקסל קבועות ביחס ל-1080p, והבמה כולה
 * מוקטנת/מוגדלת ב-transform: scale כך שתמיד תיכנס במסך במלואה —
 * בלי גלילה לעולם, עם פסים שחורים כשהמסך אינו 16:9.
 *
 * המיקום מחושב בפיקסלים (translate לפני scale עם origin בפינה) ולא
 * באחוזים — אחוזי translate מתייחסים לגודל הלוגי (1920) ולא למוקטן,
 * מה ששובר את המרכוז בכל מסך שאינו 16:9.
 */

import { useLayoutEffect, useState, type ReactNode } from 'react';

export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;

/** יחס ההקטנה/הגדלה שממקם את הבמה בתוך ה-viewport בלי לחתוך ובלי לגלול. */
export function stageScale(viewportWidth: number, viewportHeight: number): number {
  if (viewportWidth <= 0 || viewportHeight <= 0) return 1;
  return Math.min(viewportWidth / STAGE_WIDTH, viewportHeight / STAGE_HEIGHT);
}

/** ה-transform המלא: מרכוז בפיקסלים + סקייל, עם origin בפינת הבמה. */
export function stageTransform(viewportWidth: number, viewportHeight: number): string {
  const scale = stageScale(viewportWidth, viewportHeight);
  const offsetX = (viewportWidth - STAGE_WIDTH * scale) / 2;
  const offsetY = (viewportHeight - STAGE_HEIGHT * scale) / 2;
  return `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
}

function currentTransform(): string {
  return stageTransform(window.innerWidth, window.innerHeight);
}

export function Stage({ children }: { children: ReactNode }) {
  const [transform, setTransform] = useState(currentTransform);

  useLayoutEffect(() => {
    const update = () => setTransform(currentTransform());
    window.addEventListener('resize', update);
    update();
    return () => window.removeEventListener('resize', update);
  }, []);

  return (
    <div className="stage" style={{ transform }}>
      {children}
    </div>
  );
}
