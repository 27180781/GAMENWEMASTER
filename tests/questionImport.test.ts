/**
 * יבוא שאלות מאקסל בעורך המקומי (questionImport.ts) — אותם כללים כמו חלון
 * «יבוא מאקסל» של מערכת יצירת המשחקים, כדי שאותו קובץ ייתן את אותן שאלות
 * בשני המקומות. כל בדיקה כאן היא כלל מ-processFile שם.
 */

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  IMPORT_SCORE,
  IMPORT_TEXT,
  IMPORT_TIME,
  importedSlide,
  insertImportedQuestions,
  isSupportedImportName,
  parseQuestionRows,
  TEMPLATE_COL_WIDTHS,
  TEMPLATE_FILE_NAME,
  TEMPLATE_ROWS,
  TEMPLATE_SHEET_NAME,
  type ImportedQuestion,
} from '../src/app/questionImport.ts';
import { buildXlsxBlob } from '../src/app/xlsx.ts';
import { readSheet, type SheetRow } from '../src/app/xlsxRead.ts';
import { parseGameFile } from '../src/engine/index.ts';
import { fourAnswers, makeGame, rawSlide } from './helpers.ts';
import { buildXls } from './xlsWriter.ts';

const HEADER = [
  'סוג שאלה',
  'טקסט השאלה',
  'תשובה 1',
  'תשובה 2',
  'תשובה 3',
  'תשובה 4',
  'תשובה נכונה',
];

/** שורות ממוספרות מ-1, בלי השורות הריקות — כמו ש-readSheet מחזיר. */
function sheet(rows: string[][]): SheetRow[] {
  return rows
    .map((cells, i) => ({ row: i + 1, cells }))
    .filter((r) => r.cells.some((c) => c.trim() !== ''));
}

const parse = (rows: string[][]) => parseQuestionRows(sheet(rows));
const messages = (rows: string[][]) => parse(rows).issues.map((i) => `${i.row}: ${i.message}`);

