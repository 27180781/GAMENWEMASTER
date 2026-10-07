/**
 * שמות שהגיעו מהבונה בלי מספר שלט (`pendingUsers`): נכנסים לתור של הקליטה
 * החכמה, נקשרים לשלט בלחיצה, ושורדים טעינה חוזרת של הקובץ בלי לחזור לתור.
 */

import { describe, expect, it } from 'vitest';
import { normalizePendingUsers, parseGameFile } from '../src/engine/index.ts';
import {
  EMPTY_ROSTER,
  addCategory,
  addPendingNames,
  captureRemote,
  carryPendingBindings,
  displayName,
  dropStaleBindings,
  fingerprintUsers,
  mergePendingUsers,
  normalizeRoster,
  parseGameUsers,
  participantsFingerprint,
  playerGroupNames,
  syncRosterWithFile,
  upsertPlayer,
  usersWithoutParticipantIds,
  type GamePendingUser,
  type RosterData,
} from '../src/app/roster.ts';
import { loadFixtureRaw } from './helpers.ts';

const CAT = 'ערב גיבוש';

const DANA: GamePendingUser = { id: 'p-dana', name: 'דנה', groupName: '' };
const YOSI: GamePendingUser = { id: 'p-yosi', name: 'יוסי', groupName: 'כחולים' };
const RINA: GamePendingUser = { id: 'p-rina', name: 'רינה', groupName: '' };

/** קובץ משחק מינימלי בשביל syncRosterWithFile. */
const file = (pendingUsers: GamePendingUser[], users = '{}') => ({ name: CAT, users, pendingUsers });

describe('normalizePendingUsers', () => {
  it('מערך, או מחרוזת JSON של מערך', () => {
    const list = [{ id: 'a1', name: ' דנה ', groupName: ' אדומים ' }];
    expect(normalizePendingUsers(list)).toEqual([{ id: 'a1', name: 'דנה', groupName: 'אדומים' }]);
    expect(normalizePendingUsers(JSON.stringify(list))).toEqual([
      { id: 'a1', name: 'דנה', groupName: 'אדומים' },
    ]);
  });

  it('לעולם לא נכשל: ערך חסר או פגום הוא רשימה ריקה, ורשומה פגומה נזרקת', () => {
    expect(normalizePendingUsers(undefined)).toEqual([]);
    expect(normalizePendingUsers(null)).toEqual([]);
    expect(normalizePendingUsers('')).toEqual([]);
    expect(normalizePendingUsers('{not json')).toEqual([]);
    expect(normalizePendingUsers({ name: 'דנה' })).toEqual([]);
    expect(
      normalizePendingUsers([null, 7, 'דנה', { name: '' }, { name: 'יוסי', id: 12 }, { id: 'x' }]),
    ).toEqual([{ id: '12', name: 'יוסי', groupName: '' }]);
  });

  it('עובר בטעינת קובץ המשחק; קובץ בלי השדה נטען כמו תמיד, עם רשימה ריקה', () => {
    const raw = loadFixtureRaw('neuwirth.json') as Record<string, unknown>;
    expect(parseGameFile(raw).pendingUsers).toEqual([]);
    const withNames = parseGameFile({ ...raw, pendingUsers: [{ id: 'p1', name: 'דנה' }] });
    expect(withNames.pendingUsers).toEqual([{ id: 'p1', name: 'דנה', groupName: '' }]);
    // שדה פגום אינו מפיל את המשחק
    expect(parseGameFile({ ...raw, pendingUsers: 'garbage' }).pendingUsers).toEqual([]);
  });
});

