/**
 * חוזה מול מערכת יצירת המשחקים (SLIDESETTINGS.md).
 *
 * המסמך מתאר בדיוק מה הבנאי שולח לכל שקופית. הבדיקות כאן מזינות את **הפלט
 * שבמסמך כלשונו** דרך הטוען האמיתי ומאמתות שכל שדה מגיע, במקום להסתמך על
 * קריאת קוד. מה שנשבר כאן פירושו שהחוזה בין שתי המערכות נסדק.
 */

import { describe, expect, it } from 'vitest';
import { GameEngine, parseGameFile, slideTypeSchema } from '../src/engine/index.ts';
import { FIXTURE_NAMES, loadFixtureRaw, makeSnapshot } from './helpers.ts';

const T0 = 1_000_000;

/** שקופית "בחירה מרובה" עם כל ההגדרות דלוקות — הפלט האמיתי מסעיף 4 במסמך. */
const DOC_SLIDE = {
  question: {
    que: 'נוסח השאלה',
    queMode: 'text',
    scoreForQue: 5,
    timeForQue: 20,
    src: 'Assets/question-0-src.jpg',
    answers: [
      { ans: 'א', correct: true, id: 1 },
      { ans: 'ב', correct: false, id: 2 },
      { ans: 'ג', correct: true, id: 3 },
    ],
  },
  openMedia: { src: 'Assets/question-0-open.jpg' },
  endMedia: { src: 'Assets/question-0-end.jpg' },
  backgroundMedia: { src: 'Assets/question-0-background.jpg' },
  setting: {
    allowChangeVote: true,
    firstClicker: true,
    automaticSkip: { active: true, seconds: 12 },
    scoringReduction: { active: true, seconds: 8, score: 2 },
    slidBackgroundMedia: { src: 'Assets/question-0-slidbg.jpg' },
    groupRestriction: { active: true, groupName: 'קבוצה א' },
    slideStartVoting: true,
    playAfterClicking: false,
    exitGame: false,
    correctlyAnsweredBefore: false,
    answerIsSequenceClicks: false,
    fullscreen: false,
    showInLoop: false,
  },
  type: 'trivia',
  id: 1,
};

const GAME_SETTING = {
  titleThroughoutGame: '',
  ansIsNumber: true,
  multiWinners: 1,
  winnersListCount: 5,
  mainColor: '#8B2FC9',
  secondaryColor: '#FFD23F',
  gameMedia: { src: '' },
  logo: { src: '' },
  triviaMedia: { src: '' },
  winnersMedia: { src: '' },
  winnersListMedia: { src: '' },
  sound: {
    playersConnectingMediaSound: { src: null },
    showQuestionMediaSound: { src: null },
    winnersMediaSound: { src: null },
    winnersListMediaSound: { src: null },
    genericMediaSound: { src: null },
    timerMediaSound: { src: null },
    inShowAnsMediaSound: { src: null },
  },
  limit: { type: 'clickers' },
};

const gameOf = (slides: unknown[]) =>
  parseGameFile({ id: 'g1', name: 'משחק', users: '{}', setting: GAME_SETTING, questions: slides });

describe('סעיף 1 — סוגי השקופיות', () => {
  it('★ ששת השמות שהמנוע מקבל', () => {
    for (const t of ['trivia', 'survey', 'ans_images', 'subject', 'media', 'function']) {
      expect(slideTypeSchema.safeParse(t).success, t).toBe(true);
    }
  });

  it('שמות המסד ממופים גם הם, כרשת ביטחון', () => {
    // המסמך אומר שהבנאי כבר מתרגם, אבל אם שם מסד ידלוף — עדיף שייטען.
    const map: Record<string, string> = {
      multiselect: 'trivia',
      poll: 'survey',
      image_answers: 'ans_images',
      text: 'subject',
    };
    for (const [from, to] of Object.entries(map)) {
      expect(slideTypeSchema.parse(from), from).toBe(to);
    }
  });
});

