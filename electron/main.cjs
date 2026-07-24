// @ts-check
/**
 * תהליך ה-main של Electron — עוטף את מנוע הטריוויה כאפליקציית שולחן עבודה
 * אופליין לגמרי. טוען את הבנייה הסטטית (dist) מהדיסק דרך file://, בלי שרת
 * ובלי אינטרנט. חלון קיוסק במסך מלא לאירועים חיים.
 *
 * שליטה: F11 מסך מלא/יציאה · Ctrl+Shift+I כלי פיתוח · Ctrl+Q יציאה.
 */

const { app, BrowserWindow, globalShortcut, ipcMain, shell, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { spawn, spawnSync } = require('node:child_process');
const JSZip = require('jszip');
const { createClickerServer, DEFAULT_PORT } = require('./clickerServer.cjs');
const { readSealedFromFile } = require('./sealPayload.cjs');

// סכימת מדיה מהדיסק (trivia-media://) — חייבת להירשם כ"מיוחסת" לפני app.ready
// כדי ש-<video>/<img> יוכלו לטעון ממנה, ותמיכת fetch/זרימה (Range) תעבוד.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'trivia-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

/** @type {BrowserWindow | null} */
let mainWindow = null;

// מופע יחיד: התוכנה מחזיקה שרת TCP (פורט 8090), תהליך ריסיבר וקובצי גיבוי
// משותפים — שני מופעים במקביל היו מפצלים את זרם הקליקרים ביניהם בשקט. לחיצה
// כפולה על ה-EXE (נפוץ כשהחילוץ איטי) רק מקפיצה את החלון של המופע הקיים.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow !== null && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
/** @type {import('node:net').Server | null} */
let clickerServer = null;
/** @type {import('node:child_process').ChildProcess | null} */
let receiverProc = null;
/** @type {{ bytes: Uint8Array, config: object } | null} משחק "סגור" מוטבע ב-EXE. */
let sealedGame = null;

/**
 * טוען משחק מוטבע (אם ה-EXE נחתם ב-seal-game): קורא את הקובץ הנייד המקורי
 * (‏PORTABLE_EXECUTABLE_FILE) ומחלץ ZIP + הגדרות. null אם ה-EXE גנרי.
 */
function loadSealedGame() {
  const file = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  try {
    const res = readSealedFromFile(file);
    if (res !== null) {
      sealedGame = { bytes: res.gameZip, config: res.config };
      console.log('[seal] נמצא משחק מוטבע ב-EXE:', res.config && res.config.name ? res.config.name : '(ללא שם)');
    }
  } catch (err) {
    console.error('[seal] קריאת המשחק המוטבע נכשלה:', /** @type {Error} */ (err).message);
  }
}

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
  // ניקוי עותק יתום מריצה קודמת שקרסה (המשחק נסגר בלי will-quit): בלי זה היו
  // נוצרים שני ריסיברים במקביל — שני לקוחות על הסוקט ואירועים כפולים. ההרג
  // סינכרוני-קצר כדי שלא ירוץ במקביל ל-spawn ויהרוג את העותק החדש.
  try {
    spawnSync('taskkill', ['/IM', RECEIVER_EXE, '/F', '/T'], { windowsHide: true, stdio: 'ignore', timeout: 3000 });
  } catch {
    /* אין עותק קודם — זה המצב הרגיל */
  }
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
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: 'ignore',
    });
    // בלי מאזין, שגיאת spawn אסינכרונית (ENOENT) הייתה מפילה את תהליך ה-main.
    ps.on('error', (err) => console.error('[RF317] הצגת חלון הקליטה נכשלה:', err.message));
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
    const tk = spawn('taskkill', ['/IM', RECEIVER_EXE, '/F', '/T'], { windowsHide: true, stdio: 'ignore' });
    tk.on('error', () => {
      /* taskkill לא זמין — אין מה לעשות */
    });
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
    // עותק מלא (לא view) — Buffer קטן עשוי לשבת ב-pool המשותף של Node, ו-view
    // היה משדר ב-structured-clone את כל ה-ArrayBuffer שמתחתיו (כולל בייטים זרים).
    return { name, bytes: new Uint8Array(bytes) };
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
/**
 * מזהה בטוח לשם קובץ. הסינון משאיר רק ASCII בטוח — ולכן מזהים בעברית (או
 * ריקים) היו מתמפים לאותו שם קובץ ומתנגשים: גיבוי של משחק אחד היה מוצע
 * למשחק אחר. לכן מוסיפים hash קצר של המזהה הגולמי — ייחודי לכל מזהה.
 */
