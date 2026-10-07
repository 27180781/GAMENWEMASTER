/**
 * מרשם השחקנים (Roster) — מיפוי מספר קליקר/טלפון לשם, וכן קבוצות.
 *
 * המנחה מנהל את המרשם מהלשונית שבצד המשחק. שני חלקים:
 *   • שמות   — מספר (voterId, כפי שמגיע מהקליקר/הטלפון) → שם השחקן.
 *   • קבוצות — קטגוריות קבוצה (למשל "עיר מגורים", "משקפיים"), לכל קטגוריה
 *              קבוצות משלה (ירושלים / ת״א …). שחקן יכול להשתייך לקבוצה אחת
 *              בכל קטגוריה (למשל גם "ירושלים" וגם "מרכיב משקפיים").
 *
 * המבנה נשמר ב-localStorage לפי id המשחק, כדי לשרוד רענון/טעינה מחדש.
 * הפעולות כאן טהורות ואימיוטביליות (מחזירות אובייקט חדש) — קלות לבדיקה.
 */

export interface Player {
  /** המספר של הקליקר/הטלפון — זהה ל-voterId שמגיע בהצבעות. */
  id: string;
  name: string;
  /**
   * מזהה המשתתף בבונה, כשהשם הגיע מרשימת המשתתפים בלי מספר שלט (pendingUsers)
   * ונקשר לשלט בלחיצה. כך יודעים שהשיוך הזה עדיין לא ידוע לבונה.
   */
  participantId?: string;
}

export interface Group {
  id: string;
  name: string;
}

export interface Category {
  id: string;
  name: string;
  groups: Group[];
}

/**
 * שם (ואופציונלית קבוצה) שממתין לשלט — הצד השני של "קליטה חכמה": במקום
 * להקליד מספרי שלטים, מזינים שמות, ולוחצים על השלטים. כל לחיצה תופסת את השם
 * הבא בתור. הסדר הוא המשמעות, ולכן זו רשימה ולא מפה.
 */
export interface PendingName {
  name: string;
  /** שם הקבוצה מהקובץ; '' = בלי קבוצה. */
  group: string;
  /**
   * שם הקטגוריה שאליה שייכת הקבוצה — נקבע בזמן ההוספה (כותרת עמודת הקבוצה
   * באקסל). בלעדיו, שם שנתפס בלחיצה *מאוחרת* היה יוצר את הקבוצה מחדש תחת
   * קטגוריית ברירת המחדל במקום תחת הקטגוריה שממנה הגיע.
   */
  category?: string;
  /**
   * מזהה המשתתף בבונה — לשם שהגיע מקובץ המשחק (pendingUsers) ולא הוקלד כאן.
   * שמות כאלה מסונכרנים מול הקובץ בכל טעינה (ראו mergePendingUsers).
   */
  participantId?: string;
}

export interface RosterData {
  players: Player[];
  categories: Category[];
  /** playerId → categoryId → groupId (שיוך שחקן לקבוצה בכל קטגוריה). */
  memberships: Record<string, Record<string, string>>;
  /** שמות שטרם נקשרו לשלט (קליטה חכמה), לפי סדר. */
  pendingNames: PendingName[];
}

export const EMPTY_ROSTER: RosterData = {
  players: [],
  categories: [],
  memberships: {},
  pendingNames: [],
};

/** שם ברירת המחדל לקטגוריה שנוצרת בייבוא (כמו הקטגוריה שמגיעה מה-JSON). */
export const DEFAULT_IMPORT_CATEGORY = 'קבוצות';

