/**
 * יבוא שאלות מקובץ אקסל לעורך המקומי — אותה תבנית, אותם כללים ואותן הודעות
 * כמו חלון «יבוא מאקסל» של מערכת יצירת המשחקים (ImportExcelDialog שם), כדי
 * שקובץ אחד יעבוד בשני המקומות ויתפרק לאותן שאלות.
 *
 * הכללים, כמו שם:
 *   • שורת הכותרת היא הראשונה מבין חמש השורות הראשונות שיש בה גם "שאלה" וגם
 *     "תשובה" (או question / answer). העמודות מזוהות לפי הכותרת ולא לפי המיקום,
 *     כך שאפשר להזיז עמודות או להוסיף עמודות משלכם.
 *   • סוג: "סקר" / poll / survey → סקר, "טריוויה" / trivia → טריוויה, ואחרת
 *     טריוויה עם אזהרה. "סקר" בעמודת התשובה הנכונה הופך את השאלה לסקר.
 *   • תשובות: העמודות "תשובה 1" עד "תשובה 6". תאים ריקים נזרקים, ופחות משתי
 *     תשובות → השורה מדלגת.
 *   • תשובה נכונה: מספר מ-1 עד מספר התשובות שנשארו. חסר או לא תקין → תשובה 1,
 *     עם אזהרה.
 *   • נוסח ארוך מ-500 תווים נחתך.
 *
 * השקופית שנוצרת היא מה שמערכת יצירת המשחקים מייצאת לשאלה שיובאה (buildEngineSlide
 * שם, בלי הגדרות): 15 שניות, 7 נקודות, בלי מדיה — הרקע נופל לרקע השאלות של
 * המשחק — ובלי הגדרות מיוחדות.
 *
 * ההבדלים מהבונה הם בהודעות בלבד, לא בשאלות שנוצרות: מספר השורה הוא המספר
 * באקסל גם כשהטבלה לא מתחילה בשורה 1, שורה שנראית ריקה (רק רווחים) אינה מדווחת
 * כשגיאה, ותשובה ריקה באמצע שהזיזה את התשובה הנכונה מקבלת אזהרה.
 *
 * הקובץ טהור (בלי DOM) כדי שירוץ בבדיקות יחידה.
 */

import type { GameFile, Slide } from '../engine/index.ts';
import { slideSchema } from '../engine/schema.ts';
import { nextSlideId } from './slideEdit.ts';
import type { Cell } from './xlsx.ts';
import type { SheetRow } from './xlsxRead.ts';

/** סוג השקופית שנוצרת (בבונה: trivia / poll). */
export type ImportedType = 'trivia' | 'survey';

export interface ImportedQuestion {
  /** מספר השורה באקסל. */
  row: number;
  question: string;
  type: ImportedType;
  answers: string[];
  /** אינדקס התשובה הנכונה, מ-0. בסקר תמיד 0 ואין לו משמעות. */
  correctIndex: number;
}

export interface RowIssue {
  row: number;
  /** error = השורה דולגה; warning = יובאה עם תיקון אוטומטי. */
  level: 'error' | 'warning';
  message: string;
  /** תחילת השאלה (או של השורה), כדי שיהיה קל למצוא אותה בקובץ. */
  preview: string;
}

export interface FileNotice {
  level: 'info' | 'warning';
  message: string;
}

export interface QuestionImport {
  questions: ImportedQuestion[];
  issues: RowIssue[];
  notices: FileNotice[];
  /** מספר השורות שדולגו. */
  skipped: number;
  /** הודעה שעוצרת את היבוא (אין מה לייבא), או null. */
  error: string | null;
}

