/**
 * כינויים לשחקנים במסך הצפייה (?view=).
 *
 * מזהה של שחקן במשחק טלפונים הוא בדרך כלל מספר הטלפון שלו. מסך הצפייה מקבל
 * את מצב המסך הראשי, ולכן כל מזהה שנכנס אליו מוחלף בכינוי — כך שאף מספר טלפון
 * לא יוצא מהמחשב של המנחה (גם לא בתעבורת הרשת, למי שפותח כלי מפתחים).
 *
 * הכינויים **שומרים על הסדר**: כינוי של מזהה קטן יותר (ב-localeCompare, כמו
 * שהמסך הראשי ממיין) קטן יותר גם הוא. המסכים שוברים שוויון לפי המזהה (טבלת
 * הניקוד, "הניקוד של כל המשתתפים", חברי קבוצה), ובלי זה הסדר במסך הצפייה היה
 * שונה מהמסך הראשי. הכינוי עצמו לא מגלה דבר על המספר — רק את הסדר היחסי.
 *
 * המפתחות הם מספרים ברוחב קבוע עם רווחים גדולים ביניהם: מזהה חדש מקבל את
 * האמצע שבין שכניו, והוספה בקצה מתקדמת בצעד קבוע. כשנגמר המקום בין שני שכנים
 * (נדיר מאוד) כל המפתחות מחולקים מחדש ברווחים שווים ו-`version` עולה.
 */

/** מרחב המפתחות: ‎[0, 2^52]‎ — מספרים שלמים בטוחים, 16 ספרות לכל היותר. */
const KEY_MAX = 2 ** 52;
/** הצעד בהוספה בקצה הרשימה — משאיר מקום לכמיליון הוספות כאלה. */
const KEY_STEP = 2 ** 32;
const KEY_WIDTH = 16;

export type IdCompare = (a: string, b: string) => number;

/** ההשוואה של המסך הראשי (screens.tsx, gameEngine.ts, groupScore.ts). */
export const defaultIdCompare: IdCompare = (a, b) => a.localeCompare(b);

interface Entry {
  id: string;
  key: number;
}

export class AliasTable {
  private readonly prefix: string;
  private readonly compare: IdCompare;
  /** ממוין לפי המזהה המקורי. */
  private entries: Entry[] = [];
  private readonly byId = new Map<string, Entry>();
  private generation = 0;

  constructor({
    prefix = 'v',
    compare = defaultIdCompare,
  }: { prefix?: string; compare?: IdCompare } = {}) {
    this.prefix = prefix;
    this.compare = compare;
  }

  /** עולה בכל חלוקה מחדש — כל הכינויים השתנו, ולכן המפרסם שולח מצב מלא. */
  get version(): number {
    return this.generation;
  }

  get size(): number {
    return this.entries.length;
  }

  /** הכינוי של מזהה (נוצר בפעם הראשונה שהמזהה נראה). */
  alias(id: string): string {
    const known = this.byId.get(id);
    if (known !== undefined) return this.format(known.key);
    const at = this.insertionPoint(id);
    const before = at > 0 ? this.entries[at - 1]!.key : null;
    const after = at < this.entries.length ? this.entries[at]!.key : null;
    const key = keyBetween(before, after);
    const entry: Entry = { id, key: key ?? 0 };
    this.entries.splice(at, 0, entry);
    this.byId.set(id, entry);
    if (key === null) this.rebalance();
    return this.format(entry.key);
  }

  /** מזהה מקורי לפי כינוי — לבדיקות ולאבחון בלבד. */
  idOf(alias: string): string | undefined {
    for (const entry of this.entries) if (this.format(entry.key) === alias) return entry.id;
    return undefined;
  }

  private insertionPoint(id: string): number {
    let lo = 0;
    let hi = this.entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.compare(this.entries[mid]!.id, id) <= 0) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private rebalance(): void {
    const gap = Math.floor(KEY_MAX / (this.entries.length + 1));
    this.entries.forEach((entry, i) => {
      entry.key = (i + 1) * gap;
    });
    this.generation += 1;
  }

  private format(key: number): string {
    return this.prefix + String(key).padStart(KEY_WIDTH, '0');
  }
}

/**
 * מפתח שבין שני שכנים (null = אין שכן בצד הזה), או null כשאין ביניהם מקום
 * (ואז המטבלה מחלקת מחדש).
 */
export function keyBetween(before: number | null, after: number | null): number | null {
  if (before === null && after === null) return KEY_MAX / 2;
  if (before === null) {
    const key = after! - KEY_STEP > 0 ? after! - KEY_STEP : Math.floor(after! / 2);
    return key > 0 && key < after! ? key : null;
  }
  if (after === null) {
    const key =
      before + KEY_STEP < KEY_MAX ? before + KEY_STEP : before + Math.floor((KEY_MAX - before) / 2);
    return key > before && key < KEY_MAX ? key : null;
  }
  const key = before + Math.floor((after - before) / 2);
  return key > before && key < after ? key : null;
}
