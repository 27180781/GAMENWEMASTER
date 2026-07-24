/**
 * בדיקות ל-CompositeVoteAdapter — מיזוג קליקרים + סוקט לזרם הצבעות אחד,
 * סטטוס נפרד לכל מקור, וחלון הצבעה משותף.
 */
import { describe, expect, it } from 'vitest';
import { CompositeVoteAdapter, type VoteSourceKind } from '../src/app/compositeAdapter.ts';
import type { LiveVoteAdapter, RawVote } from '../src/app/socketAdapter.ts';
import type { VoteSnapshot } from '../src/engine/index.ts';

type Status = 'connected' | 'reconnecting' | 'offline';

/** מקור הצבעות מדומה — מאפשר לירות הצבעות/סטטוס ידנית. */
class MockAdapter implements LiveVoteAdapter {
  raw: ((v: RawVote) => void) | null = null;
  joined: ((p: string, n?: string) => void) | null = null;
  identified: ((p: string, n: string) => void) | null = null;
  status: ((s: Status) => void) | null = null;
  snapshot: ((s: VoteSnapshot) => void) | null = null;
  connected = false;
  disconnected = false;
  slide: number | null = null;
  onRawVote(cb: (v: RawVote) => void) { this.raw = cb; }
  onPlayerJoined(cb: (p: string, n?: string) => void) { this.joined = cb; }
  onPlayerIdentified(cb: (p: string, n: string) => void) { this.identified = cb; }
  onStatusChange(cb: (s: Status) => void) { this.status = cb; }
  onVoteSnapshot(cb: (s: VoteSnapshot) => void) { this.snapshot = cb; }
  setActiveSlide(id: number | null) { this.slide = id; }
  connect() { this.connected = true; return Promise.resolve(); }
  disconnect() { this.disconnected = true; }
  requestFullState() { return Promise.reject(new Error('n/a')); }
}

function make() {
  const clicker = new MockAdapter();
  const socket = new MockAdapter();
  const adapter = new CompositeVoteAdapter([
    { kind: 'clicker', adapter: clicker },
    { kind: 'socket', adapter: socket },
  ]);
  return { adapter, clicker, socket };
}

describe('CompositeVoteAdapter', () => {
  it('ממזג הצבעות משני המקורות לחלון אחד', async () => {
    const { adapter, clicker, socket } = make();
    const snaps: VoteSnapshot[] = [];
    adapter.onVoteSnapshot((s) => snaps.push(s));
    await adapter.connect('room');
    adapter.setActiveSlide(1);
    clicker.raw!({ vote: '2', phone: '305' }); // קליקר
    socket.raw!({ vote: '1', phone: '0501234567' }); // טלפון
    const last = snaps[snaps.length - 1]!;
    expect(last.voters).toEqual({ '305': 2, '0501234567': 1 });
    expect(last.total).toBe(2);
    expect(last.slideId).toBe(1);
  });

  it('שני המקורות מחוברים → connect נקרא לשניהם', async () => {
    const { adapter, clicker, socket } = make();
    await adapter.connect('room');
    expect(clicker.connected).toBe(true);
    expect(socket.connected).toBe(true);
  });

  it('סטטוס נפרד לכל מקור + סטטוס מאוחד (מחובר אם אחד מחובר)', async () => {
    const { adapter, clicker, socket } = make();
    const clickerStatuses: Status[] = [];
    const socketStatuses: Status[] = [];
    const combined: Status[] = [];
    adapter.onStatusChange((s) => combined.push(s));
    adapter.onSourceStatus('clicker', (s) => clickerStatuses.push(s));
    adapter.onSourceStatus('socket', (s) => socketStatuses.push(s));
    await adapter.connect('room');
    clicker.status!('connected');
    socket.status!('reconnecting');
    expect(clickerStatuses).toEqual(['offline', 'connected']); // ערך התחלתי + עדכון
    expect(socketStatuses).toEqual(['offline', 'reconnecting']);
    expect(combined[combined.length - 1]).toBe('connected'); // אחד מחובר → מאוחד מחובר
  });

  it('setActiveSlide(null) עוצר אגירה; אותה שקופית שוב — לא מאפס', async () => {
    const { adapter, clicker } = make();
    const snaps: VoteSnapshot[] = [];
    adapter.onVoteSnapshot((s) => snaps.push(s));
    await adapter.connect('room');
    adapter.setActiveSlide(1);
    clicker.raw!({ vote: '2', phone: '1' });
    adapter.setActiveSlide(1); // אותה שקופית — לא מאפס
    clicker.raw!({ vote: '3', phone: '2' });
    expect(snaps[snaps.length - 1]!.total).toBe(2); // שתי ההצבעות נשמרו
    adapter.setActiveSlide(null);
    const n = snaps.length;
    clicker.raw!({ vote: '4', phone: '3' }); // אחרי סגירה — לא נצבר
    expect(snaps.length).toBe(n);
  });

  it('onRawVote מקבל הצבעות משני המקורות; disconnect סוגר את שניהם', async () => {
    const { adapter, clicker, socket } = make();
    const raws: RawVote[] = [];
    adapter.onRawVote((r) => raws.push(r));
    await adapter.connect('room');
    clicker.raw!({ vote: '1', phone: 'a' });
    socket.raw!({ vote: '2', phone: 'b' });
    expect(raws.map((r) => r.phone)).toEqual(['a', 'b']);
    adapter.disconnect();
    expect(clicker.disconnected).toBe(true);
    expect(socket.disconnected).toBe(true);
  });

  it('hasSource מדווח נכון על המקורות המרכיבים', () => {
    const { adapter } = make();
    expect(adapter.hasSource('clicker')).toBe(true);
    expect(adapter.hasSource('socket')).toBe(true);
    const kinds: VoteSourceKind[] = ['clicker', 'socket'];
    expect(kinds.every((k) => adapter.hasSource(k))).toBe(true);
  });

  it('requestFullState מחזיר את החלון הממוזג; נדחה כשאין חלון', async () => {
    const { adapter, clicker, socket } = make();
    await adapter.connect('room');
    await expect(adapter.requestFullState()).rejects.toThrow();
    adapter.setActiveSlide(1);
    clicker.raw!({ vote: '2', phone: '305' });
    socket.raw!({ vote: '2', phone: '42' });
    const snap = await adapter.requestFullState();
    expect(snap.total).toBe(2);
    expect(snap.counts['2']).toBe(2);
  });
});
