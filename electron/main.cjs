// @ts-check
/**
 * תהליך ה-main של Electron — עוטף את מנוע הטריוויה כאפליקציית שולחן עבודה
 * אופליין לגמרי. טוען את הבנייה הסטטית (dist) מהדיסק דרך file://, בלי שרת
 * ובלי אינטרנט. חלון קיוסק במסך מלא לאירועים חיים.
 *
 * שליטה: F11 מסך מלא/יציאה · Ctrl+Shift+I כלי פיתוח · Ctrl+Q יציאה.
 */

const { app, BrowserWindow, globalShortcut, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
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
 * כלקוח לשרת המקומי (פורט 8090) ומזרימה את לחיצות השלטים. מופעלת **ישירות**
 * (‏spawn של ה-exe עצמו) עם תיקיית עבודה נכונה — כך שתמצא את ה-DLL ותתחבר.
 * (הפעלה דרך cmd/‏start /min נכשלה כשנתיב המשתמש כלל תווים לא-לטיניים.)
 * no-op מחוץ ל-Windows, ואם כבר רצה — לא מפעילים שוב.
 */
function launchReceiver() {
  if (process.platform !== 'win32') return; // התוכנה היא Windows בלבד
  if (receiverStarted && receiverProc !== null && receiverProc.exitCode === null) return; // כבר רצה
  const base = receiverDir();
  const exe = path.join(base, RECEIVER_EXE);
  try {
    receiverProc = spawn(exe, [], { cwd: base, stdio: 'ignore', windowsHide: false });
    receiverProc.on('error', (err) => {
      console.error('[RF317] הפעלת תוכנת הקליטה נכשלה:', err.message);
      receiverStarted = false;
      receiverProc = null;
    });
    receiverProc.on('exit', () => {
      receiverStarted = false;
      receiverProc = null;
    });
    receiverStarted = true;
    console.log('[RF317] תוכנת הקליטה הופעלה:', exe);
  } catch (err) {
    console.error('[RF317] הפעלת תוכנת הקליטה נכשלה:', /** @type {Error} */ (err).message);
    receiverStarted = false;
    receiverProc = null;
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

// ---------------------------------------------------------------------------
// זכירת המשחק האחרון: שומרים את בייטי ה-ZIP האחרון שנטען ב-userData, כדי
// שבפתיחה הבאה של ה-EXE המשחק כבר יהיה טעון (בלי לבחור קובץ שוב). שמירת
// הבייטים עצמם (ולא נתיב) — עמיד גם אם קובץ המקור הוזז/נמחק.
// ---------------------------------------------------------------------------
/** נתיב קובץ ה-ZIP השמור של המשחק האחרון. */
function lastGameZipPath() {
  return path.join(app.getPath('userData'), 'last-game.zip');
}
/** נתיב קובץ המטא (שם המשחק) של המשחק האחרון. */
function lastGameMetaPath() {
  return path.join(app.getPath('userData'), 'last-game.json');
}

/** שמירת המשחק האחרון (בייטי ZIP + שם) לטעינה אוטומטית בפתיחה הבאה. */
function rememberLastGame(name, bytes) {
  try {
    fs.writeFileSync(lastGameZipPath(), Buffer.from(bytes));
    fs.writeFileSync(lastGameMetaPath(), JSON.stringify({ name: String(name ?? ''), savedAt: Date.now() }));
  } catch (err) {
    console.error('[game] שמירת המשחק האחרון נכשלה:', /** @type {Error} */ (err).message);
  }
}

/** שליפת המשחק האחרון שנשמר, או null אם אין. מחזיר בייטים + שם. */
function getLastGame() {
  try {
    const zip = lastGameZipPath();
    if (!fs.existsSync(zip)) return null;
    const bytes = fs.readFileSync(zip);
    let name = '';
    try {
      name = String(JSON.parse(fs.readFileSync(lastGameMetaPath(), 'utf8')).name ?? '');
    } catch {
      /* מטא חסר — שם ריק */
    }
    // מחזירים Uint8Array (עובר דרך contextBridge/structured-clone).
    return { name, bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
  } catch (err) {
    console.error('[game] שליפת המשחק האחרון נכשלה:', /** @type {Error} */ (err).message);
    return null;
  }
}

/** מחיקת המשחק האחרון השמור ("טען משחק אחר"). */
function forgetLastGame() {
  for (const p of [lastGameZipPath(), lastGameMetaPath()]) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* התעלמות */
    }
  }
}

// ---------------------------------------------------------------------------
// גיבוי אופליין לדיסק: מצב המשחק (שחקנים/קבוצות/הצבעות/ניקוד/מיקום) נשמר
// כקובץ JSON לפי מזהה המשחק, ב-userData/backups. כך שום נתון לא הולך לאיבוד
// גם באופליין — בטעינת אותו משחק מציעים "להמשיך מהגיבוי".
// ---------------------------------------------------------------------------
/** תיקיית הגיבויים (נוצרת אם חסרה). */
function backupsDir() {
  const dir = path.join(app.getPath('userData'), 'backups');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* קיימת כבר */
  }
  return dir;
}
/** מזהה בטוח לשם קובץ (בלי תווים בעייתיים). */
function safeGameId(id) {
  return String(id ?? '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'game';
}
/** נתיב קובץ הגיבוי של משחק מסוים. */
function backupPath(id) {
  return path.join(backupsDir(), `${safeGameId(id)}.json`);
}

/** תיקיית קבצי התוצאות (אקסל) — נוצרת אם חסרה. */
function reportsDir() {
  const dir = path.join(app.getPath('userData'), 'reports');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* קיימת כבר */
  }
  return dir;
}
/** שם קובץ בטוח לתוצאות. */
function safeReportName(name) {
  const base = String(name ?? '').replace(/[\\/:*?"<>|]/g, ' ').trim() || 'results';
  return base.toLowerCase().endsWith('.xlsx') ? base : `${base}.xlsx`;
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
  // זכירת המשחק האחרון (בייטי ZIP + שם) + שליפה/מחיקה.
  ipcMain.handle('game:remember', (_e, name, bytes) => {
    rememberLastGame(name, bytes);
  });
  ipcMain.handle('game:getLast', () => getLastGame());
  ipcMain.handle('game:forget', () => {
    forgetLastGame();
  });
  // גיבוי אופליין לדיסק — שמירה/שליפה/מחיקה לפי מזהה המשחק.
  ipcMain.handle('backup:save', (_e, id, json) => {
    try {
      fs.writeFileSync(backupPath(id), String(json));
      return true;
    } catch (err) {
      console.error('[backup] שמירת גיבוי נכשלה:', /** @type {Error} */ (err).message);
      return false;
    }
  });
  ipcMain.handle('backup:load', (_e, id) => {
    try {
      const p = backupPath(id);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    } catch (err) {
      console.error('[backup] שליפת גיבוי נכשלה:', /** @type {Error} */ (err).message);
      return null;
    }
  });
  ipcMain.handle('backup:clear', (_e, id) => {
    try {
      const p = backupPath(id);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* התעלמות */
    }
  });
  // שמירת קובץ תוצאות (אקסל) לתיקיית reports; מחזיר את הנתיב המלא.
  ipcMain.handle('report:save', (_e, name, bytes) => {
    try {
      const full = path.join(reportsDir(), safeReportName(name));
      fs.writeFileSync(full, Buffer.from(bytes));
      console.log('[report] נשמר קובץ תוצאות:', full);
      return full;
    } catch (err) {
      console.error('[report] שמירת תוצאות נכשלה:', /** @type {Error} */ (err).message);
      return null;
    }
  });
  // פתיחת תיקיית התוצאות בסייר הקבצים.
  ipcMain.handle('report:open', () => {
    void shell.openPath(reportsDir());
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
