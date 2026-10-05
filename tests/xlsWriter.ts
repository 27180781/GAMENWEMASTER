/**
 * כותב ‎.xls‎ (BIFF8 בתוך מכולת OLE) מינימלי — לבדיקות בלבד. הוא כותב רק מה
 * שהקורא (src/app/xlsRead.ts) קורא, אבל לפי הפורמט עצמו (MS-CFB, MS-XLS), כדי
 * לבדוק את המקרים העדינים שקשה למצוא בקבצים אמיתיים קטנים: מחרוזת שנחתכת בין
 * רשומות CONTINUE עם בית דגל שמחליף רוחב, עיצוב (rich text) שחוצה רשומה, זרם
 * קטן בתוך "זרם המיני" לעומת זרם בסקטורים רגילים, וקבצים מוגנים או ישנים.
 *
 * הקבצים שהבדיקות בונות נבדקו מול שני קוראים עצמאיים כשהכותב נכתב: xlrd קרא
 * את כל צורות החיתוך של טבלת המחרוזות כמו כאן, ו-SheetJS (הספרייה של מערכת
 * יצירת המשחקים) קרא גם את סוגי התאים ואת הגיליון הגדול. (xlrd לא קורא תאי
 * מספר בלי רשומות עיצוב XF, שהכותב הזה לא כותב.)
 */

/** תא בגיליון. מחרוזת רגילה = LABELSST (כמו אקסל), מספר רגיל = NUMBER. */
export type XlsCell =
  | string
  | number
  | null
  | { kind: 'label'; text: string }
  | { kind: 'rk'; value: number }
  | { kind: 'mulrk'; values: number[] }
  | { kind: 'bool'; value: boolean }
  | { kind: 'error'; code: number }
  /** נוסחה שהערך השמור שלה מחרוזת (ברשומת STRING שאחריה); shared = רשומת SHRFMLA ביניהן. */
  | { kind: 'formulaString'; text: string; shared?: boolean }
  | { kind: 'formulaNumber'; value: number }
  | { kind: 'formulaBool'; value: boolean };

export interface XlsOptions {
  /** רשומת FILEPASS — קובץ מוגן בסיסמה. */
  filePass?: boolean;
  /** הגרסה שב-BOF (ברירת מחדל 0x0600 = BIFF8). */
  biffVersion?: number;
  /** שם הזרם (ברירת מחדל "Workbook"; "Book" = Excel 95). */
  streamName?: string;
  /** זרמים נוספים בשורש המכולה. */
  extraStreams?: { name: string; data: Uint8Array }[];
  /** גיליון גרף לפני גיליון הנתונים. */
  chartFirst?: boolean;
  /** גודל מרבי לרשומת SST/CONTINUE — קטן כדי לכפות חיתוכים בקובץ קטן. */
  sstRecordLimit?: number;
  /** המשך של מחרוזת שנחתכה נכתב תמיד בשני בתים לתו, גם כשאפשר בבית אחד. */
  wideContinuation?: boolean;
  /** מחרוזות SST עם עיצוב (2 ריצות) או עם הרחבת הגייה — לפי הטקסט. */
  richStrings?: string[];
  extStrings?: string[];
  /** ריפוד הזרם לגודל מינימלי (אקסל מרפד ל-4096, כדי לא לשבת בזרם המיני). */
  padTo?: number;
}

// ---------------------------------------------------------------------------
// BIFF8
// ---------------------------------------------------------------------------

