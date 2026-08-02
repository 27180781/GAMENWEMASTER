/**
 * החלטה טהורה: במה שולטים כשלוחצים "מסך מלא"/"מזעור".
 *
 * הרקע: חלון המשחק ב-EXE נפתח כמסך מלא של Electron ובלי מסגרת, ולכן אין לו
 * כפתורי מזעור/גרירה של Windows. כפתור "מסך מלא" שב-UI השתמש ב-Fullscreen API
 * של הדפדפן — שאינו נוגע כלל במצב החלון של Electron, ולכן במשחק אופליין הוא
 * לא עשה דבר, ולא הייתה שום דרך למזער או לגרור את החלון למסך השני.
 *
 * הקובץ טהור (בלי React ובלי גישה ל-window) כדי שיהיה ניתן לבדיקת יחידה.
 */

/** מה שהגשר של ה-EXE צריך לחשוף כדי שנשלוט בחלון האמיתי. */
export interface WindowBridgeShape {
  setWindowFullscreen?: unknown;
  minimizeWindow?: unknown;
}

export type WindowMode = 'desktop' | 'browser';

/**
 * 'desktop' רק כששני חלקי הגשר קיימים. EXE ישן (בלי הגשר) חוזר ל-'browser',
 * כלומר להתנהגות שהייתה — ולא לכפתור שבור.
 */
export function windowMode(bridge: WindowBridgeShape | null | undefined): WindowMode {
  if (bridge === null || bridge === undefined) return 'browser';
  const hasFullscreen = typeof bridge.setWindowFullscreen === 'function';
  const hasMinimize = typeof bridge.minimizeWindow === 'function';
  return hasFullscreen && hasMinimize ? 'desktop' : 'browser';
}

/** האם להציג כפתור מזעור. בדפדפן אין מה למזער — רק ב-EXE. */
export function canMinimize(mode: WindowMode): boolean {
  return mode === 'desktop';
}
