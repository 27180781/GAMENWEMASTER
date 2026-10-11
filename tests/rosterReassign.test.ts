/**
 * «שיוך מחדש»: השמות שקיבלו שלט בתוכנה חוזרים לתור לפי הסדר, והלחיצה הבאה
 * מתחילה שוב מהשם הראשון. מספרים שנשמרו בבונה מהלחיצות נמחקים גם שם, ועד
 * שהקובץ עצמו מראה את זה הם מוסתרים, כדי שטעינה של קובץ ישן לא תחזיר אותם.
 *
 * ההבטחה ללקוח שנבדקת כאן: איפוס באמצע חלוקה לא משאיר שום שם עם השלט הקודם
 * שלו, שלט שנמסר מחדש לאדם אחר לא חוזר לבעליו הקודם בשום טעינה של המשחק, ומספר
 * שהוקלד בבונה או כאן לא נמחק לעולם.
 */

import { describe, expect, it } from 'vitest';
import {
  addReleases,
  applyReleases,
  parseReleaseResponse,
  pruneReleases,
  releaseKey,
  releasesToSend,
  summarizeReleases,
  type ReleaseMap,
} from '../src/app/clickerRelease.ts';
import {
  EMPTY_ROSTER,
  addPendingNames,
  captureRemote,
  mergeGameUsers,
  mergePendingUsers,
  parseGameUsers,
  playerGroupNames,
  reassignRoster,
  syncRosterWithFile,
  upsertPlayer,
  usersWithoutParticipantIds,
  type GamePendingUser,
  type RosterData,
  type RosterSource,
} from '../src/app/roster.ts';

const CAT = 'ערב גיבוש';

const AVI: GamePendingUser = { id: 'p-avi', name: 'אבי', groupName: '' };
const DANA: GamePendingUser = { id: 'p-dana', name: 'דנה', groupName: 'כחולים' };
const YOSI: GamePendingUser = { id: 'p-yosi', name: 'יוסי', groupName: '' };

interface BuilderRow {
  user: GamePendingUser;
  /** מספר בבונה ('' = ממתין לשלט). */
  number: string;
  pressed?: boolean;
}

/** הקובץ שהבונה מייצר מהשורות האלה (כמו _shared/engineUsers.ts). */
function builderFile(rows: BuilderRow[]) {
  const users: Record<string, unknown> = {};
  const pendingUsers: GamePendingUser[] = [];
  for (const row of rows) {
    if (row.number === '') {
      pendingUsers.push(row.user);
      continue;
    }
    users[row.number] = {
      remoteId: row.number,
      name: row.user.name,
      ...(row.user.groupName !== '' ? { groupName: row.user.groupName } : {}),
      participantId: row.user.id,
      ...(row.pressed === true ? { pressed: true } : {}),
    };
  }
  return { name: CAT, users: JSON.stringify(users), pendingUsers };
}

/** מחשב אחד: המרשם, ממה הוא נבנה, השיוכים שבוטלו, ומה הבונה כבר אישר. */
interface Computer {
  roster: RosterData;
  source: RosterSource | null;
  releases: ReleaseMap;
  /** participantId → השלט שהבונה אישר מהמחשב הזה (clickerSave, `settled`). */
  saved: Record<string, string>;
}

const fresh = (): Computer => ({ roster: EMPTY_ROSTER, source: null, releases: {}, saved: {} });

/** טעינת קובץ, כמו mergeUsersIntoRoster ב-App.tsx. */
function load(pc: Computer, file: ReturnType<typeof builderFile>): Computer {
  const result = syncRosterWithFile(pc.roster, applyReleases(file, pc.releases), pc.source, false);
  const releases = pruneReleases(pc.releases, parseGameUsers(file.users), (p, c) => pc.saved[p] === c);
  return result === null ? { ...pc, releases } : { ...pc, roster: result.roster, source: result.source, releases };
}

/** «שיוך מחדש», כמו reassign ב-GameHost.tsx ו-release ב-useClickerSave.ts. */
function reassign(pc: Computer): Computer {
  const res = reassignRoster(pc.roster);
  const dropped = new Set(res.released.map((r) => r.clickerId));
  const source =
    pc.source === null || pc.source.remoteIds === null
      ? pc.source
      : { ...pc.source, remoteIds: pc.source.remoteIds.filter((id) => !dropped.has(id)) };
  const saved = { ...pc.saved };
  for (const r of res.released) delete saved[r.participantId];
  return { roster: res.roster, source, releases: addReleases(pc.releases, res.released), saved };
}

