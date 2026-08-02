/**
 * כפתורי חלון: מסך מלא ומזעור.
 *
 * ב-EXE הם מפעילים את חלון Electron עצמו (ראו windowMode.ts) — כך אפשר לצאת
 * ממסך מלא, לתפוס את החלון ולגרור אותו למסך השני, או למזער אותו. בדפדפן
 * נשארים עם Fullscreen API, בדיוק כמו קודם, ובלי כפתור מזעור.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  canQuit,
  desktopBridge,
  desktopQuit,
  getWindowState,
  minimizeWindow,
  onWindowState,
  setWindowFullscreen,
} from '../app/clickerBridge.ts';
import { canMinimize, windowMode } from '../app/windowMode.ts';

/** מצב מסך-מלא + הפעולות עליו, לפי הסביבה שבה רצים. */
export function useWindowMode() {
  const [mode] = useState(() => windowMode(desktopBridge()));
  const [fullscreen, setFullscreen] = useState(() =>
    mode === 'desktop' ? true : document.fullscreenElement !== null,
  );

  useEffect(() => {
    if (mode === 'browser') {
      const onChange = () => setFullscreen(document.fullscreenElement !== null);
      document.addEventListener('fullscreenchange', onChange);
      return () => document.removeEventListener('fullscreenchange', onChange);
    }
    // ב-EXE המצב האמיתי נמצא ב-main; קוראים אותו פעם אחת ואז מקשיבים לשינויים
    // (כולל F11 ומנהל החלונות של Windows), כדי שהכפתור לא ישקר.
    let alive = true;
    void getWindowState().then((state) => {
      if (alive && state !== null) setFullscreen(state.fullscreen);
    });
    const off = onWindowState((state) => setFullscreen(state.fullscreen));
    return () => {
      alive = false;
      off();
    };
  }, [mode]);

  const toggleFullscreen = useCallback(() => {
    if (mode === 'desktop') {
      void setWindowFullscreen(!fullscreen);
      return;
    }
    if (document.fullscreenElement !== null) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  }, [mode, fullscreen]);

  const minimize = useCallback(() => {
    void minimizeWindow();
  }, []);

  return { fullscreen, toggleFullscreen, minimize, canMinimize: canMinimize(mode) };
}

/** הכפתורים עצמם — לשימוש בתוך מיכל כפתורי הפינה הקיים. */
export function WindowControls() {
  const { fullscreen, toggleFullscreen, minimize, canMinimize: showMinimize } = useWindowMode();
  // ב-EXE יציאה ממסך מלא היא הדרך לתפוס את החלון ולגרור אותו למסך השני —
  // ולכן ההסבר הזה מופיע רק שם.
  const exitTitle = showMinimize ? 'יציאה ממסך מלא (לגרירה למסך אחר)' : 'יציאה ממסך מלא';
  return (
    <>
      {showMinimize && (
        <button className="win-btn" title="מזעור החלון" onClick={minimize}>
          🗕
        </button>
      )}
      <button
        className="win-btn"
        title={fullscreen ? exitTitle : 'מסך מלא'}
        onClick={toggleFullscreen}
      >
        {fullscreen ? '🗗' : '⛶'}
      </button>
    </>
  );
}

/**
 * אותם כפתורים כשכבה צפה — למסכים שאינם המשחק (טעינת קובץ, הגדרות, עורך).
 * נוסף כאן גם כפתור סגירה: במשחק עצמו ESC פותח אישור יציאה, אבל במסכים
 * שלפניו לא הייתה שום דרך לסגור את החלון (הוא נפתח בלי מסגרת).
 */
export function FloatingWindowControls() {
  const { canMinimize: showMinimize } = useWindowMode();
  // בדפדפן אין מה להוסיף: המסכים האלה ניתנים לגרירה ממילא, וכפתור מסך-מלא
  // כבר קיים בתוך המשחק.
  if (!showMinimize) return null;
  return (
    <div className="corner-buttons corner-buttons--floating">
      {canQuit() && (
        <button
          className="win-btn win-btn--close"
          title="סגירת התוכנה"
          onClick={() => {
            if (window.confirm('לסגור את התוכנה?')) desktopQuit();
          }}
        >
          ✕
        </button>
      )}
      <WindowControls />
    </div>
  );
}
