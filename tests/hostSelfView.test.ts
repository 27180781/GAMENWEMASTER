/**
 * «המצלמה שלי» של המנחה (src/live/video/selfView.ts): ברירת המחדל, הגבולות של
 * הבמה, גרירה במסך מוקטן, לחיצה מול גרירה, ומה שנשמר במחשב.
 */

import { describe, expect, it } from 'vitest';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../src/render/Stage.tsx';
import {
  clampSelfViewPos,
  compactPos,
  DEFAULT_SELF_VIEW_POS,
  DEFAULT_SELF_VIEW_PREFS,
  dragSelfView,
  expandedPos,
  isDrag,
  parseSelfViewPrefs,
  prefsAfterDrag,
  SELF_VIEW_EDGE,
  SELF_VIEW_PILL_SIZE,
  SELF_VIEW_SIZE,
  selfViewSize,
  serializeSelfViewPrefs,
  shownSelfViewPos,
} from '../src/live/video/selfView.ts';

const inside = (pos: { x: number; y: number }, size: { width: number; height: number }) =>
  pos.x >= SELF_VIEW_EDGE &&
  pos.y >= SELF_VIEW_EDGE &&
  pos.x + size.width <= STAGE_WIDTH - SELF_VIEW_EDGE &&
  pos.y + size.height <= STAGE_HEIGHT - SELF_VIEW_EDGE;

describe('«המצלמה שלי» — מיקום', () => {
  it('ברירת המחדל: בפינה התחתונה, בתוך הבמה, מעל התג של הווידאו', () => {
    expect(inside(DEFAULT_SELF_VIEW_POS, SELF_VIEW_SIZE)).toBe(true);
    expect(DEFAULT_SELF_VIEW_POS.x).toBeGreaterThan(STAGE_WIDTH / 2);
    expect(DEFAULT_SELF_VIEW_POS.y + SELF_VIEW_SIZE.height).toBeLessThanOrEqual(STAGE_HEIGHT - 60);
    expect(clampSelfViewPos(DEFAULT_SELF_VIEW_POS, SELF_VIEW_SIZE)).toEqual(DEFAULT_SELF_VIEW_POS);
  });

  it('לא יוצאת מהבמה, מכל צד', () => {
    for (const pos of [
      { x: -500, y: -500 },
      { x: 5000, y: 5000 },
      { x: -1, y: 4000 },
      { x: 1919, y: 0 },
    ]) {
      expect(inside(clampSelfViewPos(pos, SELF_VIEW_SIZE), SELF_VIEW_SIZE)).toBe(true);
      expect(inside(clampSelfViewPos(pos, SELF_VIEW_PILL_SIZE), SELF_VIEW_PILL_SIZE)).toBe(true);
    }
  });

  it('אחרי מזעור בקצה, הפתיחה מחזירה את החלונית לתוך הבמה', () => {
    const pill = clampSelfViewPos({ x: 9999, y: 9999 }, selfViewSize(true));
    expect(pill.x + SELF_VIEW_PILL_SIZE.width).toBe(STAGE_WIDTH - SELF_VIEW_EDGE);
    const reopened = clampSelfViewPos(pill, selfViewSize(false));
    expect(inside(reopened, SELF_VIEW_SIZE)).toBe(true);
    expect(reopened.x + SELF_VIEW_SIZE.width).toBe(STAGE_WIDTH - SELF_VIEW_EDGE);
  });
});

describe('«המצלמה שלי» — מזעור', () => {
  it('בפינה התחתונה הכפתור נצמד לפינה של החלונית, והפתיחה מחזירה בדיוק לשם', () => {
    const pill = compactPos(DEFAULT_SELF_VIEW_POS);
    expect(pill.x + SELF_VIEW_PILL_SIZE.width).toBe(DEFAULT_SELF_VIEW_POS.x + SELF_VIEW_SIZE.width);
    expect(pill.y + SELF_VIEW_PILL_SIZE.height).toBe(
      DEFAULT_SELF_VIEW_POS.y + SELF_VIEW_SIZE.height,
    );
    expect(expandedPos(pill)).toEqual(DEFAULT_SELF_VIEW_POS);
  });

  it('בפינה העליונה השמאלית הכפתור נשאר באותה פינה עליונה', () => {
    const tile = { x: SELF_VIEW_EDGE, y: SELF_VIEW_EDGE };
    expect(compactPos(tile)).toEqual(tile);
    expect(expandedPos(tile)).toEqual(tile);
  });

  it('מזעור ופתיחה מחזירים כל מקום על הבמה לאותו מקום, בתוך הבמה', () => {
    for (let x = SELF_VIEW_EDGE; x <= STAGE_WIDTH - SELF_VIEW_SIZE.width - SELF_VIEW_EDGE; x += 37)
      for (
        let y = SELF_VIEW_EDGE;
        y <= STAGE_HEIGHT - SELF_VIEW_SIZE.height - SELF_VIEW_EDGE;
        y += 29
      ) {
        const pill = compactPos({ x, y });
        expect(inside(pill, SELF_VIEW_PILL_SIZE)).toBe(true);
        expect(expandedPos(pill)).toEqual({ x, y });
      }
  });

  it('כפתור שגררו לכל מקום נפתח לחלונית שלמה בתוך הבמה', () => {
    for (let x = -50; x <= STAGE_WIDTH + 50; x += 41)
      for (let y = -50; y <= STAGE_HEIGHT + 50; y += 31)
        expect(
          inside(expandedPos(clampSelfViewPos({ x, y }, SELF_VIEW_PILL_SIZE)), SELF_VIEW_SIZE),
        ).toBe(true);
  });
});

