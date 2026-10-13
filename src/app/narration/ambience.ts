/**
 * קריאות האווירה של הקריין (`amb_*`) — **טהור לגמרי**: רשימות הניסוחים
 * החלופיים לכל מצב, וסיבוב דטרמיניסטי ביניהם.
 *
 * ENGINE-narration.md סעיף 1.1: לכל מצב יש כמה ניסוחים, המנוע מסובב ביניהם
 * ואינו משמיע פעמיים ברצף את אותו ניסוח. קטע שחסר בבנק מדולג בשקט — כך משחק
 * שנוצר לפני הרחבת הבנק פשוט שקט יותר, ואינו נשבר.
 *
 * **אין כאן Math.random**: הבחירה נשענת על מונה לכל מצב שיושב בזיכרון הבמאי,
 * כדי שהבדיקות יהיו יציבות והבמאי יישאר פונקציה טהורה של (מצב, זיכרון). מצב
 * שעוד לא נבחר בו דבר מתחיל מ-`start` — ה-host מגריל אותו פעם אחת לכל ריצה
 * (`emptyNarrationMemory(seed)`), אחרת קריאה של «פעם אחת למשחק» (`amb_start_*`)
 * הייתה תמיד הניסוח הראשון, והלובי היה פותח תמיד באותו סדר.
 */

/** מונה סיבוב לכל מצב: מזהה המצב → האינדקס שממנו מתחילים בפעם הבאה. */
export type AmbienceRotation = Readonly<Record<string, number>>;

export interface AmbienceOptions {
  /** מאיזה אינדקס מתחיל מצב שעוד לא נבחר בו ניסוח (ברירת מחדל 0). */
  start?: number;
  /**
   * ניסוחים שאסור לבחור עכשיו, כאילו חסרו בבנק. כך רשימה אחת ומונה אחד
   * משרתים כמה מקרים (סקר בלי «מי שבטוח», לובי בלי שלטים): רשימות נפרדות
   * באורכים שונים על אותו מצב היו מזיזות את המונה, וניסוח היה חוזר ברצף.
   */
  skip?: ReadonlySet<string> | undefined;
  /**
   * ניסוח שעדיף לא לבחור (למשל הניסוח שנאמר בפעם הקודמת במצב קרוב), אלא אם
   * אין שום חלופה אחרת — אז הוא נאמר בכל זאת, כמו ניסוח יחיד בבנק.
   */
  avoid?: string | null | undefined;
}

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
  options: AmbienceOptions = {},
): AmbiencePick {
  const count = variants.length;
  if (count === 0) return { key: null, rotation };
  const stored = rotation[situation] ?? options.start ?? 0;
  const first = ((stored % count) + count) % count;
  const avoid = options.avoid ?? null;
  for (const strict of avoid === null ? [false] : [true, false]) {
    for (let step = 0; step < count; step += 1) {
      const index = (first + step) % count;
      const key = variants[index]!;
      if (options.skip?.has(key) || (strict && key === avoid)) continue;
      const url = bank[key];
      if (url !== undefined && url !== '') {
        return { key, rotation: { ...rotation, [situation]: (index + 1) % count } };
      }
    }
  }
  return { key: null, rotation };
}

// ---------------------------------------------------------------------------
// רשימות הניסוחים (הקטלוג: supabase/functions/_shared/narrationBank.ts, קבוצת
// "amb"). מפתח שאינו בבנק של המשחק מדולג — ולכן מותר להוסיף כאן ניסוחים
// שמשחקים ותיקים אינם מכירים.
// ---------------------------------------------------------------------------

/**
 * הסדר משולב בכוונה: שני ה«מוכנים?» (6, 7) ושני ה«עוד מעט מתחילים» (3, 5)
 * אינם סמוכים. בלי שלטים `amb_lobby_4` מדולג, ו-`amb_lobby_nearly` מדולג עד
 * LOBBY_NEARLY_AFTER — שניהם דרך `skip`, על אותו מונה.
 */
