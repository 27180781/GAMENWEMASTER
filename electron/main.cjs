// @ts-check
/**
 * תהליך ה-main של Electron — עוטף את מנוע הטריוויה כאפליקציית שולחן עבודה
 * אופליין לגמרי. טוען את הבנייה הסטטית (dist) מהדיסק דרך file://, בלי שרת
 * ובלי אינטרנט. חלון קיוסק במסך מלא לאירועים חיים.
 *
 * שליטה: F11 מסך מלא/יציאה · Ctrl+Shift+I כלי פיתוח · Ctrl+Q יציאה.
 */

const { app, BrowserWindow, dialog, globalShortcut, ipcMain, shell, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { spawn, spawnSync } = require('node:child_process');
const JSZip = require('jszip');
const { createClickerServer, DEFAULT_PORT } = require('./clickerServer.cjs');
const { readSealedFromFile, sealToFile } = require('./sealPayload.cjs');
const { canAutoUpdate } = require('./updateGate.cjs');
const { findGameEntryName, mapStrings } = require('./gameZip.cjs');
const { sameFile, replaceSelf, cleanupOldSelf } = require('./selfUpdate.cjs');
const { remoteErrorMessage } = require('./remoteErrors.cjs');
const { hasZipEndRecord, tailLength } = require('./zipIntegrity.cjs');
const {
  writeEncryptedMedia,
  readEncryptedMediaRange,
  encryptedMediaSize,
  isEncryptedMedia,
} = require('./contentCrypto.cjs');

/**
 * רשת ביטחון להגירה: אם תיקיית היעד עדיין לא קיימת אבל קיימת תיקייה מהשמות
 * הישנים/החלופיים — משתמשים בה. מריצים *לפני* הנעילה שלמטה, כך שמשתמש שהתקין
 * גרסה שבה נגזר שם אחר לא "מאבד" את המשחק האחרון, המרשמים והגיבויים.
 */
function migrateLegacyUserData(appData, target) {
  try {
    const targetPath = path.join(appData, target);
    if (fs.existsSync(targetPath)) return; // כבר יש נתונים במקום הנכון
    for (const legacy of ['Trivia Engine', 'חוויה בקליק']) {
      const legacyPath = path.join(appData, legacy);
      if (fs.existsSync(legacyPath)) {
        fs.renameSync(legacyPath, targetPath);
        console.log('[userData] הועברה תיקיית נתונים ישנה:', legacy, '→', target);
        return;
      }
    }
  } catch (err) {
    // כישלון הגירה אינו מפיל את התוכנה — פשוט מתחילים מתיקייה חדשה.
    console.warn('[userData] הגירת תיקיית נתונים נכשלה:', /** @type {Error} */ (err).message);
  }
}

/**
 * תיקיית הנתונים ננעלת לשם הקבוע 'trivia-engine'.
 *
 * שם התוכנה שמוצג למשתמש הוא "חוויה בקליק", ו-Electron גוזר את נתיב ה-userData
 * משם האפליקציה — כלומר שינוי שם היה מעביר את התיקייה, ועם ההתקנה החדשה היו
 * "נעלמים" המשחק האחרון, המרשמים, הגיבויים והתוצאות של המשתמש. הנעילה
 * המפורשת מנתקת את הקשר בין השם המוצג לבין מיקום הנתונים, לתמיד.
 */
migrateLegacyUserData(app.getPath('appData'), 'trivia-engine');
app.setPath('userData', path.join(app.getPath('appData'), 'trivia-engine'));

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
/** @type {BrowserWindow | null} חלון "מסך המנחה" הנפרד (שליטה ויזואלית). */
let hostWindow = null;
/** מזהה מטמון המדיה של המשחק הנוכחי — יעד לקבצי מדיה שנוספים בעריכה חיה. */
let currentMediaCacheKey = '';

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
 * נתיב קובץ ה-EXE *הנייד* של התוכנה עצמה — הקובץ הבודד שאפשר להעתיק, לחתום
 * ולשלוח הלאה. בגרסה הניידת האפליקציה רצה מתיקייה זמנית, ולכן process.execPath
 * מצביע על עותק פנימי שאינו עומד בפני עצמו; הנתיב האמיתי נמצא במשתנה הסביבה
 * שהמעטפת הניידת מגדירה. null = לא רצים מגרסה ניידת (פיתוח או התקנה NSIS).
 * @returns {string | null}
 */
function portableExePath() {
  const p = process.env.PORTABLE_EXECUTABLE_FILE;
  return typeof p === 'string' && p !== '' ? p : null;
}

/**
 * האם אפשר לחתום מהתוכנה הזו: קובץ נייד ארוז, שאינו חתום בעצמו. (התקנת NSIS
 * אינה קובץ בודד ולכן אינה יכולה לשמש בסיס; EXE חתום כבר טוען משחק משלו.)
 */
function sealCapable() {
  const selfPath = portableExePath();
  if (!app.isPackaged || selfPath === null) return false;
  return readSealedFromFile(selfPath) === null;
}

/**
 * האם הקובץ שרץ הוא **כלי החתימה** (‏SealEXE.exe) ולא נגן המשחקים.
 *
 * למה לפי שם הקובץ: כלי החתימה והנגן הנייד הם אותו בינארי בדיוק (הכלי חותם על
 * עצמו), ולכן אין בהם שום הבדל פנימי להיתלות בו — רק השם שבו הורידו אותו.
 *
 * למה זה חשוב: תיקיית ה-userData משותפת לכל העותקים (אותו appId), וביניהם גם
 * "המשחק האחרון" שנשמר. בלי ההבחנה הזו, הרצת כלי החתימה הייתה טוענת אוטומטית
 * משחק ישן שנשמר במחשב ומציגה אותו במקום את הכלי.
 */
function isSealerBuild() {
  const selfPath = portableExePath();
  if (selfPath === null || !sealCapable()) return false;
  return /seal/i.test(path.basename(selfPath));
}

// ---------------------------------------------------------------------------
// עדכון אוטומטי (גרסת ההתקנה בלבד)
// ---------------------------------------------------------------------------

/** מצב העדכון האחרון שנשלח ל-renderer — לשידור חוזר לחלון שנפתח מאוחר. */
let lastUpdateState = null;
/** מתי נבדק עדכון לאחרונה — מונע הצפה כשהרשת מתחברת ומתנתקת שוב ושוב. */
let lastUpdateCheck = 0;
const UPDATE_CHECK_GAP_MS = 10 * 60 * 1000;
/** @type {import('electron-updater').AppUpdater | null} */
let updater = null;

/** האם מותר לעדכן את התוכנה הזו אוטומטית — הכלל עצמו ב-updateGate.cjs. */
function updateAllowed() {
  return canAutoUpdate({
    packaged: app.isPackaged,
    sealed: sealedGame !== null,
    portable: portableExePath() !== null,
  });
}

/** משדר מצב עדכון ל-renderer ושומר אותו לשידור חוזר. */
function pushUpdateState(state) {
  lastUpdateState = state;
  sendToRenderer('app:update', state);
}

/**
 * מפעיל את בדיקת העדכונים: פעם אחת זמן קצר אחרי הפתיחה (לא מיד — שלא תתחרה
 * בטעינת המשחק), כל שש שעות, ובכל פעם שהמחשב חוזר לרשת (ה-renderer מדווח).
 *
 * ההתקנה עצמה קורית *בסגירת התוכנה* (autoInstallOnAppQuit) ולא באמצע — אירוע
 * חי לעולם לא ייקטע בהתקנה או בהפעלה מחדש.
 */
function startAutoUpdate() {
  if (!updateAllowed()) {
    // לא כישלון — פשוט אין עדכון אוטומטי לקובץ הזה. חשוב לומר את זה למשתמש,
    // אחרת אין לו שום דרך לדעת אם התוכנה מתעדכנת או לא. שני סייגים:
    //   • כלי החתימה כן מתעדכן (selfUpdateSealer) — הודעת "נייד לא מתעדכן"
    //     שם הייתה שקרית.
    //   • לא דורסים מצב שכבר שודר (למשל 'sealer' מהעדכון העצמי שרץ קודם).
    if (isSealerBuild() || lastUpdateState !== null) return;
    pushUpdateState({
      state: 'unsupported',
      version: app.getVersion(),
      reason: sealedGame !== null ? 'sealed' : portableExePath() !== null ? 'portable' : 'dev',
    });
    return;
  }
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
  } catch (err) {
    console.warn('[update] מודול העדכון אינו זמין:', /** @type {Error} */ (err).message);
    return;
  }
  if (updater === null) return;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('checking-for-update', () => {
    pushUpdateState({ state: 'checking', version: app.getVersion() });
  });
  updater.on('update-not-available', () => {
    pushUpdateState({ state: 'current', version: app.getVersion() });
  });
  updater.on('update-available', (info) => {
    console.log('[update] נמצאה גרסה חדשה:', info.version);
    pushUpdateState({ state: 'downloading', version: String(info.version), percent: 0 });
  });
  updater.on('download-progress', (p) => {
    pushUpdateState({ state: 'downloading', percent: Math.round(p.percent) });
  });
  updater.on('update-downloaded', (info) => {
    console.log('[update] הגרסה החדשה מוכנה ותותקן בסגירה:', info.version);
    pushUpdateState({ state: 'ready', version: String(info.version) });
  });
  updater.on('error', (err) => {
    // אין רשת / המהדורה לא זמינה — לא שגיאה שדורשת פעולה, אבל כן מדווחת:
    // "לא הצלחנו לבדוק" זו תשובה שימושית יותר מחיווי ריק.
    console.warn('[update] בדיקת עדכון נכשלה:', err.message);
    pushUpdateState({ state: 'offline', version: app.getVersion() });
  });
  checkForUpdate();
  setInterval(checkForUpdate, 6 * 60 * 60 * 1000);
}

