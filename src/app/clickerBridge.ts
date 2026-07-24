/**
 * גשר קליקרי RF317 בצד ה-renderer. במצב EXE (Electron) ה-preload חושף את
 * `window.triviaDesktop` עם מנויים לאירועי לחיצה/סטטוס מהשרת המקומי (פורט 8090).
 * בדפדפן רגיל אין אובייקט כזה — הפונקציות מחזירות no-op ו-isDesktopClicker=false.
 */

export interface ClickerKeyEvent {
  type: 'key';
  /** מספר הכפתור: 1..8 = תשובות (כפתור 1 = תשובה 1); 0 = כפתור F. */
  button: number;
  /** מזהה הקליקר (Int16). */
  remoteId: number;
}
export interface ClickerStatusEvent {
  type: 'status';
  code: number;
  /** 'connected' | 'disconnected' | 'connecting' | 'not_connected' | 'unknown'. */
  status: string;
}
export type ClickerEvent = ClickerKeyEvent | ClickerStatusEvent;

/** התחברות/ניתוק של תוכנת הריסיבר (RF317SocketForm) לסוקט המקומי. */
export interface ReceiverClient {
  connected: boolean;
  who: string | null;
}

interface TriviaDesktop {
  isDesktop?: boolean;
  platform?: string;
  onClicker?: (cb: (ev: ClickerEvent) => void) => () => void;
  onReceiver?: (cb: (info: ReceiverClient) => void) => () => void;
}

function desktop(): TriviaDesktop | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { triviaDesktop?: TriviaDesktop }).triviaDesktop;
}

/** האם רצים ב-EXE עם גשר קליקרים זמין. */
export function isDesktopClicker(): boolean {
  const d = desktop();
  return d?.isDesktop === true && typeof d.onClicker === 'function';
}

/** מנוי לאירועי לחיצה/סטטוס מהקליקרים. מחזיר פונקציית ביטול-מנוי. */
export function onClickerEvent(cb: (ev: ClickerEvent) => void): () => void {
  const d = desktop();
  if (typeof d?.onClicker !== 'function') return () => {};
  return d.onClicker(cb);
}

/** מנוי להתחברות/ניתוק של תוכנת הריסיבר לסוקט. מחזיר פונקציית ביטול-מנוי. */
export function onReceiverClient(cb: (info: ReceiverClient) => void): () => void {
  const d = desktop();
  if (typeof d?.onReceiver !== 'function') return () => {};
  return d.onReceiver(cb);
}
