/**
 * משחק חדש מאפס בתוכנה (בלי מערכת יצירת המשחקים) והרישיון שלו.
 *
 * מה שחשוב לנעול: הקובץ שנוצר נטען במסלול הרגיל בלי שקופיות שנשמטות ובלי
 * "מדיה חסרה", ברירת המחדל היא קליקרים ללא הגבלה (בקשת נסים), והרישיון נכתב
 * בדיוק לשדות שהמנוע כבר קורא (limit.number ו-room).
 */

import { describe, expect, it } from 'vitest';
import { parseGameFile } from '../src/engine/index.ts';
import { newGameFile } from '../src/app/newGame.ts';
import {
  applyLicense,
  DEFAULT_LICENSE,
  licenseFromGame,
  licenseProblem,
  licenseSources,
  ROOM_PATTERN,
  suggestRoomCode,
} from '../src/app/gameLicense.ts';
import { loadGameFromExtracted } from '../src/app/zipLoader.ts';
import { collectMediaRefs } from '../src/app/mediaCheck.ts';

const fixed = { id: 'game-1', now: new Date('2026-10-05T12:00:00Z') };

describe('newGameFile', () => {
  it('ברירת המחדל: קליקרים, ללא הגבלת משתתפים, בלי קוד חדר', () => {
    const game = newGameFile({ name: '  ערב חנוכה  ', ...fixed });
    expect(game.name).toBe('ערב חנוכה');
    expect(game.id).toBe('game-1');
    expect(game.createdAt).toBe('2026-10-05T12:00:00.000Z');
    expect(game.setting.limit).toEqual({ type: 'clickers' });
    expect(game.room).toBeNull();
    expect(licenseFromGame(game)).toEqual(DEFAULT_LICENSE);
    expect(licenseSources(game)).toEqual({ clickers: true, phones: false });
  });

  it('נפתח עם שאלת טריוויה אחת תקינה עם תשובה נכונה', () => {
    const game = newGameFile({ name: 'x', ...fixed });
    expect(game.questions).toHaveLength(1);
    const [slide] = game.questions;
    expect(slide?.type).toBe('trivia');
    expect(slide?.question.answers).toHaveLength(4);
    expect(slide?.question.answers.filter((a) => a.correct)).toHaveLength(1);
  });

  it('מזהה חדש לכל משחק', () => {
    const a = newGameFile({ name: 'a' });
    const b = newGameFile({ name: 'b' });
    expect(a.id).not.toBe('');
    expect(a.id).not.toBe(b.id);
  });

  it('נטען במסלול של התוכנה בלי שקופיות שנשמטות ובלי מדיה חסרה', () => {
    const game = newGameFile({ name: 'x', ...fixed });
    const loaded = loadGameFromExtracted({
      cacheKey: 'k',
      dataPath: 'data.json',
      dataJson: JSON.stringify(game),
      names: ['data.json'],
    });
    expect(loaded.dropped).toEqual([]);
    expect(loaded.missing).toEqual([]);
    expect(loaded.game.name).toBe('x');
    expect(collectMediaRefs(loaded.game)).toEqual([]);
  });

  it('שמירה בעורך (JSON של המשחק המנותח) נטענת שוב זהה', () => {
    const game = newGameFile({
      name: 'x',
      license: { kind: 'both', limit: 40, room: '12345' },
      ...fixed,
    });
    const again = parseGameFile(JSON.parse(JSON.stringify(game)));
    expect(again).toEqual(game);
  });

  it('רישיון טלפונים נכתב לקוד החדר ולמגבלה', () => {
    const game = newGameFile({
      name: 'x',
      license: { kind: 'phones', limit: 120, room: '54321' },
      ...fixed,
    });
    expect(game.room).toBe('54321');
    expect(game.setting.limit).toEqual({ type: 'phones', number: 120 });
    expect(licenseSources(game)).toEqual({ clickers: false, phones: true });
  });
});

