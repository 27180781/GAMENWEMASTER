/**
 * פרמטרים בכתובת האפליקציה:
 *
 *   ?game=<URL של game.json>   — טעינת קובץ המשחק מהכתובת ופתיחתו ישירות.
 *   &demo=1                    — מדליק מראש את שחקני הדמה במסך ההגדרות.
 *   &push=<URL>                — ערוץ "פוש רענון": SSE (ברירת מחדל) או
 *                                WebSocket (ws://‎/wss://‎). כשמגיע אות בערוץ,
 *                                המשחק מרענן את התוכן בלי לאבד את מהלך המשחק.
 *
 * דוגמה: https://host/?game=https://example.com/game.json&push=https://example.com/events&demo=1
 */

export interface AppParams {
  /** כתובת קובץ משחק חיצוני, או null אם לא סופקה. */
  gameUrl: string | null;
  /** כתובת ערוץ הפוש (SSE/WebSocket) לרענון יזום, או null. */
  pushUrl: string | null;
  /** עקיפת כתובת שרת ההצבעות (ברירת מחדל: השרת הרשמי), או null. */
  voteServer: string | null;
  /** האם התבקש מצב דמו. */
  demo: boolean;
}

const TRUTHY = new Set(['', '1', 'true', 'yes', 'on']);

export function parseAppParams(search: string): AppParams {
  const params = new URLSearchParams(search);
  const rawGame = params.get('game');
  const gameUrl = rawGame !== null && rawGame.trim() !== '' ? rawGame.trim() : null;
  const rawPush = params.get('push');
  const pushUrl = rawPush !== null && rawPush.trim() !== '' ? rawPush.trim() : null;
  const rawServer = params.get('voteServer');
  const voteServer = rawServer !== null && rawServer.trim() !== '' ? rawServer.trim() : null;
  const rawDemo = params.get('demo');
  const demo = rawDemo !== null && TRUTHY.has(rawDemo.trim().toLowerCase());
  return { gameUrl, pushUrl, voteServer, demo };
}

/** כתובת האתר הראשי — יעד ההפניה כשנכנסים ל-URL הציבורי בלי קובץ משחק. */
export const MAIN_SITE_URL = 'https://clicker.co.il';

/**
 * האם להפנות לאתר הראשי במקום להציג את בורר קבצי הבדיקה. מפנים רק בווב הציבורי
 * וכשלא שורשר קובץ משחק (‎?game=‎). כך ב-URL הציבורי אפשר להפעיל אך ורק משחק אמיתי
 * שהקישור אליו מסופק — ולא לשחק בקבצי הבדיקה המקומיים. יוצאים מן הכלל (לא מפנים):
 *   • ‎file://‎ — ה-EXE האופליין, שבו הבורר טוען ZIP.
 *   • localhost / 127.0.0.1 / *.local / host ריק — פיתוח מקומי.
 */
export function shouldRedirectHome(opts: {
  protocol: string;
  hostname: string;
  hasGameUrl: boolean;
}): boolean {
  const { protocol, hostname, hasGameUrl } = opts;
  if (protocol === 'file:') return false;
  const host = hostname.toLowerCase();
  const local = host === 'localhost' || host === '127.0.0.1' || host === '' || host.endsWith('.local');
  if (local) return false;
  return !hasGameUrl;
}

/** מעברים אוטומטיים — ברירת מחדל מה-JSON, ניתן לדריסה בהגדרות ולשמירה. */
export interface AutoTransition {
  /** הצגת התשובות אוטומטית לאחר הצגת השאלה. */
  showAnswersAfterQuestion: boolean;
  /** התחלת הטיימר אוטומטית לאחר הצגת התשובה האחרונה. */
  startTimerAfterLastAnswer: boolean;
  /** הצגת התשובה הנכונה אוטומטית לאחר סיום הטיימר. */
  showCorrectAnswerAfterTimer: boolean;
  /** מעבר אוטומטי לשקופית הבאה לאחר X שניות. */
  nextSlide: { active: boolean; seconds: number };
  /**
   * מעבר אוטומטי של מדיה (חל על כל קבצי המדיה: openMedia לפני שאלה, endMedia
   * אחריה, ומסכי מדיה עצמאיים). תמונה — מעבר אחרי X שניות; סרטון (אחסון רגיל +
   * יוטיוב) — מתנגן עד הסוף ואז עובר.
   */
  media: {
    image: { active: boolean; seconds: number };
    video: { playToEnd: boolean };
  };
}

/**
 * הגדרות המשחק — נקבעות במסך ההגדרות (המסך הראשון, וגם נגיש בכפתור ⚙
 * בכל שלב במשחק).
 */
