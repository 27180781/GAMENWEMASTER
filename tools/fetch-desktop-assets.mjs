/**
 * מוריד את קובצי ההתקנה של תוכנת האופליין אל תוך אתר המשחק, כדי שהלקוח
 * יוריד ויתעדכן **מהשרת של המשחק בלבד** ולא יפנה ל-GitHub.
 *
 * רץ בשני זמנים, ושניהם בצד השרת — הלקוח לעולם אינו רואה את המקור:
 *   • בזמן בניית תמונת ה-Docker (ראו Dockerfile) — כדי שהתמונה תצא שלמה.
 *   • ובעליית המכולה, כרענון (ראו refresh-desktop-assets.mjs) — כי הבנייה
 *     קורית לפני שה-EXE של אותו קומיט פורסם, ובלי הרענון השרת היה מגיש
 *     לצמיתות את הגרסה הקודמת.
 *
 * הבנייה נכשלת ברעש אם קובץ חסר או פגום, במקום שהתקלה תתגלה בשקט אצל לקוח
 * באמצע אירוע.
 *
 * אבל לא מיד: אותה דחיפה ל-main מפעילה במקביל גם את build-desktop, שמחליף את
 * קובצי המהדורה `desktop-latest` בזמן שהבנייה הזו רצה. בחלון הזה GitHub עונה
 * 504 / 404, או ש-latest.yml כבר חדש והמתקין עדיין ישן (sha512 לא תואם). לכן
 * המשיכה כולה (פיד + מתקין + נייד) נעשית בסבבים: כישלון מכל סוג מנקה את
 * היעד וממתין לסבב הבא, עד תקציב של כמה דקות — מספיק כדי שהמהדורה החדשה
 * תסיים להתפרסם. רק אחרי כל הסבבים הבנייה נופלת. (כך נכשלה הפריסה ב-14.9.2026:
 * שלושה ניסיונות בתוך 15 שניות, כולם בתוך חלון ההחלפה.)
 *
 * שימוש: node tools/fetch-desktop-assets.mjs <תיקיית-יעד>
 * משתני סביבה:
 *   DESKTOP_SOURCE_URL          — מקור הקבצים (ברירת מחדל: המהדורה היציבה ב-GitHub)
 *   DESKTOP_ASSETS              — '0' כדי לדלג (בנייה מקומית מהירה בלי 200MB הורדות)
 *   DESKTOP_FETCH_ATTEMPTS      — כמה סבבים מלאים לנסות (ברירת מחדל 8)
 *   DESKTOP_FETCH_WAIT_SECONDS  — המתנה בין סבבים (ברירת מחדל 45 → ‎~5 דקות סה"כ)
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync, statSync, linkSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SOURCE =
  process.env.DESKTOP_SOURCE_URL ??
  'https://github.com/27180781/GAMENWEMASTER/releases/download/desktop-latest';

/** גודל מינימלי סביר ל-EXE של Electron — שומר מפני "הורדה" של דף שגיאה. */
const MIN_EXE_BYTES = 40 * 1024 * 1024;
/**
 * כמה גרסאות אחורה למשוך מפות בלוקים (עשרות KB כל אחת). לקוח שמותקנת אצלו
 * גרסה ישנה יותר יקבל את העדכון הראשון שלו כהורדה מלאה — פעם אחת.
 */
const PREVIOUS_BLOCKMAPS = 12;

/** מספר שלם חיובי ממשתנה סביבה, או ברירת המחדל. */
function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * שלושת השדות ש-electron-updater קורא מ-latest.yml. מופרד כדי שגם הרענון
 * יוכל לקרוא את הגרסה בלי לחזור על ניתוח הפורמט — וכדי שיהיה ניתן לבדיקה.
 */
