import { describe, expect, it } from 'vitest';
import { GameValidationError, parseGameFileLenient } from '../src/engine/index.ts';
import { fourAnswers, rawGame, rawSlide } from './helpers.ts';

describe('parseGameFileLenient — דילוג על שקופיות פגומות', () => {
  it('קובץ תקין — dropped ריק, כל השקופיות נשמרות', () => {
    const raw = rawGame([
      rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1) }),
      rawSlide({ id: 2, type: 'survey', answers: fourAnswers(1) }),
    ]);
    const { game, dropped } = parseGameFileLenient(raw);
    expect(dropped).toEqual([]);
    expect(game.questions.length).toBe(2);
  });

  it('סקר בלי תשובות (placeholder) — מושמט, השאר נטען', () => {
    const raw = rawGame([
      rawSlide({ id: 10, type: 'trivia', answers: fourAnswers(2) }),
      rawSlide({ id: 330, type: 'survey', que: 'סקר❕', answers: [] }),
    ]);
    const { game, dropped } = parseGameFileLenient(raw);
    // נשארה רק שקופית הטריוויה
    expect(game.questions.map((s) => s.id)).toEqual([10]);
    expect(dropped.length).toBe(1);
    expect(dropped[0]!.position).toBe(2);
    expect(dropped[0]!.id).toBe(330);
    expect(dropped[0]!.messages.join(' ')).toMatch(/לפחות 2 תשובות/);
  });

  it('טריוויה בלי תשובה נכונה — מושמטת עם הודעה מתאימה', () => {
    const raw = rawGame([
      rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(2) }),
      rawSlide({ id: 2, type: 'trivia', answers: fourAnswers(0) }), // אין נכונה
    ]);
    const { game, dropped } = parseGameFileLenient(raw);
    expect(game.questions.map((s) => s.id)).toEqual([1]);
    expect(dropped.length).toBe(1);
    expect(dropped[0]!.id).toBe(2);
    expect(dropped[0]!.messages.join(' ')).toMatch(/תשובה נכונה/);
  });

  it('כמה שקופיות פגומות — כולן מדווחות לפי סדר, השאר נשמרות', () => {
    const raw = rawGame([
      rawSlide({ id: 1, type: 'survey', answers: [] }), // פגומה
      rawSlide({ id: 2, type: 'trivia', answers: fourAnswers(1) }), // תקינה
      rawSlide({ id: 3, type: 'survey', answers: [] }), // פגומה
    ]);
    const { game, dropped } = parseGameFileLenient(raw);
    expect(game.questions.map((s) => s.id)).toEqual([2]);
    expect(dropped.map((d) => d.position)).toEqual([1, 3]);
    expect(dropped.map((d) => d.id)).toEqual([1, 3]);
  });

  it('כל השקופיות פגומות — לא נותרת אף אחת → זורק (אין מה לשחק)', () => {
    const raw = rawGame([
      rawSlide({ id: 1, type: 'survey', answers: [] }),
      rawSlide({ id: 2, type: 'survey', answers: [] }),
    ]);
    expect(() => parseGameFileLenient(raw)).toThrow(GameValidationError);
  });

  it('בעיה גלובלית (צבע לא חוקי) — זורק, לא מדלגים על שקופית', () => {
    const raw = rawGame([rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(1) })], {});
    (raw.setting as Record<string, unknown>).mainColor = 'red';
    expect(() => parseGameFileLenient(raw)).toThrowError(/HEX/);
  });

  it('בעיה גלובלית + שקופית פגומה יחד — זורק (הגלובלית לא ניתנת לתיקון בדילוג)', () => {
    const raw = rawGame([rawSlide({ id: 1, type: 'survey', answers: [] })], {});
    (raw.setting as Record<string, unknown>).mainColor = 'red';
    expect(() => parseGameFileLenient(raw)).toThrow(GameValidationError);
  });
});
