import { describe, expect, it } from 'vitest';
import { extractHostVote } from '../src/app/hostRemote.ts';
import type { VoteSnapshot } from '../src/engine/index.ts';

function snapshot(overrides: Partial<VoteSnapshot> = {}): VoteSnapshot {
  return {
    seq: 1,
    slideId: 1,
    counts: { '2': 2, '3': 1 },
    total: 3,
    voters: { a: 2, b: 2, host: 3 },
    firstVoter: 'a',
    ...overrides,
  };
}

describe('extractHostVote — שלט המנחה מסונן מההצבעות', () => {
  it('מחלץ את הקשת המנחה ומנקה אותה מכל השדות', () => {
    const { snapshot: cleaned, hostAnswer } = extractHostVote(snapshot(), 'host');
    expect(hostAnswer).toBe(3);
    expect(cleaned.voters).toEqual({ a: 2, b: 2 });
    expect(cleaned.counts).toEqual({ '2': 2 }); // המונה של 3 ירד לאפס ונמחק
    expect(cleaned.total).toBe(2);
    expect(cleaned.firstVoter).toBe('a');
  });

  it('מנחה שהוא firstVoter — לא נחשב ראשון', () => {
    const { snapshot: cleaned } = extractHostVote(snapshot({ firstVoter: 'host' }), 'host');
    expect(cleaned.firstVoter).toBeUndefined();
  });

  it('מוריד מונה בלי למחוק כשיש עוד מצביעים על אותה תשובה', () => {
    const { snapshot: cleaned } = extractHostVote(
      snapshot({ counts: { '2': 3 }, voters: { a: 2, b: 2, host: 2 }, total: 3 }),
      'host',
    );
    expect(cleaned.counts).toEqual({ '2': 2 });
    expect(cleaned.total).toBe(2);
  });

  it('בלי מנחה ב-snapshot או בלי מזהה — מוחזר המקור ללא שינוי', () => {
    const original = snapshot({ voters: { a: 2 }, counts: { '2': 1 }, total: 1 });
    expect(extractHostVote(original, 'host')).toEqual({ snapshot: original, hostAnswer: null });
    expect(extractHostVote(snapshot(), '')).toEqual({ snapshot: snapshot(), hostAnswer: null });
  });

  it('הקשת 0 של המנחה (השלב הבא) מזוהה כפקודה', () => {
    const { hostAnswer } = extractHostVote(
      snapshot({ voters: { a: 2, host: 0 }, counts: { '2': 1, '0': 1 }, total: 2 }),
      'host',
    );
    expect(hostAnswer).toBe(0);
  });
});