export function parseFeed(text) {
  const version = /^version:\s*(.+)$/m.exec(text)?.[1]?.trim();
  const installer = /^path:\s*(.+)$/m.exec(text)?.[1]?.trim();
  const sha512 = /^sha512:\s*(.+)$/m.exec(text)?.[1]?.trim();
  if (!version || !installer || !sha512) {
    throw new Error('latest.yml אינו בפורמט הצפוי (חסר version/path/sha512)');
  }
  return { version, installer, sha512 };
}

/**
 * הורדה עם כמה ניסיונות — כשל רשתי חולף לא אמור להפיל בנייה שלמה.
 * `baseMs` הוא בסיס ההשהיה (2·base, 4·base, …); ניתן לקיצור בבדיקות.
 */
export async function fetchWithRetry(url, tries = 4, baseMs = 1000) {
  let lastErr;
  for (let i = 1; i <= tries; i += 1) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      if (i < tries) {
        const wait = 2 ** i * baseMs;
        console.warn(`  ניסיון ${i} נכשל (${err.message}) — ממתין ${wait / 1000} שנ׳`);
        await sleep(wait);
      }
    }
  }
  throw new Error(`הורדה נכשלה: ${url} — ${lastErr?.message ?? 'לא ידוע'}`);
}

const sha512b64 = (buf) => createHash('sha512').update(buf).digest('base64');

/**
 * מפת בלוקים היא JSON דחוס ב-gzip עם רשימת `files` — כל דבר אחר (דף שגיאה,
 * ה-index.html של ה-SPA שחוזר במקום 404) נדחה, כי electron-updater היה נכשל
 * עליו בשקט ונופל להורדה מלאה.
 */
export function assertBlockmap(buf, name) {
  let parsed;
  try {
    parsed = JSON.parse(gunzipSync(buf).toString('utf8'));
  } catch (err) {
    throw new Error(`${name} אינו מפת בלוקים תקינה (${err.message})`);
  }
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    throw new Error(`${name} אינו מפת בלוקים תקינה (אין files)`);
  }
}

/**
 * שמות המפות של הגרסאות הקודמות: 0.1.N → 0.1.N−1 … 0.1.N−count (מספר בנייה
 * חיובי בלבד). גרסה שאינה בפורמט הבנייה — אין קודמות.
 */
export function previousBlockmapNames(version, count) {
  const m = /^(\d+\.\d+\.)(\d+)$/.exec(version);
  if (m === null) return [];
  const names = [];
  const n = Number(m[2]);
  for (let i = n - 1; i >= Math.max(1, n - count); i -= 1) {
    names.push(`HavayaBeClick-Setup-${m[1]}${i}.exe.blockmap`);
  }
  return names;
}

/** הורדה אופציונלית: 404 = אין (מיד), כישלון אחר = ניסיון אחד נוסף ואז null. */
async function fetchOptional(url, baseMs) {
  for (let i = 1; i <= 2; i += 1) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch {
      if (i < 2) await sleep(baseMs);
    }
  }
  return null;
}

/**
 * מפות הבלוקים של הגרסאות הקודמות — לעדכון ההפרשי *הראשון* של לקוח: המפה של
 * הגרסה המותקנת אצלו נמשכת מהשרת (אחר כך היא כבר שמורה אצלו במטמון). מה שיש
 * במהדורה נשמר; מה שחסר (נבנה לפני שהמפות התחילו להתפרסם, או מספר בנייה
 * שדולג) פשוט נעדר.
 */
async function fetchPreviousBlockmaps(outDir, version, count, baseMs) {
  const found = [];
  for (const name of previousBlockmapNames(version, count)) {
    const buf = await fetchOptional(`${SOURCE}/${name}`, baseMs);
    if (buf === null) continue;
    try {
      assertBlockmap(buf, name);
    } catch {
      continue;
    }
    writeFileSync(join(outDir, name), buf);
    found.push(name);
  }
  console.log(
    found.length > 0
      ? `  ✓ מפות בלוקים לגרסאות קודמות: ${found.length}`
      : '  · אין מפות בלוקים לגרסאות קודמות במהדורה',
  );
  return found;
}