/** מזהה קצר וייחודי לקטגוריה/קבוצה (לא ל-voterId — הוא המספר האמיתי). */
export function uid(prefix = 'x'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// שמות
// ---------------------------------------------------------------------------

/** השם להצגה עבור voterId — שם השחקן אם הוגדר, אחרת המספר עצמו. */
export function displayName(roster: RosterData, voterId: string): string {
  const player = roster.players.find((p) => p.id === voterId || p.id === voterId.trim());
  const name = player?.name.trim();
  return name !== undefined && name !== '' ? name : voterId;
}

/** הוספה/עדכון שחקן לפי מספר. אם המספר כבר קיים — מעדכן את שמו. */
export function upsertPlayer(roster: RosterData, id: string, name: string): RosterData {
  const key = id.trim();
  if (key === '') return roster;
  const exists = roster.players.some((p) => p.id === key);
  const players = exists
    ? roster.players.map((p) => (p.id === key ? { ...p, name } : p))
    : [...roster.players, { id: key, name }];
  return { ...roster, players };
}

/** שינוי המספר של שחקן — כולל מיפוי מחדש של השיוכים לקבוצות. */
export function changePlayerId(roster: RosterData, oldId: string, rawNewId: string): RosterData {
  const newId = rawNewId.trim();
  if (newId === '' || newId === oldId) return roster;
  // אם המספר החדש כבר תפוס — לא משנים (מונע התנגשות)
  if (roster.players.some((p) => p.id === newId)) return roster;
  const players = roster.players.map((p) => (p.id === oldId ? { ...p, id: newId } : p));
  const memberships = { ...roster.memberships };
  if (oldId in memberships) {
    memberships[newId] = memberships[oldId]!;
    delete memberships[oldId];
  }
  return { ...roster, players, memberships };
}

export function removePlayer(roster: RosterData, id: string): RosterData {
  const memberships = { ...roster.memberships };
  delete memberships[id];
  return { ...roster, players: roster.players.filter((p) => p.id !== id), memberships };
}

/** הסרת כמה שחקנים בבת אחת (ושיוכיהם לקבוצות). מספר שאינו ברשימה — מתעלמים. */
export function removePlayers(roster: RosterData, ids: Iterable<string>): RosterData {
  const drop = new Set(ids);
  if (!roster.players.some((p) => drop.has(p.id))) return roster;
  const memberships = { ...roster.memberships };
  for (const id of drop) delete memberships[id];
  return { ...roster, players: roster.players.filter((p) => !drop.has(p.id)), memberships };
}

// ---------------------------------------------------------------------------
// קטגוריות וקבוצות
// ---------------------------------------------------------------------------

export function addCategory(roster: RosterData, name: string, id: string = uid('cat')): RosterData {
  return { ...roster, categories: [...roster.categories, { id, name, groups: [] }] };
}

export function renameCategory(roster: RosterData, categoryId: string, name: string): RosterData {
  return {
    ...roster,
    categories: roster.categories.map((c) => (c.id === categoryId ? { ...c, name } : c)),
  };
}

/** מחיקת קטגוריה — כולל ניקוי כל השיוכים אליה. */
export function removeCategory(roster: RosterData, categoryId: string): RosterData {
  const memberships: RosterData['memberships'] = {};
  for (const [playerId, byCat] of Object.entries(roster.memberships)) {
    const rest = { ...byCat };
    delete rest[categoryId];
    if (Object.keys(rest).length > 0) memberships[playerId] = rest;
  }
  return {
    ...roster,
    categories: roster.categories.filter((c) => c.id !== categoryId),
    memberships,
  };
}

export function addGroup(
  roster: RosterData,
  categoryId: string,
  name: string,
  id: string = uid('grp'),
): RosterData {
  return {
    ...roster,
    categories: roster.categories.map((c) =>
      c.id === categoryId ? { ...c, groups: [...c.groups, { id, name }] } : c,
    ),
  };
}

export function renameGroup(
  roster: RosterData,
  categoryId: string,
  groupId: string,
  name: string,
): RosterData {
  return {
    ...roster,
    categories: roster.categories.map((c) =>
      c.id === categoryId
        ? { ...c, groups: c.groups.map((g) => (g.id === groupId ? { ...g, name } : g)) }
        : c,
    ),
  };
}

/** מחיקת קבוצה — כולל ניקוי שיוכים שהצביעו עליה. */
export function removeGroup(roster: RosterData, categoryId: string, groupId: string): RosterData {
  const categories = roster.categories.map((c) =>
    c.id === categoryId ? { ...c, groups: c.groups.filter((g) => g.id !== groupId) } : c,
  );
  const memberships: RosterData['memberships'] = {};
  for (const [playerId, byCat] of Object.entries(roster.memberships)) {
    const next = { ...byCat };
    if (next[categoryId] === groupId) delete next[categoryId];
    if (Object.keys(next).length > 0) memberships[playerId] = next;
  }
  return { ...roster, categories, memberships };
}

/** שיוך שחקן לקבוצה בקטגוריה. groupId ריק = הסרת השיוך באותה קטגוריה. */
export function assignGroup(
  roster: RosterData,
  playerId: string,
  categoryId: string,
  groupId: string,
): RosterData {
  const current = roster.memberships[playerId] ?? {};
  const next = { ...current };
  if (groupId.trim() === '') delete next[categoryId];
  else next[categoryId] = groupId;
  const memberships = { ...roster.memberships };
  if (Object.keys(next).length > 0) memberships[playerId] = next;
  else delete memberships[playerId];
  return { ...roster, memberships };
}

/** הקבוצה הנוכחית של שחקן בקטגוריה נתונה (או '' אם אין). */
export function groupOf(roster: RosterData, playerId: string, categoryId: string): string {
  return roster.memberships[playerId]?.[categoryId] ?? '';
}

/** שמות כל הקבוצות שהשחקן משויך אליהן (על פני כל הקטגוריות) — לפי שם הקבוצה. */
export function playerGroupNames(roster: RosterData, playerId: string): string[] {
  const byCat = roster.memberships[playerId];
  if (byCat === undefined) return [];
  const names: string[] = [];
  for (const [categoryId, groupId] of Object.entries(byCat)) {
    const category = roster.categories.find((c) => c.id === categoryId);
    const group = category?.groups.find((g) => g.id === groupId);
    if (group !== undefined) names.push(group.name);
  }
  return names;
}

/**
 * שיוך שחקן לקבוצה לפי *מספר* הקבוצה (1-based, לפי הסדר בקטגוריה) — כך שחקן
 * שמקיש ספרה במסך ההתחברות מצטרף לקבוצה המתאימה. "לחיצה אחרונה קובעת": קריאה
 * חוזרת עם מספר אחר פשוט מחליפה. מספר מחוץ לטווח → אין שינוי. אם השחקן כבר
 * משויך לאותה קבוצה — מחזיר את אותו האובייקט (בלי רינדור/שמירה מיותרים).
 */
export function assignGroupByNumber(
  roster: RosterData,
  playerId: string,
  categoryId: string,
  number: number,
): RosterData {
  const category = roster.categories.find((c) => c.id === categoryId);
  if (!category) return roster;
  const group = category.groups[number - 1];
  if (!group) return roster; // מספר מחוץ לטווח הקבוצות
  if (groupOf(roster, playerId, categoryId) === group.id) return roster; // כבר משויך
  return assignGroup(roster, playerId, categoryId, group.id);
}

/** איפוס כל המחוברים לקטגוריה (מנקה שיוכים) — הקטגוריה והקבוצות נשמרות. */
export function resetCategoryMemberships(roster: RosterData, categoryId: string): RosterData {
  const memberships: RosterData['memberships'] = {};
  for (const [playerId, byCat] of Object.entries(roster.memberships)) {
    const rest = { ...byCat };
    delete rest[categoryId];
    if (Object.keys(rest).length > 0) memberships[playerId] = rest;
  }
  return { ...roster, memberships };
}

/** כמה שחקנים משויכים לכל קבוצה בקטגוריה: groupId → מספר. */
export function groupCounts(roster: RosterData, categoryId: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const byCat of Object.values(roster.memberships)) {
    const groupId = byCat[categoryId];
    if (groupId !== undefined) counts[groupId] = (counts[groupId] ?? 0) + 1;
  }
  return counts;
}

