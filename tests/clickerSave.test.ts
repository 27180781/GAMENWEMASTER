/**
 * שמירת מספרי השלטים שנקלטו בלחיצה חזרה בבונה (save-clicker-numbers).
 *
 * מה שנבדק כאן הוא ההבטחה ללקוח: מספר שנקלט נשלח פעם אחת, מחשב בלי אינטרנט
 * ממשיך לנסות לבד בלי להציף את השרת, תשובה של השרת נשמרת ולא נשלחת שוב, ושורת
 * המצב במרשם אומרת את האמת.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ClickerSaver,
  RETRY_DELAYS_MS,
  SAVE_BATCH,
  assignmentsToSend,
  clickerSaveLines,
  isClickerNumber,
  loadSettled,
  normalizeSettled,
  parseSaveResponse,
  postClickerNumbers,
  saveSettled,
  settledStorageKey,
  summarizeClickerSave,
  type ClickerAssignment,
  type ClickerSaveView,
  type SendOutcome,
  type SettledMap,
} from '../src/app/clickerSave.ts';
import {
  addReleases,
  releaseKey,
  type ReleaseMap,
  type ReleaseOutcome,
  type ReleaseStatus,
} from '../src/app/clickerRelease.ts';
import {
  EMPTY_ROSTER,
  type GamePendingUser,
  type Player,
  type ReleasedClicker,
  type RosterData,
} from '../src/app/roster.ts';

function rosterOf(players: Player[]): RosterData {
  return { ...EMPTY_ROSTER, players };
}

const pending: GamePendingUser[] = [
  { id: 'p-avi', name: 'אבי', groupName: '' },
  { id: 'p-dana', name: 'דנה', groupName: 'כחולים' },
  { id: 'p-yosi', name: 'יוסי', groupName: '' },
];

describe('isClickerNumber', () => {
  it('מספרי שלט 1–9999 בלבד', () => {
    for (const ok of ['1', '7', '9999', '120']) expect(isClickerNumber(ok)).toBe(true);
    for (const bad of ['', '0', '01', '10000', '0501234567', 'abc', '12a', ' 5']) {
      expect(isClickerNumber(bad)).toBe(false);
    }
  });
});

describe('assignmentsToSend', () => {
  it('שולח רק שלט שנקשר למשתתף שהבונה עדיין מחכה לו', () => {
    const roster = rosterOf([
      { id: '7', name: 'אבי', participantId: 'p-avi' },
      { id: '8', name: 'שם שהוקלד כאן' }, // בלי מזהה משתתף
      { id: '9', name: 'רחל', participantId: 'p-rachel' }, // כבר לא ממתינה בבונה
      { id: '0501234567', name: 'דנה', participantId: 'p-dana' }, // לא מספר שלט
    ]);
    expect(assignmentsToSend(roster, pending, {})).toEqual([{ participantId: 'p-avi', clickerId: '7' }]);
  });

  it('תשובה שכבר התקבלה לאותו מספר לא נשלחת שוב; שלט אחר לאותו משתתף כן', () => {
    const roster = rosterOf([
      { id: '7', name: 'אבי', participantId: 'p-avi' },
      { id: '12', name: 'דנה', participantId: 'p-dana' },
    ]);
    const settled: SettledMap = {
      'p-avi': { clickerId: '7', status: 'saved' },
      'p-dana': { clickerId: '11', status: 'taken' },
    };
    expect(assignmentsToSend(roster, pending, settled)).toEqual([{ participantId: 'p-dana', clickerId: '12' }]);
  });

  it('אותו משתתף פעמיים במרשם — נשלח פעם אחת', () => {
    const roster = rosterOf([
      { id: '7', name: 'אבי', participantId: 'p-avi' },
      { id: '8', name: 'אבי', participantId: 'p-avi' },
    ]);
    expect(assignmentsToSend(roster, pending, {})).toEqual([{ participantId: 'p-avi', clickerId: '7' }]);
  });

  it('משתתף בלי מזהה בקובץ אינו "ממתין"', () => {
    const roster = rosterOf([{ id: '7', name: 'אבי', participantId: '' }]);
    expect(assignmentsToSend(roster, [{ id: '', name: 'אבי', groupName: '' }], {})).toEqual([]);
  });
});

describe('summarizeClickerSave', () => {
  it('סופר שמורים, ממתינים וסירובים', () => {
    const roster = rosterOf([
      { id: '7', name: 'אבי', participantId: 'p-avi' }, // נשמר
      { id: '8', name: 'דנה', participantId: 'p-dana' }, // ממתין
      { id: '9', name: 'יוסי', participantId: 'p-yosi' }, // נדחה
      { id: '10', name: 'שם שהוקלד כאן' },
    ]);
    const settled: SettledMap = {
      'p-avi': { clickerId: '7', status: 'already' },
      'p-yosi': { clickerId: '9', status: 'has_number' },
    };
    expect(summarizeClickerSave(roster, pending, settled)).toEqual({
      saved: 1,
      waiting: 1,
      rejected: 1,
      noLicense: false,
    });
  });

  it('משתתף שהמספר שלו נשמר ועבר ל-users עדיין נספר כשמור', () => {
    const roster = rosterOf([{ id: '7', name: 'אבי', participantId: 'p-avi' }]);
    const settled: SettledMap = { 'p-avi': { clickerId: '7', status: 'saved' } };
    expect(summarizeClickerSave(roster, [], settled).saved).toBe(1);
  });

  it('אין רישיון — מסומן', () => {
    const roster = rosterOf([{ id: '7', name: 'אבי', participantId: 'p-avi' }]);
    const settled: SettledMap = { 'p-avi': { clickerId: '7', status: 'no_license' } };
    expect(summarizeClickerSave(roster, pending, settled)).toMatchObject({ rejected: 1, noLicense: true });
  });

  it('תשובה ישנה על שלט אחר — השיוך החדש ממתין', () => {
    const roster = rosterOf([{ id: '8', name: 'אבי', participantId: 'p-avi' }]);
    const settled: SettledMap = { 'p-avi': { clickerId: '7', status: 'saved' } };
    expect(summarizeClickerSave(roster, pending, settled)).toMatchObject({ saved: 0, waiting: 1 });
  });
});

describe('parseSaveResponse', () => {
  const sent: ClickerAssignment[] = [
    { participantId: 'p-avi', clickerId: '7' },
    { participantId: 'p-dana', clickerId: '8' },
  ];

  it('200 — תשובה לכל שיוך, עם המספר שנשלח', () => {
    const out = parseSaveResponse(
      200,
      {
        ok: true,
        results: [
          { participantId: 'p-avi', clickerId: '7', status: 'saved' },
          { participantId: 'p-dana', clickerId: '999', status: 'taken' },
          { participantId: 'p-ghost', clickerId: '5', status: 'saved' }, // לא נשלח
          { participantId: 'p-avi', status: 'bogus' }, // סטטוס לא מוכר
          null,
        ],
      },
      sent,
    );
    expect(out).toEqual({
      kind: 'answered',
      settled: {
        'p-avi': { clickerId: '7', status: 'saved' },
        'p-dana': { clickerId: '8', status: 'taken' },
      },
    });
  });

  it('403 / 404 / 400 עם השגיאה שלנו חלים על כל הבקשה', () => {
    const every = (status: string) => ({
      kind: 'answered',
      settled: {
        'p-avi': { clickerId: '7', status },
        'p-dana': { clickerId: '8', status },
      },
    });
    expect(parseSaveResponse(403, { error: 'no_license' }, sent)).toEqual(every('no_license'));
    expect(parseSaveResponse(404, { error: 'game_not_found' }, sent)).toEqual(every('game_not_found'));
    expect(parseSaveResponse(400, { error: 'invalid_request' }, sent)).toEqual(every('invalid'));
  });

  it('כל השאר = לנסות שוב (כולל 404 של השער כשהפונקציה עוד לא עלתה)', () => {
    expect(parseSaveResponse(404, { code: 'NOT_FOUND', message: 'Requested function was not found' }, sent).kind).toBe(
      'retry',
    );
    expect(parseSaveResponse(500, { error: 'internal' }, sent).kind).toBe('retry');
    expect(parseSaveResponse(503, null, sent).kind).toBe('retry');
    expect(parseSaveResponse(200, { ok: true }, sent).kind).toBe('retry');
    expect(parseSaveResponse(403, null, sent).kind).toBe('retry');
  });
});

describe('postClickerNumbers', () => {
  const cfg = { baseUrl: 'https://example.supabase.co/functions/v1', anonKey: 'anon-key' };
  const assignments: ClickerAssignment[] = [{ participantId: 'p-avi', clickerId: '7' }];

  it('שולח POST עם המפתח הציבורי ומפענח את התשובה', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, results: [{ participantId: 'p-avi', clickerId: '7', status: 'saved' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const out = await postClickerNumbers(cfg, 'game-1', assignments, fetchFn as unknown as typeof fetch);
    expect(out).toEqual({ kind: 'answered', settled: { 'p-avi': { clickerId: '7', status: 'saved' } } });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.supabase.co/functions/v1/save-clicker-numbers');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ apikey: 'anon-key', Authorization: 'Bearer anon-key' });
    expect(JSON.parse(String(init.body))).toEqual({ gameId: 'game-1', assignments });
  });

  it('תקלת רשת לא זורקת — לנסות שוב', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const out = await postClickerNumbers(cfg, 'game-1', assignments, fetchFn as unknown as typeof fetch);
    expect(out).toEqual({ kind: 'retry', reason: 'Failed to fetch' });
  });

  it('תשובה שאינה JSON — לנסות שוב', async () => {
    const fetchFn = vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 }));
    const out = await postClickerNumbers(cfg, 'game-1', assignments, fetchFn as unknown as typeof fetch);
    expect(out.kind).toBe('retry');
  });
});

describe('התשובות שנשמרו במחשב', () => {
  it('normalizeSettled זורק רשומות פגומות', () => {
    expect(normalizeSettled(null)).toEqual({});
    expect(normalizeSettled([])).toEqual({});
    expect(
      normalizeSettled({
        a: { clickerId: '7', status: 'saved' },
        b: { clickerId: 7, status: 'saved' },
        c: { clickerId: '8', status: 'nope' },
        d: 'x',
      }),
    ).toEqual({ a: { clickerId: '7', status: 'saved' } });
  });

  describe('localStorage', () => {
    let store: Map<string, string>;
    beforeEach(() => {
      store = new Map();
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      });
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('נשמר לפי משחק ונטען בחזרה', () => {
      const settled: SettledMap = { 'p-avi': { clickerId: '7', status: 'saved' } };
      saveSettled('game-1', settled);
      expect(store.has(settledStorageKey('game-1'))).toBe(true);
      expect(loadSettled('game-1')).toEqual(settled);
      expect(loadSettled('game-2')).toEqual({});
    });

    it('JSON פגום → ריק, לא זורק', () => {
      store.set(settledStorageKey('game-1'), '{not json');
      expect(loadSettled('game-1')).toEqual({});
    });
  });
});

describe('ClickerSaver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** מרשם ותשובות בזיכרון, ושרת מדומה שעונה לפי פונקציה. */
  function setup(
    players: Player[],
    answer: (batch: ClickerAssignment[]) => SendOutcome | Promise<SendOutcome>,
    pendingUsers: GamePendingUser[] = pending,
  ) {
    const state = { roster: rosterOf(players), settled: {} as SettledMap };
    const send = vi.fn(async (batch: ClickerAssignment[]) => answer(batch));
    const saver = new ClickerSaver({
      readPending: () => pendingUsers,
      readRoster: () => state.roster,
      readSettled: () => state.settled,
      writeSettled: (s) => {
        state.settled = s;
      },
      send,
    });
    return { state, send, saver };
  }

  const savedAll = (batch: ClickerAssignment[]): SendOutcome => ({
    kind: 'answered',
    settled: Object.fromEntries(batch.map((a) => [a.participantId, { clickerId: a.clickerId, status: 'saved' }])),
  });

  it('לחיצה → שליחה אחת אחרי רגע, והתשובה נשמרת', async () => {
    const { state, send, saver } = setup([{ id: '7', name: 'אבי', participantId: 'p-avi' }], savedAll);
    const seen: ClickerSaveView[] = [];
    saver.subscribe(() => seen.push(saver.view()));
    saver.nudge();
    saver.nudge(); // לחיצות צפופות לא מכפילות שליחה
    await vi.advanceTimersByTimeAsync(1499);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(state.settled).toEqual({ 'p-avi': { clickerId: '7', status: 'saved' } });
    expect(saver.view()).toMatchObject({ saved: 1, waiting: 0, sending: false, failing: false });
    expect(seen.some((v) => v.sending)).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('אין מה לשלוח — אין בקשה', async () => {
    const { send, saver } = setup([{ id: '8', name: 'שם שהוקלד כאן' }], savedAll);
    saver.nudge();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).not.toHaveBeenCalled();
  });

  it('בלי רשת: מחכה לפי הסדר 15 שנ׳, 30 שנ׳, דקה… ולחיצות בינתיים לא שולחות', async () => {
    let online = false;
    const { send, saver } = setup([{ id: '7', name: 'אבי', participantId: 'p-avi' }], (batch) =>
      online ? savedAll(batch) : { kind: 'retry', reason: 'Failed to fetch' },
    );
    saver.nudge();
    await vi.advanceTimersByTimeAsync(1500);
    expect(send).toHaveBeenCalledTimes(1);
    expect(saver.view()).toMatchObject({ waiting: 1, failing: true });

    saver.nudge(); // לחיצה נוספת בזמן ההמתנה
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0] - 1);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[1]);
    expect(send).toHaveBeenCalledTimes(3);

    online = true;
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[2]);
    expect(send).toHaveBeenCalledTimes(4);
    expect(saver.view()).toMatchObject({ saved: 1, waiting: 0, failing: false });
  });

  it('ההמתנה נעצרת על 10 דקות', async () => {
    const { send, saver } = setup([{ id: '7', name: 'אבי', participantId: 'p-avi' }], () => ({
      kind: 'retry',
      reason: 'offline',
    }));
    saver.nudge(0);
    await vi.advanceTimersByTimeAsync(0);
    for (const delay of RETRY_DELAYS_MS) await vi.advanceTimersByTimeAsync(delay);
    const calls = send.mock.calls.length;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(send.mock.calls.length).toBe(calls + 1);
  });

  it('הרשת חזרה (retryNow) — מנסים מיד, גם באמצע המתנה', async () => {
    let online = false;
    const { send, saver } = setup([{ id: '7', name: 'אבי', participantId: 'p-avi' }], (batch) =>
      online ? savedAll(batch) : { kind: 'retry', reason: 'offline' },
    );
    saver.nudge(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(saver.view().failing).toBe(true);
    online = true;
    saver.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(2);
    expect(saver.view()).toMatchObject({ saved: 1, failing: false });
  });

  it('תשובה שדילגה על שיוך נחשבת כישלון (בלי לולאה צפופה)', async () => {
    const { send, saver } = setup([{ id: '7', name: 'אבי', participantId: 'p-avi' }], () => ({
      kind: 'answered',
      settled: {},
    }));
    saver.nudge(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0] - 1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(saver.view().failing).toBe(true);
  });

  it('סירוב של השרת נשמר ולא נשלח שוב', async () => {
    const { state, send, saver } = setup([{ id: '7', name: 'אבי', participantId: 'p-avi' }], (batch) => ({
      kind: 'answered',
      settled: Object.fromEntries(batch.map((a) => [a.participantId, { clickerId: a.clickerId, status: 'taken' }])),
    }));
    saver.nudge(0);
    await vi.advanceTimersByTimeAsync(0);
    saver.nudge();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(state.settled['p-avi']?.status).toBe('taken');
    expect(saver.view()).toMatchObject({ rejected: 1, waiting: 0, failing: false });
  });

  it(`נשלח במנות של ${SAVE_BATCH}`, async () => {
    const many: GamePendingUser[] = Array.from({ length: 450 }, (_, i) => ({ id: `p${i}`, name: `שם ${i}`, groupName: '' }));
    const players: Player[] = many.map((u, i) => ({ id: String(i + 1), name: u.name, participantId: u.id }));
    const { send, saver } = setup(players, savedAll, many);
    saver.nudge(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls.map(([batch]) => batch.length)).toEqual([200, 200, 50]);
    expect(saver.view()).toMatchObject({ saved: 450, waiting: 0 });
  });

  it('לחיצה באמצע שליחה נשלחת מיד אחריה', async () => {
    let release: (() => void) | null = null;
    const { state, send, saver } = setup([{ id: '7', name: 'אבי', participantId: 'p-avi' }], (batch) => {
      if (send.mock.calls.length === 1) {
        return new Promise<SendOutcome>((resolve) => {
          release = () => resolve(savedAll(batch));
        });
      }
      return savedAll(batch);
    });
    saver.nudge(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    // בזמן שהבקשה בדרך — נלחץ שלט נוסף.
    state.roster = rosterOf([...state.roster.players, { id: '8', name: 'דנה', participantId: 'p-dana' }]);
    void saver.flush();
    release!();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0]).toEqual([{ participantId: 'p-dana', clickerId: '8' }]);
    expect(saver.view()).toMatchObject({ saved: 2, waiting: 0 });
  });

  it('stop — שום שליחה ושום כתיבה אחרי שהמשחק נסגר', async () => {
    let release: (() => void) | null = null;
    const { state, send, saver } = setup(
      [{ id: '7', name: 'אבי', participantId: 'p-avi' }],
      (batch) =>
        new Promise<SendOutcome>((resolve) => {
          release = () => resolve(savedAll(batch));
        }),
    );
    saver.nudge(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    saver.stop();
    release!();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.settled).toEqual({});
    saver.nudge();
    saver.retryNow();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('ClickerSaver — מחיקות של «שיוך מחדש»', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** כמו setup למעלה, עם מחיקות ממתינות ושרת מדומה לשתי הבקשות. */
  function setupWithReleases(
    players: Player[],
    releases: ReleasedClicker[],
    answerRelease: (batch: ReleasedClicker[]) => ReleaseOutcome | Promise<ReleaseOutcome>,
    settled: SettledMap = {},
  ) {
    const state = { roster: rosterOf(players), settled, releases: addReleases({}, releases) as ReleaseMap };
    const order: string[] = [];
    const send = vi.fn(async (batch: ClickerAssignment[]): Promise<SendOutcome> => {
      order.push('save');
      return {
        kind: 'answered',
        settled: Object.fromEntries(batch.map((a) => [a.participantId, { clickerId: a.clickerId, status: 'saved' }])),
      };
    });
    const sendReleases = vi.fn(async (batch: ReleasedClicker[]) => {
      order.push('release');
      return answerRelease(batch);
    });
    const saver = new ClickerSaver({
      readPending: () => pending,
      readRoster: () => state.roster,
      readSettled: () => state.settled,
      writeSettled: (next) => {
        state.settled = next;
      },
      send,
      readReleases: () => state.releases,
      writeReleases: (map) => {
        state.releases = map;
      },
      sendReleases,
    });
    return { state, send, sendReleases, saver, order };
  }

  const answerAll =
    (status: ReleaseStatus) =>
    (batch: ReleasedClicker[]): ReleaseOutcome => ({
      kind: 'answered',
      answers: batch.map((e) => ({ ...e, status })),
    });

  it('קודם המחיקות, ורק אחריהן השיוכים החדשים — גם כשזה אותו שלט שנשמר קודם', async () => {
    // אבי היה על 7, «שיוך מחדש», ונלחץ שוב 7 לאבי: התשובה הישנה נשכחת עם המחיקה
    const { state, send, sendReleases, saver, order } = setupWithReleases(
      [{ id: '7', name: 'אבי', participantId: 'p-avi' }],
      [{ participantId: 'p-avi', clickerId: '7' }],
      answerAll('released'),
      { 'p-avi': { clickerId: '7', status: 'saved' } },
    );
    expect(saver.view().releases).toEqual({ releasing: 1, kept: 0, noLicense: 0 });
    saver.nudge(0);
    // השיוכים יוצאים מיד אחרי המחיקות, לא אחרי ההמתנה הרגילה של 1.5 שנ׳
    // (טיימר של 0 שנקבע בתוך טיימר מדומה נורה אחרי מילישנייה).
    await vi.advanceTimersByTimeAsync(10);
    expect(order).toEqual(['release', 'save']);
    expect(sendReleases.mock.calls[0]![0]).toEqual([{ participantId: 'p-avi', clickerId: '7' }]);
    expect(send.mock.calls[0]![0]).toEqual([{ participantId: 'p-avi', clickerId: '7' }]);
    expect(state.releases[releaseKey('p-avi', '7')]?.status).toBe('released');
    expect(state.settled['p-avi']).toEqual({ clickerId: '7', status: 'saved' });
    expect(saver.view()).toMatchObject({ saved: 1, waiting: 0, releases: { releasing: 0 } });
  });

  it('מחיקה שנכשלה (אין רשת, שרת ישן) עוצרת גם את השיוכים, וננסה שוב לפי הסדר', async () => {
    let online = false;
    const { send, sendReleases, saver } = setupWithReleases(
      [{ id: '8', name: 'דנה', participantId: 'p-dana' }],
      [{ participantId: 'p-avi', clickerId: '8' }],
      (batch) => (online ? answerAll('released')(batch) : { kind: 'retry', reason: 'HTTP 400' }),
    );
    saver.nudge(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(sendReleases).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    expect(saver.view()).toMatchObject({ failing: true, waiting: 1, releases: { releasing: 1 } });
    online = true;
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
    await vi.advanceTimersByTimeAsync(10);
    expect(sendReleases).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(1);
    expect(saver.view()).toMatchObject({ failing: false, saved: 1, releases: { releasing: 0 } });
  });

  it('kept ו-no_license נרשמים ולא נשלחים שוב; התשובה הקודמת על המשתתף נשארת', async () => {
    const { state, sendReleases, saver } = setupWithReleases(
      [],
      [
        { participantId: 'p-avi', clickerId: '7' },
        { participantId: 'p-dana', clickerId: '8' },
      ],
      (batch) => ({
        kind: 'answered',
        answers: batch.map((e) => ({ ...e, status: e.participantId === 'p-avi' ? 'kept' : 'no_license' })),
      }),
      { 'p-avi': { clickerId: '7', status: 'saved' } },
    );
    saver.nudge(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendReleases).toHaveBeenCalledTimes(1);
    expect(saver.view().releases).toEqual({ releasing: 0, kept: 1, noLicense: 1 });
    expect(state.settled['p-avi']).toEqual({ clickerId: '7', status: 'saved' });
  });

  it('תשובה על מחיקה שכבר לא ממתינה לא דורסת את מה שנרשם בינתיים', async () => {
    let finish: (() => void) | null = null;
    const { state, saver } = setupWithReleases([], [{ participantId: 'p-avi', clickerId: '7' }], (batch) =>
      new Promise<ReleaseOutcome>((resolve) => {
        finish = () => resolve(answerAll('released')(batch));
      }),
    );
    saver.nudge(0);
    await vi.advanceTimersByTimeAsync(0);
    // בזמן שהבקשה בדרך — טעינת קובץ ניקתה את הרשומה
    state.releases = {};
    finish!();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.releases).toEqual({});
  });

  it('בלי מחיקות שמורות — בדיוק כמו קודם', async () => {
    const { order, saver } = setupWithReleases([{ id: '7', name: 'אבי', participantId: 'p-avi' }], [], answerAll('released'));
    saver.nudge(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['save']);
  });
});

describe('clickerSaveLines', () => {
  const base: ClickerSaveView = {
    saved: 0,
    waiting: 0,
    rejected: 0,
    noLicense: false,
    sending: false,
    failing: false,
    releases: { releasing: 0, kept: 0, noLicense: 0 },
  };

  it('אין מה להציג', () => {
    expect(clickerSaveLines(null)).toEqual([]);
    expect(clickerSaveLines(base)).toEqual([]);
  });

  it('שומר / ממתין לרשת / נשמר', () => {
    expect(clickerSaveLines({ ...base, waiting: 1 })).toEqual([{ tone: 'wait', text: '⏳ שומר במערכת מספר שלט אחד…' }]);
    const offline = clickerSaveLines({ ...base, waiting: 3, failing: true });
    expect(offline).toHaveLength(1);
    expect(offline[0]!.tone).toBe('wait');
    expect(offline[0]!.text).toContain('3 מספרי שלטים');
    expect(offline[0]!.text).toContain('אין חיבור');
    const done = clickerSaveLines({ ...base, saved: 12 });
    expect(done).toEqual([{ tone: 'ok', text: expect.stringContaining('12 מספרי שלטים נשמרו במערכת') }]);
  });

  it('ממתינים גוברים על "נשמרו", וסירובים מוצגים בנפרד', () => {
    const lines = clickerSaveLines({ ...base, saved: 5, waiting: 2, rejected: 1 });
    expect(lines.map((l) => l.tone)).toEqual(['wait', 'warn']);
    expect(lines[1]!.text).toContain('מספר שלט אחד לא נשמר');
  });

  it('אין רישיון — נוסח משלו', () => {
    const lines = clickerSaveLines({ ...base, rejected: 2, noLicense: true });
    expect(lines).toEqual([{ tone: 'warn', text: expect.stringContaining('אין למשחק רישיון קליקרים בתוקף') }]);
  });

  it('«שיוך מחדש»: מחיקה ממתינה קודמת לשמירה, ומה שהבונה השאיר מוסבר', () => {
    const lines = clickerSaveLines({ ...base, waiting: 2, releases: { releasing: 3, kept: 1, noLicense: 0 } });
    expect(lines.map((l) => l.tone)).toEqual(['wait', 'warn', 'wait']);
    expect(lines[0]!.text).toBe('⏳ מוחק במערכת 3 מספרי שלטים מהשיוך הקודם…');
    expect(lines[1]!.text).toContain('מספר שלט אחד מהשיוך הקודם לא נמחק במערכת');
    const offline = clickerSaveLines({ ...base, failing: true, releases: { releasing: 1, kept: 0, noLicense: 0 } });
    expect(offline[0]!.text).toContain('אין חיבור');
    const noLicense = clickerSaveLines({ ...base, releases: { releasing: 0, kept: 0, noLicense: 2 } });
    expect(noLicense).toEqual([{ tone: 'warn', text: expect.stringContaining('אין למשחק רישיון קליקרים בתוקף') }]);
  });
});
