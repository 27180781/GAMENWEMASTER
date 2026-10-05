/**
 * «מה חדש» לעמוד ההורדה (public/download/): לכל גרסה שפורסמה — מה נכנס אליה.
 *
 * נבנה מחדש, כולו, בכל בניית EXE (build-desktop.yml) מתוך ריצות הבנייה שהצליחו:
 * הגרסה היא 0.1.<מספר הריצה>, והשינויים שלה הם הקומיטים שבין הריצה המוצלחת
 * הקודמת לזו — רק כאלה שנוגעים בתוכנה (אותם paths שמפעילים את הבנייה). ריצה
 * שנכשלה או בוטלה מגלגלת את השינויים שלה לגרסה הבאה שהצליחה, כמו שקרה באמת.
 * בלי מצב שמור: אין קובץ שיכול לצאת מסנכרון עם המהדורה.
 *
 * הטקסט הוא כותרת הקומיט (= כותרת ה-PR) בלי "(#NNN)". כותרת טכנית או באנגלית
 * מנוסחת מחדש ב-WHATS_NEW לפי מספר ה-PR, ו-null מסתיר שינוי פנימי. ניסוח שנוסף
 * כאן נכנס לתוקף בבניית ה-EXE הבאה (שינוי ב-tools/ לבדו אינו בונה EXE).
 *
 * שימוש (ב-workflow):
 *   node tools/desktop-changelog.mjs <runs.json> <מספר-הריצה> <sha> <קובץ-פלט>
 * runs.json = gh run list --workflow build-desktop.yml --status success --json number,headSha,createdAt
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** מה שמשפיע על ה-EXE — זהה ל-on.push.paths ב-build-desktop.yml (נבדק ב-tests/desktopChangelog.test.ts). */
export const APP_PATHS = [
  'src/**',
  'public/**',
  'fixtures/**',
  'electron/**',
  'index.html',
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'tsconfig*.json',
  'electron-builder.yml',
  '.github/workflows/build-desktop.yml',
];

/** כמה גרסאות אחורה נשמרות ברשימה. */
const KEEP = 20;

/**
 * ניסוח ללקוח לפי מספר ה-PR, כשהכותרת עצמה אינה מתאימה. null = לא מוצג.
 * PR חדש שכותרתו טכנית מוסיף כאן שורה.
 * @type {Record<string, string | null>}
 */
export const WHATS_NEW = {
  '#189': null,
  '#193': 'ניקוד יורד: מי שעונה מהר יותר מקבל יותר נקודות, ו«תשובה בתמונה» מנוקדת כמו טריוויה',
  '#195': 'תמונת השאלה מטושטשת ומתבהרת בהדרגה עם הטיימר',
  '#196': 'שקופית הימור, «הרוב קובע» ומונה הצבעות חי',
  '#198': null,
  '#199': 'חשיפת ההימורים: הפילוח מוצג כעוגה, כמו בסקר',
  '#200': 'שמות המצביעים יכולים להופיע בבועת דיבור',
  '#201': 'העדכון האוטומטי מוריד רק את מה שהשתנה, כמה MB במקום המתקין כולו',
  '#202': null,
  '#203': null,
  '#204': null,
  '#206': 'הורדת משחק לפי קוד: ישירות מהאחסון, כמה קבצים במקביל, וממשיכה אחרי ניתוק',
  '#207': 'עדכון התוכנה שנקטע ממשיך מאותה נקודה',
  '#208': 'קריינות: קריין שמקריא את מהלך המשחק, מעל צלילי המשחק',
  '#209': 'קישורי יוטיוב רגילים (watch) מוצגים כמו שצריך',
  '#210': 'מדיה שלא נטענת מציגה הודעה במקום מסך ריק',
  '#211': 'קריינות: שמות הקבוצות מוקראים גם באופליין, ועריכה בזמן משחק לא משבשת את הקטעים',
  '#212': 'סרטון יוטיוב לא נקטע ב-Wi-Fi איטי, ומעבר אוטומטי לא נתקע בזמן קריינות',
  '#213': 'ערכות נושא חזותיות: אולפן טלוויזיה, זכוכית ומגילה',
};

/**
 * שורת «מה חדש» מכותרת קומיט, או null כשהשינוי פנימי.
 * @param {string} subject
 */
export function changeText(subject) {
  const m = /\s*\(#(\d+)\)\s*$/.exec(subject);
  const key = m === null ? null : `#${m[1]}`;
  if (key !== null && key in WHATS_NEW) return WHATS_NEW[key];
  const text = (m === null ? subject : subject.slice(0, m.index)).trim();
  return text === '' ? null : text;
}

/**
 * @typedef {{ number: number, headSha: string, createdAt?: string }} Run
 * @typedef {{ version: string, date: string | null, changes: string[] }} Entry
 *
 * @param {Run[]} runs ריצות שהצליחו (כל סדר; כפילויות נזרקות)
 * @param {(from: string, to: string) => string[]} subjectsBetween כותרות הקומיטים בטווח, מהחדש לישן
 * @param {number} [keep]
 * @returns {Entry[]} מהחדשה לישנה
 */
export function buildChangelog(runs, subjectsBetween, keep = KEEP) {
  const byNumber = new Map();
  for (const r of runs) {
    if (Number.isInteger(r.number) && typeof r.headSha === 'string' && r.headSha !== '')
      byNumber.set(r.number, r);
  }
  const sorted = [...byNumber.values()].sort((a, b) => a.number - b.number);
  /** @type {Entry[]} */
  const entries = [];
  // לריצה הוותיקה ביותר אין ממה למדוד — היא רק נקודת ההתחלה.
  for (let i = sorted.length - 1; i >= 1 && entries.length < keep; i -= 1) {
    const run = sorted[i];
    const seen = new Set();
    const changes = [];
    for (const subject of subjectsBetween(sorted[i - 1].headSha, run.headSha)) {
      const text = changeText(subject);
      if (text === null || seen.has(text)) continue;
      seen.add(text);
      changes.push(text);
    }
    entries.push({ version: `0.1.${run.number}`, date: run.createdAt ?? null, changes });
  }
  return entries;
}

/** @param {string} from @param {string} to */
function gitSubjects(from, to) {
  try {
    const out = execFileSync('git', ['log', '--format=%s', `${from}..${to}`, '--', ...APP_PATHS], {
      encoding: 'utf8',
    });
    return out.split('\n').filter((l) => l.trim() !== '');
  } catch {
    return []; // קומיט שאינו בהיסטוריה (force-push ישן) — הגרסה מופיעה בלי פירוט
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [runsFile, number, sha, outFile] = process.argv.slice(2);
  if (!runsFile || !number || !sha || !outFile) {
    console.error(
      'שימוש: node tools/desktop-changelog.mjs <runs.json> <מספר-הריצה> <sha> <קובץ-פלט>',
    );
    process.exit(1);
  }
  /** @type {Run[]} */
  const runs = JSON.parse(readFileSync(runsFile, 'utf8'));
  runs.push({ number: Number(number), headSha: sha, createdAt: new Date().toISOString() });
  const versions = buildChangelog(runs, gitSubjects);
  writeFileSync(
    outFile,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), versions }, null, 2)}\n`,
  );
  console.log(
    `מה חדש: ${versions.length} גרסאות, האחרונה ${versions[0]?.version ?? '—'} (${versions[0]?.changes.length ?? 0} שינויים)`,
  );
}
