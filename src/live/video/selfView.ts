/**
 * חלונית «המצלמה שלי» של המנחה על המסך הראשי (HostSelfView.tsx): איפה היא
 * יושבת, גרירה, מזעור, ומה נשמר במחשב. טהור — בלי React ובלי DOM — לבדיקות.
 *
 * הקואורדינטות הן של הבמה (1920×1080, src/render/Stage.tsx), כמו שאר
 * התפריטים של המנחה. הבמה מוקטנת ב-transform, ולכן תזוזה של העכבר על המסך
 * מחולקת ב-scale של הבמה לפני שהיא מזיזה את החלונית.
 */

import { STAGE_HEIGHT, STAGE_WIDTH } from '../../render/Stage.tsx';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** החלונית הפתוחה: 16:9, בערך שישית מרוחב המסך. */
export const SELF_VIEW_SIZE: Size = { width: 320, height: 180 };

/** החלונית הממוזערת (וגם «בחלון נפרד»): כפתור אחד. */
export const SELF_VIEW_PILL_SIZE: Size = { width: 220, height: 44 };

/** מרחק מינימלי משולי הבמה, כדי שתמיד יהיה במה לתפוס. */
export const SELF_VIEW_EDGE = 12;

/** תזוזה (בפיקסלים של המסך) שמתחתיה לחיצה היא לחיצה ולא גרירה. */
export const DRAG_THRESHOLD = 4;

/** ברירת המחדל: בפינה, מעל התג של הווידאו ונורית החיבור. */
export const DEFAULT_SELF_VIEW_POS: Point = {
  x: STAGE_WIDTH - SELF_VIEW_SIZE.width - 24,
  y: STAGE_HEIGHT - SELF_VIEW_SIZE.height - 72,
};

export const SELF_VIEW_STORAGE_KEY = 'trivia.hostVideo.selfView';

export interface SelfViewPrefs {
  /** הפינה העליונה של מה שמוצג (החלונית או הכפתור הממוזער), בקואורדינטות הבמה. */
  pos: Point;
  minimized: boolean;
}

export const DEFAULT_SELF_VIEW_PREFS: SelfViewPrefs = {
  pos: DEFAULT_SELF_VIEW_POS,
  minimized: false,
};

export function selfViewSize(minimized: boolean): Size {
  return minimized ? SELF_VIEW_PILL_SIZE : SELF_VIEW_SIZE;
}

/** בתוך הבמה, עם שוליים — גם אחרי מזעור, פתיחה או גרירה רחוקה מדי. */
export function clampSelfViewPos(pos: Point, size: Size): Point {
  const clamp = (value: number, max: number) =>
    Math.round(Math.min(Math.max(value, SELF_VIEW_EDGE), Math.max(SELF_VIEW_EDGE, max)));
  return {
    x: clamp(pos.x, STAGE_WIDTH - size.width - SELF_VIEW_EDGE),
    y: clamp(pos.y, STAGE_HEIGHT - size.height - SELF_VIEW_EDGE),
  };
}

/**
 * מזעור: הכפתור נצמד לפינה של החלונית שקרובה לפינת המסך, כך שחלונית שיושבת
 * בפינה התחתונה מתמזערת לאותה פינה ולא נשארת תלויה באוויר.
 */
export function compactPos(tile: Point): Point {
  const right = tile.x + SELF_VIEW_SIZE.width / 2 > STAGE_WIDTH / 2;
  const bottom = tile.y + SELF_VIEW_SIZE.height / 2 > STAGE_HEIGHT / 2;
  return clampSelfViewPos(
    {
      x: right ? tile.x + SELF_VIEW_SIZE.width - SELF_VIEW_PILL_SIZE.width : tile.x,
      y: bottom ? tile.y + SELF_VIEW_SIZE.height - SELF_VIEW_PILL_SIZE.height : tile.y,
    },
    SELF_VIEW_PILL_SIZE,
  );
}