/** בדיקת עדכון בפועל, עם מרווח מינימלי בין בדיקות. */
function checkForUpdate() {
  if (updater === null) return;
  const now = Date.now();
  if (now - lastUpdateCheck < UPDATE_CHECK_GAP_MS) return;
  lastUpdateCheck = now;
  updater.checkForUpdates().catch(() => {
    /* השגיאה כבר נרשמה במאזין error */
  });
}

/**
 * עדכון עצמי של כלי "חתום EXE".
 *
 * הכלי הוא הקובץ הנייד, ו-electron-updater אינו תומך ביעד portable — אבל אין
 * בכך צורך: הכלי ממילא מוריד את הבינארי העדכני כדי לחתום עליו, וזה *בדיוק*
 * הקובץ שהוא צריך בשביל עצמו. אז אם מה שהורדנו שונה ממה שרץ — מחליפים.
 *
 * ההחלפה נכנסת לתוקף בפתיחה הבאה (התהליך הרץ ממשיך עם התמונה הישנה), בדיוק
 * כמו עדכון גרסת ההתקנה. הלוגיקה הרגישה (שלא להישאר בלי כלי) ב-selfUpdate.cjs.
 */
async function selfUpdateSealer() {
  const selfPath = portableExePath();
  if (!app.isPackaged || selfPath === null || !isSealerBuild()) return;
  if (cleanupOldSelf(selfPath)) console.log('[seal-update] נוקתה שארית מעדכון קודם');
  try {
    const latest = await fetchLatestBase((p) => {
      if (p.phase === 'base' && p.total > 0) {
        pushUpdateState({ state: 'downloading', percent: Math.round((p.received / p.total) * 100) });
      }
    });
    if (latest === null) {
      // אין רשת — ממשיכים לעבוד עם מה שיש, אבל אומרים זאת: בלי הדיווח הזה
      // שורת הגרסה הייתה נשארת על "בודק עדכון…" לנצח.
      pushUpdateState({ state: 'offline', version: app.getVersion() });
      return;
    }
    if (sameFile(latest, selfPath)) {
      pushUpdateState({ state: 'current', version: app.getVersion() }); // הגרסה האחרונה
      return;
    }
    if (replaceSelf(selfPath, latest)) {
      console.log('[seal-update] הכלי עודכן; ייכנס לתוקף בפתיחה הבאה');
      pushUpdateState({ state: 'sealer' });
    } else {
      // תיקייה לא-כתיבה (Program Files / כונן לקריאה בלבד) — לא נכשלים בשקט.
      console.warn('[seal-update] לא ניתן לכתוב לתיקיית הכלי — נדרשת הורדה ידנית');
      pushUpdateState({ state: 'manual' });
    }
  } catch (err) {
    console.warn('[seal-update] עדכון הכלי נכשל:', /** @type {Error} */ (err).message);
    pushUpdateState({ state: 'offline', version: app.getVersion() });
  }
}

// ---------------------------------------------------------------------------
// שמירת עריכה מקומית לתוך קובץ המשחק
// ---------------------------------------------------------------------------

/**
 * שומר משחק ערוך בחזרה לתוך חבילת ה-ZIP שעל הדיסק, כך שהשינויים שורדים סגירה
 * ופתיחה מחדש.
 *
 * החלק הלא-טריוויאלי הוא **מדיה שנוספה בעריכה**: היא נשמרת במטמון המדיה
 * (מוצפנת) ומקבלת כתובת ‎trivia-media://<cacheKey>/… — כתובת שתקפה *לסשן הזה
 * בלבד*. אם היינו כותבים אותה לקובץ המשחק, הפתיחה הבאה הייתה מציגה מדיה חסרה.
 * לכן כל קובץ כזה מפוענח, נכנס לארכיון תחת media-edits/, והכתובת בקובץ המשחק
 * מוחלפת בנתיב יחסי — בדיוק כמו כל נכס אחר בחבילה.
 *
 * @param {string} dataJson קובץ המשחק הערוך (JSON)
 * @returns {Promise<{ ok: boolean, error?: string, addedMedia?: number }>}
 */
