/**
 * ניקוד יורד (setting.descendingScore) — הניקוד צולל ברציפות מהמקסימום לאפס
 * לאורך זמן המענה, ומי שעונה נכון מקבל את הערך שהיה על המסך ברגע הלחיצה.
 * הנוסחה (scoring.ts) משותפת למנוע ולתצוגה; כאן נועלים אותה ואת השילוב במנוע,
 * וגם את הניקוד של «תשובה בתמונה» שסומנה בה תשובה נכונה.
 */

import { describe, expect, it } from 'vitest';
import {
  GameEngine,
  descendingScoreAt,
  parseGameFile,
  scoredLikeTrivia,
} from '../src/engine/index.ts';
import { fourAnswers, makeGame, makeSnapshot, rawGame, rawSlide } from './helpers.ts';

const T0 = 1_000_000;

/** טריוויה (נכונה=2, ניקוד=10, 10 שניות) ואחריה שקופית טקסט. */
function triviaGame(settings: Record<string, unknown> = {}) {
  return makeGame([
    rawSlide({
      id: 1,
      type: 'trivia',
      que: 'שאלה?',
      answers: fourAnswers(2),
      scoreForQue: 10,
      timeForQue: 10,
      settings,
    }),
    rawSlide({ id: 2, type: 'subject', que: 'סוף' }),
  ]);
}

const DESCENDING = { descendingScore: { active: true, maxScore: 1000 } };

/** מנוע עם הצבעה פתוחה ב-T0. */
function opened(settings: Record<string, unknown> = DESCENDING): GameEngine {
  const engine = new GameEngine(triviaGame(settings));
  engine.dispatch({ type: 'ADVANCE', at: T0 });
  expect(engine.getState().phase).toBe('voting');
  return engine;
}

describe('descendingScoreAt — הנוסחה', () => {
  it('★ מקסימום בפתיחה, אפס בסוף, ליניארי באמצע — 1000 על 10 שניות = 100 לשנייה', () => {
    expect(descendingScoreAt(1000, 0, 10_000)).toBe(1000);
    expect(descendingScoreAt(1000, 1_000, 10_000)).toBe(900);
    expect(descendingScoreAt(1000, 2_500, 10_000)).toBe(750);
    expect(descendingScoreAt(1000, 5_000, 10_000)).toBe(500);
    expect(descendingScoreAt(1000, 10_000, 10_000)).toBe(0);
    expect(descendingScoreAt(1000, 12_000, 10_000)).toBe(0);
  });

  it('רציף (לא במנות) ומעוגל למספר שלם', () => {
    expect(descendingScoreAt(1000, 3_333, 10_000)).toBe(667);
    expect(descendingScoreAt(1000, 16, 10_000)).toBe(998);
    expect(descendingScoreAt(7, 5_000, 10_000)).toBe(4); // 3.5 → 4
  });

  it('זמן שלילי או לא תקין = מקסימום; בלי טיימר = מקסימום כל הזמן; מקסימום לא חיובי = אפס', () => {
    expect(descendingScoreAt(1000, -5, 10_000)).toBe(1000);
    expect(descendingScoreAt(1000, Number.NaN, 10_000)).toBe(1000);
    expect(descendingScoreAt(1000, 5_000, 0)).toBe(1000);
    expect(descendingScoreAt(0, 0, 10_000)).toBe(0);
    expect(descendingScoreAt(-3, 0, 10_000)).toBe(0);
  });
});

describe('סכימה — setting.descendingScore', () => {
  it('★ חסר בקובץ — כבוי, עם ברירת מחדל 1000 (קבצים שנוצרו לפני השדה)', () => {
    const slide = triviaGame().questions[0]!;
    expect(slide.setting.descendingScore).toEqual({ active: false, maxScore: 1000 });
  });

  it('★ ‎""‎ ב-maxScore (כלל הריקון של הבנאי) → 1000; מספר נשמר כמו שהוא', () => {
    const empty = triviaGame({ descendingScore: { active: true, maxScore: '' } }).questions[0]!;
    expect(empty.setting.descendingScore).toEqual({ active: true, maxScore: 1000 });
    const set = triviaGame({ descendingScore: { active: true, maxScore: 500 } }).questions[0]!;
    expect(set.setting.descendingScore).toEqual({ active: true, maxScore: 500 });
  });

  it('אובייקט חלקי — השדה החסר מקבל ברירת מחדל', () => {
    const slide = triviaGame({ descendingScore: { active: true } }).questions[0]!;
    expect(slide.setting.descendingScore).toEqual({ active: true, maxScore: 1000 });
  });
});

