/**
 * «מסך מנצחים» בשקופית פונקציה (src/app/screenWinners.ts): מאז 2026-11-26 (בקשת
 * נסים) המנצחים נחשפים בו אחד-אחד, מהמקום האחרון לראשון, כמו במסך המנצחים שבסוף
 * המשחק. כאן נבדקים הכללים הטהורים ש-GameHost מחבר: מה הרווח והצעד אחורה עושים,
 * מתי הרווח עובר לשקופית הבאה, ומה קורה בכל כניסה לשקופית.
 */

import { describe, expect, it } from 'vitest';
import {
  GameEngine,
  WINNERS_CHAMPION_GUARD_MS,
  WINNERS_CHAMPION_SPEAK_MS,
  WINNERS_MAX,
  type Slide,
} from '../src/engine/index.ts';
import {
  isWinnersScreenSlide,
  NO_SCREEN_REVEAL,
  SCREEN_AUTO_FIRST_MS,
  SCREEN_AUTO_REVEAL_MS,
  screenAutoHoldMs,
  screenAutoRevealMs,
  screenBack,
  screenForward,
  screenNextPlace,
  screenRevealFor,
  screenRevealStep,
  screenShownAfter,
  screenWinnersTotal,
  type ScreenReveal,
} from '../src/app/screenWinners.ts';
import { fourAnswers, makeGame, makeSnapshot, rawSlide } from './helpers.ts';

/** שקופית פונקציה גולמית, כמו שהבונה שולח אותה. */
function functionSlide(id: number, fn: Record<string, unknown>): Record<string, unknown> {
  return { ...rawSlide({ id, type: 'media' }), type: 'function', function: fn };
}

function slideOf(raw: Record<string, unknown>): Slide {
  return makeGame([raw]).questions[0]!;
}

describe('איזו שקופית היא «מסך מנצחים»', () => {
  it('★ פונקציה «מסך» מסוג מנצחים — כן; טבלת מובילים — לא (היא לא השתנתה)', () => {
    expect(isWinnersScreenSlide(slideOf(functionSlide(1, { action: 'screen', screen: { type: 'winners' } })))).toBe(true);
    expect(
      isWinnersScreenSlide(slideOf(functionSlide(1, { action: 'screen', screen: { type: 'leaderboard' } }))),
    ).toBe(false);
  });

  it('«מסך» בלי סוג — מסך מנצחים, כמו ש-SlideView מצייר אותו', () => {
    expect(isWinnersScreenSlide(slideOf(functionSlide(1, { action: 'screen' })))).toBe(true);
  });

  it('פעולות פונקציה אחרות ושקופיות רגילות — לא', () => {
    expect(isWinnersScreenSlide(slideOf(functionSlide(1, { action: 'score', score: { operation: 'reset_all' } })))).toBe(
      false,
    );
    expect(isWinnersScreenSlide(slideOf(rawSlide({ id: 1, type: 'trivia', que: 'ש', answers: fourAnswers(1) })))).toBe(
      false,
    );
    expect(isWinnersScreenSlide(slideOf(rawSlide({ id: 1, type: 'subject', que: 'כותרת' })))).toBe(false);
  });
});

describe('כמה מקומות במסך', () => {
  it('מי שיש לו ניקוד, עד WINNERS_MAX — בדיוק כמו המסך עצמו', () => {
    expect(screenWinnersTotal(0)).toBe(0);
    expect(screenWinnersTotal(3)).toBe(3);
    expect(screenWinnersTotal(WINNERS_MAX)).toBe(WINNERS_MAX);
    expect(screenWinnersTotal(12)).toBe(WINNERS_MAX);
  });
});

describe('הרווח במסך', () => {
  it('★ כל עוד יש מקומות מוסתרים — חושף את הבא', () => {
    expect(screenForward(0, 3, Number.POSITIVE_INFINITY)).toBe('reveal');
    expect(screenForward(2, 3, Number.POSITIVE_INFINITY)).toBe('reveal');
  });

  it('★ אחרי המקום הראשון: ממתין לסוף התיפוף, ורק אז עובר לשקופית הבאה', () => {
    expect(screenForward(3, 3, 0)).toBe('wait');
    expect(screenForward(3, 3, WINNERS_CHAMPION_GUARD_MS - 1)).toBe('wait');
    expect(screenForward(3, 3, WINNERS_CHAMPION_GUARD_MS)).toBe('next');
  });

  it('«אין משתתפים עם ניקוד» — הרווח עובר מיד, כמו קודם', () => {
    expect(screenForward(0, 0, Number.NEGATIVE_INFINITY)).toBe('next');
  });

  it('המקום שהרווח הבא חושף: מהאחרון לראשון, ואז אין', () => {
    expect([0, 1, 2, 3].map((shown) => screenNextPlace(shown, 3))).toEqual([3, 2, 1, null]);
    expect(screenNextPlace(0, 0)).toBeNull();
  });
});

