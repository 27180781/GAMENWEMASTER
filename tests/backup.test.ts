/**
 * לקוח הגיבוי מול Supabase (backup.ts) — כתובות, כותרות, ומירת JSON — עם
 * fetch ממוקק (בלי רשת אמיתית).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BACKUP_CONFIG,
  endGame,
  fetchBackup,
  getBackup,
  prefetchBackup,
  resolveBackupConfig,
  saveBackup,
  type BackupConfig,
  type BackupPayload,
} from '../src/app/backup.ts';

const cfg: BackupConfig = { baseUrl: 'http://x/functions/v1', anonKey: 'KEY123' };

function mockFetch(impl: (url: string, init?: RequestInit) => unknown) {
  const fn = vi.fn((url: string, init?: RequestInit) => Promise.resolve(impl(url, init)));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchBackup', () => {
  it('כתובת + כותרות נכונות, ומפענח שדות שהגיעו כמחרוזות JSON', async () => {
    const fn = mockFetch(() => ({
      ok: true,
      json: async () => ({
        id: 'game7',
        users: JSON.stringify({ a: { name: 'א', score: 5 } }),
        questions: '{}',
        groups: '[]',
        meta: JSON.stringify({ currentQueId: 3, phase: 'voting', startedAt: 111 }),
      }),
    }));
    const data = await fetchBackup(cfg, 'game7');
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe('http://x/functions/v1/save-backup/game7');
    expect((init as RequestInit).headers).toMatchObject({
      apikey: 'KEY123',
      Authorization: 'Bearer KEY123',
    });
    expect(data?.users.a?.score).toBe(5);
    expect(data?.meta.phase).toBe('voting');
    expect(data?.meta.currentQueId).toBe(3);
  });

  it('מחזיר null בתשובה לא-תקינה או גוף ריק', async () => {
    mockFetch(() => ({ ok: false, json: async () => ({}) }));
    expect(await fetchBackup(cfg, 'g')).toBeNull();
    mockFetch(() => ({ ok: true, json: async () => ({}) }));
    expect(await fetchBackup(cfg, 'g')).toBeNull();
  });

  it('מחזיר null בשגיאת רשת (לא מפיל את המשחק)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    expect(await fetchBackup(cfg, 'g')).toBeNull();
  });
});

describe('saveBackup', () => {
  it('POST עם האובייקטים ממורים ל-JSON ו-completed=false', async () => {
    const fn = mockFetch(() => ({ ok: true }));
    const payload: BackupPayload = {
      users: { a: { name: 'א', score: 5, groupId: 'g1', numAnswers: 1, numCorrect: 1, details: { lastQue: 1, lastVote: 2 } } },
      questions: { '1': { queId: 1, type: 'trivia', display: true, numVotes: 1, correctVotes: 1, answers: { '2': 1 } } },
      groups: [{ id: 'g1', name: 'א', score: 5, memberIds: ['a'] }],
      meta: { currentQueId: 1, phase: 'results', startedAt: 111 },
    };
    await saveBackup(cfg, 'game7', payload);
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe('http://x/functions/v1/save-backup');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
    expect(body.id).toBe('game7');
    expect(body.completed).toBe(false);
    // חובה מחרוזות JSON, לא אובייקטים
    expect(typeof body.users).toBe('string');
    expect(typeof body.questions).toBe('string');
    expect(typeof body.groups).toBe('string');
    expect(JSON.parse(body.users as string).a.score).toBe(5);
    // מטא גם כשדות שורש (המלצת המסמך) לשחזור מיקום/שלב
    expect(body.currentQueId).toBe(1);
    expect(body.phase).toBe('results');
    expect(body.startedAt).toBe(111);
  });

  it('זורק כשה-POST נכשל', async () => {
    mockFetch(() => ({ ok: false, status: 500 }));
    await expect(
      saveBackup(cfg, 'g', { users: {}, questions: {}, groups: [], meta: { currentQueId: null, phase: 'showing', startedAt: 0 } }),
    ).rejects.toThrow();
  });
});

describe('resolveBackupConfig', () => {
  it('מחזיר null באופליין / בלי id / בדמו / בלי קוד חדר', () => {
    const b = { hasRoom: true, crowdEnabled: false, backupUrlOverride: null };
    expect(resolveBackupConfig({ ...b, offline: true, gameId: 'g' })).toBeNull();
    expect(resolveBackupConfig({ ...b, offline: false, gameId: '' })).toBeNull();
    expect(resolveBackupConfig({ ...b, offline: false, gameId: 'g', crowdEnabled: true })).toBeNull();
    expect(resolveBackupConfig({ ...b, offline: false, gameId: 'g', hasRoom: false })).toBeNull();
  });

  it('משחק אונליין מורשה → קונפיג ברירת המחדל; ‎?backupUrl=‎ דורס את הכתובת', () => {
    expect(
      resolveBackupConfig({ offline: false, gameId: 'g', hasRoom: true, crowdEnabled: false, backupUrlOverride: null }),
    ).toEqual(DEFAULT_BACKUP_CONFIG);
    const override = resolveBackupConfig({
      offline: false,
      gameId: 'g',
      hasRoom: false, // גם בלי קוד חדר — עקיפת כתובת מפעילה גיבוי (לבדיקות)
      crowdEnabled: true,
      backupUrlOverride: 'http://local/functions/v1',
    });
    expect(override).toEqual({ baseUrl: 'http://local/functions/v1', anonKey: DEFAULT_BACKUP_CONFIG.anonKey });
  });
});

describe('prefetchBackup + getBackup', () => {
  it('getBackup מוסר את תוצאת ה-prefetch בלי בקשה נוספת (מסירה חד-פעמית)', async () => {
    const fn = mockFetch(() => ({ ok: true, json: async () => ({ id: 'pf1', currentQueId: 2, phase: 'voting' }) }));
    prefetchBackup(cfg, 'pf1');
    expect(fn).toHaveBeenCalledTimes(1); // הבקשה יצאה כבר ב-prefetch
    const data = await getBackup(cfg, 'pf1');
    expect(fn).toHaveBeenCalledTimes(1); // getBackup לא כפל בקשה
    expect(data?.meta.currentQueId).toBe(2);
  });

  it('prefetch כפול לאותו משחק אינו כופל בקשה', () => {
    const fn = mockFetch(() => ({ ok: true, json: async () => ({}) }));
    prefetchBackup(cfg, 'pf2');
    prefetchBackup(cfg, 'pf2');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('getBackup בלי prefetch שולף טרי; ואחרי מסירה — הקריאה הבאה שולפת שוב', async () => {
    const fn = mockFetch(() => ({ ok: true, json: async () => ({ id: 'pf3', currentQueId: 1, phase: 'showing' }) }));
    await getBackup(cfg, 'pf3'); // אין prefetch → בקשה טרייה
    expect(fn).toHaveBeenCalledTimes(1);
    prefetchBackup(cfg, 'pf3');
    await getBackup(cfg, 'pf3'); // מוסר את ה-prefetch (בקשה אחת נוספת בלבד)
    expect(fn).toHaveBeenCalledTimes(2);
    await getBackup(cfg, 'pf3'); // המסירה כבר נוצלה → שליפה טרייה נוספת
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('endGame', () => {
  it('POST ל-/game-over עם ה-id', async () => {
    const fn = mockFetch(() => ({ ok: true }));
    await endGame(cfg, 'game7');
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe('http://x/functions/v1/save-backup/game-over');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ id: 'game7' });
  });
});