async function saveEditedGame(dataJson) {
  const zipPath = lastGameZipPath();
  if (!fs.existsSync(zipPath)) return { ok: false, error: 'לא נמצאה חבילת משחק לשמירה' };
  let parsed;
  try {
    parsed = JSON.parse(String(dataJson));
  } catch (err) {
    return { ok: false, error: `קובץ המשחק אינו JSON תקין: ${/** @type {Error} */ (err).message}` };
  }

  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const entryName = findGameEntryName(Object.keys(zip.files));
  if (entryName === null) return { ok: false, error: 'לא נמצא קובץ משחק בתוך החבילה' };

  // מדיה שנוספה בעריכה → לתוך הארכיון, והכתובת → נתיב יחסי.
  const dir = entryName.includes('/') ? `${entryName.slice(0, entryName.lastIndexOf('/'))}/` : '';
  let added = 0;
  const baked = mapStrings(parsed, (s) => {
    if (!s.startsWith('trivia-media://')) return s;
    try {
      const rest = s.slice('trivia-media://'.length);
      const slash = rest.indexOf('/');
      if (slash <= 0) return s;
      const cacheKey = decodeURIComponent(rest.slice(0, slash));
      const rel = safeRelPath(rest.slice(slash + 1).split('/').map(decodeURIComponent).join('/'));
      if (rel === null) return s;
      const src = path.join(mediaCacheDir(cacheKey), rel);
      if (!fs.existsSync(src)) return s;
      const bytes = isEncryptedMedia(src)
        ? readEncryptedMediaRange(src, cacheKey, 0, encryptedMediaSize(src) - 1)
        : fs.readFileSync(src);
      const target = `media-edits/${rel.split('/').pop()}`;
      zip.file(`${dir}${target}`, bytes);
      added += 1;
      return target;
    } catch (err) {
      console.warn('[edit] הטמעת מדיה נכשלה:', /** @type {Error} */ (err).message);
      return s;
    }
  });

  zip.file(entryName, JSON.stringify(baked));
  // כתיבה זמנית ואז החלפה — קריסה באמצע לא משאירה חבילה חתוכה.
  const tmp = `${zipPath}.saving`;
  const out = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(tmp, out);
  fs.rmSync(zipPath, { force: true });
  fs.renameSync(tmp, zipPath);
  console.log('[edit] המשחק נשמר:', entryName, `${added} קובצי מדיה הוטמעו`);
  return { ok: true, addedMedia: added };
}

// ---------------------------------------------------------------------------
// טעינת משחק מהשרת לפי קוד (חלופה לטעינת ZIP מהדיסק)
// ---------------------------------------------------------------------------

/** ‏Edge Functions של מערכת יצירת המשחקים. מפתח ה-anon ציבורי מעצם הגדרתו. */
const REMOTE_BASE_URL =
  process.env.TRIVIA_REMOTE_URL || 'https://oousxptmdrrkybadikec.supabase.co/functions/v1';
const REMOTE_ANON_KEY =
  process.env.TRIVIA_REMOTE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vdXN4cHRtZHJya3liYWRpa2VjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMDc3NzcsImV4cCI6MjA5Mjc4Mzc3N30.9Qb5TZeI-yn3ueuTXh6-XDoFA31FV7EvKGYMu_1QY8c';
/** פסק-זמן על *שקט* בקו (לא על הגודל) — משחק עם וידאו יכול לקחת דקות. */
const REMOTE_IDLE_MS = 45 * 1000;
const REMOTE_CEILING_MS = 20 * 60 * 1000;

/**
 * מוריד חבילת משחק מהשרת לפי קוד הקליקרים, ישר אל מקום "המשחק האחרון" בדיסק.
 *
 * הבייטים לא עוברים דרך ה-renderer: חבילה עם וידאו שוקלת מאות MB, והמסלול
 * הקיים (game:loadSaved) ממילא יודע לחלץ אותה מהדיסק ולהחזיר רק את data.json.
 *
 * @param {string} code קוד המשחק (clickers_game_code)
 * @param {(p: object) => void} onProgress
 * @returns {Promise<{ ok: boolean, error?: string, bytes?: number }>}
 */
function downloadGameByCode(code, onProgress) {
  return new Promise((resolve) => {
    const clean = String(code ?? '').trim();
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(clean)) {
      resolve({ ok: false, error: 'קוד משחק לא תקין' });
      return;
    }
    const url = `${REMOTE_BASE_URL}/download-by-code?code=${encodeURIComponent(clean)}`;
    const partPath = `${lastGameZipPath()}.part`;
    let settled = false;
    /** @type {NodeJS.Timeout | null} */
    let idleTimer = null;
    /** @type {import('node:fs').WriteStream | null} */
    let out = null;
    /** @type {import('electron').ClientRequest | null} */
    let req = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (idleTimer !== null) clearTimeout(idleTimer);
      clearTimeout(ceiling);
      try {
        req?.abort();
      } catch {
        /* כבר נסגר */
      }
      if (out !== null) {
        out.destroy();
        out = null;
        try {
          fs.rmSync(partPath, { force: true });
        } catch {
          /* אין חלקי */
        }
      }
      resolve(result);
    };
    const ceiling = setTimeout(
      () => finish({ ok: false, error: 'ההורדה ארכה יותר מדי — נסו שוב' }),
      REMOTE_CEILING_MS,
    );
    const touch = () => {
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => finish({ ok: false, error: 'ההורדה נתקעה — בדקו את החיבור לאינטרנט' }),
        REMOTE_IDLE_MS,
      );
    };

    onProgress({ phase: 'connect' });
    try {
      req = net.request({ method: 'GET', url });
    } catch (err) {
      finish({ ok: false, error: /** @type {Error} */ (err).message });
      return;
    }
    req.setHeader('apikey', REMOTE_ANON_KEY);
    req.setHeader('Authorization', `Bearer ${REMOTE_ANON_KEY}`);
    req.on('error', (err) => finish({ ok: false, error: `החיבור לשרת נכשל: ${err.message}` }));
    req.on('response', (res) => {
      const status = res.statusCode;
      if (status !== 200) {
        res.resume?.();
        // ההודעה אומרת מה קרה ומה לעשות — ראו remoteErrors.cjs. במיוחד 546,
        // שאינו שגיאה בקוד שהוקלד אלא כשל אריזה בשרת בגלל מדיה כבדה.
        console.warn('[remote] הורדה לפי קוד נכשלה:', clean, 'HTTP', status);
        finish({ ok: false, error: remoteErrorMessage(status) });
        return;
      }
      const lenHeader = res.headers['content-length'];
      const total = Number(Array.isArray(lenHeader) ? lenHeader[0] : lenHeader) || 0;
      let received = 0;
      try {
        out = fs.createWriteStream(partPath);
      } catch (err) {
        finish({ ok: false, error: /** @type {Error} */ (err).message });
        return;
      }
      out.on('error', (err) => finish({ ok: false, error: `כתיבה לדיסק נכשלה: ${err.message}` }));
      touch();
      res.on('data', (chunk) => {
        received += chunk.length;
        out?.write(chunk);
        touch();
        onProgress({ phase: 'download', received, total });
      });
      res.on('error', (err) => finish({ ok: false, error: err.message }));
      res.on('end', () => {
        if (settled || out === null) return;
        const stream = out;
        out = null; // מכאן ה-part הופך לקובץ המשחק — אין למחוק אותו ב-finish
        stream.end(() => {
          try {
            if (received === 0) {
              fs.rmSync(partPath, { force: true });
              finish({ ok: false, error: 'התקבלה חבילה ריקה מהשרת' });
              return;
            }
            // השרת אורז בסטרימינג ולכן אין Content-Length — אין גודל צפוי
            // להשוות אליו. בלי הבדיקה הזו, חיבור שנפל ב-90% היה כותב חבילה
            // חתוכה *במקום* המשחק הקודם שעבד, והתקלה הייתה מתגלה רק באירוע.
            const tail = Buffer.alloc(tailLength(received));
            const fd = fs.openSync(partPath, 'r');
            try {
              fs.readSync(fd, tail, 0, tail.length, received - tail.length);
            } finally {
              fs.closeSync(fd);
            }
            if (!hasZipEndRecord(tail, received)) {
              fs.rmSync(partPath, { force: true });
              console.warn('[remote] חבילה חתוכה — אין EOCD:', clean, received, 'בתים');
              finish({
                ok: false,
                error: 'ההורדה נקטעה באמצע — המשחק הקודם נשמר. בדקו את החיבור ונסו שוב',
              });
              return;
            }
            fs.rmSync(lastGameZipPath(), { force: true });
            fs.renameSync(partPath, lastGameZipPath());
            fs.writeFileSync(
              lastGameMetaPath(),
              JSON.stringify({ name: `משחק ${clean}`, savedAt: Date.now(), code: clean }),
            );
            console.log('[remote] משחק הורד לפי קוד:', clean, `${(received / 1048576).toFixed(1)}MB`);
            finish({ ok: true, bytes: received });
          } catch (err) {
            finish({ ok: false, error: /** @type {Error} */ (err).message });
          }
        });
      });
    });
    req.end();
  });
}

