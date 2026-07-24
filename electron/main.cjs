// @ts-check
/**
 * תהליך ה-main של Electron — עוטף את מנוע הטריוויה כאפליקציית שולחן עבודה
 * אופליין לגמרי. טוען את הבנייה הסטטית (dist) מהדיסק דרך file://, בלי שרת
 * ובלי אינטרנט. חלון קיוסק במסך מלא לאירועים חיים.
 *
 * שליטה: F11 מסך מלא/יציאה · Ctrl+Shift+I כלי פיתוח · Ctrl+Q יציאה.
 */

const { app, BrowserWindow, globalShortcut } = require('electron');
const path = require('node:path');
const { createClickerServer, DEFAULT_PORT } = require('./clickerServer.cjs');

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {import('node:net').Server | null} */
let clickerServer = null;

/** שולח הודעה ל-renderer אם החלון קיים וטעון. */
function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

/**
 * מריץ את שרת קליקרי RF317 (פורט 8090) ומעביר כל אירוע ל-renderer:
 *   'rf317:event'  — לחיצת כפתור / בית סטטוס.
 *   'rf317:client' — התחברות/ניתוק של תוכנת הריסיבר (RF317SocketForm) לסוקט.
 */
function startClickerServer() {
  const port = Number(process.env.RF317_PORT) || DEFAULT_PORT;
  clickerServer = createClickerServer({
    port,
    onEvent: (ev) => sendToRenderer('rf317:event', ev),
    onClientChange: (connected, who) => sendToRenderer('rf317:client', { connected, who }),
    onListening: (p) => console.log(`[RF317] מאזין לקליקרים על 127.0.0.1:${p}`),
    onError: (err) => console.error('[RF317] שגיאת שרת קליקרים:', err.message),
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: '#0b0e1a',
    fullscreen: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // המדיה מתנגנת אוטומטית בלי אינטראקציה מוקדמת
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  // טעינת הבנייה הסטטית מהדיסק — אופליין מלא
  void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  startClickerServer(); // שרת קליקרי RF317 (מקומי, פורט 8090)

  // קיצורי מקלדת גלובליים למפעיל
  globalShortcut.register('F11', () => {
    if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    mainWindow?.webContents.toggleDevTools();
  });
  globalShortcut.register('CommandOrControl+Q', () => app.quit());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  clickerServer?.close();
  clickerServer = null;
});

app.on('window-all-closed', () => {
  // גם ב-macOS נסגור — זו אפליקציית קיוסק לאירוע בודד
  app.quit();
});
