/**
 * פורט תפוס. עד היום הכשל נרשם ללוג בלבד — המנחה ראה "אין חיבור לריסיבר"
 * בלי שום רמז שהסיבה היא תוכנה אחרת שמחזיקה את 8090.
 */

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import net from 'node:net';

const require_ = createRequire(import.meta.url);
const { createClickerServer } = require_('../electron/clickerServer.cjs') as {
  createClickerServer: (opts: Record<string, unknown>) => net.Server;
};

/** פורט פנוי אקראי, כדי שהבדיקות לא יתנגשו זו בזו. */
async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

describe('שרת הקליקרים מול פורט תפוס', () => {
  it('★ מדווח onPortBusy במקום ליפול בשקט', async () => {
    const port = await freePort();
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(port, '127.0.0.1', r));

    const busy = await new Promise<number>((resolve) => {
      const server = createClickerServer({
        port,
        retryMs: 0, // בלי ניסיון חוזר בבדיקה הזו
        onPortBusy: (p: number) => resolve(p),
      });
      setTimeout(() => server.close(), 1500);
    });
    expect(busy).toBe(port);
    await new Promise<void>((r) => blocker.close(() => r()));
  });

  it('★ מתאושש לבד ברגע שהפורט מתפנה — בלי להפעיל מחדש את התוכנה', async () => {
    const port = await freePort();
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(port, '127.0.0.1', r));

    let busyCalls = 0;
    const listening = new Promise<number>((resolve) => {
      const server = createClickerServer({
        port,
        retryMs: 120,
        onPortBusy: () => {
          busyCalls += 1;
          // משחררים את הפורט אחרי הדיווח הראשון
          if (busyCalls === 1) blocker.close();
        },
        onListening: (p: number) => {
          resolve(p);
          setTimeout(() => server.close(), 50);
        },
      });
    });
    expect(await listening).toBe(port);
    expect(busyCalls).toBeGreaterThanOrEqual(1);
  }, 10000);

  it('פורט פנוי — מאזין מיד, בלי דיווח על תפוס', async () => {
    const port = await freePort();
    const result = await new Promise<{ port: number; busy: number }>((resolve) => {
      let busy = 0;
      const server = createClickerServer({
        port,
        onPortBusy: () => (busy += 1),
        onListening: (p: number) => {
          server.close();
          resolve({ port: p, busy });
        },
      });
    });
    expect(result.port).toBe(port);
    expect(result.busy).toBe(0);
  });
});
