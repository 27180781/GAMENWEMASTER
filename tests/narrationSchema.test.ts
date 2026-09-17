/**
 * חוזה הקריינות מול מערכת יצירת המשחקים (ENGINE-narration.md סעיף 1).
 *
 * הבדיקה החשובה כאן היא דווקא ההפוכה: **קובץ בלי `narration` חייב להיטען בדיוק
 * כמו קודם** — בלי שדות חדשים, בלי ברירות מחדל שנדבקות אליו. ואחריה: אובייקט
 * קריינות פגום נזרק בשקט ואינו מפיל את המשחק, והקטעים נכנסים לשרשרת המדיה
 * (טעינה מוקדמת, בדיקת קישורים, מיפוי נתיבי אופליין) בלי קוד ייעודי.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { hasNarration, parseGameFile } from '../src/engine/index.ts';
import { mediaFields } from '../src/app/mediaFields.ts';
import { collectMediaRefs } from '../src/app/mediaCheck.ts';
import { orderedMediaUrls } from '../src/app/mediaLoader.ts';
import { loadGameFromZip } from '../src/app/zipLoader.ts';
import { fourAnswers, rawGame, rawSlide } from './helpers.ts';

/** בדיוק המבנה שבמסמך החוזה. */
const NARRATION_SETTING = {
  enabled: true,
  voice: 'kore',
  announceQuestionNumber: true,
  duck: false,
  bankVersion: 1,
  bank: {
    num_f_1: 'https://cdn/tts/ab/one.mp3',
    flow_question_number: 'https://cdn/tts/cd/qnum.mp3',
    score_correct_is: 'https://cdn/tts/ef/correct.mp3',
  },
};

const SLIDE_NARRATION = {
  question: 'https://cdn/tts/q1.mp3',
  answers: ['https://cdn/tts/a1.mp3', null, 'https://cdn/tts/a3.mp3'],
  correct: null,
};

function gameWithNarration(): Record<string, unknown> {
  const slide = {
    ...rawSlide({
      id: 1,
      type: 'trivia',
      answers: [
        { ans: 'א', correct: true, id: 1 },
        { ans: 'ב', correct: false, id: 2 },
        { ans: 'ג', correct: false, id: 3 },
      ],
      scoreForQue: 5,
    }),
    narration: SLIDE_NARRATION,
  };
  const game = rawGame([slide]);
  (game.setting as Record<string, unknown>).narration = NARRATION_SETTING;
  return game;
}

describe('קובץ בלי קריינות — בדיוק כמו קודם', () => {
  const plain = rawGame([rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(2), scoreForQue: 3 })]);

  it('★ אין שדה narration בפלט הטעינה — לא בהגדרות ולא בשקופית', () => {
    const game = parseGameFile(plain);
    expect('narration' in game.setting).toBe(false);
    expect('narration' in game.questions[0]!).toBe(false);
    expect(JSON.stringify(game)).not.toContain('narration');
  });

  it('★ אין קריינות פעילה, ואין שדות מדיה נוספים', () => {
    const game = parseGameFile(plain);
    expect(hasNarration(game)).toBe(false);
    const labels = mediaFields(game).map((f) => f.label);
    expect(labels.some((l) => l.includes('קריינות'))).toBe(false);
  });

  it('קבצי ה-fixture האמיתיים נטענים בלי קריינות', () => {
    const game = parseGameFile(plain);
    expect(game.setting.narration).toBeUndefined();
  });
});

describe('קובץ עם קריינות — כל השדות מגיעים', () => {
  const game = parseGameFile(gameWithNarration());

  it('★ הגדרות הקריין', () => {
    expect(game.setting.narration).toMatchObject({
      enabled: true,
      voice: 'kore',
      announceQuestionNumber: true,
      duck: false,
      bankVersion: 1,
    });
    expect(game.setting.narration?.bank['num_f_1']).toBe('https://cdn/tts/ab/one.mp3');
  });

  it('★ קטעי השקופית — כולל ה-null באמצע מערך התשובות', () => {
    expect(game.questions[0]!.narration).toEqual(SLIDE_NARRATION);
  });

  it('★ hasNarration מזהה את המשחק ככזה שיש לו קריינות', () => {
    expect(hasNarration(game)).toBe(true);
  });

  it('ברירות מחדל לשדות חסרים (רק bank נשלח)', () => {
    const raw = gameWithNarration();
    (raw.setting as Record<string, unknown>).narration = { bank: { num_f_1: 'x.mp3' } };
    const parsed = parseGameFile(raw);
    expect(parsed.setting.narration).toMatchObject({
      enabled: true,
      voice: '',
      announceQuestionNumber: true,
      duck: false,
      bankVersion: 1,
    });
  });

  it('קריינות מכובה (enabled: false) — כאילו אינה קיימת', () => {
    const raw = gameWithNarration();
    (raw.setting as Record<string, unknown>).narration = { ...NARRATION_SETTING, enabled: false };
    expect(hasNarration(parseGameFile(raw))).toBe(false);
  });

  it('בנק ריק בלי קטעי שקופית — אין מה להקריא', () => {
    const raw = rawGame([rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(2), scoreForQue: 3 })]);
    (raw.setting as Record<string, unknown>).narration = { bank: {} };
    expect(hasNarration(parseGameFile(raw))).toBe(false);
  });
});

