import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HOST_CONSOLE_WINDOW_FEATURES,
  HOST_CONSOLE_WINDOW_NAME,
  hostConsoleUrl,
  openHostConsole,
  type HostConsoleOpener,
} from '../src/app/hostConsoleWindow.ts';

/** חלון משחק מדומה בדפדפן: רושם כל window.open ומחזיר חלון שאפשר "לסגור". */
function fakeOpener(blocked = false) {
  const calls: Array<[string | URL | undefined, string | undefined, string | undefined]> = [];
  const windows: Array<{ closed: boolean; focus: ReturnType<typeof vi.fn> }> = [];
  const opener: HostConsoleOpener = {
    location: { pathname: '/play/' },
    open: (url?: string | URL, target?: string, features?: string) => {
      calls.push([url, target, features]);
      if (blocked) return null;
      const w = { closed: false, focus: vi.fn() };
      windows.push(w);
      return w as unknown as Window;
    },
  };
  return { opener, calls, windows };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openHostConsole — מסך המנחה בחלון נפרד', () => {
  it('בדפדפן נפתח חלון קופץ (לא טאב) בגודל של חלון ה-EXE', () => {
    const { opener, calls, windows } = fakeOpener();
    expect(openHostConsole(opener)).toBe('window');
    expect(calls).toEqual([['/play/?host=1', HOST_CONSOLE_WINDOW_NAME, HOST_CONSOLE_WINDOW_FEATURES]]);
    expect(HOST_CONSOLE_WINDOW_FEATURES).toContain('popup=yes');
    expect(windows[0]!.focus).toHaveBeenCalledTimes(1);
  });

  it('לחיצה נוספת מביאה לחזית את החלון הפתוח ולא טוענת אותו מחדש', () => {
    const { opener, calls, windows } = fakeOpener();
    openHostConsole(opener);
    expect(openHostConsole(opener)).toBe('window');
    expect(calls).toHaveLength(1);
    expect(windows[0]!.focus).toHaveBeenCalledTimes(2);
  });

  it('אחרי שהמנחה סגר את החלון נפתח חלון חדש', () => {
    const { opener, calls, windows } = fakeOpener();
    openHostConsole(opener);
    windows[0]!.closed = true;
    openHostConsole(opener);
    expect(calls).toHaveLength(2);
    expect(windows).toHaveLength(2);
  });

  it('דפדפן שחסם את החלון: blocked, כדי שהמסך יציע דרך אחרת', () => {
    const { opener } = fakeOpener(true);
    expect(openHostConsole(opener)).toBe('blocked');
  });

  it('ב-EXE החלון של main נפתח, ולא חלון דפדפן', () => {
    const openHostWindow = vi.fn();
    vi.stubGlobal('window', { triviaDesktop: { openHostWindow } });
    const { opener, calls } = fakeOpener();
    expect(openHostConsole(opener)).toBe('desktop');
    expect(openHostWindow).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });

  it('הכתובת: הנתיב של המשחק עם ‎?host=1‎ בלבד', () => {
    expect(hostConsoleUrl('/')).toBe('/?host=1');
  });
});
