/**
 * פתיחת "מסך המנחה" מהמסך הראשי.
 *
 * ב-EXE זה חלון Electron נפרד (openHostWindow ב-main). בדפדפן הוא נפתח עד
 * 2026-10 כקישור לטאב חדש, כלומר בתוך החלון של המשחק עצמו: מנחה שהעביר את
 * החלון למקרן הקרין גם את מסך המנחה, ומעבר אליו הסתיר את המשחק. לקוח כתב
 * (2026-10-11) שלא הצליח לפתוח את ממשק הניהול בלי להקרין אותו. עכשיו גם
 * בדפדפן נפתח חלון משלו, שנשאר על מסך המחשב כשחלון המשחק עובר למקרן.
 */

import { canOpenHostWindow, openHostWindow } from './clickerBridge.ts';

/** שם קבוע: לחיצה נוספת מחזירה לאותו חלון ולא פותחת עוד אחד. */
export const HOST_CONSOLE_WINDOW_NAME = 'trivia-host-console';

/** אותו גודל כמו החלון של ה-EXE (main.cjs). ‏popup מבקש חלון ולא טאב. */
export const HOST_CONSOLE_WINDOW_FEATURES = 'popup=yes,width=1240,height=840';

/** הכתובת של מסך המנחה. הוא מתחבר למשחק בערוץ השליטה, ולכן אין צורך בשאר הפרמטרים. */
export function hostConsoleUrl(pathname: string): string {
  return `${pathname}?host=1`;
}

/** desktop = חלון ה-EXE; window = חלון בדפדפן; blocked = הדפדפן חסם את החלון. */
export type HostConsoleOpen = 'desktop' | 'window' | 'blocked';

/** מה שהפתיחה צריכה מהחלון הנוכחי (מוחלף בבדיקות). */
export type HostConsoleOpener = Pick<Window, 'open'> & { location: Pick<Location, 'pathname'> };

/** החלון שנפתח מכל חלון משחק, כדי להביא אותו לחזית בלחיצה הבאה. */
const opened = new WeakMap<object, Window>();

/** פותח את מסך המנחה, או מביא לחזית את זה שכבר פתוח. נקרא רק מלחיצה. */
export function openHostConsole(win: HostConsoleOpener = window): HostConsoleOpen {
  if (canOpenHostWindow()) {
    openHostWindow();
    return 'desktop';
  }
  const existing = opened.get(win);
  if (existing !== undefined && !existing.closed) {
    existing.focus();
    return 'window';
  }
  const consoleWindow = win.open(
    hostConsoleUrl(win.location.pathname),
    HOST_CONSOLE_WINDOW_NAME,
    HOST_CONSOLE_WINDOW_FEATURES,
  );
  if (consoleWindow === null) return 'blocked';
  opened.set(win, consoleWindow);
  consoleWindow.focus();
  return 'window';
}
