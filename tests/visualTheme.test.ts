/**
 * ערכות נושא חזותיות (setting.visualTheme): הנרמול בטעינת קובץ המשחק, ושלכל
 * ערכה מלבד classic יש כללים ב-src/render/themes.css.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VISUAL_THEMES, normalizeVisualTheme } from '../src/engine/index.ts';
import { makeGame, rawGame, rawSlide, fourAnswers } from './helpers.ts';

function gameWithTheme(visualTheme: unknown, present = true) {
  const base = rawGame([rawSlide({ id: 1, type: 'trivia', que: 'שאלה', answers: fourAnswers(2) })]);
  const setting = { ...(base['setting'] as Record<string, unknown>) };
  if (present) setting['visualTheme'] = visualTheme;
  return makeGame(base['questions'] as Record<string, unknown>[], { setting });
}

describe('setting.visualTheme', () => {
  it('חסר ⇒ classic', () => {
    expect(gameWithTheme(undefined, false).setting.visualTheme).toBe('classic');
  });

  it('ערכה מוכרת נשמרת', () => {
    expect(gameWithTheme('glass').setting.visualTheme).toBe('glass');
  });

  it('ערכה לא מוכרת (עדיין) ⇒ classic', () => {
    expect(gameWithTheme('neon').setting.visualTheme).toBe('classic');
  });

  it('ערך שאינו מחרוזת ⇒ classic, בלי לפסול את הקובץ', () => {
    for (const v of [42, true, null, { theme: 'glass' }]) {
      expect(normalizeVisualTheme(v)).toBe('classic');
      // שדה מראה בלבד לעולם לא אמור להפיל משחק חי
      expect(gameWithTheme(v).setting.visualTheme).toBe('classic');
    }
  });
});

describe('themes.css', () => {
  const css = readFileSync(new URL('../src/render/themes.css', import.meta.url), 'utf-8');

  it.each(VISUAL_THEMES.filter((t) => t !== 'classic'))('לערכה %s יש כללים', (theme) => {
    // גרשיים בודדים או כפולים — שתי הצורות תקינות ב-CSS
    expect(css).toMatch(new RegExp(`data-visual-theme=(["'])${theme}\\1`));
  });

  it('classic אינו מקבל אף כלל — הוא המראה של styles.css כפי שהוא', () => {
    expect(css).not.toMatch(/data-visual-theme=(["'])classic\1/);
  });
});