export interface GameSettings {
  /**
   * שחקני דמה פעילים: ההצבעות מגיעות מקהל מדומה במקום מהסוקט.
   * (עד M3 אין סוקט אמיתי — ולכן ברירת המחדל דלוקה.)
   */
  crowdEnabled: boolean;
  /** כמות שחקני הדמה. */
  voterCount: number;
  /** בתוך איזה חלק מחלון ההצבעה מגיעות כל ההצבעות (0–1; קטן = מהיר). */
  speedFactor: number;
  /** הסתברות לבחירת התשובה הנכונה ב-trivia (0–1). */
  correctBias: number;
  /** קצב שליחת snapshots ב-ms (השרת האמיתי שולח ~250ms). */
  intervalMs: number;
  /**
   * שלט מנחה: מזהה קליקר / מספר טלפון שההקשות שלו הן פקודות מנחה (0–6)
   * ולא הצבעות — הוא לא משתתף במשחק. ריק = אין שלט מנחה.
   */
  hostVoterId: string;
  /** מעברים אוטומטיים (ברירת מחדל מה-JSON, ניתן לדריסה ולשמירה ב-localStorage). */
  autoTransition: AutoTransition;
  /** הצגת QR להתחברות מטלפונים (רק במשחק אונליין עם רישיון, לא דמו). */
  showQr: boolean;
  /** הצגת פס הנחיות (חיוג + קוד) בתחתית המסך לאורך המשחק. */
  showBottomInstructions: boolean;
  /**
   * שורת כפתורי פקודה בתחתית המסך — כפתורים קטנים בכתב חלש (מתחזק בהובר) עם שם
   * הפקודה של כל מקש מנחה בשלב הנוכחי (המשך/חזור/מובילים...). לחיצה מריצה את
   * הפקודה. סותר את showBottomInstructions (לא ניתן להפעיל את שניהם יחד).
   */
  showBottomButtons: boolean;
  /**
   * אפשר להתחיל את המשחק *מיד*, בלי לחסום עד סיום טעינת כל המדיה. ברירת מחדל
   * false — כלומר חוסם: לחיצה על "התחל" ממתינה לסיום ההורדה (עם ניסיונות-חוזרים
   * על כשל) ואז ספירה-לאחור קצרה לפני מסך ההתחברות. true = ההתנהגות הישנה.
   */
  allowStartBeforeLoad: boolean;
  /**
   * מקורות הצבעה פעילים (כשהקהל המדומה כבוי). ניתן לבחור קליקרים (RF317, EXE),
   * טלפונים (סוקט אונליין, לפי קוד חדר), או שניהם יחד — אז ההצבעות ממוזגות.
   * ברירת המחדל: טלפונים דלוקים, קליקרים כבויים — כך המשחק האונליין לא משתנה.
   */
  voteClickers: boolean;
  votePhones: boolean;
}

/** כתובת ההתחברות מהטלפון עבור קוד QR — לפי קוד המשחק (room). */
export function joinQrUrl(room: string): string {
  return `https://clicker.clicker.co.il/?game=${encodeURIComponent(room)}`;
}

/** מספר החיוג להצטרפות למשחקי טלפונים — גולמי (לחיוג) ותצוגה (מקובץ לקריאוּת). */
export const JOIN_DIAL_NUMBER = '1700111948';
export const JOIN_DIAL_DISPLAY = '1700-111-948';

/**
 * מספר החיוג שמוצג במשחק: `setting.joinDial` כשמערכת יצירת המשחקים שולחת אותו
 * (ההגדרה «מספר החיוג להצטרפות» ב«הגדרות מערכת» שם, כך שמחליפים את המספר במקום
 * אחד בלי גרסת מנוע חדשה), ואחרת המספר הקבוע למעלה. חבילת אופליין אינה נושאת
 * אותו, ולכן תוכנת ההרצה מציגה את המספר שבגרסה שלה. ערך שאינו מספר טלפון (7–15
 * ספרות, עם מקפים או רווחים בלבד) נזרק.
 */
export function joinDialDisplay(joinDial: unknown): string {
  if (typeof joinDial !== 'string') return JOIN_DIAL_DISPLAY;
  const value = joinDial.trim();
  if (!/^[0-9][0-9 -]*[0-9]$/.test(value)) return JOIN_DIAL_DISPLAY;
  const digits = value.replace(/\D/g, '').length;
  return digits >= 7 && digits <= 15 ? value : JOIN_DIAL_DISPLAY;
}

export const DEFAULT_AUTO_TRANSITION: AutoTransition = {
  showAnswersAfterQuestion: false,
  startTimerAfterLastAnswer: false,
  showCorrectAnswerAfterTimer: false,
  nextSlide: { active: false, seconds: 6 },
  media: { image: { active: false, seconds: 5 }, video: { playToEnd: false } },
};

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  // ברירת מחדל: משחק אונליין רגיל (שחקנים אמיתיים). שחקני דמה נדלקים רק
  // כשהקישור כולל ‎?demo=1‎.
  crowdEnabled: false,
  voterCount: 40,
  speedFactor: 0.6,
  correctBias: 0.55,
  intervalMs: 300,
  hostVoterId: '',
  autoTransition: DEFAULT_AUTO_TRANSITION,
  showQr: false,
  showBottomInstructions: false,
  showBottomButtons: false,
  allowStartBeforeLoad: false,
  // ברירת מחדל: טלפונים (סוקט) דלוקים, קליקרים כבויים — המשחק האונליין כשהיה.
  voteClickers: false,
  votePhones: true,
};