/** סך המשויכים בקטגוריה (מספר השחקנים שהצטרפו לאיזושהי קבוצה בה). */
export function categoryMemberTotal(roster: RosterData, categoryId: string): number {
  let total = 0;
  for (const byCat of Object.values(roster.memberships)) {
    if (byCat[categoryId] !== undefined) total += 1;
  }
  return total;
}

// ---------------------------------------------------------------------------
// קליטה חכמה: שלטים נקלטים בלחיצה, שמות נקשרים אליהם לפי הסדר
// ---------------------------------------------------------------------------

/**
 * מוודא שקיימת קטגוריה בשם הזה וקבוצה בשם הזה בתוכה, ומחזיר את המזהים.
 * ההשוואה לפי שם מנורמל (trim), כדי ש"ירושלים " ו"ירושלים" יהיו אותה קבוצה.
 */
export function ensureGroupByName(
  roster: RosterData,
  categoryName: string,
  groupName: string,
): { roster: RosterData; categoryId: string; groupId: string } {
  let r = roster;
  const catName = categoryName.trim();
  const grpName = groupName.trim();
  const existingCat = r.categories.find((c) => c.name.trim() === catName);
  const categoryId = existingCat?.id ?? uid('cat');
  if (existingCat === undefined) r = addCategory(r, catName, categoryId);

  const category = r.categories.find((c) => c.id === categoryId)!;
  const existingGroup = category.groups.find((g) => g.name.trim() === grpName);
  const groupId = existingGroup?.id ?? uid('grp');
  if (existingGroup === undefined) r = addGroup(r, categoryId, grpName, groupId);
  return { roster: r, categoryId, groupId };
}

/**
 * קושר שמות ממתינים לשלטים שנקלטו ועדיין בלי שם — לפי הסדר בשתי הרשימות.
 * זו הפעולה המרכזית של הקליטה החכמה, והיא רצה בשני הכיוונים: גם כשנקלט שלט
 * חדש וגם כשנוספים שמות, כך שלא משנה מה הגיע קודם.
 */
export function reconcilePending(roster: RosterData, categoryName: string): RosterData {
  if (roster.pendingNames.length === 0) return roster;
  const waiting = roster.players.filter((p) => p.name.trim() === '');
  if (waiting.length === 0) return roster;

  let r = roster;
  const pending = [...roster.pendingNames];
  const take = Math.min(waiting.length, pending.length);
  for (let i = 0; i < take; i += 1) {
    const player = waiting[i]!;
    const next = pending[i]!;
    r = upsertPlayer(r, player.id, next.name);
    if (next.participantId !== undefined) {
      // השם הגיע מהבונה: השלט שתפס אותו נושא את המשתתף, כדי שטעינה הבאה של
      // הקובץ לא תחזיר את השם לתור, וכדי שאפשר יהיה לדווח את המספר לבונה.
      const participantId = next.participantId;
      r = {
        ...r,
        players: r.players.map((p) => (p.id === player.id ? { ...p, participantId } : p)),
      };
    }
    if (next.group.trim() !== '') {
      // הקטגוריה של השם עצמו קודמת — כך שם מקובץ "מחלקה" נשאר תחת "מחלקה"
      // גם כשהלחיצה שתופסת אותו מגיעה הרבה אחרי הייבוא.
      const ensured = ensureGroupByName(r, next.category ?? categoryName, next.group);
      r = assignGroup(ensured.roster, player.id, ensured.categoryId, ensured.groupId);
    }
  }
  return { ...r, pendingNames: pending.slice(take) };
}

/** תוצאת קליטת לחיצה — למה שמוצג במסך הגדול. */
export interface CaptureResult {
  roster: RosterData;
  /** מספר השלט שנקלט. */
  id: string;
  /** השם שנקשר לו, או '' אם אין שם פנוי ("ממתין לשיוך"). */
  name: string;
  /** false = השלט כבר היה ברשימה (לחיצה חוזרת). */
  isNew: boolean;
}

