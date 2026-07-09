/**
 * בדיקות ל-interpretPushMessage — פענוח הודעות שמגיעות בערוץ הפוש (&push=).
 */

import { describe, expect, it } from 'vitest';
import { interpretPushMessage } from '../src/app/pushChannel.ts';

describe('interpretPushMessage', () => {
  it('מחרוזות אות רענון → refetch', () => {
    for (const word of ['refresh', 'reload', 'refetch', 'update', 'ping', '', '  ', 'RELOAD']) {
      expect(interpretPushMessage(word)).toEqual({ kind: 'refetch' });
    }
  });

  it('מחרוזת שרירותית שאינה JSON → refetch (סתם אות)', () => {
    expect(interpretPushMessage('go!')).toEqual({ kind: 'refetch' });
  });

  it('מחרוזת JSON של משחק → game עם ה-raw המפוענח', () => {
    const raw = { questions: [{ id: 1 }], setting: {} };
    expect(interpretPushMessage(JSON.stringify(raw))).toEqual({ kind: 'game', raw });
  });

  it('אובייקט עם מעטפת { game } → game', () => {
    const game = { questions: [{ id: 1 }] };
    expect(interpretPushMessage({ type: 'x', game })).toEqual({ kind: 'game', raw: game });
  });

  it('אובייקט שנראה כמו קובץ משחק (יש questions) → game', () => {
    const obj = { questions: [{ id: 7 }], setting: {} };
    expect(interpretPushMessage(obj)).toEqual({ kind: 'game', raw: obj });
  });

  it('אובייקט { type: "refresh" } → refetch', () => {
    expect(interpretPushMessage({ type: 'refresh' })).toEqual({ kind: 'refetch' });
    expect(interpretPushMessage({ type: 'game-reload' })).toEqual({ kind: 'refetch' });
  });

  it('הודעות לא רלוונטיות → ignore', () => {
    expect(interpretPushMessage(null)).toEqual({ kind: 'ignore' });
    expect(interpretPushMessage(42)).toEqual({ kind: 'ignore' });
    expect(interpretPushMessage({ hello: 'world' })).toEqual({ kind: 'ignore' });
    expect(interpretPushMessage({ type: 'chat', text: 'hi' })).toEqual({ kind: 'ignore' });
  });
});
