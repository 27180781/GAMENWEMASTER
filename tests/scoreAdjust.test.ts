/**
 * תיקון ניקוד ידני באמצע משחק.
 *
 * שני מסלולים שאסור שיתערבבו: ניקוד **אישי** נכנס לניקוד של המשתתף במנוע,
 * ובונוס **קבוצתי** נשאר ברמת הקבוצה ואינו נוגע באף משתתף. הבדיקות כאן נועלות
 * גם את ההפרדה הזו וגם את מה שקורה כשחוזרים אחורה במשחק.
 */

import { describe, expect, it } from 'vitest';
import {
  adjustGroupBonus,
  adjustPlayerScore,
  groupBonusOf,
  GameEngine,
  MAX_ADJUST,
  normalizeDelta,
} from '../src/engine/index.ts';
import { groupStandings } from '../src/app/groupScore.ts';
import type { RosterData } from '../src/app/roster.ts';
import { fourAnswers, makeGame, makeSnapshot, rawSlide } from './helpers.ts';

describe('נרמול הקלט', () => {
  it('מספרים שלמים עוברים כמו שהם, כולל שליליים', () => {
    expect(normalizeDelta(10)).toBe(10);
    expect(normalizeDelta(-7)).toBe(-7);
    expect(normalizeDelta('25')).toBe(25);
  });

  it('★ קלט לא מספרי אינו משנה כלום', () => {
    for (const bad of ['', '   ', 'abc', null, undefined, NaN]) {
      expect(normalizeDelta(bad), String(bad)).toBe(0);
    }
  });

  it('★ תקרה — הקלדה מוטעית לא מחסלת משחק', () => {
    expect(normalizeDelta(999_999)).toBe(MAX_ADJUST);
    expect(normalizeDelta(-999_999)).toBe(-MAX_ADJUST);
  });

  it('שברים נחתכים לשלם', () => {
    expect(normalizeDelta(3.9)).toBe(3);
    expect(normalizeDelta(-3.9)).toBe(-3);
  });
});

describe('ניקוד אישי', () => {
  it('★ הוספה והפחתה', () => {
    expect(adjustPlayerScore({ a: 10 }, 'a', 5)).toEqual({ a: 15 });
    expect(adjustPlayerScore({ a: 10 }, 'a', -4)).toEqual({ a: 6 });
  });

  it('משתתף שעוד לא צבר ניקוד מתחיל מאפס', () => {
    expect(adjustPlayerScore({}, 'b', 7)).toEqual({ b: 7 });
  });

  it('★ לא יורדים מתחת לאפס — ניקוד שלילי על המסך הגדול נראה כתקלה', () => {
    expect(adjustPlayerScore({ a: 3 }, 'a', -10)).toEqual({ a: 0 });
  });

  it('לא נוגעים בשאר המשתתפים, והמקור אינו משתנה', () => {
    const before = { a: 10, b: 20 };
    const after = adjustPlayerScore(before, 'a', 5);
    expect(after).toEqual({ a: 15, b: 20 });
    expect(before).toEqual({ a: 10, b: 20 });
  });
});

describe('בונוס קבוצתי', () => {
  it('★ מצטבר', () => {
    let b = adjustGroupBonus({}, 'g1', 10);
    b = adjustGroupBonus(b, 'g1', 5);
    expect(groupBonusOf(b, 'g1')).toBe(15);
  });

  it('★ חזרה לאפס מוחקת את הרשומה — לא נשאר "בונוס 0"', () => {
    const b = adjustGroupBonus(adjustGroupBonus({}, 'g1', 10), 'g1', -10);
    expect(b).toEqual({});
    expect(groupBonusOf(b, 'g1')).toBe(0);
  });

  it('קנס מותר להיות שלילי — הקיזוז נעשה בדירוג, לא כאן', () => {
    expect(groupBonusOf(adjustGroupBonus({}, 'g1', -8), 'g1')).toBe(-8);
  });

  it('קבוצה בלי בונוס מחזירה 0, גם כשהרשומה חסרה', () => {
    expect(groupBonusOf(undefined, 'g1')).toBe(0);
    expect(groupBonusOf({}, 'g1')).toBe(0);
  });
});

/** מרשם: קטגוריה אחת, שתי קבוצות — אחת גדולה ואחת קטנה. */
function roster(): RosterData {
  return {
    players: [
      { id: '1', name: 'א' },
      { id: '2', name: 'ב' },
      { id: '3', name: 'ג' },
    ],
    categories: [
      {
        id: 'cat',
        name: 'קבוצות',
        groups: [
          { id: 'g1', name: 'גדולה' },
          { id: 'g2', name: 'קטנה' },
        ],
      },
    ],
    memberships: { '1': { cat: 'g1' }, '2': { cat: 'g1' }, '3': { cat: 'g2' } },
    pendingNames: [],
  };
}