describe('סעיף 4 — כל שדה במיפוי מגיע למנוע', () => {
  const slide = gameOf([DOC_SLIDE]).questions[0]!;

  it('★ שדות השאלה', () => {
    expect(slide.question.que).toBe('נוסח השאלה');
    expect(slide.question.queMode).toBe('text');
    expect(slide.question.scoreForQue).toBe(5);
    expect(slide.question.timeForQue).toBe(20);
    expect(slide.question.src).toBe('Assets/question-0-src.jpg');
    expect(slide.question.answers).toHaveLength(3);
  });

  it('★ שלושת שדות המדיה', () => {
    expect(slide.openMedia.src).toBe('Assets/question-0-open.jpg');
    expect(slide.endMedia.src).toBe('Assets/question-0-end.jpg');
    expect(slide.backgroundMedia.src).toBe('Assets/question-0-background.jpg');
  });

  it('★ ההגדרות המתקדמות', () => {
    expect(slide.setting.allowChangeVote).toBe(true);
    expect(slide.setting.firstClicker).toBe(true);
    expect(slide.setting.automaticSkip).toEqual({ active: true, seconds: 12 });
    expect(slide.setting.scoringReduction).toEqual({ active: true, seconds: 8, score: 2 });
    expect(slide.setting.slidBackgroundMedia.src).toBe('Assets/question-0-slidbg.jpg');
    expect(slide.setting.groupRestriction).toEqual({ active: true, groupName: 'קבוצה א' });
  });

  it('סעיף 5 — השדות הקבועים מתקבלים כמו שהם', () => {
    expect(slide.setting.slideStartVoting).toBe(true);
    expect(slide.setting.playAfterClicking).toBe(false);
    expect(slide.setting.exitGame).toBe(false);
    expect(slide.setting.correctlyAnsweredBefore).toBe(false);
    expect(slide.setting.answerIsSequenceClicks).toBe(false);
    expect(slide.setting.fullscreen).toBe(false);
    expect(slide.setting.showInLoop).toBe(false);
  });
});

/**
 * ★ בחירה מרובה — שתי תשובות מסומנות נכונות. זו הנקודה שהכי קל לפספס: מנוע
 * שמחפש "את התשובה הנכונה" (יחיד) היה מזכה רק את הראשונה, וכל מי שבחר בשנייה
 * היה מקבל אפס בלי ששום דבר ייראה שבור.
 */
describe('בחירה מרובה — יותר מתשובה נכונה אחת', () => {
  const multi = () =>
    gameOf([
      {
        ...DOC_SLIDE,
        setting: { ...DOC_SLIDE.setting, firstClicker: false, scoringReduction: { active: false, seconds: '', score: '' }, groupRestriction: { active: false, groupName: '' } },
      },
    ]);

  it('הסכימה מקבלת שתי תשובות נכונות', () => {
    const answers = multi().questions[0]!.question.answers;
    expect(answers.filter((a) => a.correct).map((a) => a.id)).toEqual([1, 3]);
  });

  it('★ שתי התשובות הנכונות מזכות בניקוד; השגויה לא', () => {
    const engine = new GameEngine(multi());
    // openMedia ("מדיה לפני שקופית") הוא שלב בפני עצמו לפני השאלה, ולכן
    // מתקדמים עד שההצבעה נפתחת במקום להניח מספר קבוע של צעדים.
    for (let i = 0; i < 5 && engine.getState().phase !== 'voting'; i += 1) {
      engine.dispatch({ type: 'ADVANCE', at: T0 + i });
    }
    expect(engine.getState().phase).toBe('voting');
    engine.dispatch({
      type: 'VOTE_SNAPSHOT',
      // a בחר 1 (נכונה), b בחר 2 (שגויה), c בחר 3 (הנכונה השנייה)
      snapshot: makeSnapshot(1, 1, { a: 1, b: 2, c: 3 }),
      at: T0 + 1000,
    });
    engine.dispatch({ type: 'ADVANCE', at: T0 + 5000 });
    const scores = engine.getState().scores;
    expect(scores['a']).toBe(5);
    expect(scores['c']).toBe(5); // ★ לא רק הראשונה
    expect(scores['b'] ?? 0).toBe(0);
  });
});

/**
 * סעיף 5 — כלל הריקון. בשקופיות טקסט/מדיה/פונקציה הבנאי שולח מחרוזת ריקה
 * במקום מספר. בלי הנרמול הזה כל שקופית כזו הייתה נופלת בטעינה.
 */
describe('סעיף 5 — כלל הריקון', () => {
  const emptied = {
    ...DOC_SLIDE,
    id: 2,
    type: 'subject',
    question: { ...DOC_SLIDE.question, scoreForQue: '', timeForQue: '' },
    setting: {
      ...DOC_SLIDE.setting,
      automaticSkip: { active: false, seconds: '' },
      scoringReduction: { active: false, seconds: '', score: '' },
    },
  };

  it('★ מחרוזות ריקות מנורמלות למספרים, והקובץ נטען', () => {
    const slide = gameOf([emptied]).questions[0]!;
    expect(slide.question.scoreForQue).toBe(0);
    expect(slide.question.timeForQue).toBe(15);
    expect(slide.setting.automaticSkip.seconds).toBe(0);
    expect(slide.setting.scoringReduction.seconds).toBe(0);
    expect(slide.setting.scoringReduction.score).toBe(0);
  });

  it('אותו כלל בשקופית מדיה ובשקופית פונקציה', () => {
    for (const type of ['media', 'function']) {
      const g = gameOf([{ ...emptied, type, function: { action: 'screen', screen: { type: 'winners' } } }]);
      expect(g.questions[0]!.question.timeForQue, type).toBe(15);
    }
  });
});

