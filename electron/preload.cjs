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

ipcRenderer.on('rf317:event', (_e, ev) => {
  for (const cb of eventSubs) cb(ev);
});
ipcRenderer.on('rf317:client', (_e, info) => {
  for (const cb of clientSubs) cb(info);
});

contextBridge.exposeInMainWorld('triviaDesktop', {
  isDesktop: true,
  platform: process.platform,
  /** מנוי לאירועי לחיצה/סטטוס מהקליקרים. מחזיר פונקציית ביטול-מנוי. */
  onClicker(/** @type {(ev: unknown) => void} */ cb) {
    eventSubs.add(cb);
    return () => eventSubs.delete(cb);
  },
  /** מנוי להתחברות/ניתוק של תוכנת הריסיבר לסוקט. מחזיר פונקציית ביטול-מנוי. */
  onReceiver(/** @type {(info: unknown) => void} */ cb) {
    clientSubs.add(cb);
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
  /** זכירת המשחק האחרון (בייטי ZIP + שם) לטעינה אוטומטית בפתיחה הבאה. */
  rememberGame(/** @type {string} */ name, /** @type {Uint8Array} */ bytes) {
    void ipcRenderer.invoke('game:remember', name, bytes);
  },
  /** שליפת המשחק האחרון שנשמר — { name, bytes } או null. */
  getLastGame() {
    return ipcRenderer.invoke('game:getLast');
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
});