/**
 * דריסת המעברים האוטומטיים של המפעיל נשמרת ב-localStorage לפי מזהה המשחק, כדי
 * שבחירה שעשה במסך ההגדרות תישמר בין רענונים.
 *
 * לצד הבחירה נשמר גם מה שהיה בקובץ המשחק באותו רגע (`file`). כשההגדרה בבונה
 * משתנה אחר כך, הקובץ כבר אינו זהה ל-`file` והדריסה נמחקת: שינוי בבונה תמיד
 * מגיע להפעלה. עד 2026-11 כל «התחל» שמר עותק של ההגדרות גם כשהמפעיל לא נגע בהן,
 * בלי `file`, ומאותו רגע ההגדרה מהבונה לא הגיעה יותר לאותו דפדפן (המשחק «שבת
 * התאחדות», 2026-11-12). לכן הדריסות הישנות (המפתח בלי `v2`) נמחקות, ושמירה של
 * ערך שזהה לקובץ מוחקת את הדריסה במקום לשמור אותה.
 */
const LEGACY_AUTO_TRANSITION_KEY = (gameId: string) => `trivia:autoTransition:${gameId}`;
const AUTO_TRANSITION_KEY = (gameId: string) => `trivia:autoTransition:v2:${gameId}`;

/** צורה קבועה (סדר מפתחות וטיפוסים) — להשוואה ולשמירה. */
function normalizeAutoTransition(
  raw: Partial<AutoTransition> | undefined,
  defaults: AutoTransition = DEFAULT_AUTO_TRANSITION,
): AutoTransition {
  const r = raw ?? {};
  const media = r.media === undefined ? defaults.media : r.media;
  return {
    showAnswersAfterQuestion: Boolean(r.showAnswersAfterQuestion),
    startTimerAfterLastAnswer: Boolean(r.startTimerAfterLastAnswer),
    showCorrectAnswerAfterTimer: Boolean(r.showCorrectAnswerAfterTimer),
    nextSlide: {
      active: Boolean(r.nextSlide?.active),
      seconds: Number(r.nextSlide?.seconds) || 6,
    },
    media: {
      image: {
        active: Boolean(media?.image?.active),
        seconds: Number(media?.image?.seconds) || 5,
      },
      video: {
        playToEnd: Boolean(media?.video?.playToEnd),
      },
    },
  };
}

function sameAutoTransition(a: AutoTransition, b: AutoTransition): boolean {
  return JSON.stringify(normalizeAutoTransition(a)) === JSON.stringify(normalizeAutoTransition(b));
}

function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* localStorage לא זמין — מתעלמים */
  }
}

/**
 * הדריסה של המפעיל למשחק הזה, או null כשאין (ואז חלה ההגדרה מהקובץ). דריסה
 * שנשמרה מול הגדרה אחרת בקובץ (הבונה שונה מאז) נמחקת ומחזירה null.
 */
export function loadAutoTransition(
  gameId: string,
  fileValue: AutoTransition = DEFAULT_AUTO_TRANSITION,
): AutoTransition | null {
  removeKey(LEGACY_AUTO_TRANSITION_KEY(gameId));
  try {
    const raw = localStorage.getItem(AUTO_TRANSITION_KEY(gameId));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as { file?: Partial<AutoTransition>; value?: Partial<AutoTransition> };
    if (parsed === null || typeof parsed !== 'object' || parsed.file === undefined || parsed.value === undefined) {
      removeKey(AUTO_TRANSITION_KEY(gameId));
      return null;
    }
    if (!sameAutoTransition(normalizeAutoTransition(parsed.file), fileValue)) {
      removeKey(AUTO_TRANSITION_KEY(gameId));
      return null;
    }
    return normalizeAutoTransition(parsed.value, fileValue);
  } catch {
    return null;
  }
}

/**
 * שמירת הבחירה של המפעיל. ערך שזהה למה שבקובץ אינו דריסה, ולכן מוחק את מה
 * שנשמר — כך «התחל» בלי שינוי לא נועל את ההגדרה מהבונה.
 */
export function saveAutoTransition(
  gameId: string,
  value: AutoTransition,
  fileValue: AutoTransition = DEFAULT_AUTO_TRANSITION,
): void {
  removeKey(LEGACY_AUTO_TRANSITION_KEY(gameId));
  if (sameAutoTransition(value, fileValue)) {
    removeKey(AUTO_TRANSITION_KEY(gameId));
    return;
  }
  try {
    localStorage.setItem(
      AUTO_TRANSITION_KEY(gameId),
      JSON.stringify({ file: normalizeAutoTransition(fileValue), value: normalizeAutoTransition(value, fileValue) }),
    );
  } catch {
    /* localStorage לא זמין — מתעלמים */
  }
}
