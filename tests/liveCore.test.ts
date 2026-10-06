/**
 * מסך הצפייה (src/live): כינויים, הפרשים, קודי הקישור ושיקוף הסאונד.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AliasTable, keyBetween } from '../src/live/aliases.ts';
import { applyPatch, diff, isValidPatch, shareEqual, type PatchOp } from '../src/live/patch.ts';
import { FRESH_SOUND_MS, SoundTrack, mirrorSoundActions } from '../src/live/soundTrack.ts';
import {
  isViewToken,
  liveRelayBase,
  livePublishKey,
  liveViewToken,
  liveViewUrl,
  normalizeRoom,
} from '../src/live/token.ts';
// @ts-expect-error — שרת ב-JS, בלי הצהרות טיפוסים
import { viewTokenFor } from '../server/live-relay.mjs';

describe('כינויים', () => {
  it('שומרים על הסדר של המזהים, בכל סדר הופעה', () => {
    const ids = ['0541234567', '0529876543', '17', '0501111111', '9', '0541234568', 'אבי', '100'];
    const table = new AliasTable();
    const aliases = new Map<string, string>();
    for (const id of ids) aliases.set(id, table.alias(id));
    const byId = [...ids].sort((a, b) => a.localeCompare(b));
    const byAlias = [...ids].sort((a, b) => aliases.get(a)!.localeCompare(aliases.get(b)!));
    expect(byAlias).toEqual(byId);
  });

  it('אותו מזהה → אותו כינוי, ושום ספרה של הטלפון לא בכינוי', () => {
    const table = new AliasTable();
    const a = table.alias('0541234567');
    expect(table.alias('0541234567')).toBe(a);
    expect(a).not.toContain('1234567');
    expect(table.idOf(a)).toBe('0541234567');
  });

  it('כשנגמר המקום בין שכנים — חלוקה מחדש, והסדר נשמר', () => {
    const table = new AliasTable();
    // כל מזהה חדש נופל בין '0' לקודמו ('001' > '0001' > …) — הרווח נחצה בכל פעם
    const ids = ['0', '9'];
    for (const id of ids) table.alias(id);
    for (let i = 2; i < 60; i++) {
      const id = `${'0'.repeat(i)}1`;
      ids.push(id);
      table.alias(id);
    }
    expect(table.version).toBeGreaterThanOrEqual(1);
    const sorted = [...ids].sort((a, b) => a.localeCompare(b));
    const aliasesSorted = [...ids].sort((a, b) => table.alias(a).localeCompare(table.alias(b)));
    expect(aliasesSorted).toEqual(sorted);
  });

  it('keyBetween: באמצע, בקצוות, ו-null כשאין מקום', () => {
    expect(keyBetween(null, null)).toBeGreaterThan(0);
    expect(keyBetween(10, 20)).toBe(15);
    expect(keyBetween(10, 11)).toBeNull();
    expect(keyBetween(null, 1)).toBeNull();
    expect(keyBetween(null, 100)).toBe(50);
  });
});

describe('הפרשים', () => {
  const roundTrip = (a: unknown, b: unknown) => {
    const ops = diff(a, b);
    expect(isValidPatch(JSON.parse(JSON.stringify(ops)))).toBe(true);
    expect(applyPatch(a, ops)).toEqual(b);
    return ops;
  };

  it('הלוך-חזור על מבנים מקוננים', () => {
    roundTrip({ a: 1, b: { c: [1, 2], d: 'x' } }, { a: 2, b: { c: [1, 2, 3], e: null } });
    roundTrip({ list: [{ id: 'a' }, { id: 'b' }] }, { list: [{ id: 'b' }] });
    roundTrip({ x: { y: { z: 1 } } }, { x: 5 });
    expect(diff({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toEqual([]);
  });

  it('שחקן שמצטרף ללובי הוא פעולה אחת, לא כל הרשימה', () => {
    const lobby = Array.from({ length: 200 }, (_, i) => ({ id: `v${i}`, name: `שחקן ${i}` }));
    const ops = roundTrip({ lobby }, { lobby: [...lobby, { id: 'v200', name: 'חדש' }] });
    expect(ops).toEqual([[['lobby', '200'], { id: 'v200', name: 'חדש' }]]);
  });

  it('כשרוב הצומת השתנה — הצבה אחת שלו', () => {
    const before = {
      scores: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`v${i}`, i])),
    };
    const after = {
      scores: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`v${i}`, i + 7])),
    };
    expect(roundTrip(before, after)).toEqual([[['scores'], after.scores]]);
  });

  it('לא משנה את המקור, ומשתף את מה שלא השתנה', () => {
    const base = { a: { x: 1 }, b: { y: 2 } };
    const next = applyPatch(base, [[['a', 'x'], 9]]);
    expect(base.a.x).toBe(1);
    expect(next.a.x).toBe(9);
    expect(next.b).toBe(base.b);
  });

  it('נתיבים מסוכנים נדחים ולא נוגעים באב-הטיפוס', () => {
    const evil = [[['__proto__', 'polluted'], true]] as PatchOp[];
    expect(isValidPatch(evil)).toBe(false);
    applyPatch({}, evil);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // במערך — רק אינדקס קיים או הבא בתור, ולעולם לא length
    expect(applyPatch({ l: [1, 2] }, [[['l', 'length'], 0]])).toEqual({ l: [1, 2] });
    expect(applyPatch({ l: [1, 2] }, [[['l', '9'], 3]])).toEqual({ l: [1, 2] });
  });

  it('shareEqual: מצב מלא שחזר זהה — אותם אובייקטים', () => {
    const prev = { a: { list: [{ id: 1 }, { id: 2 }] }, b: { n: 1 } };
    const next = JSON.parse(JSON.stringify({ ...prev, b: { n: 2 } })) as typeof prev;
    const shared = shareEqual(prev, next);
    expect(shared).toEqual(next);
    expect(shared.a).toBe(prev.a);
    expect(shared.b).not.toBe(prev.b);
    expect(shareEqual(prev, JSON.parse(JSON.stringify(prev)))).toBe(prev);
  });
});

describe('קוד הצפייה', () => {
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');

  it('אותה נוסחה כמו בשרת וכמו במערכת יצירת המשחקים', async () => {
    const gameId = '3f0e7a3c-1111-4b2a-9d55-0123456789ab';
    const publishKey = await livePublishKey(gameId, 2047);
    expect(publishKey).toBe(sha(`trivia-live-pub:v1:${gameId}:2047`));
    const view = await liveViewToken(publishKey);
    expect(view).toBe(sha(`trivia-live-view:v1:${publishKey}`).slice(0, 20));
    expect(view).toBe(viewTokenFor(publishKey));
    expect(isViewToken(view)).toBe(true);
    expect(liveViewUrl(view)).toBe(`https://gamemwemaster.caprover.clicker.co.il/?view=${view}`);
  });

  it('קוד החדר כמספר או כמחרוזת עם אפסים מובילים — אותו קישור', async () => {
    expect(normalizeRoom('0123')).toBe('123');
    expect(normalizeRoom(123)).toBe('123');
    expect(normalizeRoom(' 0 ')).toBe('0');
    expect(await livePublishKey('g', '0123')).toBe(await livePublishKey('g', 123));
  });

  it('כתובת הממסר: אותו מקור באתר, השרת מכל מקום אחר, ודריסה לבדיקות', () => {
    const origin = 'https://gamemwemaster.caprover.clicker.co.il';
    expect(liveRelayBase({ origin, search: '' })).toBe(`${origin}/live`);
    expect(liveRelayBase({ origin: 'null', search: '' })).toBe(`${origin}/live`);
    expect(liveRelayBase({ origin, search: '?liveRelay=http://127.0.0.1:8787/live/' })).toBe(
      'http://127.0.0.1:8787/live',
    );
    expect(liveRelayBase({ origin, search: '?liveRelay=javascript:alert(1)' })).toBe(
      `${origin}/live`,
    );
  });
});

describe('שיקוף הסאונד', () => {
  it('המסך הראשי: הסאונד הנוכחי והאפקטים האחרונים', () => {
    let now = 1000;
    const track = new SoundTrack(() => now);
    expect(track.record({ type: 'play', channel: 'timer', src: 'timer.mp3', loop: true })).toBe(
      true,
    );
    expect(track.sound).toMatchObject({
      kind: 'play',
      channel: 'timer',
      src: 'timer.mp3',
      loop: true,
      at: 1000,
    });
    // עצירה של ערוץ אחר לא משנה כלום
    expect(track.record({ type: 'stop', channel: 'generic' })).toBe(false);
    now = 2000;
    expect(track.record({ type: 'stop', channel: 'timer' })).toBe(true);
    expect(track.sound.kind).toBe('none');
    expect(track.record({ type: 'stopAll' })).toBe(false);
    for (let i = 0; i < 6; i++) track.record({ type: 'cue', kind: 'climb' });
    expect(track.cues).toHaveLength(4);
    expect(track.record({ type: 'play', channel: 'generic', src: null, loop: false })).toBe(false);
  });

  it('הצופה: לולאה מתחילה גם באיחור, חד-פעמי רק כשהוא טרי', () => {
    const toLocal = (t: number) => t;
    const loop = {
      seq: 3,
      kind: 'play' as const,
      channel: 'playersConnecting',
      src: 'lobby.mp3',
      loop: true,
      at: 0,
    };
    expect(mirrorSoundActions(loop, [], -1, -1, 60_000, toLocal).actions).toEqual([
      { type: 'play', channel: 'playersConnecting', src: 'lobby.mp3', loop: true },
    ]);
    const once = { ...loop, seq: 4, loop: false, at: 10_000 };
    expect(
      mirrorSoundActions(once, [], 3, -1, 10_000 + FRESH_SOUND_MS - 1, toLocal).actions,
    ).toEqual([{ type: 'play', channel: 'playersConnecting', src: 'lobby.mp3', loop: false }]);
    expect(
      mirrorSoundActions(once, [], 3, -1, 10_000 + FRESH_SOUND_MS + 1, toLocal).actions,
    ).toEqual([{ type: 'stop' }]);
    // כבר טופל — כלום
    expect(mirrorSoundActions(once, [], 4, -1, 10_000, toLocal).actions).toEqual([]);
    const cues = [
      { seq: 5, kind: 'climb' as const, at: 0 },
      { seq: 6, kind: 'fanfare' as const, at: 9_000 },
    ];
    const result = mirrorSoundActions(once, cues, 4, 4, 10_000, toLocal);
    expect(result.actions).toEqual([{ type: 'cue', kind: 'fanfare' }]);
    expect(result.lastCueSeq).toBe(6);
  });
});