function safeGameId(id) {
  const raw = String(id ?? '');
  const base = raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'game';
  const hash = crypto.createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 10);
  return `${base}-${hash}`;
}
/** נתיב קובץ הגיבוי של משחק מסוים. */
function backupPath(id) {
  return path.join(backupsDir(), `${safeGameId(id)}.json`);
}

// ---------------------------------------------------------------------------
// מטמון מדיה אופליין (זרימה מהדיסק): במקום להחזיק את *כל* מדיית ה-ZIP בזיכרון
// כ-Blob לכל אורך הסשן, מחלצים אותה פעם אחת לתיקייה בדיסק
// (userData/media-cache/<hash>) ומזרימים ממנה דרך פרוטוקול trivia-media://.
// כך רק המדיה המתנגנת כרגע נטענת — הזיכרון נשאר נמוך גם למשחקים כבדי-וידאו.
// שומרים רק את המשחק הנוכחי (prune) כדי שלא ייצבר, וניקוי ידני זמין בנפרד.
// חשוב: התיקייה הזו נפרדת לחלוטין מ-backups/ ומ-reports/ — ניקוי מדיה לעולם
// אינו נוגע בגיבויים או בקבצי התוצאות.
// ---------------------------------------------------------------------------
/** שורש מטמון המדיה (נוצר אם חסר). */
function mediaCacheRoot() {
  const dir = path.join(app.getPath('userData'), 'media-cache');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* קיימת כבר */
  }
  return dir;
}
/** מזהה מטמון בטוח לשם תיקייה (hex בלבד). */
function safeCacheKey(key) {
  return String(key ?? '').replace(/[^a-f0-9]/gi, '').slice(0, 64) || 'x';
}
/** תיקיית המטמון של משחק לפי מזהה. */
function mediaCacheDir(key) {
  return path.join(mediaCacheRoot(), safeCacheKey(key));
}
/**
 * מזהה מטמון יציב לפי תוכן ה-ZIP. דגימה מהירה (אורך + 1MB מכל קצה) כדי שגם
 * קובץ ענק לא ידרוש hash של גיגה-בייטים — מספיק ייחודי כדי להבחין בין משחקים.
 */
function mediaCacheKey(buf) {
  const h = crypto.createHash('sha256').update(String(buf.length));
  const sample = 1 << 20; // 1MB מכל קצה
  if (buf.length <= sample * 2) h.update(buf);
  else {
    h.update(buf.subarray(0, sample));
    h.update(buf.subarray(buf.length - sample));
  }
  return h.digest('hex').slice(0, 24);
}
/** נתיב יחסי בטוח בתוך המטמון — חוסם path traversal / נתיב מוחלט. null = לדלג. */
function safeRelPath(name) {
  const out = [];
  for (const part of String(name).replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') return null; // חשוד — לא מחלצים/מגישים
    out.push(part);
  }
  return out.length > 0 ? out.join('/') : null;
}
/** מחיקת כל המטמונים חוץ מזה שרוצים לשמור — מונע הצטברות בדיסק. */
function pruneMediaCache(keepKey) {
  const keep = safeCacheKey(keepKey);
  try {
    for (const name of fs.readdirSync(mediaCacheRoot())) {
      if (name === keep) continue;
      try {
        fs.rmSync(path.join(mediaCacheRoot(), name), { recursive: true, force: true });
      } catch {
        /* התעלמות */
      }
    }
  } catch {
    /* אין תיקייה */
  }
}
/**
 * חילוץ מדיית ה-ZIP לדיסק (פעם אחת לכל משחק — לפי hash התוכן). אם כבר חולץ
 * (יש manifest) — שימוש חוזר בלי חילוץ מחדש. מחזיר את מזהה המטמון.
 */
