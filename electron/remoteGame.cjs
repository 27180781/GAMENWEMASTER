// @ts-check
/**
 * הורדת משחק לפי קוד — ישירות מהאחסון, במקביל, עם המשך אחרי ניתוק.
 *
 * עד עכשיו התוכנה ביקשה מ-download-by-code חבילת ZIP מוכנה: פונקציית שרת
 * שמושכת את קובצי המדיה אחד אחרי השני ומעבירה את כולם דרכה בחיבור אחד. עכשיו
 * התוכנה מבקשת רק את **הרשימה** (get-offline-manifest?code=…): ה-JSON של
 * המשחק וכתובות המדיה. את הקבצים היא מורידה בעצמה, ישירות מ-Cloudflare,
 * כמה במקביל — ואורזת אותם במחשב לאותה חבילת ZIP שהספרייה, המטמון המוצפן
 * וכלי החתימה מכירים. כך ההורדה מהירה כמו מהאתר, ואינה תלויה בזיכרון או
 * בזמן הריצה של פונקציית השרת (546 על משחקים כבדים).
 *
 * המשך אחרי ניתוק: כל קובץ יורד ל-`<קוד>.download/` בתוך ספריית המשחקים,
 * קובץ שהושלם נשאר שם, וקובץ שנקטע נשאר כ-`.part` וממשיך מאותה נקודה
 * (Range) בפעם הבאה שמקלידים את הקוד. הרשימה נשמרת לצדם: קובץ שכתובתו
 * השתנתה מאז (המשחק נערך) יורד מחדש. רק כשהכול במקום נבנית החבילה.
 *
 * עדכון של משחק שכבר במחשב (`seedFrom`): כל קובץ מדיה שכתובתו לא השתנתה
 * מועתק מהחבילה הקודמת במקום לרדת שוב — הכתובות נשמרות לשם כך ב-manifest.json
 * של החבילה. תיקון ניסוח של שאלה במשחק של 300MB הוא כך עדכון של שניות.
 *
 * הרשת, הדיסק והשעון מוזרקים — ראו tests/remoteGame.test.ts.
 */
const fs = require('node:fs');
const path = require('node:path');
const lib = require('./gameLibrary.cjs');
const { writeStoreZip } = require('./zipStore.cjs');
const { hasZipEndRecord, tailLength } = require('./zipIntegrity.cjs');
const { readZipDirectory, readZipEntry, extractZipEntry } = require('./zipRead.cjs');

/** כמה קבצים יורדים במקביל. */
const CONCURRENCY = 4;
/** כמה פעמים לנסות קובץ שנקטע (כל ניסיון ממשיך מהחלק שכבר ירד). */
const FILE_ATTEMPTS = 3;

/**
 * @typedef {{ url: string, localPath: string }} MediaEntry
 * @typedef {{ gameJson: Record<string, unknown>, mediaFiles?: { url?: unknown, localPath?: unknown }[], version?: unknown }} Manifest
 * @typedef {{ received: number, total: number }} FileProgress
 * @typedef {{ ok: true, bytes: number } | { ok: false, error: string, retryable: boolean, status?: number }} FileResult
 * @typedef {(url: string, dest: string, opts: { onProgress: (p: FileProgress) => void, signal?: AbortSignal }) => Promise<FileResult>} DownloadFile
 * @typedef {{ phase: 'connect' | 'download' | 'pack', received?: number, total?: number, files?: number, filesDone?: number }} Progress
 */

/** תיקיית ההורדה החלקית של קוד — ליד החבילה שתיבנה ממנה. */
function downloadDir(userData, code) {
  return path.join(lib.gamesDir(userData), `${code}.download`);
}

/**
 * נתיב מקומי בטוח בתוך החבילה: יחסי, בלי `..`, בלי כונן ובלי לוכסנים הפוכים.
 * @param {unknown} p
 * @returns {string | null}
 */
function safeLocalPath(p) {
  if (typeof p !== 'string') return null;
  const rel = p.replace(/\\/g, '/');
  if (rel === '' || rel.length > 400 || rel.startsWith('/')) return null;
  const parts = rel.split('/');
  if (parts.some((s) => s === '' || s === '.' || s === '..')) return null;
  if (/^[A-Za-z]:/.test(rel)) return null;
  return parts.join('/');
}

/**
 * הרשימה שתורד: כתובות http(s) בלבד, נתיבים בטוחים, בלי כפילויות בנתיב.
 * @param {Manifest['mediaFiles']} mediaFiles
 * @returns {MediaEntry[]}
 */