describe('התבנית — זהה לזו של מערכת יצירת המשחקים', () => {
  it('נבנית כ-XLSX ונקראת חזרה לשלוש השאלות לדוגמה, בלי אזהרות', async () => {
    const blob = await buildXlsxBlob([
      { name: TEMPLATE_SHEET_NAME, rows: TEMPLATE_ROWS, cols: TEMPLATE_COL_WIDTHS },
    ]);
    const result = parseQuestionRows(await readSheet(new Uint8Array(await blob.arrayBuffer())));
    expect(result.error).toBeNull();
    expect(result.issues).toEqual([]);
    expect(result.notices).toEqual([]);
    expect(result.questions).toEqual([
      {
        row: 2,
        question: 'מהי בירת ישראל?',
        type: 'trivia',
        answers: ['תל אביב', 'ירושלים', 'חיפה', 'באר שבע'],
        correctIndex: 1,
      },
      {
        row: 3,
        question: 'כמה ימים יש בשנה מעוברת?',
        type: 'trivia',
        answers: ['365', '366', '364', '367'],
        correctIndex: 1,
      },
      {
        row: 4,
        question: 'מה המשקה האהוב עליכם?',
        type: 'survey',
        answers: ['קפה', 'תה', 'מיץ', 'מים'],
        correctIndex: 0,
      },
    ]);
  });

  it('שם הקובץ, שם הגיליון, רוחב העמודות וכיוון RTL', async () => {
    expect(TEMPLATE_FILE_NAME).toBe('תבנית_יבוא_שאלות.xlsx');
    const blob = await buildXlsxBlob([
      { name: TEMPLATE_SHEET_NAME, rows: TEMPLATE_ROWS, cols: TEMPLATE_COL_WIDTHS },
    ]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(await zip.file('xl/workbook.xml')!.async('string')).toContain('name="שאלות"');
    const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(xml).toContain('rightToLeft="1"');
    expect(xml.match(/<col /g)).toHaveLength(9);
    expect(xml).toMatch(/<col min="2" max="2" width="35\.\d+" customWidth="1"\/>/);
    // <cols> חייב לבוא לפני <sheetData>, אחרת אקסל מסרב לפתוח
    expect(xml.indexOf('<cols>')).toBeLessThan(xml.indexOf('<sheetData>'));
  });

  it('אותה תבנית שנשמרה כ-‎.xls‎ (Excel 97–2003) מתפרקת לאותן שאלות', async () => {
    const rows = TEMPLATE_ROWS.map((r) => r.map((c) => (c === '' ? null : String(c ?? ''))));
    const fromXls = parseQuestionRows(await readSheet(buildXls(rows)));
    const blob = await buildXlsxBlob([{ name: TEMPLATE_SHEET_NAME, rows: TEMPLATE_ROWS }]);
    const fromXlsx = parseQuestionRows(await readSheet(new Uint8Array(await blob.arrayBuffer())));
    expect(fromXls).toEqual(fromXlsx);
  });

  it('הסיומות שמתקבלות — כמו בבונה', () => {
    expect(isSupportedImportName('שאלות.XLSX')).toBe(true);
    expect(isSupportedImportName('a.xls')).toBe(true);
    expect(isSupportedImportName('a.csv')).toBe(true);
    expect(isSupportedImportName('a.txt')).toBe(false);
    expect(isSupportedImportName('a.ods')).toBe(false);
  });
});

describe('זיהוי הכותרת והעמודות', () => {
  it('שורת כותרת שאינה הראשונה — מזוהה בחמש השורות הראשונות, עם הודעה', () => {
    const result = parse([['חידון חנוכה'], [], HEADER, ['טריוויה', 'מה?', 'א', 'ב', '', '', '1']]);
    expect(result.notices).toContainEqual({ level: 'info', message: IMPORT_TEXT.autoHeaderRow });
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]!.row).toBe(4); // מספר השורה האמיתי באקסל
  });

  it('כותרת אחרי חמש השורות הראשונות אינה נמצאת', () => {
    const rows = [
      ['א'],
      ['ב'],
      ['ג'],
      ['ד'],
      ['ה'],
      HEADER,
      ['טריוויה', 'מה?', 'א', 'ב', '', '', '1'],
    ];
    expect(parse(rows).error).toBe(IMPORT_TEXT.missingColumn);
  });

  it('העמודות לפי שם ולא לפי מיקום, ו"טקסט השאלה" גובר על "סוג שאלה"', () => {
    const result = parse([
      ['הערות', 'תשובה נכונה', 'תשובה 2', 'תשובה 1', 'טקסט השאלה', 'סוג שאלה'],
      ['לא חשוב', '1', 'שתיים', 'אחת', 'כמה?', 'טריוויה'],
    ]);
    expect(result.questions).toEqual([
      { row: 2, question: 'כמה?', type: 'trivia', answers: ['אחת', 'שתיים'], correctIndex: 0 },
    ]);
  });

  it('כותרות באנגלית ובלי גרשיים', () => {
    const result = parse([
      ['Type', 'Question', 'Answer 1', 'Answer 2', 'Correct'],
      ['Poll', 'Favourite?', 'Tea', 'Coffee', ''],
      ['trivia', 'Capital?', 'Paris', 'Rome', '2'],
    ]);
    expect(result.questions.map((q) => [q.type, q.correctIndex])).toEqual([
      ['survey', 0],
      ['trivia', 1],
    ]);
  });

  it('רק עמודת "סוג שאלה" מכילה "שאלה" — היא נבחרת כעמודת השאלה, כמו בבונה', () => {
    const result = parse([
      ['סוג שאלה', 'תשובה 1', 'תשובה 2'],
      ['מה?', 'א', 'ב'],
    ]);
    expect(result.questions[0]?.question).toBe('מה?');
  });

  it('בלי עמודת שאלה / בלי עמודות תשובה / בלי שורות נתונים', () => {
    expect(
      parse([
        ['סוג', 'תשובה 1', 'תשובה 2'],
        ['טריוויה', 'א', 'ב'],
      ]).error,
    ).toBe(IMPORT_TEXT.missingColumn);
    expect(
      parse([
        ['שאלה', 'תשובה נכונה'],
        ['מה?', '1'],
      ]).error,
    ).toBe(IMPORT_TEXT.missingAnswers);
    expect(parse([HEADER]).error).toBe(IMPORT_TEXT.missingData);
    expect(parseQuestionRows([]).error).toBe(IMPORT_TEXT.missingData);
  });

  it('שגיאה בעמודות אינה מציגה את הודעות הקובץ — כמו בבונה', () => {
    expect(parse([['כותרת'], ['שאלה', 'אין תשובות']]).notices).toEqual([]);
  });

  it('בלי עמודת סוג — הכול טריוויה; בלי עמודת נכונה — תשובה 1, עם אזהרה בכל שורה', () => {
    const result = parse([
      ['שאלה', 'תשובה 1', 'תשובה 2'],
      ['מה?', 'א', 'ב'],
    ]);
    expect(result.notices).toEqual([
      { level: 'info', message: IMPORT_TEXT.noTypeCol },
      { level: 'warning', message: IMPORT_TEXT.noCorrectCol },
    ]);
    expect(result.questions[0]).toMatchObject({ type: 'trivia', correctIndex: 0 });
    expect(result.issues).toEqual([
      { row: 2, level: 'warning', message: IMPORT_TEXT.rowNoCorrect, preview: 'מה?' },
    ]);
  });

  it('עמודת תשובה אחת בלבד — אזהרה, וכל השורות דולגות', () => {
    const result = parse([
      ['שאלה', 'תשובה 1', 'תשובה נכונה'],
      ['מה?', 'א', '1'],
    ]);
    expect(result.notices).toContainEqual({ level: 'warning', message: IMPORT_TEXT.fewAnswerCols });
    expect(result.skipped).toBe(1);
    expect(result.error).toBe(IMPORT_TEXT.noValidQuestions);
  });
});

