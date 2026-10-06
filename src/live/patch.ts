/**
 * הפרשים בין שני מצבי מסך — כדי שמסך הצפייה יקבל רק את מה שהשתנה.
 *
 * בזמן הצבעה המסך מתעדכן כמה פעמים בשנייה (מונה העונים, האווטרים המתעופפים),
 * ובמשחק גדול המצב המלא כולל מאות שמות וניקודים. שליחת המצב המלא בכל פעם
 * הייתה מכפילה את התעבורה במספר הצופים. לכן נשלח מצב מלא פעם אחת (ובכל כמה
 * מאות שינויים), ובין לבין — רשימת פעולות:
 *
 *   [path, value]  — הצבה של ערך בנתיב
 *   [path]         — מחיקה של המפתח בנתיב
 *
 * אובייקטים רגילים מושווים מפתח-מפתח. מערך שגדל או שמר על אורכו מושווה איבר-
 * איבר (רשימת המחוברים בלובי מתארכת בסופה — שחקן חדש הוא פעולה אחת ולא כל
 * הרשימה), ומערך שהתקצר מוחלף בשלמותו. כשרוב הצומת השתנה, הצבה אחת שלו כולו
 * זולה יותר מפעולה לכל מפתח. הכול חייב להיות JSON טהור: זה מה שעובר ברשת.
 */

export type PatchPath = string[];
export type PatchOp = [path: PatchPath] | [path: PatchPath, value: unknown];

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** מעבר לכמה פעולות בצומת אחד שווה לשקול הצבה של הצומת כולו. */
const MANY_OPS = 8;

/** הפעולות שהופכות את `prev` ל-`next`. מצבים זהים → רשימה ריקה. */
export function diff(prev: unknown, next: unknown): PatchOp[] {
  const ops: PatchOp[] = [];
  diffInto(prev, next, [], ops);
  return ops;
}

function diffInto(prev: unknown, next: unknown, path: PatchPath, ops: PatchOp[]): void {
  if (Object.is(prev, next)) return;
  let local: PatchOp[] | null = null;
  let size = 0;
  if (isPlainObject(prev) && isPlainObject(next)) {
    local = [];
    const keys = Object.keys(next);
    size = keys.length;
    for (const key of keys) {
      if (!Object.hasOwn(prev, key)) local.push([[...path, key], next[key]]);
      else diffInto(prev[key], next[key], [...path, key], local);
    }
    for (const key of Object.keys(prev)) {
      if (!Object.hasOwn(next, key)) local.push([[...path, key]]);
    }
  } else if (Array.isArray(prev) && Array.isArray(next) && next.length >= prev.length) {
    local = [];
    size = next.length;
    for (let i = 0; i < next.length; i++) {
      if (i < prev.length) diffInto(prev[i], next[i], [...path, String(i)], local);
      else local.push([[...path, String(i)], next[i]]);
    }
  }
  if (local !== null) {
    if (path.length > 0 && local.length > MANY_OPS && local.length * 2 > size) {
      ops.push([path, next]);
    } else {
      for (const op of local) ops.push(op);
    }
    return;
  }
  if (sameJson(prev, next)) return;
  ops.push([path, next]);
}

/** מפתחות שהצבה שלהם הייתה משנה את אב-הטיפוס — נתונים מהרשת לא נוגעים בהם. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const INDEX_RE = /^(0|[1-9]\d*)$/;

export function isValidPatch(ops: unknown): ops is PatchOp[] {
  if (!Array.isArray(ops)) return false;
  return ops.every(
    (op) =>
      Array.isArray(op) &&
      (op.length === 1 || op.length === 2) &&
      Array.isArray(op[0]) &&
      (op[0] as unknown[]).every((key) => typeof key === 'string' && !FORBIDDEN_KEYS.has(key)),
  );
}

type Container = PlainObject | unknown[];

/**
 * מחילה פעולות על מצב, **בלי לשנות אותו**: כל צומת בנתיב שהשתנה מועתק, וכל
 * השאר משותף עם המצב הקודם — כך React מזהה בדיוק מה התחלף.
 */
export function applyPatch<T>(base: T, ops: readonly PatchOp[]): T {
  const fresh = new WeakSet<object>();
  const own = (value: unknown): Container => {
    if (value !== null && typeof value === 'object' && fresh.has(value)) return value as Container;
    const copy: Container = Array.isArray(value)
      ? [...(value as unknown[])]
      : isPlainObject(value)
        ? { ...value }
        : {};
    fresh.add(copy);
    return copy;
  };
  /** במערך מותר רק אינדקס קיים או האיבר שאחרי האחרון — בלי חורים ובלי `length`. */
  const writable = (node: Container, key: string): boolean =>
    !Array.isArray(node) || (INDEX_RE.test(key) && Number(key) <= node.length);
  let root: unknown = base;
  for (const op of ops) {
    const path = op[0];
    if (path.some((key) => FORBIDDEN_KEYS.has(key))) continue;
    if (path.length === 0) {
      root = op.length === 2 ? op[1] : {};
      continue;
    }
    const top = own(root);
    let node: Container = top;
    let valid = true;
    for (let i = 0; i < path.length - 1 && valid; i++) {
      const key = path[i]!;
      if (!writable(node, key)) {
        valid = false;
        break;
      }
      const child = own((node as PlainObject)[key]);
      (node as PlainObject)[key] = child;
      node = child;
    }
    const last = path[path.length - 1]!;
    if (!valid || !writable(node, last)) continue;
    if (op.length === 2) (node as PlainObject)[last] = op[1];
    else if (!Array.isArray(node)) delete node[last];
    root = top;
  }
  return root as T;
}

/**
 * `next`, כשכל תת-עץ שזהה לזה שב-`prev` הוא **אותו אובייקט** של `prev`. מצב
 * מלא שמגיע מחדש (סנכרון, או מצב מלא תקופתי) אחרת היה נראה ל-React ולאפקטים
 * כאילו הכול התחלף — וההגרלה או לוח המרוץ היו מתחילים את האנימציה מההתחלה.
 */
export function shareEqual<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return next;
  if (Array.isArray(prev) && Array.isArray(next)) {
    let same = prev.length === next.length;
    const out = next.map((item: unknown, i) => {
      const shared = i < prev.length ? shareEqual(prev[i], item) : item;
      if (shared !== prev[i]) same = false;
      return shared;
    });
    return (same ? prev : out) as T;
  }
  if (isPlainObject(prev) && isPlainObject(next)) {
    const nextKeys = Object.keys(next);
    let same = Object.keys(prev).length === nextKeys.length;
    const out: PlainObject = {};
    for (const key of nextKeys) {
      const had = Object.hasOwn(prev, key);
      const shared = had ? shareEqual(prev[key], next[key]) : next[key];
      if (!had || shared !== prev[key]) same = false;
      out[key] = shared;
    }
    return (same ? prev : out) as T;
  }
  return next;
}