describe('applyLicense / licenseFromGame', () => {
  const base = newGameFile({ name: 'x', ...fixed });

  it('קליקרים מוחקים את קוד החדר — אין טלפונים', () => {
    const phones = applyLicense(base, { kind: 'phones', limit: null, room: '11111' });
    const clickers = applyLicense(phones, { kind: 'clickers', limit: null, room: '11111' });
    expect(clickers.room).toBeNull();
    expect(clickers.setting.limit).toEqual({ type: 'clickers' });
  });

  it('גם וגם — שני המקורות', () => {
    const both = applyLicense(base, { kind: 'both', limit: 30, room: '777' });
    expect(licenseFromGame(both)).toEqual({ kind: 'both', limit: 30, room: '777' });
    expect(licenseSources(both)).toEqual({ clickers: true, phones: true });
  });

  it('לא משנה את המשחק המקורי', () => {
    applyLicense(base, { kind: 'phones', limit: 5, room: '12345' });
    expect(base.room).toBeNull();
    expect(base.setting.limit).toEqual({ type: 'clickers' });
  });

  it('שאר ההגדרות נשמרות', () => {
    const next = applyLicense(base, { kind: 'both', limit: 9, room: '1234' });
    expect({ ...next.setting, limit: base.setting.limit }).toEqual(base.setting);
    expect(next.questions).toBe(base.questions);
  });

  it('סוג לא מוכר נקרא כקליקרים, כמו במנוע', () => {
    const odd = { ...base, setting: { ...base.setting, limit: { type: 'whatever' } } };
    expect(licenseFromGame(odd).kind).toBe('clickers');
  });

  it('"" במגבלה (ללא הגבלה בקובץ מהמערכת) נקרא כללא הגבלה', () => {
    const raw = JSON.parse(JSON.stringify(base));
    raw.setting.limit = { type: 'clickers', number: '' };
    expect(licenseFromGame(parseGameFile(raw)).limit).toBeNull();
  });

  it('מגבלה 0 נקראת כמו שהיא, כדי שהבדיקה תסמן אותה', () => {
    const zero = applyLicense(base, { kind: 'clickers', limit: 0, room: '' });
    const license = licenseFromGame(zero);
    expect(license.limit).toBe(0);
    expect(licenseProblem(license)).not.toBeNull();
  });
});

describe('licenseProblem', () => {
  it('ברירת המחדל תקינה', () => {
    expect(licenseProblem(DEFAULT_LICENSE)).toBeNull();
  });

  it('טלפונים בלי קוד חדר תקין', () => {
    expect(licenseProblem({ kind: 'phones', limit: null, room: '' })).toMatch(/קוד החדר/);
    expect(licenseProblem({ kind: 'both', limit: null, room: '12' })).toMatch(/קוד החדר/);
    expect(licenseProblem({ kind: 'both', limit: null, room: '1234567' })).toMatch(/קוד החדר/);
    expect(licenseProblem({ kind: 'phones', limit: null, room: '12a4' })).toMatch(/קוד החדר/);
  });

  it('קליקרים לא צריכים קוד חדר', () => {
    expect(licenseProblem({ kind: 'clickers', limit: null, room: '' })).toBeNull();
  });

  it('מספר משתתפים חייב להיות שלם וחיובי', () => {
    expect(licenseProblem({ kind: 'clickers', limit: 0, room: '' })).toMatch(/משתתפים/);
    expect(licenseProblem({ kind: 'clickers', limit: 2.5, room: '' })).toMatch(/משתתפים/);
    expect(licenseProblem({ kind: 'clickers', limit: 1, room: '' })).toBeNull();
  });

  it('קוד של רישיון טלפונים מהאתר (4 ספרות) עובר', () => {
    expect(licenseProblem({ kind: 'phones', limit: null, room: '5123' })).toBeNull();
  });
});

describe('suggestRoomCode', () => {
  it('תמיד 5 ספרות — מחוץ לטווח של 4 ספרות שהמערכת מנפיקה', () => {
    expect(suggestRoomCode(() => 0)).toBe('10000');
    expect(suggestRoomCode(() => 0.999999)).toBe('99999');
    for (let i = 0; i < 200; i++) {
      const code = suggestRoomCode();
      expect(code).toMatch(/^\d{5}$/);
      expect(ROOM_PATTERN.test(code)).toBe(true);
    }
  });
});
