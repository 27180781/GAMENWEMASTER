/**
 * רישיון של משחק שנבנה במחשב (בלי מערכת יצירת המשחקים).
 *
 * משחק שהורד מהשרת מקבל את הרישיון שלו מהמערכת, ואין מה לערוך בו. משחק
 * שנבנה כאן מאפס צריך רישיון משלו, והוא נשמר בדיוק בשדות שהמערכת כותבת:
 *   setting.limit.type   — 'clickers' / 'phones' / 'both'
 *   setting.limit.number — מגבלת המשתתפים; חסר = ללא הגבלה
 *   room                 — קוד החדר להצבעה מהטלפון; null = בלי טלפונים
 *
 * כך כל שאר המנוע (מגבלת המשתתפים, כרטיס הטלפונים, הוראות ההצטרפות) עובד על
 * המשחק החדש בלי לדעת שהוא נבנה במחשב.
 */

import type { GameFile } from '../engine/index.ts';

export type LicenseKind = 'clickers' | 'phones' | 'both';

export interface GameLicense {
  kind: LicenseKind;
  /** מגבלת המשתתפים. null = ללא הגבלה. */
  limit: number | null;
  /** קוד החדר לטלפונים. משמעותי רק כשהרישיון כולל טלפונים. */
  room: string;
}

/** ברירת המחדל לבקשת נסים: קליקרים, ללא הגבלת משתתפים. */
export const DEFAULT_LICENSE: GameLicense = { kind: 'clickers', limit: null, room: '' };

export const LICENSE_KINDS: { value: LicenseKind; icon: string; label: string; hint: string }[] = [
  { value: 'clickers', icon: '📡', label: 'קליקרים', hint: 'שלטים פיזיים עם הריסיבר' },
  { value: 'phones', icon: '📱', label: 'טלפונים', hint: 'הצבעה מהטלפון בחיוג או בקישור' },
  { value: 'both', icon: '📡📱', label: 'קליקרים + טלפונים', hint: 'שני המקורות יחד' },
];

export const includesPhones = (kind: LicenseKind) => kind !== 'clickers';
export const includesClickers = (kind: LicenseKind) => kind !== 'phones';

/**
 * קוד החדר: ספרות בלבד, 3–6 (זה מה שמרכזיית ההצבעה בטלפון מקבלת). קוד שנקנה
 * באתר הוא 4 ספרות, ולכן גם הוא עובר.
 */
export const ROOM_PATTERN = /^\d{3,6}$/;

/**
 * הצעה לקוד חדר: 5 ספרות. רישיונות טלפונים מהמערכת מקבלים 4 ספרות, ולכן קוד
 * של 5 ספרות לעולם לא יתנגש בחדר של משחק שנקנה באתר. `rand` מוזרק לבדיקות.
 */
export function suggestRoomCode(rand: () => number = Math.random): string {
  return String(10000 + Math.floor(rand() * 90000));
}

/** הרישיון כפי שהוא כתוב במשחק. ערך לא מוכר נקרא כקליקרים, כמו במנוע. */
export function licenseFromGame(game: GameFile): GameLicense {
  const type = game.setting.limit.type;
  const room = game.room ?? '';
  const kind: LicenseKind = type === 'phones' || type === 'both' ? type : 'clickers';
  // חסר / "" (שהסכימה הופכת ל-MAX_SAFE_INTEGER) = ללא הגבלה. כל מספר אחר נקרא
  // כמו שהוא — גם 0 — כדי שהעורך יציג אותו ובדיקת הרישיון תסמן אותו.
  const number = game.setting.limit.number;
  const limit =
    typeof number === 'number' && Number.isFinite(number) && number !== Number.MAX_SAFE_INTEGER
      ? number
      : null;
  return { kind, limit, room };
}

/** כתיבת הרישיון לתוך המשחק. מחזיר עותק; המקור לא משתנה. */
export function applyLicense(game: GameFile, license: GameLicense): GameFile {
  const limit: GameFile['setting']['limit'] = { type: license.kind };
  if (license.limit !== null) limit.number = license.limit;
  return {
    ...game,
    room: includesPhones(license.kind) ? license.room.trim() : null,
    setting: { ...game.setting, limit },
  };
}

/** מה לא תקין ברישיון, או null. ההודעות מוצגות כמו שהן. */
export function licenseProblem(license: GameLicense): string | null {
  if (license.limit !== null && (!Number.isInteger(license.limit) || license.limit < 1)) {
    return 'מספר המשתתפים חייב להיות מספר שלם, 1 ומעלה';
  }
  if (includesPhones(license.kind) && !ROOM_PATTERN.test(license.room.trim())) {
    return 'קוד החדר לטלפונים צריך להיות 3 עד 6 ספרות';
  }
  return null;
}

/**
 * אילו מקורות הצבעה הרישיון מתיר. ברירת המחדל של המסך (שני המקורות) נשארת
 * לכל משחק שלא נבנה במחשב, כי רישיון "גם וגם" מהמערכת יוצא אצלה כ-'phones'.
 */
export function licenseSources(game: GameFile): { clickers: boolean; phones: boolean } {
  const { kind } = licenseFromGame(game);
  return { clickers: includesClickers(kind), phones: includesPhones(kind) };
}
