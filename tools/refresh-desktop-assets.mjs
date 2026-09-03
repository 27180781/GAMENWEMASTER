/**
 * רענון קובצי ההתקנה **בזמן ריצה**, במכולה של האתר.
 *
 * למה זה קיים: התמונה נבנית ב-CapRover בכל דחיפה ל-main, כלומר דקות *לפני*
 * ש-build-desktop מסיים לפרסם את ה-EXE של אותו קומיט. לכן הצריבה בזמן הבנייה
 * תמיד תופסת את המהדורה הקודמת, והשרת היה מגיש לצמיתות גרסה אחת אחורה —
 * והתוכנה המותקנת דיווחה "מעודכן" כי זו באמת הגרסה שהוצעה לה.
 *
 * הרענון מנתק את התלות הזו: האתר בודק בעצמו, כל כמה שעות, אם יצאה מהדורה
 * חדשה — ומושך אותה בלי שום פריסה.
 *
 * תוספתי בכוונה: הקבצים הצרובים בתמונה נשארים כרשת ביטחון. רענון שנכשל
 * (אין רשת, GitHub למטה) משאיר בדיוק את מה שהיה, ולא מוריד את השרת.
 *
 * משתני סביבה:
 *   DESKTOP_REFRESH       — '0' לכיבוי מוחלט של הרענון
 *   DESKTOP_REFRESH_HOURS — כל כמה שעות לבדוק (ברירת מחדל 6)
 *   DESKTOP_SOURCE_URL    — מקור המהדורה (כמו בסקריפט המשיכה)
 */

import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { fetchDesktopAssets, fetchWithRetry, parseFeed, SOURCE } from './fetch-desktop-assets.mjs';

const dir = process.argv[2] ?? '/usr/share/nginx/html/desktop';
const hours = Number(process.env.DESKTOP_REFRESH_HOURS ?? '6');
const EVERY_MS = (Number.isFinite(hours) && hours > 0 ? hours : 6) * 60 * 60 * 1000;

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

  // מושכים לתיקייה זמנית ורק אז מחליפים. משיכה *לתוך* התיקייה המשמשת הייתה
  // מותירה את עמוד ההורדה עם קבצים חסרים למשך דקות ארוכות.
  const next = `${dir}.new`;
  const old = `${dir}.old`;
  rmSync(next, { recursive: true, force: true });
  await fetchDesktopAssets(next);

  rmSync(old, { recursive: true, force: true });
  if (existsSync(dir)) renameSync(dir, old);
  renameSync(next, dir);
  rmSync(old, { recursive: true, force: true });
  log(`✓ השרת מגיש עכשיו ${latest}`);
}

async function loop() {
  if (process.env.DESKTOP_REFRESH === '0' || process.env.DESKTOP_ASSETS === '0') {
    log('כבוי (DESKTOP_REFRESH=0) — נשארים עם מה שנצרב בתמונה.');
    return;
  }
  log(`פעיל · בודק כל ${EVERY_MS / 3_600_000} שעות · יעד ${dir}`);
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
