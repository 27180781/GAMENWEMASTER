/**
 * ערכת 'neondraw' («ניאון מצטייר»): קפסולות זכוכית שקופות וקו ניאון שמצטייר סביבן
 * מ-0 ל-100% בכל חשיפה (NeonRing). נבדק כאן: הרישום והנרמול, שהקו נמצא בדיוק
 * בקפסולות של מסך השאלה וההימור (כותרת, שאלה, כל תשובה), שבכל ערכה אחרת הוא
 * מוסתר, ושההצטיירות קשורה לרגע החשיפה (reveal-hidden) ולא ליצירת הכרטיס.
 */

import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { VISUAL_THEMES, VISUAL_THEME_LABELS, normalizeVisualTheme, parseGameFile } from '../src/engine/index.ts';
import { findScreen } from '../src/gallery/screens.tsx';
import { COLOR_PRESETS, type GalleryContext } from '../src/gallery/mockData.ts';
import { fourAnswers, rawGame, rawSlide } from './helpers.ts';

const ctx: GalleryContext = { theme: 'neondraw', colors: COLOR_PRESETS.default!, bg: '' };

// המסכים נכתבו לדפדפן, וב-SSR של הבדיקה React מזהיר על useLayoutEffect. זה לא מעניין כאן.
const consoleError = console.error;
beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return;
    consoleError(...args);
  });
});
afterAll(() => {
  vi.restoreAllMocks();
});

function screenHtml(id: string): string {
  const screen = findScreen(id);
  if (screen === undefined) throw new Error(`אין מסך ${id} בגלריה`);
  return renderToStaticMarkup(createElement('div', null, screen.build(ctx).node));
}

/** כמה קווים יש בתוך כל אלמנט שמחלקה שלו מתחילה ב-cls (לפי סדר ה-HTML). */
function ringsInside(html: string, cls: string): number {
  const doc = html.split(new RegExp(`class="${cls}[" ]`)).slice(1);
  return doc.filter((chunk) => /^[^<]*>(?:(?!<(?:li|div) class="q-(?:card|question|title-pill))[\s\S])*?class="neon-ring"/.test(chunk)).length;
}

const css = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf-8');

describe("ערכת 'neondraw' — רישום", () => {
  it('רשומה עם השם בעברית', () => {
    expect(VISUAL_THEMES).toContain('neondraw');
    expect(VISUAL_THEME_LABELS.neondraw).toBe('ניאון מצטייר');
  });

  it('נשמרת בטעינת קובץ המשחק', () => {
    expect(normalizeVisualTheme('neondraw')).toBe('neondraw');
    const raw = rawGame([rawSlide({ id: 1, type: 'trivia', que: 'שאלה', answers: fourAnswers(2) })]);
    (raw.setting as Record<string, unknown>).visualTheme = 'neondraw';
    expect(parseGameFile(raw).setting.visualTheme).toBe('neondraw');
  });
});

describe('NeonRing במסכים', () => {
  it('מסך שאלה: קו אחד בכותרת, אחד בשאלה ואחד בכל תשובה', () => {
    const html = screenHtml('question-4');
    const cards = html.match(/<li class="q-card[" ]/g)?.length ?? 0;
    expect(cards).toBe(4);
    expect(html.match(/class="neon-ring"/g)?.length).toBe(cards + 2);
    expect(ringsInside(html, 'q-title-pill')).toBe(1);
    expect(ringsInside(html, 'q-question')).toBe(1);
    expect(ringsInside(html, 'q-card')).toBe(cards);
  });

  it('שמונה תשובות — קו בכל אחת', () => {
    const html = screenHtml('question-8');
    expect(ringsInside(html, 'q-card')).toBe(8);
  });

  it('שקופית הימור: גם כרטיסי ההימור מצטיירים', () => {
    const html = screenHtml('bet');
    const cards = html.match(/<li class="q-card bet-card[" ]/g)?.length ?? 0;
    expect(cards).toBeGreaterThan(0);
    expect(ringsInside(html, 'q-card')).toBe(cards);
  });

  it('הקו קישוטי בלבד — מוסתר מקוראי מסך', () => {
    const html = screenHtml('question-4');
    const rings = html.match(/<svg[^>]*class="neon-ring"[^>]*>/g) ?? [];
    expect(rings.length).toBeGreaterThan(0);
    for (const tag of rings) expect(tag).toContain('aria-hidden="true"');
  });
});

describe('neondraw.css / styles.css', () => {
  const nd = css('../src/render/themes/neondraw.css');
  const base = css('../src/render/styles.css');

  it('בכל ערכה אחרת הקו מוסתר (display:none ב-styles.css), ורק neondraw מציגה אותו', () => {
    expect(base).toMatch(/\.neon-ring\s*\{[^}]*display:\s*none/);
    expect(nd).toMatch(/data-visual-theme='neondraw'\]\s*\.neon-ring\s*\{[^}]*display:\s*block/);
    for (const theme of VISUAL_THEMES.filter((t) => t !== 'neondraw' && !['classic', 'studio', 'glass', 'scroll'].includes(t))) {
      expect(css(`../src/render/themes/${theme}.css`)).not.toContain('neon-ring');
    }
    expect(css('../src/render/themes.css')).not.toContain('neon-ring');
  });

  it('הקו מצטייר מ-0 ל-100% ברגע החשיפה (‎:not(.reveal-hidden)‎), לא כשהכרטיס נוצר מוסתר', () => {
    expect(nd).toMatch(/@keyframes vt-nd-draw\s*\{\s*from\s*\{\s*stroke-dashoffset:\s*100;?\s*\}\s*to\s*\{\s*stroke-dashoffset:\s*0;?\s*\}/);
    expect(nd).toMatch(/:is\(\.q-card, \.q-question\):not\(\.reveal-hidden\) > \.neon-ring[^{]*\{\s*animation:\s*vt-nd-draw/);
  });

  it('הגופן הוא Kanuba — הגופן של חוויה בקליק', () => {
    expect(nd).toMatch(/font-family:\s*'Kanuba'/);
  });

  it('כללי הברזל: אין מידות/ריפוד/גופן-גודל בערכה', () => {
    // הסרת הערות, ואז חיפוש תכונות גאומטריה בכללים עצמם
    const rules = nd.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/(?:^|[;{\s])(?:width|height|padding|margin|gap|font-size|top|left|border-width)\s*:/);
  });
});
