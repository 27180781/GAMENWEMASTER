// @ts-check
/**
 * שרת קליקרי RF317 מקומי (מצב אופליין / EXE).
 *
 * תוכנת RF317SocketForm.exe קוראת את דונגל ה-USB ומתחברת כלקוח TCP לפורט 8090.
 * כאן אנחנו ה-*שרת*: מקבלים את החיבור, מפרשים את הזרם הבינארי, ומעבירים כל
 * אירוע הלאה (לתהליך ה-renderer, דרך main.cjs).
 *
 * הפרוטוקול (זרם בתים, רשומה-אחרי-רשומה — קוראים בית `a`):
 *   • a = 0..8  → לחיצת כפתור, 3 בתים: a=הכפתור, שני הבאים = Int16 big-endian =
 *                 מזהה הקליקר.  (כפתור 1 = תשובה 1; כפתור F = 0.)
 *   • a = 9..12 → סטטוס הריסיבר, בית אחד:
 *                 9=connected · 10=disconnected · 11=connecting · 12=not_connected.
 */

const net = require('node:net');

/** קוד סטטוס → שם. */
const STATUS_BY_CODE = {
  9: 'connected',
  10: 'disconnected',
  11: 'connecting',
  12: 'not_connected',
};

const DEFAULT_PORT = 8090;

/**
 * טווח מזהי שלט קביל. הפרוטוקול הוא רשומות באורך קבוע בלי סמן-התחלה, ולכן בית
 * אחד שנוסף או נחסר מצד תוכנת הקליטה מזיז את היישור — וכל הרשומות שאחריו
 * מתפרשות שגוי. הסימן המובהק לכך הוא מזהה בלתי-אפשרי: אפס, שלילי, או בן חמש
 * ספרות (‏readInt16BE מגיע עד 32767). מזהה כזה מסמן ש*אין* כאן תחילת רשומה.
 *
 * התקרה נדיבה בכוונה — היא לא באה לסנן ערכות שלטים אלא לזהות זבל. ניתן לדרוס
 * אותה ב-RF317_MAX_ID אם קיימת ערכה עם מזהים גבוהים.
 */
const MIN_REMOTE_ID = 1;
const MAX_REMOTE_ID = Number(process.env.RF317_MAX_ID) || 9999;

/**
 * @typedef {{ type: 'key', button: number, remoteId: number }} ClickerKeyEvent
 * @typedef {{ type: 'status', code: number, status: string }} ClickerStatusEvent
 * @typedef {ClickerKeyEvent | ClickerStatusEvent} ClickerEvent
 */

/**
 * מפרש זרם בתים לרשומות. מחזיר את האירועים שהושלמו, את שארית הבתים (רשומת
 * לחיצה שנחתכה בין חבילות TCP — ממתינה להמשך), ומונה בתים שנדחו כזבל.
 *
 * התיישרות מחדש: הפרוטוקול חסר סמן-התחלה, ולכן בית אחד עודף/חסר מצד תוכנת
 * הקליטה מזיז את היישור. קודם, צריכה עיוורת של 3 בתים לכל רשומה הנציחה את
 * השגיאה — כל שאר המשחק התפרש שגוי והופיעו "הקשות רפאים" ממזהים בני חמש
 * ספרות שאינם קיימים. עכשיו רשומה שמזההּ בלתי-אפשרי אינה נצרכת: מקדמים בית
 * *אחד* ומנסים שוב, כך שהזרם מתיישר בחזרה בתוך בית או שניים.
 *
 * @param {Buffer} buffer
 * @returns {{ events: ClickerEvent[], rest: Buffer, dropped: number }}
 */
