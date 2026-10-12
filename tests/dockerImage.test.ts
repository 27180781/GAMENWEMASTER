/**
 * Dockerfile מול קובצי השרת שהוא מעתיק לתמונה של CapRover.
 *
 * התמונה מעתיקה קבצים בשמם, ולא את server/ כולה. ייבוא יחסי של קובץ שמועתק
 * חייב להיות מועתק גם הוא, אחרת התהליך נופל בעלייה (ERR_MODULE_NOT_FOUND):
 * אחרי מיזוג «במה» (2026-10-12) live-video.mjs ייבא את live-stage.mjs, שלא
 * הועתק, הממסר עלה ונפל בלולאה, ו-/live/ ענה 502 כעשר דקות. שאר הבדיקות רצות
 * מהריפו, שבו כל הקבצים קיימים, ולכן לא תפסו את זה.
 */

import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** השלב האחרון (התמונה שרצה): קובץ בריפו → המקום שלו בתמונה. */
function imageFiles(dockerfile: string): Map<string, string> {
  const lines = dockerfile.replace(/\\\n/g, ' ').split('\n');
  let last = -1;
  lines.forEach((line, i) => {
    if (/^FROM\s/i.test(line.trim())) last = i;
  });
  const files = new Map<string, string>();
  for (const line of lines.slice(last + 1)) {
    const words = line.trim().split(/\s+/);
    // ‏COPY --from=build מעתיק משלב הבנייה, לא מהריפו
    if (words[0]?.toUpperCase() !== 'COPY' || words.some((w) => w.startsWith('--'))) continue;
    const dest = words[words.length - 1] ?? '';
    for (const src of words.slice(1, -1)) {
      files.set(src, dest.endsWith('/') ? dest + posix.basename(src) : dest);
    }
  }
  return files;
}

/** ייבוא יחסי, וקובץ שנקרא ליד הקוד (new URL('./…', import.meta.url)). */
function localDeps(source: string): string[] {
  const deps = new Set<string>();
  const patterns = [
    /\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g,
    /\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
    /\bnew URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
  ];
  for (const re of patterns)
    for (const m of source.matchAll(re)) if (m[1] !== undefined) deps.add(m[1]);
  return [...deps];
}

const image = imageFiles(read('Dockerfile'));
const inImage = new Set(image.values());

describe('Dockerfile — מה שהמכולה מריצה נמצא בתמונה', () => {
  it('★ הממסר ושער ההורדה מועתקים למקום שממנו docker-entrypoint.sh מריץ אותם', () => {
    expect(image.get('server/live-relay.mjs')).toBe('/app/server/live-relay.mjs');
    const runs = [...read('docker-entrypoint.sh').matchAll(/\bnode\s+(\/app\/\S+\.m?js)\b/g)].map(
      (m) => m[1] ?? '',
    );
    expect(runs).toContain('/app/server/live-relay.mjs');
    expect(runs.filter((path) => !inImage.has(path))).toEqual([]);
  });

  it('★ כל ייבוא יחסי של קובץ שמועתק — מועתק גם הוא, לאותו מקום יחסי', () => {
    const missing: string[] = [];
    for (const [src, dest] of image) {
      if (!/\.m?js$/.test(src)) continue;
      for (const dep of localDeps(read(src))) {
        if (!inImage.has(posix.join(posix.dirname(dest), dep))) missing.push(`${src} → ${dep}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('הבדיקה עצמה: בלי live-stage.mjs (כמו אחרי מיזוג «במה») — נתפס', () => {
    const before = read('Dockerfile').replace(' server/live-stage.mjs', '');
    const files = imageFiles(before);
    const dests = new Set(files.values());
    expect(dests.has('/app/server/live-stage.mjs')).toBe(false);
    expect(localDeps(read('server/live-video.mjs'))).toContain('./live-stage.mjs');
  });
});
