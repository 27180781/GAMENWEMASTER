/**
 * ייבוא אקסל למרשם — כולל קריאת קובץ XLSX אמיתי שנבנה כאן.
 */

import { describe, expect, it } from 'vitest';
import {
  categoryNameFromHeader,
  importSheet,
  normalizeRemoteId,
  parseImportRows,
  summaryText,
} from '../src/app/rosterImport.ts';
import { parseCsv, readSheetRows, columnIndex, splitCsvLine } from '../src/app/xlsxRead.ts';
import { buildXlsxBlob } from '../src/app/xlsx.ts';
import {
  EMPTY_ROSTER,
  captureRemote,
  displayName,
  playerGroupNames,
} from '../src/app/roster.ts';

describe('parseImportRows — השורה הראשונה היא כותרת', () => {
  it('מדלג על שורת הכותרת ולא מייבא אותה כשחקן', () => {
    const rows = [
      ['מספר שלט', 'שם', 'קבוצה'],
      ['101', 'אבי', 'ירושלים'],
      ['102', 'בני', ''],
    ];
    const parsed = parseImportRows(rows, 'full');
    expect(parsed).toHaveLength(2); // ★ הכותרת לא נספרת
    expect(parsed[0]).toEqual({ id: '101', name: 'אבי', group: 'ירושלים' });
    expect(parsed[1]).toEqual({ id: '102', name: 'בני', group: '' });
  });

  it('מצב שמות בלבד — עמודה ראשונה שם, שנייה קבוצה', () => {
    const rows = [
      ['שם', 'מחלקה'],
      ['גל', 'פיתוח'],
      ['דור', ''],
    ];
    const parsed = parseImportRows(rows, 'names');
    expect(parsed).toEqual([
      { id: '', name: 'גל', group: 'פיתוח' },
      { id: '', name: 'דור', group: '' },
    ]);
  });

  it('שורות ריקות נבלעות בשקט', () => {
    const rows = [['שם'], ['', '', ''], ['גל']];
    expect(parseImportRows(rows, 'names')).toHaveLength(1);
  });

  it('שם הקטגוריה נלקח מכותרת עמודת הקבוצה', () => {
    expect(categoryNameFromHeader([['מספר', 'שם', 'עיר']], 'full')).toBe('עיר');
    expect(categoryNameFromHeader([['שם', 'מחלקה']], 'names')).toBe('מחלקה');
    expect(categoryNameFromHeader([['מספר', 'שם']], 'full')).toBe('קבוצות'); // אין כותרת
  });
});

describe('normalizeRemoteId', () => {
  it('מנרמל צורות שאקסל מייצר, כדי שהמספר יתאים ל-voterId מהקליקר', () => {
    expect(normalizeRemoteId('105')).toBe('105');
    expect(normalizeRemoteId('105.0')).toBe('105'); // ★ אקסל מספרי
    expect(normalizeRemoteId(' 105 ')).toBe('105');
    expect(normalizeRemoteId('0105')).toBe('105');
    expect(normalizeRemoteId('')).toBe('');
    expect(normalizeRemoteId('A7')).toBe('A7'); // לא מספר — כמו שהוא
  });
});

describe('importSheet — ייבוא מלא', () => {
  const rows = [
    ['מספר שלט', 'שם', 'עיר'],
    ['101', 'אבי', 'ירושלים'],
    ['102', 'בני', 'חיפה'],
    ['103', 'גל', 'ירושלים'],
    ['', 'בלי מספר', 'חיפה'],
  ];

  it('שם + קבוצה תחת קטגוריה אחת, כמו שמגיע מה-JSON', () => {
    const s = importSheet(EMPTY_ROSTER, rows, 'full');
    expect(s.added).toBe(3);
    expect(s.skipped).toBe(1); // השורה בלי מספר שלט
    expect(s.categoryName).toBe('עיר');
    expect(displayName(s.roster, '102')).toBe('בני');
    const cat = s.roster.categories.find((c) => c.name === 'עיר');
    expect(cat?.groups.map((g) => g.name)).toEqual(['ירושלים', 'חיפה']);
    expect(playerGroupNames(s.roster, '103')).toEqual(['ירושלים']);
  });

  it('ייבוא חוזר אינו מכפיל שחקנים או קבוצות', () => {
    const once = importSheet(EMPTY_ROSTER, rows, 'full');
    const twice = importSheet(once.roster, rows, 'full');
    expect(twice.roster.players).toHaveLength(3);
    expect(twice.roster.categories).toHaveLength(1);
    expect(twice.roster.categories[0]?.groups).toHaveLength(2);
    expect(twice.added).toBe(0);
  });
});

