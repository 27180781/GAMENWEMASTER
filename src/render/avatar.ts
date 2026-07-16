/**
 * אווטרים אחידים לשחקנים: צבע יציב לפי המזהה והאות הראשונה מהשם. משמש את
 * מסילת העונים, מסך הלובי, וטבלת המובילים — כדי שאותו שחקן ייראה זהה בכל מקום.
 */

export const RAIL_COLORS = [
  '#FF6B6B',
  '#4ECDC4',
  '#FFD93D',
  '#6BCB77',
  '#A66CFF',
  '#FF9F45',
  '#4D96FF',
  '#FF6FB5',
  '#22D3EE',
];

/** hash יציב של מזהה — לבחירת צבע קבוע לשחקן. */
export function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

/** האות הראשונה להצגה באווטר (מהשם, אחרת '?'). */
export function railInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed === '' ? '?' : [...trimmed][0]!;
}

/** הצבע הקבוע של השחקן לפי מזההו. */
export function avatarColor(id: string): string {
  return RAIL_COLORS[hashId(id) % RAIL_COLORS.length]!;
}
