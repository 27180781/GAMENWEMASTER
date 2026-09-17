/**
 * קריאות האווירה של הקריין (`amb_*`) — **טהור לגמרי**: רשימות הניסוחים
 * החלופיים לכל מצב, וסיבוב דטרמיניסטי ביניהם.
 *
 * ENGINE-narration.md סעיף 1.1: לכל מצב יש כמה ניסוחים, המנוע מסובב ביניהם
 * ואינו משמיע פעמיים ברצף את אותו ניסוח. קטע שחסר בבנק מדולג בשקט — כך משחק
 * שנוצר לפני הרחבת הבנק פשוט שקט יותר, ואינו נשבר.
 *
 * **אין כאן Math.random**: הבחירה נשענת על מונה לכל מצב שיושב בזיכרון הבמאי,
 * כדי שהבדיקות יהיו יציבות והבמאי יישאר פונקציה טהורה של (מצב, זיכרון).
 */

/** מונה סיבוב לכל מצב: מזהה המצב → האינדקס שממנו מתחילים בפעם הבאה. */
export type AmbienceRotation = Readonly<Record<string, number>>;

export interface AmbiencePick {
  /** מפתח הבנק שנבחר, או null כשאף ניסוח של המצב אינו קיים בבנק. */
  key: string | null;
  /** הזיכרון המעודכן (אותו אובייקט עצמו כשלא נבחר דבר). */
  rotation: AmbienceRotation;
}

/**
 * בוחר ניסוח למצב: מתחיל מהאינדקס ששמור למצב הזה, מדלג על כל ניסוח שחסר
 * בבנק, ומקדם את המונה לניסוח הבא. כל עוד שני ניסוחים ומעלה קיימים בבנק,
 * אותו ניסוח לעולם לא נאמר פעמיים ברצף; כשקיים רק אחד — הוא נאמר שוב (אין
 * חלופה), וכשאין אף אחד — השורה כולה נופלת בשקט.
 */
export function pickAmbience(
  situation: string,
  variants: readonly string[],
  bank: Record<string, string>,
  rotation: AmbienceRotation,
): AmbiencePick {
  const count = variants.length;
  if (count === 0) return { key: null, rotation };
  const stored = rotation[situation] ?? 0;
  const start = ((stored % count) + count) % count;
  for (let step = 0; step < count; step += 1) {
    const index = (start + step) % count;
    const key = variants[index]!;
    const url = bank[key];
    if (url !== undefined && url !== '') {
      return { key, rotation: { ...rotation, [situation]: (index + 1) % count } };
    }
  }
  return { key: null, rotation };
}

// ---------------------------------------------------------------------------
// רשימות הניסוחים (הקטלוג: supabase/functions/_shared/narrationBank.ts, קבוצת
// "amb"). מפתח שאינו בבנק של המשחק מדולג — ולכן מותר להוסיף כאן ניסוחים
// שמשחקים ותיקים אינם מכירים.
// ---------------------------------------------------------------------------

export const AMB_LOBBY = [
  'amb_lobby_1',
  'amb_lobby_2',
  'amb_lobby_3',
  'amb_lobby_4',
  'amb_lobby_5',
  'amb_lobby_nearly',
] as const;
export const AMB_START = ['amb_start_1', 'amb_start_2', 'amb_start_3'] as const;
export const AMB_NEXT = ['amb_next_1', 'amb_next_2', 'amb_next_3'] as const;
export const AMB_VOTING = ['amb_voting_1', 'amb_voting_2', 'amb_voting_3'] as const;
export const AMB_ALL_CORRECT = ['amb_all_correct_1', 'amb_all_correct_2'] as const;
export const AMB_NONE_CORRECT = ['amb_none_correct_1', 'amb_none_correct_2'] as const;
export const AMB_RAFFLE = ['amb_raffle_1', 'amb_raffle_2'] as const;
/** רוב המשתתפים צדקו — «מהירות מרשימה» הוא ניסוח חלופי לאותו רגע. */
export const AMB_MOST_CORRECT = ['amb_most_correct', 'amb_fast'] as const;
/** הפרש זעום בראש הטבלה: אומרים שצמוד, לא כמה. */
export const AMB_CLOSE_RACE = ['amb_close_race', 'amb_still_open'] as const;
/** אחרי המקום הראשון. */
export const AMB_CONGRATS = ['amb_congrats', 'amb_winner_cheer'] as const;

/**
 * מתי ההפרש בראש הטבלה נחשב «צמוד»: עד חלק אחד מעשרים מניקוד המוביל. מעל
 * זה אומרים את ההפרש עצמו, שהוא המידע המעניין.
 */
export const CLOSE_RACE_RATIO = 20;

/** כל כמה זמן נאמרת קריאת אווירה במסך ההתחברות (ms). */
export const LOBBY_INTERVAL_MS = 45_000;

/** כל קריאה שלישית בלובי היא מספר המחוברים ולא ניסוח כללי. */
export const LOBBY_COUNT_EVERY = 3;

/**
 * "מהר!" — כמה שניות לפני סגירת ההצבעה. **שתיים**, כלשון החוזה
 * (ENGINE-narration.md 1.2: "בשתי השניות האחרונות amb_hurry").
 */
export const HURRY_SECONDS = 2;