function parseClickerStream(buffer) {
  /** @type {ClickerEvent[]} */
  const events = [];
  let i = 0;
  let dropped = 0;
  while (i < buffer.length) {
    const a = buffer[i];
    if (a >= 9) {
      // סטטוס — בית אחד. בייטים מחוץ לפרוטוקול (13–255, למשל תהליך זר שכתב
      // טקסט לפורט) לא מפורשים ולא מוזרמים — כדי שלא יציפו את ה-IPC ויבלבלו
      // את חיווי החיבור.
      if (STATUS_BY_CODE[a] !== undefined) {
        events.push({ type: 'status', code: a, status: STATUS_BY_CODE[a] });
      } else {
        dropped += 1;
      }
      i += 1;
      continue;
    }
    // לחיצת כפתור — 3 בתים; אם עדיין לא הגיעו כולם, עוצרים ומחזירים כשארית
    if (i + 3 > buffer.length) break;
    const remoteId = buffer.readInt16BE(i + 1);
    if (remoteId < MIN_REMOTE_ID || remoteId > MAX_REMOTE_ID) {
      dropped += 1;
      i += 1; // התיישרות מחדש — ולא צריכה של 3 בתים שהייתה מנציחה את הסטייה
      continue;
    }
    events.push({ type: 'key', button: a, remoteId });
    i += 3;
  }
  return { events, rest: buffer.subarray(i), dropped };
}

/**
 * מריץ שרת TCP מקומי שמקבל את RF317SocketForm ומפרש את הזרם.
 * @param {{
 *   port?: number,
 *   host?: string,
 *   onEvent?: (ev: ClickerEvent) => void,
 *   onClientChange?: (connected: boolean, who: string | null) => void,
 *   onDropped?: (dropped: number, total: number) => void,
 *   onListening?: (port: number, host: string) => void,
 *   onError?: (err: Error) => void,
 *   onPortBusy?: (port: number) => void,
 *   retryMs?: number,
 * }} [opts]
 * @returns {import('node:net').Server}
 */
function createClickerServer(opts = {}) {
  const {
    port = DEFAULT_PORT,
    host = '127.0.0.1',
    onEvent,
    onClientChange,
    onDropped,
    onListening,
    onError,
    onPortBusy,
    // ניסיון חוזר על פורט תפוס: אם התהליך שתפס אותו נסגר, החיבור מתאושש לבד
    // בלי לסגור ולפתוח את התוכנה באמצע אירוע.
    retryMs = 5000,
  } = opts;

  const server = net.createServer((socket) => {
    // שארית הבתים היא per-חיבור (רשומה שנחתכה) — לא מעורבבת בין לקוחות.
    let leftover = Buffer.alloc(0);
    onClientChange?.(true, `${socket.remoteAddress}:${socket.remotePort}`);

    // בתים שנדחו כזבל — מדווחים כדי שאי-סנכרון יהיה נראה בלוג ולא ייעלם בשקט.
    let droppedTotal = 0;
    socket.on('data', (chunk) => {
      const combined = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
      const { events, rest, dropped } = parseClickerStream(combined);
      leftover = rest;
      if (dropped > 0) {
        droppedTotal += dropped;
        onDropped?.(dropped, droppedTotal);
      }
      for (const ev of events) onEvent?.(ev);
    });
    socket.on('close', () => {
      leftover = Buffer.alloc(0);
      onClientChange?.(false, null);
    });
    socket.on('error', (err) => onError?.(err));
  });

  /** @type {NodeJS.Timeout | null} */
  let retryTimer = null;
  server.on('error', (err) => {
    // EADDRINUSE אינו כשל של הרשת אלא של המחשב: תהליך אחר מחזיק את הפורט,
    // ולכן תוכנת הקליטה לא תוכל להתחבר לעולם. עד היום זה נרשם ללוג בלבד,
    // כלומר היה בלתי-נראה למנחה. מדווחים, וממשיכים לנסות.
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'EADDRINUSE') {
      onPortBusy?.(port);
      if (retryMs > 0 && retryTimer === null) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          server.listen(port, host);
        }, retryMs);
        // טיימר ההמתנה לא יחזיק את התוכנה פתוחה ביציאה
        retryTimer.unref?.();
      }
      return;
    }
    onError?.(err);
  });
  server.on('listening', () => onListening?.(port, host));
  server.on('close', () => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  });
  server.listen(port, host);
  return server;
}

module.exports = {
  parseClickerStream,
  createClickerServer,
  STATUS_BY_CODE,
  DEFAULT_PORT,
  MIN_REMOTE_ID,
  MAX_REMOTE_ID,
};