describe('כללי השורה', () => {
  it('סוג השאלה: סקר / poll / survey / טריוויה / trivia, ריק או לא מוכר → טריוויה עם אזהרה', () => {
    const result = parse([
      HEADER,
      ['סקר', 'ש1', 'א', 'ב', '', '', ''],
      ['POLL', 'ש2', 'א', 'ב', '', '', ''],
      ['Survey', 'ש3', 'א', 'ב', '', '', ''],
      ['טריוויה', 'ש4', 'א', 'ב', '', '', '2'],
      ['', 'ש5', 'א', 'ב', '', '', '2'],
      ['בחירה מרובה', 'ש6', 'א', 'ב', '', '', '2'],
    ]);
    expect(result.questions.map((q) => q.type)).toEqual([
      'survey',
      'survey',
      'survey',
      'trivia',
      'trivia',
      'trivia',
    ]);
    expect(result.issues.map((i) => i.message)).toEqual([
      IMPORT_TEXT.rowEmptyType,
      IMPORT_TEXT.rowUnknownType('בחירה מרובה'),
    ]);
  });

  it('"סקר" בעמודת התשובה הנכונה הופך את השאלה לסקר', () => {
    const result = parse([
      HEADER,
      ['טריוויה', 'מה?', 'א', 'ב', '', '', 'סקר'],
      ['סקר', 'ועוד?', 'א', 'ב', '', '', 'poll'],
    ]);
    expect(result.questions.map((q) => q.type)).toEqual(['survey', 'survey']);
    // אזהרה רק כשזה שינה משהו
    expect(result.issues.map((i) => `${i.row}: ${i.message}`)).toEqual([
      `2: ${IMPORT_TEXT.rowCorrectIsPoll}`,
    ]);
  });

  it('תשובות ריקות נזרקות; פחות משתיים — השורה מדלגת עם שגיאה', () => {
    const result = parse([
      HEADER,
      ['טריוויה', 'מה?', 'א', '', '', '', '1'],
      ['טריוויה', 'ועוד?', '', 'ב', '', 'ד', '1'],
    ]);
    expect(result.questions).toEqual([
      { row: 3, question: 'ועוד?', type: 'trivia', answers: ['ב', 'ד'], correctIndex: 0 },
    ]);
    expect(result.skipped).toBe(1);
    expect(result.issues[0]).toEqual({
      row: 2,
      level: 'error',
      message: IMPORT_TEXT.rowNotEnoughAnswers,
      preview: 'מה?',
    });
  });

  it('תשובה נכונה: מספר 1..N (כולל "2.0" ו-" 3 "), אחרת תשובה 1 עם אזהרה', () => {
    const row = (correct: string) => ['טריוויה', 'מה?', 'א', 'ב', 'ג', '', correct];
    const result = parse([
      HEADER,
      row('2'),
      row('2.0'),
      row(' 3 '),
      row('3 (ג)'),
      row('0'),
      row('4'),
      row('ב'),
      row(''),
    ]);
    expect(result.questions.map((q) => q.correctIndex)).toEqual([1, 1, 2, 2, 0, 0, 0, 0]);
    expect(result.issues.map((i) => `${i.row}: ${i.message}`)).toEqual([
      `6: ${IMPORT_TEXT.rowInvalidCorrect('0')}`,
      `7: ${IMPORT_TEXT.rowInvalidCorrect('4')}`,
      `8: ${IMPORT_TEXT.rowInvalidCorrect('ב')}`,
      `9: ${IMPORT_TEXT.rowNoCorrect}`,
    ]);
  });

  it('★ תשובה ריקה באמצע: המספר נספר בלי הריקות (כמו בבונה), עם אזהרה שאומרת מה סומן', () => {
    const result = parse([HEADER, ['טריוויה', 'מה?', 'א', '', 'ג', 'ד', '3']]);
    expect(result.questions[0]).toMatchObject({ answers: ['א', 'ג', 'ד'], correctIndex: 2 });
    expect(result.issues.map((i) => i.message)).toEqual([IMPORT_TEXT.rowAnswerGap('ד')]);
    // תא ריק *אחרי* התשובה הנכונה לא מזיז כלום — ואין אזהרה
    expect(messages([HEADER, ['טריוויה', 'מה?', 'א', 'ב', '', 'ד', '2']])).toEqual([]);
  });

  it('בסקר עמודת התשובה הנכונה לא נבדקת', () => {
    const result = parse([HEADER, ['סקר', 'מה?', 'א', 'ב', '', '', 'לא מספר']]);
    expect(result.issues).toEqual([]);
    expect(result.questions[0]?.correctIndex).toBe(0);
  });

  it('שאלה בלי נוסח — דולגת, והתצוגה מראה את שאר השורה', () => {
    const result = parse([HEADER, ['טריוויה', '', 'אחת', 'שתיים', '', '', '1']]);
    expect(result.issues).toEqual([
      {
        row: 2,
        level: 'error',
        message: IMPORT_TEXT.rowMissingQuestion,
        preview: 'טריוויה | אחת | שתיים | 1',
      },
    ]);
    expect(result.error).toBe(IMPORT_TEXT.noValidQuestions);
  });

  it('נוסח ארוך מ-500 תווים נחתך, עם אזהרה; התצוגה המקדימה 40 תווים', () => {
    const long = 'א'.repeat(520);
    const result = parse([HEADER, ['טריוויה', long, 'א', 'ב', '', '', '1']]);
    expect(result.questions[0]!.question).toHaveLength(500);
    expect(result.issues).toEqual([
      { row: 2, level: 'warning', message: IMPORT_TEXT.rowTooLong, preview: 'א'.repeat(40) },
    ]);
  });

  it('חיתוך ב-500 אינו קורע אמוג׳י לשניים', () => {
    const text = `${'א'.repeat(499)}🎉 ועוד`;
    const question = parse([HEADER, ['טריוויה', text, 'א', 'ב', '', '', '1']]).questions[0]!
      .question;
    expect(question).toBe('א'.repeat(499));
  });

  it('רווחים בקצוות התאים נחתכים, ושורת רווחים בלבד אינה נחשבת', () => {
    const result = parseQuestionRows([
      { row: 1, cells: HEADER },
      { row: 2, cells: ['  טריוויה ', '  מה?  ', ' א ', 'ב  ', '', '', ' 2 '] },
    ]);
    expect(result.questions[0]).toEqual({
      row: 2,
      question: 'מה?',
      type: 'trivia',
      answers: ['א', 'ב'],
      correctIndex: 1,
    });
  });
});

