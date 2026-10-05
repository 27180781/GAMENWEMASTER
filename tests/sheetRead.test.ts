/**
 * קריאת גיליונות: ‎.xls‎ (BIFF8), XLSX ו-CSV — מה שחלון «יבוא מאקסל» בעורך
 * המקומי מקבל, כמו המערכת המקוונת (SheetJS שם).
 *
 * ה-XLS נבדק בשתי דרכים: קבצים אמיתיים קטנים (נכתבו ב-xlwt — כמו אקסל, בזרם
 * רגיל — וב-SheetJS, בזרם המיני), שהקורא כאן הושווה מולם תא-תא ל-SheetJS
 * ול-xlrd; וקבצים שנבנים בבדיקה (xlsWriter.ts) למקרים העדינים של הפורמט.
 */

import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  decodeText,
  MARKUP_FILE_MESSAGE,
  parseCsvRecords,
  readSheet,
} from '../src/app/xlsxRead.ts';
import { OLD_EXCEL_MESSAGE, PROTECTED_FILE_MESSAGE, SheetFileError } from '../src/app/xlsRead.ts';
import { buildCfb, buildXls, buildWorkbookStream, type XlsCell } from './xlsWriter.ts';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../fixtures/excel/${name}`, import.meta.url)));

const cellsOf = async (bytes: Uint8Array): Promise<string[][]> =>
  (await readSheet(bytes)).map((r) => r.cells);

/** הבייטים של מחרוזת בקידוד חלונות-1255 (עברית של אקסל ישן). */
function cp1255(text: string): Uint8Array {
  return Uint8Array.from(
    [...text].map((ch) => {
      const c = ch.charCodeAt(0);
      if (c >= 0x05d0 && c <= 0x05ea) return c - 0x05d0 + 0xe0; // א..ת
      if (c < 0x80) return c;
      throw new Error(`תו לא נתמך בבדיקה: ${ch}`);
    }),
  );
}

async function expectSheetError(bytes: Uint8Array, message: string): Promise<void> {
  const err = await readSheet(bytes).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(SheetFileError);
  expect((err as Error).message).toBe(message);
}

describe('‎.xls‎ — קבצים אמיתיים', () => {
  it('xlwt (זרם בסקטורים רגילים): עברית, מספרים, ערך אמת ותאים ריקים באמצע', async () => {
    expect(await cellsOf(fixture('xlwt-template.xls'))).toEqual([
      [
        'סוג שאלה',
        'טקסט השאלה',
        'תשובה 1',
        'תשובה 2',
        'תשובה 3',
        'תשובה 4',
        'תשובה 5',
        'תשובה 6',
        'תשובה נכונה',
      ],
      ['טריוויה', 'מהי בירת ישראל?', 'תל אביב', 'ירושלים', 'חיפה', 'באר שבע', '', '', '2'],
      ['טריוויה', 'כמה ימים יש בשנה מעוברת?', '365', '366', '3.14', '-12', '', '', '2'],
      ['סקר', 'English and עברית mixed ✓', 'a', 'b'],
      ['TRUE', '', '', 'x'],
    ]);
  });

  it('SheetJS (זרם קטן — בתוך זרם המיני של המכולה)', async () => {
    expect(await cellsOf(fixture('sheetjs-template.xls'))).toEqual([
      ['סוג שאלה', 'טקסט השאלה', 'תשובה 1', 'תשובה 2', 'תשובה נכונה'],
      ['טריוויה', 'מהי בירת ישראל?', 'תל אביב', 'ירושלים', '2'],
      ['סקר', 'שאלה ב', '3.14', '', ''],
    ]);
  });

  it('Excel 95 (BIFF5) — הודעה ברורה במקום ג׳יבריש', async () => {
    await expectSheetError(fixture('sheetjs-excel95.xls'), OLD_EXCEL_MESSAGE);
  });
});

describe('‎.xls‎ — מבנה הקובץ', () => {
  const rows: XlsCell[][] = [
    ['שאלה', 'תשובה 1', 'תשובה 2'],
    ['מה?', 'כן', 'לא'],
  ];

  it('זרם קטן (זרם המיני) וזרם מרופד ל-4096 (סקטורים רגילים) נקראים אותו דבר', async () => {
    const expected = [
      ['שאלה', 'תשובה 1', 'תשובה 2'],
      ['מה?', 'כן', 'לא'],
    ];
    expect(buildWorkbookStream(rows).length).toBeLessThan(4096);
    expect(await cellsOf(buildXls(rows))).toEqual(expected);
    expect(await cellsOf(buildXls(rows, { padTo: 4096 }))).toEqual(expected);
  });

  it('גיליון גדול — הרבה סקטורים ושרשרת FAT ארוכה', async () => {
    const big: XlsCell[][] = [['מספר', 'טקסט']];
    for (let i = 1; i <= 1500; i += 1) big.push([i, `שורה ${i}`]);
    const bytes = buildXls(big);
    expect(bytes.length).toBeGreaterThan(40_000);
    const read = await readSheet(bytes);
    expect(read).toHaveLength(1501);
    expect(read[1500]).toEqual({ row: 1501, cells: ['1500', 'שורה 1500'] });
  });

  it('הגיליון הראשון שהוא גיליון עבודה — לא גיליון גרף שלפניו', async () => {
    expect(await cellsOf(buildXls(rows, { chartFirst: true }))).toEqual([
      ['שאלה', 'תשובה 1', 'תשובה 2'],
      ['מה?', 'כן', 'לא'],
    ]);
  });

  it('מספרי השורות הם של אקסל, ושורה ריקה באמצע נשמרת כפער', async () => {
    const read = await readSheet(buildXls([['א', 'ב'], [], [null, 'ג']]));
    expect(read).toEqual([
      { row: 1, cells: ['א', 'ב'] },
      { row: 3, cells: ['', 'ג'] },
    ]);
  });
});

describe('‎.xls‎ — טבלת המחרוזות (SST) ורשומות CONTINUE', () => {
  const long = 'abcdefghijklmnopqrstuvwxyz'.repeat(4); // 104 תווים
  const hebrew = 'שאלה ארוכה מאוד בעברית שנחתכת בין רשומות';
  const strings = [long, hebrew, 'קצר', 'emoji 🎉 בסוף', '', 'עוד אחת'];
  const rows: XlsCell[][] = [strings];

  it('מחרוזות שנחתכות בין רשומות — כולל אמוג׳י שנחצה באמצע', async () => {
    for (const limit of [16, 23, 31, 64, 8224]) {
      const bytes = buildXls(rows, { sstRecordLimit: limit });
      expect(await cellsOf(bytes), `limit=${limit}`).toEqual([strings]);
    }
  });

  it('ההמשך של מחרוזת בבית אחד יכול להגיע בשני בתים (בית הדגל בכל רשומה)', async () => {
    const bytes = buildXls(rows, { sstRecordLimit: 20, wideContinuation: true });
    expect(await cellsOf(bytes)).toEqual([strings]);
  });

  it('עיצוב לפי תווים (rich text) והרחבת הגייה — מדלגים עליהם גם כשהם חוצים רשומה', async () => {
    for (const limit of [13, 17, 25, 8224]) {
      const bytes = buildXls(rows, {
        sstRecordLimit: limit,
        richStrings: [long, 'קצר'],
        extStrings: [hebrew, 'קצר'],
      });
      expect(await cellsOf(bytes), `limit=${limit}`).toEqual([strings]);
    }
  });
});

describe('‎.xls‎ — סוגי תאים', () => {
  it('LABEL, NUMBER, RK, MULRK, ערך אמת, שגיאה ונוסחאות (הערך השמור)', async () => {
    const read = await cellsOf(
      buildXls([
        [
          { kind: 'label', text: 'תווית ישנה' },
          3.5,
          { kind: 'rk', value: 42 },
          { kind: 'rk', value: -7 },
        ],
        [
          { kind: 'rk', value: 3.14 },
          { kind: 'rk', value: 0.5 },
          { kind: 'rk', value: 1234567.5 },
        ],
        [{ kind: 'mulrk', values: [1, 2.5, 3.75, -100] }],
        [
          { kind: 'bool', value: true },
          { kind: 'bool', value: false },
          { kind: 'error', code: 0x2a },
        ],
        [
          { kind: 'formulaString', text: 'תוצאה' },
          { kind: 'formulaNumber', value: 0.1 + 0.2 },
          { kind: 'formulaBool', value: false },
          { kind: 'formulaString', text: 'אחרי SHRFMLA', shared: true },
        ],
      ]),
    );
    expect(read).toEqual([
      ['תווית ישנה', '3.5', '42', '-7'],
      ['3.14', '0.5', '1234567.5'],
      ['1', '2.5', '3.75', '-100'],
      ['TRUE', 'FALSE', '#N/A'],
      ['תוצאה', String(0.1 + 0.2), 'FALSE', 'אחרי SHRFMLA'],
    ]);
  });
});

describe('‎.xls‎ — קבצים שלא נתמכים', () => {
  it('מוגן בסיסמה (FILEPASS)', async () => {
    await expectSheetError(buildXls([['א']], { filePass: true }), PROTECTED_FILE_MESSAGE);
  });

  it('‎.xlsx‎ מוצפן — מכולת OLE עם EncryptedPackage', async () => {
    const blob = new Uint8Array(5000).fill(7);
    await expectSheetError(
      buildCfb([
        { name: 'EncryptionInfo', data: new Uint8Array(200).fill(1) },
        { name: 'EncryptedPackage', data: blob },
      ]),
      PROTECTED_FILE_MESSAGE,
    );
  });

  it('Excel 95: זרם "Book", או BOF של BIFF5 בתוך "Workbook"', async () => {
    await expectSheetError(buildXls([['א']], { streamName: 'Book' }), OLD_EXCEL_MESSAGE);
    await expectSheetError(buildXls([['א']], { biffVersion: 0x0500 }), OLD_EXCEL_MESSAGE);
  });

  it('קובץ פגום — שגיאה של קובץ, לא קריסה', async () => {
    const bytes = buildXls([['א', 'ב']]);
    const broken = bytes.slice(0, 700); // הספרייה ונתוני הזרם נחתכו
    await expect(readSheet(broken)).rejects.toBeInstanceOf(SheetFileError);
  });
});

/** XLSX עם גיליון שנכתב ידנית — כדי לבדוק XML כמו שתוכנות אחרות כותבות. */
async function xlsxWith(sheetXml: string, shared: string[] = []): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    'xl/workbook.xml',
    '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="a" sheetId="1" r:id="rId1"/></sheets></workbook>',
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  );
  zip.file('xl/worksheets/sheet1.xml', `<worksheet><sheetData>${sheetXml}</sheetData></worksheet>`);
  if (shared.length > 0) {
    zip.file(
      'xl/sharedStrings.xml',
      `<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`,
    );
  }
  return zip.generateAsync({ type: 'uint8array' });
}

describe('XLSX', () => {
  it('★ תא ושורה ריקים שנכתבים כתג סוגר-עצמו אינם מזיזים את התא הבא', async () => {
    // ‎<c r="B1" s="3"/>‎ — תא עם עיצוב ובלי ערך. הקריאה הישנה "בלעה" את C1 לתוכו.
    const bytes = await xlsxWith(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" s="3"/><c r="C1" t="s"><v>1</v></c></row>' +
        '<row r="2" spans="1:3"/>' +
        '<row r="3"><c r="C3" t="inlineStr"/><c r="D3" t="inlineStr"><is><t>ד</t></is></c></row>',
      ['שאלה', 'תשובה 1'],
    );
    expect(await readSheet(bytes)).toEqual([
      { row: 1, cells: ['שאלה', '', 'תשובה 1'] },
      { row: 3, cells: ['', '', '', 'ד'] },
    ]);
  });

  it('מספרים כמו שהם מוצגים, ערכי אמת, וטבלה שלא מתחילה ב-A1', async () => {
    const bytes = await xlsxWith(
      '<row r="4"><c r="B4"><v>3.1400000000000001</v></c><c r="C4" t="n"><v>2</v></c>' +
        '<c r="D4" t="b"><v>1</v></c><c r="E4" t="b"><v>0</v></c><c r="F4" t="str"><v>טקסט נוסחה</v></c></row>',
    );
    expect(await readSheet(bytes)).toEqual([
      { row: 4, cells: ['', '3.14', '2', 'TRUE', 'FALSE', 'טקסט נוסחה'] },
    ]);
  });

  it('שורה עם עיצוב ובלי ערכים לפני הכותרת אינה "השורה הראשונה"', async () => {
    const bytes = await xlsxWith(
      '<row r="1"><c r="A1" s="2"/><c r="B1" s="2"/></row><row r="2"><c r="A2" t="inlineStr"><is><t>כותרת</t></is></c></row>',
    );
    expect(await readSheet(bytes)).toEqual([{ row: 2, cells: ['כותרת'] }]);
  });
});

describe('CSV', () => {
  const header = 'סוג שאלה,טקסט השאלה,תשובה 1,תשובה 2';
  const line = 'טריוויה,מה בירת ישראל?,ירושלים,תל אביב';

  it('UTF-8 עם BOM ובלי, UTF-16 של "טקסט Unicode", וחלונות-1255 של אקסל בעברית', async () => {
    const text = `${header}\r\n${line}\r\n`;
    const expected = [header.split(','), line.split(',')];
    const utf8 = new TextEncoder().encode(text);
    expect(await cellsOf(Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8]))).toEqual(expected);
    expect(await cellsOf(utf8)).toEqual(expected);
    expect(await cellsOf(cp1255(text))).toEqual(expected);
    const utf16 = [
      0xff,
      0xfe,
      ...[...text].flatMap((ch) => [ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8]),
    ];
    expect(await cellsOf(Uint8Array.from(utf16))).toEqual(expected);
  });

  it('decodeText — עברית שאינה UTF-8 אינה הופכת לסימני שאלה', () => {
    expect(decodeText(cp1255('שלום'))).toBe('שלום');
  });

  it('מפריד: טאב, נקודה-פסיק, ושורת sep= של אקסל', () => {
    expect(parseCsvRecords('א\tב\tג\n1\t2\t3').map((r) => r.cells)).toEqual([
      ['א', 'ב', 'ג'],
      ['1', '2', '3'],
    ]);
    expect(parseCsvRecords('א;ב;ג\n1,5;2;3').map((r) => r.cells)).toEqual([
      ['א', 'ב', 'ג'],
      ['1,5', '2', '3'],
    ]);
    expect(parseCsvRecords('sep=;\nא,ב;ג').map((r) => r.cells)).toEqual([['א,ב', 'ג']]);
  });

  it('שדה במרכאות עם פסיק, מרכאות כפולות ושורה חדשה (Alt+Enter באקסל)', () => {
    const records = parseCsvRecords('שאלה,תשובה\n"שורה ראשונה\nשורה שנייה","א, ""ב"""\nאחרונה,ג');
    // התא בשתי שורות הוא עדיין שורה אחת באקסל — ולכן "אחרונה" בשורה 3
    expect(records).toEqual([
      { row: 1, cells: ['שאלה', 'תשובה'] },
      { row: 2, cells: ['שורה ראשונה\nשורה שנייה', 'א, "ב"'] },
      { row: 3, cells: ['אחרונה', 'ג'] },
    ]);
  });

  it('שורות ריקות לא חוזרות, אבל נספרות — "שורה 4" היא השורה הרביעית באקסל', () => {
    expect(parseCsvRecords('א\n\n  \nב\n')).toEqual([
      { row: 1, cells: ['א'] },
      { row: 4, cells: ['ב'] },
    ]);
  });

  it('דף אינטרנט או XML עם סיומת של אקסל — הודעה ברורה', async () => {
    const html = new TextEncoder().encode(
      '<html><body><table><tr><td>שאלה</td></tr></table></body></html>',
    );
    await expectSheetError(html, MARKUP_FILE_MESSAGE);
    const xml = new TextEncoder().encode(
      '<?xml version="1.0"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"/>',
    );
    await expectSheetError(xml, MARKUP_FILE_MESSAGE);
  });
});
