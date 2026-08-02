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

/**
 * "קליטת שלטים בלחיצה" פעילה. יש זרם קליקרים אחד לכל התוכנה, ולכן זה דגל
 * יחיד. בזמן קליטה הלחיצות משמשות *רק* לרישום השלטים: הן אינן הצבעות, אינן
 * מצרפות ללובי ואינן מגיעות לשלט המנחה — אחרת רישום החדר היה מצביע בשאלה
 * פתוחה או מקדם את המשחק.
 */
let captureMode = false;

export function setClickerCaptureMode(on: boolean): void {
  captureMode = on;
}

export function isClickerCaptureMode(): boolean {
  return captureMode;
}

export class ClickerVoteAdapter implements LiveVoteAdapter {
  private snapshotListener: ((snapshot: VoteSnapshot) => void) | null = null;
  private statusListener: ((status: Status) => void) | null = null;
  private joinedListener: ((phone: string, name?: string) => void) | null = null;
  private rawVoteListener: ((vote: RawVote) => void) | null = null;
  private window: VoteWindow | null = null;
  private offEvent: (() => void) | null = null;
  private offClient: (() => void) | null = null;
  /** סטטוס הדונגל עצמו (מבית הסטטוס), null = טרם התקבל. */
  private dongle: string | null = null;
  /** האם תוכנת הקליטה מחוברת לסוקט, null = טרם ידוע. */
  private software: boolean | null = null;

  connect(_roomId: string): Promise<void> {
    // עד שהריסיבר יתחבר וישלח בית "connected" — הסטטוס הוא 'offline' (→ אזהרה).
    this.statusListener?.('offline');
    this.offEvent = onClickerEvent((ev) => this.handle(ev));
    this.offClient = onReceiverClient((info) => {
      this.software = info.connected;
      this.pushStatus();
    });
    return Promise.resolve();
  }

  /**
   * שני אותות נפרדים (בית הסטטוס של הדונגל · חיבור תוכנת הקליטה לסוקט) מגיעים
   * בזרמים נפרדים ובסדר לא מובטח — במיוחד בשידור החוזר של הסטטוס האחרון למנוי
   * חדש, כשעוברים ממסך ההגדרות אל המשחק. לכן כל אות נשמר בנפרד והסטטוס נגזר
   * משניהם, במקום שכל אירוע ידרוס את קודמו (מה שהיה מוריד 'connected' חזרה
   * ל'reconnecting' ומחזיר את אזהרת "אין חיבור לריסיבר" בלי סיבה).
   */
  private pushStatus(): void {
    // ניתוק תוכנת הקליטה = אין מקור הצבעות, בלי קשר לבית האחרון מהדונגל.
    if (this.software === false) return this.statusListener?.('offline');
    if (this.dongle === 'connected') return this.statusListener?.('connected');
    if (this.dongle === 'connecting') return this.statusListener?.('reconnecting');
    if (this.dongle !== null) return this.statusListener?.('offline'); // disconnected / not_connected
    // אין עדיין בית מהדונגל: חיבור התוכנה לסוקט הוא "בדרך", לא "מחובר".
    return this.statusListener?.(this.software === true ? 'reconnecting' : 'offline');
  }

  private handle(ev: ClickerEvent): void {
    if (ev.type === 'status') {
      this.dongle = ev.status;
      this.pushStatus();
      return;
    }
    // בזמן קליטת שלטים הלחיצה היא רישום, לא הצבעה — ולכן נעצרת כאן לגמרי.
    if (captureMode) return;
    // לחיצת כפתור → הצבעה גולמית. כפתור F (השלט-אצבע) מגיע כ-7 ומשמעו 0:
    // לשחקן — תשובה 0; למנחה — פקודת "הבא" (כמו 0 בטלפון / רווח במקלדת).
    const phone = String(ev.remoteId);
    const button = ev.button === 7 ? 0 : ev.button;
    const raw: RawVote = { vote: String(button), phone };
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
    // איפוס האותות — חיבור הבא מתחיל מדף חלק ולא נשען על מצב ישן.
    this.dongle = null;
    this.software = null;
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
