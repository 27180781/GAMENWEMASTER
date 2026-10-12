/**
 * «במה» בדפדפן: מה שהמסך הראשי ומסך הצפייה חולקים. טהור — בלי React ובלי
 * רשת — לבדיקות. השרת: server/live-stage.mjs.
 *
 * משתתף בקישור הצפייה מדליק מצלמה (stageCam.ts), רק המנחה רואה אותה (תצוגה
 * מקדימה בתפריט המפעיל), והמנחה מעלה עד 9 מצלמות לבמה (stageHost.ts). את מה
 * שעל הבמה רואים כל הצופים (stageReceiver.ts) והמסך הראשי.
 */

import { STAGE_HEIGHT } from '../../render/Stage.tsx';
import type { StageEntry, VideoStage } from './api.ts';
import {
  anchoredPos,
  clampSelfViewPos,
  type FloatSizes,
  type Point,
  type Size,
} from './selfView.ts';

/** כמה מצלמות על הבמה בבת אחת — כמו בשרת. */
export const STAGE_MAX = 9;

/**
 * משתתף שהמנחה העלה והמצלמה שלו כבתה לרגע (רשת, רענון) נשאר בבחירה של
 * המנחה, וחוזר לבמה כשהוא מתחבר שוב. רק אחרי הזמן הזה בלי מצלמה הוא יורד ממנה.
 */
export const STAGE_GRACE_MS = 60_000;

/** המזהה הפרטי של דף המשתתף נשמר לחלון הזה: רענון = אותו משתתף, אותו מקום על הבמה. */
export const STAGE_CID_STORAGE_KEY = 'trivia.stage.cid';

const CID_RE = /^[0-9a-f]{32}$/;

/** כמה עמודות ברשת של `n` מצלמות. */
export function stageColumns(n: number): number {
  if (n <= 1) return 1;
  if (n <= 4) return 2;
  return 3;
}

/** צופה: השכבה העליונה רק כשיש מעט מצלמות (חלון גדול לכל אחת), אחרת הנמוכה. */
export function viewerLayer(n: number): 'high' | 'low' {
  return n <= 2 ? 'high' : 'low';
}

export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * מי המנחה רוצה על הבמה אחרי סקר. מי שהמצלמה שלו כבתה נשאר בבחירה, ויוצא
 * ממנה רק אחרי `graceMs` בלי מצלמה דלוקה.
 */
export function keepWanted(
  wanted: readonly string[],
  live: ReadonlySet<string>,
  missingSince: ReadonlyMap<string, number>,
  now: number,
  graceMs = STAGE_GRACE_MS,
): { wanted: string[]; missingSince: Map<string, number> } {
  const next: string[] = [];
  const since = new Map<string, number>();
  for (const id of wanted) {
    if (live.has(id)) {
      next.push(id);
      continue;
    }
    const from = missingSince.get(id) ?? now;
    if (now - from >= graceMs) continue;
    next.push(id);
    since.set(id, from);
  }
  return { wanted: next, missingSince: since };
}

/**
 * אילו מצלמות המנחה רואה בתצוגה המקדימה (עד `max`): מי שעל הבמה, אחר כך מי
 * שהמנחה ביקש לראות (`focus`, האחרון ראשון), ואחר כך לפי הסדר שבו הודלקו.
 */
export function previewIds(
  cams: readonly StageEntry[],
  onStage: readonly string[],
  focus: readonly string[],
  max: number,
): string[] {
  const live = new Set(cams.map((c) => c.id));
  const out: string[] = [];
  const add = (id: string) => {
    if (out.length < max && live.has(id) && !out.includes(id)) out.push(id);
  };
  onStage.forEach(add);
  [...focus].reverse().forEach(add);
  cams.forEach((c) => add(c.id));
  return out;
}

/** הבמה כפי שהיא נשלחת לצופים במצב המסך: מי עליה, בסדר של המנחה, עם השמות. */
export function liveStageOf(
  v: number,
  ids: readonly string[],
  cams: readonly StageEntry[],
): VideoStage {
  const names = new Map(cams.map((c) => [c.id, c.name]));
  return { v, ids: ids.map((id) => ({ id, name: names.get(id) ?? '' })) };
}

/** מזהה פרטי לדף המשתתף: מהחלון (רענון = אותו משתתף), או חדש. */
export function stageCid(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  fresh: () => string,
): string {
  try {
    const saved = storage?.getItem(STAGE_CID_STORAGE_KEY) ?? null;
    if (saved !== null && CID_RE.test(saved)) return saved;
  } catch {
    /* בלי אחסון — מזהה לביקור הזה בלבד */
  }
  const cid = fresh();
  try {
    storage?.setItem(STAGE_CID_STORAGE_KEY, cid);
  } catch {
    /* כנ"ל */
  }
  return cid;
}