describe('«המצלמה שלי» — מה מוצג', () => {
  const tile = { x: 1000, y: 700 };

  it('פתוחה: החלונית במקום שלה', () => {
    expect(shownSelfViewPos({ pos: tile, minimized: false }, false, null)).toEqual(tile);
  });

  it('ממוזערת: הכפתור במקום שנשמר לו', () => {
    const pill = { x: 400, y: 100 };
    expect(shownSelfViewPos({ pos: pill, minimized: true }, false, null)).toEqual(pill);
  });

  it('בחלון נפרד: הכפתור בפינה של החלונית, ואחרי גרירה איפה שהשאירו אותו', () => {
    const prefs = { pos: tile, minimized: false };
    expect(shownSelfViewPos(prefs, true, null)).toEqual(compactPos(tile));
    expect(shownSelfViewPos(prefs, true, { x: 50, y: 60 })).toEqual({ x: 50, y: 60 });
  });

  it('גרירה בחלון הנפרד שומרת את החלונית שתיפתח בפינה של הכפתור', () => {
    const dropped = { x: 1500, y: 950 };
    const saved = prefsAfterDrag({ pos: tile, minimized: false }, true, dropped);
    expect(saved).toEqual({ pos: expandedPos(dropped), minimized: false });
    expect(compactPos(saved.pos)).toEqual(dropped);
  });

  it('גרירה של החלונית או של הכפתור הממוזער שומרת את המקום כמו שהוא', () => {
    const dropped = { x: 300, y: 200 };
    expect(prefsAfterDrag({ pos: tile, minimized: false }, false, dropped)).toEqual({
      pos: dropped,
      minimized: false,
    });
    expect(prefsAfterDrag({ pos: tile, minimized: true }, false, dropped)).toEqual({
      pos: dropped,
      minimized: true,
    });
  });
});

describe('«המצלמה שלי» — גרירה', () => {
  it('במסך מוקטן התזוזה בבמה גדולה מהתזוזה של העכבר', () => {
    // הבמה מוצגת בחצי גודל: 100 פיקסלים במסך הם 200 בבמה.
    const pos = dragSelfView(
      { x: 800, y: 400 },
      { x: 10, y: 10 },
      { x: 110, y: -40 },
      0.5,
      SELF_VIEW_SIZE,
    );
    expect(pos).toEqual({ x: 1000, y: 300 });
  });

  it('גרירה רחוקה נעצרת בשולי הבמה', () => {
    const pos = dragSelfView(
      { x: 800, y: 400 },
      { x: 0, y: 0 },
      { x: -3000, y: 3000 },
      1,
      SELF_VIEW_SIZE,
    );
    expect(pos).toEqual({
      x: SELF_VIEW_EDGE,
      y: STAGE_HEIGHT - SELF_VIEW_SIZE.height - SELF_VIEW_EDGE,
    });
  });

  it('scale לא תקין (0, שלילי, NaN) נחשב 1', () => {
    for (const scale of [0, -2, Number.NaN]) {
      expect(
        dragSelfView({ x: 500, y: 500 }, { x: 0, y: 0 }, { x: 20, y: 30 }, scale, SELF_VIEW_SIZE),
      ).toEqual({
        x: 520,
        y: 530,
      });
    }
  });

  it('תזוזה קטנה היא לחיצה, לא גרירה', () => {
    expect(isDrag({ x: 100, y: 100 }, { x: 102, y: 97 })).toBe(false);
    expect(isDrag({ x: 100, y: 100 }, { x: 104, y: 100 })).toBe(true);
    expect(isDrag({ x: 100, y: 100 }, { x: 100, y: 95 })).toBe(true);
  });
});

describe('«המצלמה שלי» — מה שנשמר במחשב', () => {
  it('נשמר ונקרא בחזרה', () => {
    const prefs = { pos: { x: 120, y: 340 }, minimized: true };
    expect(parseSelfViewPrefs(serializeSelfViewPrefs(prefs))).toEqual(prefs);
  });

  it('בלי ערך, או ערך פגום — ברירת המחדל', () => {
    expect(parseSelfViewPrefs(null)).toEqual(DEFAULT_SELF_VIEW_PREFS);
    expect(parseSelfViewPrefs('{')).toEqual(DEFAULT_SELF_VIEW_PREFS);
    expect(parseSelfViewPrefs('null')).toEqual(DEFAULT_SELF_VIEW_PREFS);
    expect(parseSelfViewPrefs('"x"')).toEqual(DEFAULT_SELF_VIEW_PREFS);
  });

  it('מיקום פגום — ברירת המחדל, אבל המזעור נשמר', () => {
    expect(parseSelfViewPrefs('{"x":"a","y":5,"minimized":true}')).toEqual({
      pos: DEFAULT_SELF_VIEW_POS,
      minimized: true,
    });
  });

  it('מיקום שנשמר במסך אחר ויוצא מהבמה — חוזר לתוכה', () => {
    const prefs = parseSelfViewPrefs('{"x":5000,"y":-40,"minimized":false}');
    expect(inside(prefs.pos, SELF_VIEW_SIZE)).toBe(true);
  });
});
