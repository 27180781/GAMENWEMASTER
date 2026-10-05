/**
 * קריאת גיליון (XLSX, XLS או CSV) לשורות של מחרוזות — בלי ספריית אקסל כבדה.
 *
 * XLSX הוא ZIP של XML: הגיליון הראשון נלקח לפי סדר החוברת (workbook.xml +
 * ה-rels שלו), והמחרוזות מפוענחות מ-sharedStrings.xml או מ-inlineStr. שומרים
 * על מיקום העמודה לפי מזהה התא (r="B3") — כך תא ריק באמצע לא מזיז את שאר
 * העמודות, וזה בדיוק המצב כשעמודת הקבוצה חסרה בחלק מהשורות.
 *
 * ‎.xls‎ (Excel 97–2003) נקרא ב-xlsRead.ts, ו-CSV/TSV כאן למטה.
 *
 * הקובץ טהור (בלי DOM) כדי שירוץ גם בבדיקות יחידה.
 */

import JSZip from 'jszip';
import { looksLikeCfb, readXlsRows, SheetFileError } from './xlsRead.ts';

/** שורה בגיליון: מספר השורה כפי שאקסל מציג אותו (1 = הראשונה) והתאים לפי עמודה. */
export interface SheetRow {
  row: number;
  cells: string[];
}

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

/**
 * מספר כטקסט, כמו שהוא נראה באקסל ובמערכת יצירת המשחקים: אקסל שומר לפעמים
 * 17 ספרות ("3.1400000000000001"), ושם הערך נקרא כמספר ומוצג "3.14".
 */
function numberText(raw: string): string {
  const n = Number(raw);
  return raw.trim() !== '' && Number.isFinite(n) ? String(n) : raw;
}

/** פענוח גיליון בודד לשורות. */
function parseSheet(xml: string, shared: string[]): SheetRow[] {
  const rows: SheetRow[] = [];
  let lastRow = 0;
  // ‎[^>]*?‎ עצל + חלופה ל-"/>": שורה או תא ריקים נכתבים כתג סוגר-עצמו
  // (‎<c r="E2" s="3"/>‎ — תא עם מסגרת ובלי ערך). תבנית חמדנית "בלעה" את התא
  // הבא לתוכם, והערך שלו נחת בעמודה הלא נכונה.
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowRef = /\br="(\d+)"/.exec(rowMatch[1] ?? '')?.[1];
    const rowNum = rowRef !== undefined ? Number(rowRef) : lastRow + 1;
    lastRow = rowNum;
    const body = rowMatch[2] ?? '';
    const cells: string[] = [];
    let auto = 0; // תא בלי r= (נדיר) — ממוקם אחרי הקודם
    for (const cellMatch of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
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
          // t="s" = אינדקס לטבלת המחרוזות; ערך אמת כמו שאקסל מציג אותו;
          // מספר — מנורמל; כל השאר (נוסחת טקסט, שגיאה, תאריך ISO) כטקסט.
          if (type === 's') value = shared[Number(text)] ?? '';
          else if (type === 'b') value = text === '1' ? 'TRUE' : 'FALSE';
          else if (type === 'n') value = numberText(text);
          else value = text;
        }
      }
      while (cells.length < at) cells.push('');
      cells[at] = value;
    }
    rows.push({ row: rowNum, cells });
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

// ---------------------------------------------------------------------------
// CSV / TSV
// ---------------------------------------------------------------------------

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

/**
 * המפריד לפי השורה הראשונה (מחוץ למרכאות): הנפוץ מבין פסיק, טאב, נקודה-פסיק
 * וקו אנכי; בתיקו — לפי הסדר הזה, ובלי אף אחד — פסיק. כמו SheetJS במערכת יצירת
 * המשחקים, כך שאותו קובץ מתפרק אצלנו ואצלם לאותן עמודות.
 */
function guessSeparator(text: string): string {
  const counts = new Map<string, number>();
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && (ch === ',' || ch === '\t' || ch === ';' || ch === '|')) {
      counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
  }
  let best = ',';
  let bestCount = 0;
  for (const sep of [',', '\t', ';', '|']) {
    const n = counts.get(sep) ?? 0;
    if (n > bestCount) {
      best = sep;
      bestCount = n;
    }
  }
  return best;
}

/**
 * פענוח CSV/TSV לרשומות ממוספרות. שדה במרכאות יכול להכיל פסיקים, מרכאות
 * כפולות ("") **ושורות חדשות** — כך אקסל שומר תא עם Alt+Enter, ובלי זה שאלה
 * בשתי שורות הייתה נקרעת לשתי רשומות. שורה ריקה לגמרי מדלגת, אבל נספרת —
 * כדי ש"שורה 7" בהודעה תהיה השורה ה-7 כשפותחים את הקובץ באקסל.
 * שורת ‎sep=;‎ בראש הקובץ (מוסכמה של אקסל) קובעת את המפריד ואינה נתונים.
 */
