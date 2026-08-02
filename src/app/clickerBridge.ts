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

/** הגדרות משחק מוטבע ("סגור") ב-EXE — נקבעות בכלי החותמת בשרת. */
export interface SealConfig {
  /** קוד חדר לטלפונים ('' = בלי טלפונים). */
  room?: string;
  /** לאפשר שלטים (RF317). */
  allowClickers: boolean;
  /** לאפשר טלפונים (סוקט אונליין). */
  allowPhones: boolean;
  /** מגבלת משתתפים (null/undefined = כמו ב-JSON של המשחק). */
  limit?: number | null;
  /** שם המשחק (מטא). */
  name?: string;
}

/**
 * משחק שנטען ב-main ישירות מהדיסק: המדיה כבר חולצה למטמון, וה-renderer מקבל
 * רק את data.json (טקסט זעיר) ואת רשימת שמות הקבצים — בלי בייטי ה-ZIP.
 */
export interface SavedGamePayload {
  cacheKey: string;
  /** נתיב data.json בתוך הארכיון (לחישוב נתיבים יחסיים). */
  dataPath: string;
  dataJson: string;
  /** כל שמות הקבצים שחולצו (נתיבים יחסיים, קדימה-סלאש). */
  names: string[];
  /** שם קובץ המשחק שנשמר (מטא), אם קיים. */
  name?: string;
  /** הגדרות משחק מוטבע — רק כשמקור הטעינה הוא 'sealed'. */
  config?: SealConfig;
}

/** מצב חלון המשחק ב-EXE. בדפדפן אין כזה — ושם משתמשים ב-Fullscreen API. */
export interface DesktopWindowState {
  fullscreen: boolean;
  minimizable: boolean;
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
  /** סגירת תוכנת הריסיבר — במעבר לדמה/טלפונים (אין בה צורך). */
  stopReceiver?: () => void;
  /** זכירת המשחק האחרון (בייטי ZIP + שם) לטעינה אוטומטית בפתיחה הבאה. */
  rememberGame?: (name: string, bytes: Uint8Array) => void;
  /** שליפת המשחק האחרון שנשמר — { name, bytes } או null. */
  getLastGame?: () => Promise<{ name: string; bytes: Uint8Array } | null>;
  /** משחק מוטבע ("סגור") ב-EXE — { bytes, config } או null. */
  getSealedGame?: () => Promise<{ bytes: Uint8Array; config: SealConfig } | null>;
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
  /** יציאה מהמשחק (סגירת ה-EXE). */
  quit?: () => void;
  /** חילוץ מדיית ה-ZIP לדיסק (מצב זרימה) — מחזיר { cacheKey } או null. */
  mediaExtract?: (bytes: Uint8Array) => Promise<{ cacheKey: string } | null>;
  /** ניקוי מדיה זמנית מהדיסק (לא נוגע בגיבויים/בתוצאות). */
  mediaClear?: (cacheKey?: string) => Promise<boolean>;
  /** פתיחת חלון "מסך המנחה" הנפרד (EXE). */
  openHostWindow?: () => void;
  /** ממסר הודעות שליטה בין החלונות (ראו controlChannel.ts). */
  controlPost?: (msg: unknown) => void;
  onControl?: (cb: (msg: unknown) => void) => () => void;
  /** שמירת קובץ מדיה (עריכה חיה) לתיקיית המדיה; מחזיר trivia-media:// או null. */
  mediaAddFile?: (name: string, bytes: Uint8Array) => Promise<string | null>;
  /** טעינת המשחק השמור/המוטבע ישירות מהדיסק ב-main (בלי בייטי ZIP בצינור). */
  loadSavedGame?: (source: 'last' | 'sealed') => Promise<SavedGamePayload | null>;
  /** מעבר לתצוגת מסכים מורחבת (Windows DisplaySwitch /extend). */
  extendDisplay?: () => void;
  /** מצב חלון המשחק ב-EXE (מסך מלא / ניתן למזעור). */
  windowState?: () => Promise<DesktopWindowState | null>;
  /** מסך מלא של חלון Electron — לא Fullscreen API של הדפדפן. */
  setWindowFullscreen?: (on: boolean) => Promise<DesktopWindowState | null>;
  /** מזעור חלון המשחק. */
  minimizeWindow?: () => Promise<DesktopWindowState | null>;
  /** מנוי לשינויי מצב החלון (כולל F11 ומנהל החלונות). */
  onWindowState?: (cb: (state: DesktopWindowState | null) => void) => () => void;
  /** מספר הגרסה של התוכנה הרצה (EXE). */
  appVersion?: () => Promise<string>;
  /** מצב החתימה של הקובץ שרץ — יכולת חתימה, והאם הוא כלי החתימה עצמו. */
  sealMode?: () => Promise<SealMode>;
  /** חתימת ZIP ל-EXE חדש (כלי "חתום EXE"). */
  sealGame?: (
    zipBytes: Uint8Array,
    config: SealConfig,
    suggested: string,
    opts: SealOptions,
  ) => Promise<SealResult>;
  /** מנוי להתקדמות החתימה. מחזיר פונקציית ביטול-מנוי. */
  onSealProgress?: (cb: (p: SealProgress) => void) => () => void;
  /** שמירת משחק ערוך לתוך חבילת ה-ZIP שעל הדיסק. */
  saveEditedGame?: (dataJson: string) => Promise<SaveEditResult>;
  /** הורדת משחק מהשרת לפי קוד (נשמר כ"משחק אחרון"). */
  downloadGameByCode?: (code: string) => Promise<RemoteDownloadResult>;
  /** מנוי להתקדמות ההורדה מהשרת. מחזיר פונקציית ביטול-מנוי. */
  onDownloadProgress?: (cb: (p: DownloadProgress) => void) => () => void;
  /** מנוי למצב העדכון האוטומטי (null = אין מה להציג). ביטול-מנוי בהחזרה. */
  onUpdateStatus?: (cb: (s: UpdateStatus | null) => void) => () => void;
  /** דיווח שהמחשב חזר לרשת. */
  reportOnline?: () => void;
}

