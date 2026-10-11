/**
 * מפתח הגיבוי בדיסק (EXE אופליין).
 *
 * תיקיית הגיבויים משותפת לכל עותקי התוכנה במחשב (אותו appId), ולכן המפתח הוא
 * מה שמפריד בין משחקים — וגם בין *מהדורות* של אותו משחק. הבדיקות כאן שומרות
 * על שני הכיוונים: הפרדה בין מהדורות, ויציבות בין הרצות של אותו קובץ (שבלעדיה
 * התאוששות מקריסה באמצע אירוע הייתה נשברת).
 */
import { describe, expect, it } from 'vitest';
import { diskBackupKey, diskBackupKeys } from '../src/app/diskBackup.ts';
import { fingerprintUsers } from '../src/app/roster.ts';

const usersA = JSON.stringify({
  101: { remoteId: '101', name: 'אבי', groupName: 'אדומים' },
  102: { remoteId: '102', name: 'דנה', groupName: 'כחולים' },
});
const usersB = JSON.stringify({
  201: { remoteId: '201', name: 'אבי', groupName: 'אדומים' },
  202: { remoteId: '202', name: 'דנה', groupName: 'כחולים' },
});

const game = { id: 'g1', name: 'משפחת בלוי', users: usersA };

describe('diskBackupKey', () => {
  it('יציב בין הרצות של אותו משחק — התאוששות מקריסה ממשיכה לעבוד', () => {
    expect(diskBackupKey(game)).toBe(diskBackupKey({ ...game }));
  });

  it('אותו משחק עם מספרי שלטים אחרים → מפתח אחר (מהדורה חדשה, גיבוי נפרד)', () => {
    expect(diskBackupKey({ ...game, users: usersB })).not.toBe(diskBackupKey(game));
  });

  it('שינוי בשם או במספר של משתתף גם הוא מפריד', () => {
    const renamed = JSON.parse(usersA) as Record<string, { name: string }>;
    renamed['101']!.name = 'אבי כהן';
    expect(diskBackupKey({ ...game, users: JSON.stringify(renamed) })).not.toBe(
      diskBackupKey(game),
    );
  });

  it('משחקים שונים נשארים מופרדים (id או שם)', () => {
    expect(diskBackupKey({ ...game, id: 'g2' })).not.toBe(diskBackupKey(game));
    expect(diskBackupKey({ ...game, name: 'משחק אחר' })).not.toBe(diskBackupKey(game));
  });

  it('בלי id (קובץ אופליין דק) — השם עדיין מפריד', () => {
    const a = diskBackupKey({ id: '', name: 'משחק א', users: usersA });
    const b = diskBackupKey({ id: '', name: 'משחק ב', users: usersA });
    expect(a).not.toBe(b);
  });

  it('רשימת משתתפים ריקה/חסרה — לא זורק, ושני המצבים מתלכדים', () => {
    const empty = diskBackupKey({ id: 'g1', name: 'משחק', users: '' });
    const missing = diskBackupKey({ id: 'g1', name: 'משחק' } as Parameters<
      typeof diskBackupKey
    >[0]);
    expect(empty).toBe(missing);
    expect(empty).not.toBe(diskBackupKey({ id: 'g1', name: 'משחק', users: usersA }));
  });
});

describe('diskBackupKey — משתתפים מזוהים מהבונה', () => {
  // לפני: «אבי» ממתין לשלט (pendingUsers). אחרי: המספר שנקלט בלחיצה נשמר
  // בבונה, ו«אבי» עבר ל-users עם המספר.
  const before = {
    id: 'g1',
    name: 'משפחת בלוי',
    users: JSON.stringify({
      102: { remoteId: '102', name: 'דנה', groupName: 'כחולים', participantId: 'p-dana' },
    }),
    pendingUsers: [{ id: 'p-avi', name: 'אבי', groupName: 'אדומים' }],
  };
  const after = {
    ...before,
    users: JSON.stringify({
      102: { remoteId: '102', name: 'דנה', groupName: 'כחולים', participantId: 'p-dana' },
      7: { remoteId: '7', name: 'אבי', groupName: 'אדומים', participantId: 'p-avi' },
    }),
    pendingUsers: [],
  };

  it('מספר שנשמר בבונה לא משנה את המפתח — ההמשך מקריסה שורד את ההורדה של הגרסה החדשה', () => {
    expect(diskBackupKey(after)).toBe(diskBackupKey(before));
  });

  it('משתתף שנוסף או נמחק בבונה → מפתח אחר', () => {
    const added = {
      ...before,
      pendingUsers: [...before.pendingUsers, { id: 'p-yosi', name: 'יוסי', groupName: '' }],
    };
    expect(diskBackupKey(added)).not.toBe(diskBackupKey(before));
    expect(diskBackupKey({ ...before, pendingUsers: [] })).not.toBe(diskBackupKey(before));
  });

  it('קובץ בלי מזהי משתתפים שומר על המפתח הישן', () => {
    expect(diskBackupKey({ ...game, pendingUsers: [] })).toBe(diskBackupKey(game));
  });

  it('diskBackupKeys: הראשי קודם, ואחריו המפתחות שגרסה קודמת נתנה לאותה רשימה', () => {
    const keys = diskBackupKeys(after);
    expect(keys[0]).toBe(diskBackupKey(after));
    // הבונה לפני שהוסיף את participantId: אותה מחרוזת בלי השדה.
    const withoutIds = JSON.stringify({
      102: { remoteId: '102', name: 'דנה', groupName: 'כחולים' },
      7: { remoteId: '7', name: 'אבי', groupName: 'אדומים' },
    });
    expect(keys).toContain(diskBackupKey({ id: 'g1', name: 'משפחת בלוי', users: withoutIds }));
    // התוכנה לפני השינוי, עם קובץ שכבר נושא את המזהים: לפי המחרוזת עצמה.
    expect(keys).toContain(`g1::משפחת בלוי::${fingerprintUsers(after.users)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('diskBackupKeys של קובץ ישן = המפתח הישן בלבד', () => {
    expect(diskBackupKeys(game)).toEqual([diskBackupKey(game)]);
  });
});