/** ה-EXE הבסיסי העדכני — המהדורה היציבה שנבנית מכל קומיט ב-main. */
const SEAL_BASE_URL =
  'https://github.com/27180781/GAMENWEMASTER/releases/download/desktop-latest/TriviaEngine-Portable.exe';
/** תקרת זמן להורדת הבסיס, ופסק-זמן על *שקט* בקו (לא על הגודל). */
const BASE_DOWNLOAD_CEILING_MS = 10 * 60 * 1000;
const BASE_DOWNLOAD_IDLE_MS = 45 * 1000;

/** תיקיית מטמון ה-EXE הבסיסי (בתוך userData — לא נוגעת בגיבויים/בתוצאות). */
function sealBaseDir() {
  const dir = path.join(app.getPath('userData'), 'seal-base');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * מוריד את ה-EXE הבסיסי מהמהדורה היציבה, כדי שכל משחק שנחתם ייצא עם **הגרסה
 * האחרונה** של המנוע — גם אם הכלי שבידי המשתמש ישן. הקובץ נשמר במטמון יחד עם
 * ה-ETag שלו, כך שחתימה חוזרת שולחת בקשה מותנית ומקבלת 304 במקום ~90MB.
 *
 * מחזיר נתיב לקובץ בסיס מקומי, או null אם אין רשת ואין מטמון — ואז החותם
 * נופל חזרה על ה-EXE שרץ.
 *
 * @param {(p: object) => void} onProgress
 * @returns {Promise<string | null>}
 */
let baseFetchInFlight = null;
/** ה-onProgress של הקורא האחרון — הוא זה שמסכו מוצג בפועל. */
let baseProgressCb = null;

/**
 * עטיפה עם הגנת "בקשה אחת בכל רגע": העדכון העצמי של הכלי והחתימה עצמה מושכים
 * את אותו קובץ לאותו נתיב. שתי הורדות במקביל היו כותבות זו על זו ומייצרות בסיס
 * פגום. הקורא השני מקבל את אותה הבטחה, וההתקדמות מוצגת לו.
 * @param {(p: object) => void} onProgress
 * @returns {Promise<string | null>}
 */
function fetchLatestBase(onProgress) {
  baseProgressCb = onProgress;
  if (baseFetchInFlight !== null) return baseFetchInFlight;
  baseFetchInFlight = runBaseFetch((p) => baseProgressCb?.(p)).finally(() => {
    baseFetchInFlight = null;
    baseProgressCb = null;
  });
  return baseFetchInFlight;
}

function runBaseFetch(onProgress) {
  return new Promise((resolve) => {
    let dir;
    try {
      dir = sealBaseDir();
    } catch {
      resolve(null);
      return;
    }
    const exePath = path.join(dir, 'base.exe');
    const partPath = path.join(dir, 'base.part');
    const metaPath = path.join(dir, 'base.json');
    const cached = fs.existsSync(exePath) ? exePath : null;
    let etag = '';
    try {
      etag = String(JSON.parse(fs.readFileSync(metaPath, 'utf8')).etag || '');
    } catch {
      /* אין מטא — נוריד מלא */
    }

    let settled = false;
    /** @type {NodeJS.Timeout | null} */
    let idleTimer = null;
    /** @type {import('electron').ClientRequest | null} */
    let req = null;
    /** @type {import('node:fs').WriteStream | null} */
    let out = null;
    const finish = (/** @type {string | null} */ value) => {
      if (settled) return;
      settled = true;
      if (idleTimer !== null) clearTimeout(idleTimer);
      clearTimeout(ceiling);
      try {
        req?.abort();
      } catch {
        /* כבר נסגר */
      }
      if (out !== null) {
        out.destroy();
        try {
          fs.rmSync(partPath, { force: true });
        } catch {
          /* אין חלקי */
        }
      }
      resolve(value);
    };
    const ceiling = setTimeout(() => finish(cached), BASE_DOWNLOAD_CEILING_MS);
    const touch = () => {
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish(cached), BASE_DOWNLOAD_IDLE_MS);
    };

    onProgress({ phase: 'base', received: 0, total: 0 });
    try {
      req = net.request({ method: 'GET', url: SEAL_BASE_URL });
    } catch {
      finish(cached);
      return;
    }
    if (etag !== '' && cached !== null) req.setHeader('If-None-Match', etag);
    req.on('error', () => finish(cached));
    req.on('response', (res) => {
      const status = res.statusCode;
      if (status === 304 && cached !== null) {
        console.log('[seal] בסיס עדכני כבר במטמון (304)');
        finish(cached);
        return;
      }
      if (status !== 200) {
        console.warn('[seal] הורדת הבסיס החזירה', status);
        res.resume?.();
        finish(cached);
        return;
      }
      const lenHeader = res.headers['content-length'];
      const total = Number(Array.isArray(lenHeader) ? lenHeader[0] : lenHeader) || 0;
      const newEtag = String(
        (Array.isArray(res.headers.etag) ? res.headers.etag[0] : res.headers.etag) || '',
      );
      let received = 0;
      out = fs.createWriteStream(partPath);
      out.on('error', () => finish(cached));
      touch();
      res.on('data', (chunk) => {
        received += chunk.length;
        out?.write(chunk);
        touch();
        onProgress({ phase: 'base', received, total });
      });
      res.on('error', () => finish(cached));
      res.on('end', () => {
        if (settled || out === null) return;
        const stream = out;
        out = null; // מכאן אין למחוק את ה-part — הוא הופך לקובץ הבסיס
        stream.end(() => {
          try {
            fs.rmSync(exePath, { force: true });
            fs.renameSync(partPath, exePath);
            fs.writeFileSync(metaPath, JSON.stringify({ etag: newEtag, size: received }), 'utf8');
            console.log('[seal] הורד בסיס עדכני:', `${(received / 1048576).toFixed(1)}MB`);
            finish(exePath);
          } catch (err) {
            console.warn('[seal] שמירת הבסיס נכשלה:', /** @type {Error} */ (err).message);
            finish(cached);
          }
        });
      });
    });
    req.end();
  });
}

