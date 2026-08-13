/**
 * החלפת סוג שקופית בעורך. הסכימה אוכפת מגבלות לפי סוג, ולכן החלפה "נאיבית"
 * של השדה יכולה לייצר קובץ משחק שלא ייטען יותר — וזה מתגלה רק בפתיחה הבאה.
 */

import { describe, expect, it } from 'vitest';
import {
  changeSlideType,
  functionFormNodes,
  normalizeFunctionSlide,
  SLIDE_TYPES,
  withActionDefaults,
} from '../src/app/slideEdit.ts';
import { functionConfigSchema, slideSchema } from '../src/engine/schema.ts';
import { describeObject } from '../src/app/schemaForm.ts';
import type { GameFile } from '../src/engine/index.ts';

const sSet = {
  allowChangeVote: false, slideStartVoting: true, playAfterClicking: false, exitGame: false,
  correctlyAnsweredBefore: false, firstClicker: false, answerIsSequenceClicks: false,
  fullscreen: false, scoringReduction: { active: false, seconds: '', score: '' },
  slidBackgroundMedia: { src: '' }, automaticSkip: { active: false, seconds: '' }, showInLoop: false,
};

function gameWith(answers: { ans: string; correct: boolean; id: number }[]): GameFile {
  return {
    questions: [
      {
        id: 1, type: 'trivia',
        question: { que: 'שאלה', scoreForQue: 10, timeForQue: 20, src: '', answers },
        openMedia: { src: '' }, endMedia: { src: '' }, backgroundMedia: { src: '' }, setting: sSet,
      },
    ],
  } as unknown as GameFile;
}

const two = [
  { ans: 'א', correct: true, id: 1 },
  { ans: 'ב', correct: false, id: 2 },
];

/** ★ המבחן האמיתי: התוצאה עוברת את הסכימה שתטען את הקובץ. */
function schemaAccepts(game: GameFile): boolean {
  return slideSchema.safeParse(game.questions[0]).success;
}

describe('changeSlideType', () => {
  it('★ כל סוג שאפשר לבחור מייצר שקופית שהסכימה מקבלת', () => {
    for (const t of SLIDE_TYPES) {
      const out = changeSlideType(gameWith(two), 0, t.value);
      expect(schemaAccepts(out), `סוג ${t.value}`).toBe(true);
      expect(out.questions[0]?.type).toBe(t.value);
    }
  });

  it('★ גם משקופית שהתחילה עם תשובה אחת בלבד', () => {
    const thin = gameWith([{ ans: 'יחידה', correct: false, id: 1 }]);
    for (const t of SLIDE_TYPES) {
      expect(schemaAccepts(changeSlideType(thin, 0, t.value)), `סוג ${t.value}`).toBe(true);
    }
  });

  it('מעבר ל-trivia בלי תשובה נכונה — מסמן את הראשונה', () => {
    const none = gameWith([
      { ans: 'א', correct: false, id: 1 },
      { ans: 'ב', correct: false, id: 2 },
    ]);
    const out = changeSlideType(none, 0, 'trivia');
    expect(out.questions[0]?.question.answers[0]?.correct).toBe(true);
    expect(schemaAccepts(out)).toBe(true);
  });

  it('מעבר לסקר משלים ל-2 תשובות אבל לא נוגע בנכונות', () => {
    const one = gameWith([{ ans: 'יחידה', correct: false, id: 1 }]);
    const out = changeSlideType(one, 0, 'survey');
    expect(out.questions[0]?.question.answers).toHaveLength(2);
    expect(schemaAccepts(out)).toBe(true);
  });

  it('★ מעבר למדיה ובחזרה — התשובות שנכתבו לא נמחקו', () => {
    const custom = gameWith([
      { ans: 'ירושלים', correct: true, id: 1 },
      { ans: 'חיפה', correct: false, id: 2 },
      { ans: 'אילת', correct: false, id: 3 },
    ]);
    const toMedia = changeSlideType(custom, 0, 'media');
    expect(toMedia.questions[0]?.question.answers).toHaveLength(3);
    const back = changeSlideType(toMedia, 0, 'trivia');
    expect(back.questions[0]?.question.answers.map((a) => a.ans)).toEqual([
      'ירושלים', 'חיפה', 'אילת',
    ]);
    expect(back.questions[0]?.question.answers[0]?.correct).toBe(true);
  });

  it('פעולת מערכת מקבלת קונפיג ברירת מחדל שמישה', () => {
    const out = changeSlideType(gameWith(two), 0, 'function');
    expect(out.questions[0]?.function).toEqual({ action: 'screen', screen: { type: 'winners' } });
    expect(schemaAccepts(out)).toBe(true);
  });

  it('קונפיג פעולה קיים אינו נדרס במעבר חוזר', () => {
    const first = changeSlideType(gameWith(two), 0, 'function');
    const custom = {
      ...first,
      questions: [{ ...first.questions[0]!, function: { action: 'score', score: { operation: 'reset_all' } } }],
    } as GameFile;
    const again = changeSlideType(changeSlideType(custom, 0, 'media'), 0, 'function');
    expect(again.questions[0]?.function).toEqual({ action: 'score', score: { operation: 'reset_all' } });
  });

  it('אינדקס מחוץ לטווח — בלי שינוי ובלי קריסה', () => {
    const g = gameWith(two);
    expect(changeSlideType(g, 9, 'media')).toEqual(g);
  });

  it('הרשימה מכסה את כל הסוגים שהמנוע מכיר', () => {
    expect(SLIDE_TYPES.map((t) => t.value).sort()).toEqual(
      ['ans_images', 'function', 'media', 'subject', 'survey', 'trivia'],
    );
    for (const t of SLIDE_TYPES) expect(t.hint.length).toBeGreaterThan(10);
  });
});