/**
 * מצב העדכון האוטומטי. שום מצב אינו דורש פעולה מיידית — העדכון נכנס לתוקף
 * בפתיחה הבאה, ולעולם לא קוטע משחק שרץ.
 * - `downloading` — מוריד ברקע.
 * - `ready`  — גרסת ההתקנה הורדה ותותקן בסגירת התוכנה.
 * - `sealer` — כלי "חתום EXE" החליף את עצמו; ייכנס לתוקף בפתיחה הבאה.
 * - `manual` — נמצאה גרסה חדשה אך אין הרשאת כתיבה לתיקייה; נדרשת הורדה ידנית.
 */
export interface UpdateStatus {
  /**
   * checking / current / offline / unsupported נוספו כדי שיהיה אפשר *לראות*
   * שהתוכנה בודקת עדכון — קודם היה חיווי רק כשכבר היה מה להוריד, ולכן לא
   * הייתה שום דרך לדעת אם מנגנון העדכון בכלל פועל.
   */
  state:
    | 'checking'
    | 'current'
    | 'downloading'
    | 'ready'
    | 'sealer'
    | 'manual'
    | 'offline'
    | 'unsupported';
  version?: string;
  percent?: number;
  /** למצב unsupported: למה אין עדכון אוטומטי לקובץ הזה. */
  reason?: 'sealed' | 'portable' | 'dev';
}

/**
 * מצב החתימה של הקובץ שרץ.
 * - `capable`: אפשר לחתום ממנו (קובץ נייד ארוז שאינו חתום בעצמו).
 * - `tool`: הוא *כלי החתימה* (‏SealEXE.exe) — ולכן אינו נגן משחקים, ולא יטען
 *   שום משחק שמור אלא ייפתח ישר על מסך החתימה.
 */
