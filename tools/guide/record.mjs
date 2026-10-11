/**
 * מריץ את הקלטות המדריך. ‏`node tools/guide/record.mjs [slug ...]`
 * בלי ארגומנטים — מקליט את כל הפרקים לפי הסדר, וכותב את קובץ האינדקס
 * שממנו מסך "מדריך" בתוכנה בונה את הרשימה.
 */

import { spawnSync } from 'node:child_process';
import { renameSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { OUT } from './harness.mjs';
import { CHAPTERS } from './chapters.mjs';

const wanted = process.argv.slice(2);
const index = [];
const recorded = [];

/**
 * Playwright מקליט VP8 בקצב קבוע; קידוד מחדש ל-VP9 לפי איכות (CRF) מקטין את
 * הקובץ פי 3 בערך בלי הבדל נראה בטקסט, ומוסיף אינדקס לקפיצה בנגן. הסרטונים
 * נכנסים לתוכנה ולכל עדכון שלה — כל MB כאן הוא MB בהורדה של כל מחשב.
 * בלי ffmpeg — נשאר הקובץ המקורי.
 */
function compress(file) {
  const tmp = `${file}.vp9.webm`;
  const res = spawnSync(
    'ffmpeg',
    ['-loglevel', 'error', '-y', '-i', file, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36',
      '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-an', tmp],
    { stdio: 'inherit' },
  );
  if (res.error || res.status !== 0) {
    rmSync(tmp, { force: true });
    return false;
  }
  renameSync(tmp, file);
  return true;
}

for (const file of CHAPTERS) {
  const mod = await import(`./chapters/${file}`);
  if (wanted.length > 0 && !wanted.some((w) => mod.meta.slug.includes(w) || file.includes(w))) {
    index.push({ ...mod.meta, file: `${mod.meta.slug}.webm` });
    continue;
  }
  process.stdout.write(`▶ ${mod.meta.index}: ${mod.meta.name} … `);
  const started = Date.now();
  const out = await mod.record();
  const mb = (statSync(out).size / 1024 / 1024).toFixed(1);
  console.log(`${((Date.now() - started) / 1000).toFixed(0)} שנ׳ · ${mb}MB`);
  index.push({ ...mod.meta, file: `${mod.meta.slug}.webm` });
  recorded.push(out);
}

// הדחיסה אחרי כל ההקלטות ולא ביניהן: ffmpeg על כל המעבדים בזמן הקלטה
// גורם לדפדפן להפיל פריימים. GUIDE_NO_COMPRESS=1 מדלג (לריצת בדיקה מהירה).
for (const out of process.env.GUIDE_NO_COMPRESS ? [] : recorded) {
  const before = statSync(out).size;
  if (!compress(out)) {
    console.log(`  ⚠ הדחיסה לא רצה (אין ffmpeg?) — נשאר ${out}`);
    break;
  }
  const mb = (n) => (n / 1024 / 1024).toFixed(1);
  console.log(`  ⇣ ${out.split('/').pop()}: ${mb(before)}MB → ${mb(statSync(out).size)}MB`);
}

writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
console.log(`\nנכתב ${join(OUT, 'index.json')} — ${index.length} פרקים.`);
