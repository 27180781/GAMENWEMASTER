/**
 * בדיקות למפרש/שרת קליקרי RF317 (electron/clickerServer.cjs). המודול הוא
 * CommonJS (רץ בתהליך ה-main של Electron) — נטען כאן דרך createRequire.
 */
import { createRequire } from 'node:module';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { parseClickerStream, createClickerServer } = require('../electron/clickerServer.cjs') as {
  parseClickerStream: (b: Buffer) => { events: ClickerEvent[]; rest: Buffer };
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
