/**
 * סיבוב ניסוחי האווירה (ENGINE-narration.md 1.1): המנוע מסובב בין הניסוחים
 * החלופיים של כל מצב ואינו משמיע פעמיים ברצף את אותו ניסוח; ניסוח שחסר בבנק
 * מדולג, וכשאין אף אחד — השורה נופלת בשקט.
 */

import { describe, expect, it } from 'vitest';
import {
  AMB_LOBBY,
  pickAmbience,
  type AmbienceRotation,
} from '../src/app/narration/ambience.ts';

/** בנק שמכיר בדיוק את המפתחות שנמסרו לו. */
function bankOf(keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.map((key) => [key, `${key}.mp3`]));
}

/** מריץ n בחירות רצופות לאותו מצב ומחזיר את הניסוחים שנבחרו. */
function sequence(
  keys: readonly string[],
  bank: Record<string, string>,
  times: number,
  situation = 'sit',
): (string | null)[] {
  let rotation: AmbienceRotation = {};
  const out: (string | null)[] = [];
  for (let i = 0; i < times; i += 1) {
    const pick = pickAmbience(situation, keys, bank, rotation);
    rotation = pick.rotation;
    out.push(pick.key);
  }
  return out;
}

const THREE = ['a', 'b', 'c'];

describe('pickAmbience', () => {
  it('★ מסובב בין הניסוחים ומתחיל מהתחלה אחרי סבב מלא', () => {
    expect(sequence(THREE, bankOf(THREE), 7)).toEqual(['a', 'b', 'c', 'a', 'b', 'c', 'a']);
  });

  it('★ לעולם לא אותו ניסוח פעמיים ברצף', () => {
    const picks = sequence(AMB_LOBBY, bankOf(AMB_LOBBY), 20);
    for (let i = 1; i < picks.length; i += 1) expect(picks[i]).not.toBe(picks[i - 1]);
  });

  it('★ ניסוח שחסר בבנק מדולג — וגם אז אין חזרה ברצף', () => {
    const picks = sequence(THREE, bankOf(['a', 'c']), 6);
    expect(picks).toEqual(['a', 'c', 'a', 'c', 'a', 'c']);
  });

  it('★ אין אף ניסוח בבנק — השורה נופלת, והזיכרון אינו משתנה', () => {
    const rotation: AmbienceRotation = { sit: 2 };
    const pick = pickAmbience('sit', THREE, {}, rotation);
    expect(pick.key).toBeNull();
    expect(pick.rotation).toBe(rotation);
  });

  it('ניסוח יחיד בבנק נאמר שוב (אין חלופה)', () => {
    expect(sequence(THREE, bankOf(['b']), 3)).toEqual(['b', 'b', 'b']);
  });

  it('רשימה ריקה, מחרוזת ריקה בבנק ומונה מחוץ לתחום — כולם בטוחים', () => {
    expect(pickAmbience('sit', [], bankOf(THREE), {}).key).toBeNull();
    expect(pickAmbience('sit', THREE, { a: '', b: 'b.mp3', c: 'c.mp3' }, {}).key).toBe('b');
    expect(pickAmbience('sit', THREE, bankOf(THREE), { sit: 7 }).key).toBe('b');
    expect(pickAmbience('sit', THREE, bankOf(THREE), { sit: -1 }).key).toBe('c');
  });

  it('★ מצב חדש מתחיל מנקודת ההתחלה של הריצה, ומשם ממשיך בסיבוב', () => {
    const first = pickAmbience('sit', THREE, bankOf(THREE), {}, { start: 4 });
    expect(first.key).toBe('b');
    expect(pickAmbience('sit', THREE, bankOf(THREE), first.rotation, { start: 4 }).key).toBe('c');
    // מצב שכבר נבחר בו ניסוח אינו מושפע מנקודת ההתחלה.
    expect(pickAmbience('sit', THREE, bankOf(THREE), { sit: 0 }, { start: 4 }).key).toBe('a');
  });

  it('★ skip מדלג כאילו חסר בבנק — על אותו מונה, בלי חזרה ברצף', () => {
    let rotation: AmbienceRotation = {};
    const picks: (string | null)[] = [];
    for (let i = 0; i < 6; i += 1) {
      const skip = i % 2 === 1 ? new Set(['c']) : undefined;
      const pick = pickAmbience('sit', THREE, bankOf(THREE), rotation, { skip });
      rotation = pick.rotation;
      picks.push(pick.key);
    }
    // a, b, c, (c מדולג) a, b, (c מדולג) a — אף פעם לא אותו ניסוח פעמיים ברצף.
    expect(picks).toEqual(['a', 'b', 'c', 'a', 'b', 'a']);
    expect(pickAmbience('sit', ['a'], bankOf(['a']), {}, { skip: new Set(['a']) }).key).toBeNull();
  });

  it('★ avoid נמנע מניסוח כל עוד יש חלופה, ונאמר כשאין', () => {
    expect(pickAmbience('sit', THREE, bankOf(THREE), {}, { avoid: 'a' }).key).toBe('b');
    expect(pickAmbience('sit', THREE, bankOf(THREE), { sit: 1 }, { avoid: 'a' }).key).toBe('b');
    // החלופה היחידה מדולגת או חסרה — הניסוח נאמר בכל זאת, כמו ניסוח יחיד בבנק.
    expect(pickAmbience('sit', ['a', 'b'], bankOf(['a', 'b']), {}, { avoid: 'a', skip: new Set(['b']) }).key).toBe('a');
    expect(pickAmbience('sit', ['a', 'b'], bankOf(['a']), {}, { avoid: 'a' }).key).toBe('a');
    // המונה מתקדם אחרי מה שנבחר בפועל.
    const pick = pickAmbience('sit', THREE, bankOf(THREE), {}, { avoid: 'a' });
    expect(pick.rotation).toEqual({ sit: 2 });
  });

  it('לכל מצב מונה משלו — מצבים אינם מזיזים זה את זה', () => {
    let rotation: AmbienceRotation = {};
    const first = pickAmbience('one', THREE, bankOf(THREE), rotation);
    rotation = first.rotation;
    const other = pickAmbience('two', THREE, bankOf(THREE), rotation);
    expect(first.key).toBe('a');
    expect(other.key).toBe('a');
    expect(pickAmbience('one', THREE, bankOf(THREE), other.rotation).key).toBe('b');
  });
});
