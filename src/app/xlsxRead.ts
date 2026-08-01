/**
 * קריאת גיליון (XLSX או CSV) לשורות של מחרוזות — בלי ספריית אקסל כבדה.
 *
 * XLSX הוא ZIP של XML: הגיליון הראשון נלקח לפי סדר החוברת (workbook.xml +
 * ה-rels שלו), והמחרוזות מפוענחות מ-sharedStrings.xml או מ-inlineStr. שומרים
 * על מיקום העמודה לפי מזהה התא (r="B3") — כך תא ריק באמצע לא מזיז את שאר
 * העמודות, וזה בדיוק המצב כשעמודת הקבוצה חסרה בחלק מהשורות.
 *
 * הקובץ טהור (בלי DOM) כדי שירוץ גם בבדיקות יחידה.
 */

import JSZip from 'jszip';

/** פענוח ישויות XML הנפוצות (כולל נומריות). */
function xmlUnescape(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** כל הטקסט שבתוך תגי <t> בקטע נתון (ריצות עיצוב מפוצלות לכמה <t>). */
function textOfRuns(xml: string): string {
  let out = '';
  for (const m of xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += m[1] ?? '';
  return xmlUnescape(out);
}

/** טבלת המחרוזות המשותפות: כל <si> הוא מחרוזת אחת. */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) out.push(textOfRuns(m[1] ?? ''));
  return out;
}

/** "B12" → 1 (אינדקס עמודה 0-based). */
export function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref.toUpperCase())?.[1] ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** פענוח גיליון בודד לשורות. */
function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const body = rowMatch[1] ?? '';
    const cells: string[] = [];
    let auto = 0; // תא בלי r= (נדיר) — ממוקם אחרי הקודם
    for (const cellMatch of body.matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1] ?? '';
      const inner = cellMatch[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const at = ref !== undefined ? columnIndex(ref) : auto;
      auto = at + 1;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
      let value = '';
      if (type === 'inlineStr') {
        value = textOfRuns(inner);
      } else {
        const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (raw !== undefined) {
          const text = xmlUnescape(raw);
          // t="s" = אינדקס לטבלת המחרוזות; כל השאר (מספר/נוסחה/בוליאני) כטקסט.
          value = type === 's' ? (shared[Number(text)] ?? '') : text;
        }
      }
      while (cells.length < at) cells.push('');
      cells[at] = value;
    }
    rows.push(cells);
  }
  return rows;
}

/** שם קובץ הגיליון הראשון לפי סדר החוברת; נפילה לאחור ל-sheet1.xml. */
function firstSheetPath(workbook: string | null, rels: string | null, names: string[]): string | null {
  const sheetFiles = names.filter((n) => /^xl\/worksheets\/sheet[^/]*\.xml$/i.test(n)).sort();
  if (workbook !== null && rels !== null) {
    const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1];
    if (rid !== undefined) {
      const pattern = new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`);
      const target = pattern.exec(rels)?.[1];
      if (target !== undefined) {
        const clean = target.replace(/^\/?xl\//, '').replace(/^\.\//, '');
        const full = `xl/${clean}`;
        if (names.includes(full)) return full;
      }
    }
  }
  return sheetFiles[0] ?? null;
}

/** פיצול שורת CSV אחת, כולל שדות במרכאות עם פסיקים בתוכם. */
export function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else quoted = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** פענוח CSV/TSV לשורות. המפריד נבחר לפי מה שנפוץ יותר בשורה הראשונה. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, ''); // BOM שאקסל מוסיף ל-CSV
  const lines = clean.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const head = lines[0]!;
  const sep = (head.match(/\t/g)?.length ?? 0) > (head.match(/,/g)?.length ?? 0) ? '\t' : ',';
  return lines.map((l) => splitCsvLine(l, sep).map((c) => c.trim()));
}

/** האם הבייטים נראים כקובץ ZIP (ולכן XLSX) ולא כטקסט. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/**
 * קריאת קובץ גיליון לשורות. תומך ב-XLSX וב-CSV/TSV — לפי תוכן הקובץ, לא לפי
 * הסיומת, כדי שקובץ ששמו שונה עדיין ייקרא נכון.
 */
export async function readSheetRows(bytes: Uint8Array): Promise<string[][]> {
  if (!looksLikeZip(bytes)) return parseCsv(new TextDecoder().decode(bytes));
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files);
  const read = async (path: string): Promise<string | null> => {
    const file = zip.file(path);
    return file === null ? null : file.async('string');
  };
  const [workbook, rels, sharedXml] = await Promise.all([
    read('xl/workbook.xml'),
    read('xl/_rels/workbook.xml.rels'),
    read('xl/sharedStrings.xml'),
  ]);
  const path = firstSheetPath(workbook, rels, names);
  if (path === null) throw new Error('לא נמצא גיליון בקובץ');
  const sheet = await read(path);
  if (sheet === null) throw new Error('לא נמצא גיליון בקובץ');
  return parseSheet(sheet, sharedXml === null ? [] : parseSharedStrings(sharedXml));
}