/** הפתיחה מחדש: ההפך מ-compactPos, ולכן מזעור ופתיחה מחזירים בדיוק לאותו מקום. */
export function expandedPos(pill: Point): Point {
  const right = pill.x + SELF_VIEW_PILL_SIZE.width / 2 > STAGE_WIDTH / 2;
  const bottom = pill.y + SELF_VIEW_PILL_SIZE.height / 2 > STAGE_HEIGHT / 2;
  return clampSelfViewPos(
    {
      x: right ? pill.x + SELF_VIEW_PILL_SIZE.width - SELF_VIEW_SIZE.width : pill.x,
      y: bottom ? pill.y + SELF_VIEW_PILL_SIZE.height - SELF_VIEW_SIZE.height : pill.y,
    },
    SELF_VIEW_SIZE,
  );
}

/**
 * איפה מה שמוצג יושב: החלונית במקום שלה, הכפתור הממוזער במקום שלו, ובזמן החלון
 * הנפרד הכפתור בפינה של החלונית, או איפה שגררו אותו (pipPill).
 */
export function shownSelfViewPos(prefs: SelfViewPrefs, pip: boolean, pipPill: Point | null): Point {
  if (prefs.minimized) return clampSelfViewPos(prefs.pos, SELF_VIEW_PILL_SIZE);
  const tile = clampSelfViewPos(prefs.pos, SELF_VIEW_SIZE);
  if (!pip) return tile;
  return pipPill === null ? compactPos(tile) : clampSelfViewPos(pipPill, SELF_VIEW_PILL_SIZE);
}

/**
 * מה נשמר אחרי גרירה. בזמן החלון הנפרד גוררים את הכפתור, והחלון הנפרד לא נשמר
 * במחשב, ולכן נשמרת החלונית שתיפתח בפינה של המקום שאליו הכפתור הגיע.
 */
export function prefsAfterDrag(prefs: SelfViewPrefs, pip: boolean, dropped: Point): SelfViewPrefs {
  if (prefs.minimized || !pip) return { pos: dropped, minimized: prefs.minimized };
  return { pos: expandedPos(dropped), minimized: false };
}

/**
 * המיקום תוך כדי גרירה: נקודת ההתחלה ועוד מה שהעכבר זז על המסך, מחולק
 * ב-scale של הבמה (0.5 = הבמה מוצגת בחצי גודל, ולכן 10 פיקסלים במסך הם 20 בבמה).
 */
export function dragSelfView(
  start: Point,
  pointerStart: Point,
  pointerNow: Point,
  scale: number,
  size: Size,
): Point {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return clampSelfViewPos(
    {
      x: start.x + (pointerNow.x - pointerStart.x) / s,
      y: start.y + (pointerNow.y - pointerStart.y) / s,
    },
    size,
  );
}

/** האם העכבר זז מספיק כדי שזו גרירה ולא לחיצה. */
export function isDrag(pointerStart: Point, pointerNow: Point): boolean {
  return (
    Math.abs(pointerNow.x - pointerStart.x) >= DRAG_THRESHOLD ||
    Math.abs(pointerNow.y - pointerStart.y) >= DRAG_THRESHOLD
  );
}

/** מה שנשמר במחשב; ערך פגום או חסר — ברירת המחדל. */
export function parseSelfViewPrefs(raw: string | null): SelfViewPrefs {
  if (raw === null) return DEFAULT_SELF_VIEW_PREFS;
  try {
    const value = JSON.parse(raw) as { x?: unknown; y?: unknown; minimized?: unknown };
    const minimized = value.minimized === true;
    const { x, y } = value;
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    )
      return { ...DEFAULT_SELF_VIEW_PREFS, minimized };
    return { pos: clampSelfViewPos({ x, y }, selfViewSize(minimized)), minimized };
  } catch {
    return DEFAULT_SELF_VIEW_PREFS;
  }
}

export function serializeSelfViewPrefs(prefs: SelfViewPrefs): string {
  return JSON.stringify({ x: prefs.pos.x, y: prefs.pos.y, minimized: prefs.minimized });
}
