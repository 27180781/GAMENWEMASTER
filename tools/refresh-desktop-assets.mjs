/**
 * רענון קובצי ההתקנה **בזמן ריצה**, במכולה של האתר.
 *
 * למה זה קיים: התמונה נבנית ב-CapRover בכל דחיפה ל-main, כלומר דקות *לפני*
 * ש-build-desktop מסיים לפרסם את ה-EXE של אותו קומיט. לכן הצריבה בזמן הבנייה
 * תמיד תופסת את המהדורה הקודמת, והשרת היה מגיש לצמיתות גרסה אחת אחורה —
 * והתוכנה המותקנת דיווחה "מעודכן" כי זו באמת הגרסה שהוצעה לה.
 *
 * הרענון מנתק את התלות הזו: האתר בודק בעצמו, כל כמה דקות, אם יצאה מהדורה
 * חדשה — ומושך אותה בלי שום פריסה.
 *
 * תוספתי בכוונה: הקבצים הצרובים בתמונה נשארים כרשת ביטחון. רענון שנכשל
 * (אין רשת, GitHub למטה) משאיר בדיוק את מה שהיה, ולא מוריד את השרת.
 *
 * משתני סביבה:
 *   DESKTOP_REFRESH         — '0' לכיבוי מוחלט של הרענון
 *   DESKTOP_REFRESH_MINUTES — כל כמה דקות לבדוק (ברירת מחדל 10)
 *   DESKTOP_REFRESH_HOURS   — השם הישן, בשעות; נתמך רק כשהוגדר במפורש
 *   DESKTOP_SOURCE_URL      — מקור המהדורה (כמו בסקריפט המשיכה)
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fetchDesktopAssets, fetchWithRetry, parseFeed, SOURCE } from './fetch-desktop-assets.mjs';

const dir = process.argv[2] ?? '/usr/share/nginx/html/desktop';

/**
 * כל כמה זמן בודקים. הבדיקה זולה (latest.yml, כמה מאות בתים), והמשיכה הכבדה
 * קורית רק כשבאמת יצאה גרסה — לכן בודקים לעתים קרובות.
 *
 * למה לא כל כמה שעות, כמו בהתחלה: הבדיקה שבעליית המכולה רצה כמעט תמיד *לפני*
 * שה-EXE של אותו קומיט פורסם (האתר נבנה ועולה מהר יותר מבניית ה-Windows),
 * ולכן היא מוצאת את הגרסה הקודמת. כל גרסה חדשה חיכתה אז לסבב הבא, עד שש שעות
 * שבהן התוכנה המותקנת דיווחה "מעודכן" על הגרסה הישנה (כך 0.1.190 ב-5.10.2026).
 */
export function refreshIntervalMs(env) {
  const minutes = Number(env.DESKTOP_REFRESH_MINUTES);
  if (Number.isFinite(minutes) && minutes > 0) return minutes * 60 * 1000;
  const hours = Number(env.DESKTOP_REFRESH_HOURS);
  if (Number.isFinite(hours) && hours > 0) return hours * 60 * 60 * 1000;
  return 10 * 60 * 1000;
}

const EVERY_MS = refreshIntervalMs(process.env);

const log = (msg) => console.log(`[רענון] ${new Date().toISOString()} ${msg}`);

/** הגרסה שהשרת מגיש כרגע, לפי index.json שנכתב במשיכה הקודמת. */
export function servedVersion(indexJsonText) {
  try {
    const v = JSON.parse(indexJsonText).version;
    return typeof v === 'string' && v !== '' ? v : null;
  } catch {
    return null;
  }
}

/**
 * האם למשוך מחדש. ‎null‎ בצד המוגש (אין index.json / פגום) פירושו "כן" —
 * עדיף למשוך מיותר מאשר להישאר עם תיקייה שאיננו יודעים מה יש בה.
 */
export function needsRefresh(served, latest) {
  return latest !== null && served !== latest;
}

