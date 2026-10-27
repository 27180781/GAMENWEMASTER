/**
 * תור התוצאות למערכת (electron/resultUpload.cjs): מה נכנס לתור, מה נמחק אחרי
 * שליחה, ומה נשאר לסבב הבא. הרשת מדומה.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
type PostResult = { status: number; body: unknown };
type Post = (body: Record<string, unknown>) => Promise<PostResult>;
const ru = require('../electron/resultUpload.cjs') as {
  enqueueResult: (userData: string, raw: unknown) => boolean;
  flushResults: (deps: { userData: string; post: Post }) => Promise<{ sent: number; kept: number; dropped: number; offline: boolean }>;
  pendingCount: (userData: string) => number;
  MAX_PER_FLUSH: number;
};

const GAME = '0f8e4c7a-1b2c-4d3e-9f00-112233445566';
const entry = (runId = 'exe-1700000000000', gameId = GAME) => ({
  gameId,
  runId,
  startedAt: 1700000000000,
  endedAt: 1700000900000,
  gameState: { users: { '7': { name: 'דנה', score: 3 } }, questions: {}, groups: [], meta: { phase: 'ended' } },
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'results-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('enqueueResult', () => {
  it('כותב הפעלה לתור', () => {
    expect(ru.enqueueResult(dir, entry())).toBe(true);
    expect(ru.pendingCount(dir)).toBe(1);
  });

  it('אותה הפעלה פעמיים היא קובץ אחד', () => {
    ru.enqueueResult(dir, entry());
    ru.enqueueResult(dir, entry());
    expect(ru.pendingCount(dir)).toBe(1);
  });

  it('משחק בלי מזהה במערכת (נבנה במחשב) לא נכנס', () => {
    expect(ru.enqueueResult(dir, entry('exe-1', ''))).toBe(false);
    expect(ru.enqueueResult(dir, entry('exe-1', 'local-game'))).toBe(false);
    expect(ru.enqueueResult(dir, { ...entry(), gameState: null })).toBe(false);
    expect(ru.enqueueResult(dir, entry('../../etc'))).toBe(false);
    expect(ru.pendingCount(dir)).toBe(0);
  });
});

describe('flushResults', () => {
  it('שולח את מה שבתור ומוחק אחרי הצלחה', async () => {
    ru.enqueueResult(dir, entry());
    const sent: Record<string, unknown>[] = [];
    const res = await ru.flushResults({
      userData: dir,
      post: async (body) => {
        sent.push(body);
        return { status: 200, body: { success: true } };
      },
    });
    expect(res).toMatchObject({ sent: 1, kept: 0, dropped: 0 });
    expect(sent[0]).toMatchObject({ gameId: GAME, runId: 'exe-1700000000000', endedAt: 1700000900000 });
    expect(ru.pendingCount(dir)).toBe(0);
  });

  it('הפעלה שכבר נשמרה (already) נמחקת גם היא', async () => {
    ru.enqueueResult(dir, entry());
    await ru.flushResults({ userData: dir, post: async () => ({ status: 200, body: { success: true, already: true } }) });
    expect(ru.pendingCount(dir)).toBe(0);
  });

  it('בלי רשת: הכול נשאר, והסבב נעצר אחרי הכישלון הראשון', async () => {
    ru.enqueueResult(dir, entry('exe-1'));
    ru.enqueueResult(dir, entry('exe-2'));
    let calls = 0;
    const res = await ru.flushResults({
      userData: dir,
      post: async () => {
        calls += 1;
        throw new Error('net::ERR_INTERNET_DISCONNECTED');
      },
    });
    expect(calls).toBe(1);
    expect(res).toMatchObject({ sent: 0, kept: 2, offline: true });
    expect(ru.pendingCount(dir)).toBe(2);
  });

  it('תקלה בשרת או שרת שעוד לא מכיר את הפונקציה: נשאר בתור', async () => {
    ru.enqueueResult(dir, entry());
    await ru.flushResults({ userData: dir, post: async () => ({ status: 503, body: { success: false, code: 'not_ready' } }) });
    await ru.flushResults({ userData: dir, post: async () => ({ status: 404, body: { message: 'Requested function was not found' } }) });
    await ru.flushResults({ userData: dir, post: async () => ({ status: 500, body: null }) });
    expect(ru.pendingCount(dir)).toBe(1);
  });

  it('סירוב סופי של הפונקציה עובר ל-failed ולא נשלח שוב', async () => {
    ru.enqueueResult(dir, entry());
    const res = await ru.flushResults({
      userData: dir,
      post: async () => ({ status: 404, body: { success: false, code: 'game_not_found' } }),
    });
    expect(res.dropped).toBe(1);
    expect(ru.pendingCount(dir)).toBe(0);
    expect(existsSync(join(dir, 'results-outbox', 'failed'))).toBe(true);
    expect(readdirSync(join(dir, 'results-outbox', 'failed'))).toHaveLength(1);
  });

  it(`שולח עד ${'MAX_PER_FLUSH'} בכל סבב`, async () => {
    for (let i = 0; i < ru.MAX_PER_FLUSH + 3; i += 1) ru.enqueueResult(dir, entry(`exe-${i}`));
    const res = await ru.flushResults({ userData: dir, post: async () => ({ status: 200, body: { success: true } }) });
    expect(res.sent).toBe(ru.MAX_PER_FLUSH);
    expect(ru.pendingCount(dir)).toBe(3);
  });
});
