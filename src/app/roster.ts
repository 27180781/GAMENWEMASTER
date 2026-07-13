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

export interface RosterData {
  players: Player[];
  categories: Category[];
  /** playerId → categoryId → groupId (שיוך שחקן לקבוצה בכל קטגוריה). */
  memberships: Record<string, Record<string, string>>;
}

export const EMPTY_ROSTER: RosterData = { players: [], categories: [], memberships: {} };

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
// ולידציה + persistence
// ---------------------------------------------------------------------------

/** ניקוי JSON שנטען לכדי RosterData תקין (זורק ערכים פגומים). */
export function normalizeRoster(raw: unknown): RosterData {
  if (raw === null || typeof raw !== 'object') return { ...EMPTY_ROSTER };
  const obj = raw as Record<string, unknown>;

  const players: Player[] = Array.isArray(obj.players)
    ? obj.players
        .filter((p): p is Record<string, unknown> => p !== null && typeof p === 'object')
        .map((p) => ({ id: String(p.id ?? '').trim(), name: String(p.name ?? '') }))
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

  return { players, categories, memberships };
}

const STORAGE_PREFIX = 'trivia-roster:';

export function rosterStorageKey(gameId: string): string {
  return STORAGE_PREFIX + (gameId.trim() === '' ? 'default' : gameId);
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
