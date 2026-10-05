/**
 * קריאת קובץ Excel ישן (‎.xls‎, Excel 97–2003) לשורות — בלי ספריית אקסל כבדה.
 *
 * מערכת יצירת המשחקים מקבלת ביבוא שאלות גם ‎.xls‎ (דרך SheetJS), ולכן גם העורך
 * המקומי מקבל אותו: אותו קובץ צריך לעבוד בשני המקומות.
 *
 * הפורמט, בקצרה: מכולה של OLE (Compound File Binary — "מערכת קבצים" של סקטורים
 * וטבלת הקצאה) שבתוכה זרם בשם "Workbook" בפורמט BIFF8 — רצף רשומות
 * ‎[סוג u16][אורך u16][נתונים]‎. קוראים ממנו רק את מה שצריך כדי לקבל את הטקסט
 * של הגיליון הראשון: טבלת המחרוזות המשותפת (SST), רשימת הגיליונות, ותאי
 * הגיליון — מחרוזות, מספרים, ערכי אמת, שגיאות והערך השמור של נוסחאות.
 *
 * שתי הנקודות העדינות בפורמט:
 *   • רשומה מוגבלת ל-8,224 בתים, וטבלת המחרוזות ממשיכה ברשומות CONTINUE.
 *     מחרוזת שנחתכת באמצע ממשיכה ברשומה הבאה עם *בית דגל חדש* שקובע אם
 *     ההמשך ברוחב בית אחד או שניים (ראו ChunkReader.chars).
 *   • זרם קטן מ-4,096 בתים לא יושב בסקטורים הרגילים אלא ב"זרם המיני" של
 *     המכולה — כך כותבים למשל SheetJS וכלים אחרים קבצים קטנים.
 *
 * לא נתמכים, עם הודעה ברורה במקום זבל: קובץ מוגן בסיסמה (גם ‎.xlsx‎ מוצפן הוא
 * מכולת OLE), ו-Excel 95 ומטה (BIFF5 — טקסט לפי code page; גם SheetJS מאבד
 * בו את העברית).
 *
 * הקובץ טהור (בלי DOM ובלי Node) כדי שירוץ גם בבדיקות יחידה.
 */

import type { SheetRow } from './xlsxRead.ts';

/** שגיאה שנוסחה עבור המשתמש — ההודעה שלה מוצגת כמו שהיא. */
export class SheetFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetFileError';
  }
}

export const PROTECTED_FILE_MESSAGE =
  'הקובץ מוגן בסיסמה. פתחו אותו באקסל, הסירו את הסיסמה, שמרו ונסו שוב.';
export const OLD_EXCEL_MESSAGE =
  'הקובץ נשמר בגרסת Excel ישנה מדי (Excel 95 ומטה). פתחו אותו באקסל ושמרו כ-‎.xlsx‎.';
const CORRUPT_MESSAGE = 'הקובץ פגום או שאינו קובץ Excel תקין.';

const corrupt = (): SheetFileError => new SheetFileError(CORRUPT_MESSAGE);

// ---------------------------------------------------------------------------
// מכולת OLE (MS-CFB)
// ---------------------------------------------------------------------------

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
/** מספר סקטור "אמיתי" הגבוה ביותר; מעליו — ערכים מיוחדים (סוף שרשרת, פנוי...). */
const MAX_REG_SECT = 0xfffffffa;
const END_OF_CHAIN = 0xfffffffe;
const NO_STREAM = 0xffffffff;

/** האם הבייטים הם מכולת OLE (‎.xls‎, או ‎.xlsx‎ מוצפן). */
export function looksLikeCfb(bytes: Uint8Array): boolean {
  return bytes.length >= 512 && CFB_SIGNATURE.every((b, i) => bytes[i] === b);
}

interface DirEntry {
  name: string;
  /** 1 = תיקייה, 2 = זרם, 5 = השורש. */
  type: number;
  left: number;
  right: number;
  child: number;
  start: number;
  size: number;
}