describe('mergePendingUsers', () => {
  it('השמות מהבונה נכנסים לתור לפי הסדר, עם מזהה המשתתף', () => {
    const r = mergePendingUsers(EMPTY_ROSTER, [DANA, YOSI], CAT);
    expect(r.pendingNames).toEqual([
      { name: 'דנה', group: '', participantId: 'p-dana' },
      { name: 'יוסי', group: 'כחולים', category: CAT, participantId: 'p-yosi' },
    ]);
    expect(r.players).toEqual([]);
  });

  it('לחיצה תופסת את השם הבא, והשלט נושא את מזהה המשתתף ואת הקבוצה', () => {
    let r = mergePendingUsers(EMPTY_ROSTER, [DANA, YOSI], CAT);
    r = captureRemote(r, '103', CAT).roster;
    const res = captureRemote(r, '245', CAT);
    expect(res.name).toBe('יוסי');
    expect(res.roster.players).toEqual([
      { id: '103', name: 'דנה', participantId: 'p-dana' },
      { id: '245', name: 'יוסי', participantId: 'p-yosi' },
    ]);
    expect(playerGroupNames(res.roster, '245')).toEqual(['כחולים']);
    expect(res.roster.pendingNames).toEqual([]);
  });

  it('טעינה חוזרת של אותו קובץ אינה מחזירה לתור שם שכבר נקשר, ואינה מכפילה', () => {
    let r = mergePendingUsers(EMPTY_ROSTER, [DANA, YOSI, RINA], CAT);
    r = captureRemote(r, '103', CAT).roster; // דנה
    const again = mergePendingUsers(r, [DANA, YOSI, RINA], CAT);
    expect(again.pendingNames.map((n) => n.name)).toEqual(['יוסי', 'רינה']);
    expect(again.players).toEqual([{ id: '103', name: 'דנה', participantId: 'p-dana' }]);
    expect(mergePendingUsers(again, [DANA, YOSI, RINA], CAT)).toEqual(again);
  });

  it('שינוי שם בבונה מעדכן גם את התור וגם שלט שכבר נקשר', () => {
    let r = mergePendingUsers(EMPTY_ROSTER, [DANA, YOSI], CAT);
    r = captureRemote(r, '103', CAT).roster; // דנה
    const renamed = mergePendingUsers(
      r,
      [
        { ...DANA, name: 'דנה כהן' },
        { ...YOSI, name: 'יוסף' },
      ],
      CAT,
    );
    expect(displayName(renamed, '103')).toBe('דנה כהן');
    expect(renamed.pendingNames.map((n) => n.name)).toEqual(['יוסף']);
  });

  it('שם שנמחק מהבונה יוצא מהתור; שם חדש נכנס לסוף', () => {
    const r = mergePendingUsers(EMPTY_ROSTER, [DANA, YOSI], CAT);
    const next = mergePendingUsers(r, [YOSI, RINA], CAT);
    expect(next.pendingNames.map((n) => n.participantId)).toEqual(['p-yosi', 'p-rina']);
  });

  it('שמות שהוקלדו בתוכנה נשארים במקומם, גם כשהקובץ ריק', () => {
    let r = addPendingNames(EMPTY_ROSTER, [{ name: 'מוקלד', group: '' }], CAT);
    r = mergePendingUsers(r, [DANA], CAT);
    expect(r.pendingNames.map((n) => n.name)).toEqual(['מוקלד', 'דנה']);
    const emptied = mergePendingUsers(r, [], CAT);
    expect(emptied.pendingNames.map((n) => n.name)).toEqual(['מוקלד']);
  });

  it('שלטים שנלחצו לפני שהשמות הגיעו מקבלים אותם מיד', () => {
    let r: RosterData = EMPTY_ROSTER;
    r = captureRemote(r, '310', CAT).roster;
    r = captureRemote(r, '311', CAT).roster;
    r = mergePendingUsers(r, [DANA, YOSI, RINA], CAT);
    expect(r.players.map((p) => [p.id, p.name, p.participantId])).toEqual([
      ['310', 'דנה', 'p-dana'],
      ['311', 'יוסי', 'p-yosi'],
    ]);
    expect(r.pendingNames.map((n) => n.name)).toEqual(['רינה']);
  });

  it('שם בלי מזהה נכנס פעם אחת בלבד, גם אחרי שנקשר', () => {
    const noId: GamePendingUser = { id: '', name: 'אורח', groupName: '' };
    let r = mergePendingUsers(EMPTY_ROSTER, [noId], CAT);
    expect(mergePendingUsers(r, [noId], CAT).pendingNames).toHaveLength(1);
    r = captureRemote(r, '400', CAT).roster;
    expect(mergePendingUsers(r, [noId], CAT).pendingNames).toEqual([]);
    expect(r.players[0]!.participantId).toBeUndefined();
  });
});

