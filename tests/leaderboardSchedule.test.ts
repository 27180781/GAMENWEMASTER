/**
 * תזמון טבלת המובילים האוטומטית — ספירת שאלות שהושלמו + מתי להציג.
 */

import { describe, expect, it } from 'vitest';
import { completedQuestionCount, shouldShowLeaderboard } from '../src/app/leaderboardSchedule.ts';
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