describe('השקופיות שנוצרות', () => {
  const trivia: ImportedQuestion = {
    row: 2,
    question: 'מה?',
    type: 'trivia',
    answers: ['א', 'ב', 'ג'],
    correctIndex: 2,
  };
  const survey: ImportedQuestion = {
    row: 3,
    question: 'איזה?',
    type: 'survey',
    answers: ['כן', 'לא'],
    correctIndex: 0,
  };

  it('כמו שהבונה מייצא שאלה שיובאה: 15 שניות, 7 נקודות, בלי מדיה, בלי הגדרות מיוחדות', () => {
    const slide = importedSlide(trivia, 9);
    expect(IMPORT_TIME).toBe(15);
    expect(IMPORT_SCORE).toBe(7);
    expect(slide).toMatchObject({
      id: 9,
      type: 'trivia',
      question: { que: 'מה?', queMode: 'text', scoreForQue: 7, timeForQue: 15, src: '' },
      openMedia: { src: '' },
      endMedia: { src: '' },
      backgroundMedia: { src: '' }, // ריק = רקע השאלות של המשחק
    });
    expect(slide.question.answers).toEqual([
      { ans: 'א', correct: false, id: 1 },
      { ans: 'ב', correct: false, id: 2 },
      { ans: 'ג', correct: true, id: 3 },
    ]);
    expect(slide.setting).toMatchObject({
      allowChangeVote: false,
      firstClicker: false,
      majorityDecides: false,
      liveVoteCounts: false,
      scoringReduction: { active: false },
      descendingScore: { active: false, maxScore: 1000 },
      imageReveal: { active: false, blur: 48 },
      automaticSkip: { active: false },
      groupRestriction: { active: false, groupName: '' },
    });
    expect(slide.narration).toBeUndefined();
  });

  it('סקר — בלי תשובה נכונה', () => {
    const slide = importedSlide(survey, 1);
    expect(slide.type).toBe('survey');
    expect(slide.question.answers.every((a) => !a.correct)).toBe(true);
  });

  const base = () =>
    makeGame([
      rawSlide({ id: 4, type: 'trivia', que: 'ראשונה', answers: fourAnswers(1), scoreForQue: 3 }),
      rawSlide({ id: 7, type: 'trivia', que: 'שנייה', answers: fourAnswers(2), scoreForQue: 3 }),
      rawSlide({ id: 5, type: 'subject', que: 'שלישית' }),
    ]);

  it('בסוף המשחק (כמו בבונה), עם מזהים חדשים ורציפים', () => {
    const game = base();
    const res = insertImportedQuestions(game, [trivia, survey], null);
    expect(res.count).toBe(2);
    expect(res.firstIndex).toBe(3);
    expect(res.game.questions.map((q) => [q.id, q.question.que])).toEqual([
      [4, 'ראשונה'],
      [7, 'שנייה'],
      [5, 'שלישית'],
      [8, 'מה?'],
      [9, 'איזה?'],
    ]);
    expect(game.questions).toHaveLength(3); // המקור לא השתנה
  });

  it('אחרי השקופית הנבחרת', () => {
    const res = insertImportedQuestions(base(), [trivia, survey], 0);
    expect(res.firstIndex).toBe(1);
    expect(res.game.questions.map((q) => q.question.que)).toEqual([
      'ראשונה',
      'מה?',
      'איזה?',
      'שנייה',
      'שלישית',
    ]);
  });

  it('★ המשחק אחרי היבוא נשמר ונטען מחדש בלי שינוי — הקובץ תקין למנוע', () => {
    const res = insertImportedQuestions(base(), [trivia, survey], null);
    const reloaded = parseGameFile(JSON.parse(JSON.stringify(res.game)));
    expect(reloaded.questions).toEqual(res.game.questions);
  });
});
