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
