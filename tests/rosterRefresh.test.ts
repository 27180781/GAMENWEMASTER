/**
 * רענון השמות באמצע הפעלה אונליין: מתי מצביע מהטלפון מבקש משיכה חוזרת של
 * הקובץ, איך בקשות מתאחדות, ושהמיזוג של שמות שנוספו אחרי הטעינה ממלא את המרשם
 * בלי לגעת במה שהמפעיל עשה (המשחק «בחירות», 2026-10-25).
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_ROSTER,
  displayName,
  playerGroupNames,
  syncRosterWithFile,
  upsertPlayer,
  type RosterData,
} from '../src/app/roster.ts';
import { createRefreshScheduler, shouldRefreshForVoter } from '../src/app/rosterRefresh.ts';

const users = (list: Array<[string, string, string]>) =>
  JSON.stringify(
    Object.fromEntries(
      list.map(([phone, name, groupName], i) => [
        phone,
        { remoteId: phone, name, groupName, participantId: `p-${i}` },
      ]),
    ),
  );

describe('shouldRefreshForVoter', () => {
  const roster = upsertPlayer({ ...EMPTY_ROSTER }, '0501111111', 'דנה');

  it('מספר בלי שם במרשם ובלי שם מהשרת — כן', () => {
    expect(shouldRefreshForVoter(roster, '0502222222', undefined, new Set())).toBe(true);
    expect(shouldRefreshForVoter(roster, ' 0502222222 ', '', new Set())).toBe(true);
    expect(shouldRefreshForVoter(roster, '0502222222', '0502222222', new Set())).toBe(true);
  });

  it('מספר שכבר יש לו שם — לא', () => {
    expect(shouldRefreshForVoter(roster, '0501111111', undefined, new Set())).toBe(false);
  });

  it('מצביע מקישור עם שם מהשרת — לא', () => {
    expect(shouldRefreshForVoter(roster, 'מיכל', 'מיכל', new Set())).toBe(false);
  });

  it('כל מזהה מבקש פעם אחת בלבד', () => {
    expect(shouldRefreshForVoter(roster, '0502222222', undefined, new Set(['0502222222']))).toBe(false);
  });

  it('מזהה ריק — לא', () => {
    expect(shouldRefreshForVoter(roster, '  ', undefined, new Set())).toBe(false);
  });
});

/** שעון ידני: טיימרים רצים רק כשמקדמים את הזמן. */
function manualClock() {
  let now = 0;
  let timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let seq = 0;
  return {
    now: () => now,
    setTimeout: (fn: () => void, ms: number) => {
      seq += 1;
      timers.push({ at: now + ms, fn, id: seq });
      return seq;
    },
    clearTimeout: (h: unknown) => {
      timers = timers.filter((t) => t.id !== h);
    },
    advance(ms: number) {
      now += ms;
      const due = timers.filter((t) => t.at <= now);
      timers = timers.filter((t) => t.at > now);
      for (const t of due) t.fn();
    },
    pending: () => timers.length,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createRefreshScheduler', () => {
  it('בקשה ראשונה רצה מיד; בקשות בזמן ריצה מתאחדות לריצה אחת אחרי המרווח', async () => {
    const clock = manualClock();
    let runs = 0;
    let release: () => void = () => undefined;
    const s = createRefreshScheduler(
      () =>
        new Promise<void>((r) => {
          runs += 1;
          release = r;
        }),
      10_000,
      clock,
    );
    s.request();
    expect(runs).toBe(1);
    s.request();
    s.request();
    s.request();
    expect(runs).toBe(1);
    clock.advance(2_000);
    release();
    await flush();
    // עדיין בתוך המרווח — ממתינה ריצה אחת
    expect(runs).toBe(1);
    expect(clock.pending()).toBe(1);
    clock.advance(8_000);
    expect(runs).toBe(2);
    release();
    await flush();
    expect(clock.pending()).toBe(0);
  });

  it('אחרי המרווח בקשה רצה מיד', async () => {
    const clock = manualClock();
    let runs = 0;
    const s = createRefreshScheduler(async () => {
      runs += 1;
    }, 10_000, clock);
    s.request();
    await flush();
    clock.advance(10_000);
    s.request();
    expect(runs).toBe(2);
  });

  it('ריצה שנכשלה לא עוצרת את הבאה', async () => {
    const clock = manualClock();
    let runs = 0;
    const s = createRefreshScheduler(async () => {
      runs += 1;
      throw new Error('רשת');
    }, 1_000, clock);
    s.request();
    await flush();
    clock.advance(1_000);
    s.request();
    await flush();
    expect(runs).toBe(2);
  });

  it('dispose מבטל ריצה ממתינה וחוסם בקשות חדשות', async () => {
    const clock = manualClock();
    let runs = 0;
    const s = createRefreshScheduler(async () => {
      runs += 1;
    }, 10_000, clock);
    s.request();
    await flush();
    s.request();
    expect(clock.pending()).toBe(1);
    s.dispose();
    expect(clock.pending()).toBe(0);
    s.request();
    clock.advance(20_000);
    expect(runs).toBe(1);
  });
});

describe('מיזוג שמות שנוספו אחרי הטעינה', () => {
  const NAME = 'בחירות';
  const lateUsers = users([
    ['0504107086', 'אוריה', 'י'],
    ['0527195912', 'המורה אתי', 'מורות'],
  ]);

  it('מרשם ריק (הקובץ נטען לפני הייבוא) מקבל את השמות והקבוצות', () => {
    // הטעינה הראשונה: הקובץ עוד בלי משתתפים — אין מה לשמור
    expect(syncRosterWithFile({ ...EMPTY_ROSTER }, { name: NAME, users: '{}', pendingUsers: [] }, null, false)).toBe(
      null,
    );
    const res = syncRosterWithFile({ ...EMPTY_ROSTER }, { name: NAME, users: lateUsers, pendingUsers: [] }, null, false);
    expect(res).not.toBe(null);
    const r = res!.roster;
    expect(displayName(r, '0504107086')).toBe('אוריה');
    expect(displayName(r, '0527195912')).toBe('המורה אתי');
    expect(playerGroupNames(r, '0504107086')).toEqual(['י']);
  });

  it('שם שהמפעיל הוסיף בעצמו ושיוך מקומי נשמרים; מיזוג חוזר לא משנה כלום', () => {
    let local: RosterData = upsertPlayer({ ...EMPTY_ROSTER }, '0509999999', 'אורחת');
    const first = syncRosterWithFile(local, { name: NAME, users: lateUsers, pendingUsers: [] }, null, false)!;
    local = first.roster;
    expect(displayName(local, '0509999999')).toBe('אורחת');
    const again = syncRosterWithFile(local, { name: NAME, users: lateUsers, pendingUsers: [] }, first.source, false)!;
    expect(JSON.stringify(again.roster)).toBe(JSON.stringify(local));
  });
});
