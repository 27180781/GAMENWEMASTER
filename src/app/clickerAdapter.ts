/**
 * ClickerVoteAdapter — מקור הצבעות מקליקרי RF317 (מצב EXE). מקבל את אירועי
 * הלחיצה/סטטוס מגשר ה-Electron (clickerBridge) וממיר אותם לאותו זרם הצבעות
 * כמו הסוקט: כל לחיצה = RawVote (כפתור → vote, מזהה הקליקר → phone), נצברת
 * ל-VoteSnapshot בחלון ההצבעה הפעיל. השם מגיע מהמרשם לפי מזהה הקליקר.
 *
 * מיפוי: כפתור 1 = תשובה 1 (ישיר, vote = String(button)); כפתור F = 0.
 * סטטוס: בית 0x09 (ריסיבר מחובר) → 'connected'; ניתוק/לא-מחובר → 'offline'.
 */

import type { VoteSnapshot } from '../engine/index.ts';
import { onClickerEvent, onReceiverClient, type ClickerEvent } from './clickerBridge.ts';
import { VoteWindow, type LiveVoteAdapter, type RawVote } from './socketAdapter.ts';

type Status = 'connected' | 'reconnecting' | 'offline';

export class ClickerVoteAdapter implements LiveVoteAdapter {
  private snapshotListener: ((snapshot: VoteSnapshot) => void) | null = null;
  private statusListener: ((status: Status) => void) | null = null;
  private joinedListener: ((phone: string, name?: string) => void) | null = null;
  private rawVoteListener: ((vote: RawVote) => void) | null = null;
  private window: VoteWindow | null = null;
  private offEvent: (() => void) | null = null;
  private offClient: (() => void) | null = null;

  connect(_roomId: string): Promise<void> {
    // עד שהריסיבר יתחבר וישלח בית "connected" — הסטטוס הוא 'offline' (→ אזהרה).
    this.statusListener?.('offline');
    this.offEvent = onClickerEvent((ev) => this.handle(ev));
    this.offClient = onReceiverClient((info) => {
      // התחברות תוכנת הריסיבר לסוקט עדיין אינה "מחובר" — ממתינים לבית הסטטוס
      // של הדונגל עצמו. ניתוק מהסוקט = אין מקור הצבעות.
      this.statusListener?.(info.connected ? 'reconnecting' : 'offline');
    });
    return Promise.resolve();
  }

  private handle(ev: ClickerEvent): void {
    if (ev.type === 'status') {
      if (ev.status === 'connected') this.statusListener?.('connected');
      else if (ev.status === 'connecting') this.statusListener?.('reconnecting');
      else this.statusListener?.('offline'); // disconnected / not_connected
      return;
    }
    // לחיצת כפתור → הצבעה גולמית
    const phone = String(ev.remoteId);
    const raw: RawVote = { vote: String(ev.button), phone };
    this.joinedListener?.(phone); // הופעה בלובי (השם מהמרשם לפי המזהה)
    this.rawVoteListener?.(raw); // שלט מנחה / לוג אבחון
    if (this.window === null) return; // אין חלון הצבעה פתוח — לא נצבר
    const snapshot = this.window.add(raw);
    if (snapshot !== null) this.snapshotListener?.(snapshot);
  }

  disconnect(): void {
    this.offEvent?.();
    this.offEvent = null;
    this.offClient?.();
    this.offClient = null;
    this.window = null;
    this.statusListener?.('offline');
  }

  onVoteSnapshot(cb: (snapshot: VoteSnapshot) => void): void {
    this.snapshotListener = cb;
  }
  onStatusChange(cb: (status: Status) => void): void {
    this.statusListener = cb;
  }
  /** קליקרים אינם שולחים שם — השם מגיע מהמרשם לפי מזהה הקליקר. no-op. */
  onPlayerIdentified(_cb: (phone: string, name: string) => void): void {
    /* ללא שמות מהמכשיר */
  }
  onPlayerJoined(cb: (phone: string, name?: string) => void): void {
    this.joinedListener = cb;
  }
  onRawVote(cb: (vote: RawVote) => void): void {
    this.rawVoteListener = cb;
  }

  setActiveSlide(slideId: number | null): void {
    if (slideId === null) {
      this.window = null;
      return;
    }
    if (this.window !== null && this.window.slideId === slideId) return;
    this.window = new VoteWindow(slideId);
  }

  requestFullState(): Promise<VoteSnapshot> {
    return this.window === null
      ? Promise.reject(new Error('אין חלון הצבעה פעיל'))
      : Promise.resolve(this.window.snapshot());
  }
}