describe('★ הבונוס הקבוצתי שווה בערכו בכל גודל קבוצה', () => {
  const scores = { '1': 10, '2': 10, '3': 10 }; // ממוצע 10 לשתי הקבוצות
  const times = {};

  it('בלי בונוס — שתי הקבוצות שוות', () => {
    const st = groupStandings(roster(), 'cat', scores, times);
    expect(st.map((s) => s.avgScore)).toEqual([10, 10]);
  });

  it('★ בונוס 10 מעלה ב-10 גם קבוצה של 2 וגם קבוצה של 1', () => {
    // זו הנקודה: לו הבונוס היה מתווסף לסכום, הקבוצה הקטנה הייתה מקבלת פי שניים.
    const big = groupStandings(roster(), 'cat', scores, times, { g1: 10 });
    expect(big.find((s) => s.groupId === 'g1')?.avgScore).toBe(20);
    const small = groupStandings(roster(), 'cat', scores, times, { g2: 10 });
    expect(small.find((s) => s.groupId === 'g2')?.avgScore).toBe(20);
  });

  it('★ הבונוס אינו נוגע בניקוד האישי ולא בסכום הקבוצה', () => {
    const st = groupStandings(roster(), 'cat', scores, times, { g1: 50 });
    const g1 = st.find((s) => s.groupId === 'g1')!;
    expect(g1.totalScore).toBe(20); // סכום החברים, בלי הבונוס
    expect(g1.bonus).toBe(50);
    expect(scores).toEqual({ '1': 10, '2': 10, '3': 10 }); // המשתתפים לא נגעו
  });

  it('★ הבונוס משנה את הדירוג', () => {
    const st = groupStandings(roster(), 'cat', scores, times, { g2: 5 });
    expect(st[0]!.groupId).toBe('g2');
  });

  it('קנס גדול נעצר באפס בתצוגה, אבל נשמר כמו שהוא בפאנל', () => {
    const st = groupStandings(roster(), 'cat', scores, times, { g1: -100 });
    const g1 = st.find((s) => s.groupId === 'g1')!;
    expect(g1.avgScore).toBe(0);
    expect(g1.bonus).toBe(-100);
  });
});

/**
 * ★ הבדיקה החשובה ביותר: תיקון ידני חייב לשרוד חזרה על שקופית.
 *
 * כשחוזרים על שקופית ומנקדים אותה מחדש, המנוע מקזז בדיוק את מה שהוענק עליה
 * בפעם הקודמת ואז מוסיף את החדש. אילו התיקון הידני היה נרשם באותו מקום, ניקוד
 * מחדש היה מוחק גם אותו — בלי שאיש ישים לב.
 */
describe('תיקון ידני מול חזרה על שקופית', () => {
  const T0 = 1_000_000;

  function toVoting(engine: GameEngine, from: number) {
    for (let i = 0; i < 6 && engine.getState().phase !== 'voting'; i += 1) {
      engine.dispatch({ type: 'ADVANCE', at: from + i });
    }
  }

  /** מריץ שקופית אחת עד סגירת ההצבעה, כך ש-a זוכה ב-10 נקודות. */
  function playedEngine() {
    const game = makeGame([
      rawSlide({ id: 1, type: 'trivia', que: 'ש1', answers: fourAnswers(1), scoreForQue: 10 }),
      rawSlide({ id: 2, type: 'trivia', que: 'ש2', answers: fourAnswers(1), scoreForQue: 10 }),
    ]);
    const engine = new GameEngine(game);
    toVoting(engine, T0);
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 1 }), at: T0 + 100 });
    engine.dispatch({ type: 'ADVANCE', at: T0 + 200 }); // סגירת הצבעה → ניקוד
    return engine;
  }

  it('המשתתף צבר ניקוד מהשאלה', () => {
    expect(playedEngine().getState().scores['a']).toBe(10);
  });

  it('★ תיקון ידני נכנס לניקוד', () => {
    const engine = playedEngine();
    engine.adjustScore('a', 5);
    expect(engine.getState().scores['a']).toBe(15);
  });

  it('חזרה אחורה לבדה אינה מקזזת ניקוד — הקיזוז קורה רק בניקוד מחדש', () => {
    const engine = playedEngine();
    engine.adjustScore('a', 5);
    engine.dispatch({ type: 'BACK', at: T0 + 300 });
    expect(engine.getState().scores['a']).toBe(15);
  });

  it('★ ניקוד מחדש של אותה שקופית מקזז את שלה בלבד — התיקון שורד', () => {
    const engine = playedEngine();
    engine.adjustScore('a', 5); // 10 מהשאלה + 5 ידניים
    engine.dispatch({ type: 'BACK', at: T0 + 300 });
    toVoting(engine, T0 + 400);
    // הפעם a טעה — הזיכוי הקודם מתקזז, ואין חדש. נשארים רק ה-5 הידניים.
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2 }), at: T0 + 500 });
    engine.dispatch({ type: 'ADVANCE', at: T0 + 600 });
    expect(engine.getState().scores['a']).toBe(5);
  });

  it('איפוס ניקוד כללי מוחק גם את התיקון', () => {
    const engine = playedEngine();
    engine.adjustScore('a', 5);
    engine.resetScores();
    expect(engine.getState().scores['a'] ?? 0).toBe(0);
  });

  it('תיקון של 0 או של מזהה ריק אינו משנה דבר', () => {
    const engine = playedEngine();
    engine.adjustScore('a', 0);
    engine.adjustScore('', 5);
    expect(engine.getState().scores['a']).toBe(10);
  });
});
