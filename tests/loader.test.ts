import { describe, expect, it } from 'vitest';
import { GameValidationError, parseGameFile, parseGameFileFromString } from '../src/engine/index.ts';
import { FIXTURE_NAMES, fourAnswers, loadFixture, loadFixtureRaw, makeGame, rawGame, rawSlide } from './helpers.ts';

describe('טעינה וולידציה של 4 קבצי המשחק האמיתיים', () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name} נטען ועובר ולידציה`, () => {
      const game = loadFixture(name);
      expect(game.questions.length).toBeGreaterThan(0);
      expect(game.id).toBeTruthy();
      // נרמול: כל השדות המספריים הם number אחרי הטעינה — אין יותר ""
      for (const slide of game.questions) {
        expect(typeof slide.question.scoreForQue).toBe('number');
        expect(typeof slide.question.timeForQue).toBe('number');
        expect(typeof slide.setting.scoringReduction.seconds).toBe('number');
        expect(typeof slide.setting.scoringReduction.score).toBe('number');
        expect(typeof slide.setting.automaticSkip.seconds).toBe('number');
      }
    });
  }

  it('שמות-סוג חלופיים ממערכת היצירה מנורמלים (multiselect→trivia, poll→survey)', () => {
    const raw = rawGame([
      rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1) }),
      rawSlide({ id: 2, type: 'trivia', answers: fourAnswers(1) }),
    ]);
    // מדמים את מה שמערכת יצירת המשחקים מייצרת בפועל: type "multiselect"/"survey"
    const slides = (raw as { questions: Record<string, unknown>[] }).questions;
    slides[0]!.type = 'multiselect';
    slides[1]!.type = 'survey';
    const game = parseGameFile(raw);
    expect(game.questions[0]!.type).toBe('trivia');
    expect(game.questions[1]!.type).toBe('survey');
  });

  it('סוג לא מוכר עדיין נדחה (לא כל מחרוזת מתקבלת)', () => {
    const raw = rawGame([rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1) })]);
    (raw as { questions: Record<string, unknown>[] }).questions[0]!.type = 'bogus-type';
    expect(() => parseGameFile(raw)).toThrow(GameValidationError);
  });

  it('שדות "" מנורמלים לברירות מחדל (time=15, score=0) על נתונים אמיתיים', () => {
    // בקובץ masaa שקופית 2 היא media עם scoreForQue="" ו-timeForQue=""
    const game = loadFixture('masaa-sync-manual-link.json');
    const media = game.questions.find((s) => s.type === 'media');
    expect(media).toBeDefined();
    expect(media?.question.scoreForQue).toBe(0);
    expect(media?.question.timeForQue).toBe(15);
  });

  it('מספרי תשובות משתנים עוברים ולידציה: 3 (neuwirth) ו-5 (hadassah)', () => {
    const neuwirth = loadFixture('neuwirth.json');
    expect(neuwirth.questions.some((s) => s.question.answers.length === 3)).toBe(true);

    const hadassah = loadFixture('hadassah-ozen.json');
    expect(hadassah.questions.some((s) => s.question.answers.length === 5)).toBe(true);
    expect(hadassah.questions.some((s) => s.question.answers.length === 4)).toBe(true);
  });

  it('צבעי HEX של 8 ספרות (עם אלפא) ושל 6 ספרות מתקבלים', () => {
    expect(() => makeGame([rawSlide({ id: 1, type: 'media', openMediaSrc: 'a.mp4' })])).not.toThrow();
    const game = loadFixture('hadassah-ozen.json');
    expect(game.setting.mainColor).toBe('#222B45C2'); // 8 ספרות מהקובץ האמיתי
  });
});

describe('allowChangeVote — אופציונלי עם ברירת מחדל false', () => {
  it('שקופית בלי allowChangeVote ב-setting — נטענת עם false (בלי אפשרות שינוי)', () => {
    const slide = rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(2) });
    delete (slide.setting as Record<string, unknown>).allowChangeVote;
    const game = makeGame([slide]);
    expect(game.questions[0]!.setting.allowChangeVote).toBe(false);
  });

  it('allowChangeVote: true ב-setting נשמר', () => {
    const slide = rawSlide({
      id: 1,
      type: 'trivia',
      answers: fourAnswers(2),
      settings: { allowChangeVote: true },
    });
    const game = makeGame([slide]);
    expect(game.questions[0]!.setting.allowChangeVote).toBe(true);
  });
});

describe('autoTransition — ברירת מחדל ותקינות', () => {
  it('קובץ בלי autoTransition — מקבל ברירת מחדל (הכל כבוי, nextSlide 6 שניות)', () => {
    const game = makeGame([rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1) })]);
    expect(game.setting.autoTransition).toEqual({
      showAnswersAfterQuestion: false,
      startTimerAfterLastAnswer: false,
      showCorrectAnswerAfterTimer: false,
      nextSlide: { active: false, seconds: 6 },
      media: { image: { active: false, seconds: 5 }, video: { playToEnd: false } },
    });
  });

  it('autoTransition מהקובץ נשמר כמו שהוא', () => {
    const raw = rawGame([rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1) })], {});
    (raw.setting as Record<string, unknown>).autoTransition = {
      showAnswersAfterQuestion: true,
      startTimerAfterLastAnswer: true,
      showCorrectAnswerAfterTimer: false,
      nextSlide: { active: true, seconds: 8 },
    };
    const game = parseGameFile(raw);
    expect(game.setting.autoTransition.showAnswersAfterQuestion).toBe(true);
    expect(game.setting.autoTransition.startTimerAfterLastAnswer).toBe(true);
    expect(game.setting.autoTransition.showCorrectAnswerAfterTimer).toBe(false);
    expect(game.setting.autoTransition.nextSlide).toEqual({ active: true, seconds: 8 });
  });
});

describe('טבלת מובילים — winnersListCount + showWinnersListAfter', () => {
  it('קובץ בלי winnersListCount — ברירת מחדל 5', () => {
    const game = makeGame([rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1) })]);
    expect(game.setting.winnersListCount).toBe(5);
  });

  it('winnersListCount מהקובץ נשמר; "" מנורמל ל-5', () => {
    const raw = rawGame([rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1) })], {});
    (raw.setting as Record<string, unknown>).winnersListCount = 8;
    expect(parseGameFile(raw).setting.winnersListCount).toBe(8);
    (raw.setting as Record<string, unknown>).winnersListCount = '';
    expect(parseGameFile(raw).setting.winnersListCount).toBe(5);
  });

  it('showWinnersListAfter — מספר נשמר; null/""/חסר = מכובה (null)', () => {
    const raw = rawGame([rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1) })], {});
    (raw.setting as Record<string, unknown>).showWinnersListAfter = 3;
    expect(parseGameFile(raw).setting.showWinnersListAfter).toBe(3);
    (raw.setting as Record<string, unknown>).showWinnersListAfter = '';
    expect(parseGameFile(raw).setting.showWinnersListAfter).toBeNull();
    delete (raw.setting as Record<string, unknown>).showWinnersListAfter;
    expect(parseGameFile(raw).setting.showWinnersListAfter).toBeNull();
  });
});

describe('נרמול מזהי תשובות למיקום התצוגה (1..N)', () => {
  const slideWith = (answers: { ans: string; correct: boolean; id: number }[]) =>
    parseGameFile(rawGame([rawSlide({ id: 1, type: 'trivia', que: 'ש?', answers })])).questions[0]!;

  it('מזהים מעורבבים/לא-רציפים מיושרים ל-1..N, ו-correct נשאר צמוד לתשובה שלו', () => {
    const slide = slideWith([
      { ans: 'ראשונה', correct: false, id: 3 },
      { ans: 'שנייה (נכונה)', correct: true, id: 7 },
      { ans: 'שלישית', correct: false, id: 1 },
      { ans: 'רביעית', correct: false, id: 2 },
    ]);
    expect(slide.question.answers.map((a) => a.id)).toEqual([1, 2, 3, 4]);
    // התשובה הנכונה היא זו שמוצגת שנייה — הכפתור 2 בטלפון יזכה בניקוד
    expect(slide.question.answers.find((a) => a.correct)!.id).toBe(2);
    expect(slide.question.answers[1]!.ans).toBe('שנייה (נכונה)');
  });

  it('קובץ תקין (id == מיקום) נשאר ללא שינוי', () => {
    const answers = fourAnswers(2);
    const slide = slideWith(answers);
    expect(slide.question.answers).toEqual(answers);
  });

  it('גם ans_images מנורמל; שקופיות לא-מצביעות לא נוגעים בהן', () => {
    const game = parseGameFile(
      rawGame([
        rawSlide({
          id: 1,
          type: 'ans_images',
          que: 'בחר',
          answers: [
            { ans: '/a.png', correct: true, id: 9 },
            { ans: '/b.png', correct: true, id: 4 },
          ],
        }),
        rawSlide({ id: 2, type: 'subject', que: 'טקסט' }),
      ]),
    );
    expect(game.questions[0]!.question.answers.map((a) => a.id)).toEqual([1, 2]);
  });
});

describe('שגיאות ולידציה בעברית עם מיקום מדויק', () => {
  it('שדה מספרי פגום בשקופית — הודעה עם מספר שקופית ו-id', () => {
    const raw = loadFixtureRaw('hadassah-ozen.json') as {
      questions: { question: { scoreForQue: unknown } }[];
    };
    raw.questions[6]!.question.scoreForQue = 'abc';
    try {
      parseGameFile(raw);
      expect.unreachable('הולידציה הייתה אמורה להיכשל');
    } catch (e) {
      expect(e).toBeInstanceOf(GameValidationError);
      const error = e as GameValidationError;
      expect(error.issues.length).toBeGreaterThan(0);
      expect(error.issues[0]).toContain('שקופית 7 (id=7)');
      expect(error.issues[0]).toContain('scoreForQue');
      expect(error.message).toContain('קובץ המשחק אינו תקין');
    }
  });

  it('צבע לא חוקי — הודעה בעברית', () => {
    const raw = rawGame([rawSlide({ id: 1, type: 'media', openMediaSrc: 'a.mp4' })], {});
    (raw.setting as Record<string, unknown>).mainColor = 'red';
    expect(() => parseGameFile(raw)).toThrowError(/HEX/);
  });

  it('שקופית trivia בלי תשובה נכונה — נדחית בעברית', () => {
    const slide = rawSlide({ id: 3, type: 'trivia', answers: fourAnswers(0), scoreForQue: 5 });
    expect(() => makeGame([slide])).toThrowError(/שקופית 1 \(id=3\).*תשובה נכונה/);
  });

  it('שקופית הצבעה עם פחות מ-2 תשובות — נדחית', () => {
    const slide = rawSlide({ id: 1, type: 'survey', answers: [] });
    expect(() => makeGame([slide])).toThrowError(/לפחות 2 תשובות/);
  });

  it('JSON שבור — הודעה בעברית', () => {
    expect(() => parseGameFileFromString('{not json')).toThrowError(/אינו JSON תקין/);
  });

  it('טיפוס שגוי בשדה עליון — הודעה בעברית', () => {
    const raw = rawGame([rawSlide({ id: 1, type: 'media', openMediaSrc: 'a.mp4' })], { name: 7 });
    expect(() => parseGameFile(raw)).toThrowError(/name — חייב להיות מחרוזת/);
  });
});
