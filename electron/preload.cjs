// @ts-check
/**
 * Preload עם בידוד הקשר (contextIsolation). חושף גשר קליקרי RF317: אירועי
 * לחיצה + סטטוס תוכנת הריסיבר מגיעים מתהליך ה-main (דרך ipcRenderer) ומועברים
 * למנוי ב-renderer. ה-adapter שבתוך האפליקציה מזרים אותם למנוע — בדיוק מאחורי
 * אותו VoteAdapter הקיים.
 */

const { contextBridge, ipcRenderer } = require('electron');

/** @type {Set<(ev: unknown) => void>} */
const eventSubs = new Set();
/** @type {Set<(info: unknown) => void>} */
const clientSubs = new Set();

/**
 * הסטטוס האחרון של כל אחד משני הזרמים, כדי לשדר אותו למנויים חדשים. הרכיבים
 * שמאזינים מתמזגים מחדש כשעוברים ממסך ההגדרות אל המשחק — ובלי השידור החוזר
 * הם היו חוזרים למצב ההתחלתי (חיווי אדום "ממתין לריסיבר…", ואזהרת "אין חיבור
 * לריסיבר") למרות שהריסיבר מחובר, עד לאירוע הבא שיגיע מהדונגל.
 *
 * כל זרם משודר בנפרד ותמיד: הם מזינים צרכנים שונים (סטטוס הדונגל מזין את
 * מתאם ההצבעות, חיבור התוכנה מזין את החיווי), ולכן אין להשתיק אחד בגלל השני.
 * @type {unknown}
 */
let lastStatusEvent = null;
/** @type {unknown} */
let lastClientInfo = null;

ipcRenderer.on('rf317:event', (_e, ev) => {
  // לחיצות אינן "מצב" — רק סטטוס הדונגל נשמר לשידור חוזר.
  if (ev !== null && typeof ev === 'object' && /** @type {{type?: string}} */ (ev).type === 'status') {
    lastStatusEvent = ev;
  }
  for (const cb of eventSubs) cb(ev);
});
ipcRenderer.on('rf317:client', (_e, info) => {
  lastClientInfo = info;
  for (const cb of clientSubs) cb(info);
});

/**
 * שידור חוזר של הסטטוס הידוע האחרון — למנוי החדש בלבד, ואחרי הרינדור הנוכחי
 * (queueMicrotask) כדי לא לעדכן state תוך כדי הרכבת הרכיב.
 * @param {unknown} last
 * @param {(v: unknown) => void} cb
 */
function replayLastStatus(last, cb) {
  if (last === null) return;
  queueMicrotask(() => cb(last));
}