interface Cfb {
  /** הרשומות שישירות תחת השורש (לא בתוך תיקיות — שם יושבים אובייקטים מוטמעים). */
  rootStreams: DirEntry[];
  read(entry: DirEntry): Uint8Array;
}

function openCfb(bytes: Uint8Array): Cfb {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (off: number): number => {
    if (off + 2 > bytes.length) throw corrupt();
    return view.getUint16(off, true);
  };
  const u32 = (off: number): number => {
    if (off + 4 > bytes.length) throw corrupt();
    return view.getUint32(off, true);
  };

  const sectorShift = u16(0x1e);
  const miniShift = u16(0x20);
  if (sectorShift < 7 || sectorShift > 16 || miniShift < 2 || miniShift >= sectorShift)
    throw corrupt();
  const sectorSize = 1 << sectorShift;
  const miniSize = 1 << miniShift;
  const perSector = sectorSize / 4;
  const miniCutoff = u32(0x38);

  /** סקטור n מתחיל אחרי הכותרת, שתופסת סקטור אחד שלם. */
  const sectorAt = (n: number): number => {
    const off = (n + 1) * sectorSize;
    if (n > MAX_REG_SECT || off >= bytes.length) throw corrupt();
    return off;
  };

  // טבלת ההקצאה (FAT): מיקומי הסקטורים שלה מגיעים מ-109 הרשומות שבכותרת,
  // ובקבצים גדולים גם משרשרת סקטורי DIFAT.
  const fatCount = u32(0x2c);
  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < fatCount; i += 1) {
    const s = u32(0x4c + i * 4);
    if (s <= MAX_REG_SECT) fatSectors.push(s);
  }
  let difat = u32(0x44);
  for (let guard = 0; difat <= MAX_REG_SECT && fatSectors.length < fatCount; guard += 1) {
    if (guard > fatCount) throw corrupt();
    const off = sectorAt(difat);
    for (let i = 0; i < perSector - 1 && fatSectors.length < fatCount; i += 1) {
      const s = u32(off + i * 4);
      if (s <= MAX_REG_SECT) fatSectors.push(s);
    }
    difat = u32(off + (perSector - 1) * 4);
  }
  const fat: number[] = [];
  for (const s of fatSectors) {
    const off = sectorAt(s);
    for (let i = 0; i < perSector; i += 1) {
      // סקטור FAT אחרון שנחתך בסוף הקובץ — הרשומות החסרות פשוט לא קיימות
      fat.push(off + i * 4 + 4 <= bytes.length ? view.getUint32(off + i * 4, true) : NO_STREAM);
    }
  }

  /** שרשרת סקטורים לפי טבלה; זורקת על לולאה או הפניה מחוץ לטבלה. */
  const chain = (table: number[], start: number): number[] => {
    const out: number[] = [];
    let s = start;
    while (s !== END_OF_CHAIN) {
      if (s > MAX_REG_SECT || s >= table.length || out.length > table.length) throw corrupt();
      out.push(s);
      s = table[s]!;
    }
    return out;
  };

  /** תוכן שרשרת של סקטורים רגילים, חתוך לגודל המבוקש. */
  const readRegular = (start: number, size: number): Uint8Array => {
    const out = new Uint8Array(size);
    let at = 0;
    for (const s of chain(fat, start)) {
      if (at >= size) break;
      const off = sectorAt(s);
      const take = Math.min(sectorSize, size - at, bytes.length - off);
      out.set(bytes.subarray(off, off + take), at);
      at += take;
    }
    if (at < size) throw corrupt();
    return out;
  };

  // הספרייה: רשומות של 128 בתים בשרשרת שמתחילה בסקטור שבכותרת.
  const entries: DirEntry[] = [];
  for (const s of chain(fat, u32(0x30))) {
    const base = sectorAt(s);
    for (let off = base; off + 128 <= base + sectorSize && off + 128 <= bytes.length; off += 128) {
      const nameBytes = Math.min(64, u16(off + 0x40));
      let name = '';
      for (let i = 0; i + 1 < nameBytes - 1; i += 2) name += String.fromCharCode(u16(off + i));
      entries.push({
        name,
        type: bytes[off + 0x42] ?? 0,
        left: u32(off + 0x44),
        right: u32(off + 0x48),
        child: u32(off + 0x4c),
        start: u32(off + 0x74),
        // בגרסה 3 רק 32 הביטים הנמוכים תקפים; חוברת עבודה לא מגיעה ל-4GB.
        size: u32(off + 0x78),
      });
    }
  }
  const root = entries[0];
  if (root === undefined || root.type !== 5) throw corrupt();

  // הצאצאים הישירים של השורש הם עץ בינארי לפי left/right, מתחת ל-child.
  const rootStreams: DirEntry[] = [];
  const seen = new Set<number>();
  const walk = (id: number): void => {
    if (id === NO_STREAM || id >= entries.length || seen.has(id)) return;
    seen.add(id);
    const e = entries[id]!;
    walk(e.left);
    rootStreams.push(e);
    walk(e.right);
  };
  walk(root.child);

  let miniStream: Uint8Array | null = null;
  let miniFat: number[] | null = null;
  const read = (entry: DirEntry): Uint8Array => {
    if (entry.size === 0) return new Uint8Array(0);
    if (entry.size >= miniCutoff) return readRegular(entry.start, entry.size);
    // זרם קטן — בסקטורים של 64 בתים בתוך "זרם המיני", שהוא הזרם של השורש.
    miniStream ??= readRegular(root.start, root.size);
    if (miniFat === null) {
      const table: number[] = [];
      const raw = readRegular(u32(0x3c), u32(0x40) * sectorSize);
      const rawView = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      for (let i = 0; i + 4 <= raw.length; i += 4) table.push(rawView.getUint32(i, true));
      miniFat = table;
    }
    const out = new Uint8Array(entry.size);
    let at = 0;
    for (const s of chain(miniFat, entry.start)) {
      if (at >= entry.size) break;
      const off = s * miniSize;
      const take = Math.min(miniSize, entry.size - at);
      if (off + take > miniStream.length) throw corrupt();
      out.set(miniStream.subarray(off, off + take), at);
      at += take;
    }
    if (at < entry.size) throw corrupt();
    return out;
  };

  return { rootStreams, read };
}