const press = (pc: Computer, clicker: string): Computer => ({ ...pc, roster: captureRemote(pc.roster, clicker, CAT).roster });

/** מי מחזיק כל שלט במרשם. */
const holders = (r: RosterData) => Object.fromEntries(r.players.map((p) => [p.id, p.name]));

describe('reassignRoster', () => {
  it('השמות שנקשרו בלחיצה חוזרים לראש התור לפי סדר הקשירה, והלחיצה הבאה תופסת את הראשון', () => {
    let r = addPendingNames(EMPTY_ROSTER, [
      { name: 'א', group: '' },
      { name: 'ב', group: '' },
      { name: 'ג', group: '' },
      { name: 'ד', group: '' },
    ]);
    r = captureRemote(r, '12', CAT).roster; // א
    r = captureRemote(r, '5', CAT).roster; // ב
    r = captureRemote(r, '30', CAT).roster; // ג
    const res = reassignRoster(r);
    expect(res.roster.players).toEqual([]);
    expect(res.roster.pendingNames.map((n) => n.name)).toEqual(['א', 'ב', 'ג', 'ד']);
    expect(res).toMatchObject({ returned: 3, cleared: 3, released: [] });

    const next = captureRemote(res.roster, '30', CAT);
    expect(next.name).toBe('א');
    expect(next.isNew).toBe(true);
  });

  it('מספר שהוקלד כאן, או שהגיע מהקובץ בלי סימון לחיצה, נשאר כמו שהוא', () => {
    let r = upsertPlayer(EMPTY_ROSTER, '7', 'הוקלד ידנית');
    r = mergeGameUsers(r, parseGameUsers(builderFile([{ user: AVI, number: '9' }]).users), CAT);
    r = addPendingNames(r, [{ name: 'בתור', group: '' }]);
    r = captureRemote(r, '40', CAT).roster;
    const res = reassignRoster(r);
    expect(holders(res.roster)).toEqual({ '7': 'הוקלד ידנית', '9': 'אבי' });
    expect(res.roster.pendingNames.map((n) => n.name)).toEqual(['בתור']);
    expect(res.released).toEqual([]);
  });

  it('שלטים שנלחצו בלי שם יורדים, והקבוצה חוזרת עם השם', () => {
    let r = captureRemote(EMPTY_ROSTER, '1', CAT).roster;
    r = addPendingNames(r, [{ name: 'יעל', group: 'ירושלים' }], 'עיר');
    r = captureRemote(r, '2', CAT).roster; // בלי שם
    expect(playerGroupNames(r, '1')).toEqual(['ירושלים']);
    const res = reassignRoster(r);
    expect(res).toMatchObject({ returned: 1, cleared: 2 });
    expect(res.roster.players).toEqual([]);
    expect(res.roster.memberships).toEqual({});
    expect(res.roster.pendingNames).toEqual([{ name: 'יעל', group: 'ירושלים', category: 'עיר' }]);
    // הלחיצה הבאה מחזירה את יעל לאותה קבוצה
    const again = captureRemote(res.roster, '2', CAT).roster;
    expect(playerGroupNames(again, '2')).toEqual(['ירושלים']);
  });

  it('שמות מהבונה חוזרים עם מזהה המשתתף, והשיוכים שלהם יוצאים למחיקה בבונה', () => {
    let r = mergePendingUsers(EMPTY_ROSTER, [AVI, DANA, YOSI], CAT);
    r = captureRemote(r, '3', CAT).roster; // אבי
    r = captureRemote(r, '8', CAT).roster; // דנה
    const res = reassignRoster(r);
    expect(res.roster.pendingNames).toEqual([
      { name: 'אבי', group: '', participantId: 'p-avi' },
      { name: 'דנה', group: 'כחולים', category: CAT, participantId: 'p-dana' },
      { name: 'יוסי', group: '', participantId: 'p-yosi' },
    ]);
    expect(res.released).toEqual([
      { participantId: 'p-avi', clickerId: '3' },
      { participantId: 'p-dana', clickerId: '8' },
    ]);
  });

  it('אין מה לאפס — אותו מרשם', () => {
    const r = upsertPlayer(EMPTY_ROSTER, '7', 'דנה');
    expect(reassignRoster(r).roster).toBe(r);
    expect(reassignRoster(r).cleared).toBe(0);
  });
});

