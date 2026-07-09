import { describe, expect, it } from 'vitest';
import { parseGameFile } from '../src/engine/index.ts';
import { fourAnswers, rawGame, rawSlide } from './helpers.ts';

/** גרסה "דקה" של קובץ משחק — כמו data.json בתוך ZIP אופליין. */
function slimOfflineGame(): Record<string, unknown> {
  const full = rawGame([
    rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(3), scoreForQue: 3 }),
  ]);
  // מוחקים את השדות שאינם קיימים בקובץ האופליין
  for (const key of [
    'id',
    'assets',
    'createdAt',
    'credit',
    'users',
    'room',
    'baseUrl',
    'cloudinaryAbsolutePathImage',
    'cloudinaryAbsolutePathVideo',
  ]) {
    delete full[key];
  }
  return full;
}

describe('פורמט אופליין דק (data.json ב-ZIP)', () => {
  it('קובץ בלי השדות העליונים האופציונליים עובר ולידציה עם ברירות מחדל', () => {
    const game = parseGameFile(slimOfflineGame());
    expect(game.id).toBe('');
    expect(game.assets).toEqual([]);
    expect(game.createdAt).toBe('');
    expect(game.credit).toBeNull();
    expect(game.users).toBe('{}');
    expect(game.room).toBeNull();
    expect(game.baseUrl).toBe('');
    expect(game.questions).toHaveLength(1);
  });

  it('limit עם שדה number עודף (clickers) — נסבל, השדות הנדרשים נשמרים', () => {
    const raw = slimOfflineGame();
    (raw.setting as { limit: unknown }).limit = { type: 'clickers', number: 99999 };
    const game = parseGameFile(raw);
    expect(game.setting.limit.type).toBe('clickers');
  });

  it('נתיבי מדיה יחסיים (Assets/...) נשמרים כמו שהם עד למיפוי ה-ZIP', () => {
    const raw = slimOfflineGame();
    (raw.setting as { logo: { src: string } }).logo = { src: 'Assets/logo.png' };
    const game = parseGameFile(raw);
    expect(game.setting.logo.src).toBe('Assets/logo.png');
  });
});