describe('הצעד אחורה במסך', () => {
  it('★ מסתיר את המקום האחרון שנחשף; בלי חשופים — לשקופית הקודמת', () => {
    expect(screenBack(2)).toBe('hide');
    expect(screenBack(1)).toBe('hide');
    expect(screenBack(0)).toBe('previous');
  });

  it('המספר נשאר בין 0 לכמות המקומות', () => {
    expect(screenShownAfter(0, -1, 3)).toBe(0);
    expect(screenShownAfter(3, 1, 3)).toBe(3);
    expect(screenShownAfter(1, 1, 3)).toBe(2);
    // מספר שנשמר כשהיו יותר מקומות — נחתך לפני הצעד
    expect(screenShownAfter(5, -1, 3)).toBe(2);
  });
});

/** כמו GameHost: רווח (advanceStep) וצעד אחורה (stepBack) בשקופית אחת. */
function host(total: number, slideId = 7, entry = 1) {
  let rec: ScreenReveal = NO_SCREEN_REVEAL;
  const shown = () => screenRevealFor(rec, slideId, entry).shown;
  return {
    shown,
    space(at: number): 'reveal' | 'wait' | 'next' {
      const mine = screenRevealFor(rec, slideId, entry);
      const step = screenForward(mine.shown, total, at - mine.championAt);
      if (step === 'reveal') rec = screenRevealStep(rec, slideId, entry, 1, total, at);
      return step;
    },
    back(at: number): 'hide' | 'previous' {
      const step = screenBack(shown());
      if (step === 'hide') rec = screenRevealStep(rec, slideId, entry, -1, total, at);
      return step;
    },
  };
}

describe('מהלך שלם בשקופית, כמו שהמנחה לוחץ', () => {
  it('★ שלושה מנצחים: שלוש לחיצות חושפות, לחיצה כפולה לא קוטעת את התיפוף, ואז השקופית הבאה', () => {
    const h = host(3);
    expect(h.shown()).toBe(0);
    expect(h.space(0)).toBe('reveal');
    expect(h.shown()).toBe(1);
    expect(h.space(1000)).toBe('reveal');
    expect(h.space(2000)).toBe('reveal'); // המקום הראשון — התיפוף מתחיל
    expect(h.shown()).toBe(3);
    expect(h.space(2100)).toBe('wait'); // לחיצה כפולה
    expect(h.space(2000 + WINNERS_CHAMPION_GUARD_MS - 1)).toBe('wait');
    expect(h.space(2000 + WINNERS_CHAMPION_GUARD_MS)).toBe('next');
  });

  it('★ אחורה מסתיר אחד-אחד עד הסוף, ורק אז חוזר לשקופית הקודמת', () => {
    const h = host(3);
    h.space(0);
    h.space(100);
    expect(h.back(200)).toBe('hide');
    expect(h.shown()).toBe(1);
    expect(h.back(300)).toBe('hide');
    expect(h.shown()).toBe(0);
    expect(h.back(400)).toBe('previous');
  });

  it('★ המקום הראשון הוסתר ונחשף שוב — התיפוף נספר מהחשיפה החדשה', () => {
    const h = host(2);
    h.space(0);
    h.space(1000); // המקום הראשון
    h.back(5000);
    expect(h.space(6000)).toBe('reveal'); // שוב המקום הראשון
    expect(h.space(6000 + WINNERS_CHAMPION_GUARD_MS - 1)).toBe('wait');
    expect(h.space(6000 + WINNERS_CHAMPION_GUARD_MS)).toBe('next');
  });

  it('מנצח אחד — לחיצה אחת חושפת אותו (עם התיפוף), והבאה אחרי השמירה עוברת', () => {
    const h = host(1);
    expect(h.space(0)).toBe('reveal');
    expect(h.space(10)).toBe('wait');
    expect(h.space(WINNERS_CHAMPION_GUARD_MS)).toBe('next');
  });
});