describe('סימון «שיוך בלחיצה» מהקובץ', () => {
  it('מספר שנשמר בבונה מלחיצה מגיע מסומן גם למחשב אחר, ומתאפס שם', () => {
    const file = builderFile([
      { user: AVI, number: '4', pressed: true },
      { user: DANA, number: '6' }, // הוקלד בבונה
    ]);
    const r = mergeGameUsers(EMPTY_ROSTER, parseGameUsers(file.users), CAT);
    expect(r.players.find((p) => p.id === '4')?.pressed).toEqual({ group: '' });
    expect(r.players.find((p) => p.id === '6')?.pressed).toBeUndefined();
    const res = reassignRoster(r);
    expect(holders(res.roster)).toEqual({ '6': 'דנה' });
    expect(res.released).toEqual([{ participantId: 'p-avi', clickerId: '4' }]);
  });

  it('הסימון המקומי נשאר כל עוד אותו משתתף מחזיק את המספר, ונמחק כשהבונה נתן אותו למישהו אחר', () => {
    let r = mergePendingUsers(EMPTY_ROSTER, [AVI], CAT);
    r = captureRemote(r, '4', CAT).roster;
    // בונה שעוד לא שולח pressed: אותו משתתף, הסימון נשאר
    const same = mergeGameUsers(r, parseGameUsers(builderFile([{ user: AVI, number: '4' }]).users), CAT);
    expect(same.players[0]?.pressed).toEqual({ group: '' });
    // הבונה נתן את 4 לדנה (הוקלד שם)
    const other = mergeGameUsers(r, parseGameUsers(builderFile([{ user: DANA, number: '4' }]).users), CAT);
    expect(other.players[0]).toMatchObject({ id: '4', name: 'דנה', participantId: 'p-dana' });
    expect(other.players[0]?.pressed).toBeUndefined();
    // קובץ בלי מזהי משתתפים בכלל: המספר שלו
    const legacy = mergeGameUsers(r, parseGameUsers(JSON.stringify({ '4': { remoteId: '4', name: 'אבי' } })), CAT);
    expect(legacy.players[0]?.pressed).toBeUndefined();
  });

  it('pressed נכנס לטביעת האצבע הישנה כמו participantId — לא נחשב לרשימה חדשה', () => {
    const before = JSON.stringify({ '4': { remoteId: '4', name: 'אבי' } });
    const after = JSON.stringify({ '4': { remoteId: '4', name: 'אבי', participantId: 'p-avi', pressed: true } });
    expect(usersWithoutParticipantIds(after)).toBe(before);
  });
});

describe('applyReleases / pruneReleases', () => {
  const file = builderFile([
    { user: AVI, number: '4', pressed: true },
    { user: DANA, number: '6', pressed: true },
    { user: YOSI, number: '' },
  ]);

  it('שיוך שבוטל יוצא מ-users ונכנס לסוף הממתינים; בלי מה להסתיר — אותו אובייקט', () => {
    expect(applyReleases(file, {})).toBe(file);
    const map = addReleases({}, [{ participantId: 'p-avi', clickerId: '4' }]);
    const out = applyReleases(file, map);
    expect(Object.keys(JSON.parse(out.users))).toEqual(['6']);
    expect(out.pendingUsers).toEqual([YOSI, { id: 'p-avi', name: 'אבי', groupName: '' }]);
    // שלט אחר לאותו משתתף — לא מוסתר
    expect(applyReleases(file, addReleases({}, [{ participantId: 'p-avi', clickerId: '5' }]))).toBe(file);
  });

  it('kept לא מסתיר: הבונה השאיר את המספר שלו', () => {
    const map: ReleaseMap = {
      [releaseKey('p-avi', '4')]: { participantId: 'p-avi', clickerId: '4', status: 'kept' },
    };
    expect(applyReleases(file, map)).toBe(file);
  });

  it('ניקוי: נענה ואינו בקובץ — יוצא; ממתין — נשאר; kept — יוצא; נשמר שוב מכאן — יוצא', () => {
    const map: ReleaseMap = {
      [releaseKey('p-avi', '4')]: { participantId: 'p-avi', clickerId: '4', status: 'released' }, // עוד בקובץ
      [releaseKey('p-dana', '9')]: { participantId: 'p-dana', clickerId: '9', status: 'released' }, // כבר לא
      [releaseKey('p-yosi', '2')]: { participantId: 'p-yosi', clickerId: '2', status: 'pending' },
      [releaseKey('p-dana', '6')]: { participantId: 'p-dana', clickerId: '6', status: 'kept' },
    };
    const users = parseGameUsers(file.users);
    expect(Object.keys(pruneReleases(map, users))).toEqual([releaseKey('p-avi', '4'), releaseKey('p-yosi', '2')]);
    expect(Object.keys(pruneReleases(map, users, (p, c) => p === 'p-avi' && c === '4'))).toEqual([
      releaseKey('p-yosi', '2'),
    ]);
    const clean = { [releaseKey('p-yosi', '2')]: map[releaseKey('p-yosi', '2')]! };
    expect(pruneReleases(clean, users)).toBe(clean);
  });

  it('מה לשלוח ומה להציג', () => {
    const map: ReleaseMap = {
      ...addReleases({}, [{ participantId: 'p-avi', clickerId: '4' }]),
      [releaseKey('p-dana', '6')]: { participantId: 'p-dana', clickerId: '6', status: 'kept' },
      [releaseKey('p-yosi', '2')]: { participantId: 'p-yosi', clickerId: '2', status: 'no_license' },
    };
    expect(releasesToSend(map)).toEqual([{ participantId: 'p-avi', clickerId: '4' }]);
    expect(summarizeReleases(map)).toEqual({ releasing: 1, kept: 1, noLicense: 1 });
  });
});