contextBridge.exposeInMainWorld('triviaDesktop', {
  isDesktop: true,
  platform: process.platform,
  /** מנוי לאירועי לחיצה/סטטוס מהקליקרים. מחזיר פונקציית ביטול-מנוי. */
  onClicker(/** @type {(ev: unknown) => void} */ cb) {
    eventSubs.add(cb);
    replayLastStatus(lastStatusEvent, cb);
    return () => eventSubs.delete(cb);
  },
  /** מנוי להתחברות/ניתוק של תוכנת הריסיבר לסוקט. מחזיר פונקציית ביטול-מנוי. */
  onReceiver(/** @type {(info: unknown) => void} */ cb) {
    clientSubs.add(cb);
    replayLastStatus(lastClientInfo, cb);
    return () => clientSubs.delete(cb);
  },
  /** הפעלת תוכנת הקליטה RF317SocketForm המצורפת (בבחירת "שחק עם שלטים"). */
  launchReceiver() {
    void ipcRenderer.invoke('rf317:launch');
  },
  /** הקפצת חלון הקליטה לחזית — להגדרת טווח שלטים / לחיצת Connect. */
  showReceiver() {
    void ipcRenderer.invoke('rf317:show');
  },
  /** סגירת תוכנת הקליטה — במעבר לדמה/טלפונים (אין בה צורך). */
  stopReceiver() {
    void ipcRenderer.invoke('rf317:stop');
  },
  /** זכירת המשחק האחרון (בייטי ZIP + שם) לטעינה אוטומטית בפתיחה הבאה. */
  rememberGame(/** @type {string} */ name, /** @type {Uint8Array} */ bytes) {
    void ipcRenderer.invoke('game:remember', name, bytes);
  },
  /** שליפת המשחק האחרון שנשמר — { name, bytes } או null. */
  getLastGame() {
    return ipcRenderer.invoke('game:getLast');
  },
  /** משחק מוטבע ("סגור") ב-EXE — { bytes, config } או null. */
  getSealedGame() {
    return ipcRenderer.invoke('game:sealed');
  },
  /** מחיקת המשחק האחרון השמור ("טען משחק אחר"). */
  forgetGame() {
    void ipcRenderer.invoke('game:forget');
  },
  /** גיבוי אופליין לדיסק — שמירת מצב המשחק (JSON) לפי מזהה. */
  backupSave(/** @type {string} */ id, /** @type {string} */ json) {
    return ipcRenderer.invoke('backup:save', id, json);
  },
  /** שליפת גיבוי אופליין (JSON) לפי מזהה, או null. */
  backupLoad(/** @type {string} */ id) {
    return ipcRenderer.invoke('backup:load', id);
  },
  /** מחיקת גיבוי אופליין לפי מזהה. */
  backupClear(/** @type {string} */ id) {
    void ipcRenderer.invoke('backup:clear', id);
  },
  /** שמירת קובץ תוצאות (אקסל) לדיסק; מחזיר את הנתיב המלא. */
  saveReport(/** @type {string} */ name, /** @type {Uint8Array} */ bytes) {
    return ipcRenderer.invoke('report:save', name, bytes);
  },
  /** פתיחת תיקיית התוצאות בסייר הקבצים. */
  openReports() {
    void ipcRenderer.invoke('report:open');
  },
  /** יציאה מהמשחק (סגירת ה-EXE) — אחרי אישור המשתמש. */
  quit() {
    void ipcRenderer.invoke('app:quit');
  },
  /** חילוץ מדיית ה-ZIP לדיסק (מצב זרימה) — מחזיר { cacheKey } או null. */
  mediaExtract(/** @type {Uint8Array} */ bytes) {
    return ipcRenderer.invoke('media:extract', bytes);
  },
  /** ניקוי מדיה זמנית מהדיסק (לא נוגע בגיבויים/בתוצאות). ריק = כל המטמון. */
  mediaClear(/** @type {string=} */ cacheKey) {
    return ipcRenderer.invoke('media:clear', cacheKey);
  },
  /**
   * טעינת המשחק השמור ('last') או המוטבע ('sealed') ישירות מהדיסק ב-main:
   * מחזיר { cacheKey, dataPath, dataJson, names, name, config? } — בלי בייטי ZIP.
   */
  loadSavedGame(/** @type {'last'|'sealed'} */ source) {
    return ipcRenderer.invoke('game:loadSaved', source);
  },
  /** פתיחת חלון "מסך המנחה" הנפרד. */
  openHostWindow() {
    void ipcRenderer.invoke('host:open');
  },
  /** שליחת הודעת שליטה לחלונות האחרים (ממסר דרך main). */
  controlPost(/** @type {unknown} */ msg) {
    ipcRenderer.send('control:post', msg);
  },
  /** מנוי להודעות שליטה מחלונות אחרים. מחזיר פונקציית ביטול-מנוי. */
  onControl(/** @type {(msg: unknown) => void} */ cb) {
    const listener = (/** @type {unknown} */ _e, /** @type {unknown} */ msg) => cb(msg);
    ipcRenderer.on('control:msg', listener);
    return () => ipcRenderer.removeListener('control:msg', listener);
  },
  /** שמירת קובץ מדיה (עריכה חיה) לדיסק; מחזיר trivia-media:// או null. */
  mediaAddFile(/** @type {string} */ name, /** @type {Uint8Array} */ bytes) {
    return ipcRenderer.invoke('media:addFile', name, bytes);
  },
  /** מעבר לתצוגת מסכים מורחבת (Windows). */
  extendDisplay() {
    void ipcRenderer.invoke('display:extend');
  },
  /** מצב החתימה: { capable, tool } — ראו seal:mode ב-main. */
  sealMode() {
    return ipcRenderer.invoke('seal:mode');
  },
  /** חתימת ZIP ל-EXE חדש; מחזיר { ok, path } או { ok:false, error|canceled }. */
  sealGame(
    /** @type {Uint8Array} */ zipBytes,
    /** @type {unknown} */ config,
    /** @type {string} */ suggested,
    /** @type {unknown} */ opts,
  ) {
    return ipcRenderer.invoke('seal:create', zipBytes, config, suggested, opts);
  },
  /** שמירת משחק ערוך לתוך חבילת ה-ZIP שעל הדיסק. */
  saveEditedGame(/** @type {string} */ dataJson) {
    return ipcRenderer.invoke('game:saveEdited', dataJson);
  },
  /** הורדת משחק מהשרת לפי קוד; נשמר כ"משחק אחרון" ונטען משם. */
  downloadGameByCode(/** @type {string} */ code) {
    return ipcRenderer.invoke('game:downloadByCode', code);
  },
  /** מנוי להתקדמות ההורדה מהשרת. מחזיר פונקציית ביטול-מנוי. */
  onDownloadProgress(/** @type {(p: unknown) => void} */ cb) {
    const listener = (/** @type {unknown} */ _e, /** @type {unknown} */ p) => cb(p);
    ipcRenderer.on('game:downloadProgress', listener);
    return () => ipcRenderer.removeListener('game:downloadProgress', listener);
  },
  /** מנוי למצב העדכון האוטומטי. מחזיר פונקציית ביטול-מנוי. */
  onUpdateStatus(/** @type {(s: unknown) => void} */ cb) {
    const listener = (/** @type {unknown} */ _e, /** @type {unknown} */ s) => cb(s);
    ipcRenderer.on('app:update', listener);
    // שידור חוזר: החלון עלול להיפתח אחרי שהאירוע כבר נשלח.
    void ipcRenderer.invoke('app:updateState').then((s) => {
      if (s !== null && s !== undefined) cb(s);
    });
    return () => ipcRenderer.removeListener('app:update', listener);
  },
  /** דיווח שהמחשב חזר לרשת — הזדמנות לבדוק עדכון. */
  reportOnline() {
    void ipcRenderer.invoke('app:online');
  },
  /** מנוי להתקדמות החתימה (הורדת הבסיס/כתיבה). מחזיר פונקציית ביטול-מנוי. */
  onSealProgress(/** @type {(p: unknown) => void} */ cb) {
    const listener = (/** @type {unknown} */ _e, /** @type {unknown} */ p) => cb(p);
    ipcRenderer.on('seal:progress', listener);
    return () => ipcRenderer.removeListener('seal:progress', listener);
  },
});