/**
 * קליטת לחיצת שלט: מוסיף את המספר לסוף רשימת השלטים אם הוא חדש, ומיד קושר לו
 * את השם הממתין הבא. לחיצה חוזרת על שלט שכבר נקלט אינה משנה דבר — היא רק
 * מציגה שוב מי הוא, כדי שאפשר יהיה לוודא שיוך.
 */
export function captureRemote(
  roster: RosterData,
  rawId: string,
  categoryName: string = DEFAULT_IMPORT_CATEGORY,
): CaptureResult {
  const id = rawId.trim();
  if (id === '') return { roster, id, name: '', isNew: false };
  const existing = roster.players.find((p) => p.id === id);
  if (existing !== undefined) {
    return { roster, id, name: existing.name, isNew: false };
  }
  const withPlayer: RosterData = { ...roster, players: [...roster.players, { id, name: '' }] };
  const next = reconcilePending(withPlayer, categoryName);
  const player = next.players.find((p) => p.id === id);
  return { roster: next, id, name: player?.name ?? '', isNew: true };
}

/**
 * הוספת שמות ממתינים (הקלדה ידנית או קובץ "שם + קבוצה") — ומיד קשירה לשלטים
 * שכבר נקלטו ועדיין בלי שם. שמות שנשארו ימתינו ללחיצות הבאות.
 */
export function addPendingNames(
  roster: RosterData,
  names: PendingName[],
  categoryName: string = DEFAULT_IMPORT_CATEGORY,
): RosterData {
  const clean = names
    .map((n) => ({
      name: n.name.trim(),
      group: n.group.trim(),
      ...(n.category !== undefined && n.category.trim() !== '' ? { category: n.category.trim() } : {}),
      ...(n.participantId !== undefined && n.participantId !== '' ? { participantId: n.participantId } : {}),
    }))
    .filter((n) => n.name !== '');
  if (clean.length === 0) return roster;
  return reconcilePending({ ...roster, pendingNames: [...roster.pendingNames, ...clean] }, categoryName);
}

/** מחיקת שם ממתין לפי מיקום (טעות הקלדה / שורה מיותרת בקובץ). */
export function removePendingName(roster: RosterData, index: number): RosterData {
  if (index < 0 || index >= roster.pendingNames.length) return roster;
  return { ...roster, pendingNames: roster.pendingNames.filter((_, i) => i !== index) };
}

/** ניקוי כל השמות הממתינים. */
export function clearPendingNames(roster: RosterData): RosterData {
  return roster.pendingNames.length === 0 ? roster : { ...roster, pendingNames: [] };
}

// ---------------------------------------------------------------------------
// ייבוא שמות/קבוצות מקובץ המשחק (שדה users ב-JSON)
// ---------------------------------------------------------------------------

/** משתמש שמגיע מקובץ המשחק: מספר (remoteId) → שם, ואופציונלית שם קבוצה. */
export interface GameUser {
  remoteId: string;
  name: string;
  groupName: string;
  /** מזהה המשתתף בבונה. חסר בקבצים ישנים ובמשחקים שלא נבנו בבונה. */
  participantId?: string;
}

/**
 * פענוח שדה users מקובץ המשחק (מחרוזת JSON או אובייקט) לרשימת משתמשים.
 * מבנה: { "<remoteId>": { remoteId, name, groupName?, participantId? }, ... }.
 */
export function parseGameUsers(raw: unknown): GameUser[] {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed === '{}') return [];
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (obj === null || typeof obj !== 'object') return [];
  const users: GameUser[] = [];
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const remoteId = String(v.remoteId ?? key).trim();
    if (remoteId === '') continue;
    const participantId = typeof v.participantId === 'string' ? v.participantId.trim() : '';
    users.push({
      remoteId,
      name: String(v.name ?? '').trim(),
      groupName: String(v.groupName ?? '').trim(),
      ...(participantId !== '' ? { participantId } : {}),
    });
  }
  return users;
}

/**
 * מיזוג משתמשי קובץ המשחק למרשם: השמות נכנסים ללשונית השמות, והשיוך לקבוצות
 * (שמגיע בלי קטגוריה) נכנס תחת קטגוריה אחת בשם categoryName — הקבוצות נוצרות
 * לפי groupName הייחודיים. אימיוטבילי ואידמפוטנטי (ריצה חוזרת = אותה תוצאה).
 *
 * מספר שמופיע בקובץ הוא של הבונה: השחקן במספר הזה מקבל את המשתתף שבקובץ, ואם
 * נקשר כאן בלחיצה לשם אחר מהבונה, הקשר הזה נמחק (והשם חוזר לתור, ראו
 * mergePendingUsers).
 */
