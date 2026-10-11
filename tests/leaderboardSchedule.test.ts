/**
 * תזמון טבלת המובילים האוטומטית — ספירת שאלות שהושלמו + מתי להציג.
 */

import { describe, expect, it } from 'vitest';
import {
  autoLeaderboardStep,
  completedQuestionCount,
  shouldShowLeaderboard,
} from '../src/app/leaderboardSchedule.ts';
import { fourAnswers, makeGame, rawSlide } from './helpers.ts';

// משחק: 3 שאלות (trivia) + שקופית טקסט (subject, לא מצביעה) באמצע
const game = makeGame([
  rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1) }),
  rawSlide({ id: 2, type: 'trivia', answers: fourAnswers(2) }),
  rawSlide({ id: 5, type: 'subject', que: 'הפסקה' }),
  rawSlide({ id: 3, type: 'trivia', answers: fourAnswers(3) }),
]);

describe('completedQuestionCount', () => {
  it('סופר רק שקופיות מצביעות שהושלמו (מתעלם מ-subject ומ-id לא קיים)', () => {
    expect(completedQuestionCount(game, [])).toBe(0);
    expect(completedQuestionCount(game, [1])).toBe(1);
    expect(completedQuestionCount(game, [1, 5])).toBe(1); // 5 = subject, לא נספר
    expect(completedQuestionCount(game, [1, 2, 5])).toBe(2);
    expect(completedQuestionCount(game, [1, 2, 3, 5])).toBe(3);
    expect(completedQuestionCount(game, [1, 99])).toBe(1); // id לא קיים
  });

  it('שקופית הימור מצביעה אבל אינה שאלה — לא נספרת', () => {
    const withBet = makeGame([
      rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1) }),
      { ...rawSlide({ id: 7, type: 'survey', answers: fourAnswers(0) }), type: 'bet' },
      rawSlide({ id: 2, type: 'trivia', answers: fourAnswers(2) }),
    ]);
    expect(completedQuestionCount(withBet, [1, 7])).toBe(1);
    expect(completedQuestionCount(withBet, [1, 7, 2])).toBe(2);
  });
});

describe('shouldShowLeaderboard', () => {
  it('מכובה כש-showAfter הוא null / 0 / שלילי', () => {
    expect(shouldShowLeaderboard(3, null)).toBe(false);
    expect(shouldShowLeaderboard(3, 0)).toBe(false);
    expect(shouldShowLeaderboard(3, -1)).toBe(false);
  });

  it('מציג בכל כפולה חיובית של showAfter', () => {
    expect(shouldShowLeaderboard(0, 3)).toBe(false); // 0 שאלות — לא מציג
    expect(shouldShowLeaderboard(1, 3)).toBe(false);
    expect(shouldShowLeaderboard(2, 3)).toBe(false);
    expect(shouldShowLeaderboard(3, 3)).toBe(true);
    expect(shouldShowLeaderboard(6, 3)).toBe(true);
    expect(shouldShowLeaderboard(4, 3)).toBe(false);
  });

  it('showAfter=1 — מציג אחרי כל שאלה', () => {
    expect(shouldShowLeaderboard(1, 1)).toBe(true);
    expect(shouldShowLeaderboard(2, 1)).toBe(true);
  });
});

describe('autoLeaderboardStep', () => {
  it('נפתחת בכל כפולה של N, פעם אחת', () => {
    expect(autoLeaderboardStep(1, 2, 2)).toEqual({ handled: 2, show: true });
    expect(autoLeaderboardStep(2, 3, 2)).toEqual({ handled: 3, show: false });
    expect(autoLeaderboardStep(3, 4, 2)).toEqual({ handled: 4, show: true });
  });

  it('חזרה אחורה ואז קדימה לא פותחת שוב את הטבלה שכבר הוצגה', () => {
    // בשאלה 4 (3 הושלמו) Backspace מחזיר לשאלה 3 — הספירה יורדת ל-2
    expect(autoLeaderboardStep(3, 2, 2)).toEqual({ handled: 3, show: false });
    // ושוב קדימה — 3 הושלמו, כבר טופל
    expect(autoLeaderboardStep(3, 3, 2)).toEqual({ handled: 3, show: false });
    // השאלה הבאה שמושלמת לראשונה — 4, נקודת טבלה חדשה
    expect(autoLeaderboardStep(3, 4, 2)).toEqual({ handled: 4, show: true });
  });

  it('מכובה — מתקדמת בלי להציג', () => {
    expect(autoLeaderboardStep(0, 5, null)).toEqual({ handled: 5, show: false });
  });

  it('התחלה מחדש (handled = 0) מציגה שוב מההתחלה', () => {
    expect(autoLeaderboardStep(0, 2, 2)).toEqual({ handled: 2, show: true });
  });
});
