/**
 * electron-builder.yml מול הסכימה של electron-builder.
 *
 * הבנייה ב-CI נופלת על מפתח לא חוקי רק *אחרי* npm test, ההתקנה והבדיקות —
 * וגרסה שבורה (0.1.180: `preCompressedFileExtensions` תחת portable, שאינו
 * מכיר אותו) גילתה את זה רק בשרת. אותה בדיקה שהבנייה עושה רצה כאן מקומית.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { load } from 'js-yaml';
import validateSchema from '@develar/schema-utils';

const config = load(readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8')) as Record<string, unknown>;
const schema = JSON.parse(
  readFileSync(new URL('../node_modules/app-builder-lib/scheme.json', import.meta.url), 'utf8'),
) as Parameters<typeof validateSchema>[0];

describe('electron-builder.yml', () => {
  it('★ תואם לסכימה של electron-builder — מפתח במקום הלא נכון נופל כאן ולא ב-CI', () => {
    expect(() => validateSchema(schema, config, { name: 'electron-builder.yml' })).not.toThrow();
  });

  it('★ המתקין (nsis) ראשון ברשימת היעדים — הוא בונה את חבילת האפליקציה הידידותית לעדכון הפרשי', () => {
    const targets = (config.win as { target: { target: string }[] }).target.map((t) => t.target);
    expect(targets[0]).toBe('nsis');
    expect(targets).toContain('portable');
  });

  it('★ סרטוני ההדרכה מחוץ ל-asar ונשארים בחבילה המשותפת (גם לנייד)', () => {
    expect(config.asarUnpack).toEqual(['dist/guide/**']);
    expect((config.nsis as Record<string, unknown>).preCompressedFileExtensions).toEqual([]);
    expect((config.portable as Record<string, unknown>).preCompressedFileExtensions).toBeUndefined();
  });
});