export const AMB_LOBBY = [
  'amb_lobby_1',
  'amb_lobby_6',
  'amb_lobby_2',
  'amb_lobby_3',
  'amb_lobby_7',
  'amb_lobby_4',
  'amb_lobby_5',
  'amb_lobby_nearly',
] as const;
export const AMB_START = [
  'amb_start_1',
  'amb_start_2',
  'amb_start_3',
  'amb_start_4',
  'amb_start_5',
] as const;
export const AMB_NEXT = ['amb_next_1', 'amb_next_2', 'amb_next_3'] as const;
/**
 * בסקר `amb_voting_3` («מי שבטוח, שילחץ») מדולג דרך `skip` — אין במה להיות
 * בטוח. לטריוויה ולסקר מונה נפרד, והניסוח של חלון ההצבעה הקודם נמנע (`avoid`):
 * מונה משותף היה ננעל בהחלפה בין טריוויה לסקר על שני ניסוחים, ו«מי שבטוח»
 * לא היה נשמע יותר.
 */
export const AMB_VOTING = ['amb_voting_1', 'amb_voting_2', 'amb_voting_3'] as const;
/**
 * ניסוחי «מוכנים?» — אחרי אחד מהם בלובי, «מתחילים!» לא פותח שוב ב«מוכנים?»
 * (`amb_start_4`), אחרת החדר שומע «מוכנים? מחממ—» «מוכנים? יוצאים לדרך!».
 */
export const AMB_READY_LOBBY: ReadonlySet<string> = new Set(['amb_lobby_6', 'amb_lobby_7']);
export const AMB_READY_START = 'amb_start_4';
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

/**
 * כל כמה זמן נאמרת קריאת אווירה במסך ההתחברות (ms) — נמדד מהקריאה הקודמת.
 * קריאות שהוחמצו (שכבה פתוחה, אודיו נעול) אינן מושלמות בצרור: כל קריאה חדשה
 * קוטעת את הקודמת, וצרור היה חותך את כולן.
 */
export const LOBBY_INTERVAL_MS = 45_000;

/**
 * שעון הלובי נדגם כל 5 שניות, וכל דגימה מאחרת בכמה מילישניות משתנות
 * (45,003 ואחריה 90,001). מרווח שנמדד בין שתי דגימות קטן לפעמים במעט
 * מהמרווח הנומינלי, ובלי סובלנות הקריאה הייתה גולשת לדגימה הבאה (50 שניות
 * במקום 45). חצי דגימה מספיקה: ההפרשים בין דגימות הם כפולות של 5 שניות.
 */
export const LOBBY_SAMPLE_TOLERANCE_MS = 2_500;

/** כל קריאה שלישית בלובי היא מספר המחוברים ולא ניסוח כללי. */
export const LOBBY_COUNT_EVERY = 3;

/**
 * כל קריאה רביעית בלובי **מאז שההוראות נאמרו** (ושאינה מספר המחוברים) חוזרת
 * על הוראות ההצבעה — בשביל מי שהגיע אחרי «ברוכים הבאים». בלובי של עשר דקות זה
 * בערך פעמיים-שלוש. נספר מההוראות ולא מפתיחת הלובי: קריאות שעברו בשקט באודיו
 * נעול היו מקרבות את החזרה, וההוראות היו נשמעות פעמיים ברצף.
 */
export const LOBBY_HOWTO_EVERY = 4;

/**
 * כמה זמן הלובי שותק אחרי הוראות ההצבעה, גם כשקריאה הגיעה לתורה באותו צעד.
 * כל משפט חדש קוטע את הקודם, וההוראות ארוכות: כשהאודיו נפתח רגע לפני תור
 * הפטפוט, הקריאה הבאה הייתה חותכת אותן באמצע, והן אינן נאמרות שוב. נמדד על
 * שעון הלובי, שנדגם כל 5 שניות, ולכן בפועל לפחות 15 שניות: «ברוכים הבאים»
 * וההוראות יחד צריכים להיות קצרים מזה.
 */
export const LOBBY_AFTER_WELCOME_MS = 20_000;

/**
 * «כמעט כולם כאן» (amb_lobby_nearly) נאמר רק אחרי כמה קריאות לובי (כ-3 דקות),
 * גם כשנקודת ההתחלה של הסיבוב מוגרלת: בפתיחת הלובי החדר עוד ריק.
 */
export const LOBBY_NEARLY_AFTER = 4;

/**
 * "מהר!" — כמה שניות לפני סגירת ההצבעה. **שתיים**, כלשון החוזה
 * (ENGINE-narration.md 1.2: "בשתי השניות האחרונות amb_hurry").
 */
export const HURRY_SECONDS = 2;
