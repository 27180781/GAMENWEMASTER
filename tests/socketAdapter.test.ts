/**
 * בדיקות ל-SocketVoteAdapter (M3): צבירת ההצבעות (VoteWindow) — טהור,
 * ואינטגרציה מלאה מול שרת Socket.IO אמיתי (join/room → voting → snapshots).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server as IOServer } from 'socket.io';
import { SocketVoteAdapter, VoteWindow } from '../src/app/socketAdapter.ts';
import type { VoteSnapshot } from '../src/engine/index.ts';

describe('VoteWindow — צבירת הצבעות', () => {
  it('צובר הצבעות למונים מצטברים, total לפי מצביעים ייחודיים', () => {
    const w = new VoteWindow(7);
    w.add({ vote: '1', phone: '050' });
    const snap = w.add({ vote: '2', phone: '051' })!;
    expect(snap.slideId).toBe(7);
    expect(snap.counts).toEqual({ '1': 1, '2': 1 });
    expect(snap.total).toBe(2);
    expect(snap.voters).toEqual({ '050': 1, '051': 2 });
    expect(snap.firstVoter).toBe('050');
  });

  it('הצבעה חוזרת של אותו מצביע מעדכנת ולא מכפילה', () => {
    const w = new VoteWindow(1);
    w.add({ vote: '1', phone: '050' });
    const snap = w.add({ vote: '3', phone: '050' })!;
    expect(snap.total).toBe(1);
    expect(snap.counts).toEqual({ '3': 1 });
    expect(snap.voters).toEqual({ '050': 3 });
  });

  it('seq עולה בכל snapshot (מונוטוני עבור המנוע)', () => {
    const w = new VoteWindow(1);
    const a = w.add({ vote: '1', phone: 'a' })!;
    const b = w.add({ vote: '1', phone: 'b' })!;
    expect(b.seq).toBeGreaterThan(a.seq);
  });

  it('הצבעה פגומה (בלי טלפון / vote לא מספרי) נדחית', () => {
    const w = new VoteWindow(1);
    expect(w.add({ vote: '2', phone: '' })).toBeNull();
    expect(w.add({ vote: 'x', phone: '050' })).toBeNull();
  });
});

describe('SocketVoteAdapter — אינטגרציה מול שרת Socket.IO', () => {
  let http: HttpServer;
  let ioServer: IOServer;
  let url: string;

  beforeAll(async () => {
    http = createServer();
    ioServer = new IOServer(http, { transports: ['websocket'] });
    ioServer.on('connection', (socket) => {
      socket.on('join/room', (data: { gameId: string }) => {
        socket.join(data.gameId);
        socket.emit('room/joined', { gameId: data.gameId });
      });
      socket.on('emit/joined', (data: { gameId: string; phone: string; playerName?: string }) => {
        ioServer.to(data.gameId).emit('player/joined', data);
      });
    });
    await new Promise<void>((resolve) => http.listen(0, resolve));
    const addr = http.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    url = `http://localhost:${port}`;
  });

  afterAll(async () => {
    ioServer.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });

  it('מצטרף לחדר, מקבל voting, וצובר snapshot; ומזהה שם שחקן', async () => {
    const adapter = new SocketVoteAdapter(url);
    const snapshots: VoteSnapshot[] = [];
    const names: Record<string, string> = {};
    const joined: string[] = [];
    let connected = false;

    adapter.onVoteSnapshot((s) => snapshots.push(s));
    adapter.onStatusChange((st) => {
      if (st === 'connected') connected = true;
    });
    adapter.onPlayerIdentified((phone, name) => (names[phone] = name));
    adapter.onPlayerJoined((phone) => joined.push(phone));

    await adapter.connect('5001');
    // ממתינים ל-room/joined
    await waitFor(() => connected);

    // התחברות שחקן (לחיצת מקש) לפני ההצבעה — למסך הלובי
    ioServer.sockets.sockets.forEach((s) => s.emit('player/joined', { phone: '0500000000', gameId: '5001' }));

    adapter.setActiveSlide(3); // חלון הצבעה פתוח לשקופית 3

    ioServer.to('5001').emit('voting', { vote: '2', phone: '0501111111', playerName: 'דנה', gameId: '5001' });
    ioServer.to('5001').emit('voting', { vote: '2', phone: '0502222222', gameId: '5001' });
    ioServer.to('5001').emit('voting', { vote: '1', phone: '0503333333', gameId: '5001' });

    await waitFor(() => snapshots.length >= 3);
    const last = snapshots[snapshots.length - 1]!;
    expect(last.slideId).toBe(3);
    expect(last.total).toBe(3);
    expect(last.counts).toEqual({ '2': 2, '1': 1 });
    expect(names['0501111111']).toBe('דנה'); // שם השחקן מהטלפון מופה אוטומטית
    // התחברות (לובי) נקלטה — גם מ-player/joined וגם מהמצביעים
    expect(joined).toContain('0500000000');
    expect(joined).toContain('0501111111');

    adapter.disconnect();
  });

  it('משחזר את עצמו אחרי נפילת חיבור — מצטרף מחדש וההצבעות ממשיכות', async () => {
    const adapter = new SocketVoteAdapter(url);
    const snapshots: VoteSnapshot[] = [];
    let connectedCount = 0;
    let reconnecting = false;
    adapter.onVoteSnapshot((s) => snapshots.push(s));
    adapter.onStatusChange((st) => {
      if (st === 'connected') connectedCount += 1;
      if (st === 'reconnecting') reconnecting = true;
    });

    await adapter.connect('5003');
    await waitFor(() => connectedCount >= 1);

    // מפילים את החיבור מצד השרת (סימולציית נפילת רשת)
    ioServer.disconnectSockets(true);

    // משחזר את עצמו: מצב "מתחבר מחדש" ואז חיבור מלא + הצטרפות מחדש לחדר
    await waitFor(() => reconnecting);
    await waitFor(() => connectedCount >= 2, 8000);

    // ההצבעות ממשיכות לזרום כרגיל אחרי השחזור
    adapter.setActiveSlide(9);
    ioServer.to('5003').emit('voting', { vote: '1', phone: '0509999999', gameId: '5003' });
    await waitFor(() => snapshots.length >= 1, 3000);
    expect(snapshots[snapshots.length - 1]!.total).toBe(1);

    adapter.disconnect();
  });

  it('כשאין חלון הצבעה פעיל — voting אינו יוצר snapshot', async () => {
    const adapter = new SocketVoteAdapter(url);
    const snapshots: VoteSnapshot[] = [];
    let connected = false;
    adapter.onVoteSnapshot((s) => snapshots.push(s));
    adapter.onStatusChange((st) => {
      if (st === 'connected') connected = true;
    });
    await adapter.connect('5002');
    await waitFor(() => connected);
    // חלון סגור (לא נקרא setActiveSlide)
    ioServer.to('5002').emit('voting', { vote: '1', phone: '050', gameId: '5002' });
    await delay(150);
    expect(snapshots).toHaveLength(0);
    adapter.disconnect();
  });

  it('פתיחה חוזרת לאותה שקופית לא מאפסת את המונים; שקופית חדשה כן', async () => {
    const adapter = new SocketVoteAdapter(url);
    const snapshots: VoteSnapshot[] = [];
    let connected = false;
    adapter.onVoteSnapshot((s) => snapshots.push(s));
    adapter.onStatusChange((st) => {
      if (st === 'connected') connected = true;
    });
    await adapter.connect('5004');
    await waitFor(() => connected);

    adapter.setActiveSlide(11);
    ioServer.to('5004').emit('voting', { vote: '1', phone: '0501', gameId: '5004' });
    ioServer.to('5004').emit('voting', { vote: '2', phone: '0502', gameId: '5004' });
    await waitFor(() => snapshots.length >= 2);

    // פתיחה חוזרת לאותה שקופית (למשל בעקבות מסך התחברות שנפתח/נסגר) — לא מאפסת
    adapter.setActiveSlide(11);
    ioServer.to('5004').emit('voting', { vote: '3', phone: '0503', gameId: '5004' });
    await waitFor(() => snapshots.length >= 3);
    expect(snapshots[snapshots.length - 1]!.total).toBe(3);

    // מעבר לשקופית חדשה — מאפס את הצבירה
    adapter.setActiveSlide(12);
    ioServer.to('5004').emit('voting', { vote: '1', phone: '0509', gameId: '5004' });
    await waitFor(() => snapshots[snapshots.length - 1]!.slideId === 12);
    const last = snapshots[snapshots.length - 1]!;
    expect(last.slideId).toBe(12);
    expect(last.total).toBe(1);

    adapter.disconnect();
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for condition');
    await delay(20);
  }
}
