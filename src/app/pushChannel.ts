/**
 * ערוץ "פוש רענון" למשחק האונליין.
 *
 * דרישת המנחה: כשמעדכנים את קובץ ה-JSON של משחק פעיל, השינוי ישתקף במשחק
 * *רק* כשנשלח אליו אות רענון — בלי סקר תקופתי (polling) ובלי לאבד את מהלך
 * המשחק (ניקוד/מיקום נשמרים דרך GameEngine.updateGame).
 *
 * שלושה מקורות לאות הרענון, כולם אופציונליים ומצטברים:
 *
 *   1. window.postMessage — עמוד שליטה שפתח את המשחק (window.open / iframe)
 *      שולח ‎{ type: 'trivia-refresh', game?: <json> }‎. בלי מעטפת כזו —
 *      ההודעה מתעלמים ממנה (לא כל postMessage אקראי מרענן).
 *
 *   2. ‎&push=<url>‎ — חיבור מתמשך לשרת שהמנחה שולט בו:
 *        • ws:// או wss://  → WebSocket
 *        • כל כתובת אחרת    → SSE (EventSource)
 *      כל הודעה שמגיעה בערוץ נחשבת אות רענון. אם ההודעה נושאת JSON של משחק —
 *      הוא מוחל ישירות (פוש אמיתי, בלי משיכה חוזרת); אחרת המשחק מושך מחדש את
 *      קובץ המשחק מכתובת ‎?game=<URL>‎.
 *
 * פענוח תוכן ההודעה מהערוץ מבודד ב-interpretPushMessage (טהור, נבדק ביחידה).
 */

export type PushDirective =
  /** למשוך מחדש את קובץ המשחק מכתובת ‎?game=URL‎. */
  | { kind: 'refetch' }
  /** להחיל ישירות את ה-JSON שנשלח בפוש (בלי משיכה חוזרת). */
  | { kind: 'game'; raw: unknown }
  /** הודעה לא רלוונטית — מתעלמים. */
  | { kind: 'ignore' };

// הענף הריק בסוף מכוון: גם הודעה ריקה בערוץ נחשבת אות רענון (ping בלי גוף).
const REFRESH_WORD = /^(refresh|reload|refetch|update|ping|)$/i;

/**
 * פענוח הודעה שהגיעה בערוץ השרת (&push=). מזהה בקשת משיכה-חוזרת, JSON של
 * משחק שנשלח ישירות, או הודעה שיש להתעלם ממנה.
 */
export function interpretPushMessage(data: unknown): PushDirective {
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (REFRESH_WORD.test(trimmed)) return { kind: 'refetch' };
    try {
      return interpretPushMessage(JSON.parse(trimmed) as unknown);
    } catch {
      return { kind: 'refetch' }; // מחרוזת לא-JSON כלשהי → סתם אות רענון
    }
  }
  if (data !== null && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (obj.game !== undefined && obj.game !== null) return { kind: 'game', raw: obj.game };
    if (Array.isArray(obj.questions)) return { kind: 'game', raw: obj };
    if (typeof obj.type === 'string' && /refresh|reload|update/i.test(obj.type)) {
      return { kind: 'refetch' };
    }
  }
  return { kind: 'ignore' };
}

export interface PushChannelOptions {
  /** כתובת ה-push (מ-‎&push=‎). null = אין ערוץ שרת — נשאר רק postMessage. */
  pushUrl: string | null;
  /** נקרא כשצריך למשוך מחדש את קובץ המשחק מ-‎?game=URL‎. */
  onRefetch: () => void;
  /** נקרא כשהגיע JSON של משחק ישירות בפוש. */
  onGame: (raw: unknown) => void;
}

/** דגל בטיחות: קבלת JSON ישיר ב-postMessage רק תחת המעטפת שלנו. */
const POST_MESSAGE_TYPE = 'trivia-refresh';

/**
 * פתיחת ערוץ הפוש. מחזיר פונקציית סגירה שמנתקת את כל המקורות.
 * בטוח להריץ גם בלי pushUrl — אז פועל רק ערוץ ה-postMessage.
 */
export function openPushChannel(opts: PushChannelOptions): () => void {
  const closers: (() => void)[] = [];

  const applyDirective = (directive: PushDirective) => {
    if (directive.kind === 'refetch') opts.onRefetch();
    else if (directive.kind === 'game') opts.onGame(directive.raw);
  };

  // 1) postMessage — רק תחת המעטפת { type: 'trivia-refresh', game? }
  const onMessage = (event: MessageEvent) => {
    const d = event.data as unknown;
    if (d === null || typeof d !== 'object') return;
    const obj = d as Record<string, unknown>;
    if (obj.type !== POST_MESSAGE_TYPE) return;
    if (obj.game !== undefined && obj.game !== null) opts.onGame(obj.game);
    else opts.onRefetch();
  };
  window.addEventListener('message', onMessage);
  closers.push(() => window.removeEventListener('message', onMessage));

  // 2) ערוץ שרת מתמשך (&push=)
  if (opts.pushUrl !== null && opts.pushUrl !== '') {
    const url = opts.pushUrl;
    if (/^wss?:\/\//i.test(url)) {
      let closed = false;
      let socket: WebSocket | null = null;
      let attempt = 0;
      const connect = () => {
        if (closed) return;
        socket = new WebSocket(url);
        socket.onmessage = (e) => applyDirective(interpretPushMessage(e.data));
        socket.onclose = () => {
          if (closed) return;
          attempt = Math.min(attempt + 1, 6);
          window.setTimeout(connect, 1000 * attempt); // התחברות חוזרת עם השהיה גוברת
        };
        socket.onerror = () => socket?.close();
      };
      connect();
      closers.push(() => {
        closed = true;
        socket?.close();
      });
    } else {
      const source = new EventSource(url); // EventSource מתחבר מחדש לבד
      source.onmessage = (e) => applyDirective(interpretPushMessage(e.data));
      closers.push(() => source.close());
    }
  }

  return () => {
    for (const close of closers) close();
  };
}