async function extractMediaCache(bytes) {
  const buf = Buffer.from(bytes);
  const key = mediaCacheKey(buf);
  const dir = mediaCacheDir(key);
  const manifest = path.join(dir, '.manifest.json');
  if (fs.existsSync(manifest)) {
    pruneMediaCache(key); // כבר חולץ — רק מנקים מטמונים ישנים
    return key;
  }
  pruneMediaCache(key); // שומרים רק את המשחק הנוכחי
  fs.mkdirSync(dir, { recursive: true });
  const zip = await JSZip.loadAsync(buf);
  const names = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const rel = safeRelPath(entry.name);
    if (rel === null) continue;
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, await entry.async('nodebuffer'));
    names.push(rel);
  }
  fs.writeFileSync(manifest, JSON.stringify({ names, savedAt: Date.now() }));
  return key;
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
  if (!gotSingleInstanceLock) return; // מופע משני — נסגר; לא מרימים כלום
  loadSealedGame(); // משחק מוטבע (EXE סגור) — אם קיים, ייטען אוטומטית ב-renderer
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
  // סגירת תוכנת הקליטה — במעבר לדמה/טלפונים אין בה צורך והחלון רק מפריע.
  ipcMain.handle('rf317:stop', () => {
    stopReceiver();
  });
  // זכירת המשחק האחרון (בייטי ZIP + שם) + שליפה/מחיקה.
  ipcMain.handle('game:remember', (_e, name, bytes) => {
    rememberLastGame(name, bytes);
  });
  ipcMain.handle('game:getLast', () => getLastGame());
  // משחק מוטבע ("סגור") ב-EXE — { bytes, config } או null.
  ipcMain.handle('game:sealed', () => sealedGame);
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

  // פרוטוקול trivia-media:// — מגיש קבצי מדיה מהמטמון בדיסק בזרימה (net.fetch
  // על file:// תומך ב-Range, כך שחיפוש/דילוג בווידאו עובד) — רק המדיה המתנגנת
  // כרגע נטענת, לא הכול לזיכרון. עם הגנת traversal (safeRelPath + בדיקת prefix).
  protocol.handle('trivia-media', async (request) => {
    try {
      const url = new URL(request.url);
      const key = safeCacheKey(decodeURIComponent(url.hostname));
      const rel = safeRelPath(decodeURIComponent(url.pathname));
      if (rel === null) return new Response('forbidden', { status: 403 });
      const root = path.resolve(mediaCacheDir(key));
      const file = path.resolve(path.join(root, rel));
      if (file !== root && !file.startsWith(root + path.sep)) {
        return new Response('forbidden', { status: 403 });
      }
      if (!fs.existsSync(file)) return new Response('not found', { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    } catch (err) {
      console.error('[media] הגשת מדיה נכשלה:', /** @type {Error} */ (err).message);
      return new Response('error', { status: 500 });
    }
  });
  // חילוץ מדיית ה-ZIP לדיסק (מצב זרימה) — מחזיר { cacheKey } או null.
  ipcMain.handle('media:extract', async (_e, bytes) => {
    try {
      return { cacheKey: await extractMediaCache(bytes) };
    } catch (err) {
      console.error('[media] חילוץ מדיה נכשל:', /** @type {Error} */ (err).message);
      return null;
    }
  });
  // ניקוי מדיה זמנית מהדיסק. מזהה ריק/חסר = כל המטמון. לעולם לא נוגע
  // בגיבויים (backups/) או בקבצי התוצאות (reports/) — הם בתיקיות נפרדות.
  ipcMain.handle('media:clear', (_e, cacheKey) => {
    try {
      if (cacheKey) fs.rmSync(mediaCacheDir(cacheKey), { recursive: true, force: true });
      else fs.rmSync(mediaCacheRoot(), { recursive: true, force: true });
      return true;
    } catch (err) {
      console.error('[media] ניקוי מדיה נכשל:', /** @type {Error} */ (err).message);
      return false;
    }
  });
  // יציאה מהמשחק (סגירת ה-EXE) — נקרא אחרי אישור המשתמש ב-renderer.
  ipcMain.handle('app:quit', () => {
    app.quit();
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
