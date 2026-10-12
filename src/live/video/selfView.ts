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

/**
 * הגדלים של חלונית צפה: פתוחה, וממוזערת לכפתור. אותם חישובים משמשים גם את
 * חלונית הבמה (StageWindow.tsx), בגדלים שלה.
 */
export interface FloatSizes {
  tile: Size;
  pill: Size;
}

export const SELF_VIEW_SIZES: FloatSizes = { tile: SELF_VIEW_SIZE, pill: SELF_VIEW_PILL_SIZE };

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

export function selfViewSize(minimized: boolean, sizes: FloatSizes = SELF_VIEW_SIZES): Size {
  return minimized ? sizes.pill : sizes.tile;
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
 * מעבר מגודל לגודל (מזעור, פתיחה, הגדלה): הפינה של החלונית שקרובה לפינת
 * המסך נשארת במקומה, כך שחלונית שיושבת בפינה התחתונה משתנה באותה פינה ולא
 * נשארת תלויה באוויר.
 */
export function anchoredPos(pos: Point, from: Size, to: Size): Point {
  const right = pos.x + from.width / 2 > STAGE_WIDTH / 2;
  const bottom = pos.y + from.height / 2 > STAGE_HEIGHT / 2;
  return clampSelfViewPos(
    {
      x: right ? pos.x + from.width - to.width : pos.x,
      y: bottom ? pos.y + from.height - to.height : pos.y,
    },
    to,
  );
}

/** מזעור: הכפתור נצמד לפינה של החלונית שקרובה לפינת המסך. */
export function compactPos(tile: Point, sizes: FloatSizes = SELF_VIEW_SIZES): Point {
  return anchoredPos(tile, sizes.tile, sizes.pill);
}

/** הפתיחה מחדש: ההפך מ-compactPos, ולכן מזעור ופתיחה מחזירים בדיוק לאותו מקום. */
export function expandedPos(pill: Point, sizes: FloatSizes = SELF_VIEW_SIZES): Point {
  return anchoredPos(pill, sizes.pill, sizes.tile);
}

/**
 * איפה מה שמוצג יושב: החלונית במקום שלה, הכפתור הממוזער במקום שלו, ובזמן החלון
 * הנפרד הכפתור בפינה של החלונית, או איפה שגררו אותו (pipPill).
 */
export function shownSelfViewPos(
  prefs: SelfViewPrefs,
  pip: boolean,
  pipPill: Point | null,
  sizes: FloatSizes = SELF_VIEW_SIZES,
): Point {
  if (prefs.minimized) return clampSelfViewPos(prefs.pos, sizes.pill);
  const tile = clampSelfViewPos(prefs.pos, sizes.tile);
  if (!pip) return tile;
  return pipPill === null ? compactPos(tile, sizes) : clampSelfViewPos(pipPill, sizes.pill);
}

/**
 * מה נשמר אחרי גרירה. בזמן החלון הנפרד גוררים את הכפתור, והחלון הנפרד לא נשמר
 * במחשב, ולכן נשמרת החלונית שתיפתח בפינה של המקום שאליו הכפתור הגיע.
 */
export function prefsAfterDrag(
  prefs: SelfViewPrefs,
  pip: boolean,
  dropped: Point,
  sizes: FloatSizes = SELF_VIEW_SIZES,
): SelfViewPrefs {
  if (prefs.minimized || !pip) return { pos: dropped, minimized: prefs.minimized };
  return { pos: expandedPos(dropped, sizes), minimized: false };
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