describe('syncRosterWithFile', () => {
  /** מקור שמור כמו שהגרסה הנוכחית שומרת: טביעת אצבע + המספרים. */
  const source = (users: string) => ({
    fingerprint: fingerprintUsers(users),
    remoteIds: Object.keys(JSON.parse(users) as Record<string, unknown>),
  });
  /** מקור שמור כמו שגרסה קודמת שמרה: טביעת אצבע בלבד. */
  const legacy = (users: string) => ({ fingerprint: fingerprintUsers(users), remoteIds: null });
  const withLocalCategory = (r: RosterData) => addCategory(r, 'עיר מגורים', 'cat-local');

  it('קובץ בלי שמות בכלל אינו נוגע במרשם המקומי', () => {
    const local = captureRemote(
      addPendingNames(EMPTY_ROSTER, [{ name: 'מוקלד', group: '' }], CAT),
      '101',
      CAT,
    ).roster;
    expect(syncRosterWithFile(local, file([]), null, false)).toBeNull();
  });

  it('רשימה שהתרוקנה בבונה מוציאה מהתור את השמות שהגיעו ממנה', () => {
    const local = mergePendingUsers(EMPTY_ROSTER, [DANA], CAT);
    const res = syncRosterWithFile(local, file([]), null, false);
    expect(res?.roster.pendingNames).toEqual([]);
    expect(res?.source).toEqual({ fingerprint: fingerprintUsers('{}'), remoteIds: [] });
  });

  it('שמות בלבד: התור מתמלא', () => {
    const res = syncRosterWithFile(EMPTY_ROSTER, file([DANA, YOSI]), null, false);
    expect(res?.roster.pendingNames.map((n) => n.name)).toEqual(['דנה', 'יוסי']);
    expect(res?.source.remoteIds).toEqual([]);
  });

  it('אחרי שהמספר נשמר בבונה: שחקן אחד, בלי כפילות, ושום דבר מקומי לא נמחק', () => {
    // במחשב: דנה נקשרה לשלט 103, יוסי עוד ממתין, ויש שם שהוקלד וקטגוריה מקומית
    let local = mergePendingUsers(EMPTY_ROSTER, [DANA, YOSI], CAT);
    local = captureRemote(local, '103', CAT).roster;
    local = withLocalCategory(addPendingNames(local, [{ name: 'מוקלד', group: '' }], CAT));
    // בקובץ החדש דנה כבר עם מספר, ויוסי עדיין ממתין
    const users = JSON.stringify({ '103': { remoteId: '103', name: 'דנה', participantId: 'p-dana' } });
    const res = syncRosterWithFile(local, file([YOSI], users), source('{}'), false);
    const r = res!.roster;
    expect(r.players).toEqual([{ id: '103', name: 'דנה', participantId: 'p-dana' }]);
    expect(r.pendingNames.map((n) => n.name)).toEqual(['יוסי', 'מוקלד']);
    expect(r.categories.some((c) => c.id === 'cat-local')).toBe(true);
    expect(res?.source.remoteIds).toEqual(['103']);
  });

  it('גם גרסה קודמת של התוכנה שמרה רק טביעת אצבע: מספר שנוסף אינו מוחק דבר', () => {
    let local = mergePendingUsers(EMPTY_ROSTER, [DANA, YOSI], CAT);
    local = withLocalCategory(captureRemote(local, '103', CAT).roster);
    const users = JSON.stringify({ '103': { remoteId: '103', name: 'דנה', participantId: 'p-dana' } });
    const res = syncRosterWithFile(local, file([YOSI], users), source('{}'), false);
    expect(res?.roster.categories.some((c) => c.id === 'cat-local')).toBe(true);
  });

  it('מספר שהבונה הסיר נמחק מהמרשם, והשם חוזר לתור', () => {
    const users = JSON.stringify({ '103': { remoteId: '103', name: 'דנה', participantId: 'p-dana' } });
    const local = syncRosterWithFile(EMPTY_ROSTER, file([YOSI], users), null, false)!.roster;
    // בבונה מחקו לדנה את המספר: היא שוב ממתינה לשלט
    const res = syncRosterWithFile(local, file([DANA, YOSI]), source(users), false);
    expect(res?.roster.players).toEqual([]);
    expect(res?.roster.pendingNames.map((n) => n.name)).toEqual(['יוסי', 'דנה']);
  });

  it('משתתף שקיבל בבונה מספר אחר: השלט שנקלט כאן נמחק, בלי כפילות', () => {
    let local = mergePendingUsers(EMPTY_ROSTER, [DANA, YOSI], CAT);
    local = captureRemote(local, '103', CAT).roster; // דנה
    const users = JSON.stringify({ '205': { remoteId: '205', name: 'דנה', participantId: 'p-dana' } });
    const r = syncRosterWithFile(local, file([YOSI], users), source('{}'), false)!.roster;
    expect(r.players).toEqual([{ id: '205', name: 'דנה', participantId: 'p-dana' }]);
  });

  it('משתתף שנמחק בבונה: השלט שנקשר אליו כאן נמחק', () => {
    let local = mergePendingUsers(EMPTY_ROSTER, [DANA, YOSI], CAT);
    local = captureRemote(local, '103', CAT).roster; // דנה
    const r = syncRosterWithFile(local, file([YOSI]), source('{}'), false)!.roster;
    expect(r.players).toEqual([]);
    expect(r.pendingNames.map((n) => n.name)).toEqual(['יוסי']);
  });

  it('מספר שהבונה נתן למשתתף אחר: השלט מקבל את השם מהבונה, והשם הקודם חוזר לתור', () => {
    let local = mergePendingUsers(EMPTY_ROSTER, [DANA, YOSI], CAT);
    local = captureRemote(local, '103', CAT).roster; // דנה
    const users = JSON.stringify({ '103': { remoteId: '103', name: 'יוסי', participantId: 'p-yosi' } });
    const r = syncRosterWithFile(local, file([DANA], users), source('{}'), false)!.roster;
    expect(r.players).toEqual([{ id: '103', name: 'יוסי', participantId: 'p-yosi' }]);
    expect(r.pendingNames.map((n) => n.participantId)).toEqual(['p-dana']);
  });

  it('גרסה קודמת: קובץ שרק נוספו בו מזהי המשתתפים אינו נבנה מחדש', () => {
    const oldUsers = JSON.stringify({
      '101': { remoteId: '101', name: 'אבי', groupName: 'אדומים' },
      '102': { remoteId: '102', name: 'דנה' },
    });
    const newUsers = JSON.stringify({
      '101': { remoteId: '101', name: 'אבי', groupName: 'אדומים', participantId: 'p-avi' },
      '102': { remoteId: '102', name: 'דנה', participantId: 'p-dana' },
    });
    const local = withLocalCategory(syncRosterWithFile(EMPTY_ROSTER, file([], oldUsers), null, false)!.roster);
    const res = syncRosterWithFile(local, file([], newUsers), legacy(oldUsers), false);
    expect(res?.roster.categories.some((c) => c.id === 'cat-local')).toBe(true);
    expect(res?.roster.players.map((p) => p.participantId)).toEqual(['p-avi', 'p-dana']);
  });

  it('גרסה קודמת: רשימה שהשתנתה באמת נבנית מחדש, ושלט שנקשר לשם שעדיין ממתין נשמר', () => {
    let local = mergePendingUsers(EMPTY_ROSTER, [DANA, YOSI, RINA], CAT);
    local = captureRemote(local, '103', CAT).roster; // דנה
    local = captureRemote(local, '245', CAT).roster; // יוסי (קבוצה כחולים)
    local = captureRemote(local, '999', CAT).roster; // רינה
    const oldUsers = JSON.stringify({ '7': { remoteId: '7', name: 'ישן' } });
    const newUsers = JSON.stringify({ '999': { remoteId: '999', name: 'רינה', participantId: 'p-rina' } });
    // רינה כבר נשמרה בבונה; דנה ויוסי עדיין ממתינים שם — השיוך שלהם ידוע רק כאן
    const res = syncRosterWithFile(local, file([DANA, YOSI], newUsers), legacy(oldUsers), false);
    const r = res!.roster;
    expect(r.players.map((p) => [p.id, p.name]).sort()).toEqual([
      ['103', 'דנה'],
      ['245', 'יוסי'],
      ['999', 'רינה'],
    ]);
    expect(playerGroupNames(r, '245')).toEqual(['כחולים']);
    expect(r.pendingNames).toEqual([]);
    expect(res?.source).toEqual({ fingerprint: fingerprintUsers(newUsers), remoteIds: ['999'] });
  });

  it('משחק סגור בלי מקור שמור נבנה מחדש מהקובץ, כמו קודם', () => {
    const users = JSON.stringify({ '101': { remoteId: '101', name: 'אבי' } });
    const local = withLocalCategory(upsertPlayer(EMPTY_ROSTER, '55', 'שארית'));
    const r = syncRosterWithFile(local, file([], users), null, true)!.roster;
    expect(r.players).toEqual([{ id: '101', name: 'אבי' }]);
    expect(r.categories).toEqual([]);
  });

  it('carryPendingBindings: רק שלטים שנקשרו לשם שעדיין ממתין בקובץ', () => {
    let local = mergePendingUsers(EMPTY_ROSTER, [DANA, YOSI], CAT);
    local = captureRemote(local, '103', CAT).roster;
    local = captureRemote(local, '245', CAT).roster;
    local = captureRemote(local, '500', CAT).roster; // בלי שם
    const carried = carryPendingBindings(local, [YOSI]);
    expect(carried.players).toEqual([{ id: '245', name: 'יוסי', participantId: 'p-yosi' }]);
    expect(carried.categories.map((c) => c.groups.map((g) => g.name))).toEqual([['כחולים']]);
    expect(carryPendingBindings(local, [])).toEqual(EMPTY_ROSTER);
  });

  it('dropStaleBindings לא נוגע בכלום כשהקובץ לא נושא מזהי משתתפים', () => {
    let local = mergePendingUsers(EMPTY_ROSTER, [DANA], CAT);
    local = captureRemote(local, '103', CAT).roster;
    expect(dropStaleBindings(local, [], [])).toBe(local);
    expect(dropStaleBindings(local, [{ remoteId: '7', name: 'ישן', groupName: '' }], [])).toBe(local);
  });
});