describe('ניקוד יורד במנוע', () => {
  it('★ כל מצביע מקבל את הניקוד של רגע הלחיצה — לפי elapsedMs שה-host מזריק', () => {
    const engine = opened();
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2 }), at: T0 + 100, elapsedMs: 0 });
    engine.dispatch({
      type: 'VOTE_SNAPSHOT',
      snapshot: makeSnapshot(2, 1, { a: 2, b: 2 }),
      at: T0 + 2_600,
      elapsedMs: 2_500,
    });
    engine.dispatch({
      type: 'VOTE_SNAPSHOT',
      snapshot: makeSnapshot(3, 1, { a: 2, b: 2, c: 2, d: 1 }),
      at: T0 + 7_100,
      elapsedMs: 7_000,
    });
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: T0 + 10_000 });
    // d טעה — בלי ניקוד; השאר לפי הזמן שלהם, לא לפי scoreForQue (10)
    expect(engine.getState().scores).toEqual({ a: 1000, b: 750, c: 300 });
  });

  it('★ בלי elapsedMs — הזמן נגזר מ-at פחות רגע הפתיחה', () => {
    const engine = opened();
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2 }), at: T0 + 5_000 });
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: T0 + 10_000 });
    expect(engine.getState().scores).toEqual({ a: 500 });
  });

  it('★ elapsedMs גובר על at — עצירת מנחה לא "שורפת" ניקוד', () => {
    // הקיר אומר 8 שניות, אבל 5 מהן היו עצירה — ה-host שולח 3.
    const engine = opened();
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2 }), at: T0 + 8_000, elapsedMs: 3_000 });
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: T0 + 15_000 });
    expect(engine.getState().scores).toEqual({ a: 700 });
  });

  it('★ מי שענה אחרי תום הזמן — אפס, ואינו נרשם בטבלה', () => {
    const engine = opened();
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2 }), at: T0 + 10_000, elapsedMs: 10_000 });
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: T0 + 10_000 });
    expect(engine.getState().scores).toEqual({});
  });

  it('★ בלי מידע זמן בכלל (לא at ולא elapsedMs) — הניקוד המקסימלי, בלי קריסה', () => {
    const engine = new GameEngine(triviaGame(DESCENDING));
    engine.dispatch({ type: 'ADVANCE' });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2 }) });
    engine.dispatch({ type: 'VOTING_TIMEOUT' });
    expect(engine.getState().scores).toEqual({ a: 1000 });
  });

  it('★ מחליף את scoreForQue ואת scoringReduction כשדולק', () => {
    const engine = opened({
      ...DESCENDING,
      scoringReduction: { active: true, seconds: 1, score: 3 },
    });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2 }), at: T0 + 5_000, elapsedMs: 5_000 });
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: T0 + 10_000 });
    expect(engine.getState().scores).toEqual({ a: 500 }); // לא 3 ולא 10
  });

  it('כבוי — הניקוד הרגיל (scoreForQue), בדיוק כמו קודם', () => {
    const engine = opened({ descendingScore: { active: false, maxScore: 1000 } });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2 }), at: T0 + 5_000, elapsedMs: 5_000 });
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: T0 + 10_000 });
    expect(engine.getState().scores).toEqual({ a: 10 });
  });

  it('הזמן נקבע בהצבעה הראשונה — גם כשמותר לשנות תשובה (כמו שובר-השוויון)', () => {
    const engine = opened({ ...DESCENDING, allowChangeVote: true });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 1 }), at: T0 + 1_000, elapsedMs: 1_000 });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(2, 1, { a: 2 }), at: T0 + 8_000, elapsedMs: 8_000 });
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: T0 + 10_000 });
    expect(engine.getState().scores).toEqual({ a: 900 });
  });

  it('★ חזרה לשקופית וניקוד מחדש — הניקוד הישן מקוזז, לא נערם', () => {
    const engine = opened();
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2 }), at: T0 + 7_000, elapsedMs: 7_000 });
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: T0 + 10_000 });
    expect(engine.getState().scores).toEqual({ a: 300 });

    engine.dispatch({ type: 'BACK', at: T0 + 12_000 }); // חזרה לאותה שקופית
    engine.dispatch({ type: 'ADVANCE', at: T0 + 20_000 }); // פתיחת הצבעה מחדש
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(9, 1, { a: 2 }), at: T0 + 20_000, elapsedMs: 0 });
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: T0 + 30_000 });
    expect(engine.getState().scores).toEqual({ a: 1000 });
  });
});