/** ההודעות, מילה במילה מהבונה (he/editor.json › importExcel). */
export const IMPORT_TEXT = {
  unsupportedFile: 'סוג קובץ לא נתמך. יש להעלות Excel (.xlsx, .xls) או CSV.',
  missingData: 'הקובץ ריק או חסרות בו שורות נתונים מעבר לכותרת.',
  missingColumn:
    "לא זוהתה עמודת 'שאלה' בקובץ. ודאו שהשורה הראשונה מכילה כותרת 'שאלה' או 'טקסט השאלה'.",
  missingAnswers: "לא זוהו עמודות 'תשובה 1..6' בקובץ. ודאו שיש לפחות כותרת אחת בשם 'תשובה 1'.",
  noValidQuestions: 'לא נמצאו שאלות תקינות בקובץ. בדקו את רשימת השגיאות למטה.',
  fileReadingError: 'שגיאה בקריאת הקובץ. ודאו שזהו קובץ Excel תקין.',
  autoHeaderRow: 'זוהתה שורת כותרת אוטומטית.',
  noTypeCol: 'אין עמודת סוג — כל השאלות יסומנו כטריוויה.',
  noCorrectCol: 'אין עמודת "תשובה נכונה" — שאלות טריוויה יסומנו עם תשובה 1.',
  fewAnswerCols: 'נמצאה רק עמודת תשובה אחת.',
  rowMissingQuestion: 'חסר טקסט שאלה — דולגה.',
  rowTooLong: 'טקסט שאלה ארוך מ-500 תווים — קוצר.',
  rowEmptyType: 'סוג ריק — נקבע לטריוויה.',
  rowUnknownType: (type: string) => `סוג לא מזוהה ("${type}") — נקבע לטריוויה.`,
  rowCorrectIsPoll: 'תשובה נכונה צוינה כסקר — סוג נקבע לסקר.',
  rowNotEnoughAnswers: 'פחות מ-2 תשובות — דולגה.',
  rowNoCorrect: 'תשובה נכונה חסרה — נקבעה תשובה 1.',
  rowInvalidCorrect: (val: string) => `תשובה נכונה לא תקינה ("${val}") — נקבעה תשובה 1.`,
  // רק כאן, לא בבונה: התוצאה זהה לשלו, אבל כדאי שהמשתמש יידע עליה.
  rowAnswerGap: (picked: string) =>
    `תשובה ריקה באמצע הזיזה את התשובות שאחריה — סומנה כנכונה "${picked}". בדקו שזו התשובה הנכונה.`,
} as const;

/** הסיומות שהבונה מקבל — אותה בדיקה, לפי שם הקובץ. */
export const IMPORT_ACCEPT = '.xlsx,.xls,.csv';

export function isSupportedImportName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv');
}

// ---------------------------------------------------------------------------
// התבנית להורדה — זהה לזו של הבונה, כדי שקובץ שמולא באחת יעבוד בשנייה
// ---------------------------------------------------------------------------

export const TEMPLATE_FILE_NAME = 'תבנית_יבוא_שאלות.xlsx';
export const TEMPLATE_SHEET_NAME = 'שאלות';
/** עמודה A מימין כשהגיליון ב-RTL — כסדר הקריאה בעברית. */
export const TEMPLATE_ROWS: Cell[][] = [
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
  ['טריוויה', 'כמה ימים יש בשנה מעוברת?', '365', '366', '364', '367', '', '', '2'],
  ['סקר', 'מה המשקה האהוב עליכם?', 'קפה', 'תה', 'מיץ', 'מים', '', '', ''],
];
/** רוחב העמודות בתווים, כמו בבונה. */
export const TEMPLATE_COL_WIDTHS = [12, 35, 14, 14, 14, 14, 14, 14, 18];

// ---------------------------------------------------------------------------
// פירוק הגיליון
// ---------------------------------------------------------------------------

const MAX_QUESTION_LENGTH = 500;
const HEADER_SCAN_ROWS = 5;
const MAX_ANSWERS = 6;
const PREVIEW_LENGTH = 40;

const QUESTION_HEADERS = ['טקסט השאלה', 'question text', 'שאלה', 'question'];
const POLL_WORDS = ['סקר', 'poll', 'survey'];
const TRIVIA_WORDS = ['טריוויה', 'trivia'];

/** כמו norm בבונה: בלי רווחים בקצוות, אותיות קטנות, בלי מירכאות וגרשים. */
function norm(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/["׳'`]/g, '');
}

function isLikelyHeader(cells: readonly string[]): boolean {
  const joined = cells.map(norm).join(' ');
  return /שאלה|question/.test(joined) && /תשובה|answer/.test(joined);
}

/**
 * העמודה הראשונה שהכותרת שלה מכילה את אחת המילים. העדיפות היא לפי סדר המילים
 * ולא לפי סדר העמודות — כך "טקסט השאלה" גובר על "סוג שאלה" (שגם בו יש "שאלה").
 */
function findColumn(
  header: readonly string[],
  words: readonly string[],
  exclude: number[] = [],
): number {
  for (const word of words) {
    for (let i = 0; i < header.length; i += 1) {
      if (exclude.includes(i)) continue;
      const h = header[i];
      if (h !== undefined && h !== '' && h.includes(word)) return i;
    }
  }
  return -1;
}

const includesAny = (text: string, words: readonly string[]): boolean =>
  words.some((w) => text.includes(w));

/** חיתוך לפי תווים ולא לפי יחידות UTF-16 — כדי לא לקרוע אמוג'י באמצע. */
function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join('');
}