/**
 * סדר ההעברה לתיקייה המוגשת: קודם המתקינים והמפות, אחר כך latest.yml —
 * electron-updater קורא אותו ראשון, ואסור שיצביע על מתקין שעוד לא הגיע — ובסוף
 * index.json, שממנו עמוד ההורדה מציג את הגרסה.
 */
export function installOrder(names) {
  const last = ['latest.yml', 'index.json'];
  return [...names.filter((f) => !last.includes(f)), ...last.filter((f) => names.includes(f))];
}

/**
 * מעביר את הקבצים שנמשכו (next) לתוך התיקייה המוגשת (dir), קובץ אחרי קובץ,
 * ומוחק ממנה את מה שלא הגיע (הגרסה הקודמת).
 *
 * למה לא החלפת התיקייה כולה, כמו עד 5.10.2026: dir מגיע משכבת התמונה, וב-
 * overlayfs של Docker שינוי שם של תיקייה משכבה תחתונה נכשל (EXDEV). הרענון
 * הוריד ‎~220MB בכל סבב, נכשל בהחלפה, ניקה ונשאר עם מה שנצרב בתמונה — כך השרת
 * התעדכן רק כשהאתר נפרס מחדש. העברת *קבצים* לתוך התיקייה עובדת שם.
 */
export function installInto(next, dir) {
  mkdirSync(dir, { recursive: true });
  const incoming = readdirSync(next);
  for (const f of installOrder(incoming)) renameSync(join(next, f), join(dir, f));
  const keep = new Set(incoming);
  for (const f of readdirSync(dir)) {
    if (!keep.has(f)) rmSync(join(dir, f), { recursive: true, force: true });
  }
  rmSync(next, { recursive: true, force: true });
}

function currentVersion() {
  const file = `${dir}/index.json`;
  return existsSync(file) ? servedVersion(readFileSync(file, 'utf8')) : null;
}

async function refreshOnce() {
  const feed = (await fetchWithRetry(`${SOURCE}/latest.yml`)).toString('utf8');
  const { version: latest } = parseFeed(feed);
  const served = currentVersion();
  if (!needsRefresh(served, latest)) {
    log(`אין שינוי — השרת מגיש ${served ?? '—'}`);
    return;
  }
  log(`נמצאה ${latest} (מוגש ${served ?? '—'}) — מושך`);

  // מושכים לתיקייה זמנית ורק אז מעבירים. משיכה *לתוך* התיקייה המשמשת הייתה
  // מותירה את עמוד ההורדה עם קבצים חסרים למשך דקות ארוכות.
  const next = `${dir}.new`;
  rmSync(next, { recursive: true, force: true });
  // ברקע לא ממתינים דקות: שני סבבים, והסבב הבא ממילא בעוד כמה דקות.
  await fetchDesktopAssets(next, { attempts: 2, waitMs: 30_000 });

  installInto(next, dir);
  log(`✓ השרת מגיש עכשיו ${latest}`);
}

async function loop() {
  if (process.env.DESKTOP_REFRESH === '0' || process.env.DESKTOP_ASSETS === '0') {
    log('כבוי (DESKTOP_REFRESH=0) — נשארים עם מה שנצרב בתמונה.');
    return;
  }
  log(`פעיל · בודק כל ${EVERY_MS / 60_000} דקות · יעד ${dir}`);
  for (;;) {
    try {
      await refreshOnce();
    } catch (err) {
      // כישלון רענון אינו תקלה שדורשת פעולה: הקבצים הקיימים ממשיכים להיות
      // מוגשים, וננסה שוב בסבב הבא.
      log(`✗ נכשל (${err.message}) — ממשיכים עם מה שקיים`);
      rmSync(`${dir}.new`, { recursive: true, force: true });
    }
    await new Promise((r) => setTimeout(r, EVERY_MS));
  }
}

if (process.argv[1]?.endsWith('refresh-desktop-assets.mjs')) void loop();
