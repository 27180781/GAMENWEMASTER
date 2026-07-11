/**
 * SocketVoteAdapter (M3) — מקור הצבעות אמיתי למשחק אונליין.
 *
 * מתחבר לשרת ההצבעות (Voting Bridge) דרך Socket.IO, מצטרף לחדר לפי קוד
 * המשחק (‏game.room), ומאזין לאירועי "voting". כל משחק מאזין רק לחדר שלו,
 * כך שכמה משחקים יכולים לרוץ במקביל, כל אחד עם קוד משלו.
 *
 * השרת שולח הצבעות בודדות; המנוע מצפה ל-VoteSnapshot מצטבר. לכן הצבירה
 * מתבצעת כאן ב-VoteWindow (חלון הצבעה לשקופית אחת), שה-host פותח וסוגר
 * דרך setActiveSlide — בדיוק בגבולות חלון ההצבעה של השקופית הנוכחית.
 */

import { io, type Socket } from 'socket.io-client';
import type { VoteAdapter, VoteSnapshot } from '../engine/index.ts';

/** כתובת שרת ההצבעות (Voting Bridge). */
export const VOTE_SERVER_URL = 'https://masshin.caprover.clicker.co.il';

/** אירוע הצבעה גולמי כפי שמגיע מהשרת. */
export interface RawVote {
  /** ערך ההצבעה: "1" / "2" / "3" / "4". */
  vote: string;
  /** מזהה המצביע — מספר טלפון (או קליקר). */
  phone: string;
  /** שם השחקן, אם נשלח. */
  playerName?: string;
  gameId?: string;
  time?: number;
}

/**
 * צובר הצבעות לחלון הצבעה של שקופית אחת. ממיר הצבעות בודדות ל-VoteSnapshot
 * מצטבר. טהור (בלי רשת) — ניתן לבדיקה ביחידה.
 */
export class VoteWindow {
  private voters: Record<string, number> = {};
  private firstVoter: string | null = null;
  private seq = 0;

  constructor(readonly slideId: number) {}

  /** רישום הצבעה; מחזיר snapshot מצטבר, או null אם ההצבעה פגומה. */
  add(vote: RawVote): VoteSnapshot | null {
    const answerId = Number(vote.vote);
    const phone = String(vote.phone ?? '').trim();
    if (phone === '' || !Number.isInteger(answerId)) return null;
    if (this.firstVoter === null) this.firstVoter = phone;
    this.voters[phone] = answerId; // ההצבעה האחרונה מנצחת; המנוע נועל אם צריך
    return this.snapshot();
  }

  /** ה-snapshot המצטבר הנוכחי (seq עולה בכל קריאה — מונוטוני למנוע). */
  snapshot(): VoteSnapshot {
    const counts: Record<string, number> = {};
    for (const answerId of Object.values(this.voters)) {
      counts[String(answerId)] = (counts[String(answerId)] ?? 0) + 1;
    }
    this.seq += 1;
    const snapshot: VoteSnapshot = {
      seq: this.seq,
      slideId: this.slideId,
      counts,
      total: Object.keys(this.voters).length,
      voters: { ...this.voters },
    };
    if (this.firstVoter !== null) snapshot.firstVoter = this.firstVoter;
    return snapshot;
  }
}

type Status = 'connected' | 'reconnecting' | 'offline';

export class SocketVoteAdapter implements VoteAdapter {
  private socket: Socket | null = null;
  private snapshotListener: ((snapshot: VoteSnapshot) => void) | null = null;
  private statusListener: ((status: Status) => void) | null = null;
  private identifyListener: ((phone: string, name: string) => void) | null = null;
  private window: VoteWindow | null = null;
  private roomId = '';

  constructor(private readonly serverUrl: string = VOTE_SERVER_URL) {}

  connect(roomId: string): Promise<void> {
    this.roomId = roomId;
    const socket = io(this.serverUrl, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });
    this.socket = socket;

    socket.on('connect', () => {
      // join/room חייב לרוץ מיד עם החיבור, לפני שמישהו מצביע
      socket.emit('join/room', { gameId: roomId });
    });
    socket.on('room/joined', () => this.statusListener?.('connected'));
    socket.on('voting', (data: RawVote) => this.handleVote(data));
    socket.on('player/joined', (data: RawVote) => this.identify(data));
    socket.on('disconnect', () => this.statusListener?.('reconnecting'));
    socket.io.on('reconnect', () => socket.emit('join/room', { gameId: roomId }));
    socket.io.on('reconnect_attempt', () => this.statusListener?.('reconnecting'));

    return Promise.resolve();
  }

  private identify(data: RawVote): void {
    const phone = String(data?.phone ?? '').trim();
    const name = String(data?.playerName ?? '').trim();
    if (phone !== '' && name !== '') this.identifyListener?.(phone, name);
  }

  private handleVote(data: RawVote): void {
    // רק החדר שלנו (השרת אמור לשלוח רק אותו, אבל מסננים ליתר ביטחון)
    if (data.gameId !== undefined && String(data.gameId) !== this.roomId) return;
    this.identify(data); // שם השחקן מהטלפון → מיפוי אוטומטי לשם
    if (this.window === null) return; // אין חלון הצבעה פתוח — מתעלמים
    const snapshot = this.window.add(data);
    if (snapshot !== null) this.snapshotListener?.(snapshot);
  }

  /** פתיחת חלון הצבעה לשקופית (או null לסגירה). איפוס מונים בכל פתיחה. */
  setActiveSlide(slideId: number | null): void {
    this.window = slideId === null ? null : new VoteWindow(slideId);
  }

  onVoteSnapshot(cb: (snapshot: VoteSnapshot) => void): void {
    this.snapshotListener = cb;
  }

  onStatusChange(cb: (status: Status) => void): void {
    this.statusListener = cb;
  }

  /** התראה על זיהוי שחקן (טלפון → שם) מהשרת — למיפוי שמות אוטומטי. */
  onPlayerIdentified(cb: (phone: string, name: string) => void): void {
    this.identifyListener = cb;
  }

  requestFullState(): Promise<VoteSnapshot> {
    return this.window === null
      ? Promise.reject(new Error('אין חלון הצבעה פעיל'))
      : Promise.resolve(this.window.snapshot());
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.window = null;
    this.statusListener?.('offline');
  }
}
