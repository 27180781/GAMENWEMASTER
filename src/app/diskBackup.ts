/**
 * גיבוי אופליין לדיסק (EXE): שכבת תעבורה מקומית המקבילה לגיבוי האונליין
 * (Supabase). משתמשת באותם טיפוסי BackupPayload/BackupData, כך שבניית המטען
 * (buildBackupPayload) והשחזור (backupToSnapshot/rosterFromBackup) משותפים —
 * רק ה"היכן נשמר" שונה: קובץ JSON ב-userData/backups לפי מזהה המשחק.
 */

import type { BackupData, BackupPayload } from './backup.ts';
import type { GameFile } from '../engine/index.ts';
import { canDiskBackup, desktopBackupSave, desktopBackupLoad } from './clickerBridge.ts';
import {
  fingerprintUsers,
  participantsFingerprint,
  usersWithoutParticipantIds,
  type GamePendingUser,
} from './roster.ts';

export { canDiskBackup };

/**
 * מפתח הגיבוי בדיסק: מזהה + שם המשחק + טביעת אצבע של רשימת המשתתפים.
 *
 * - **מזהה**: הבסיס הטבעי.
 * - **שם**: קבצי אופליין מגיעים לעיתים בלי id (הסכמה מתירה זאת) — מפתח לפי id
 *   בלבד היה גורם לכל המשחקים חסרי-ה-id לחלוק גיבוי אחד.
 * - **רשימת המשתתפים**: תיקיית הגיבויים משותפת לכל עותקי התוכנה במחשב (אותו
 *   appId). בלי הרכיב הזה, EXE שנחתם מחדש לאותו משחק עם משתתפים אחרים היה
 *   מקבל את *אותו* קובץ גיבוי — ומציע להמשיך אירוע קודם על ניקוד והצבעות של
 *   משתתפים אחרים. הרכיב לא משתנה בין הרצות של אותו קובץ, ולכן התאוששות
 *   מקריסה באמצע אירוע ממשיכה לעבוד בדיוק כמו קודם.
 *
 * כשהקובץ נושא מזהי משתתפים מהבונה, הרשימה נמדדת לפי *מי* המשתתפים ולא לפי
 * המחרוזת: מספר שלט שנקלט בלחיצה ונשמר בבונה משנה את `users`, ומחשב שהמשחק
 * משויך אליו מוריד את הגרסה החדשה כשהוא נפתח, גם אחרי קריסה באמצע אירוע. בלי
 * זה, ההמשך מהגיבוי היה הולך לאיבוד בדיוק אז.
 */
export function diskBackupKey(game: DiskBackupGame): string {
  const participants = participantsFingerprint({ users: game.users, pendingUsers: game.pendingUsers ?? [] });
  if (participants !== null) return `${game.id}::${game.name}::p.${participants}`;
  return legacyKey(game, String(game.users ?? ''));
}

/**
 * המפתחות שבהם מחפשים גיבוי, הראשי קודם: גם המפתח שגרסה קודמת של התוכנה נתנה
 * לאותה רשימה (לפני מזהי המשתתפים, ועם המזהים אבל לפי המחרוזת), כדי שעדכון
 * תוכנה או בונה באמצע אירוע לא יסתיר גיבוי קיים.
 */
export function diskBackupKeys(game: DiskBackupGame): string[] {
  const keys = [diskBackupKey(game)];
  const raw = String(game.users ?? '');
  const stripped = usersWithoutParticipantIds(raw);
  for (const key of [stripped === null ? null : legacyKey(game, stripped), legacyKey(game, raw)]) {
    if (key !== null && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

type DiskBackupGame = Pick<GameFile, 'id' | 'name' | 'users'> & {
  pendingUsers?: readonly GamePendingUser[];
};

function legacyKey(game: DiskBackupGame, users: string): string {
  return `${game.id}::${game.name}::${fingerprintUsers(users)}`;
}

/** שמירת מצב המשחק לדיסק (completed=true נועל את הגיבוי בסיום המשחק). */
export async function saveDiskBackup(
  gameId: string,
  payload: BackupPayload,
  completed: boolean,
): Promise<void> {
  const data: BackupData = { id: gameId, ...payload, completed };
  await desktopBackupSave(gameId, JSON.stringify(data));
}

/** הגיבוי הראשון שנמצא לפי סדר המפתחות (diskBackupKeys), או null. */
export async function loadDiskBackupAny(keys: readonly string[]): Promise<BackupData | null> {
  for (const key of keys) {
    const data = await loadDiskBackup(key);
    if (data !== null) return data;
  }
  return null;
}

/** שליפת גיבוי הדיסק של המשחק, או null. מנרמל שדות חסרים כמו שליפת האונליין. */
export async function loadDiskBackup(gameId: string): Promise<BackupData | null> {
  const json = await desktopBackupLoad(gameId);
  if (json === null || json.trim() === '') return null;
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    return {
      id: String(obj.id ?? gameId),
      users: (obj.users as BackupData['users']) ?? {},
      questions: (obj.questions as BackupData['questions']) ?? {},
      groups: (obj.groups as BackupData['groups']) ?? [],
      meta: (obj.meta as BackupData['meta']) ?? {
        currentQueId: null,
        phase: 'showing',
        startedAt: Date.now(),
      },
      completed: Boolean(obj.completed),
    };
  } catch {
    return null;
  }
}
