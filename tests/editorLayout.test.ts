/**
 * עמודת "הגדרות המשחק" בעורך המקומי.
 *
 * הבדיקה המרכזית כאן היא ששני הכללים חיים יחד: העמודה **מוצהרת** (שש קבוצות
 * בשמות של המערכת המקוונת), אבל אף שדה בסכימה לא נעלם בגללה — כל שדה או משויך
 * לקבוצה, או מוסתר במפורש, או נופל ל"שדות נוספים".
 */

import { describe, expect, it } from 'vitest';
import {
  HIDDEN_SETTINGS,
  SETTINGS_SECTIONS,
  sectionNodes,
  unassignedSettings,
} from '../src/app/editorLayout.ts';
import { describeObject, labelFor } from '../src/app/schemaForm.ts';
import { globalSettingsSchema } from '../src/engine/schema.ts';

const FIELDS = describeObject(globalSettingsSchema);

describe('עמודת ההגדרות — הסידור המוצהר', () => {
  it('★ שש הקבוצות, בשמות ובסדר של מערכת יצירת המשחקים', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.title)).toEqual([
      'כללי',
      'עיצוב ומדיה',
      'מהלך המשחק',
      'ניקוד ומנצחים',
      'הגדרות מתקדמות',
    ]);
    // "כלים" אינו קבוצת שדות מהסכימה אלא פעולות, ולכן אינו ברשימה הזו.
  });

  it('★ אין שדה שנופל בין הכיסאות — הכול משויך, מוסתר, או ב"שדות נוספים"', () => {
    const assigned = new Set(SETTINGS_SECTIONS.flatMap((s) => s.keys));
    const hidden = new Set(HIDDEN_SETTINGS);
    const extra = new Set(unassignedSettings(FIELDS).map((n) => n.key));
    for (const node of FIELDS) {
      expect(
        assigned.has(node.key) || hidden.has(node.key) || extra.has(node.key),
        node.key,
      ).toBe(true);
    }
  });

  it('★ "רישיון ומגבלות" אינו מוצג — הוא נתון של המערכת, לא של מחבר המשחק', () => {
    expect(HIDDEN_SETTINGS).toContain('limit');
    const shown = SETTINGS_SECTIONS.flatMap((s) => sectionNodes(FIELDS, s).map((n) => n.key));
    expect(shown).not.toContain('limit');
    expect(unassignedSettings(FIELDS).map((n) => n.key)).not.toContain('limit');
  });

  it('כרגע כל שדה בסכימה משויך — "שדות נוספים" אינו מוצג', () => {
    // אם זה נשבר, נוסף שדה לסכימה: לשייך אותו לקבוצה (או להסתיר במודע).
    expect(unassignedSettings(FIELDS).map((n) => n.key)).toEqual([]);
  });

  it('כל שדה מוצהר קיים באמת בסכימה — שם שהשתנה לא ייעלם בשקט', () => {
    const known = new Set(FIELDS.map((n) => n.key));
    for (const section of SETTINGS_SECTIONS) {
      for (const key of section.keys) expect(known.has(key), `${section.id}/${key}`).toBe(true);
    }
    for (const key of HIDDEN_SETTINGS) expect(known.has(key), key).toBe(true);
  });
});

/**
 * ★ הדרישה שהמשתמש ניסח: "שלא יהיה שם הגדרות באנגלית של גייסון". תווית שאין
 * לה תרגום נופלת לשם המפתח האנגלי — וזה בדיוק מה שאסור שיגיע למסך.
 */
describe('אין תוויות באנגלית במה שהעורך מציג', () => {
  const isHebrew = (s: string) => /[֐-׿]/.test(s);

  const walk = (nodes: typeof FIELDS, trail: string[] = []): string[] =>
    nodes.flatMap((n) => [
      ...(isHebrew(n.label) ? [] : [[...trail, n.key].join('.')]),
      ...(n.kind === 'object' ? walk(n.children, [...trail, n.key]) : []),
    ]);

  it('★ כל שדה שמוצג בעמודה — התווית שלו בעברית', () => {
    const shown = SETTINGS_SECTIONS.flatMap((s) => sectionNodes(FIELDS, s));
    expect(walk(shown)).toEqual([]);
  });

  it('★ ערכי הבחירה מוצגים בעברית, ולא הערך האנגלי שנשמר בקובץ', () => {
    // סוג המשחק היה מוצג כתיבת טקסט עם "classic" בתוכה.
    const gameType = FIELDS.find((n) => n.key === 'gameType');
    expect(gameType?.kind).toBe('enum');
    if (gameType?.kind !== 'enum') return;
    expect(gameType.options.map((o) => o.value)).toEqual(['classic', 'snakes_ladders_team']);
    for (const o of gameType.options) expect(isHebrew(o.label), o.value).toBe(true);
  });

  it('מפתח שהיה מגיע כמו שהוא — כבר לא', () => {
    expect(labelFor('nextSlide')).toBe('מעבר לשקופית הבאה');
  });
});
