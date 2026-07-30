/**
 * בדיקות למפרש/שרת קליקרי RF317 (electron/clickerServer.cjs). המודול הוא
 * CommonJS (רץ בתהליך ה-main של Electron) — נטען כאן דרך createRequire.
 */
import { createRequire } from 'node:module';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { parseClickerStream, createClickerServer } = require('../electron/clickerServer.cjs') as {
  parseClickerStream: (b: Buffer) => { events: ClickerEvent[]; rest: Buffer; dropped: number };
  createClickerServer: (opts: Record<string, unknown>) => net.Server;
};

type ClickerEvent =
  | { type: 'key'; button: number; remoteId: number }
  | { type: 'status'; code: number; status: string };

describe('parseClickerStream — פרוטוקול RF317', () => {
  it('לחיצת כפתור = 3 בתים: [כפתור][Int16 BE מזהה]', () => {
    // כפתור 2, קליקר 305 (0x0131)
    const { events, rest } = parseClickerStream(Buffer.from([0x02, 0x01, 0x31]));
    expect(events).toEqual([{ type: 'key', button: 2, remoteId: 305 }]);
    expect(rest.length).toBe(0);
  });

  it('כפתור F = 0 (ישיר), עם מזהה הקליקר', () => {
    const { events } = parseClickerStream(Buffer.from([0x00, 0x00, 0x07]));
    expect(events).toEqual([{ type: 'key', button: 0, remoteId: 7 }]);
  });

  it('כפתור 1 = תשובה 1 (מיפוי ישיר)', () => {
    const { events } = parseClickerStream(Buffer.from([0x01, 0x00, 0x2a]));
    expect(events[0]).toEqual({ type: 'key', button: 1, remoteId: 42 });
  });

  it('בתי סטטוס (9..12) הם רשומה של בית אחד', () => {
    const { events } = parseClickerStream(Buffer.from([9, 10, 11, 12]));
    expect(events).toEqual([
      { type: 'status', code: 9, status: 'connected' },
      { type: 'status', code: 10, status: 'disconnected' },
      { type: 'status', code: 11, status: 'connecting' },
      { type: 'status', code: 12, status: 'not_connected' },
    ]);
  });

  it('זרם מעורב: סטטוס + לחיצות רצופות', () => {
    // connected · כפתור3 קליקר1 · כפתור4 קליקר2 · disconnected
    const buf = Buffer.from([9, 3, 0, 1, 4, 0, 2, 10]);
    const { events, rest } = parseClickerStream(buf);
    expect(events).toEqual([
      { type: 'status', code: 9, status: 'connected' },
      { type: 'key', button: 3, remoteId: 1 },
      { type: 'key', button: 4, remoteId: 2 },
      { type: 'status', code: 10, status: 'disconnected' },
    ]);
    expect(rest.length).toBe(0);
  });

  it('רשומת לחיצה שנחתכה בין חבילות — מוחזרת כשארית וממשיכה', () => {
    const first = parseClickerStream(Buffer.from([0x02, 0x01])); // חסר הבית השלישי
    expect(first.events).toEqual([]);
    expect(first.rest).toEqual(Buffer.from([0x02, 0x01]));
    // מדביקים את ההמשך
    const second = parseClickerStream(Buffer.concat([first.rest, Buffer.from([0x31])]));
    expect(second.events).toEqual([{ type: 'key', button: 2, remoteId: 305 }]);
  });
});