describe('תשובה בתמונה — מנוקדת כמו טריוויה כשסומנה בה תשובה נכונה', () => {
  /** כך מערכת יצירת המשחקים שולחת שקופית «תשובה בתמונה»: תשובה נכונה אחת. */
  const BUILDER_ANSWERS = [
    { ans: 'https://x.dev/1.jpg', correct: false, id: 1 },
    { ans: 'https://x.dev/2.jpg', correct: true, id: 2 },
    { ans: 'https://x.dev/3.jpg', correct: false, id: 3 },
  ];
  /** קובץ ישן: כולן correct: true — בחירה חופשית, אין "טעות". */
  const LEGACY_ANSWERS = BUILDER_ANSWERS.map((a) => ({ ...a, correct: true }));

  const imagesGame = (answers: typeof BUILDER_ANSWERS, settings: Record<string, unknown> = {}) =>
    makeGame([
      rawSlide({ id: 1, type: 'ans_images', que: 'איזו?', answers, scoreForQue: 7, timeForQue: 10, settings }),
      rawSlide({ id: 2, type: 'subject', que: 'סוף' }),
    ]);

  it('★ scoredLikeTrivia — נכונה אחת ושגויה אחת: כן; כולן נכונות: לא; סקר: לא; טריוויה: תמיד', () => {
    expect(scoredLikeTrivia(imagesGame(BUILDER_ANSWERS).questions[0]!)).toBe(true);
    expect(scoredLikeTrivia(imagesGame(LEGACY_ANSWERS).questions[0]!)).toBe(false);
    expect(scoredLikeTrivia(triviaGame().questions[0]!)).toBe(true);
    const survey = parseGameFile(
      rawGame([rawSlide({ id: 1, type: 'survey', que: 'ס', answers: fourAnswers(0), scoreForQue: 5 })]),
    ).questions[0]!;
    expect(scoredLikeTrivia(survey)).toBe(false);
  });

  it('★ הבוחר בתמונה הנכונה מקבל scoreForQue; השגוי — לא', () => {
    const engine = new GameEngine(imagesGame(BUILDER_ANSWERS));
    engine.dispatch({ type: 'ADVANCE', at: T0 });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2, b: 1 }), at: T0 + 1_000 });
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: T0 + 10_000 });
    expect(engine.getState().scores).toEqual({ a: 7 });
  });

  it('קובץ ישן (כולן נכונות) — נשאר בלי ניקוד, כמו קודם', () => {
    const engine = new GameEngine(imagesGame(LEGACY_ANSWERS));
    engine.dispatch({ type: 'ADVANCE', at: T0 });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2, b: 1 }), at: T0 + 1_000 });
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: T0 + 10_000 });
    expect(engine.getState().scores).toEqual({});
  });

  it('★ ניקוד יורד חל גם על תשובה בתמונה', () => {
    const engine = new GameEngine(imagesGame(BUILDER_ANSWERS, DESCENDING));
    engine.dispatch({ type: 'ADVANCE', at: T0 });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2, b: 1 }), at: T0 + 5_000, elapsedMs: 5_000 });
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: T0 + 10_000 });
    expect(engine.getState().scores).toEqual({ a: 500 });
  });
});