describe('מזהי משתתפים ב-users', () => {
  it('parseGameUsers קורא את participantId, וקובץ בלעדיו נשאר כמו שהיה', () => {
    const users = parseGameUsers(
      JSON.stringify({
        '101': { remoteId: '101', name: 'אבי', participantId: ' p-avi ' },
        '102': { remoteId: '102', name: 'דנה' },
      }),
    );
    expect(users).toEqual([
      { remoteId: '101', name: 'אבי', groupName: '', participantId: 'p-avi' },
      { remoteId: '102', name: 'דנה', groupName: '' },
    ]);
  });

  it('usersWithoutParticipantIds מחזיר בדיוק את המחרוזת שהבונה שלח לפני השדה', () => {
    const before = JSON.stringify({
      '0501234567': { remoteId: '0501234567', name: 'אבי', groupName: 'א' },
      '103': { remoteId: '103', name: 'דנה' },
    });
    const after = JSON.stringify({
      '0501234567': { remoteId: '0501234567', name: 'אבי', groupName: 'א', participantId: 'p1' },
      '103': { remoteId: '103', name: 'דנה', participantId: 'p2' },
    });
    expect(usersWithoutParticipantIds(after)).toBe(before);
    expect(usersWithoutParticipantIds(before)).toBeNull();
    expect(usersWithoutParticipantIds('{oops')).toBeNull();
  });

  it('participantsFingerprint לא משתנה כשמספר נשמר בבונה או כששם מתוקן', () => {
    const before = participantsFingerprint({ users: '{}', pendingUsers: [DANA, YOSI] });
    const after = participantsFingerprint({
      users: JSON.stringify({ '103': { remoteId: '103', name: 'דנה כהן', participantId: 'p-dana' } }),
      pendingUsers: [YOSI],
    });
    expect(before).not.toBeNull();
    expect(after).toBe(before);
    expect(participantsFingerprint({ users: '{}', pendingUsers: [DANA, RINA] })).not.toBe(before);
  });

  it('participantsFingerprint הוא null לקובץ בלי מזהי משתתפים', () => {
    const users = JSON.stringify({ '101': { remoteId: '101', name: 'אבי' } });
    expect(participantsFingerprint({ users, pendingUsers: [] })).toBeNull();
    expect(participantsFingerprint({ users: '{}', pendingUsers: [{ id: '', name: 'אורח', groupName: '' }] })).toBeNull();
  });
});

describe('normalizeRoster', () => {
  it('שומר את מזהה המשתתף של שחקנים ושל שמות בתור', () => {
    let r = mergePendingUsers(EMPTY_ROSTER, [DANA, YOSI], CAT);
    r = captureRemote(r, '103', CAT).roster;
    const restored = normalizeRoster(JSON.parse(JSON.stringify(r)));
    expect(restored.players[0]).toEqual({ id: '103', name: 'דנה', participantId: 'p-dana' });
    expect(restored.pendingNames[0]?.participantId).toBe('p-yosi');
  });
});