/** הבמה מתוך מצב המסך — רק מה שתקין (מסך ראשי בגרסה אחרת לא מפיל את הצופה). */
export function stageFromSnapshot(value: unknown): VideoStage | null {
  if (value === null || typeof value !== 'object') return null;
  const { v, ids } = value as { v?: unknown; ids?: unknown };
  if (typeof v !== 'number' || !Number.isFinite(v) || !Array.isArray(ids)) return null;
  const entries: StageEntry[] = [];
  for (const entry of ids) {
    if (entry === null || typeof entry !== 'object') continue;
    const { id, name } = entry as { id?: unknown; name?: unknown };
    if (typeof id !== 'string' || !/^[0-9a-f]{16}$/.test(id)) continue;
    if (entries.some((e) => e.id === id)) continue;
    entries.push({ id, name: typeof name === 'string' ? name : '' });
    if (entries.length >= STAGE_MAX) break;
  }
  return { v, ids: entries };
}

// ------------------------------------------------------------ חלון של מצלמה אחת

/**
 * חלון של מצלמה מחזיק שני רכיבי וידאו (StageVideo.tsx). כשהתמונה מתחלפת (הבמה
 * השתנתה, והצופה עבר לחיבור חדש) הישנה נשארת מוצגת עד שבחדשה יש תמונה ראשונה,
 * ורק אז מתחלפים — כך שאין רגע שחור באמצע. `S` הוא MediaStream (בבדיקות — כל דבר).
 */
export interface VideoSlot<S> {
  stream: S | null;
  /** כבר יש תמונה (videoWidth > 0). */
  ready: boolean;
  /** תמונה גבוהה מרוחבה (טלפון לאורך). */
  portrait: boolean;
}

export interface VideoSlots<S> {
  slots: readonly [VideoSlot<S>, VideoSlot<S>];
  /** הרכיב שמוצג. */
  front: 0 | 1;
}

export type VideoSlotsAction<S> =
  | { type: 'stream'; stream: S | null }
  /** אירוע תמונה מהרכיב `slot`, שמנגן עכשיו את `stream`. */
  | { type: 'frame'; slot: 0 | 1; stream: S; ready: boolean; portrait: boolean }
  /** בחדשה לא הופיעה תמונה בזמן: עוברים אליה בכל זאת, ולא נשארים עם הישנה. */
  | { type: 'swap' };

/** כמה זמן הישנה נשארת מוצגת לכל היותר, כשבחדשה עוד אין תמונה. */
export const VIDEO_SWAP_TIMEOUT_MS = 3000;

function emptySlot<S>(): VideoSlot<S> {
  return { stream: null, ready: false, portrait: false };
}

/** `main` במקום `index`, ו-`other` ברכיב השני. */
function slotsWith<S>(
  index: 0 | 1,
  main: VideoSlot<S>,
  other: VideoSlot<S>,
): readonly [VideoSlot<S>, VideoSlot<S>] {
  return index === 0 ? [main, other] : [other, main];
}

export function initialVideoSlots<S>(stream: S | null): VideoSlots<S> {
  return { slots: [{ stream, ready: false, portrait: false }, emptySlot<S>()], front: 0 };
}

export function videoSlotsStep<S>(view: VideoSlots<S>, action: VideoSlotsAction<S>): VideoSlots<S> {
  const f = view.front;
  const b = f === 0 ? 1 : 0;
  const front = view.slots[f];
  const back = view.slots[b];
  switch (action.type) {
    case 'stream': {
      const { stream } = action;
      if (stream === front.stream) {
        return back.stream === null ? view : { slots: slotsWith(f, front, emptySlot()), front: f };
      }
      if (stream === null) return { slots: [emptySlot(), emptySlot()], front: f };
      if (stream === back.stream) return view;
      const fresh: VideoSlot<S> = { stream, ready: false, portrait: false };
      // אין תמונה להשאיר מוצגת — מחליפים במקום.
      if (front.stream === null || !front.ready) {
        return { slots: slotsWith(f, fresh, emptySlot()), front: f };
      }
      return { slots: slotsWith(b, fresh, front), front: f };
    }
    case 'frame': {
      const slot = view.slots[action.slot];
      if (slot.stream === null || slot.stream !== action.stream) return view; // תמונה ישנה
      const next: VideoSlot<S> = {
        stream: slot.stream,
        ready: action.ready,
        portrait: action.portrait,
      };
      if (action.slot === b && action.ready) {
        return { slots: slotsWith(b, next, emptySlot()), front: b };
      }
      if (next.ready === slot.ready && next.portrait === slot.portrait) return view;
      return {
        slots: slotsWith(action.slot, next, view.slots[action.slot === 0 ? 1 : 0]),
        front: f,
      };
    }
    case 'swap':
      if (back.stream === null) return view;
      return { slots: slotsWith(b, back, emptySlot()), front: b };
  }
}