describe('★ קריינות פגומה אינה מפילה את המשחק', () => {
  it('אובייקט קריינות לא תקין בהגדרות — נזרק, המשחק נטען', () => {
    const raw = gameWithNarration();
    (raw.setting as Record<string, unknown>).narration = { bank: { num_f_1: 17 } };
    const game = parseGameFile(raw);
    expect(game.setting.narration).toBeUndefined();
    expect(game.questions).toHaveLength(1);
  });

  it('narration שאינו אובייקט כלל', () => {
    const raw = gameWithNarration();
    (raw.setting as Record<string, unknown>).narration = 'kore';
    expect(parseGameFile(raw).setting.narration).toBeUndefined();
  });

  it('קטעי שקופית פגומים — נזרקים, השקופית נשארת', () => {
    const raw = gameWithNarration();
    (raw.questions as Record<string, unknown>[])[0]!.narration = { answers: 'not-an-array' };
    const game = parseGameFile(raw);
    expect(game.questions[0]!.narration).toBeUndefined();
    expect(game.questions[0]!.question.answers).toHaveLength(3);
    expect(hasNarration(game)).toBe(true); // הבנק עדיין שם
  });
});

describe('הקטעים נכנסים לשרשרת המדיה בלי קוד ייעודי', () => {
  const game = parseGameFile(gameWithNarration());

  it('★ כל קטע הוא שדה מדיה — עם תווית מזהה, ואחרי הסאונדים', () => {
    const labels = mediaFields(game).map((f) => f.label);
    expect(labels).toContain('קריינות · בנק · num_f_1');
    expect(labels).toContain('שקופית 1 · קריינות · שאלה');
    expect(labels).toContain('שקופית 1 · קריינות · תשובה 3');
    expect(labels.indexOf('קריינות · בנק · num_f_1')).toBeGreaterThan(
      labels.indexOf('סאונד טיימר'),
    );
  });

  it('★ נכנסים לטעינה המוקדמת ולבדיקת הקישורים השבורים', () => {
    expect(orderedMediaUrls(game)).toContain('https://cdn/tts/q1.mp3');
    expect(collectMediaRefs(game).map((r) => r.src)).toContain('https://cdn/tts/ab/one.mp3');
    // קטע null אינו הופך לכתובת ריקה בדרך
    expect(orderedMediaUrls(game).filter((u) => u === '')).toHaveLength(0);
  });

  it('★ חבילת אופליין: נתיבי Assets/nar-*.mp3 ממופים כמו כל מדיה אחרת', async () => {
    const raw = gameWithNarration();
    (raw.setting as Record<string, unknown>).narration = {
      ...NARRATION_SETTING,
      bank: { num_f_1: 'Assets/nar-bank-num-f-1.mp3' },
    };
    (raw.questions as Record<string, unknown>[])[0]!.narration = {
      question: 'Assets/nar-q1.mp3',
      answers: ['Assets/nar-a1.mp3', null, null],
      correct: null,
    };
    for (const key of ['id', 'assets', 'createdAt', 'baseUrl']) delete raw[key];

    const zip = new JSZip();
    zip.file('data.json', JSON.stringify(raw));
    for (const name of ['nar-bank-num-f-1.mp3', 'nar-q1.mp3', 'nar-a1.mp3']) {
      zip.file(`Assets/${name}`, new Uint8Array([1, 2, 3]));
    }
    let created = 0;
    globalThis.URL.createObjectURL = () => `blob:nar-${++created}`;
    globalThis.URL.revokeObjectURL = () => {};

    const { game: offline, missing } = await loadGameFromZip(
      await zip.generateAsync({ type: 'uint8array' }),
    );
    expect(missing).toEqual([]);
    expect(offline.setting.narration?.bank['num_f_1']).toMatch(/^blob:nar-/);
    expect(offline.questions[0]!.narration?.question).toMatch(/^blob:nar-/);
    expect(offline.questions[0]!.narration?.answers[0]).toMatch(/^blob:nar-/);
    expect(offline.questions[0]!.narration?.answers[1]).toBeNull(); // null נשאר null
  });
});