export function mergeGameUsers(roster: RosterData, users: GameUser[], categoryName: string): RosterData {
  let r = roster;
  for (const u of users) r = upsertPlayer(r, u.remoteId, u.name);

  const participantAt = new Map(users.map((u) => [u.remoteId, u.participantId]));
  if (r.players.some((p) => participantAt.has(p.id) && participantAt.get(p.id) !== p.participantId)) {
    r = {
      ...r,
      players: r.players.map((p) => {
        if (!participantAt.has(p.id)) return p;
        const participantId = participantAt.get(p.id);
        if (p.participantId === participantId) return p;
        const next: Player = { ...p };
        if (participantId === undefined) delete next.participantId;
        else next.participantId = participantId;
        return next;
      }),
    };
  }

  const grouped = users.filter((u) => u.groupName !== '');
  if (grouped.length === 0) return r;

  // קטגוריה אחת (לפי השם) — נוצרת אם אינה קיימת
  const existingCat = r.categories.find((c) => c.name === categoryName);
  const catId = existingCat?.id ?? uid('cat');
  if (existingCat === undefined) r = addCategory(r, categoryName, catId);

  // קבוצות לפי groupName ייחודי (נוצרות אם אינן קיימות)
  const category = r.categories.find((c) => c.id === catId)!;
  const nameToGroupId = new Map<string, string>(category.groups.map((g) => [g.name, g.id]));
  for (const groupName of new Set(grouped.map((u) => u.groupName))) {
    if (!nameToGroupId.has(groupName)) {
      const groupId = uid('grp');
      r = addGroup(r, catId, groupName, groupId);
      nameToGroupId.set(groupName, groupId);
    }
  }

  for (const u of grouped) {
    const groupId = nameToGroupId.get(u.groupName);
    if (groupId !== undefined) r = assignGroup(r, u.remoteId, catId, groupId);
  }
  return r;
}

// ---------------------------------------------------------------------------
// שמות שממתינים לשלט מקובץ המשחק (pendingUsers)
// ---------------------------------------------------------------------------

/**
 * משתתף שהגיע מהבונה בלי מספר שלט (המבנה של `pendingUsers` אחרי נרמול). מוגדר
 * כאן מבנית, כדי שהמרשם לא יהיה תלוי במנוע.
 */
export interface GamePendingUser {
  /** מזהה המשתתף בבונה ('' אם חסר — אז השם מתנהג כמו שם שהוקלד כאן). */
  id: string;
  name: string;
  groupName: string;
}

/**
 * סנכרון השמות שממתינים לשלט בקובץ המשחק אל התור של הקליטה החכמה. הקובץ הוא
 * מקור האמת לשמות האלה, והפעולה אידמפוטנטית (טעינה חוזרת = אותה תוצאה):
 *
 *   • שם שכבר נקשר לשלט במחשב הזה (שחקן עם אותו participantId) אינו חוזר לתור;
 *     אם שמו שונה בבונה, השם של השחקן מתעדכן.
 *   • שם שכבר בתור נשאר במקומו, והשם והקבוצה שלו מתעדכנים מהקובץ.
 *   • שם שנמחק מהבונה יוצא מהתור, ושם חדש נוסף לסוף התור לפי סדר הקובץ.
 *   • שמות שהוקלדו כאן (בלי participantId) נשארים כמו שהם.
 *
 * בסוף נקשרים שמות לשלטים שכבר נלחצו ועדיין בלי שם, כמו בכל הוספה לתור.
 */
export function mergePendingUsers(
  roster: RosterData,
  users: readonly GamePendingUser[],
  categoryName: string,
): RosterData {
  const fromFile = new Map<string, GamePendingUser>();
  for (const u of users) if (u.id !== '' && !fromFile.has(u.id)) fromFile.set(u.id, u);

  const bound = new Set<string>();
  const players = roster.players.map((p) => {
    if (p.participantId === undefined) return p;
    bound.add(p.participantId);
    const u = fromFile.get(p.participantId);
    return u !== undefined && u.name !== p.name ? { ...p, name: u.name } : p;
  });

  const entryOf = (u: GamePendingUser): PendingName => ({
    name: u.name,
    group: u.groupName,
    ...(u.groupName !== '' ? { category: categoryName } : {}),
    ...(u.id !== '' ? { participantId: u.id } : {}),
  });

  const queued = new Set<string>();
  const kept: PendingName[] = [];
  for (const n of roster.pendingNames) {
    if (n.participantId === undefined) {
      kept.push(n);
      continue;
    }
    const u = fromFile.get(n.participantId);
    if (u === undefined || bound.has(n.participantId) || queued.has(n.participantId)) continue;
    queued.add(n.participantId);
    kept.push(n.name === u.name && n.group === u.groupName ? n : entryOf(u));
  }

  const added: PendingName[] = [];
  for (const u of users) {
    if (u.id === '') {
      // בלי מזהה אי אפשר לעקוב אחרי השם; מוסיפים אותו רק אם הוא לא כבר בתור
      // או ברשימת השלטים, כדי שטעינה חוזרת לא תכפיל אותו.
      const taken =
        kept.some((n) => n.name === u.name) ||
        added.some((n) => n.name === u.name) ||
        players.some((p) => p.name.trim() === u.name);
      if (!taken) added.push(entryOf(u));
      continue;
    }
    if (bound.has(u.id) || queued.has(u.id)) continue;
    queued.add(u.id);
    added.push(entryOf(u));
  }

  return reconcilePending({ ...roster, players, pendingNames: [...kept, ...added] }, categoryName);
}