// ---------------------------------------------------------------------- חלונית הבמה

/**
 * כמה עמודות ושורות, ובאיזה גודל כל חלון, כדי ש-`n` מצלמות ב-16:9 ייכנסו
 * לקופסה `box` עם רווח `gap` ביניהן.
 */
export function galleryLayout(
  n: number,
  box: Size,
  gap: number,
): { cols: number; rows: number; tile: Size } {
  const count = Math.max(1, n);
  const cols = stageColumns(count);
  const rows = Math.ceil(count / cols);
  const byWidth = (box.width - gap * (cols - 1)) / cols;
  const byHeight = ((box.height - gap * (rows - 1)) / rows) * (16 / 9);
  const width = Math.max(0, Math.floor(Math.min(byWidth, byHeight)));
  return { cols, rows, tile: { width, height: Math.floor((width * 9) / 16) } };
}

/** חלונית הבמה במסך הראשי: 16:9 בשני גדלים, וממוזערת — כפתור. */
export const STAGE_WINDOW_SMALL: Size = { width: 576, height: 324 };
export const STAGE_WINDOW_LARGE: Size = { width: 960, height: 540 };
export const STAGE_WINDOW_PILL: Size = { width: 220, height: 44 };
export const STAGE_WINDOW_STORAGE_KEY = 'trivia.hostVideo.stageWindow';

export function stageWindowSizes(large: boolean): FloatSizes {
  return { tile: large ? STAGE_WINDOW_LARGE : STAGE_WINDOW_SMALL, pill: STAGE_WINDOW_PILL };
}

export interface StageWindowPrefs {
  /** הפינה העליונה של מה שמוצג (החלונית או הכפתור הממוזער), בקואורדינטות הבמה. */
  pos: Point;
  minimized: boolean;
  large: boolean;
}

/** ברירת המחדל: בפינה השמאלית התחתונה (בימנית — «המצלמה שלי» ותג הווידאו). */
export const DEFAULT_STAGE_WINDOW_PREFS: StageWindowPrefs = {
  pos: { x: 24, y: STAGE_HEIGHT - STAGE_WINDOW_SMALL.height - 72 },
  minimized: false,
  large: false,
};

/** הגדלה או הקטנה: הפינה שקרובה לפינת המסך נשארת במקומה. */
export function resizedStageWindow(prefs: StageWindowPrefs, shown: Point): StageWindowPrefs {
  const from = stageWindowSizes(prefs.large).tile;
  const to = stageWindowSizes(!prefs.large).tile;
  return { pos: anchoredPos(shown, from, to), minimized: false, large: !prefs.large };
}

/** מה שנשמר במחשב; ערך פגום או חסר — ברירת המחדל. */
export function parseStageWindowPrefs(raw: string | null): StageWindowPrefs {
  if (raw === null) return DEFAULT_STAGE_WINDOW_PREFS;
  try {
    const value = JSON.parse(raw) as {
      x?: unknown;
      y?: unknown;
      minimized?: unknown;
      large?: unknown;
    } | null;
    if (value === null || typeof value !== 'object') return DEFAULT_STAGE_WINDOW_PREFS;
    const minimized = value.minimized === true;
    const large = value.large === true;
    const { x, y } = value;
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    )
      return { ...DEFAULT_STAGE_WINDOW_PREFS, minimized, large };
    const sizes = stageWindowSizes(large);
    return {
      pos: clampSelfViewPos({ x, y }, minimized ? sizes.pill : sizes.tile),
      minimized,
      large,
    };
  } catch {
    return DEFAULT_STAGE_WINDOW_PREFS;
  }
}

export function serializeStageWindowPrefs(prefs: StageWindowPrefs): string {
  return JSON.stringify({
    x: prefs.pos.x,
    y: prefs.pos.y,
    minimized: prefs.minimized,
    large: prefs.large,
  });
}
