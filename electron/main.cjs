// @ts-check
/**
 * תהליך ה-main של Electron — עוטף את מנוע הטריוויה כאפליקציית שולחן עבודה
 * אופליין לגמרי. טוען את הבנייה הסטטית (dist) מהדיסק דרך file://, בלי שרת
 * ובלי אינטרנט. חלון קיוסק במסך מלא לאירועים חיים.
 *
 * שליטה: F11 מסך מלא/יציאה · Ctrl+Shift+I כלי פיתוח · Ctrl+Q יציאה.
 */

const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createClickerServer, DEFAULT_PORT } = require('./clickerServer.cjs');

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {import('node:net').Server | null} */
let clickerServer = null;
/** @type {import('node:child_process').ChildProcess | null} */
let receiverProc = null;

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

/** שם קובץ ההרצה של תוכנת הקליטה — לזיהוי/סגירה/הבאה-לחזית לפי שם התהליך. */
const RECEIVER_EXE = 'RF317SocketForm.exe';
/** האם כבר הפעלנו את תוכנת הקליטה בהרצה הנוכחית (מונע הפעלה כפולה). */
let receiverStarted = false;

/** נתיב תיקיית תוכנת הקליטה — בחבילה resources/receiver, בפיתוח electron/receiver. */
function receiverDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'receiver')
    : path.join(__dirname, 'receiver');
}

/**
 * הפעלת תוכנת הקליטה RF317SocketForm המצורפת. זו תוכנת Windows (.NET) שמתחברת
 * כלקוח לשרת המקומי (פורט 8090) ומזרימה את לחיצות השלטים. מופעלת **ממוזערת**
 * (‏start /min) כדי שלא תכסה את המסך הגדול באירוע — ואפשר להקפיץ אותה לחזית
 * דרך showReceiver כשצריך להגדיר טווח שלטים או ללחוץ Connect. no-op מחוץ
 * ל-Windows, ואם כבר הופעלה — לא מפעילים שוב.
 */
function launchReceiver() {
  if (process.platform !== 'win32') return; // התוכנה היא Windows בלבד
  if (receiverStarted) return; // כבר הופעלה בהרצה הזו
  const base = receiverDir();
  const exe = path.join(base, RECEIVER_EXE);
  try {
    // start "" /min /d <dir> "<exe>" — פותח את התוכנה ממוזערת, עם תיקיית עבודה
    // נכונה כדי שתמצא את ה-DLL (gsp-api.dll וכו').
    receiverProc = spawn('cmd.exe', ['/c', `start "" /min /d "${base}" "${exe}"`], {
      cwd: base,
      stdio: 'ignore',
      windowsHide: true,
    });
    receiverProc.on('error', (err) => {
      console.error('[RF317] הפעלת תוכנת הקליטה נכשלה:', err.message);
      receiverStarted = false;
    });
    receiverStarted = true;
    console.log('[RF317] תוכנת הקליטה הופעלה (ממוזערת):', exe);
  } catch (err) {
    console.error('[RF317] הפעלת תוכנת הקליטה נכשלה:', /** @type {Error} */ (err).message);
    receiverStarted = false;
  }
}

/**
 * מקפיץ את חלון תוכנת הקליטה לחזית (משחזר ממוזער) — כדי להגדיר טווח שלטים
 * (Min/Max Remote ID) וללחוץ Connect. משתמש ב-user32 דרך PowerShell מקודד
 * (‏EncodedCommand — UTF-16LE base64) כדי להימנע מבעיות מרכאות/ציטוט.
 */
function showReceiver() {
  if (process.platform !== 'win32') return;
  const script = [
    'Add-Type @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class WinR {',
    '  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int c);',
    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
    '}',
    '"@',
    "Get-Process RF317SocketForm -ErrorAction SilentlyContinue | ForEach-Object {",
    '  if ($_.MainWindowHandle -ne 0) {',
    '    [WinR]::ShowWindowAsync($_.MainWindowHandle, 9) | Out-Null;', // 9 = SW_RESTORE
    '    [WinR]::SetForegroundWindow($_.MainWindowHandle) | Out-Null;',
    '  }',
    '}',
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  try {
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } catch (err) {
    console.error('[RF317] הצגת חלון הקליטה נכשלה:', /** @type {Error} */ (err).message);
  }
}

/** סוגר את תוכנת הקליטה אם היא רצה (ביציאה מהמשחק) — לפי שם התהליך. */
function stopReceiver() {
  receiverStarted = false;
  receiverProc = null;
  if (process.platform !== 'win32') return;
  try {
    spawn('taskkill', ['/IM', RECEIVER_EXE, '/F', '/T'], { windowsHide: true, stdio: 'ignore' });
  } catch {
    /* התהליך כבר נסגר */
  }
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
  // בקשת הפעלה של תוכנת הקליטה מה-renderer (בחירת "שחק עם שלטים").
  ipcMain.handle('rf317:launch', () => {
    launchReceiver();
  });
  // בקשה להקפיץ את חלון הקליטה לחזית (להגדרת טווח שלטים / לחיצת Connect).
  ipcMain.handle('rf317:show', () => {
    showReceiver();
  });

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
  stopReceiver(); // סוגר את תוכנת הקליטה ביציאה מהמשחק
});

app.on('window-all-closed', () => {
  // גם ב-macOS נסגור — זו אפליקציית קיוסק לאירוע בודד
  app.quit();
});
