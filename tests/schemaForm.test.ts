/**
 * הטופס מונע-הסכימה. הדרישה שהוא נועד לקיים: שדה שיתווסף ל-schema.ts יופיע
 * בעורך *בלי* לגעת בקוד העורך. לכן הבדיקות כאן בודקות את הגזירה מהסכימה
 * האמיתית, ולא רק סכימות צעצוע.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { describeObject, describeField, getAt, setAt, labelFor } from '../src/app/schemaForm.ts';
import { globalSettingsSchema, slideSettingsSchema } from '../src/engine/schema.ts';

describe('describeField — טיפוסים בסיסיים ועטיפות', () => {
  it('מזהה מחרוזת/מספר/בוליאני', () => {
    expect(describeField('a', z.string())?.kind).toBe('string');
    expect(describeField('a', z.number())?.kind).toBe('number');
    expect(describeField('a', z.boolean())?.kind).toBe('boolean');
  });

  it('מפרק optional / default / nullable ומסמן כאופציונלי', () => {
    expect(describeField('a', z.string().optional())).toMatchObject({ kind: 'string', optional: true });
    expect(describeField('a', z.number().default(3))).toMatchObject({ kind: 'number', optional: true });
    expect(describeField('a', z.boolean().nullable())).toMatchObject({ kind: 'boolean', optional: true });
    // שרשור עטיפות — כמו שקורה בפועל בסכימה
    expect(describeField('a', z.string().optional().default('x'))).toMatchObject({ kind: 'string' });
  });

  it('מפרק transform (ZodEffects) — נפוץ בסכימה שלנו', () => {
    const t = z.string().optional().transform((v) => v ?? '');
    expect(describeField('a', t)?.kind).toBe('string');
  });

  it('אובייקט מקונן הופך לקבוצה עם ילדים', () => {
    const node = describeField('g', z.object({ x: z.string(), y: z.number() }));
    expect(node?.kind).toBe('object');
    expect(node?.kind === 'object' && node.children.map((c) => c.key)).toEqual(['x', 'y']);
  });

  it('טיפוס בלי עורך ייעודי נופל ל-json — ולא נעלם', () => {
    expect(describeField('a', z.array(z.string()))?.kind).toBe('json');
    expect(describeField('a', z.union([z.string(), z.boolean()]))?.kind).toBe('json');
  });

  it('emptyableNumber (מספר או "") הוא שדה מספר — לא JSON גולמי', () => {
    // התבנית שחוזרת בכל הסכימה: z.union([z.number(), z.literal('')]).transform(...)
    const emptyable = z.union([z.number(), z.literal('')]).transform((v) => (v === '' ? 0 : v));
    expect(describeField('seconds', emptyable)).toMatchObject({ kind: 'number', empty: '' });
  });

  it('ZodEnum — אפשרויות עם ערך ותווית', () => {
    const node = describeField('a', z.enum(['x', 'y']));
    expect(node?.kind).toBe('enum');
    expect(node?.kind === 'enum' && node.options).toEqual([
      { value: 'x', label: 'x' },
      { value: 'y', label: 'y' },
    ]);
  });

  describe('רשימת בחירה ממטא-דאטה (choice:)', () => {
    const meta = `choice:${JSON.stringify({ api: 'קריאת API', screen: 'מסך' })}`;

    it('מחרוזת עם ערכים מוצעים הופכת לבורר — בלי להדק את הוולידציה', () => {
      const node = describeField('action', z.string().describe(meta).default('api'));
      expect(node?.kind).toBe('enum');
      expect(node?.kind === 'enum' && node.options).toEqual([
        { value: 'api', label: 'קריאת API' },
        { value: 'screen', label: 'מסך' },
      ]);
    });

    it('★ התיאור נקרא גם כשהוא יושב על העטיפה החיצונית', () => {
      // .describe() נשמר על העטיפה שעליה הופעל; בלי איסוף במהלך הפירוק הוא
      // היה הולך לאיבוד כאן, והשדה היה חוזר להיות טקסט חופשי.
      expect(describeField('a', z.string().default('api').describe(meta))?.kind).toBe('enum');
      expect(describeField('a', z.string().describe(meta).optional())?.kind).toBe('enum');
    });

    it('תיאור רגיל או פגום אינו הופך את השדה לבורר', () => {
      expect(describeField('a', z.string().describe('סתם הסבר'))?.kind).toBe('string');
      expect(describeField('a', z.string().describe('choice:{לא JSON'))?.kind).toBe('string');
      expect(describeField('a', z.string().describe('choice:[]'))?.kind).toBe('string');
      expect(describeField('a', z.string().describe('choice:{}'))?.kind).toBe('string');
    });

    it('ערך בלי תווית נופל לשם הערך עצמו', () => {
      const node = describeField('a', z.string().describe('choice:{"GET":"","POST":"POST"}'));
      expect(node?.kind === 'enum' && node.options).toEqual([
        { value: 'GET', label: 'GET' },
        { value: 'POST', label: 'POST' },
      ]);
    });
  });

  it('ריקון שדה כותב את הערך שהסכימה מצפה לו', () => {
    // חובה → 0 (אין ערך "בלי ערך"), אופציונלי → null, emptyableNumber → ''
    expect(describeField('a', z.number())).toMatchObject({ empty: 0 });
    expect(describeField('a', z.number().optional())).toMatchObject({ empty: null });
    expect(describeField('a', z.union([z.number(), z.null()]))).toMatchObject({ empty: null });
  });
});

describe('describeObject על הסכימה האמיתית', () => {
  it('הגדרות המשחק נגזרות — כולל שדות מקוננים', () => {
    const nodes = describeObject(globalSettingsSchema);
    const keys = nodes.map((n) => n.key);
    expect(keys).toContain('mainColor');
    expect(keys).toContain('multiWinners');
    expect(keys).toContain('sound');
    expect(keys).toContain('limit');
    // הצלילים הם קבוצה מקוננת, ולא עלה בודד
    const sound = nodes.find((n) => n.key === 'sound');
    expect(sound?.kind).toBe('object');
    expect(sound?.kind === 'object' && sound.children.length).toBeGreaterThan(3);
  });

  it('גם gameTypeSettings העמוק נגזר (אובייקט בתוך אובייקט)', () => {
    const nodes = describeObject(globalSettingsSchema);
    const gts = nodes.find((n) => n.key === 'gameTypeSettings');
    expect(gts?.kind).toBe('object');
    const snakes = gts?.kind === 'object' ? gts.children.find((c) => c.key === 'snakesLadders') : undefined;
    expect(snakes?.kind).toBe('object');
  });

  it('הגדרות שקופית נגזרות במלואן', () => {
    const keys = describeObject(slideSettingsSchema).map((n) => n.key);
    expect(keys).toContain('showInLoop');
    expect(keys).toContain('scoringReduction');
    expect(keys).toContain('automaticSkip');
    expect(keys).toContain('firstClicker');
  });

  it('skip מסתיר שדות שכבר נערכים בטופס הייעודי', () => {
    const all = describeObject(globalSettingsSchema).map((n) => n.key);
    const some = describeObject(globalSettingsSchema, ['mainColor', 'sound']).map((n) => n.key);
    expect(all).toContain('mainColor');
    expect(some).not.toContain('mainColor');
    expect(some).not.toContain('sound');
    expect(some.length).toBe(all.length - 2);
  });

  it('שדות ה"שניות/ניקוד" של השקופית נערכים כמספרים', () => {
    const nodes = describeObject(slideSettingsSchema);
    const reduction = nodes.find((n) => n.key === 'scoringReduction');
    const kinds =
      reduction?.kind === 'object'
        ? Object.fromEntries(reduction.children.map((c) => [c.key, c.kind]))
        : {};
    expect(kinds).toMatchObject({ active: 'boolean', seconds: 'number', score: 'number' });
  });

  it('showWinnersListAfter — מספר שניתן לרוקן, ולא JSON', () => {
    const node = describeObject(globalSettingsSchema).find((n) => n.key === 'showWinnersListAfter');
    expect(node).toMatchObject({ kind: 'number', empty: '' });
  });

  it('שדה חדש בסכימה מופיע לבד — זו כל המטרה', () => {
    const extended = globalSettingsSchema.extend({ אפקטים: z.boolean().default(false) });
    const keys = describeObject(extended).map((n) => n.key);
    expect(keys).toContain('אפקטים');
  });
});

describe('getAt / setAt', () => {
  const src = { a: { b: { c: 1 } }, list: [1, 2] };

  it('קורא בעומק, ומחזיר undefined לנתיב שאינו קיים', () => {
    expect(getAt(src, ['a', 'b', 'c'])).toBe(1);
    expect(getAt(src, ['a', 'nope', 'c'])).toBeUndefined();
    expect(getAt(null, ['a'])).toBeUndefined();
  });

  it('כותב בעומק בלי לשנות את המקור', () => {
    const out = setAt(src, ['a', 'b', 'c'], 9);
    expect(getAt(out, ['a', 'b', 'c'])).toBe(9);
    expect(src.a.b.c).toBe(1); // ★ המקור לא נגע
    expect(out.list).toBe(src.list); // ענפים שלא נגעו בהם משותפים
  });

  it('כתיבה דרך מערך משאירה מערך — ולא הופכת אותו לאובייקט', () => {
    // הנתיב האמיתי בעורך: questions/<index>/setting/<field>
    const file = { questions: [{ setting: { a: false } }, { setting: { a: false } }] };
    const out = setAt(file, ['questions', '1', 'setting', 'a'], true);
    expect(Array.isArray(out.questions)).toBe(true); // ★ בלי זה קובץ המשחק נשבר
    expect(out.questions.length).toBe(2);
    expect(out.questions[1]?.setting.a).toBe(true);
    expect(out.questions[0]?.setting.a).toBe(false);
    expect(file.questions[1]?.setting.a).toBe(false); // המקור לא נגע
  });

  it('יוצר את הנתיב אם חסר', () => {
    const out = setAt({}, ['x', 'y'], 'z');
    expect(getAt(out, ['x', 'y'])).toBe('z');
  });
});

describe('labelFor', () => {
  it('תווית עברית לשדה מוכר', () => {
    expect(labelFor('mainColor')).toBe('צבע ראשי');
  });
  it('שדה לא מוכר מוצג בשמו — כדי שיהיה נגיש מיד', () => {
    expect(labelFor('brandNewField')).toBe('brandNewField');
  });
});
