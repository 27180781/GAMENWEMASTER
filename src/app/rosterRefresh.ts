/**
 * רענון שמות המשתתפים באמצע הפעלה אונליין (‎?game=URL‎).
 *
 * קובץ המשחק נמשך פעם אחת, כשהקישור נפתח. שמות שנוספו בבונה אחרי זה (למשל
 * אקסל שיובא בזמן שהלשונית כבר פתוחה) לא הגיעו למסך, לתוצאות ולאקסל: המשחק
 * «בחירות», 2026-10-25, 87 שמות שיובאו 52 דקות לפני «התחל» — וכל המשחק הוצגו
 * מספרי טלפון. לכן המנחה מושך שוב את הקובץ כשהמשחק מתחיל, וכשמגיע מצביע שאינו
 * במרשם, וממזג **רק את השמות והקבוצות** (syncRosterWithFile, אותו מיזוג של
 * הטעינה). תוכן המשחק עצמו (שקופיות, הגדרות) אינו מוחלף כאן.
 *
 * הכללים כאן טהורים כדי שאפשר יהיה לבדוק אותם; החיבור ב-GameHost.
 */

import { displayName, type RosterData } from './roster.ts';

/**
 * האם מצביע שהגיע מהטלפון שווה משיכה חוזרת של הקובץ: רק מזהה שעדיין אין לו שם
 * במרשם, שהשרת לא שלח איתו שם (מצביע מקישור מזוהה בשם שהקליד, ושם אין מה
 * להשלים), ושלא ביקשנו עליו כבר. כל מזהה מבקש פעם אחת לכל היותר, כך שמספר
 * שבאמת אינו ברשימה לא גורם למשיכות חוזרות לאורך כל המשחק.
 */
export function shouldRefreshForVoter(
  roster: RosterData,
  voterId: string,
  serverName: string | undefined,
  asked: ReadonlySet<string>,
): boolean {
  const id = voterId.trim();
  if (id === '') return false;
  // שם מהשרת = יש שם. חריג: מספר טלפון שהשרת שלח גם בתור «שם» (בקישור מהטלפון
  // המזהה הוא השם שהוקלד, ושם השם והמזהה זהים בכוונה).
  const named = serverName !== undefined && serverName.trim() !== '';
  if (named && !(serverName.trim() === id && /^\+?\d+$/.test(id))) return false;
  if (asked.has(id)) return false;
  return displayName(roster, id) === id;
}

export interface RefreshScheduler {
  /** בקשת רענון. בקשות שמגיעות בזמן ריצה או בתוך המרווח מתאחדות לריצה אחת. */
  request(): void;
  /** ביטול טיימר ממתין (פירוק הרכיב). ריצה שכבר יצאה מסתיימת, אבל לא תתוזמן אחרת. */
  dispose(): void;
}

/**
 * מתזמן עם איחוד ומרווח מינימלי: לכל היותר ריצה אחת בכל רגע, ולכל היותר ריצה
 * אחת בכל `minIntervalMs`. בקשה בזמן ריצה או בתוך המרווח מסמנת ריצה אחת נוספת
 * בסוף המרווח (גם אם הגיעו עשרות בקשות). כישלון של ריצה אינו עוצר את הבאות.
 */
export function createRefreshScheduler(
  run: () => Promise<void>,
  minIntervalMs: number,
  clock: {
    now: () => number;
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  } = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  },
): RefreshScheduler {
  let running = false;
  let queued = false;
  let lastStart = -Infinity;
  let timer: unknown = null;
  let disposed = false;

  const start = () => {
    timer = null;
    if (disposed) return;
    queued = false;
    running = true;
    lastStart = clock.now();
    void run()
      .catch(() => undefined)
      .finally(() => {
        running = false;
        if (queued && !disposed) schedule();
      });
  };

  const schedule = () => {
    if (timer !== null || running) return;
    const wait = Math.max(0, lastStart + minIntervalMs - clock.now());
    if (wait === 0) start();
    else timer = clock.setTimeout(start, wait);
  };

  return {
    request() {
      if (disposed) return;
      queued = true;
      schedule();
    },
    dispose() {
      disposed = true;
      if (timer !== null) clock.clearTimeout(timer);
      timer = null;
    },
  };
}