describe('importSheet — השלמת שמות לקליטה חכמה', () => {
  it('שמות מתקבצים לשלטים שכבר נלחצו, והעודף ממתין', () => {
    let r = EMPTY_ROSTER;
    for (const id of ['501', '502']) r = captureRemote(r, id).roster;

    const s = importSheet(
      r,
      [
        ['שם', 'מחלקה'],
        ['רון', 'פיתוח'],
        ['שיר', 'עיצוב'],
        ['תום', 'פיתוח'],
      ],
      'names',
    );
    expect(s.updated).toBe(2); // ★ שני השלטים שהמתינו קיבלו שם
    expect(s.waiting).toBe(1); // ★ ותום ממתין ללחיצה
    expect(displayName(s.roster, '501')).toBe('רון');
    expect(playerGroupNames(s.roster, '502')).toEqual(['עיצוב']);

    // הלחיצה הבאה תופסת את תום — כולל הקבוצה שלו
    const next = captureRemote(s.roster, '503', s.categoryName);
    expect(next.name).toBe('תום');
    expect(playerGroupNames(next.roster, '503')).toEqual(['פיתוח']);
  });

  it('בלי שלטים שממתינים — כל השמות נשארים בתור', () => {
    const s = importSheet(EMPTY_ROSTER, [['שם'], ['א'], ['ב']], 'names');
    expect(s.updated).toBe(0);
    expect(s.waiting).toBe(2);
    expect(s.roster.players).toEqual([]);
  });
});

describe('summaryText', () => {
  it('מסכם בעברית מה קרה', () => {
    const s = importSheet(
      EMPTY_ROSTER,
      [
        ['מספר', 'שם', 'עיר'],
        ['1', 'א', 'ת״א'],
      ],
      'full',
    );
    expect(summaryText(s, 'full')).toContain('1 שלטים נוספו');
    expect(summaryText(s, 'full')).toContain('שויכו ל"עיר"'); // שם הקטגוריה מהכותרת
  });
});

describe('קריאת קבצים', () => {
  it('CSV — כולל שדות במרכאות ומפריד טאב', () => {
    expect(splitCsvLine('a,"b,c",d', ',')).toEqual(['a', 'b,c', 'd']);
    expect(splitCsvLine('a,"he said ""hi""",c', ',')).toEqual(['a', 'he said "hi"', 'c']);
    expect(parseCsv('שם\tקבוצה\nגל\tפיתוח')).toEqual([
      ['שם', 'קבוצה'],
      ['גל', 'פיתוח'],
    ]);
  });

  it('columnIndex', () => {
    expect(columnIndex('A1')).toBe(0);
    expect(columnIndex('C7')).toBe(2);
    expect(columnIndex('AA1')).toBe(26);
  });

  it('XLSX אמיתי — נקרא חזרה לאותן שורות', async () => {
    const blob = await buildXlsxBlob([
      {
        name: 'משתתפים',
        rows: [
          ['מספר שלט', 'שם', 'עיר'],
          [101, 'אבי כהן', 'ירושלים'],
          [102, 'בני & לוי', 'חיפה'],
          [103, 'גל', null], // תא ריק — לא מזיז עמודות
        ],
      },
    ]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const rows = await readSheetRows(bytes);
    expect(rows[0]).toEqual(['מספר שלט', 'שם', 'עיר']);
    expect(rows[1]).toEqual(['101', 'אבי כהן', 'ירושלים']);
    expect(rows[2]?.[1]).toBe('בני & לוי'); // ★ ישות XML פוענחה
    expect(rows[3]?.[0]).toBe('103');

    const s = importSheet(EMPTY_ROSTER, rows, 'full');
    expect(s.added).toBe(3);
    expect(displayName(s.roster, '101')).toBe('אבי כהן');
    expect(playerGroupNames(s.roster, '103')).toEqual([]); // בלי קבוצה
  });
});