/**
 * משיכה מלאה בסבבים (ראו הכותרת): כל סבב מוריד פיד + מתקין + מפת בלוקים + נייד כיחידה
 * אחת, וכישלון מכל סוג — רשת, HTTP, sha512 לא תואם, קובץ קטן מדי — מנקה את
 * היעד וממתין לסבב הבא. אפשרויות (לבדיקות ולרענון): attempts, waitMs,
 * retryBaseMs, minExeBytes, previousBlockmaps (כמה גרסאות אחורה; 0 = בלי).
 */
export async function fetchDesktopAssets(outDir, options = {}) {
  if (process.env.DESKTOP_ASSETS === '0') {
    console.log('DESKTOP_ASSETS=0 — מדלגים על הורדת קובצי ההתקנה.');
    return null;
  }
  const attempts = options.attempts ?? envInt('DESKTOP_FETCH_ATTEMPTS', 8);
  const waitMs = options.waitMs ?? envInt('DESKTOP_FETCH_WAIT_SECONDS', 45) * 1000;

  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchOnce(outDir, options);
    } catch (err) {
      lastErr = err;
      // תיקייה חלקית (פיד חדש בלי המתקין שלו) נראית תקינה ומסוכנת — מוחקים.
      rmSync(outDir, { recursive: true, force: true });
      if (attempt < attempts) {
        console.warn(
          `\nסבב ${attempt}/${attempts} נכשל: ${err.message}\n` +
            `  המהדורה כנראה מתעדכנת ברגע זה — ממתין ${waitMs / 1000} שנ׳ לסבב הבא`,
        );
        await sleep(waitMs);
      }
    }
  }
  throw new Error(`${lastErr?.message ?? 'לא ידוע'} (אחרי ${attempts} סבבים)`);
}