describe('parseReleaseResponse', () => {
  const sent = [
    { participantId: 'p-avi', clickerId: '4' },
    { participantId: 'p-dana', clickerId: '6' },
  ];

  it('200: תשובה לכל שיוך; שיוך בלי תשובה לא נרשם', () => {
    const out = parseReleaseResponse(
      200,
      {
        ok: true,
        results: [],
        released: [
          { participantId: 'p-avi', clickerId: '4', status: 'released' },
          { participantId: 'p-zzz', clickerId: '1', status: 'released' },
          { participantId: 'p-dana', clickerId: '6', status: 'weird' },
        ],
      },
      sent,
    );
    expect(out).toEqual({ kind: 'answered', answers: [{ participantId: 'p-avi', clickerId: '4', status: 'released' }] });
  });

  it('403 / 404 חלים על כל הבקשה; 400 (שרת שלא מכיר מחיקות), 5xx ו-200 בלי released — שוב אחר כך', () => {
    expect(parseReleaseResponse(403, { error: 'no_license' }, sent)).toEqual({
      kind: 'answered',
      answers: sent.map((e) => ({ ...e, status: 'no_license' })),
    });
    expect(parseReleaseResponse(404, { error: 'game_not_found' }, sent)).toMatchObject({ kind: 'answered' });
    expect(parseReleaseResponse(400, { error: 'invalid_request' }, sent).kind).toBe('retry');
    expect(parseReleaseResponse(500, null, sent).kind).toBe('retry');
    expect(parseReleaseResponse(404, { message: 'Requested function was not found' }, sent).kind).toBe('retry');
    expect(parseReleaseResponse(200, { ok: true, results: [] }, sent).kind).toBe('retry');
  });
});

