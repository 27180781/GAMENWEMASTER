/**
 * צליל הצגת השאלה מאחורי כיסוי — מסך הפתיחה וטבלת המובילים בלעו אותו בשאלה 1
 * ובשאלה שאחרי טבלת המובילים האוטומטית.
 */

import { describe, expect, it } from 'vitest';
import {
  questionJustShown,
  questionSoundCovered,
  replayQuestionSound,
  type QuestionSoundView,
} from '../src/app/questionSound.ts';

/** שאלה שרק עלתה: מוצגת, בלי תשובות חשופות, לפני ההצבעה. */
const justShown: QuestionSoundView = {
  votable: true,
  phase: 'showing',
  activeMedia: null,
  questionShown: true,
  answersShown: 0,
  revealCorrect: false,
};

describe('questionSoundCovered', () => {
  it('מסך הפתיחה ומסכי הסיום מכסים את השאלה', () => {
    expect(questionSoundCovered('opening', false)).toBe(true);
    expect(questionSoundCovered('winners', false)).toBe(true);
    expect(questionSoundCovered('scoreboard', false)).toBe(true);
  });

  it('טבלת המובילים מכסה את השאלה באמצע המשחק', () => {
    expect(questionSoundCovered('playing', true)).toBe(true);
  });

  it('משחק בלי טבלה — השאלה גלויה', () => {
    expect(questionSoundCovered('playing', false)).toBe(false);
  });
});

describe('questionJustShown', () => {
  it('שאלה שרק עלתה', () => {
    expect(questionJustShown(justShown)).toBe(true);
  });

  it('לא אחרי שנחשפה תשובה — הצליל כבר שייך לרגע שעבר', () => {
    expect(questionJustShown({ ...justShown, answersShown: 1 })).toBe(false);
  });

  it('לא בהצבעה, בתוצאות או בסוף המשחק', () => {
    expect(questionJustShown({ ...justShown, phase: 'voting' })).toBe(false);
    expect(questionJustShown({ ...justShown, phase: 'results' })).toBe(false);
    expect(questionJustShown({ ...justShown, phase: 'ended' })).toBe(false);
    expect(questionJustShown({ ...justShown, revealCorrect: true })).toBe(false);
  });

  it('לא כשמדיית פתיחה או סיום על המסך — הרווח שמסיים אותה מנגן את הצליל', () => {
    expect(questionJustShown({ ...justShown, activeMedia: 'open', questionShown: false })).toBe(
      false,
    );
    expect(questionJustShown({ ...justShown, activeMedia: 'end' })).toBe(false);
  });

  it('לא כשהשאלה עוד לא הוצגה (חזרה אחורה ב-2) או בשקופית בלי הצבעה', () => {
    expect(questionJustShown({ ...justShown, questionShown: false })).toBe(false);
    expect(questionJustShown({ ...justShown, votable: false })).toBe(false);
  });
});

describe('replayQuestionSound', () => {
  const uncovered = { wasCovered: true, covered: false, slideChanged: false };

  it('שאלה 1: רווח שמוריד את מסך הפתיחה מנגן את צליל השאלה', () => {
    // כמו שהשלבים מגיעים: opening → playing, והשאלה עלתה כבר מאחורי מסך הפתיחה
    const wasCovered = questionSoundCovered('opening', false);
    const covered = questionSoundCovered('playing', false);
    expect(replayQuestionSound({ wasCovered, covered, slideChanged: false, view: justShown })).toBe(
      true,
    );
  });

  it('השאלה שאחרי טבלת המובילים האוטומטית: סגירת הטבלה מנגנת את צליל השאלה', () => {
    const wasCovered = questionSoundCovered('playing', true);
    const covered = questionSoundCovered('playing', false);
    expect(replayQuestionSound({ wasCovered, covered, slideChanged: false, view: justShown })).toBe(
      true,
    );
  });

  it('רק במעבר מכוסה → גלוי, ולא בכל רינדור', () => {
    expect(replayQuestionSound({ ...uncovered, wasCovered: false, view: justShown })).toBe(false);
    expect(replayQuestionSound({ ...uncovered, covered: true, view: justShown })).toBe(false);
    expect(
      replayQuestionSound({
        wasCovered: false,
        covered: true,
        slideChanged: false,
        view: justShown,
      }),
    ).toBe(false);
  });

  it('לא כשהשקופית התחלפה באותו מעבר — הכניסה אליה כבר ניגנה (בלי צליל כפול)', () => {
    expect(replayQuestionSound({ ...uncovered, slideChanged: true, view: justShown })).toBe(false);
  });

  it('טבלה שנפתחה ונסגרה אחרי חשיפת תשובות, בהצבעה או על מדיית פתיחה — בלי צליל שאלה', () => {
    expect(replayQuestionSound({ ...uncovered, view: { ...justShown, answersShown: 2 } })).toBe(
      false,
    );
    expect(
      replayQuestionSound({
        ...uncovered,
        view: { ...justShown, phase: 'voting', answersShown: 3 },
      }),
    ).toBe(false);
    expect(
      replayQuestionSound({
        ...uncovered,
        view: { ...justShown, activeMedia: 'open', questionShown: false },
      }),
    ).toBe(false);
  });
});