/**
 * חיתוך הנוסח ל-500, כמו בבונה (‎slice(0, 500)‎ — לפי יחידות UTF-16). רק אם
 * החיתוך נופל באמצע אמוג'י הוא נעצר תו אחד קודם, כדי לא להשאיר חצי תו.
 */
function cutQuestion(text: string): string {
  if (text.length <= MAX_QUESTION_LENGTH) return text;
  const last = text.charCodeAt(MAX_QUESTION_LENGTH - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? MAX_QUESTION_LENGTH - 1 : MAX_QUESTION_LENGTH;
  return text.slice(0, end);
}

/**
 * פירוק שורות הגיליון לשאלות, עם רשימת הבעיות והתיקונים — בדיוק כמו processFile
 * בבונה. השורות הן מה ש-readSheet מחזיר (בלי שורות ריקות, עם מספר השורה באקסל).
 */
export function parseQuestionRows(rows: readonly SheetRow[]): QuestionImport {
  const empty: QuestionImport = { questions: [], issues: [], notices: [], skipped: 0, error: null };
  if (rows.length < 2) return { ...empty, error: IMPORT_TEXT.missingData };

  let headerIndex = 0;
  for (let i = 0; i < Math.min(HEADER_SCAN_ROWS, rows.length); i += 1) {
    if (isLikelyHeader(rows[i]!.cells)) {
      headerIndex = i;
      break;
    }
  }
  const notices: FileNotice[] = [];
  if (headerIndex > 0) notices.push({ level: 'info', message: IMPORT_TEXT.autoHeaderRow });

  const header = rows[headerIndex]!.cells.map(norm);
  const typeCol = findColumn(header, ['סוג שאלה', 'סוג', 'type']);
  // עמודת הסוג ("סוג שאלה") מוחרגת מהחיפוש הרחב של "שאלה"; ואם רק בה יש
  // "שאלה" — כמו בבונה, חוזרים לחיפוש בלי ההחרגה.
  let questionCol = findColumn(header, QUESTION_HEADERS, typeCol !== -1 ? [typeCol] : []);
  if (questionCol === -1) questionCol = findColumn(header, QUESTION_HEADERS);
  const answerCols: number[] = [];
  for (let n = 1; n <= MAX_ANSWERS; n += 1) {
    const col = findColumn(header, [`תשובה ${n}`, `answer ${n}`, `ans${n}`]);
    if (col !== -1) answerCols.push(col);
  }
  const correctCol = findColumn(header, ['תשובה נכונה', 'מספר התשובה הנכונה', 'נכונה', 'correct']);

  // כמו בבונה: שגיאה בעמודות עוצרת לפני ההודעות על הקובץ.
  if (questionCol === -1) return { ...empty, error: IMPORT_TEXT.missingColumn };
  if (answerCols.length === 0) return { ...empty, error: IMPORT_TEXT.missingAnswers };

  if (typeCol === -1) notices.push({ level: 'info', message: IMPORT_TEXT.noTypeCol });
  if (correctCol === -1) notices.push({ level: 'warning', message: IMPORT_TEXT.noCorrectCol });
  if (answerCols.length < 2) notices.push({ level: 'warning', message: IMPORT_TEXT.fewAnswerCols });

  const questions: ImportedQuestion[] = [];
  const issues: RowIssue[] = [];
  let skipped = 0;

  for (const sheetRow of rows.slice(headerIndex + 1)) {
    const cell = (col: number): string => (sheetRow.cells[col] ?? '').trim();
    const questionText = cell(questionCol);
    const preview =
      clip(questionText, PREVIEW_LENGTH) ||
      clip(
        sheetRow.cells
          .map((c) => c.trim())
          .filter((c) => c !== '')
          .join(' | '),
        PREVIEW_LENGTH,
      );
    const report = (level: RowIssue['level'], message: string): void => {
      issues.push({ row: sheetRow.row, level, message, preview });
    };

    if (questionText === '') {
      report('error', IMPORT_TEXT.rowMissingQuestion);
      skipped += 1;
      continue;
    }
    if (questionText.length > MAX_QUESTION_LENGTH) report('warning', IMPORT_TEXT.rowTooLong);

    let type: ImportedType = 'trivia';
    if (typeCol !== -1) {
      const typeRaw = cell(typeCol);
      const typeLower = typeRaw.toLowerCase();
      if (typeRaw === '') report('warning', IMPORT_TEXT.rowEmptyType);
      else if (includesAny(typeLower, POLL_WORDS)) type = 'survey';
      else if (!includesAny(typeLower, TRIVIA_WORDS))
        report('warning', IMPORT_TEXT.rowUnknownType(typeRaw));
    }
    if (correctCol !== -1 && includesAny(cell(correctCol).toLowerCase(), POLL_WORDS)) {
      if (type !== 'survey') report('warning', IMPORT_TEXT.rowCorrectIsPoll);
      type = 'survey';
    }

    const cells = answerCols.map(cell);
    const answers = cells.filter((a) => a !== '');
    if (answers.length < 2) {
      report('error', IMPORT_TEXT.rowNotEnoughAnswers);
      skipped += 1;
      continue;
    }

    // המספר נספר בתוך התשובות שנשארו (1 = הראשונה שאינה ריקה), כמו בבונה.
    let correctIndex = 0;
    if (type === 'trivia') {
      const correctRaw = correctCol !== -1 ? cell(correctCol) : '';
      const parsed = parseInt(correctRaw, 10);
      if (correctRaw === '') {
        report('warning', IMPORT_TEXT.rowNoCorrect);
      } else if (Number.isNaN(parsed) || parsed < 1 || parsed > answers.length) {
        report('warning', IMPORT_TEXT.rowInvalidCorrect(correctRaw));
      } else {
        correctIndex = parsed - 1;
        // "3" נכתב כנראה לפי הכותרת "תשובה 3", אבל תא ריק לפניו הזיז את
        // הספירה. התוצאה נשארת כמו בבונה — רק אומרים מה סומן.
        if (cells.slice(0, parsed).includes(''))
          report('warning', IMPORT_TEXT.rowAnswerGap(answers[correctIndex]!));
      }
    }

    questions.push({
      row: sheetRow.row,
      question: cutQuestion(questionText),
      type,
      answers,
      correctIndex,
    });
  }

  return {
    questions,
    issues,
    notices,
    skipped,
    error: questions.length === 0 ? IMPORT_TEXT.noValidQuestions : null,
  };
}

// ---------------------------------------------------------------------------
// הכנסה למשחק
// ---------------------------------------------------------------------------

/** הניקוד והזמן שהבונה נותן לשאלה בלי הגדרות (DEFAULT_POINTS / DEFAULT_TIMER שם). */
export const IMPORT_SCORE = 7;
export const IMPORT_TIME = 15;

/** השקופית של שאלה שיובאה, כמו שהבונה מייצא אותה, עם מזהה נתון. */
export function importedSlide(question: ImportedQuestion, id: number): Slide {
  return slideSchema.parse({
    question: {
      que: question.question,
      scoreForQue: IMPORT_SCORE,
      timeForQue: IMPORT_TIME,
      answers: question.answers.map((ans, i) => ({
        ans,
        correct: question.type === 'trivia' && i === question.correctIndex,
        id: i + 1,
      })),
      src: '',
      queMode: 'text',
    },
    openMedia: { src: '' },
    endMedia: { src: '' },
    backgroundMedia: { src: '' },
    setting: {
      allowChangeVote: false,
      liveVoteCounts: false,
      majorityDecides: false,
      slideStartVoting: true,
      playAfterClicking: false,
      exitGame: false,
      correctlyAnsweredBefore: false,
      firstClicker: false,
      answerIsSequenceClicks: false,
      fullscreen: false,
      scoringReduction: { active: false, seconds: '', score: '' },
      descendingScore: { active: false, maxScore: 1000 },
      imageReveal: { active: false, blur: 48 },
      slidBackgroundMedia: { src: '' },
      groupRestriction: { active: false, groupName: '' },
      automaticSkip: { active: false, seconds: '' },
      showInLoop: false,
    },
    type: question.type,
    id,
  });
}

/**
 * הוספת השאלות למשחק: בסוף (כמו בבונה), או אחרי השקופית `after` — בעורך
 * המקומי אין גרירה, והזזה של עשרות שקופיות אחת-אחת אינה אפשרות.
 * מחזיר גם את מיקום השקופית הראשונה שנוספה, כדי לבחור בה.
 */
export function insertImportedQuestions(
  game: GameFile,
  questions: readonly ImportedQuestion[],
  after: number | null,
): { game: GameFile; firstIndex: number; count: number } {
  const firstId = nextSlideId(game);
  const slides = questions.map((q, i) => importedSlide(q, firstId + i));
  const at =
    after === null
      ? game.questions.length
      : Math.min(Math.max(after + 1, 0), game.questions.length);
  const next = [...game.questions];
  next.splice(at, 0, ...slides);
  return { game: { ...game, questions: next }, firstIndex: at, count: slides.length };
}
