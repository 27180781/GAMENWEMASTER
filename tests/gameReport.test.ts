/**
 * בניית גליונות הסיכום (gameReport.ts) — משתתפים/שאלות/קבוצות — ממצב משחק שוחק.
 */

import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/engine/index.ts';
import { fourAnswers, makeGame, makeSnapshot, rawSlide } from './helpers.ts';
import { buildReportSheets, reportFilename } from '../src/app/gameReport.ts';
import { addCategory, addGroup, assignGroupByNumber, EMPTY_ROSTER, type RosterData } from '../src/app/roster.ts';

function twoTrivia() {
  return makeGame([
    rawSlide({ id: 1, type: 'trivia', que: 'בירת צרפת?', answers: fourAnswers(2), scoreForQue: 10, timeForQue: 15 }),
    rawSlide({ id: 2, type: 'trivia', que: '2+2?', answers: fourAnswers(1), scoreForQue: 10, timeForQue: 15 }),
  ]);
}

/** משחק ששוחק עד הסוף: שקופית 1 (a,c נכון / b טעה), שקופית 2 (a,b נכון). */
function playedBoth(): GameEngine {
  const e = new GameEngine(twoTrivia());
  e.dispatch({ type: 'ADVANCE', at: 0 }); // פתיחת הצבעה שקופית 1
  e.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2, b: 1, c: 2 }), at: 1000 });
  e.dispatch({ type: 'ADVANCE', at: 5000 }); // סגירה → תוצאות
  e.dispatch({ type: 'ADVANCE', at: 6000 }); // מעבר לשקופית 2
  e.dispatch({ type: 'ADVANCE', at: 7000 }); // פתיחת הצבעה שקופית 2
  e.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(2, 2, { a: 1, b: 1 }), at: 8000 });
  e.dispatch({ type: 'ADVANCE', at: 12000 }); // סגירה → תוצאות
  return e;
}

function roster(): RosterData {
  let r = addCategory(EMPTY_ROSTER, 'עיר', 'cat1');
  r = addGroup(r, 'cat1', 'אריות', 'g1');
  r = addGroup(r, 'cat1', 'נמרים', 'g2');
  r = assignGroupByNumber(r, 'a', 'cat1', 1);
  r = assignGroupByNumber(r, 'c', 'cat1', 1);
  r = assignGroupByNumber(r, 'b', 'cat1', 2);
  return r;
}

describe('buildReportSheets', () => {
  const sheets = buildReportSheets(twoTrivia(), playedBoth().getState(), roster(), (id) => id);
  const byName = Object.fromEntries(sheets.map((s) => [s.name, s.rows]));

  it('שלושה גליונות: משתתפים, שאלות, קבוצות', () => {
    expect(sheets.map((s) => s.name)).toEqual(['משתתפים', 'שאלות', 'קבוצות']);
  });

  it('משתתפים: מה כל אחד ענה בכל שאלה + נכונות + ניקוד, ממוין לפי ניקוד', () => {
    const rows = byName['משתתפים']!;
    expect(rows[0]).toEqual(['שם', 'מזהה', 'ש1', 'ש2', 'נענו', 'נכונות', 'ניקוד']);
    // a ראשון (ניקוד 20): ענה 2 ואז 1, 2 נכונות
    expect(rows[1]).toEqual(['a', 'a', 2, 1, 2, 2, 20]);
    // c לא ענה בשקופית 2 → תא ריק (null)
    const cRow = rows.find((r) => r[0] === 'c')!;
    expect(cRow).toEqual(['c', 'c', 2, null, 1, 1, 10]);
  });

  it('שאלות: פילוח הצבעות ותשובה נכונה ואחוזים', () => {
    const rows = byName['שאלות']!;
    expect(rows[0]).toEqual(['#', 'שאלה', 'תשובה נכונה', 'מס׳ עונים', 'ענו נכון', '% נכון', 'בחרו 1', 'בחרו 2', 'בחרו 3', 'בחרו 4']);
    // שקופית 1: נכונה 2, 3 עונים, 2 נכונים (67%), בחרו: 1→1, 2→2
    expect(rows[1]).toEqual([1, 'בירת צרפת?', '2', 3, 2, '67%', 1, 2, 0, 0]);
    // שקופית 2: נכונה 1, 2 עונים, 2 נכונים (100%)
    expect(rows[2]).toEqual([2, '2+2?', '1', 2, 2, '100%', 2, 0, 0, 0]);
  });

  it('קבוצות: דירוג לפי ממוצע — אריות (a,c ממוצע 15) לפני נמרים (b, 10)', () => {
    const rows = byName['קבוצות']!;
    expect(rows[0]).toEqual(['קטגוריה', 'קבוצה', 'מס׳', 'חברים', 'ניקוד כולל', 'ניקוד ממוצע', 'מהירות ממוצעת (שנ׳)']);
    expect(rows[1]!.slice(0, 6)).toEqual(['עיר', 'אריות', 1, 2, 30, 15]);
    expect(rows[2]!.slice(0, 6)).toEqual(['עיר', 'נמרים', 2, 1, 10, 10]);
  });
});

describe('reportFilename', () => {
  it('בונה שם קובץ עם שם המשחק ותאריך', () => {
    const game = { ...twoTrivia(), name: 'טריוויה/ערב' };
    const name = reportFilename(game, new Date('2026-07-13T10:00:00Z'));
    expect(name).toBe('סיכום-טריוויה ערב-2026-07-13.xlsx'); // '/' נוקה
  });
});
