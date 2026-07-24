/**
 * גיבוי אופליין לדיסק (EXE): שכבת תעבורה מקומית המקבילה לגיבוי האונליין
 * (Supabase). משתמשת באותם טיפוסי BackupPayload/BackupData, כך שבניית המטען
 * (buildBackupPayload) והשחזור (backupToSnapshot/rosterFromBackup) משותפים —
 * רק ה"היכן נשמר" שונה: קובץ JSON ב-userData/backups לפי מזהה המשחק.
 */

import type { BackupData, BackupPayload } from './backup.ts';
import { canDiskBackup, desktopBackupSave, desktopBackupLoad } from './clickerBridge.ts';

export { canDiskBackup };

/** שמירת מצב המשחק לדיסק (completed=true נועל את הגיבוי בסיום המשחק). */
export async function saveDiskBackup(
  gameId: string,
  payload: BackupPayload,
  completed: boolean,
): Promise<void> {
  const data: BackupData = { id: gameId, ...payload, completed };
  await desktopBackupSave(gameId, JSON.stringify(data));
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