describe('כל כניסה לשקופית מתחילה בלי אף מקום חשוף', () => {
  it('★ רשומה של כניסה אחרת או של שקופית אחרת — 0', () => {
    const rec = screenRevealStep(NO_SCREEN_REVEAL, 7, 1, 1, 3, 100);
    expect(screenRevealFor(rec, 7, 1)).toEqual({ shown: 1, championAt: Number.NEGATIVE_INFINITY });
    expect(screenRevealFor(rec, 7, 2).shown).toBe(0); // חזרה לאותה שקופית
    expect(screenRevealFor(rec, 8, 1).shown).toBe(0); // שקופית אחרת
  });

  it('צעד בכניסה חדשה מתחיל מ-0, לא ממה שנחשף בכניסה הקודמת', () => {
    let rec = NO_SCREEN_REVEAL;
    for (let i = 0; i < 3; i++) rec = screenRevealStep(rec, 7, 1, 1, 3, i);
    rec = screenRevealStep(rec, 7, 2, 1, 3, 50);
    expect(rec).toEqual({ slideId: 7, entry: 2, shown: 1, championAt: Number.NEGATIVE_INFINITY });
  });

  it('רווח נוסף אחרי שכולם חשופים לא מזיז את זמן המקום הראשון', () => {
    let rec = NO_SCREEN_REVEAL;
    rec = screenRevealStep(rec, 7, 1, 1, 1, 100);
    expect(rec.championAt).toBe(100);
    rec = screenRevealStep(rec, 7, 1, 1, 1, 900);
    expect(rec.championAt).toBe(100);
  });

  it('★ עם המנוע האמיתי: חזרה לשקופית ושוב קדימה — כניסה חדשה, מ-0', () => {
    const engine = new GameEngine(
      makeGame([
        rawSlide({ id: 1, type: 'trivia', que: 'ש1', answers: fourAnswers(2), scoreForQue: 10, timeForQue: 15 }),
        functionSlide(2, { action: 'screen', screen: { type: 'winners' } }),
        rawSlide({ id: 3, type: 'subject', que: 'אחרי המסך' }),
      ]),
    );
    engine.dispatch({ type: 'OPEN_VOTING', at: 0 });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2, b: 2, c: 1 }), at: 1000 });
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: 15_000 });
    engine.dispatch({ type: 'ADVANCE', at: 16_000 });
    expect(isWinnersScreenSlide(engine.getCurrentSlide())).toBe(true);

    const total = screenWinnersTotal(engine.getWinners(engine.getGame().setting.multiWinners).length);
    expect(total).toBe(Math.min(WINNERS_MAX, engine.getWinners(engine.getGame().setting.multiWinners).length));
    expect(total).toBeGreaterThanOrEqual(2);

    const first = engine.getState();
    let rec = NO_SCREEN_REVEAL;
    rec = screenRevealStep(rec, first.currentSlideId, first.slideEntry, 1, total, 17_000);
    expect(screenRevealFor(rec, first.currentSlideId, first.slideEntry).shown).toBe(1);

    engine.dispatch({ type: 'BACK', at: 18_000 });
    engine.dispatch({ type: 'ADVANCE', at: 19_000 });
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: 20_000 });
    engine.dispatch({ type: 'ADVANCE', at: 21_000 });
    const again = engine.getState();
    expect(again.currentSlideId).toBe(first.currentSlideId);
    expect(again.slideEntry).not.toBe(first.slideEntry);
    expect(screenRevealFor(rec, again.currentSlideId, again.slideEntry).shown).toBe(0);
  });

  it('multiWinners קובע כמה מקומות, גם כשיש יותר משחקנים עם ניקוד', () => {
    const engine = new GameEngine(
      makeGame(
        [
          rawSlide({ id: 1, type: 'trivia', que: 'ש1', answers: fourAnswers(2), scoreForQue: 10, timeForQue: 15 }),
          functionSlide(2, { action: 'screen', screen: { type: 'winners' } }),
        ],
        {},
      ),
    );
    engine.dispatch({ type: 'OPEN_VOTING', at: 0 });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2, b: 2, c: 2 }), at: 1000 });
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: 15_000 });
    expect(screenWinnersTotal(engine.getWinners(2).length)).toBe(2);
    expect(screenWinnersTotal(engine.getWinners(5).length)).toBe(3);
  });
});

describe('מעבר אוטומטי במסך', () => {
  it('★ החשיפה ממשיכה לבד: הראשונה אחרי שהמסך נכנס, ואז אחת בכל פרק זמן קבוע', () => {
    expect(screenAutoRevealMs(0, 3)).toBe(SCREEN_AUTO_FIRST_MS);
    expect(screenAutoRevealMs(1, 3)).toBe(SCREEN_AUTO_REVEAL_MS);
    expect(screenAutoRevealMs(2, 3)).toBe(SCREEN_AUTO_REVEAL_MS);
    expect(screenAutoRevealMs(3, 3)).toBeNull();
    expect(screenAutoRevealMs(0, 0)).toBeNull();
  });

  it('★ ההשהיה עד השקופית הבאה נספרת מהרגע ששם המקום הראשון על המסך', () => {
    expect(screenAutoHoldMs(3)).toBe(WINNERS_CHAMPION_SPEAK_MS);
    expect(screenAutoHoldMs(0)).toBe(0);
  });

  it('בין חשיפה לחשיפה יש מספיק זמן לאפקטים של מקום (בערך שנייה וחצי)', () => {
    expect(SCREEN_AUTO_REVEAL_MS).toBeGreaterThanOrEqual(1500);
  });
});