export interface SealMode {
  capable: boolean;
  tool: boolean;
}

/** תוצאת שמירת עריכה. addedMedia = כמה קובצי מדיה הוטמעו בחבילה. */
export interface SaveEditResult {
  ok: boolean;
  addedMedia?: number;
  error?: string;
}

/** התקדמות הורדת משחק מהשרת. */
export interface DownloadProgress {
  phase: 'connect' | 'download';
  received?: number;
  total?: number;
}

/** תוצאת הורדת משחק מהשרת לפי קוד. */
export interface RemoteDownloadResult {
  ok: boolean;
  bytes?: number;
  error?: string;
}

/** אפשרויות חתימה — בסיס עדכני מהרשת מול ה-EXE שרץ. */
export interface SealOptions {
  /** להוריד את גרסת המנוע האחרונה כבסיס (ברירת מחדל). false = הכלי עצמו. */
  useLatest: boolean;
}

/** התקדמות החתימה: הורדת הבסיס, ואז כתיבת ה-EXE. */
export interface SealProgress {
  phase: 'base' | 'writing' | 'done';
  received?: number;
  total?: number;
}

/** תוצאת חתימה. baseSource='latest' = נחתם על גרסת המנוע שהורדה מהרשת. */
export interface SealResult {
  ok: boolean;
  path?: string;
  size?: number;
  baseSource?: 'latest' | 'self';
  canceled?: boolean;
  error?: string;
}

function desktop(): TriviaDesktop | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { triviaDesktop?: TriviaDesktop }).triviaDesktop;
}

/** האם רצים ב-EXE (אפליקציית שולחן עבודה — Electron), ללא תלות בקליקרים. */
export function isDesktopApp(): boolean {
  return desktop()?.isDesktop === true;
}

