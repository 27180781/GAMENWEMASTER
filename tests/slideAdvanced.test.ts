/**
 * חלון "הגדרות שקופית מתקדמות" — הרשימה שמוצגת בכפתור ⚙, לפי SLIDESETTINGS.md §2.
 *
 * עד כה החלון נגזר מהסכימה והציג כל מפתח שקיים ב-`setting`, כולל שדות שהמנוע
 * מקבל אך אינו פועל לפיהם. הבדיקות כאן נועלות את הרשימה הקצרה והנכונה.
 */

import { describe, expect, it } from 'vitest';
import {
  advancedSettingsFor,
  collapseToSingleCorrect,
  gameGroupNames,
  hasAdvancedSettings,
  isMultiCorrect,
  toggleCorrect,
} from '../src/app/slideAdvanced.ts';
import type { Slide } from '../src/engine/index.ts';
import { makeGame, rawSlide } from './helpers.ts';

const ANSWERS = [
  { ans: 'א', correct: true, id: 1 },
  { ans: 'ב', correct: false, id: 2 },
  { ans: 'ג', correct: false, id: 3 },
];

const triviaSlide = (): Slide =>
  makeGame([rawSlide({ id: 1, type: 'trivia', que: 'ש', answers: ANSWERS })]).questions[0]!;

describe('אילו הגדרות מתקדמות מוצגות לכל סוג שקופית', () => {
  it('★ טריוויה — אחת-עשרה ההגדרות, בסדר של העורך המקוון', () => {
    expect(advancedSettingsFor('trivia')).toEqual([
      'multiCorrect',
      'majorityDecides',
      'groupRestriction',
      'allowChangeVote',
      'liveVoteCounts',
      'firstClicker',
      'automaticSkip',
      'slidBackgroundMedia',
      'scoringReduction',
      'descendingScore',
      'imageReveal',
    ]);
  });

  it('★ תשובה בתמונה — הכול חוץ מ"מספר תשובות נכונות" (המתג שלה מעל התשובות); ניקוד יורד וחשיפה כן', () => {
    expect(advancedSettingsFor('ans_images')).not.toContain('multiCorrect');
    expect(advancedSettingsFor('ans_images')).toContain('descendingScore');
    expect(advancedSettingsFor('ans_images')).toContain('imageReveal');
    expect(advancedSettingsFor('ans_images')).toContain('majorityDecides');
    expect(advancedSettingsFor('ans_images')).toHaveLength(10);
  });

  it('★ סקר — בלי "מספר תשובות נכונות", בלי ניקוד יורד ובלי חשיפה: אין בו תשובה נכונה', () => {
    expect(advancedSettingsFor('survey')).not.toContain('multiCorrect');
    expect(advancedSettingsFor('survey')).not.toContain('descendingScore');
    expect(advancedSettingsFor('survey')).not.toContain('imageReveal');
    expect(advancedSettingsFor('survey')).not.toContain('majorityDecides');
    expect(advancedSettingsFor('survey')).toContain('liveVoteCounts');
    expect(advancedSettingsFor('survey')).toHaveLength(7);
  });

  it('★ הימור — רק מה שנוגע להצבעה: קבוצה, שינוי הצבעה, מונה חי, מעבר אוטומטי, רקע', () => {
    expect(advancedSettingsFor('bet')).toEqual([
      'groupRestriction',
      'allowChangeVote',
      'liveVoteCounts',
      'automaticSkip',
      'slidBackgroundMedia',
    ]);
  });

  it('★ טקסט — רק רקע ספציפי; מדיה ופונקציה — אין חלון בכלל', () => {
    expect(advancedSettingsFor('subject')).toEqual(['slidBackgroundMedia']);
    expect(hasAdvancedSettings('media')).toBe(false);
    expect(hasAdvancedSettings('function')).toBe(false);
    expect(hasAdvancedSettings('subject')).toBe(true);
  });

  it('★ השדות הלא-פעילים אינם מוצגים לאף סוג', () => {
    // slideStartVoting, playAfterClicking, exitGame, answerIsSequenceClicks,
    // fullscreen, showInLoop, correctlyAnsweredBefore — שרידים מהמערכת הישנה.
    const all = new Set(
      ['trivia', 'survey', 'ans_images', 'bet', 'subject', 'media', 'function'].flatMap(
        advancedSettingsFor,
      ),
    );
    for (const dead of [
      'slideStartVoting',
      'playAfterClicking',
      'exitGame',
      'answerIsSequenceClicks',
      'fullscreen',
      'showInLoop',
      'correctlyAnsweredBefore',
    ]) {
      expect(all.has(dead as never), dead).toBe(false);
    }
  });
});

describe('מספר תשובות נכונות', () => {
  it('שקופית רגילה אינה "מספר תשובות נכונות"', () => {
    expect(isMultiCorrect(triviaSlide())).toBe(false);
  });

  it('★ סימון תשובה שנייה — שתיהן נכונות', () => {
    const s = toggleCorrect(triviaSlide(), 2);
    expect(s.question.answers.filter((a) => a.correct).map((a) => a.id)).toEqual([1, 3]);
    expect(isMultiCorrect(s)).toBe(true);
  });

  it('★ אי אפשר להוריד לאפס תשובות נכונות — קובץ כזה לא נטען', () => {
    const s = toggleCorrect(triviaSlide(), 0);
    expect(s.question.answers.filter((a) => a.correct)).toHaveLength(1);
  });

  it('★ כיבוי המתג — חוזרים לתשובה הנכונה הראשונה', () => {
    const multi = toggleCorrect(triviaSlide(), 2);
    const back = collapseToSingleCorrect(multi);
    expect(back.question.answers.map((a) => a.correct)).toEqual([true, false, false]);
  });

  it('שקופית בלי אף תשובה נכונה מקבלת את הראשונה', () => {
    const slide = triviaSlide();
    const none: Slide = {
      ...slide,
      question: {
        ...slide.question,
        answers: slide.question.answers.map((a) => ({ ...a, correct: false })),
      },
    };
    expect(collapseToSingleCorrect(none).question.answers[0]!.correct).toBe(true);
  });
});

describe('בורר הקבוצות של "שיוך השאלה לקבוצה"', () => {
  it('★ שמות ייחודיים בלבד, בלי ריקים, ממוינים', () => {
    expect(
      gameGroupNames([
        { groupName: 'בית' },
        { groupName: '' },
        { groupName: 'אולם' },
        { groupName: ' בית ' },
        { groupName: '   ' },
      ]),
    ).toEqual(['אולם', 'בית']);
  });

  it('משחק בלי קבוצות — רשימה ריקה (הבורר מציג "כל המשתתפים" בלבד)', () => {
    expect(gameGroupNames([])).toEqual([]);
  });
});