/**
 * הבסיס לבנייה מחדש של המרשם כשרשימת `users` בקובץ השתנתה (rosterIsStale):
 * מרשם ריק, חוץ משלטים שנקשרו כאן לשם מהבונה שעדיין ממתין בקובץ. השיוך שלהם
 * ידוע רק למחשב הזה (הבונה עוד לא יודע את המספר), ובלעדיהם השם היה חוזר לתור,
 * והשלט שכבר נמסר למישהו היה מקבל בלחיצה הבאה שם של מישהו אחר.
 */
export function carryPendingBindings(
  roster: RosterData,
  users: readonly GamePendingUser[],
): RosterData {
  const waiting = new Set(users.map((u) => u.id).filter((id) => id !== ''));
  const players = roster.players.filter(
    (p) => p.participantId !== undefined && waiting.has(p.participantId),
  );
  if (players.length === 0) return { ...EMPTY_ROSTER };
  const ids = new Set(players.map((p) => p.id));
  const memberships: RosterData['memberships'] = {};
  for (const [playerId, byCat] of Object.entries(roster.memberships)) {
    if (ids.has(playerId)) memberships[playerId] = { ...byCat };
  }
  const usedGroups = new Set<string>();
  for (const byCat of Object.values(memberships)) {
    for (const [catId, groupId] of Object.entries(byCat)) usedGroups.add(`${catId}/${groupId}`);
  }
  const categories = roster.categories
    .map((c) => ({ ...c, groups: c.groups.filter((g) => usedGroups.has(`${c.id}/${g.id}`)) }))
    .filter((c) => c.groups.length > 0);
  return { players, categories, memberships, pendingNames: [] };
}

/**
 * שחקנים שנקשרו כאן לשם מהבונה, והבונה כבר לא מחכה לשלט בשבילו: המשתתף קיבל
 * בבונה מספר אחר, או נמחק. נבדק רק כשהקובץ נושא מזהי משתתפים (בקובץ ישן כל
 * המשתתפים היו נראים "לא ממתינים"). מספר שמופיע בקובץ אינו מוסר כאן:
 * mergeGameUsers נותן לו את המשתתף שבקובץ.
 */
export function dropStaleBindings(
  roster: RosterData,
  users: readonly GameUser[],
  pending: readonly GamePendingUser[],
): RosterData {
  const waiting = new Set(pending.map((u) => u.id).filter((id) => id !== ''));
  const known = new Set(users.map((u) => u.participantId).filter((id) => id !== undefined));
  if (waiting.size === 0 && known.size === 0) return roster;
  const inFile = new Set(users.map((u) => u.remoteId));
  const stale = roster.players
    .filter((p) => p.participantId !== undefined && !waiting.has(p.participantId) && !inFile.has(p.id))
    .map((p) => p.id);
  return stale.length === 0 ? roster : removePlayers(roster, stale);
}

/** מה שהמרשם צריך מקובץ המשחק. */
export interface RosterSourceFile {
  name: string;
  users?: string;
  pendingUsers: readonly GamePendingUser[];
}

/**
 * ממה נבנה המרשם השמור בפעם הקודמת: המספרים שהגיעו אז ב-`users`, וטביעת האצבע
 * של המחרוזת (המפתח הישן, כשהמספרים עוד לא נשמרו).
 */
export interface RosterSource {
  /** null = לא ידוע (נשמר לפני שהמספרים נשמרו). */
  fingerprint: string | null;
  /** המספרים (remoteId) שהיו ב-`users`; null = לא ידוע (גרסה ישנה). */
  remoteIds: string[] | null;
}

/**
 * `users` בלי השדה participantId, כפי שהבונה שלח אותו לפני שהוסיף את השדה.
 * בזכותו קובץ שהשתנה רק בתוספת המזהים לא נחשב לרשימה חדשה. null = אין מה להסיר.
 */
export function usersWithoutParticipantIds(raw: string): string | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return null;
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (value !== null && typeof value === 'object' && 'participantId' in value) {
      const rest = { ...(value as Record<string, unknown>) };
      delete rest.participantId;
      out[key] = rest;
      changed = true;
    } else {
      out[key] = value;
    }
  }
  return changed ? JSON.stringify(out) : null;
}

/**
 * מיזוג השמות והקבוצות מקובץ המשחק (`users` ו-`pendingUsers`) אל המרשם השמור.
 * טהור: מקבל את המרשם המקומי ואת מה שנשמר על הקובץ הקודם, ומחזיר את המרשם החדש
 * ואת מה לשמור. מחזיר null כשאין בקובץ שמות, אין במרשם שמות מהבונה, ואין מספרים
 * מהקובץ הקודם — אז המרשם המקומי נשאר כמו שהוא.
 *
 * המרשם ממוזג ולעולם אינו מוחק סתם: שמות שהוקלדו כאן, קטגוריות ושיוכים לקבוצות
 * נשמרים. נמחקים רק מספרים שהבונה הסיר (היו ב-`users` הקודם ואינם עכשיו),
 * ושלטים שנקשרו כאן לשם שהבונה כבר נתן לו מספר אחר או מחק (dropStaleBindings).
 * כך מספר שנשמר בבונה מהמחשב הזה (המשתתף עובר מ-`pendingUsers` ל-`users`) לא
 * מוחק דבר.
 *
 * @param sealed משחק סגור (EXE חתום) — ראו rosterIsStale.
 */
