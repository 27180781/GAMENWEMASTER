/**
 * טעינת קובץ משחק: פרסינג, ולידציה עם Zod ונרמול (SPEC 3.5).
 * שגיאות ולידציה נזרקות בעברית עם מיקום מדויק:
 *   "שקופית 7 (id=7): question.scoreForQue — חייב להיות מספר"
 */

import { z } from 'zod';
import { gameFileSchema, type GameFile } from './schema.ts';

export class GameValidationError extends Error {
  /** הודעות מפורטות, אחת לכל בעיה שנמצאה. */
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`קובץ המשחק אינו תקין:\n${issues.join('\n')}`);
    this.name = 'GameValidationError';
    this.issues = issues;
  }
}

/** תרגום הודעת שגיאה בודדת של Zod לעברית. */
function issueMessage(issue: z.ZodIssue): string {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return `חייב להיות ${hebrewTypeName(issue.expected)} (התקבל ${hebrewTypeName(issue.received)})`;
    case z.ZodIssueCode.invalid_enum_value:
      return `ערך לא חוקי "${String(issue.received)}" — הערכים המותרים: ${issue.options.join(', ')}`;
    default:
      return issue.message;
  }
}

function hebrewTypeName(t: string): string {
  const names: Record<string, string> = {
    string: 'מחרוזת',
    number: 'מספר',
    boolean: 'ערך בוליאני',
    object: 'אובייקט',
    array: 'מערך',
    null: 'null',
    undefined: 'חסר (undefined)',
  };
  return names[t] ?? t;
}

/** בניית קידומת מיקום: אם השגיאה בתוך שקופית — מספרהּ וה-id שלה. */
function locate(path: (string | number)[], rawData: unknown): { prefix: string; rest: string } {
  if (path[0] === 'questions' && typeof path[1] === 'number') {
    const index = path[1];
    let id: unknown;
    if (rawData && typeof rawData === 'object') {
      const questions = (rawData as { questions?: unknown }).questions;
      if (Array.isArray(questions)) {
        const raw = questions[index] as { id?: unknown } | undefined;
        id = raw?.id;
      }
    }
    const idText = typeof id === 'number' || typeof id === 'string' ? ` (id=${id})` : '';
    return { prefix: `שקופית ${index + 1}${idText}: `, rest: path.slice(2).join('.') };
  }
  return { prefix: '', rest: path.join('.') };
}

function formatIssues(error: z.ZodError, rawData: unknown): string[] {
  return error.issues.map((issue) => {
    const { prefix, rest } = locate(issue.path, rawData);
    const field = rest.length > 0 ? `${rest} — ` : '';
    return `${prefix}${field}${issueMessage(issue)}`;
  });
}

/**
 * ולידציה ונרמול של אובייקט שכבר עבר JSON.parse.
 * זורק GameValidationError עם כל הבעיות שנמצאו.
 */
export function parseGameFile(data: unknown): GameFile {
  const result = gameFileSchema.safeParse(data);
  if (!result.success) {
    throw new GameValidationError(formatIssues(result.error, data));
  }
  return result.data;
}

/** שקופית שהושמטה בטעינה סלחנית כי לא עברה ולידציה. */
export interface DroppedSlide {
  /** מיקום השקופית בקובץ (1-מבוסס, לתצוגה). */
  position: number;
  /** מזהה השקופית (id) מהקובץ, אם קיים. */
  id: number | string | null;
  /** ההודעות שהפכו את השקופית ללא-תקינה. */
  messages: string[];
}

/** תוצאת טעינה סלחנית: המשחק (בר-משחק) + השקופיות שהושמטו. */
export interface LenientGameFile {
  game: GameFile;
  /** ריק = הקובץ תקין לגמרי. */
  dropped: DroppedSlide[];
}

function rawQuestionsOf(data: unknown): unknown[] {
  if (data !== null && typeof data === 'object') {
    const questions = (data as { questions?: unknown }).questions;
    if (Array.isArray(questions)) return questions;
  }
  return [];
}

/**
 * טעינה "סלחנית": מאפשרת לטעון גם קבצים עם שקופיות פגומות בודדות (למשל סקר
 * בלי תשובות שנוצר כ-placeholder בעמוד יצירת המשחק). אם *כל* הבעיות הן ברמת
 * שקופית — משמיטים את השקופיות הפגומות ומחזירים את השאר כמשחק בר-משחק, יחד עם
 * רשימת מה שהושמט (כדי שהמנחה יראה מה לתקן). בעיה גלובלית (הגדרות/מבנה, או
 * שלא נותרה אף שקופית תקינה) עדיין זורקת GameValidationError — דילוג על שקופית
 * לא יתקן אותה.
 */
export function parseGameFileLenient(data: unknown): LenientGameFile {
  const strict = gameFileSchema.safeParse(data);
  if (strict.success) return { game: strict.data, dropped: [] };

  // אוספים את מזהי השקופיות הפגומות; כל בעיה מחוץ ל-questions[i] היא גלובלית.
  const badIndices = new Set<number>();
  for (const issue of strict.error.issues) {
    if (issue.path[0] === 'questions' && typeof issue.path[1] === 'number') {
      badIndices.add(issue.path[1]);
    } else {
      throw new GameValidationError(formatIssues(strict.error, data));
    }
  }

  // בונים מחדש בלי השקופיות הפגומות ומנסים שוב.
  const rawQuestions = rawQuestionsOf(data);
  const kept = rawQuestions.filter((_, i) => !badIndices.has(i));
  const retry = gameFileSchema.safeParse({
    ...(data as Record<string, unknown>),
    questions: kept,
  });
  if (!retry.success) {
    // עדיין לא תקין (למשל לא נותרה אף שקופית) — נכשלים עם כל הבעיות המקוריות.
    throw new GameValidationError(formatIssues(strict.error, data));
  }

  // הודעות מקובצות לפי שקופית (בלי קידומת המיקום — המיקום מוצג בנפרד).
  const messagesByIndex = new Map<number, string[]>();
  for (const issue of strict.error.issues) {
    const index = issue.path[1] as number;
    const rest = issue.path.slice(2).join('.');
    const field = rest.length > 0 ? `${rest} — ` : '';
    const list = messagesByIndex.get(index) ?? [];
    list.push(`${field}${issueMessage(issue)}`);
    messagesByIndex.set(index, list);
  }

  const dropped: DroppedSlide[] = [...badIndices]
    .sort((a, b) => a - b)
    .map((index) => {
      const rawSlide = rawQuestions[index] as { id?: unknown } | undefined;
      const rawId = rawSlide?.id;
      const id = typeof rawId === 'number' || typeof rawId === 'string' ? rawId : null;
      return { position: index + 1, id, messages: messagesByIndex.get(index) ?? [] };
    });

  return { game: retry.data, dropped };
}

/** טעינה ממחרוזת JSON גולמית. */
export function parseGameFileFromString(json: string): GameFile {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    throw new GameValidationError([`הקובץ אינו JSON תקין: ${(e as Error).message}`]);
  }
  return parseGameFile(data);
}