/**
 * טוען משחק מוטבע (אם ה-EXE נחתם ב-seal-game): קורא את הקובץ הנייד המקורי
 * (‏PORTABLE_EXECUTABLE_FILE) ומחלץ ZIP + הגדרות. null אם ה-EXE גנרי.
 */
function loadSealedGame() {
  const file = portableExePath() || process.execPath;
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
    // בתים שנדחו = הזרם מתוכנת הקליטה לא היה מיושר. נרשם כדי שהתופעה תהיה
    // נראית (ותיאום עם הבהוב סטטוס הדונגל יצביע על המקור), ולא תיעלם בשקט.
    onDropped: (dropped, total) =>
      console.warn(`[RF317] ${dropped} בתים לא מיושרים נדחו (סה"כ ${total}) — הזרם התיישר מחדש`),
    onListening: (p) => console.log(`[RF317] מאזין לקליקרים על 127.0.0.1:${p}`),
    onError: (err) => console.error('[RF317] שגיאת שרת קליקרים:', err.message),
  });
}

/** שם קובץ ההרצה של תוכנת הקליטה — לזיהוי/סגירה/הבאה-לחזית לפי שם התהליך. */
const RECEIVER_EXE = 'RF317SocketForm.exe';
/** האם כבר הפעלנו את תוכנת הקליטה בהרצה הנוכחית (מונע הפעלה כפולה). */
let receiverStarted = false;
/** תהליך ה"שומר" שממזער את חלון הקליטה אחרי ההפעלה (ראו hideReceiverWindow). */
/** @type {import('node:child_process').ChildProcess | null} */
let receiverHideProc = null;
/** נודניק חד-פעמי להחזרת המיקוד למשחק אחרי ההפעלה. @type {NodeJS.Timeout | null} */
let receiverFocusTimer = null;
/** מפוגג את "המשחק מעל הכול" בתום חלון ההפעלה. @type {NodeJS.Timeout | null} */
let onTopTimer = null;

/** מחזיר את המיקוד לחלון המשחק — המקלדת (רווח/2) עובדת רק כשהוא בחזית. */
function focusGameWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
}

/** מבטל את "המשחק מעל הכול" ומחזיר את המצב הרגיל. */
function releaseGameOnTop() {
  if (onTopTimer !== null) {
    clearTimeout(onTopTimer);
    onTopTimer = null;
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(false);
}

/**
 * מחזיק את חלון המשחק מעל שאר החלונות למשך זמן קצוב. זהו הגיבוי למזעור: אם
 * PowerShell חסום במדיניות ארגונית או שהמזעור אֵחר, חלון הקליטה עדיין נשאר
 * *מתחת* למשחק ולא מכסה אותו באמצע אירוע חי.
 * @param {number} ms
 */
function keepGameOnTop(ms) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (onTopTimer !== null) clearTimeout(onTopTimer);
  mainWindow.setAlwaysOnTop(true);
  onTopTimer = setTimeout(releaseGameOnTop, ms);
}

/** עוצר את השומר ואת הנודניק — כשהמשתמש ביקש במפורש לראות את חלון הקליטה. */
function cancelReceiverHide() {
  if (receiverFocusTimer !== null) {
    clearTimeout(receiverFocusTimer);
    receiverFocusTimer = null;
  }
  releaseGameOnTop();
  if (receiverHideProc !== null) {
    try {
      receiverHideProc.kill();
    } catch {
      /* כבר הסתיים */
    }
    receiverHideProc = null;
  }
}

/**
 * ממזער את חלון תוכנת הקליטה מיד כשהוא נפתח, כדי שלא יקפוץ מעל המשחק באמצע
 * אירוע חי — ומחזיר את המיקוד לחלון המשחק (בלי מיקוד, מקשי הרווח/2 לא עובדים).
 *
 * למה "שומר" ולא מזעור חד-פעמי: החלון נוצר כמה מאות מילישניות אחרי ה-spawn,
 * והתוכנה מציגה אותו שוב אחרי האתחול הפנימי שלה. לכן ממתינים לו (עד 20 שניות)
 * וממשיכים למזער עוד ~4 שניות אחרי שנמצא. לחיצה על "חלון קליטת שלטים" עוצרת
 * את השומר (cancelReceiverHide), כדי שלא ילחם בבקשה מפורשת של המשתמש.
 */