export function syncRosterWithFile(
  local: RosterData,
  file: RosterSourceFile,
  previous: RosterSource | null,
  sealed: boolean,
): { roster: RosterData; source: RosterSource } | null {
  const users = parseGameUsers(file.users);
  const pending = file.pendingUsers;
  const fromBuilder =
    local.pendingNames.some((n) => n.participantId !== undefined) ||
    local.players.some((p) => p.participantId !== undefined);
  const previousIds = previous?.remoteIds ?? null;
  if (users.length === 0 && pending.length === 0 && !fromBuilder && (previousIds === null || previousIds.length === 0)) {
    return null;
  }

  const categoryName = file.name.trim() !== '' ? file.name.trim() : 'קבוצות המשחק';
  const rawUsers = String(file.users ?? '');
  const fingerprint = fingerprintUsers(rawUsers);
  const remoteIds = users.map((u) => u.remoteId);
  let base = local;
  if (previousIds !== null) {
    const now = new Set(remoteIds);
    base = removePlayers(base, previousIds.filter((id) => !now.has(id)));
  } else if (users.length > 0) {
    // נשמר רק טביעת אצבע (גרסה קודמת של התוכנה): מהדורה חדשה של אותו משחק
    // (למשל EXE שנחתם מחדש עם מספרי שלטים אחרים) נבנית מחדש, כמו שהיה. קובץ
    // שרק נוספו בו מזהי המשתתפים הוא אותה רשימה.
    const previousFingerprint = previous?.fingerprint ?? null;
    const stripped = usersWithoutParticipantIds(rawUsers);
    const same = previousFingerprint !== null && stripped !== null && previousFingerprint === fingerprintUsers(stripped);
    if (!same && rosterIsStale(previousFingerprint, fingerprint, sealed)) {
      base = carryPendingBindings(local, pending);
    }
  }
  base = mergeGameUsers(dropStaleBindings(base, users, pending), users, categoryName);
  return { roster: mergePendingUsers(base, pending, categoryName), source: { fingerprint, remoteIds } };
}

/**
 * טביעת אצבע של *מי* המשתתפים שהבונה שלח, לפי מזהה המשתתף: לא משתנה כשמספר
 * שלט נשמר בבונה (המשתתף עובר מ-`pendingUsers` ל-`users`) או כששם מתוקן. null
 * כשהקובץ לא נושא מזהי משתתפים (קובץ ישן, משחק שנבנה כאן).
 */
export function participantsFingerprint(file: {
  users?: string;
  pendingUsers: readonly GamePendingUser[];
}): string | null {
  const keys: string[] = [];
  let identified = false;
  for (const u of parseGameUsers(file.users)) {
    if (u.participantId !== undefined) {
      identified = true;
      keys.push(`p:${u.participantId}`);
    } else {
      keys.push(`u:${u.remoteId}\u0001${u.name}`);
    }
  }
  for (const u of file.pendingUsers) {
    if (u.id !== '') {
      identified = true;
      keys.push(`p:${u.id}`);
    } else {
      keys.push(`q:${u.name}`);
    }
  }
  if (!identified) return null;
  keys.sort();
  return fingerprintUsers(keys.join('\u0002'));
}

// ---------------------------------------------------------------------------
// ולידציה + persistence
// ---------------------------------------------------------------------------

/** ניקוי JSON שנטען לכדי RosterData תקין (זורק ערכים פגומים). */
export function normalizeRoster(raw: unknown): RosterData {
  if (raw === null || typeof raw !== 'object') return { ...EMPTY_ROSTER };
  const obj = raw as Record<string, unknown>;

  const participantOf = (v: Record<string, unknown>) =>
    typeof v.participantId === 'string' && v.participantId.trim() !== ''
      ? { participantId: v.participantId.trim() }
      : {};

  const players: Player[] = Array.isArray(obj.players)
    ? obj.players
        .filter((p): p is Record<string, unknown> => p !== null && typeof p === 'object')
        .map((p) => ({ id: String(p.id ?? '').trim(), name: String(p.name ?? ''), ...participantOf(p) }))
        .filter((p) => p.id !== '')
    : [];

  const categories: Category[] = Array.isArray(obj.categories)
    ? obj.categories
        .filter((c): c is Record<string, unknown> => c !== null && typeof c === 'object')
        .map((c) => ({
          id: String(c.id ?? uid('cat')),
          name: String(c.name ?? ''),
          groups: Array.isArray(c.groups)
            ? c.groups
                .filter((g): g is Record<string, unknown> => g !== null && typeof g === 'object')
                .map((g) => ({ id: String(g.id ?? uid('grp')), name: String(g.name ?? '') }))
            : [],
        }))
    : [];

  const memberships: RosterData['memberships'] = {};
  if (obj.memberships !== null && typeof obj.memberships === 'object') {
    for (const [playerId, byCat] of Object.entries(obj.memberships as Record<string, unknown>)) {
      if (byCat === null || typeof byCat !== 'object') continue;
      const clean: Record<string, string> = {};
      for (const [catId, groupId] of Object.entries(byCat as Record<string, unknown>)) {
        if (typeof groupId === 'string' && groupId !== '') clean[catId] = groupId;
      }
      if (Object.keys(clean).length > 0) memberships[playerId] = clean;
    }
  }

  const pendingNames: PendingName[] = Array.isArray(obj.pendingNames)
    ? obj.pendingNames
        .filter((p): p is Record<string, unknown> => p !== null && typeof p === 'object')
        .map((p) => ({
          name: String(p.name ?? '').trim(),
          group: String(p.group ?? '').trim(),
          ...(typeof p.category === 'string' && p.category.trim() !== ''
            ? { category: p.category.trim() }
            : {}),
          ...participantOf(p),
        }))
        .filter((p) => p.name !== '')
    : [];

  return { players, categories, memberships, pendingNames };
}

