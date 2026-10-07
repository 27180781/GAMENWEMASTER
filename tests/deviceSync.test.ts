/**
 * הבדיקה מול המערכת (electron/deviceSync.cjs): מה נשלח, ומה עושים עם כל
 * תשובה. הרשת מדומה. הכלל: כל כישלון (אין רשת, שרת ישן, עומס) משאיר את
 * המחשב עובד עם מה שכבר אצלו.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
type Permissions = { createGame: boolean; editGame: boolean };
type DeviceGame = { gameId: string; name: string; code: string | null; version: string | null; expiresAt: string | null; reason?: string };
type PublicDevice = {
  id: string;
  name: string | null;
  pendingName: string | null;
  registered: boolean;
  permissions: Permissions;
  blocked: boolean;
};
type PostResult = { status: number; body: unknown };
type SyncResult = {
  state: string;
  device: PublicDevice;
  games?: DeviceGame[];
  pollSeconds?: number;
  blockChanged?: boolean;
  error?: string;
};
type Random = { randomInt: (min: number, max: number) => number; randomBytes: (n: number) => Buffer };
const sync = require('../electron/deviceSync.cjs') as {
  syncDevice: (deps: {
    userData: string;
    post: (body: Record<string, unknown>) => Promise<PostResult>;
    have: { gameId: string; version: string | null }[];
    appVersion?: string;
    hostname?: string;
    platform?: string;
    rand?: Random;
  }) => Promise<SyncResult>;
  haveFromLibrary: (library: unknown[]) => { gameId: string; version: string | null }[];
  cleanGames: (raw: unknown) => DeviceGame[];
  publicDevice: (d: unknown) => PublicDevice;
  DEFAULT_POLL_SECONDS: number;
};
const identity = require('../electron/deviceIdentity.cjs') as {
  loadDevice: (
    userData: string,
    rand?: Random,
  ) => { id: string; secret: string; pendingName: string | null; permissions: Permissions; blocked: boolean };
  setPendingName: (userData: string, name: unknown) => unknown;
};

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const ids = (...list: number[]): Random => {
  let i = 0;
  return { randomInt: () => list[Math.min(i++, list.length - 1)]!, randomBytes: (n) => Buffer.alloc(n, 7) };
};

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'devsync-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const okAnswer = (patch: Record<string, unknown> = {}): PostResult => ({
  status: 200,
  body: {
    ok: true,
    device: { id: 'x', name: 'אולם 1', permissions: { createGame: true, editGame: false } },
    games: [{ gameId: A, name: 'חידון', code: '123456', version: 'v1', expiresAt: '2026-12-01T00:00:00Z' }],
    pollSeconds: 300,
    ...patch,
  },
});

describe('syncDevice', () => {
  it('★ שולח מספר, סוד ומה שבמחשב; מקבל משחקים, שם ואישורים שנשמרים במחשב', async () => {
    const post = vi.fn(async (_body: Record<string, unknown>) => okAnswer());
    const have = [{ gameId: A, version: 'v0' }];
    const res = await sync.syncDevice({ userData: dir, post, have, appVersion: '0.1.200', hostname: 'HALL-PC', platform: 'win32', rand: ids(48217730) });
    const body = post.mock.calls[0]![0];
    expect(body).toMatchObject({ action: 'sync', deviceId: '48217730', hostname: 'HALL-PC', appVersion: '0.1.200', platform: 'win32', have });
    expect(body.secret).toMatch(/^[0-9a-f]{64}$/);
    expect('name' in body).toBe(false); // לא הוקלד שם — השרת שומר את שלו
    expect(res.state).toBe('ok');
    expect(res.games).toEqual([{ gameId: A, name: 'חידון', code: '123456', version: 'v1', expiresAt: '2026-12-01T00:00:00Z' }]);
    expect(res.pollSeconds).toBe(300);
    expect(res.device).toMatchObject({ id: '48217730', name: 'אולם 1', registered: true });
    expect(res.device.permissions).toEqual({ createGame: true, editGame: false });
    expect('secret' in res.device).toBe(false); // הסוד לא יוצא מהתהליך הראשי
    expect(identity.loadDevice(dir).permissions).toEqual({ createGame: true, editGame: false });
  });

  it('★ שם שהוקלד כאן נשלח פעם אחת, ויורד מהתור אחרי שהשרת קיבל', async () => {
    identity.loadDevice(dir);
    identity.setPendingName(dir, 'אולם 2');
    const post = vi.fn(async (b: Record<string, unknown>) => okAnswer({ device: { name: b.name } }));
    await sync.syncDevice({ userData: dir, post, have: [] });
    expect((post.mock.calls[0]![0] as Record<string, unknown>).name).toBe('אולם 2');
    expect(identity.loadDevice(dir).pendingName).toBeNull();
    await sync.syncDevice({ userData: dir, post, have: [] });
    expect('name' in (post.mock.calls[1]![0] as Record<string, unknown>)).toBe(false);
  });

  it('★ אין רשת — "offline", והאישורים שכבר במחשב לא נמחקים', async () => {
    await sync.syncDevice({ userData: dir, post: async () => okAnswer(), have: [] });
    const res = await sync.syncDevice({
      userData: dir,
      post: async () => {
        throw new Error('net::ERR_INTERNET_DISCONNECTED');
      },
      have: [],
    });
    expect(res.state).toBe('offline');
    expect(res.device.permissions).toEqual({ createGame: true, editGame: false });
  });

  it('★ המספר תפוס במחשב אחר (409) — מספר חדש וניסיון אחד נוסף', async () => {
    const post = vi
      .fn<(b: Record<string, unknown>) => Promise<PostResult>>()
      .mockResolvedValueOnce({ status: 409, body: { error: 'device_conflict' } })
      .mockResolvedValueOnce(okAnswer());
    const res = await sync.syncDevice({ userData: dir, post, have: [], rand: ids(11111111, 22222222) });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0]![0].deviceId).toBe('11111111');
    expect(post.mock.calls[1]![0].deviceId).toBe('22222222');
    expect(res.state).toBe('ok');
    expect(identity.loadDevice(dir).id).toBe('22222222');
  });

  it('409 פעמיים — שגיאה, בלי לולאה', async () => {
    const post = vi.fn(async () => ({ status: 409, body: { error: 'device_conflict' } }));
    const res = await sync.syncDevice({ userData: dir, post, have: [], rand: ids(11111111, 22222222, 33333333) });
    expect(post).toHaveBeenCalledTimes(2);
    expect(res.state).toBe('error');
    expect(res.error).toBe('HTTP 409: device_conflict');
  });

  it('עומס (429) — "busy"; שרת ישן בלי הפונקציה (404) — "unavailable"; תקלה — "error" עם הקוד', async () => {
    expect((await sync.syncDevice({ userData: dir, post: async () => ({ status: 429, body: null }), have: [] })).state).toBe('busy');
    expect((await sync.syncDevice({ userData: dir, post: async () => ({ status: 404, body: null }), have: [] })).state).toBe('unavailable');
    const err = await sync.syncDevice({ userData: dir, post: async () => ({ status: 500, body: { error: 'boom' } }), have: [] });
    expect(err).toMatchObject({ state: 'error', error: 'HTTP 500: boom' });
    const weird = await sync.syncDevice({ userData: dir, post: async () => ({ status: 200, body: 'not json' }), have: [] });
    expect(weird).toMatchObject({ state: 'error', error: 'HTTP 200' });
  });

  it('מרווח הבדיקה מהשרת רק בטווח סביר', async () => {
    const at = async (pollSeconds: unknown) =>
      (await sync.syncDevice({ userData: dir, post: async () => okAnswer({ pollSeconds }), have: [] })).pollSeconds;
    expect(await at(120)).toBe(120);
    expect(await at(5)).toBe(sync.DEFAULT_POLL_SECONDS);
    expect(await at(10 ** 9)).toBe(sync.DEFAULT_POLL_SECONDS);
    expect(await at('x')).toBe(sync.DEFAULT_POLL_SECONDS);
  });
});

describe('השבתת התוכנה מול השרת', () => {
  /** תשובה שמשביתה את המחשב שפנה (המספר שלו), עם משחקים שאסור שיגיעו להורדה. */
  const blockedAnswer = (b: Record<string, unknown>) =>
    okAnswer({ device: { id: b.deviceId, name: 'אולם 1', blocked: true }, pollSeconds: 60 });
  const openAnswer = (b: Record<string, unknown>) => okAnswer({ device: { id: b.deviceId, name: 'אולם 1', blocked: false } });

  it('★ מחשב חדש שולח שאינו נעול, ונשאר פתוח מול שרת שלא השבית אותו', async () => {
    const post = vi.fn(async (b: Record<string, unknown>) => openAnswer(b));
    const res = await sync.syncDevice({ userData: dir, post, have: [] });
    expect(post.mock.calls[0]![0].blocked).toBe(false);
    expect(res).toMatchObject({ state: 'ok', blockChanged: false });
    expect(res.device.blocked).toBe(false);
    expect(res.games).toHaveLength(1);
  });

  it('★ השבתה: נשמרת, בלי משחקים להורדה, ומדווחת בבדיקה הבאה', async () => {
    const post = vi.fn(async (b: Record<string, unknown>) => blockedAnswer(b));
    const first = await sync.syncDevice({ userData: dir, post, have: [] });
    expect(first.device.blocked).toBe(true);
    expect(first.games).toEqual([]); // גם כשהשרת שלח משחקים
    expect(first.blockChanged).toBe(true);
    expect(first.pollSeconds).toBe(60);
    expect(identity.loadDevice(dir).blocked).toBe(true);
    const second = await sync.syncDevice({ userData: dir, post, have: [] });
    expect(post.mock.calls[1]![0].blocked).toBe(true); // המערכת רואה שהמחשב קיבל
    expect(second.blockChanged).toBe(false);
  });

  it('★ מחשב מושבת נשאר נעול כשאין רשת, בעומס, מול שרת ישן ובתקלה', async () => {
    await sync.syncDevice({ userData: dir, post: async (b) => blockedAnswer(b), have: [] });
    const failures: (() => Promise<PostResult>)[] = [
      async () => {
        throw new Error('net::ERR_INTERNET_DISCONNECTED');
      },
      async () => ({ status: 429, body: null }),
      async () => ({ status: 404, body: null }),
      async () => ({ status: 500, body: { error: 'boom' } }),
      async () => ({ status: 200, body: 'not json' }),
      async () => ({ status: 200, body: { ok: false, device: { blocked: false } } }),
    ];
    for (const post of failures) {
      const res = await sync.syncDevice({ userData: dir, post, have: [] });
      expect(res.state).not.toBe('ok');
      expect(res.device.blocked).toBe(true);
    }
    expect(identity.loadDevice(dir).blocked).toBe(true);
  });

  it('★ ולהפך: מחשב פתוח לעולם אינו ננעל מתקלה, מניתוק או משרת ישן', async () => {
    await sync.syncDevice({ userData: dir, post: async (b) => openAnswer(b), have: [] });
    const failures: (() => Promise<PostResult>)[] = [
      async () => {
        throw new Error('timeout');
      },
      async () => ({ status: 429, body: null }),
      async () => ({ status: 404, body: null }),
      async () => ({ status: 500, body: null }),
      async () => ({ status: 403, body: { blocked: true } }),
    ];
    for (const post of failures) {
      expect((await sync.syncDevice({ userData: dir, post, have: [] })).device.blocked).toBe(false);
    }
    // שרת ישן שעונה בלי השדה
    expect((await sync.syncDevice({ userData: dir, post: async () => okAnswer(), have: [] })).device.blocked).toBe(false);
  });

  it('★ ביטול ההשבתה: התשובה המוצלחת הבאה פותחת, ומדווחת מיד', async () => {
    await sync.syncDevice({ userData: dir, post: async (b) => blockedAnswer(b), have: [] });
    const res = await sync.syncDevice({ userData: dir, post: async (b) => openAnswer(b), have: [] });
    expect(res.device.blocked).toBe(false);
    expect(res.blockChanged).toBe(true);
    expect(res.games).toHaveLength(1); // המשחקים חוזרים
    expect(identity.loadDevice(dir).blocked).toBe(false);
  });

  it('השבתה של מספר אחר (תשובה שאינה למחשב הזה) אינה נועלת', async () => {
    const res = await sync.syncDevice({
      userData: dir,
      post: async () => okAnswer({ device: { id: '99999999', blocked: true } }),
      have: [],
    });
    expect(res.device.blocked).toBe(false);
  });
});