export function parseCsvRecords(input: string): SheetRow[] {
  let text = input.replace(/^\uFEFF/, ''); // BOM שאקסל מוסיף ל-CSV
  let sep: string;
  const declared = /^sep=(.)\r?\n/i.exec(text);
  if (declared !== null) {
    sep = declared[1]!;
    text = text.slice(declared[0].length);
  } else {
    sep = guessSeparator(text);
  }

  const out: SheetRow[] = [];
  let record = 1;
  let cells: string[] = [];
  let cur = '';
  let quoted = false;
  let blank = true; // האם הרשומה הנוכחית ריקה (רק רווחים)
  const endRecord = (): void => {
    cells.push(cur);
    if (!blank) out.push({ row: record, cells: cells.map((c) => c.trim()) });
    record += 1;
    cells = [];
    cur = '';
    blank = true;
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else quoted = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      blank = false;
    } else if (ch === sep) {
      cells.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      endRecord();
    } else {
      cur += ch;
      if (ch.trim() !== '') blank = false;
    }
  }
  if (cur !== '' || cells.length > 0 || !blank) endRecord();
  return out;
}

/** פענוח CSV/TSV לשורות (בלי השורות הריקות). */
export function parseCsv(text: string): string[][] {
  return parseCsvRecords(text).map((r) => r.cells);
}

/**
 * הבייטים של קובץ טקסט → מחרוזת. UTF-8 (עם BOM או בלי), UTF-16 עם BOM
 * ("טקסט Unicode" של אקסל), ואחרת Windows-1255 — מה שאקסל בעברית שומר
 * כ"CSV (מופרד בפסיקים)". בלי הנפילה הזו כל עברית בקובץ כזה הייתה הופכת
 * לסימני שאלה.
 */
export function decodeText(bytes: Uint8Array): string {
  const utf16 = (label: string) => new TextDecoder(label).decode(bytes.subarray(2));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return utf16('utf-16le');
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return utf16('utf-16be');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1255').decode(bytes);
  }
}

/** האם הבייטים נראים כקובץ ZIP (ולכן XLSX) ולא כטקסט. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export const MARKUP_FILE_MESSAGE =
  'זה לא קובץ אקסל רגיל אלא דף אינטרנט או XML עם סיומת של אקסל. פתחו אותו באקסל ושמרו כ-‎.xlsx‎ (חוברת עבודה של Excel).';

/**
 * "קובץ אקסל" שהוא בעצם טבלת HTML או XML של Excel 2003 — כך מערכות רבות
 * מייצאות ‎.xls‎. בלי הבדיקה הוא היה נקרא כ-CSV, ותגיות ה-HTML היו הופכות
 * ל"שורות" של זבל.
 */
function looksLikeMarkup(text: string): boolean {
  const head = text.slice(0, 4096).trimStart().toLowerCase();
  return head.startsWith('<') && /<(?:html|table|\?xml|workbook|!doctype)/.test(head);
}

/** XLSX → שורות הגיליון הראשון. */
async function readXlsxRows(bytes: Uint8Array): Promise<SheetRow[]> {
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

/**
 * קריאת קובץ גיליון לשורות ממוספרות. תומך ב-XLSX, ב-XLS וב-CSV/TSV — לפי
 * תוכן הקובץ, לא לפי הסיומת, כדי שקובץ ששמו שונה עדיין ייקרא נכון.
 *
 * שורות בלי אף ערך לא מוחזרות (מספרי השורות שומרים על הפער). אקסל כותב שורה
 * ריקה עם עיצוב (גובה, מסגרת) כשורה לכל דבר, ובלי הסינון היא הייתה נחשבת
 * ל"שורה הראשונה" — ושורת הכותרת האמיתית שאחריה הייתה נקראת כנתונים.
 */
export async function readSheet(bytes: Uint8Array): Promise<SheetRow[]> {
  let rows: SheetRow[];
  if (looksLikeZip(bytes)) rows = await readXlsxRows(bytes);
  else if (looksLikeCfb(bytes)) rows = readXlsRows(bytes);
  else {
    const text = decodeText(bytes);
    if (looksLikeMarkup(text)) throw new SheetFileError(MARKUP_FILE_MESSAGE);
    rows = parseCsvRecords(text);
  }
  return rows.filter((r) => r.cells.some((c) => c.trim() !== ''));
}

/** כמו readSheet, רק התאים (בלי מספרי השורות). */
export async function readSheetRows(bytes: Uint8Array): Promise<string[][]> {
  return (await readSheet(bytes)).map((r) => r.cells);
}