const STORAGE_PREFIX = 'trivia-roster:';

/**
 * מפתח נלווה: טביעת האצבע של רשימת המשתתפים (`users`) שממנה נבנה המרשם השמור.
 * המרשם ממוזג (upsert) ולעולם אינו מוחק — וזה נכון כשמפעילים שוב את *אותו*
 * משחק. אבל מהדורה חדשה של אותו משחק (אותו id, מספרי שלטים אחרים) הייתה
 * מוסיפה את המספרים החדשים לצד הישנים. טביעת האצבע מזהה בדיוק את המצב הזה.
 */
const SOURCE_PREFIX = 'trivia-roster-src:';

/**
 * המספרים שהגיעו ב-`users` בפעם הקודמת. מפתח נפרד, כדי שגרסה קודמת של התוכנה
 * תמשיך לקרוא מהמפתח הישן טביעת אצבע בלבד, כמו שהיא מכירה.
 */
const SOURCE_IDS_PREFIX = 'trivia-roster-ids:';

export function rosterStorageKey(gameId: string): string {
  return STORAGE_PREFIX + (gameId.trim() === '' ? 'default' : gameId);
}

export function rosterSourceKey(gameId: string): string {
  return SOURCE_PREFIX + (gameId.trim() === '' ? 'default' : gameId);
}

export function rosterSourceIdsKey(gameId: string): string {
  return SOURCE_IDS_PREFIX + (gameId.trim() === '' ? 'default' : gameId);
}

/**
 * טביעת אצבע קצרה ויציבה למחרוזת (FNV-1a). לא קריפטוגרפית — היא משמשת רק
 * לזיהוי *שינוי*, ואורך המחרוזת מצורף כדי להקטין עוד התנגשויות אקראיות.
 */
export function fingerprintUsers(raw: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${raw.length.toString(36)}.${h.toString(36)}`;
}

/** ממה נבנה המרשם השמור של המשחק, או null אם אין (משחק חדש). */
export function loadRosterSource(gameId: string): RosterSource | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const fingerprint = localStorage.getItem(rosterSourceKey(gameId));
    let remoteIds: string[] | null = null;
    const rawIds = localStorage.getItem(rosterSourceIdsKey(gameId));
    if (rawIds !== null) {
      const parsed: unknown = JSON.parse(rawIds);
      if (Array.isArray(parsed)) remoteIds = parsed.filter((id): id is string => typeof id === 'string');
    }
    return fingerprint === null && remoteIds === null ? null : { fingerprint, remoteIds };
  } catch {
    return null;
  }
}

/**
 * האם המרשם השמור נבנה מרשימת משתתפים *אחרת* מזו שבקובץ שנטען עכשיו — ולכן יש
 * לבנות אותו מחדש במקום למזג לתוכו.
 *
 * @param previous טביעת האצבע השמורה, או null אם אין (משחק חדש / גרסה ישנה)
 * @param fingerprint טביעת האצבע של הקובץ שנטען עכשיו
 * @param sealed משחק סגור (EXE חתום) — שם רשימת המשתתפים היא מקור האמת, ולכן
 *   גם היעדר טביעת אצבע נחשב "ישן" ומנקה שאריות ממהדורה קודמת של אותו משחק.
 */
export function rosterIsStale(
  previous: string | null,
  fingerprint: string,
  sealed: boolean,
): boolean {
  return previous === null ? sealed : previous !== fingerprint;
}

/** שמירת מה שממנו נבנה המרשם הנוכחי. */
export function saveRosterSource(gameId: string, source: RosterSource): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (source.fingerprint !== null) localStorage.setItem(rosterSourceKey(gameId), source.fingerprint);
    if (source.remoteIds !== null) {
      localStorage.setItem(rosterSourceIdsKey(gameId), JSON.stringify(source.remoteIds));
    }
  } catch {
    /* מכסת אחסון חריגה — מתעלמים */
  }
}

export function loadRoster(gameId: string): RosterData {
  if (typeof localStorage === 'undefined') return { ...EMPTY_ROSTER };
  try {
    const raw = localStorage.getItem(rosterStorageKey(gameId));
    return raw === null ? { ...EMPTY_ROSTER } : normalizeRoster(JSON.parse(raw));
  } catch {
    return { ...EMPTY_ROSTER };
  }
}

export function saveRoster(gameId: string, roster: RosterData): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(rosterStorageKey(gameId), JSON.stringify(roster));
  } catch {
    /* מכסת אחסון חריגה — מתעלמים */
  }
}
