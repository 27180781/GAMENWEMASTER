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
export const JOIN_DIAL_NUMBER = '033064361';
export const JOIN_DIAL_DISPLAY = '03-306-4361';

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
 * דריסת המעברים האוטומטיים נשמרת ב-localStorage לפי מזהה המשחק — כך שהעדפת
 * המפעיל נשמרת בין רענונים, ומשחק חדש (id אחר) חוזר לברירת המחדל שלו מה-JSON.
 */
const AUTO_TRANSITION_KEY = (gameId: string) => `trivia:autoTransition:${gameId}`;

export function loadAutoTransition(
  gameId: string,
  defaults: AutoTransition = DEFAULT_AUTO_TRANSITION,
): AutoTransition | null {
  try {
    const raw = localStorage.getItem(AUTO_TRANSITION_KEY(gameId));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<AutoTransition>;
    return {
      showAnswersAfterQuestion: Boolean(parsed.showAnswersAfterQuestion),
      startTimerAfterLastAnswer: Boolean(parsed.startTimerAfterLastAnswer),
      showCorrectAnswerAfterTimer: Boolean(parsed.showCorrectAnswerAfterTimer),
      nextSlide: {
        active: Boolean(parsed.nextSlide?.active),
        seconds: Number(parsed.nextSlide?.seconds) || 6,
      },
      // דריסה שנשמרה לפני שנוסף מעבר-מדיה — לא "מכבים" את מה שהוגדר בקובץ
      // המשחק, אלא נופלים לברירת המחדל שלו (defaults).
      media: parsed.media === undefined
        ? defaults.media
        : {
            image: {
              active: Boolean(parsed.media.image?.active),
              seconds: Number(parsed.media.image?.seconds) || 5,
            },
            video: {
              playToEnd: Boolean(parsed.media.video?.playToEnd),
            },
          },
    };
  } catch {
    return null;
  }
}

export function saveAutoTransition(gameId: string, value: AutoTransition): void {
  try {
    localStorage.setItem(AUTO_TRANSITION_KEY(gameId), JSON.stringify(value));
  } catch {
    /* localStorage לא זמין — מתעלמים */
  }
}