describe('«שיוך מחדש» מקצה לקצה מול קבצים ישנים וחדשים', () => {
  /** הכנת ערכה: שלושה שמות מהבונה, נלחצו 1, 2, 3 לפי הסדר ונשמרו בבונה. */
  function preparedKit(): Computer {
    let pc = load(fresh(), builderFile([
      { user: AVI, number: '' },
      { user: DANA, number: '' },
      { user: YOSI, number: '' },
    ]));
    pc = press(press(press(pc, '1'), '2'), '3');
    pc = { ...pc, saved: { 'p-avi': '1', 'p-dana': '2', 'p-yosi': '3' } };
    return load(pc, savedFile());
  }
  const savedFile = () =>
    builderFile([
      { user: AVI, number: '1', pressed: true },
      { user: DANA, number: '2', pressed: true },
      { user: YOSI, number: '3', pressed: true },
    ]);

  it('איפוס ולחיצה בסדר אחר: קובץ ישן, קובץ אחרי המחיקה וקובץ אחרי השמירה — אף שלט לא חוזר לבעליו הקודם', () => {
    let pc = preparedKit();
    expect(holders(pc.roster)).toEqual({ '1': 'אבי', '2': 'דנה', '3': 'יוסי' });

    pc = reassign(pc);
    expect(pc.roster.players).toEqual([]);
    expect(pc.roster.pendingNames.map((n) => n.name)).toEqual(['אבי', 'דנה', 'יוסי']);

    // הלקוח מחלק מחדש: שלט 2 לאבי, שלט 1 לדנה
    pc = press(press(pc, '2'), '1');
    const expected = { '2': 'אבי', '1': 'דנה' };
    expect(holders(pc.roster)).toEqual(expected);

    // התוכנה נפתחת מחדש עם הקובץ הישן (חבילה שמורה): עדיין 1→אבי, 2→דנה, 3→יוסי
    pc = load(pc, savedFile());
    expect(holders(pc.roster)).toEqual(expected);
    expect(pc.roster.pendingNames.map((n) => n.name)).toEqual(['יוסי']);

    // הבונה מחק את השיוכים הישנים; השיוכים החדשים עוד לא נשמרו
    pc = {
      ...pc,
      releases: Object.fromEntries(
        Object.entries(pc.releases).map(([k, e]) => [k, { ...e, status: 'released' as const }]),
      ),
    };
    const released = builderFile([
      { user: AVI, number: '' },
      { user: DANA, number: '' },
      { user: YOSI, number: '' },
    ]);
    pc = load(pc, released);
    expect(holders(pc.roster)).toEqual(expected);
    expect(pc.roster.pendingNames.map((n) => n.name)).toEqual(['יוסי']);
    expect(pc.releases).toEqual({}); // הקובץ כבר מראה את המחיקה

    // שוב הקובץ הישן אחרי שהרשימה התנקתה? לא יכול להגיע אחרי קובץ חדש יותר במחשב
    // אופליין, אבל גם אז השיוך החדש של המחשב נשמר מקומית:
    // השיוכים החדשים נשמרו בבונה
    pc = { ...pc, saved: { 'p-avi': '2', 'p-dana': '1' } };
    pc = load(
      pc,
      builderFile([
        { user: AVI, number: '2', pressed: true },
        { user: DANA, number: '1', pressed: true },
        { user: YOSI, number: '' },
      ]),
    );
    expect(holders(pc.roster)).toEqual(expected);
    expect(pc.roster.pendingNames.map((n) => n.name)).toEqual(['יוסי']);
  });

  it('איפוס במחשב אחר: המספרים מהבונה חוזרים לתור, ונשארים שם גם כשהקובץ הישן נטען שוב', () => {
    let pc = load(fresh(), savedFile());
    expect(holders(pc.roster)).toEqual({ '1': 'אבי', '2': 'דנה', '3': 'יוסי' });
    pc = reassign(pc);
    expect(releasesToSend(pc.releases)).toHaveLength(3);
    pc = load(pc, savedFile());
    expect(pc.roster.players).toEqual([]);
    expect(pc.roster.pendingNames.map((n) => n.name)).toEqual(['אבי', 'דנה', 'יוסי']);
    pc = press(pc, '3');
    expect(holders(pc.roster)).toEqual({ '3': 'אבי' });
    pc = load(pc, savedFile());
    expect(holders(pc.roster)).toEqual({ '3': 'אבי' });
  });

  it('הבונה השאיר מספר ששונה שם (kept): בטעינה הבאה השם חוזר למספר מהבונה', () => {
    let pc = preparedKit();
    pc = reassign(pc);
    pc = press(pc, '7'); // אבי
    pc = {
      ...pc,
      releases: {
        ...pc.releases,
        [releaseKey('p-avi', '1')]: { participantId: 'p-avi', clickerId: '1', status: 'kept' },
      },
    };
    pc = load(pc, savedFile());
    expect(holders(pc.roster)).toEqual({ '1': 'אבי' });
  });

  it('איפוס שני לפני שהראשון נשלח: שני השיוכים הישנים של אותו משתתף ממתינים למחיקה', () => {
    let pc = preparedKit();
    pc = reassign(pc);
    pc = press(pc, '9'); // אבי, עוד לא נשמר
    pc = reassign(pc);
    expect(releasesToSend(pc.releases)).toEqual(
      expect.arrayContaining([
        { participantId: 'p-avi', clickerId: '1' },
        { participantId: 'p-avi', clickerId: '9' },
      ]),
    );
    pc = load(pc, savedFile());
    expect(pc.roster.players).toEqual([]);
    expect(pc.roster.pendingNames.map((n) => n.name)).toEqual(['אבי', 'דנה', 'יוסי']);
  });
});
