/**
 * תווית סוג השאלה בראש המסך (setting.showQuestionTypeLabel): «📊 סקר · אין תשובה
 * נכונה» ו«🗳 הרוב קובע את התשובה». רק false מסתיר אותן, והן נבדקות כאן מהקובץ
 * ועד ה-HTML של המסך, דרך המנוע והמסכים האמיתיים של הגלריה.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseGameFile } from '../src/engine/index.ts';
import { SlideView } from '../src/render/SlideView.tsx';
import { findScreen } from '../src/gallery/screens.tsx';
import {
  COLOR_PRESETS,
  engineAt,
  makeGame as makeGalleryGame,
  revealVoting,
  type GalleryContext,
} from '../src/gallery/mockData.ts';
import { fourAnswers, rawGame, rawSlide } from './helpers.ts';

const SURVEY_PILL = 'סקר · אין תשובה נכונה';
const MAJORITY_PILL = 'הרוב קובע את התשובה';

const ctx: GalleryContext = { theme: 'classic', colors: COLOR_PRESETS.default!, bg: '' };

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

function settingValue(value: unknown, present = true): boolean {
  const raw = rawGame([rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1) })]);
  if (present) (raw.setting as Record<string, unknown>).showQuestionTypeLabel = value;
  return parseGameFile(raw).setting.showQuestionTypeLabel;
}

function screenHtml(id: string): string {
  const screen = findScreen(id);
  if (screen === undefined) throw new Error(`אין מסך ${id} בגלריה`);
  return renderToStaticMarkup(createElement('div', null, screen.build(ctx).node));
}

/** שקופית «הרוב קובע» בזמן ההצבעה, עם הגדרות המשחק הנתונות. */
function majorityHtml(setting: Record<string, unknown>): string {
  const game = makeGalleryGame(
    ctx,
    [
      {
        id: 1,
        type: 'trivia',
        que: 'מה הכי טעים בחג?',
        answers: [
          ['סופגניות', false],
          ['לביבות', false],
        ],
        settings: { majorityDecides: true },
      },
    ],
    setting,
  );
  const engine = engineAt(game, 1, 'voting');
  return renderToStaticMarkup(
    createElement(SlideView, {
      engine,
      state: engine.getState(),
      timer: null,
      reveal: revealVoting(2),
      players: [],
      leaders: [],
    }),
  );
}

describe('showQuestionTypeLabel — טעינה', () => {
  it('קובץ בלי השדה — מוצגת, בדיוק כמו קודם', () => {
    expect(settingValue(undefined, false)).toBe(true);
  });

  it('רק false מסתיר; כל ערך אחר (גם המחרוזת "false") משאיר אותה ולא מפיל את הקובץ', () => {
    expect(settingValue(false)).toBe(false);
    expect(settingValue(true)).toBe(true);
    for (const other of ['false', 0, null, '', 'no', {}]) expect(settingValue(other)).toBe(true);
  });
});

describe('showQuestionTypeLabel — המסך', () => {
  it('סקר: התווית מוצגת כברירת מחדל ונעלמת כשההגדרה כבויה', () => {
    expect(screenHtml('poll')).toContain(SURVEY_PILL);
    const hidden = screenHtml('poll-no-type-label');
    expect(hidden).not.toContain(SURVEY_PILL);
    // אייקון העוגה ליד נוסח השאלה נשאר, וכך גם הפילוח
    expect(hidden).toContain('q-survey-icon');
  });

  it('«הרוב קובע»: אותו כלל', () => {
    expect(majorityHtml({})).toContain(MAJORITY_PILL);
    expect(majorityHtml({ showQuestionTypeLabel: false })).not.toContain(MAJORITY_PILL);
  });
});