// ---------------------------------------------------------------------------
// רשומות BIFF8
// ---------------------------------------------------------------------------

const R_FORMULA = 0x0006;
const R_EOF = 0x000a;
const R_FILEPASS = 0x002f;
const R_CONTINUE = 0x003c;
const R_BOUNDSHEET = 0x0085;
const R_MULRK = 0x00bd;
const R_RSTRING = 0x00d6;
const R_SST = 0x00fc;
const R_LABELSST = 0x00fd;
const R_NUMBER = 0x0203;
const R_LABEL = 0x0204;
const R_BOOLERR = 0x0205;
const R_STRING = 0x0207;
const R_RK = 0x027e;
const R_BOF = 0x0809;

const BIFF8 = 0x0600;

interface BiffRecord {
  type: number;
  /** נתוני הרשומה, ואחריהם נתוני רשומות ה-CONTINUE שבאו מיד אחריה. */
  chunks: Uint8Array[];
}

/**
 * הרשומות של תת-זרם אחד (גלובלי או גיליון), מ-BOF ועד ה-EOF שסוגר אותו.
 * גרף מוטמע בגיליון הוא תת-זרם מקונן עם BOF/EOF משלו — לכן סופרים עומק.
 */
function substream(stream: Uint8Array, start: number): BiffRecord[] {
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const out: BiffRecord[] = [];
  let pos = start;
  let depth = 0;
  while (pos + 4 <= stream.length) {
    const type = view.getUint16(pos, true);
    const len = view.getUint16(pos + 2, true);
    const data = stream.subarray(pos + 4, Math.min(stream.length, pos + 4 + len));
    pos += 4 + len;
    if (type === R_CONTINUE) {
      out[out.length - 1]?.chunks.push(data);
      continue;
    }
    if (out.length === 0 && type !== R_BOF) throw corrupt();
    out.push({ type, chunks: [data] });
    if (type === R_BOF) depth += 1;
    if (type === R_EOF) {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return out;
}

/**
 * קורא בייטים לאורך רשומה וההמשכים שלה. המעבר בין רשומות "שקוף", חוץ מתווים
 * של מחרוזת: מחרוזת שנחתכה ממשיכה ברשומה הבאה, שמתחילה בבית דגל חדש
 * (ביט 0 = תווים של שני בתים). כך בדיוק קורא xlrd, הקורא הוותיק ביותר.
 */
class ChunkReader {
  private index = 0;
  private pos: number;

  constructor(
    private readonly chunks: Uint8Array[],
    start = 0,
  ) {
    this.pos = start;
  }

  /** עוברים לרשומה הבאה כשהנוכחית נגמרה. false = אין יותר נתונים. */
  private settle(): boolean {
    while (this.index < this.chunks.length && this.pos >= this.chunks[this.index]!.length) {
      this.index += 1;
      this.pos = 0;
    }
    return this.index < this.chunks.length;
  }

  hasMore(): boolean {
    return this.settle();
  }

  u8(): number {
    if (!this.settle()) throw corrupt();
    const v = this.chunks[this.index]![this.pos]!;
    this.pos += 1;
    return v;
  }

  u16(): number {
    return this.u8() | (this.u8() << 8);
  }

  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }

  skip(n: number): void {
    let left = n;
    while (left > 0 && this.settle()) {
      const take = Math.min(left, this.chunks[this.index]!.length - this.pos);
      this.pos += take;
      left -= take;
    }
  }

  /** `count` תווים; `wide` = שני בתים לתו (UTF-16LE), אחרת בית אחד (Latin-1). */
  chars(count: number, wide: boolean): string {
    const units: number[] = [];
    let twoBytes = wide;
    while (units.length < count && this.index < this.chunks.length) {
      const chunk = this.chunks[this.index]!;
      if (this.pos >= chunk.length) {
        // המחרוזת ממשיכה ברשומה הבאה — שמתחילה בבית דגל משלה
        this.index += 1;
        this.pos = 0;
        const next = this.chunks[this.index];
        if (next === undefined || next.length === 0) break;
        twoBytes = (next[0]! & 1) === 1;
        this.pos = 1;
        continue;
      }
      const need = count - units.length;
      if (twoBytes) {
        const avail = Math.min((chunk.length - this.pos) >> 1, need);
        for (let k = 0; k < avail; k += 1) {
          units.push(chunk[this.pos + 2 * k]! | (chunk[this.pos + 2 * k + 1]! << 8));
        }
        // בית בודד שנשאר בסוף רשומה (לא אמור לקרות) — מדלגים עליו ולא נתקעים
        this.pos = avail === 0 ? chunk.length : this.pos + 2 * avail;
      } else {
        const avail = Math.min(chunk.length - this.pos, need);
        for (let k = 0; k < avail; k += 1) units.push(chunk[this.pos + k]!);
        this.pos += avail;
      }
    }
    // יחידה אחר יחידה (ולא פענוח לכל רשומה בנפרד), כדי שזוג surrogate של
    // אימוג'י שנחתך בין שתי רשומות יתחבר חזרה לתו אחד.
    let out = '';
    for (let i = 0; i < units.length; i += 4096) {
      out += String.fromCharCode(...units.slice(i, i + 4096));
    }
    return out;
  }
}

/** טבלת המחרוזות המשותפת: XLUnicodeRichExtendedString אחרי שני מונים. */
function parseSst(chunks: Uint8Array[]): string[] {
  const r = new ChunkReader(chunks);
  r.skip(4); // סך המופעים — לא צריך
  const unique = r.u32();
  const out: string[] = [];
  for (let i = 0; i < unique && r.hasMore(); i += 1) {
    const cch = r.u16();
    const flags = r.u8();
    const runs = (flags & 0x08) !== 0 ? r.u16() : 0;
    const ext = (flags & 0x04) !== 0 ? r.u32() : 0;
    out.push(r.chars(cch, (flags & 0x01) !== 0));
    r.skip(runs * 4); // עיצוב לפי תווים
    r.skip(ext); // הגייה (יפנית) — לא רלוונטי
  }
  return out;
}

/** XLUnicodeString: אורך u16, בית דגל, תווים. (LABEL, STRING) */
function unicodeString(chunks: Uint8Array[], offset: number): string {
  const r = new ChunkReader(chunks, offset);
  const cch = r.u16();
  const flags = r.u8();
  return r.chars(cch, (flags & 0x01) !== 0);
}

/** ערך RK: מספר שלם של 30 ביט או double מקוצץ, אולי מחולק במאה. */
function rkValue(rk: number): number {
  let value: number;
  if ((rk & 0x02) !== 0) {
    value = rk >> 2; // rk כבר int32 — הזזה אריתמטית שומרת על הסימן
  } else {
    const buf = new DataView(new ArrayBuffer(8));
    buf.setUint32(4, rk & 0xfffffffc, true);
    value = buf.getFloat64(0, true);
  }
  return (rk & 0x01) !== 0 ? value / 100 : value;
}

/** מספר כטקסט, כמו שמערכת יצירת המשחקים מקבלת אותו (Number#toString). */
function numberText(n: number): string {
  return Number.isFinite(n) ? String(n) : '';
}

const ERROR_TEXT: Record<number, string> = {
  0x00: '#NULL!',
  0x07: '#DIV/0!',
  0x0f: '#VALUE!',
  0x17: '#REF!',
  0x1d: '#NAME?',
  0x24: '#NUM!',
  0x2a: '#N/A',
};

/** ערך אמת/שגיאה, באותו ניסוח שקורא ה-XLSX נותן (TRUE / FALSE / ‎#N/A‎). */
function boolErrText(value: number, isError: boolean): string {
  if (isError) return ERROR_TEXT[value] ?? '#ERROR';
  return value !== 0 ? 'TRUE' : 'FALSE';
}

/**
 * קריאת הגיליון הראשון של קובץ ‎.xls‎ לשורות. השורות ממוינות ומסומנות במספר
 * השורה באקסל (1 = הראשונה); נכללות רק שורות שיש בהן תא עם ערך.
 */
export function readXlsRows(bytes: Uint8Array): SheetRow[] {
  const cfb = openCfb(bytes);
  const find = (name: string): DirEntry | undefined =>
    cfb.rootStreams.find((e) => e.type === 2 && e.name.toLowerCase() === name.toLowerCase());

  // ‎.xlsx‎ מוצפן הוא מכולת OLE עם החבילה המוצפנת בתוכה.
  if (find('EncryptedPackage') !== undefined || find('EncryptionInfo') !== undefined) {
    throw new SheetFileError(PROTECTED_FILE_MESSAGE);
  }
  const book = find('Workbook');
  if (book === undefined) {
    // "Book" — הזרם של Excel 5/95 (BIFF5)
    if (find('Book') !== undefined) throw new SheetFileError(OLD_EXCEL_MESSAGE);
    throw corrupt();
  }
  const stream = cfb.read(book);

  // תת-הזרם הגלובלי: גרסה, הצפנה, רשימת הגיליונות וטבלת המחרוזות.
  const globals = substream(stream, 0);
  const bof = globals[0]?.chunks[0];
  if (bof === undefined || bof.length < 2) throw corrupt();
  if ((bof[0]! | (bof[1]! << 8)) !== BIFF8) throw new SheetFileError(OLD_EXCEL_MESSAGE);

  let shared: string[] = [];
  let firstSheet: number | null = null;
  for (const rec of globals) {
    if (rec.type === R_FILEPASS) throw new SheetFileError(PROTECTED_FILE_MESSAGE);
    if (rec.type === R_SST) shared = parseSst(rec.chunks);
    if (rec.type === R_BOUNDSHEET && firstSheet === null) {
      const d = rec.chunks[0]!;
      // סוג הגיליון בבית 5: 0 = גיליון עבודה (ולא גרף / מאקרו / VBA)
      if (d.length >= 6 && d[5] === 0) {
        firstSheet = new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(0, true);
      }
    }
  }
  if (firstSheet === null) throw new SheetFileError('לא נמצא גיליון בקובץ');
  if (firstSheet >= stream.length) throw corrupt();

  const rows = new Map<number, string[]>();
  const put = (row: number, col: number, value: string): void => {
    let cells = rows.get(row);
    if (cells === undefined) {
      cells = [];
      rows.set(row, cells);
    }
    while (cells.length < col) cells.push('');
    cells[col] = value;
  };
  /** נוסחה שהערך השמור שלה הוא מחרוזת — מגיע ברשומת STRING שאחריה. */
  let pendingString: { row: number; col: number } | null = null;

  for (const rec of substream(stream, firstSheet)) {
    const d = rec.chunks[0]!;
    const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
    if (rec.type === R_STRING) {
      if (pendingString !== null)
        put(pendingString.row, pendingString.col, unicodeString(rec.chunks, 0));
      pendingString = null;
      continue;
    }
    if (d.length < 6) continue;
    const row = view.getUint16(0, true);
    const col = view.getUint16(2, true);
    switch (rec.type) {
      case R_LABELSST:
        if (d.length >= 10) put(row, col, shared[view.getUint32(6, true)] ?? '');
        break;
      case R_LABEL:
      case R_RSTRING:
        put(row, col, unicodeString(rec.chunks, 6));
        break;
      case R_NUMBER:
        if (d.length >= 14) put(row, col, numberText(view.getFloat64(6, true)));
        break;
      case R_RK:
        if (d.length >= 10) put(row, col, numberText(rkValue(view.getInt32(6, true))));
        break;
      case R_MULRK: {
        // [ixfe u16, rk i32] × n ואז עמודה אחרונה u16
        const count = Math.floor((d.length - 6) / 6);
        for (let i = 0; i < count; i += 1) {
          put(row, col + i, numberText(rkValue(view.getInt32(4 + i * 6 + 2, true))));
        }
        break;
      }
      case R_BOOLERR:
        if (d.length >= 8) put(row, col, boolErrText(d[6]!, d[7] !== 0));
        break;
      case R_FORMULA: {
        if (d.length < 14) break;
        // הערך השמור: double, או — כששני הבתים העליונים 0xFFFF — סוג מיוחד בבית 0:
        // 0 מחרוזת (ברשומת STRING שאחריה), 1 ערך אמת, 2 שגיאה, 3 מחרוזת ריקה.
        if (d[12] === 0xff && d[13] === 0xff) {
          const kind = d[6];
          if (kind === 1) put(row, col, boolErrText(d[8]!, false));
          else if (kind === 2) put(row, col, boolErrText(d[8]!, true));
          pendingString = kind === 0 ? { row, col } : null;
          continue;
        }
        put(row, col, numberText(view.getFloat64(6, true)));
        break;
      }
      default:
        continue;
    }
    pendingString = null;
  }

  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([row, cells]) => ({ row: row + 1, cells }));
}
