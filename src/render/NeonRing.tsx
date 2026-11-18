/**
 * קו הניאון שמצטייר סביב קפסולה — ערכת 'neondraw' («ניאון מצטייר»).
 *
 * רכיב קישוטי בלבד: SVG במיקום אבסולוטי על תיבת הריפוד של ההורה (inset: 0), בלי
 * שום השפעה על הפריסה (כללי הברזל ב-src/render/themes.css). בכל ערכה אחרת הוא
 * display:none (styles.css), והמדידה לא רצה.
 *
 * למה SVG ולא CSS: הקו צריך להתקדם במהירות אחידה לאורך כל הקפסולה — pathLength=100
 * ו-stroke-dashoffset מ-100 ל-0. מסכת conic מהמרכז מאיצה מאוד לקראת הקצוות של
 * קפסולה רחבה. הרדיוס נמדד מההורה (border-radius: 999px ⇐ חצי גובה), כך שהקו יושב
 * בדיוק על הקפסולה, וגם על כרטיס תמונה (פינות 26px).
 *
 * הקו מתחיל בפינה הימנית העליונה ומתקדם שמאלה (כיוון הקריאה). ההנפשה עצמה
 * ב-src/render/themes/neondraw.css: הקו מצטייר כשההורה מאבד את reveal-hidden — ברגע
 * החשיפה — ולכן מחדש בכל שאלה ובכל תשובה.
 */

import { useId, useLayoutEffect, useRef, useState } from 'react';

/** רוחב הקו כמו ב-‎.neon-ring-line‎ (neondraw.css) — כדי שלא ייחתך בשולי ה-SVG. */
const STROKE = 4;
/** הקו נכנס פנימה בחצי רוחב + פיקסל, כך שגם בהורה עם overflow:hidden הוא שלם. */
const INSET = STROKE / 2 + 1;

interface Box {
  w: number;
  h: number;
  /** רדיוס הפינה הפנימי של ההורה (border-radius פחות עובי המסגרת). */
  r: number;
}

function measure(svg: SVGSVGElement, host: HTMLElement): Box | null {
  // ערכה אחרת: ‎.neon-ring‎ מוסתר — אין מה למדוד
  if (getComputedStyle(svg).display === 'none') return null;
  // תיבת הריפוד, בלי transform: בבמה המוקטנת (scale) זה עדיין גודל הפריסה
  const w = host.clientWidth;
  const h = host.clientHeight;
  if (w === 0 || h === 0) return null;
  const radius = parseFloat(getComputedStyle(host).borderTopLeftRadius) || 0;
  return { w, h, r: Math.max(0, radius - host.clientTop) };
}

export function NeonRing() {
  const ref = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  // useId מחזיר ":r1:" — נקודתיים שוברות את url(#…) בחלק מהדפדפנים
  const gradientId = `nr-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  useLayoutEffect(() => {
    const svg = ref.current;
    const host = svg?.parentElement;
    if (!svg || !host) return undefined;
    const update = () => {
      const next = measure(svg, host);
      if (next === null) return;
      setBox((prev) => (prev !== null && prev.w === next.w && prev.h === next.h && prev.r === next.r ? prev : next));
    };
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const w = box?.w ?? 0;
  const h = box?.h ?? 0;
  const rx = box === null ? 0 : Math.max(0, Math.min(box.r, h / 2) - INSET);
  const shape = { x: INSET, y: INSET, width: Math.max(0, w - INSET * 2), height: Math.max(0, h - INSET * 2), rx, ry: rx };

  return (
    <svg
      ref={ref}
      className="neon-ring"
      aria-hidden="true"
      focusable="false"
      viewBox={box === null ? undefined : `0 0 ${w} ${h}`}
      preserveAspectRatio="none"
    >
      {box !== null && (
        <>
          <defs>
            {/* מראה: אחרי ההיפוך האופקי של הקבוצה, כחול נשאר משמאל-למטה ומג'נטה מימין-למעלה */}
            <linearGradient id={gradientId} x1="1" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#2f6bff" />
              <stop offset="0.45" stopColor="#7a3dff" />
              <stop offset="0.75" stopColor="#c33cff" />
              <stop offset="1" stopColor="#ff3fcf" />
            </linearGradient>
          </defs>
          {/* rect מתחיל ב-(x+rx, y) ומתקדם עם השעון; ההיפוך מתחיל אותו מימין, נגד השעון */}
          <g transform={`translate(${w} 0) scale(-1 1)`}>
            <rect className="neon-ring-line" pathLength={100} stroke={`url(#${gradientId})`} {...shape} />
            <rect className="neon-ring-core" pathLength={100} {...shape} />
          </g>
        </>
      )}
    </svg>
  );
}
