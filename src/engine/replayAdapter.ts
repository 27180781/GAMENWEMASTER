/**
 * ReplayAdapter (SPEC סעיף 6) — מקור הצבעות לפיתוח ולבדיקות.
 * מזרים VoteSnapshots מוקלטים/מסונתזים אל המאזין, בלי רשת.
 */

import type { VoteAdapter, VoteSnapshot } from './types.ts';

export class ReplayAdapter implements VoteAdapter {
  private snapshotListener: ((snapshot: VoteSnapshot) => void) | null = null;
  private statusListener:
    | ((status: 'connected' | 'reconnecting' | 'offline') => void)
    | null = null;
  private lastSnapshot: VoteSnapshot | null = null;
  private connected = false;

  connect(_roomId: string): Promise<void> {
    this.connected = true;
    this.statusListener?.('connected');
    return Promise.resolve();
  }

  disconnect(): void {
    this.connected = false;
    this.statusListener?.('offline');
  }

  onVoteSnapshot(cb: (snapshot: VoteSnapshot) => void): void {
    this.snapshotListener = cb;
  }

  onStatusChange(cb: (status: 'connected' | 'reconnecting' | 'offline') => void): void {
    this.statusListener = cb;
  }

  requestFullState(): Promise<VoteSnapshot> {
    if (this.lastSnapshot === null) {
      return Promise.reject(new Error('אין snapshot זמין ב-ReplayAdapter'));
    }
    return Promise.resolve(this.lastSnapshot);
  }

  /** הזרמת snapshot בודד אל המאזין (הבדיקה/הדיבאג שולטים בקצב). */
  emit(snapshot: VoteSnapshot): void {
    this.lastSnapshot = snapshot;
    if (this.connected) this.snapshotListener?.(snapshot);
  }

  /** הזרמת רצף snapshots לפי הסדר. */
  emitAll(snapshots: Iterable<VoteSnapshot>): void {
    for (const snapshot of snapshots) this.emit(snapshot);
  }
}