class Bytes {
  private parts: number[] = [];
  get length(): number {
    return this.parts.length;
  }
  u8(v: number): this {
    this.parts.push(v & 0xff);
    return this;
  }
  u16(v: number): this {
    return this.u8(v).u8(v >> 8);
  }
  u32(v: number): this {
    return this.u16(v & 0xffff).u16((v >>> 16) & 0xffff);
  }
  f64(v: number): this {
    const b = new DataView(new ArrayBuffer(8));
    b.setFloat64(0, v, true);
    for (let i = 0; i < 8; i += 1) this.u8(b.getUint8(i));
    return this;
  }
  raw(bytes: ArrayLike<number>): this {
    for (let i = 0; i < bytes.length; i += 1) this.u8(bytes[i]!);
    return this;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

/** יחידות UTF-16 של המחרוזת (כך BIFF8 סופר תווים). */
const units = (text: string): number[] =>
  Array.from({ length: text.length }, (_, i) => text.charCodeAt(i));

/** מחרוזת שאי אפשר לכתוב בבית אחד לתו (עברית, אמוג'י). */
const wideNeeded = (text: string): boolean => units(text).some((u) => u > 0xff);

function record(type: number, data: Uint8Array): Uint8Array {
  return new Bytes().u16(type).u16(data.length).raw(data).done();
}

/** XLUnicodeString קצרה בתוך רשומה אחת (LABEL, STRING). */
function unicodeString(text: string): Uint8Array {
  const wide = wideNeeded(text);
  const b = new Bytes().u16(text.length).u8(wide ? 1 : 0);
  for (const u of units(text)) {
    if (wide) b.u16(u);
    else b.u8(u);
  }
  return b.done();
}

/**
 * טבלת המחרוזות (SST) ורשומות ה-CONTINUE שלה, לפי כללי החיתוך של הפורמט:
 * כותרת מחרוזת לא נחתכת (מחרוזת שלא נכנסת מתחילה ברשומה חדשה, בלי בית דגל);
 * תווים שנחתכו ממשיכים ברשומה שמתחילה בבית דגל; ריצת עיצוב לא נחתכת.
 */
function sstRecords(strings: string[], opts: XlsOptions): Uint8Array[] {
  const limit = opts.sstRecordLimit ?? 8224;
  const rich = new Set(opts.richStrings ?? []);
  const ext = new Set(opts.extStrings ?? []);
  const records: number[][] = [[]];
  const cur = (): number[] => records[records.length - 1]!;
  const room = (): number => limit - cur().length;
  const push = (...bytes: number[]): void => {
    cur().push(...bytes);
  };
  const newRecord = (): void => {
    records.push([]);
  };
  const le16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff];
  const le32 = (v: number): number[] => [...le16(v & 0xffff), ...le16((v >>> 16) & 0xffff)];

  push(...le32(strings.length), ...le32(strings.length));
  for (const text of strings) {
    const isRich = rich.has(text);
    const isExt = ext.has(text);
    let wide = wideNeeded(text);
    const header = [
      ...le16(text.length),
      (wide ? 0x01 : 0) | (isRich ? 0x08 : 0) | (isExt ? 0x04 : 0),
      ...(isRich ? le16(2) : []),
      ...(isExt ? le32(6) : []),
    ];
    if (room() < header.length) newRecord();
    push(...header);
    const chars = units(text);
    let i = 0;
    while (i < chars.length) {
      if (room() < (wide ? 2 : 1)) {
        newRecord();
        const rest = chars.slice(i);
        wide = opts.wideContinuation === true || rest.some((u) => u > 0xff);
        push(wide ? 1 : 0);
      }
      const fit = Math.min(chars.length - i, wide ? Math.floor(room() / 2) : room());
      for (const u of chars.slice(i, i + fit)) push(...(wide ? le16(u) : [u]));
      i += fit;
    }
    if (isRich) {
      for (const run of [
        [0, 1],
        [1, 2],
      ]) {
        if (room() < 4) newRecord();
        push(...le16(run[0]!), ...le16(run[1]!));
      }
    }
    if (isExt) {
      for (const byte of [1, 2, 3, 4, 5, 6]) {
        if (room() < 1) newRecord();
        push(byte);
      }
    }
  }
  return records.map((data, i) => record(i === 0 ? 0x00fc : 0x003c, Uint8Array.from(data)));
}

/**
 * ערך RK כשאפשר: שלם של 30 ביט, double ש-34 הביטים הנמוכים שלו אפס, ושניהם
 * גם כפול מאה (ביט 0). אחרת undefined.
 */
function rkOf(value: number): number | undefined {
  const int30 = (v: number): boolean => Number.isInteger(v) && v >= -(2 ** 29) && v < 2 ** 29;
  const shortDouble = (v: number): number | undefined => {
    const b = new DataView(new ArrayBuffer(8));
    b.setFloat64(0, v, true);
    const high = b.getUint32(4, true);
    return b.getUint32(0, true) === 0 && (high & 0x03) === 0 ? high : undefined;
  };
  if (int30(value)) return ((value << 2) | 0x02) >>> 0;
  const asDouble = shortDouble(value);
  if (asDouble !== undefined) return asDouble;
  const cents = Math.round(value * 100);
  if (cents / 100 === value) {
    if (int30(cents)) return ((cents << 2) | 0x03) >>> 0;
    const centsDouble = shortDouble(cents);
    if (centsDouble !== undefined) return (centsDouble | 0x01) >>> 0;
  }
  return undefined;
}

function bof(version: number, dt: number): Uint8Array {
  return record(
    0x0809,
    new Bytes().u16(version).u16(dt).u16(0x0dbb).u16(0x07cc).u32(0).u32(6).done(),
  );
}
const EOF = record(0x000a, new Uint8Array(0));

/** זרם ה-Workbook: גלובלי (גרסה, גיליונות, SST) ואז הגיליון עם התאים. */
export function buildWorkbookStream(rows: XlsCell[][], opts: XlsOptions = {}): Uint8Array {
  const version = opts.biffVersion ?? 0x0600;
  // המחרוזות של LABELSST, לפי סדר ההופעה
  const strings: string[] = [];
  const index = new Map<string, number>();
  for (const row of rows) {
    for (const cell of row) {
      if (typeof cell === 'string' && !index.has(cell)) {
        index.set(cell, strings.length);
        strings.push(cell);
      }
    }
  }

  const cells: Uint8Array[] = [];
  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      const head = (): Bytes => new Bytes().u16(r).u16(c).u16(15);
      if (cell === null) return;
      if (typeof cell === 'string') {
        cells.push(record(0x00fd, head().u32(index.get(cell)!).done()));
      } else if (typeof cell === 'number') {
        cells.push(record(0x0203, head().f64(cell).done()));
      } else if (cell.kind === 'label') {
        cells.push(record(0x0204, head().raw(unicodeString(cell.text)).done()));
      } else if (cell.kind === 'rk') {
        const rk = rkOf(cell.value);
        if (rk === undefined) throw new Error(`${cell.value} אינו ניתן לייצוג כ-RK`);
        cells.push(record(0x027e, head().u32(rk).done()));
      } else if (cell.kind === 'mulrk') {
        const b = new Bytes().u16(r).u16(c);
        for (const v of cell.values) b.u16(15).u32(rkOf(v)!);
        cells.push(record(0x00bd, b.u16(c + cell.values.length - 1).done()));
      } else if (cell.kind === 'bool' || cell.kind === 'error') {
        const value = cell.kind === 'bool' ? (cell.value ? 1 : 0) : cell.code;
        cells.push(
          record(
            0x0205,
            head()
              .u8(value)
              .u8(cell.kind === 'error' ? 1 : 0)
              .done(),
          ),
        );
      } else {
        // FORMULA: ערך שמור (8) · grbit (2) · chn (4) · cce (2) · rgce — כאן "=1"
        // (ptgInt). ערך שאינו מספר: סוג בבית הראשון, 0xFFFF בשני האחרונים.
        const special = (kind: number, byte: number): Uint8Array =>
          new Bytes().u8(kind).u8(0).u8(byte).u8(0).u8(0).u8(0).u8(0xff).u8(0xff).done();
        const value =
          cell.kind === 'formulaString'
            ? special(0, 0)
            : cell.kind === 'formulaBool'
              ? special(1, cell.value ? 1 : 0)
              : new Bytes().f64(cell.value).done();
        cells.push(record(0x0006, head().raw(value).u16(0).u32(0).u16(3).u8(0x1e).u16(1).done()));
        if (cell.kind === 'formulaString') {
          // SHRFMLA (נוסחה משותפת) יכולה לבוא בין הנוסחה לערך שלה
          if (cell.shared === true) cells.push(record(0x04bc, new Uint8Array(12)));
          cells.push(record(0x0207, unicodeString(cell.text)));
        }
      }
    });
  });

  /** BOUNDSHEET: מיקום ה-BOF של הגיליון · מוסתר · סוג (0 גיליון, 2 גרף) · שם. */
  const boundsheet = (offset: number, dt: number, name: string): Uint8Array => {
    const b = new Bytes().u32(offset).u8(0).u8(dt).u8(name.length).u8(1);
    for (const u of units(name)) b.u16(u);
    return record(0x0085, b.done());
  };

  const chartStream = opts.chartFirst === true ? [bof(version, 0x0020), EOF] : [];
  const sheetStream = [bof(version, 0x0010), ...cells, EOF];
  const globalsWith = (chartAt: number, sheetAt: number): Uint8Array[] => [
    bof(version, 0x0005),
    ...(opts.filePass === true
      ? [record(0x002f, new Bytes().u16(1).raw(new Uint8Array(52)).done())]
      : []),
    ...(opts.chartFirst === true ? [boundsheet(chartAt, 0x02, 'גרף')] : []),
    boundsheet(sheetAt, 0x00, 'שאלות'),
    ...(strings.length > 0 ? sstRecords(strings, opts) : []),
    EOF,
  ];
  // אורך הגלובלי אינו תלוי במיקומים (שדות באורך קבוע) — מחשבים פעם אחת ומציבים
  const size = (parts: Uint8Array[]): number => parts.reduce((n, p) => n + p.length, 0);
  const globalsSize = size(globalsWith(0, 0));
  const chartAt = globalsSize;
  const sheetAt = globalsSize + size(chartStream);
  const all = [...globalsWith(chartAt, sheetAt), ...chartStream, ...sheetStream];
  const out = new Uint8Array(Math.max(size(all), opts.padTo ?? 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// מכולת OLE (MS-CFB, גרסה 3: סקטורים של 512 בתים)
// ---------------------------------------------------------------------------

const SECTOR = 512;
const MINI = 64;
const CUTOFF = 4096;
const END = 0xfffffffe;
const FREE = 0xffffffff;
const FATSECT = 0xfffffffd;
const NOSTREAM = 0xffffffff;

/** מכולה שבשורש שלה הזרמים הנתונים. זרם קטן מ-4096 נכנס לזרם המיני. */
export function buildCfb(streams: { name: string; data: Uint8Array }[]): Uint8Array {
  const sectorsFor = (n: number, size: number): number => Math.ceil(n / size);

  // זרם המיני: הזרמים הקטנים ברצף, כל אחד מיושר ל-64 בתים
  const small = streams.filter((s) => s.data.length < CUTOFF && s.data.length > 0);
  const miniStarts = new Map<string, number>();
  let miniCount = 0;
  for (const s of small) {
    miniStarts.set(s.name, miniCount);
    miniCount += sectorsFor(s.data.length, MINI);
  }
  const miniBytes = new Uint8Array(miniCount * MINI);
  const miniFat: number[] = [];
  for (const s of small) {
    const start = miniStarts.get(s.name)!;
    miniBytes.set(s.data, start * MINI);
    const n = sectorsFor(s.data.length, MINI);
    for (let i = 0; i < n; i += 1) miniFat.push(i === n - 1 ? END : start + i + 1);
  }

  const large = streams.filter((s) => s.data.length >= CUTOFF);
  const dirSectors = sectorsFor((streams.length + 1) * 128, SECTOR);
  const miniFatSectors = sectorsFor(miniFat.length * 4, SECTOR);
  const miniStreamSectors = sectorsFor(miniBytes.length, SECTOR);
  const largeSectors = large.reduce((n, s) => n + sectorsFor(s.data.length, SECTOR), 0);
  const others = dirSectors + miniFatSectors + miniStreamSectors + largeSectors;
  let fatSectors = 1;
  while (fatSectors * (SECTOR / 4) < fatSectors + others) fatSectors += 1;
  if (fatSectors > 109) throw new Error('גדול מדי לכותב הבדיקות (DIFAT לא נתמך)');

  // הקצאה: FAT · ספרייה · FAT מיני · זרם המיני · הזרמים הגדולים
  const total = fatSectors + others;
  const fat = new Array<number>(fatSectors * (SECTOR / 4)).fill(FREE);
  let next = 0;
  const allocate = (count: number): number => {
    const start = next;
    for (let i = 0; i < count; i += 1) fat[start + i] = i === count - 1 ? END : start + i + 1;
    next += count;
    return count === 0 ? END : start;
  };
  for (let i = 0; i < fatSectors; i += 1) fat[i] = FATSECT;
  next = fatSectors;
  const dirStart = allocate(dirSectors);
  const miniFatStart = allocate(miniFatSectors);
  const miniStreamStart = allocate(miniStreamSectors);
  const largeStarts = new Map<string, number>();
  for (const s of large) largeStarts.set(s.name, allocate(sectorsFor(s.data.length, SECTOR)));

  const file = new Uint8Array(SECTOR * (1 + total));
  const view = new DataView(file.buffer);
  const sectorOff = (n: number): number => SECTOR * (n + 1);

  // כותרת
  file.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  view.setUint16(0x18, 0x003e, true);
  view.setUint16(0x1a, 0x0003, true);
  view.setUint16(0x1c, 0xfffe, true);
  view.setUint16(0x1e, 9, true);
  view.setUint16(0x20, 6, true);
  view.setUint32(0x2c, fatSectors, true);
  view.setUint32(0x30, dirStart, true);
  view.setUint32(0x38, CUTOFF, true);
  view.setUint32(0x3c, miniFatSectors > 0 ? miniFatStart : END, true);
  view.setUint32(0x40, miniFatSectors, true);
  view.setUint32(0x44, END, true);
  for (let i = 0; i < 109; i += 1) view.setUint32(0x4c + i * 4, i < fatSectors ? i : FREE, true);

  // FAT
  fat.forEach((v, i) =>
    view.setUint32(sectorOff(Math.floor(i / (SECTOR / 4))) + (i % (SECTOR / 4)) * 4, v, true),
  );

  // ספרייה: השורש ואז הזרמים, בעץ בינארי מאוזן מתחת ל-child של השורש
  const ids = streams.map((_, i) => i + 1);
  const left = new Map<number, number>();
  const right = new Map<number, number>();
  const build = (from: number, to: number): number => {
    if (from > to) return NOSTREAM;
    const mid = Math.floor((from + to) / 2);
    left.set(ids[mid]!, build(from, mid - 1));
    right.set(ids[mid]!, build(mid + 1, to));
    return ids[mid]!;
  };
  const rootChild = build(0, ids.length - 1);
  const entry = (
    id: number,
    name: string,
    type: number,
    start: number,
    size: number,
    child: number,
  ): void => {
    const off = sectorOff(dirStart) + id * 128;
    units(name).forEach((u, i) => view.setUint16(off + i * 2, u, true));
    view.setUint16(off + 0x40, (name.length + 1) * 2, true);
    file[off + 0x42] = type;
    file[off + 0x43] = 1; // שחור
    view.setUint32(off + 0x44, left.get(id) ?? NOSTREAM, true);
    view.setUint32(off + 0x48, right.get(id) ?? NOSTREAM, true);
    view.setUint32(off + 0x4c, child, true);
    view.setUint32(off + 0x74, start, true);
    view.setUint32(off + 0x78, size, true);
  };
  entry(
    0,
    'Root Entry',
    5,
    miniBytes.length > 0 ? miniStreamStart : END,
    miniBytes.length,
    rootChild,
  );
  streams.forEach((s, i) => {
    const start =
      s.data.length === 0
        ? END
        : s.data.length < CUTOFF
          ? miniStarts.get(s.name)!
          : largeStarts.get(s.name)!;
    entry(i + 1, s.name, 2, start, s.data.length, NOSTREAM);
  });
  // רשומות ריקות בסוף סקטור הספרייה
  for (let id = streams.length + 1; id < (dirSectors * SECTOR) / 128; id += 1) {
    const off = sectorOff(dirStart) + id * 128;
    view.setUint32(off + 0x44, NOSTREAM, true);
    view.setUint32(off + 0x48, NOSTREAM, true);
    view.setUint32(off + 0x4c, NOSTREAM, true);
  }

  // FAT מיני, זרם המיני, והזרמים הגדולים
  miniFat.forEach((v, i) => view.setUint32(sectorOff(miniFatStart) + i * 4, v, true));
  for (let i = miniFat.length; i < (miniFatSectors * SECTOR) / 4; i += 1) {
    view.setUint32(sectorOff(miniFatStart) + i * 4, FREE, true);
  }
  for (let i = 0; i < miniStreamSectors; i += 1) {
    file.set(miniBytes.subarray(i * SECTOR, (i + 1) * SECTOR), sectorOff(miniStreamStart + i));
  }
  for (const s of large) {
    const start = largeStarts.get(s.name)!;
    for (let i = 0; i * SECTOR < s.data.length; i += 1) {
      file.set(s.data.subarray(i * SECTOR, (i + 1) * SECTOR), sectorOff(start + i));
    }
  }
  return file;
}

/** קובץ ‎.xls‎ שלם: זרם Workbook (או אחר) בתוך מכולה. */
export function buildXls(rows: XlsCell[][], opts: XlsOptions = {}): Uint8Array {
  return buildCfb([
    { name: opts.streamName ?? 'Workbook', data: buildWorkbookStream(rows, opts) },
    ...(opts.extraStreams ?? []),
  ]);
}
