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
  /** הפעלת תוכנת הריסיבר (RF317SocketForm) שמצורפת ל-EXE — מתחברת לשרת המקומי. */
  launchReceiver?: () => void;
  /** הקפצת חלון הריסיבר לחזית — להגדרת טווח שלטים / לחיצת Connect. */
  showReceiver?: () => void;
  /** זכירת המשחק האחרון (בייטי ZIP + שם) לטעינה אוטומטית בפתיחה הבאה. */
  rememberGame?: (name: string, bytes: Uint8Array) => void;
  /** שליפת המשחק האחרון שנשמר — { name, bytes } או null. */
  getLastGame?: () => Promise<{ name: string; bytes: Uint8Array } | null>;
  /** מחיקת המשחק האחרון השמור ("טען משחק אחר"). */
  forgetGame?: () => void;
  /** גיבוי אופליין לדיסק — שמירת מצב המשחק (JSON) לפי מזהה. */
  backupSave?: (id: string, json: string) => Promise<boolean>;
  /** שליפת גיבוי אופליין (JSON) לפי מזהה, או null. */
  backupLoad?: (id: string) => Promise<string | null>;
  /** מחיקת גיבוי אופליין לפי מזהה. */
  backupClear?: (id: string) => void;
  /** שמירת קובץ תוצאות (אקסל) לדיסק; מחזיר את הנתיב המלא או null. */
  saveReport?: (name: string, bytes: Uint8Array) => Promise<string | null>;
  /** פתיחת תיקיית התוצאות בסייר הקבצים. */
  openReports?: () => void;
}

function desktop(): TriviaDesktop | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { triviaDesktop?: TriviaDesktop }).triviaDesktop;
}

/** האם רצים ב-EXE (אפליקציית שולחן עבודה — Electron), ללא תלות בקליקרים. */
export function isDesktopApp(): boolean {
  return desktop()?.isDesktop === true;
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

/**
 * הפעלת תוכנת הריסיבר (RF317SocketForm) המצורפת ל-EXE, שמתחברת לשרת המקומי
 * (פורט 8090) ומזרימה את לחיצות השלטים. no-op אם אין גשר (דפדפן) או אם
 * ה-preload אינו חושף את הפעולה (גרסת EXE ישנה).
 */
export function launchReceiver(): void {
  desktop()?.launchReceiver?.();
}

/**
 * הקפצת חלון תוכנת הקליטה לחזית (משחזר ממוזער) — כדי להגדיר טווח שלטים
 * (Min/Max Remote ID) וללחוץ Connect. no-op אם אין גשר או פעולה כזו.
 */
export function showReceiver(): void {
  desktop()?.showReceiver?.();
}

/** האם קיים גשר קליטה שיודע להקפיץ את חלון הריסיבר (EXE עם תמיכה). */
export function canShowReceiver(): boolean {
  return typeof desktop()?.showReceiver === 'function';
}

/** זכירת המשחק האחרון (בייטי ZIP + שם) לטעינה אוטומטית בפתיחה הבאה. no-op בדפדפן. */
export function rememberGame(name: string, bytes: Uint8Array): void {
  desktop()?.rememberGame?.(name, bytes);
}

/** שליפת המשחק האחרון שנשמר (EXE) — { name, bytes } או null. */
export async function getLastGame(): Promise<{ name: string; bytes: Uint8Array } | null> {
  const fn = desktop()?.getLastGame;
  if (typeof fn !== 'function') return null;
  try {
    return await fn();
  } catch {
    return null;
  }
}

/** מחיקת המשחק האחרון השמור (EXE) — "טען משחק אחר". no-op בדפדפן. */
export function forgetGame(): void {
  desktop()?.forgetGame?.();
}

/** האם קיים גשר עם גיבוי-דיסק (EXE) — לגיבוי אופליין. */
export function canDiskBackup(): boolean {
  return typeof desktop()?.backupSave === 'function';
}

/** שמירת גיבוי אופליין (JSON) לפי מזהה משחק. מחזיר האם הצליח. */
export async function desktopBackupSave(id: string, json: string): Promise<boolean> {
  const fn = desktop()?.backupSave;
  if (typeof fn !== 'function') return false;
  try {
    return await fn(id, json);
  } catch {
    return false;
  }
}

/** שליפת גיבוי אופליין (JSON) לפי מזהה משחק, או null. */
export async function desktopBackupLoad(id: string): Promise<string | null> {
  const fn = desktop()?.backupLoad;
  if (typeof fn !== 'function') return null;
  try {
    return await fn(id);
  } catch {
    return null;
  }
}

/** מחיקת גיבוי אופליין לפי מזהה משחק. */
export function desktopBackupClear(id: string): void {
  desktop()?.backupClear?.(id);
}

/** האם קיים גשר שיודע לשמור קבצי תוצאות לדיסק (EXE). */
export function canSaveReport(): boolean {
  return typeof desktop()?.saveReport === 'function';
}

/** שמירת קובץ תוצאות (אקסל) לדיסק; מחזיר את הנתיב המלא או null. */
export async function desktopSaveReport(name: string, bytes: Uint8Array): Promise<string | null> {
  const fn = desktop()?.saveReport;
  if (typeof fn !== 'function') return null;
  try {
    return await fn(name, bytes);
  } catch {
    return null;
  }
}

/** פתיחת תיקיית התוצאות בסייר הקבצים (EXE). */
export function desktopOpenReports(): void {
  desktop()?.openReports?.();
}