function hideReceiverWindow() {
  if (process.platform !== 'win32') return;
  cancelReceiverHide();
  // גיבוי בלתי-תלוי ב-PowerShell: כל עוד השומר פועל, המשחק נשאר מעל.
  keepGameOnTop(8000);
  const script = [
    'Add-Type @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class WinH {',
    '  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int c);',
    '}',
    '"@',
    '$deadline = (Get-Date).AddSeconds(20)',
    '$first = $null',
    'while ((Get-Date) -lt $deadline) {',
    '  foreach ($p in @(Get-Process RF317SocketForm -ErrorAction SilentlyContinue)) {',
    '    $p.Refresh()',
    '    if ($p.MainWindowHandle -ne 0) {',
    '      [WinH]::ShowWindowAsync($p.MainWindowHandle, 6) | Out-Null', // 6 = SW_MINIMIZE
    '      if ($null -eq $first) { $first = Get-Date }',
    '    }',
    '  }',
    '  if ($null -ne $first -and ((Get-Date) - $first).TotalSeconds -ge 4) { break }',
    '  Start-Sleep -Milliseconds 250',
    '}',
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  try {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: 'ignore',
    });
    receiverHideProc = ps;
    ps.on('error', (err) => {
      console.error('[RF317] מזעור חלון הקליטה נכשל:', err.message);
      if (receiverHideProc === ps) receiverHideProc = null;
    });
    ps.on('exit', () => {
      if (receiverHideProc !== ps) return; // בוטל בבקשת "הצג" — לא נוגעים במיקוד
      receiverHideProc = null;
      focusGameWindow();
    });
  } catch (err) {
    console.error('[RF317] מזעור חלון הקליטה נכשל:', /** @type {Error} */ (err).message);
    receiverHideProc = null;
  }
  // נודניק מוקדם: המזעור מעביר את ההפעלה לחלון הבא בתור, אך אם התוכנה עדיין
  // באתחול — מחזירים את המיקוד למשחק גם לפני שהשומר סיים.
  receiverFocusTimer = setTimeout(() => {
    receiverFocusTimer = null;
    focusGameWindow();
  }, 1500);
}

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
    hideReceiverWindow(); // שלא תקפוץ מעל המשחק — ממוזערת מיד, המיקוד חוזר למשחק
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
  cancelReceiverHide(); // בקשה מפורשת גוברת על השומר שממזער אחרי ההפעלה
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
  cancelReceiverHide(); // אין את מי למזער, ואין להחזיר מיקוד אחרי סגירה
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
/** סוג MIME לפי סיומת — נדרש כי המדיה מוגשת מפוענחת מהזיכרון (לא דרך file://). */
function mimeForPath(p) {
  const ext = (p.split('.').pop() || '').toLowerCase();
  const map = {
    mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4',
    aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/opus',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon',
    json: 'application/json', txt: 'text/plain',
  };
  return map[ext] || 'application/octet-stream';
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
 * קריאת קובץ טקסט מהמטמון (data.json). הקבצים שמורים מוצפנים; קובץ ישן/גלוי
 * (ממטמון שנוצר לפני ההצפנה) עדיין נקרא כרגיל.
 */
function readCachedText(dir, rel, key) {
  const full = path.join(dir, rel);
  if (!isEncryptedMedia(full)) return fs.readFileSync(full, 'utf8');
  const size = encryptedMediaSize(full);
  return readEncryptedMediaRange(full, key, 0, size - 1).toString('utf8');
}

/** איתור data.json בתוך רשימת שמות (בכל עומק, ללא תלות ברישיות). */
function findDataPath(names) {
  return (
    names.find((n) => (n.split('/').pop() ?? '').toLowerCase() === 'data.json') ??
    names.find((n) => n.toLowerCase().endsWith('.json')) ??
    null
  );
}

/**
 * חילוץ ה-ZIP לדיסק (פעם אחת לכל משחק — לפי hash התוכן). אם כבר חולץ (יש
 * manifest) — שימוש חוזר בלי חילוץ מחדש ובלי לפתוח את הארכיון כלל.
 *
 * מחזיר את מזהה המטמון יחד עם `data.json` (טקסט זעיר) ורשימת שמות הקבצים —
 * כך שה-renderer יכול לבנות את המשחק בלי לקבל את בייטי ה-ZIP המלאים.
 */
async function extractGameToCache(bytes) {
  const buf = Buffer.from(bytes);
  const key = mediaCacheKey(buf);
  const dir = mediaCacheDir(key);
  const manifestPath = path.join(dir, '.manifest.json');

  // מטמון קיים: קוראים את המניפסט ואת data.json מהדיסק — בלי לפתוח ZIP.
  if (fs.existsSync(manifestPath)) {
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const names = Array.isArray(m.names) ? m.names : [];
      const dataPath = typeof m.dataPath === 'string' ? m.dataPath : findDataPath(names);
      if (dataPath !== null && fs.existsSync(path.join(dir, dataPath))) {
        pruneMediaCache(key);
        currentMediaCacheKey = key;
        return { cacheKey: key, dataPath, dataJson: readCachedText(dir, dataPath, key), names };
      }
    } catch {
      /* מניפסט פגום/ישן — מחלצים מחדש */
    }
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
    // המדיה נשמרת **מוצפנת** בדיסק ומפוענחת רק תוך כדי נגינה (בפרוטוקול
    // trivia-media://). כך אין קובץ וידאו/תמונה פתוח בסייר הקבצים בשום רגע.
    writeEncryptedMedia(dest, await entry.async('nodebuffer'), key);
    names.push(rel);
  }
  const dataPath = findDataPath(names);
  fs.writeFileSync(manifestPath, JSON.stringify({ names, dataPath, savedAt: Date.now() }));
  currentMediaCacheKey = key;
  const dataJson = dataPath !== null ? readCachedText(dir, dataPath, key) : '';
  return { cacheKey: key, dataPath, dataJson, names };
}

