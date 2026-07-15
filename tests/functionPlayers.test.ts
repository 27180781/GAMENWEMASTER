/**
 * בחירת המשתתפים להסרה/השארה (functionPlayers.selectPlayersToRemove) —
 * לפי אחוזים/מספר, דירוג ניקוד, רנדומלי, ולפי שיוך לקבוצות.
 */

import { describe, expect, it } from 'vitest';
import { selectPlayersToRemove, type PlayersConfig } from '../src/app/functionPlayers.ts';

const players = ['a', 'b', 'c', 'd'];
const scores: Record<string, number> = { a: 40, b: 30, c: 20, d: 10 };
const sorted = (ids: string[]) => [...ids].sort();

describe('selectPlayersToRemove — כמות ודירוג', () => {
  it('remove · percent 50 · top — מסיר את שני בעלי הניקוד הגבוה', () => {
    const cfg: PlayersConfig = { mode: 'remove', selection: 'top', unit: 'percent', amount: 50 };
    expect(sorted(selectPlayersToRemove(players, scores, cfg))).toEqual(['a', 'b']);
  });

  it('remove · count 2 · bottom — מסיר את שני בעלי הניקוד הנמוך', () => {
    const cfg: PlayersConfig = { mode: 'remove', selection: 'bottom', unit: 'count', amount: 2 };
    expect(sorted(selectPlayersToRemove(players, scores, cfg))).toEqual(['c', 'd']);
  });

  it('keep · top 2 — משאיר את שני הגבוהים ומסיר את השאר', () => {
    const cfg: PlayersConfig = { mode: 'keep', selection: 'top', unit: 'count', amount: 2 };
    expect(sorted(selectPlayersToRemove(players, scores, cfg))).toEqual(['c', 'd']);
  });

  it('percent מעוגל, נחתך לטווח [0,100]', () => {
    expect(selectPlayersToRemove(players, scores, { mode: 'remove', selection: 'top', unit: 'percent', amount: 100 })).toHaveLength(4);
    expect(selectPlayersToRemove(players, scores, { mode: 'remove', selection: 'top', unit: 'percent', amount: 0 })).toHaveLength(0);
  });

  it('random · דטרמיניסטי עם RNG מוזרק', () => {
    const rng = () => 0; // תמיד 0 → shuffle יציב
    const removed = selectPlayersToRemove(players, scores, { mode: 'remove', selection: 'random', unit: 'count', amount: 2 }, { rng });
    expect(removed).toHaveLength(2);
    expect(removed.every((id) => players.includes(id))).toBe(true);
  });

  it('רשימת מועמדים ריקה → אין הסרות', () => {
    expect(selectPlayersToRemove([], scores, { mode: 'remove', selection: 'top', unit: 'count', amount: 5 })).toEqual([]);
  });
});

describe('selectPlayersToRemove — לפי קבוצות', () => {
  const groupNamesOf = (id: string): string[] =>
    ({ a: ['אריות'], b: ['אריות'], c: ['נמרים'], d: [] })[id] ?? [];

  it('remove · groups — מסיר את המשויכים לקבוצות שנבחרו (לפי שם)', () => {
    const cfg: PlayersConfig = { mode: 'remove', selection: 'groups', groups: ['אריות'] };
    expect(sorted(selectPlayersToRemove(players, scores, cfg, { groupNamesOf }))).toEqual(['a', 'b']);
  });

  it('keep · groups — משאיר רק את הקבוצות שנבחרו, מסיר את השאר', () => {
    const cfg: PlayersConfig = { mode: 'keep', selection: 'groups', groups: ['אריות'] };
    expect(sorted(selectPlayersToRemove(players, scores, cfg, { groupNamesOf }))).toEqual(['c', 'd']);
  });

  it('שמות עם רווחים מיותרים מנורמלים, וקבוצה לא קיימת לא מסירה איש', () => {
    expect(selectPlayersToRemove(players, scores, { mode: 'remove', selection: 'groups', groups: [' אריות '] }, { groupNamesOf }).sort()).toEqual(['a', 'b']);
    expect(selectPlayersToRemove(players, scores, { mode: 'remove', selection: 'groups', groups: ['לא-קיים'] }, { groupNamesOf })).toEqual([]);
  });
});