async function fetchOnce(
  outDir,
  { retryBaseMs = 1000, minExeBytes = MIN_EXE_BYTES, previousBlockmaps = PREVIOUS_BLOCKMAPS } = {},
) {
  mkdirSync(outDir, { recursive: true });

  // ‎latest.yml‎ הוא מקור האמת: הוא קובע איזה קובץ התקנה ה-updater יבקש,
  // ומה ה-sha512 שלו. לכן קוראים אותו קודם ומורידים בדיוק את מה שהוא מציין.
  console.log(`מוריד latest.yml מ-${SOURCE}`);
  const feed = (await fetchWithRetry(`${SOURCE}/latest.yml`, 4, retryBaseMs)).toString('utf8');
  const { version, installer, sha512: wantHash } = parseFeed(feed);
  console.log(`גרסה ${version} · מתקין ${installer}`);
  writeFileSync(join(outDir, 'latest.yml'), feed);

  // (1) המתקין — זה מה שהעדכון האוטומטי מוריד. מאמתים מול ה-sha512 שבפיד:
  // קובץ שלא תואם יידחה על ידי electron-updater אצל הלקוח, ועדיף לגלות כאן.
  console.log(`מוריד ${installer} …`);
  const setup = await fetchWithRetry(`${SOURCE}/${installer}`, 4, retryBaseMs);
  const gotHash = sha512b64(setup);
  if (gotHash !== wantHash) {
    throw new Error(`sha512 של ${installer} אינו תואם ל-latest.yml — הקובץ פגום או המהדורה באמצע עדכון`);
  }
  if (setup.length < minExeBytes) throw new Error(`${installer} קטן מדי (${setup.length})`);
  writeFileSync(join(outDir, installer), setup);
  console.log(`  ✓ ${(setup.length / 1048576).toFixed(0)}MB · sha512 תואם`);

  // (1ב) מפת הבלוקים של המתקין — העדכון ההפרשי: electron-updater משווה אותה
  // למפה של הגרסה המותקנת ומוריד בבקשות Range רק את הבלוקים שהשתנו; את השאר
  // הוא לוקח מהמתקין הקודם ששמור אצל הלקוח. בלי הקובץ הזה ליד המתקין, כל
  // עדכון חוזר להורדה מלאה של ‎~100MB. חובה, כמו המתקין עצמו.
  const blockmap = `${installer}.blockmap`;
  console.log(`מוריד ${blockmap} …`);
  const map = await fetchWithRetry(`${SOURCE}/${blockmap}`, 4, retryBaseMs);
  assertBlockmap(map, blockmap);
  writeFileSync(join(outDir, blockmap), map);
  console.log(`  ✓ ${(map.length / 1024).toFixed(0)}KB`);

  // (1ג) המפות של הגרסאות הקודמות — best-effort.
  const previous = await fetchPreviousBlockmaps(outDir, version, previousBlockmaps, retryBaseMs);

  // (2) הקובץ הנייד — להורדה ישירה, וגם הבסיס שכלי החתימה מוריד.
  const portable = `HavayaBeClick-${version}.exe`;
  console.log(`מוריד ${portable} …`);
  const exe = await fetchWithRetry(`${SOURCE}/${portable}`, 4, retryBaseMs);
  if (exe.length < minExeBytes) throw new Error(`${portable} קטן מדי (${exe.length})`);
  writeFileSync(join(outDir, portable), exe);
  console.log(`  ✓ ${(exe.length / 1048576).toFixed(0)}MB`);

  // שמות יציבים, שאינם תלויי גרסה — עמוד ההורדה וכלי החתימה מקשרים אליהם.
  // קישור קשיח ולא עותק: אלו אותם בייטים בדיוק, והעתקה הייתה מנפחת את תמונת
  // ה-Docker מ-205MB ל-512MB. שכבת ה-tar שומרת תוכן משותף פעם אחת, ו-nginx
  // מגיש קישור קשיח כמו כל קובץ.
  const alias = (from, to) => {
    const target = join(outDir, to);
    rmSync(target, { force: true });
    linkSync(join(outDir, from), target);
    console.log(`  ↳ ${to}`);
  };
  alias(installer, 'TriviaEngine-Setup.exe');
  alias(portable, 'TriviaEngine-Portable.exe');
  alias(portable, 'SealEXE.exe');

  // אינדקס קטן — נוח לבדיקה ידנית שהשרת באמת מגיש את הגרסה הנכונה.
  writeFileSync(
    join(outDir, 'index.json'),
    `${JSON.stringify(
      { version, installer, blockmap, previousBlockmaps: previous, portable, source: SOURCE, builtAt: new Date().toISOString() },
      null,
      2,
    )}\n`,
  );

  // נפח אמיתי — סופרים כל inode פעם אחת, כי הקישורים הקשיחים חולקים תוכן.
  const seen = new Set();
  let total = 0;
  const files = ['latest.yml', installer, blockmap, ...previous, portable, 'TriviaEngine-Setup.exe', 'TriviaEngine-Portable.exe', 'SealEXE.exe', 'index.json'];
  for (const f of files) {
    const st = statSync(join(outDir, f));
    if (seen.has(st.ino)) continue;
    seen.add(st.ino);
    total += st.size;
  }
  console.log(`סה״כ ${(total / 1048576).toFixed(0)}MB ב-${outDir} (${seen.size} קבצים ייחודיים)`);
  return version;
}

// הרצה ישירה מהפקודה (ולא ייבוא מהרענון) — אחרי כל הסבבים הבנייה נופלת,
// והיעד כבר נוקה: עדיף שהפריסה לא תעלה מאשר שתעלה בלי קובצי ההתקנה.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outDir = process.argv[2] ?? 'dist/desktop';
  fetchDesktopAssets(outDir).catch((err) => {
    console.error(`\n✗ הורדת קובצי ההתקנה נכשלה: ${err.message}`);
    rmSync(outDir, { recursive: true, force: true });
    process.exit(1);
  });
}