function planMedia(mediaFiles) {
  /** @type {MediaEntry[]} */
  const out = [];
  const seen = new Set();
  for (const raw of mediaFiles ?? []) {
    const url = typeof raw?.url === 'string' ? raw.url : '';
    const localPath = safeLocalPath(raw?.localPath);
    if (!/^https?:\/\//i.test(url) || localPath === null || seen.has(localPath)) continue;
    seen.add(localPath);
    out.push({ url, localPath });
  }
  return out;
}

/** @param {string} file */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** @param {string} p */
function rmQuiet(p) {
  try {
    fs.rmSync(p, { force: true, recursive: true });
  } catch {
    /* אין מה למחוק */
  }
}

/**
 * העתקת קובצי מדיה שלא השתנו מחבילה קודמת של אותו משחק אל תיקיית ההורדה —
 * לפי הכתובת שלהם, כפי שנרשמה ב-manifest.json של החבילה. כל קובץ נבדק מול
 * ה-CRC שבחבילה; קובץ שלא הועתק פשוט יורד כרגיל.
 * @param {string} zipPath
 * @param {MediaEntry[]} media
 * @param {string} dir
 * @returns {Promise<number>} כמה קבצים הועתקו
 */
async function seedFromPackage(zipPath, media, dir) {
  const entries = readZipDirectory(zipPath);
  if (entries === null) return 0;
  const byName = new Map(entries.map((e) => [e.name, e]));
  const manifestEntry = byName.get('manifest.json');
  const raw = manifestEntry === undefined ? null : readZipEntry(zipPath, manifestEntry);
  if (raw === null) return 0;
  /** @type {Map<string, string>} */
  const pathByUrl = new Map();
  try {
    const files = JSON.parse(raw.toString('utf8'))?.files;
    for (const f of Array.isArray(files) ? files : []) {
      if (typeof f?.url === 'string' && typeof f?.path === 'string') pathByUrl.set(f.url, f.path);
    }
  } catch {
    return 0;
  }
  let seeded = 0;
  for (const m of media) {
    const dest = path.join(dir, m.localPath);
    if (fs.existsSync(dest)) continue; // כבר ירד בניסיון קודם
    const old = pathByUrl.get(m.url);
    const entry = old === undefined ? undefined : byName.get(old);
    if (entry === undefined) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (await extractZipEntry(zipPath, entry, dest)) seeded += 1;
  }
  return seeded;
}

/** הגרסה של החבילה: מהשרת, ואחרת מתוך data.json. @param {Manifest} manifest */
function packageVersion(manifest) {
  if (typeof manifest.version === 'string' && manifest.version !== '') return manifest.version;
  const meta = /** @type {{ version?: unknown } | undefined} */ (manifest.gameJson?.metadata);
  return typeof meta?.version === 'string' && meta.version !== '' ? meta.version : null;
}

const ABORTED = 'ההורדה הופסקה. מה שכבר ירד נשמר, וההורדה הבאה תמשיך מאותה נקודה';

/**
 * @param {string} code
 * @param {{
 *   userData: string,
 *   fetchManifest: (code: string) => Promise<Manifest>,
 *   downloadFile: DownloadFile,
 *   onProgress?: (p: Progress) => void,
 *   concurrency?: number,
 *   log?: (msg: string) => void,
 *   seedFrom?: string | null,
 *   signal?: AbortSignal,
 *   select?: boolean,
 *   source?: string,
 *   pendingOpen?: boolean,
 *   expectedVersion?: string | null,
 * }} deps
 *   seedFrom — חבילה קודמת של אותו משחק להעתקת קבצים שלא השתנו;
 *   expectedVersion — הגרסה שהבדיקה מול המערכת הכריזה עליה, למקרה שהרשימה
 *   מגיעה בלי גרסה (שרת ישן): בלי גרסה רשומה, כל בדיקה הייתה מורידה שוב;
 *   signal — הפסקה (החבילה הקיימת לא מוחלפת, והחלקים נשמרים להמשך);
 *   select: false — רישום בספרייה בלי להחליף את המשחק הנוכחי.
 * @returns {Promise<
 *   | { ok: true, bytes: number, files: number, skipped: string[], seeded: number, gameId: string | null, version: string | null }
 *   | { ok: false, error: string, resumable: boolean, aborted?: boolean }
 * >}
 */
async function downloadGameDirect(code, deps) {
  const {
    userData,
    fetchManifest,
    downloadFile,
    onProgress = () => {},
    concurrency = CONCURRENCY,
    log = () => {},
    seedFrom = null,
    signal,
    select = true,
    source,
    pendingOpen = false,
    expectedVersion = null,
  } = deps;
  if (!lib.isSafeCode(code)) return { ok: false, error: 'קוד משחק לא תקין', resumable: false };

  onProgress({ phase: 'connect' });
  const manifest = await fetchManifest(code);
  const gameJson = manifest.gameJson;
  if (gameJson === null || typeof gameJson !== 'object') {
    return { ok: false, error: 'השרת החזיר רשימת משחק לא תקינה', resumable: false };
  }
  if (signal?.aborted) return { ok: false, error: ABORTED, resumable: true, aborted: true };
  const media = planMedia(manifest.mediaFiles);
  const gameId = typeof gameJson.id === 'string' && gameJson.id !== '' ? gameJson.id.toLowerCase() : null;
  const version = packageVersion(manifest) ?? (typeof expectedVersion === 'string' ? expectedVersion : null);

  const dir = downloadDir(userData, code);
  fs.mkdirSync(dir, { recursive: true });

  // קובץ שכתובתו השתנתה מאז הניסיון הקודם (המשחק נערך) — מה שירד ממנו לא רלוונטי.
  const stateFile = path.join(dir, 'manifest.json');
  const previous = readJson(stateFile);
  const previousUrl = new Map(
    (Array.isArray(previous?.files) ? previous.files : []).map((/** @type {MediaEntry} */ f) => [f.localPath, f.url]),
  );
  for (const m of media) {
    const old = previousUrl.get(m.localPath);
    if (old !== undefined && old !== m.url) {
      rmQuiet(path.join(dir, m.localPath));
      rmQuiet(`${path.join(dir, m.localPath)}.part`);
    }
  }
  fs.writeFileSync(stateFile, JSON.stringify({ code, generatedAt: new Date().toISOString(), files: media }, null, 2));
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(gameJson, null, 2));

  let seeded = 0;
  if (seedFrom !== null && fs.existsSync(seedFrom)) {
    try {
      seeded = await seedFromPackage(seedFrom, media, dir);
      if (seeded > 0) log(`[remote] ${seeded} קבצים הועתקו מהחבילה הקודמת של המשחק`);
    } catch (err) {
      log(`[remote] העתקה מהחבילה הקודמת נכשלה: ${/** @type {Error} */ (err).message}`);
    }
  }

  /** @type {Map<string, FileProgress>} */
  const per = new Map();
  let filesDone = 0;
  const files = media.length;
  const report = () => {
    let received = 0;
    let total = 0;
    let known = 0;
    for (const v of per.values()) {
      received += v.received;
      if (v.total > 0) {
        total += v.total;
        known += 1;
      }
    }
    // אחוזים רק כשגודל כל הקבצים ידוע — אחרת הפס היה קופץ אחורה עם כל קובץ חדש.
    onProgress({ phase: 'download', received, total: known === files ? total : 0, files, filesDone });
  };

  /** @type {MediaEntry[]} */
  const queue = [];
  for (const m of media) {
    const dest = path.join(dir, m.localPath);
    let done = -1;
    try {
      done = fs.statSync(dest).size; // הושלם בניסיון קודם
    } catch {
      done = -1;
    }
    if (done >= 0) {
      per.set(m.localPath, { received: done, total: done });
      filesDone += 1;
    } else {
      per.set(m.localPath, { received: 0, total: 0 });
      queue.push(m);
    }
  }
  report();

  /** @type {string[]} */
  const skipped = [];
  /** @type {string | null} */
  let failure = null;
  const worker = async () => {
    while (queue.length > 0 && failure === null) {
      if (signal?.aborted) {
        failure = ABORTED;
        break;
      }
      const m = /** @type {MediaEntry} */ (queue.shift());
      const dest = path.join(dir, m.localPath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      /** @type {string | null} */
      let lastError = null;
      for (let attempt = 1; attempt <= FILE_ATTEMPTS && failure === null; attempt += 1) {
        const res = await downloadFile(m.url, dest, {
          onProgress: (p) => {
            per.set(m.localPath, { received: p.received, total: p.total });
            report();
          },
          ...(signal !== undefined ? { signal } : {}),
        });
        if (signal?.aborted) {
          // מה שירד מהקובץ נשאר כחלק (.part) להמשך — לא "חסר" ולא כישלון.
          failure = ABORTED;
          lastError = null;
          break;
        }
        if (res.ok) {
          per.set(m.localPath, { received: res.bytes, total: res.bytes });
          filesDone += 1;
          lastError = null;
          report();
          break;
        }
        log(`[remote] ${m.localPath} ניסיון ${attempt}: ${res.error}`);
        lastError = res.error;
        if (!res.retryable) {
          // כמו בחבילת השרת: קובץ שאינו קיים עוד אינו מפיל את המשחק כולו —
          // הוא נרשם ב-manifest.json של החבילה כחסר.
          skipped.push(m.localPath);
          per.set(m.localPath, { received: 0, total: 0 });
          filesDone += 1;
          lastError = null;
          report();
          break;
        }
      }
      if (lastError !== null) failure = `${m.localPath}: ${lastError}`;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  if (failure === ABORTED || signal?.aborted) return { ok: false, error: ABORTED, resumable: true, aborted: true };
  if (failure !== null) {
    return {
      ok: false,
      error: `ההורדה נקטעה (${failure}). מה שכבר ירד נשמר — הקלידו את הקוד שוב כדי להמשיך מאותה נקודה`,
      resumable: true,
    };
  }

  // אריזה — אותו מבנה כמו חבילת השרת: data.json, המדיה בנתיביה, ו-manifest.json.
  onProgress({ phase: 'pack' });
  const present = media.filter((m) => !skipped.includes(m.localPath));
  // הכתובת של כל קובץ נשמרת בחבילה: בעדכון הבא, קובץ שכתובתו לא השתנתה
  // מועתק מכאן במקום לרדת שוב (seedFromPackage).
  const packed = present.map((m) => ({ path: m.localPath, size: fs.statSync(path.join(dir, m.localPath)).size, url: m.url }));
  const packageManifest = {
    gameName: typeof gameJson.name === 'string' ? gameJson.name : '',
    generatedAt: new Date().toISOString(),
    source: 'direct',
    files: packed,
    totalFiles: packed.length,
    totalSize: packed.reduce((sum, f) => sum + f.size, 0),
    failed: skipped.map((p) => ({ path: p, error: 'not available' })),
  };
  const zipPath = lib.libraryZipPath(userData, code);
  const part = `${zipPath}.part`;
  rmQuiet(part);
  const bytes = await writeStoreZip(part, [
    { path: 'data.json', data: JSON.stringify(gameJson, null, 2) },
    ...present.map((m) => ({ path: m.localPath, file: path.join(dir, m.localPath) })),
    { path: 'manifest.json', data: JSON.stringify(packageManifest, null, 2) },
  ]);
  const tail = Buffer.alloc(tailLength(bytes));
  const fd = fs.openSync(part, 'r');
  try {
    fs.readSync(fd, tail, 0, tail.length, bytes - tail.length);
  } finally {
    fs.closeSync(fd);
  }
  if (!hasZipEndRecord(tail, bytes)) {
    rmQuiet(part);
    return { ok: false, error: 'אריזת המשחק במחשב נכשלה — נסו שוב', resumable: true };
  }
  // הבדיקה האחרונה לפני ההחלפה, בלי await בינה לבין ה-rename: אחרי הפסקה
  // החבילה הקיימת לעולם לא מוחלפת.
  if (signal?.aborted) {
    rmQuiet(part);
    return { ok: false, error: ABORTED, resumable: true, aborted: true };
  }
  rmQuiet(zipPath);
  fs.renameSync(part, zipPath);
  lib.libraryStore(userData, code, typeof gameJson.name === 'string' && gameJson.name !== '' ? gameJson.name : `משחק ${code}`, {
    gameId,
    version,
    select,
    ...(source !== undefined ? { source } : {}),
    pendingOpen,
  });
  rmQuiet(dir);
  log(
    `[remote] משחק ${code} הורד ישירות: ${files} קבצים, ${(bytes / 1048576).toFixed(1)}MB` +
      `${seeded ? `, ${seeded} הועתקו מהחבילה הקודמת` : ''}${skipped.length ? `, ${skipped.length} חסרים` : ''}`,
  );
  return { ok: true, bytes, files, skipped, seeded, gameId, version };
}

module.exports = {
  downloadGameDirect,
  seedFromPackage,
  packageVersion,
  planMedia,
  safeLocalPath,
  downloadDir,
  CONCURRENCY,
  FILE_ATTEMPTS,
};
