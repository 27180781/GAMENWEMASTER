/**
 * בדיקות ל-ClickerVoteAdapter — המרת אירועי קליקר RF317 לזרם הצבעות (VoteSnapshot),
 * סטטוס, ואירועים גולמיים. window.triviaDesktop מדומה.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClickerVoteAdapter } from '../src/app/clickerAdapter.ts';
import type { VoteSnapshot } from '../src/engine/index.ts';

type KeyEv = { type: 'key'; button: number; remoteId: number };
type StatusEv = { type: 'status'; code: number; status: string };
let clickerCbs: ((ev: KeyEv | StatusEv) => void)[] = [];
let recvCbs: ((info: { connected: boolean; who: string | null }) => void)[] = [];

beforeEach(() => {
  clickerCbs = [];
  recvCbs = [];
  vi.stubGlobal('window', {
    triviaDesktop: {
      isDesktop: true,
      onClicker: (cb: (ev: KeyEv | StatusEv) => void) => {
        clickerCbs.push(cb);
        return () => {};
      },
      onReceiver: (cb: (info: { connected: boolean; who: string | null }) => void) => {
        recvCbs.push(cb);
        return () => {};
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

const fireKey = (button: number, remoteId: number) =>
  clickerCbs.forEach((cb) => cb({ type: 'key', button, remoteId }));
const fireStatus = (status: string) =>
  clickerCbs.forEach((cb) => cb({ type: 'status', code: 0, status }));

describe('ClickerVoteAdapter', () => {
  it('לחיצות בזמן חלון פתוח → snapshot עם המצביעים (מזהה→phone, כפתור→vote)', async () => {
    const adapter = new ClickerVoteAdapter();
    const snaps: VoteSnapshot[] = [];
    adapter.onVoteSnapshot((s) => snaps.push(s));
    await adapter.connect('');
    adapter.setActiveSlide(1);

    fireKey(2, 305); // קליקר 305 → תשובה 2
    fireKey(1, 42); // קליקר 42 → תשובה 1
    const last = snaps[snaps.length - 1]!;
    expect(last.voters).toEqual({ '305': 2, '42': 1 });
    expect(last.counts).toEqual({ '2': 1, '1': 1 });
    expect(last.total).toBe(2);
    expect(last.slideId).toBe(1);
  });

  it('כפתור F (מגיע כ-7) ממופה ל-0', async () => {
    const adapter = new ClickerVoteAdapter();
    const raws: { vote: string; phone: string }[] = [];
    adapter.onRawVote((r) => raws.push(r));
    await adapter.connect('');
    fireKey(7, 7); // כפתור F של קליקר 7 → תשובה/פקודה 0
    fireKey(0, 8); // כפתור 0 (אם קיים) נשאר 0
    expect(raws[0]).toEqual({ vote: '0', phone: '7' });
    expect(raws[1]).toEqual({ vote: '0', phone: '8' });
  });

  it('ההצבעה האחרונה של אותו קליקר גוברת בחלון', async () => {
    const adapter = new ClickerVoteAdapter();
    const snaps: VoteSnapshot[] = [];
    adapter.onVoteSnapshot((s) => snaps.push(s));
    await adapter.connect('');
    adapter.setActiveSlide(1);
    fireKey(2, 305);
    fireKey(3, 305); // אותו קליקר משנה
    expect(snaps[snaps.length - 1]!.voters).toEqual({ '305': 3 });
  });

  it('בלי חלון פתוח — אין snapshot (אבל raw + joined כן)', async () => {
    const adapter = new ClickerVoteAdapter();
    const snaps: VoteSnapshot[] = [];
    const joined: string[] = [];
    adapter.onVoteSnapshot((s) => snaps.push(s));
    adapter.onPlayerJoined((phone) => joined.push(phone));
    await adapter.connect('');
    fireKey(2, 305); // אין setActiveSlide
    expect(snaps).toHaveLength(0);
    expect(joined).toEqual(['305']);
  });

  it('סטטוס: connected → connected · disconnected/not_connected → offline · connecting → reconnecting', async () => {
    const adapter = new ClickerVoteAdapter();
    const statuses: string[] = [];
    adapter.onStatusChange((s) => statuses.push(s));
    await adapter.connect(''); // 'offline' התחלתי
    fireStatus('connected');
    fireStatus('connecting');
    fireStatus('not_connected');
    fireStatus('disconnected');
    expect(statuses).toEqual(['offline', 'connected', 'reconnecting', 'offline', 'offline']);
  });

  it('ניתוק תוכנת הריסיבר מהסוקט → offline', async () => {
    const adapter = new ClickerVoteAdapter();
    const statuses: string[] = [];
    adapter.onStatusChange((s) => statuses.push(s));
    await adapter.connect('');
    recvCbs.forEach((cb) => cb({ connected: true, who: 'x' })); // reconnecting
    recvCbs.forEach((cb) => cb({ connected: false, who: null })); // offline
    expect(statuses).toEqual(['offline', 'reconnecting', 'offline']);
  });

  it('סגירת חלון (setActiveSlide(null)) עוצרת אגירה', async () => {
    const adapter = new ClickerVoteAdapter();
    const snaps: VoteSnapshot[] = [];
    adapter.onVoteSnapshot((s) => snaps.push(s));
    await adapter.connect('');
    adapter.setActiveSlide(1);
    fireKey(2, 1);
    adapter.setActiveSlide(null);
    fireKey(3, 2); // אחרי סגירה — לא נצבר
    expect(snaps).toHaveLength(1);
  });
});