describe('createClickerServer — קבלה מלקוח TCP', () => {
  let server: net.Server | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });

  it('לקוח מתחבר, שולח בתים (מפוצלים) — כל האירועים מתקבלים לפי הסדר', async () => {
    const events: ClickerEvent[] = [];
    let connectedFlag = false;
    const port: number = await new Promise((resolve) => {
      server = createClickerServer({
        port: 0,
        onEvent: (ev: ClickerEvent) => events.push(ev),
        onClientChange: (connected: boolean) => {
          if (connected) connectedFlag = true;
        },
        onListening: () => {
          const addr = server!.address();
          resolve(typeof addr === 'object' && addr ? addr.port : 0);
        },
      });
    });

    await new Promise<void>((resolve, reject) => {
      const client = net.connect(port, '127.0.0.1', () => {
        // שולחים בשני חלקים, כשרשומת לחיצה נחתכת בין החלקים
        client.write(Buffer.from([9, 2, 0x01])); // connected + תחילת לחיצה(כפתור2)
        setTimeout(() => {
          client.write(Buffer.from([0x31, 5, 0, 3, 10])); // סוף הלחיצה(305) + כפתור5 קליקר3 + disconnected
          setTimeout(() => {
            client.end();
            resolve();
          }, 50);
        }, 30);
      });
      client.on('error', reject);
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(connectedFlag).toBe(true);
    expect(events).toEqual([
      { type: 'status', code: 9, status: 'connected' },
      { type: 'key', button: 2, remoteId: 305 },
      { type: 'key', button: 5, remoteId: 3 },
      { type: 'status', code: 10, status: 'disconnected' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// התיישרות מחדש: בית עודף/חסר מצד תוכנת הקליטה לא מנציח "הקשות רפאים"
// ---------------------------------------------------------------------------

/** רשומת לחיצה: כפתור + מזהה שלט (Int16 big-endian). */
function key(button: number, remoteId: number): Buffer {
  const b = Buffer.alloc(3);
  b[0] = button;
  b.writeInt16BE(remoteId, 1);
  return b;
}

describe('אי-סנכרון בזרם הקליקרים', () => {
  it('הזרם התקין מתפרש כרגיל, בלי דחיות', () => {
    const buf = Buffer.concat([key(2, 105), key(1, 106), Buffer.from([9])]);
    const { events, dropped } = parseClickerStream(buf);
    expect(dropped).toBe(0);
    expect(events).toEqual([
      { type: 'key', button: 2, remoteId: 105 },
      { type: 'key', button: 1, remoteId: 106 },
      { type: 'status', code: 9, status: 'connected' },
    ]);
  });

  it('בית שחסר בהתחלה לא מייצר הקשת רפאים בת 5 ספרות', () => {
    // הבאג המקורי: [2,0,105,9] בלי הבית הראשון התפרש כלחיצה של שלט 26889
    const shifted = Buffer.concat([key(2, 105), Buffer.from([9])]).subarray(1);
    const { events, dropped } = parseClickerStream(shifted);
    expect(events.some((e) => e.type === 'key')).toBe(false);
    expect(dropped).toBeGreaterThan(0);
    // ובכל זאת בית הסטטוס שאחריו מזוהה — הזרם התיישר מחדש
    expect(events).toEqual([{ type: 'status', code: 9, status: 'connected' }]);
  });

  it('מזהה אפס או שלילי נדחה ולא הופך למשתתף', () => {
    expect(parseClickerStream(key(3, 0)).events).toEqual([]);
    expect(parseClickerStream(key(1, -100)).events).toEqual([]);
    expect(parseClickerStream(key(1, 0)).dropped).toBeGreaterThan(0);
  });

  it('מזהה בן 5 ספרות נדחה (מעל התקרה), ומזהה סביר עובר', () => {
    expect(parseClickerStream(key(1, 12345)).events).toEqual([]);
    expect(parseClickerStream(key(1, 600)).events).toEqual([
      { type: 'key', button: 1, remoteId: 600 },
    ]);
    // גם ערכה עם מזהים גבוהים יחסית עדיין עוברת — התקרה נדיבה בכוונה
    expect(parseClickerStream(key(4, 4095)).events).toEqual([
      { type: 'key', button: 4, remoteId: 4095 },
    ]);
  });

  it('בית זבל בין רשומות פוגע לכל היותר ברשומה אחת, ולא בכל השאר', () => {
    const clean = [key(1, 101), key(2, 102), key(3, 103), key(4, 104)];
    const noisy = Buffer.concat([clean[0]!, Buffer.from([0xfe]), ...clean.slice(1)]);
    const { events } = parseClickerStream(noisy);
    const ids = events.filter((e) => e.type === 'key').map((e) => (e as { remoteId: number }).remoteId);
    // הרשומה הראשונה והאחרונות נשמרו — הסטייה לא נמשכה עד סוף הזרם
    expect(ids).toContain(101);
    expect(ids).toContain(104);
    expect(ids.every((id) => id >= 1 && id <= 9999)).toBe(true);
  });

  it('רשומה שנחתכה בין חבילות TCP עדיין ממתינה כשארית (בלי דחייה)', () => {
    const full = key(2, 300);
    const { events, rest, dropped } = parseClickerStream(full.subarray(0, 2));
    expect(events).toEqual([]);
    expect(dropped).toBe(0);
    expect(rest.length).toBe(2);
    // וכשההמשך מגיע — הרשומה נשלמת
    const joined = parseClickerStream(Buffer.concat([rest, full.subarray(2)]));
    expect(joined.events).toEqual([{ type: 'key', button: 2, remoteId: 300 }]);
  });
});
