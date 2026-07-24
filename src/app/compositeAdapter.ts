/**
 * CompositeVoteAdapter — מאחד כמה מקורות הצבעה חיים (קליקרים RF317 + סוקט
 * טלפונים) לזרם הצבעות אחד. כל מקור פולט את הצבעותיו הגולמיות (onRawVote);
 * המרכיב צובר את כולן לחלון הצבעה משותף אחד → VoteSnapshot ממוזג. הסטטוס
 * נשמר בנפרד לכל מקור (onSourceStatus) לחיווי ברור — ריסיבר מול טלפונים.
 *
 * המרכיב עצמו מ ממש LiveVoteAdapter, כך ש-GameHost מטפל בו באותו מסלול כמו
 * מקור בודד. משמש רק כשנבחרו *שני* המקורות (קליקרים + טלפונים); מקור בודד
 * ממשיך לרוץ ישירות (בלי שינוי במסלול הקיים).
 */

import type { VoteSnapshot } from '../engine/index.ts';
import { VoteWindow, type LiveVoteAdapter, type RawVote } from './socketAdapter.ts';

type Status = 'connected' | 'reconnecting' | 'offline';
export type VoteSourceKind = 'clicker' | 'socket';

export interface CompositeChild {
  kind: VoteSourceKind;
  adapter: LiveVoteAdapter;
}

export class CompositeVoteAdapter implements LiveVoteAdapter {
  private window: VoteWindow | null = null;
  private snapshotListener: ((snapshot: VoteSnapshot) => void) | null = null;
  private statusListener: ((status: Status) => void) | null = null;
  private joinedListener: ((phone: string, name?: string) => void) | null = null;
  private identifyListener: ((phone: string, name: string) => void) | null = null;
  private rawVoteListener: ((vote: RawVote) => void) | null = null;
  private readonly statuses = new Map<VoteSourceKind, Status>();
  private readonly sourceStatusListeners = new Map<VoteSourceKind, (status: Status) => void>();

  constructor(private readonly children: CompositeChild[]) {
    for (const c of children) this.statuses.set(c.kind, 'offline');
  }

  connect(roomId: string): Promise<void> {
    for (const { kind, adapter } of this.children) {
      // כל הצבעה גולמית מכל מקור → מדווחת (שלט מנחה/אבחון) ונצברת לחלון המשותף.
      adapter.onRawVote((raw) => {
        this.rawVoteListener?.(raw);
        if (this.window !== null) {
          const snapshot = this.window.add(raw);
          if (snapshot !== null) this.snapshotListener?.(snapshot);
        }
      });
      adapter.onPlayerJoined((phone, name) => this.joinedListener?.(phone, name));
      adapter.onPlayerIdentified((phone, name) => this.identifyListener?.(phone, name));
      adapter.onStatusChange((status) => {
        this.statuses.set(kind, status);
        this.sourceStatusListeners.get(kind)?.(status);
        this.statusListener?.(this.combinedStatus());
      });
      void adapter.connect(roomId);
    }
    return Promise.resolve();
  }

  /** סטטוס מאוחד: מחובר אם מקור אחד לפחות מחובר; אחרת מתחבר; אחרת מנותק. */
  private combinedStatus(): Status {
    const values = [...this.statuses.values()];
    if (values.some((s) => s === 'connected')) return 'connected';
    if (values.some((s) => s === 'reconnecting')) return 'reconnecting';
    return 'offline';
  }

  setActiveSlide(slideId: number | null): void {
    if (slideId === null) this.window = null;
    // פתיחה לשקופית שכבר פתוחה — לא מאפסים את המונים (כמו הסוקט).
    else if (this.window === null || this.window.slideId !== slideId)
      this.window = new VoteWindow(slideId);
    for (const { adapter } of this.children) adapter.setActiveSlide(slideId);
  }

  onVoteSnapshot(cb: (snapshot: VoteSnapshot) => void): void {
    this.snapshotListener = cb;
  }
  onStatusChange(cb: (status: Status) => void): void {
    this.statusListener = cb;
  }
  onPlayerIdentified(cb: (phone: string, name: string) => void): void {
    this.identifyListener = cb;
  }
  onPlayerJoined(cb: (phone: string, name?: string) => void): void {
    this.joinedListener = cb;
  }
  onRawVote(cb: (vote: RawVote) => void): void {
    this.rawVoteListener = cb;
  }

  /** מנוי לסטטוס של מקור ספציפי (קליקרים / סוקט) — לחיווי נפרד. קורא מיד עם הערך הנוכחי. */
  onSourceStatus(kind: VoteSourceKind, cb: (status: Status) => void): void {
    this.sourceStatusListeners.set(kind, cb);
    cb(this.statuses.get(kind) ?? 'offline');
  }

  /** האם מקור מסוים מרכיב את המקור המשולב. */
  hasSource(kind: VoteSourceKind): boolean {
    return this.children.some((c) => c.kind === kind);
  }

  disconnect(): void {
    for (const { adapter } of this.children) adapter.disconnect();
    this.window = null;
  }

  requestFullState(): Promise<VoteSnapshot> {
    return this.window === null
      ? Promise.reject(new Error('אין חלון הצבעה פעיל'))
      : Promise.resolve(this.window.snapshot());
  }
}