/** הגשר עצמו — לבדיקת יכולות (ראו windowMode.ts). undefined בדפדפן. */
export function desktopBridge(): TriviaDesktop | undefined {
  return desktop();
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

/** סגירת תוכנת הריסיבר (EXE) — במעבר לדמה/טלפונים. no-op בדפדפן. */
export function desktopStopReceiver(): void {
  desktop()?.stopReceiver?.();
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

/** משחק מוטבע ("סגור") ב-EXE — { bytes, config } או null (בדפדפן/EXE גנרי). */
export async function getSealedGame(): Promise<{ bytes: Uint8Array; config: SealConfig } | null> {
  const fn = desktop()?.getSealedGame;
  if (typeof fn !== 'function') return null;
  try {
    return await fn();
  } catch {
    return null;
  }
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

/** האם ניתן לצאת מהמשחק (EXE — סגירת התוכנה). */
export function canQuit(): boolean {
  return typeof desktop()?.quit === 'function';
}

/** יציאה מהמשחק (סגירת ה-EXE). no-op בדפדפן. */
export function desktopQuit(): void {
  desktop()?.quit?.();
}

/** האם ה-EXE תומך בזרימת מדיה מהדיסק (trivia-media://) במקום Blob בזיכרון. */
export function canStreamMedia(): boolean {
  return typeof desktop()?.mediaExtract === 'function';
}

/** חילוץ מדיית ה-ZIP לדיסק לזרימה; מחזיר { cacheKey } או null (בדפדפן/שגיאה). */
export async function desktopMediaExtract(
  bytes: Uint8Array,
): Promise<{ cacheKey: string } | null> {
  const fn = desktop()?.mediaExtract;
  if (typeof fn !== 'function') return null;
  try {
    return await fn(bytes);
  } catch {
    return null;
  }
}

/** ניקוי מדיה זמנית מהדיסק (cacheKey חסר = כל המטמון). no-op בדפדפן. */
export async function desktopMediaClear(cacheKey?: string): Promise<boolean> {
  const fn = desktop()?.mediaClear;
  if (typeof fn !== 'function') return false;
  try {
    return await fn(cacheKey);
  } catch {
    return false;
  }
}

/** האם ה-EXE יודע לפתוח חלון "מסך מנחה" נפרד. */
export function canOpenHostWindow(): boolean {
  return typeof desktop()?.openHostWindow === 'function';
}

/** פתיחת חלון "מסך המנחה" הנפרד (EXE). no-op בדפדפן. */
export function openHostWindow(): void {
  desktop()?.openHostWindow?.();
}

/**
 * טעינת המשחק השמור ('last') או המוטבע ('sealed') ישירות מהדיסק ב-main —
 * בלי להעביר את ה-ZIP המלא בצינור. null בדפדפן, כשאין משחק, או בכשל.
 */
export async function desktopLoadSavedGame(
  source: 'last' | 'sealed',
): Promise<SavedGamePayload | null> {
  const fn = desktop()?.loadSavedGame;
  if (typeof fn !== 'function') return null;
  try {
    return await fn(source);
  } catch {
    return null;
  }
}

/** האם ה-EXE יודע לשמור קובץ מדיה לדיסק (עריכה חיה של מדיה). */
export function canAddMediaFile(): boolean {
  return typeof desktop()?.mediaAddFile === 'function';
}

/** שמירת קובץ מדיה לדיסק (EXE); מחזיר trivia-media:// או null. */
export async function desktopMediaAddFile(name: string, bytes: Uint8Array): Promise<string | null> {
  const fn = desktop()?.mediaAddFile;
  if (typeof fn !== 'function') return null;
  try {
    return await fn(name, bytes);
  } catch {
    return null;
  }
}

/** האם ה-EXE יודע לעבור לתצוגה מורחבת (Windows). */
export function canExtendDisplay(): boolean {
  return typeof desktop()?.extendDisplay === 'function';
}

/** מעבר לתצוגת מסכים מורחבת (EXE, Windows). no-op בדפדפן. */
export function extendDisplay(): void {
  desktop()?.extendDisplay?.();
}

/**
 * האם אפשר לשלוט בחלון האמיתי (EXE חדש). ב-EXE ישן — אין את הגשר הזה, ואז
 * ממשיכים ב-Fullscreen API של הדפדפן בדיוק כמו קודם.
 */
export function canControlWindow(): boolean {
  const d = desktop();
  return typeof d?.setWindowFullscreen === 'function' && typeof d.minimizeWindow === 'function';
}

/** מצב חלון המשחק. null בדפדפן / EXE ישן. */
export async function getWindowState(): Promise<DesktopWindowState | null> {
  const fn = desktop()?.windowState;
  if (typeof fn !== 'function') return null;
  try {
    return await fn();
  } catch {
    return null;
  }
}

/** כניסה/יציאה ממסך מלא של חלון ה-EXE. */
export async function setWindowFullscreen(on: boolean): Promise<DesktopWindowState | null> {
  const fn = desktop()?.setWindowFullscreen;
  if (typeof fn !== 'function') return null;
  try {
    return await fn(on);
  } catch {
    return null;
  }
}

/** מזעור חלון ה-EXE (יוצא ממסך מלא קודם). */
export async function minimizeWindow(): Promise<DesktopWindowState | null> {
  const fn = desktop()?.minimizeWindow;
  if (typeof fn !== 'function') return null;
  try {
    return await fn();
  } catch {
    return null;
  }
}

/** מנוי לשינויי מצב החלון (כולל F11). מחזיר פונקציית ביטול-מנוי. */
export function onWindowState(cb: (state: DesktopWindowState) => void): () => void {
  const fn = desktop()?.onWindowState;
  if (typeof fn !== 'function') return () => {};
  return fn((state) => {
    if (state !== null) cb(state);
  });
}

/** מספר הגרסה של ה-EXE הרץ, או null בדפדפן/גרסה ישנה. */
export async function getAppVersion(): Promise<string | null> {
  const fn = desktop()?.appVersion;
  if (typeof fn !== 'function') return null;
  try {
    return await fn();
  } catch {
    return null;
  }
}

/**
 * מצב החתימה של הקובץ שרץ. בדפדפן/גרסה ישנה — הכול כבוי, וההתנהגות זהה למה
 * שהיה לפני שהכלי נוסף.
 */
export async function getSealMode(): Promise<SealMode> {
  const fn = desktop()?.sealMode;
  if (typeof fn !== 'function') return { capable: false, tool: false };
  try {
    const mode = await fn();
    return { capable: mode?.capable === true, tool: mode?.tool === true };
  } catch {
    return { capable: false, tool: false };
  }
}

/** חתימת ZIP ל-EXE חדש. מחזיר תוצאה עם הנתיב שנשמר, ביטול, או שגיאה. */
export async function desktopSealGame(
  zipBytes: Uint8Array,
  config: SealConfig,
  suggested: string,
  opts: SealOptions,
): Promise<SealResult> {
  const fn = desktop()?.sealGame;
  if (typeof fn !== 'function') return { ok: false, error: 'החתימה אינה זמינה בגרסה הזו' };
  try {
    return await fn(zipBytes, config, suggested, opts);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** מנוי להתקדמות החתימה. מחזיר פונקציית ביטול-מנוי (no-op בדפדפן). */
export function onSealProgress(cb: (p: SealProgress) => void): () => void {
  const fn = desktop()?.onSealProgress;
  if (typeof fn !== 'function') return () => {};
  return fn(cb);
}

/** האם אפשר לשמור עריכה לקובץ המשחק (EXE עם חבילה על הדיסק). */
export function canSaveEdits(): boolean {
  return typeof desktop()?.saveEditedGame === 'function';
}

/** שמירת המשחק הערוך לחבילה שעל הדיסק. */
export async function saveEditedGame(dataJson: string): Promise<SaveEditResult> {
  const fn = desktop()?.saveEditedGame;
  if (typeof fn !== 'function') return { ok: false, error: 'שמירה אינה זמינה בגרסה הזו' };
  try {
    return await fn(dataJson);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** האם התוכנה יודעת להוריד משחק מהשרת לפי קוד (EXE בלבד). */
export function canDownloadByCode(): boolean {
  return typeof desktop()?.downloadGameByCode === 'function';
}

/** הורדת משחק מהשרת לפי קוד. השמירה והטעינה נעשות בצד ה-main. */
export async function downloadGameByCode(code: string): Promise<RemoteDownloadResult> {
  const fn = desktop()?.downloadGameByCode;
  if (typeof fn !== 'function') return { ok: false, error: 'לא זמין בגרסה הזו' };
  try {
    return await fn(code);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** מנוי להתקדמות ההורדה מהשרת. מחזיר פונקציית ביטול-מנוי (no-op בדפדפן). */
export function onDownloadProgress(cb: (p: DownloadProgress) => void): () => void {
  const fn = desktop()?.onDownloadProgress;
  if (typeof fn !== 'function') return () => {};
  return fn(cb);
}

/**
 * מנוי למצב העדכון האוטומטי, כולל בדיקה מחדש בכל פעם שהמחשב חוזר לרשת.
 * מחזיר פונקציית ביטול-מנוי. no-op בדפדפן ובגרסאות שאינן מתעדכנות.
 */
export function onUpdateStatus(cb: (s: UpdateStatus | null) => void): () => void {
  const d = desktop();
  if (typeof d?.onUpdateStatus !== 'function') return () => {};
  const off = d.onUpdateStatus(cb);
  const onOnline = () => d.reportOnline?.();
  window.addEventListener('online', onOnline);
  return () => {
    window.removeEventListener('online', onOnline);
    off();
  };
}
