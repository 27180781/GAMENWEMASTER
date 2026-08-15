/**
 * בניית קובצי האקסל שמופיעים במדריך — באמצעות **הכותב של התוכנה עצמה**
 * (src/app/xlsx.ts), ולא בהעתקה שלו. כך הקובץ שנראה בסרטון הוא בדיוק מה
 * שהתוכנה מייצרת וקוראת, ואם הפורמט ישתנה המדריך ישתנה איתו.
 */

import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './harness.mjs';

let cached = null;

async function xlsxWriter() {
  if (cached !== null) return cached;
  const dir = mkdtempSync(join(tmpdir(), 'guide-xlsx-'));
  const out = join(dir, 'xlsx.mjs');
  await build({
    entryPoints: [join(ROOT, 'src/app/xlsx.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    logLevel: 'silent',
  });
  cached = await import(pathToFileURL(out).href);
  rmSync(dir, { recursive: true, force: true });
  return cached;
}

/**
 * כותב קובץ XLSX לדיסק ומחזיר את נתיבו — מוכן ל-setInputFiles.
 * @param {string} file נתיב היעד
 * @param {string} sheetName שם הגליון
 * @param {(string|number|null)[][]} rows כולל שורת הכותרת
 */
export async function writeXlsx(file, sheetName, rows) {
  const { buildXlsxBlob } = await xlsxWriter();
  const blob = await buildXlsxBlob([{ name: sheetName, rows }]);
  writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
  return file;
}