/**
 * ניקוד ברירת מחדל. אצלם התגלה שאותה שקופית בלי ערך ניקוד קיבלה 7 באונליין
 * ו-3 באופליין — כמעט שליש מהשקופיות המנוקדות במסד. תוקן ל-7 בשני המסלולים,
 * וכאן מוודאים שגם המנוע מסכים על 7, ורק בשקופיות שבאמת מנוקדות.
 */
describe('ניקוד ברירת מחדל — 7, כמו שהעורך מציג', () => {
  const withScore = (type: string, scoreForQue: number | '') =>
    gameOf([{ ...DOC_SLIDE, type, question: { ...DOC_SLIDE.question, scoreForQue } }])
      .questions[0]!.question.scoreForQue;

  it('★ שקופית מנוקדת בלי ערך ניקוד — 7, ולא 0', () => {
    for (const type of ['trivia', 'survey', 'ans_images']) {
      expect(withScore(type, ''), type).toBe(7);
    }
  });

  it('★ ערך שנקבע במפורש גובר — כולל 0', () => {
    expect(withScore('trivia', 3)).toBe(3);
    expect(withScore('trivia', 0)).toBe(0); // מחבר שביקש 0 מקבל 0
  });

  it('בטקסט/מדיה/פונקציה "" נשאר 0 — כלל הריקון, לא ניקוד חסר', () => {
    for (const type of ['subject', 'media', 'function']) {
      expect(withScore(type, ''), type).toBe(0);
    }
  });

  it('הקבצים האמיתיים אינם מושפעים — שקופית מנוקדת תמיד נושאת מספר', () => {
    // הרשת נדרכת רק על "" בשקופית מנוקדת, מצב שלא קיים באף fixture.
    for (const name of FIXTURE_NAMES) {
      const raw = loadFixtureRaw(name) as { questions: { type: string; question: { scoreForQue: unknown } }[] };
      const offenders = raw.questions.filter(
        (q) => ['trivia', 'survey', 'ans_images'].includes(q.type) && q.question.scoreForQue === '',
      );
      expect(offenders, name).toHaveLength(0);
    }
  });
});

describe('שקופית פונקציה — הקונפיג שהבנאי בונה', () => {
  it('★ מגיע במלואו אחרי התיקון בחבילת האופליין', () => {
    const g = gameOf([
      {
        ...DOC_SLIDE,
        type: 'function',
        question: { ...DOC_SLIDE.question, que: '', scoreForQue: '', timeForQue: '' },
        function: { action: 'players', players: { mode: 'remove', unit: 'percent', amount: 20, selection: 'bottom', groups: [] } },
      },
    ]);
    const fn = g.questions[0]!.function;
    expect(fn?.action).toBe('players');
    expect(fn?.players).toMatchObject({ mode: 'remove', unit: 'percent', amount: 20, selection: 'bottom' });
  });

  it('שקופית פונקציה בלי אובייקט function נטענת ואינה מפילה את המשחק', () => {
    // הבאג שתוקן אצלם. גם אחרי התיקון — קובץ ישן עדיין בחוץ, ואסור שיקרוס.
    const g = gameOf([{ ...DOC_SLIDE, type: 'function' }]);
    expect(g.questions[0]!.type).toBe('function');
    expect(g.questions[0]!.function).toBeUndefined();
  });
});

describe('סעיף 3 — תשובת הקלדה', () => {
  it('★ setting.typingAnswer נשמר, גם שאיננו משתמשים בו', () => {
    // המנוע אינו מכיר שקופית "הקלדה" — היא מגיעה כטריוויה. אבל השדה חייב
    // לשרוד: העורך המקומי שומר את האובייקט המפוענח, ובלי זה הוא היה נמחק
    // מהקובץ של הלקוח.
    const g = gameOf([
      { ...DOC_SLIDE, setting: { ...DOC_SLIDE.setting, typingAnswer: 'ירושלים' } },
    ]);
    const setting = g.questions[0]!.setting as unknown as Record<string, unknown>;
    expect(setting['typingAnswer']).toBe('ירושלים');
  });
});