describe('cleanGames — התשובה מסוננת לפני שהיא נוגעת בדיסק', () => {
  it('★ קוד שאינו תקין כשם קובץ אינו מגיע להורדה', () => {
    expect(sync.cleanGames([{ gameId: A, name: 'x', code: '../../evil', version: 'v1' }])).toEqual([
      { gameId: A, name: 'x', code: null, version: null, expiresAt: null, reason: 'no_license' },
    ]);
  });

  it('מזהה לא תקין נזרק; כפילות (גם באותיות גדולות) נזרקת', () => {
    const games = sync.cleanGames([
      { gameId: 'nope', code: '1', version: 'v' },
      { gameId: A, code: '1', version: 'v' },
      { gameId: A.toUpperCase(), code: '2', version: 'v' },
      null,
      'x',
    ]);
    expect(games.map((g) => [g.gameId, g.code])).toEqual([[A, '1']]);
  });

  it('בלי קוד או גרסה — הסיבה מהשרת נשמרת', () => {
    const [noLicense, unavailable] = sync.cleanGames([
      { gameId: A, code: null, version: null },
      { gameId: B, code: '1', version: null, reason: 'unavailable' },
    ]);
    expect(noLicense).toMatchObject({ code: null, version: null, reason: 'no_license' });
    expect(unavailable).toMatchObject({ code: null, version: null, reason: 'unavailable' });
  });

  it('שם ארוך נחתך, ותשובה שאינה רשימה — ריקה', () => {
    expect(sync.cleanGames([{ gameId: A, name: 'א'.repeat(500), code: '1', version: 'v' }])[0]!.name).toHaveLength(200);
    expect(sync.cleanGames({ games: [] })).toEqual([]);
  });
});

describe('haveFromLibrary — מה במחשב', () => {
  it('★ לכל משחק מהמערכת — הגרסה של העותק החדש ביותר; משחק שנבנה במחשב אינו נשלח', () => {
    expect(
      sync.haveFromLibrary([
        { code: '1', gameId: A, version: 'v1', savedAt: 1000 },
        { code: '2', gameId: A.toUpperCase(), version: 'v2', savedAt: 3000 },
        { code: '3', gameId: B, version: null, savedAt: 2000 },
        { code: 'l', gameId: '33333333-3333-4333-8333-333333333333', version: 'v', savedAt: 9000, local: true },
        { code: 'z', gameId: null, savedAt: 5000 },
      ]),
    ).toEqual([
      { gameId: A, version: 'v2' },
      { gameId: B, version: null },
    ]);
  });
});
