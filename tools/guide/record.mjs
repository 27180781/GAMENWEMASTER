/**
 * מריץ את הקלטות המדריך. ‏`node tools/guide/record.mjs [slug ...]`
 * בלי ארגומנטים — מקליט את כל הפרקים לפי הסדר, וכותב את קובץ האינדקס
 * שממנו מסך "מדריך" בתוכנה בונה את הרשימה.
 */

import { writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { OUT } from './harness.mjs';

const CHAPTERS = [
  '01-intro.mjs',
  '02-source.mjs',
  '03-receiver.mjs',
  '04-names.mjs',
  '05-play.mjs',
  '06-editor.mjs',
];

const wanted = process.argv.slice(2);
const index = [];

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
}

writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
console.log(`\nנכתב ${join(OUT, 'index.json')} — ${index.length} פרקים.`);