/**
 * בחירת פעולה בשקופית "פעולת מערכת" — תת-הקונפיג שלה אופציונלי בסכימה, ולכן
 * בלי ההשלמה הזו הבלוק בעורך היה נפתח ריק והמנוע היה מדווח "קונפיג חסר".
 */
describe('withActionDefaults', () => {
  it('★ בוחרים "players" — מקבלים את השדות שהסכימה מגדירה, לא אובייקט ריק', () => {
    const out = withActionDefaults({ action: 'players' });
    expect(out.players).toEqual({ mode: 'remove', unit: 'percent', selection: 'random', groups: [] });
    expect(functionConfigSchema.safeParse(out).success).toBe(true);
  });

  it('כל פעולה שיש לה תת-קונפיג מקבלת אותו — כולל פעולות שיתווספו בעתיד', () => {
    for (const action of ['api', 'screen', 'score', 'players']) {
      const out = withActionDefaults({ action }) as Record<string, unknown>;
      expect(out[action], `פעולה ${action}`).toBeDefined();
      expect(functionConfigSchema.safeParse(out).success, `פעולה ${action}`).toBe(true);
    }
  });

  it('★ קונפיג שכבר קיים אינו נדרס — לא מאבדים כתובת API שנכתבה', () => {
    const existing = { action: 'api', api: { url: 'https://example.com/hook', method: 'POST' } };
    expect(withActionDefaults(existing)).toBe(existing); // אותה הפניה — בלי שינוי
  });

  it('פעולה לא מוכרת אינה יוצרת שדה מומצא', () => {
    const odd = { action: 'משהו-עתידי' };
    expect(withActionDefaults(odd)).toBe(odd);
  });

  it('normalizeFunctionSlide נוגע רק בשקופית פעולה', () => {
    const trivia = gameWith(two);
    expect(normalizeFunctionSlide(trivia, 0)).toBe(trivia); // שקופית טריוויה — בלי שינוי
    expect(normalizeFunctionSlide(trivia, 9)).toBe(trivia); // אינדקס מחוץ לטווח

    const fn = changeSlideType(trivia, 0, 'function');
    const switched = {
      ...fn,
      questions: [{ ...fn.questions[0]!, function: { action: 'players' } }],
    } as GameFile;
    const out = normalizeFunctionSlide(switched, 0);
    expect(out.questions[0]?.function?.players?.selection).toBe('random');
    expect(schemaAccepts(out)).toBe(true);
  });
});

/** השדות שהעורך גוזר מהסכימה לשקופית פעולה — בוררים ולא טקסט חופשי. */
describe('טופס הפעולה נגזר מהסכימה', () => {
  const nodes = describeObject(functionConfigSchema);

  it('★ "הפעולה" היא רשימת בחירה עם תוויות בעברית', () => {
    const action = nodes.find((n) => n.key === 'action');
    expect(action?.kind).toBe('enum');
    const options = action?.kind === 'enum' ? action.options : [];
    expect(options.map((o) => o.value)).toEqual(['api', 'screen', 'score', 'players']);
    // התוויות בעברית — לא שמות השדות באנגלית
    for (const o of options) expect(o.label).not.toBe(o.value);
  });

  it('גם השדות המקוננים — מסך, ניקוד ומשתתפים', () => {
    const pick = (key: string) => {
      const group = nodes.find((n) => n.key === key);
      return group?.kind === 'object' ? group.children : [];
    };
    const screenType = pick('screen').find((c) => c.key === 'type');
    expect(screenType?.kind).toBe('enum');
    const selection = pick('players').find((c) => c.key === 'selection');
    expect(selection?.kind === 'enum' && selection.options.map((o) => o.value)).toEqual([
      'random', 'top', 'bottom', 'groups',
    ]);
    // amount נשאר מספר, ו-url טקסט חופשי — לא כל שדה הפך לבורר
    expect(pick('players').find((c) => c.key === 'amount')?.kind).toBe('number');
    expect(pick('api').find((c) => c.key === 'url')?.kind).toBe('string');
  });

  it('★ מוצג רק הבלוק של הפעולה הנבחרת', () => {
    const players = functionFormNodes(nodes, 'players');
    expect(players.top.map((n) => n.key)).toEqual(['action']); // הבורר בלבד
    expect(players.section?.key).toBe('players');
    // ולא הבלוקים של הפעולות האחרות
    expect(players.top.some((n) => n.key === 'api')).toBe(false);

    expect(functionFormNodes(nodes, 'api').section?.key).toBe('api');
    expect(functionFormNodes(nodes, 'screen').section?.key).toBe('screen');
  });

  it('פעולה שאין לה בלוק — מציגים הכול, כדי ששום הגדרה לא תיעלם', () => {
    // ערך מקובץ שנוצר בגרסה אחרת: אסור שההגדרות שבו יהפכו לבלתי-נגישות.
    const odd = functionFormNodes(nodes, 'משהו-אחר');
    expect(odd.section).toBeNull();
    expect(odd.top.map((n) => n.key)).toEqual(nodes.map((n) => n.key));
  });

  it('★ הסכימה נשארת סלחנית — קובץ עם ערך שאינו ברשימה עדיין נטען', () => {
    // דווקא זו הסיבה שהרשימה נשמרת כמטא-דאטה ולא כ-z.enum: קובץ קיים שנשמר
    // עם ערך אחר היה נפסל כולו בטעינה.
    const parsed = functionConfigSchema.safeParse({ action: 'webhook_v2' });
    expect(parsed.success).toBe(true);
  });
});
