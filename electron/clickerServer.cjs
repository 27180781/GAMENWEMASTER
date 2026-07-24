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
 * @typedef {{ type: 'key', button: number, remoteId: number }} ClickerKeyEvent
 * @typedef {{ type: 'status', code: number, status: string }} ClickerStatusEvent
 * @typedef {ClickerKeyEvent | ClickerStatusEvent} ClickerEvent
 */

/**
 * מפרש זרם בתים לרשומות. מחזיר את האירועים שהושלמו ואת שארית הבתים (רשומת
 * לחיצה שנחתכה בין חבילות TCP — ממתינה להמשך).
 * @param {Buffer} buffer
 * @returns {{ events: ClickerEvent[], rest: Buffer }}
 */
function parseClickerStream(buffer) {
  /** @type {ClickerEvent[]} */
  const events = [];
  let i = 0;
  while (i < buffer.length) {
    const a = buffer[i];
    if (a >= 9) {
      // סטטוס — בית אחד
      events.push({ type: 'status', code: a, status: STATUS_BY_CODE[a] ?? 'unknown' });
      i += 1;
    } else {
      // לחיצת כפתור — 3 בתים; אם עדיין לא הגיעו כולם, עוצרים ומחזירים כשארית
      if (i + 3 > buffer.length) break;
      const remoteId = buffer.readInt16BE(i + 1);
      events.push({ type: 'key', button: a, remoteId });
      i += 3;
    }
  }
  return { events, rest: buffer.subarray(i) };
}

/**
 * מריץ שרת TCP מקומי שמקבל את RF317SocketForm ומפרש את הזרם.
 * @param {{
 *   port?: number,
 *   host?: string,
 *   onEvent?: (ev: ClickerEvent) => void,
 *   onClientChange?: (connected: boolean, who: string | null) => void,
 *   onListening?: (port: number, host: string) => void,
 *   onError?: (err: Error) => void,
 * }} [opts]
 * @returns {import('node:net').Server}
 */
function createClickerServer(opts = {}) {
  const {
    port = DEFAULT_PORT,
    host = '127.0.0.1',
    onEvent,
    onClientChange,
    onListening,
    onError,
  } = opts;

  const server = net.createServer((socket) => {
    // שארית הבתים היא per-חיבור (רשומה שנחתכה) — לא מעורבבת בין לקוחות.
    let leftover = Buffer.alloc(0);
    onClientChange?.(true, `${socket.remoteAddress}:${socket.remotePort}`);

    socket.on('data', (chunk) => {
      const combined = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
      const { events, rest } = parseClickerStream(combined);
      leftover = rest;
      for (const ev of events) onEvent?.(ev);
    });
    socket.on('close', () => {
      leftover = Buffer.alloc(0);
      onClientChange?.(false, null);
    });
    socket.on('error', (err) => onError?.(err));
  });

  server.on('error', (err) => onError?.(err));
  server.listen(port, host, () => onListening?.(port, host));
  return server;
}

module.exports = { parseClickerStream, createClickerServer, STATUS_BY_CODE, DEFAULT_PORT };