/** תאימות: חילוץ שמחזיר את מזהה המטמון בלבד (נתיב ה-ZIP-מה-renderer). */
async function extractMediaCache(bytes) {
  return (await extractGameToCache(bytes)).cacheKey;
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

/** @type {BrowserWindow | null} חלון "התוכנה נטענת" עד שהחלון הראשי מוכן. */
let splashWindow = null;

/**
 * פותח חלון פתיחה קטן מיד עם עליית Electron. בלעדיו יש כמה שניות ללא שום סימן
 * חיים אחרי הלחיצה — והמשתמש לוחץ שוב. (מנעול המופע היחיד מונע תוכנה כפולה,
 * אבל בזמן הזה עדיין לא רץ תהליך שיכול להקפיץ חלון קיים.)
 */
function createSplash() {
  try {
    splashWindow = new BrowserWindow({
      width: 460,
      height: 300,
      frame: false,
      resizable: false,
      center: true,
      alwaysOnTop: true,
      skipTaskbar: false,
      backgroundColor: '#0b0e1a',
      title: 'מנוע הטריוויה — נטען',
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    void splashWindow.loadFile(path.join(__dirname, 'splash.html'));
    splashWindow.on('closed', () => {
      splashWindow = null;
    });
  } catch (err) {
    console.warn('[splash] פתיחת חלון הטעינה נכשלה:', /** @type {Error} */ (err).message);
    splashWindow = null;
  }
}

/** סוגר את חלון הטעינה (אם עדיין פתוח). */
function closeSplash() {
  if (splashWindow !== null && !splashWindow.isDestroyed()) splashWindow.destroy();
  splashWindow = null;
}

/** מצב החלון כפי שה-UI צריך אותו. null לחלון שכבר נסגר. */
function windowStateOf(win) {
  if (win === null || win.isDestroyed()) return null;
  return { fullscreen: win.isFullScreen(), minimizable: win.isMinimizable() };
}

/**
 * מדווח ל-renderer על כל שינוי במצב מסך-מלא, כולל שינויים שלא הגיעו מה-UI
 * (F11, מנהל החלונות של Windows) — כדי שהכפתור בפינה יראה תמיד את האמת.
 */
function reportWindowState(win) {
  const send = () => {
    if (!win.isDestroyed()) win.webContents.send('win:state', windowStateOf(win));
  };
  win.on('enter-full-screen', send);
  win.on('leave-full-screen', send);
  win.on('restore', send);
}

function createWindow() {
  // כלי החתימה אינו משחק: חלון רגיל עם כותרת, לא קיוסק במסך מלא — כדי שדיאלוג
  // השמירה ושאר החלונות של Windows יתנהגו כרגיל, ושיהיה ברור מה רץ.
  const sealer = isSealerBuild();
  mainWindow = new BrowserWindow({
    width: sealer ? 1180 : 1280,
    height: sealer ? 820 : 720,
    backgroundColor: '#0b0e1a',
    fullscreen: !sealer,
    title: sealer ? 'חתום EXE' : 'חוויה בקליק',
    // מוצג רק כשיש מה להראות — עד אז חלון הטעינה מחזיק את המשתמש.
    show: false,
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

  hardenWindow(mainWindow);
  reportWindowState(mainWindow);

  /** מעבר מחלון הטעינה לחלון האמיתי — פעם אחת, מאיזה מסלול שיגיע קודם. */
  const reveal = () => {
    if (mainWindow === null || mainWindow.isDestroyed() || mainWindow.isVisible()) return;
    closeSplash();
    mainWindow.show();
    mainWindow.focus();
  };
  mainWindow.once('ready-to-show', reveal);
  // רשת ביטחון: אם ready-to-show לא מגיע (כשל טעינה), עדיף חלון עם הודעת שגיאה
  // מאשר מסך תקוע על "נטען" לנצח.
  setTimeout(reveal, 20000);

  mainWindow.on('closed', () => {
    mainWindow = null;
    closeSplash();
  });
}

/**
 * הקשחת חלון בגרסה הארוזה: חסימת תפריט-הקשר (שמירת תמונה/וידאו בקליק ימני)
 * וחסימת ניווט/חלונות חיצוניים. בפיתוח לא מפריעים לעבודה.
 */
function hardenWindow(win) {
  if (!app.isPackaged) return;
  win.webContents.on('context-menu', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

/**
 * פותח את חלון "מסך המנחה" — חלון Electron רגיל (לא קיוסק) שטוען את אותה
 * אפליקציה עם ‎#host, ומציג קונסולת שליטה ויזואלית. אם כבר פתוח — מביא לחזית.
 * הסנכרון מול המסך הגדול עובר דרך ממסר control:post/control:msg שב-main.
 */
function openHostWindow() {
  if (hostWindow !== null && !hostWindow.isDestroyed()) {
    if (hostWindow.isMinimized()) hostWindow.restore();
    hostWindow.focus();
    return;
  }
  hostWindow = new BrowserWindow({
    width: 1240,
    height: 840,
    backgroundColor: '#0b0e1a',
    autoHideMenuBar: true,
    title: 'מסך מנחה',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  void hostWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: 'host' });
  hardenWindow(hostWindow);
  hostWindow.on('closed', () => {
    hostWindow = null;
  });
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return; // מופע משני — נסגר; לא מרימים כלום
  createSplash(); // "התוכנה נטענת" — לפני כל עבודה כבדה, שיהיה סימן חיים מיד
  loadSealedGame(); // משחק מוטבע (EXE סגור) — אם קיים, ייטען אוטומטית ב-renderer
  createWindow();
  startClickerServer(); // שרת קליקרי RF317 (מקומי, פורט 8090)
  // עדכון אוטומטי — אחרי loadSealedGame, שהבדיקה "האם זה EXE חתום" תהיה נכונה.
  // ההשהיה נותנת למשחק להיטען קודם; בדיקת הרשת אינה דחופה.
  setTimeout(startAutoUpdate, 20000);
  // עדכון עצמי של כלי "חתום EXE" — מסלול נפרד, כי הקובץ הנייד אינו נתמך
  // ב-electron-updater. ההשהיה קצרה יותר: הכלי אינו מריץ אירוע חי.
  setTimeout(() => void selfUpdateSealer(), 8000);
  /** דיווח מה-renderer שהמחשב חזר לרשת — הזדמנות טובה לבדוק עדכון. */
  ipcMain.handle('app:online', () => {
    checkForUpdate();
  });
  /** מצב העדכון האחרון — לחלון שנפתח אחרי שהאירוע כבר שודר. */
  ipcMain.handle('app:updateState', () => lastUpdateState);
  /** מספר הגרסה של התוכנה הרצה — מוצג תמיד, גם בלי עדכון אוטומטי. */
  ipcMain.handle('app:version', () => app.getVersion());
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
  // זכירת המשחק האחרון (בייטי ZIP + שם) + שליפה/מחיקה. תיקיית ה-userData
  // משותפת לכל העותקים של התוכנה (אותו appId), ולכן כלי החתימה לא נוגע ב"משחק
  // האחרון" כלל — לא קורא ממנו (שלא יטען משחק ישן במקום להציג את הכלי) ולא
  // כותב אליו (שלא ידרוס את המשחק של הנגן).
  ipcMain.handle('game:remember', (_e, name, bytes) => {
    if (isSealerBuild()) return;
    rememberLastGame(name, bytes);
  });
  ipcMain.handle('game:getLast', () => (isSealerBuild() ? null : getLastGame()));
  // טעינת משחק מהשרת לפי קוד — נשמר במקום "המשחק האחרון", ומשם נטען במסלול
  // הרגיל (game:loadSaved) בלי להעביר את הבייטים ל-renderer.
  // שמירת עריכה מקומית לתוך חבילת המשחק. חסום במשחק סגור (EXE חתום) — שם
  // המשחק הוא חלק מהקובץ עצמו ואינו ניתן לשינוי.
  ipcMain.handle('game:saveEdited', async (_e, dataJson) => {
    if (sealedGame !== null) return { ok: false, error: 'משחק סגור אינו ניתן לעריכה' };
    if (isSealerBuild()) return { ok: false, error: 'לא זמין בכלי החתימה' };
    try {
      return await saveEditedGame(dataJson);
    } catch (err) {
      const msg = /** @type {Error} */ (err).message;
      console.error('[edit] שמירת המשחק נכשלה:', msg);
      return { ok: false, error: msg };
    }
  });
  ipcMain.handle('game:downloadByCode', async (e, code) => {
    if (isSealerBuild()) return { ok: false, error: 'לא זמין בכלי החתימה' };
    return downloadGameByCode(code, (p) => {
      if (!e.sender.isDestroyed()) e.sender.send('game:downloadProgress', p);
    });
  });
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

  /**
   * חתימת משחק ל-EXE חדש — "חתום EXE" מתוך התוכנה עצמה, בלי שורת פקודה.
   *
   * בסיס החתימה: קודם כול מנסים את **הגרסה העדכנית** של המנוע מהמהדורה היציבה
   * (הורדה עם מטמון ETag), כדי שכל משחק שנחתם ייצא עם המנוע האחרון — גם אם
   * הכלי שבידי המשתמש ישן. אם אין רשת/ההורדה נכשלה — נופלים חזרה על ה-EXE
   * הנייד שרץ כרגע, שמשמש כבסיס בעצמו (בלי חותמת קודמת, אם יש).
   */
  ipcMain.handle('seal:create', async (e, zipBytes, config, suggested, opts) => {
    try {
      const selfPath = portableExePath();
      if (!app.isPackaged || selfPath === null) {
        return { ok: false, error: 'חתימה זמינה רק מהקובץ הנייד (SealEXE.exe / TriviaEngine-Portable.exe)' };
      }
      const name = String(suggested || 'משחק')
        .replace(/[\\/:*?"<>|]/g, '_')
        .slice(0, 60);
      const picked = await dialog.showSaveDialog({
        title: 'שמירת EXE חתום',
        defaultPath: path.join(app.getPath('desktop'), `${name}.exe`),
        filters: [{ name: 'Windows EXE', extensions: ['exe'] }],
      });
      if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };

      const notify = (/** @type {object} */ p) => {
        if (!e.sender.isDestroyed()) e.sender.send('seal:progress', p);
      };
      let basePath = selfPath;
      let baseSource = 'self';
      if (!opts || opts.useLatest !== false) {
        const latest = await fetchLatestBase(notify);
        if (latest !== null) {
          basePath = latest;
          baseSource = 'latest';
        }
      }
      notify({ phase: 'writing' });
      const size = sealToFile(basePath, Buffer.from(zipBytes), config, picked.filePath);
      notify({ phase: 'done' });
      console.log('[seal] נוצר EXE חתום:', picked.filePath, `${(size / 1048576).toFixed(1)}MB`, `base=${baseSource}`);
      return { ok: true, path: picked.filePath, size, baseSource };
    } catch (err) {
      const msg = /** @type {Error} */ (err).message;
      console.error('[seal] חתימה נכשלה:', msg);
      return { ok: false, error: msg };
    }
  });

  /**
   * מצב החתימה של התוכנה הנוכחית:
   *   capable — אפשר לחתום ממנה (קובץ נייד ארוז שאינו חתום בעצמו).
   *   tool    — היא *כלי החתימה* עצמו (SealEXE.exe), ולא נגן משחקים.
   */
  ipcMain.handle('seal:mode', () => ({ capable: sealCapable(), tool: isSealerBuild() }));

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
      // קובץ ישן/גלוי (מטמון מלפני ההצפנה) — מוגש כרגיל.
      if (!isEncryptedMedia(file)) return net.fetch(pathToFileURL(file).toString());

      // מדיה מוצפנת: מפענחים **רק את הטווח המבוקש**, בזיכרון, ומגישים. אין
      // בשום שלב קובץ מפוענח על הדיסק. תמיכת Range נשמרת, ולכן דילוג/חיפוש
      // בווידאו עובד והנגן לא מושך את כל הקובץ.
      const total = encryptedMediaSize(file);
      const type = mimeForPath(file);
      const range = request.headers.get('Range');
      const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
      if (m) {
        const start = m[1] ? Number(m[1]) : 0;
        const end = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
        if (Number.isNaN(start) || start > end || start >= total) {
          return new Response('range not satisfiable', {
            status: 416,
            headers: { 'Content-Range': `bytes */${total}` },
          });
        }
        const body = readEncryptedMediaRange(file, key, start, end);
        return new Response(body, {
          status: 206,
          headers: {
            'Content-Type': type,
            'Content-Length': String(body.length),
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Accept-Ranges': 'bytes',
          },
        });
      }
      const body = readEncryptedMediaRange(file, key, 0, total - 1);
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': type,
          'Content-Length': String(body.length),
          'Accept-Ranges': 'bytes',
        },
      });
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
  // טעינת משחק שמור/מוטבע *בלי* להעביר את ה-ZIP ל-renderer וחזרה: ה-main קורא
  // אותו ישירות מהדיסק (או מהמטען המוטבע), מחלץ, ומחזיר רק את data.json
  // ורשימת השמות — כמה עשרות KB במקום גיגה-בייטים בצינור.
  ipcMain.handle('game:loadSaved', async (_e, source) => {
    try {
      let bytes = null;
      let config = null;
      if (source === 'sealed') {
        if (sealedGame === null) return null;
        bytes = sealedGame.bytes;
        config = sealedGame.config;
      } else {
        if (isSealerBuild()) return null; // כלי החתימה אינו נגן — ראו game:getLast
        const zipPath = lastGameZipPath();
        if (!fs.existsSync(zipPath)) return null;
        bytes = fs.readFileSync(zipPath);
      }
      if (!bytes || bytes.length === 0) return null;
      const res = await extractGameToCache(bytes);
      if (res.dataPath === null || res.dataJson === '') return null;
      let name = '';
      try {
        name = String(JSON.parse(fs.readFileSync(lastGameMetaPath(), 'utf8')).name ?? '');
      } catch {
        /* אין מטא — שם ריק */
      }
      return config !== null ? { ...res, config, name } : { ...res, name };
    } catch (err) {
      console.error('[game] טעינת משחק שמור נכשלה:', /** @type {Error} */ (err).message);
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

  // מסך המנחה: פתיחת החלון הנפרד + ממסר הודעות שליטה בין החלונות. משדרים רק
  // לחלונות *האחרים* (בלי הד לשולח) — כך התצוגה ומסך המנחה מדברים בלי לולאות.
  ipcMain.handle('host:open', () => {
    openHostWindow();
  });
  ipcMain.on('control:post', (e, msg) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed() && w.webContents.id !== e.sender.id) {
        w.webContents.send('control:msg', msg);
      }
    }
  });
  // שמירת קובץ מדיה שנוסף בעריכה חיה — לתוך מטמון המדיה של המשחק הנוכחי,
  // תחת _edits, ומוגש כ-trivia-media://. מחזיר את הכתובת או null.
  ipcMain.handle('media:addFile', (_e, name, bytes) => {
    try {
      if (!currentMediaCacheKey) return null;
      const raw = String(name || '');
      const ext = raw.includes('.') ? raw.split('.').pop() : '';
      const safeExt = ext && /^[a-z0-9]{1,5}$/i.test(ext) ? `.${ext.toLowerCase()}` : '';
      const file = `${crypto.randomUUID()}${safeExt}`;
      const dir = path.join(mediaCacheDir(currentMediaCacheKey), '_edits');
      fs.mkdirSync(dir, { recursive: true });
      // גם מדיה שנוספת בעריכה חיה נשמרת מוצפנת, כמו שאר המדיה.
      writeEncryptedMedia(path.join(dir, file), Buffer.from(bytes), currentMediaCacheKey);
      return `trivia-media://${currentMediaCacheKey}/_edits/${file}`;
    } catch (err) {
      console.error('[media] שמירת קובץ עריכה נכשלה:', /** @type {Error} */ (err).message);
      return null;
    }
  });
  // מעבר לתצוגה מורחבת (Windows) — הכלי המובנה DisplaySwitch.exe /extend.
  ipcMain.handle('display:extend', () => {
    if (process.platform !== 'win32') return;
    try {
      const p = spawn('DisplaySwitch.exe', ['/extend'], { windowsHide: true, stdio: 'ignore' });
      p.on('error', (err) => console.error('[display] הרחבת תצוגה נכשלה:', err.message));
    } catch (err) {
      console.error('[display] הרחבת תצוגה נכשלה:', /** @type {Error} */ (err).message);
    }
  });

  // ---- שליטה בחלון עצמו (EXE) ----
  // חלון המשחק נפתח במסך מלא בלי מסגרת, ולכן אין לו כפתורי מזעור/גרירה של
  // Windows. בלי הממשק הזה אי אפשר להזיז אותו למסך השני או למזער אותו —
  // וכפתור "מסך מלא" שב-UI השתמש ב-Fullscreen API של הדפדפן, שאינו מזיז
  // כלל את מצב החלון של Electron.
  ipcMain.handle('win:state', (e) => windowStateOf(BrowserWindow.fromWebContents(e.sender)));
  ipcMain.handle('win:setFullscreen', (e, on) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win === null || win.isDestroyed()) return null;
    win.setFullScreen(on === true);
    return windowStateOf(win);
  });
  ipcMain.handle('win:minimize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win === null || win.isDestroyed()) return null;
    // ממוזער *ממסך מלא* חוזר בדרך כלל למסך מלא ומסתיר שוב את שורת המשימות —
    // יוצאים ממסך מלא קודם, כך שאחרי המזעור החלון ניתן לגרירה למסך השני.
    if (win.isFullScreen()) win.setFullScreen(false);
    win.minimize();
    return windowStateOf(win);
  });

  // קיצורי מקלדת גלובליים למפעיל
  globalShortcut.register('F11', () => {
    if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });
  // כלי הפיתוח נפתחים רק בפיתוח: בגרסה הארוזה הם היו מאפשרים לכל אחד לראות
  // את כתובות המדיה ואת קוד האפליקציה ולשמור אותם. (ניתן להפעיל במודע דרך
  // משתנה הסביבה TRIVIA_DEVTOOLS=1 לצורך אבחון בשטח.)
  if (!app.isPackaged || process.env.TRIVIA_DEVTOOLS === '1') {
    globalShortcut.register('CommandOrControl+Shift+I', () => {
      mainWindow?.webContents.toggleDevTools();
    });
  }
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
