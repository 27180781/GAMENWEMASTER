/**
 * מה לעשות עם המשחקים שהמנהל שלח למחשב (electron/deviceSync.cjs מביא את
 * הרשימה; כאן מחליטים). טהור — בלי React ובלי Electron — ראו
 * tests/devicePlan.test.ts.
 *
 * העיקרון: התוכנה עובדת תמיד, גם בלי רשת, והמשלוח מהמערכת לעולם אינו קוטע
 * אירוע. לכן:
 * - הורדה ברקע רק כשאין משחק חי, ורק אם היא אינה מחליפה את החבילה של המשחק
 *   שעל המסך או עותק שנערך במחשב.
 * - פתיחה אוטומטית (כמו קוד שהוקלד) רק בפתיחת התוכנה, לפני שהמפעיל בחר
 *   משהו בעצמו — ופעם אחת בלבד. אחר כך: הודעה עם כפתור.
 */
import type { DeviceGame, DeviceState, LibraryGame } from './clickerBridge.ts';

/** כמה פעמים בכל הפעלה מנסים להוריד את אותה גרסה לפני שמוותרים (עד "נסו שוב"). */
export const MAX_ATTEMPTS = 2;

/**
 * - `new` — המשחק אינו במחשב.
 * - `update` — במחשב יש גרסה אחרת (או עותק שהגרסה שלו לא ידועה).
 * - `current` — הגרסה שבמחשב היא האחרונה.
 * - `no_license` / `unavailable` — אין מה להוריד עכשיו.
 */
export type DeliveryKind = 'new' | 'update' | 'current' | 'no_license' | 'unavailable';

export interface DeliveryItem {
  game: DeviceGame;
  kind: DeliveryKind;
  /** העותק שבמחשב: זה שבאותו קוד (שההורדה תחליף), ואחרת החדש ביותר. */
  copy: LibraryGame | null;
  /** החבילה שההורדה תחליף (אותו קוד) נערכה בעורך שבמחשב. */
  edited: boolean;
  /** החבילה שההורדה תחליף היא זו שעל המסך — מחליפים אותה רק אחרי סגירה. */
  targetOnScreen: boolean;
  /** המשחק הזה (לפי המזהה במערכת) הוא זה שעל המסך. */
  onScreen: boolean;
  /** על המסך עותק של המשחק שאינו הגרסה האחרונה. */
  screenOutdated: boolean;
  /** העותק שעל המסך נערך במחשב. */
  screenEdited: boolean;
}

/** מה מוצג עכשיו: הקוד בספרייה (null = קובץ ZIP / אין משחק) והמזהה במערכת. */
export interface OnScreen {
  code: string | null;
  gameId: string | null;
}

const lower = (s: string | null | undefined) => (typeof s === 'string' ? s.toLowerCase() : null);

/** מפתח לספירת ניסיונות: משחק + גרסה. גרסה חדשה מתחילה מאפס. */
export function attemptKey(game: DeviceGame): string {
  return `${game.gameId}@${game.version ?? ''}`;
}

/** לכל משחק שנשלח — מה מצבו במחשב. */
export function planDelivery(games: DeviceGame[], library: LibraryGame[], onScreen: OnScreen): DeliveryItem[] {
  const screenCode = onScreen.code;
  const screenGameId = lower(onScreen.gameId);
  const screenCopy = screenCode === null ? undefined : library.find((g) => g.code === screenCode);
  return games.map((game) => {
    const gameId = game.gameId.toLowerCase();
    const copies = library.filter((g) => g.local !== true && lower(g.gameId) === gameId);
    const target = game.code === null ? undefined : copies.find((g) => g.code === game.code);
    const newest = [...copies].sort((a, b) => b.savedAt - a.savedAt)[0];
    const copy = target ?? newest ?? null;
    let kind: DeliveryKind;
    if (game.code === null || game.version === null) kind = game.reason === 'unavailable' ? 'unavailable' : 'no_license';
    else if (copy === null) kind = 'new';
    else kind = copy.version === game.version ? 'current' : 'update';
    const onScreenNow = screenGameId === gameId;
    const screenIsCopy = screenCopy !== undefined && screenCopy.local !== true && lower(screenCopy.gameId) === gameId;
    return {
      game,
      kind,
      copy,
      edited: (target?.editedAt ?? 0) > 0,
      targetOnScreen: game.code !== null && game.code === screenCode,
      onScreen: onScreenNow,
      screenOutdated:
        onScreenNow && game.version !== null && (!screenIsCopy || screenCopy.version !== game.version) && kind !== 'no_license' && kind !== 'unavailable',
      screenEdited: screenIsCopy && (screenCopy.editedAt ?? 0) > 0,
    };
  });
}

export type DeliveryAction =
  /** הורדה בלי לגעת במסך. pendingOpen = "נשלח ועוד לא נפתח". */
  | { type: 'background'; item: DeliveryItem; pendingOpen: boolean }
  /** המשחק שעל המסך מתעדכן: סגירה, הורדה, ופתיחה מחדש. */
  | { type: 'foreground'; item: DeliveryItem }
  /** פתיחת משחק שכבר הורד. */
  | { type: 'open'; item: DeliveryItem };

export interface DeliveryContext {
  /** אין משחק חי ואין התחלה בדרך. */
  quiet: boolean;
  /** הורדה (של המפעיל או של המחשב) כבר פעילה. */
  busy: boolean;
  /**
   * מה מותר לפתוח לבד: null = כלום (המפעיל כבר בחר, או שזה כבר קרה),
   * 'any' = בפתיחת התוכנה, מזהה משחק = רק המשחק שההורדה שלו התחילה אז.
   */
  auto: null | 'any' | string;
  /** כמה פעמים כבר ניסינו להוריד את הגרסה הזו (attemptKey). */
  attempts: (key: string) => number;
}

/** הצעד הבא, או null — אין מה לעשות עכשיו. */
export function nextDeliveryAction(items: DeliveryItem[], ctx: DeliveryContext): DeliveryAction | null {
  if (!ctx.quiet || ctx.busy) return null;
  const canTry = (i: DeliveryItem) => ctx.attempts(attemptKey(i.game)) < MAX_ATTEMPTS;
  const autoFor = (i: DeliveryItem) => ctx.auto === 'any' || ctx.auto === i.game.gameId.toLowerCase();

  // 1. משחק שנשלח, הורד וממתין — נפתח כמו קוד שהוקלד. החדש ביותר קודם.
  if (ctx.auto !== null) {
    const pending = items
      .filter((i) => i.kind === 'current' && i.copy?.pendingOpen === true && !i.onScreen && autoFor(i))
      .sort((a, b) => (b.copy?.savedAt ?? 0) - (a.copy?.savedAt ?? 0))[0];
    if (pending !== undefined) return { type: 'open', item: pending };
  }

  // 2. משחק חדש — הורדה ברקע; ייפתח (צעד 1) רק אם עוד מותר.
  const fresh = items.find((i) => i.kind === 'new' && canTry(i));
  if (fresh !== undefined) return { type: 'background', item: fresh, pendingOpen: true };

  // 3. עדכון שאינו נוגע במסך ובעותק שנערך — ברקע. "ממתין לפתיחה" נשמר.
  const update = items.find((i) => i.kind === 'update' && !i.targetOnScreen && !i.edited && canTry(i));
  if (update !== undefined) {
    return { type: 'background', item: update, pendingOpen: update.copy?.pendingOpen === true };
  }

  // 4. בפתיחת התוכנה: המשחק שעל המסך אינו הגרסה האחרונה (ולא נערך כאן).
  if (ctx.auto === 'any') {
    const screen = items.find((i) => i.screenOutdated && !i.screenEdited && canTry(i));
    if (screen !== undefined) {
      if (screen.kind === 'update' && screen.targetOnScreen && !screen.edited) return { type: 'foreground', item: screen };
      // הגרסה האחרונה כבר במחשב בקוד אחר (רישיון שחודש) — פשוט פותחים אותה.
      if (screen.kind === 'current') return { type: 'open', item: screen };
    }
  }
  return null;
}

/** נוסח קצר למצב של משחק שנשלח, לרשימה במסך הפתיחה. */
export function deliveryStatusText(item: DeliveryItem, downloadingCode: string | null): string {
  if (item.game.code !== null && item.game.code === downloadingCode) return 'מוריד…';
  switch (item.kind) {
    case 'new':
      return 'ממתין להורדה';
    case 'update':
      return item.edited ? 'יש עדכון (העותק כאן נערך)' : 'יש עדכון';
    case 'current':
      return item.copy?.pendingOpen === true ? 'הורד, ממתין לפתיחה' : 'במחשב ✓';
    case 'no_license':
      return 'אין רישיון בתוקף';
    case 'unavailable':
      return 'לא זמין כרגע';
  }
}

/** "4821-7730". */
export function formatDeviceId(id: string): string {
  return /^[1-9][0-9]{7}$/.test(id) ? `${id.slice(0, 4)}-${id.slice(4)}` : id;
}

/** "נבדק לפני 3 דקות". */
export function checkedAgoText(checkedAt: number | null, now: number): string {
  if (checkedAt === null) return '';
  const minutes = Math.max(0, Math.floor((now - checkedAt) / 60000));
  if (minutes < 1) return 'נבדק עכשיו';
  if (minutes === 1) return 'נבדק לפני דקה';
  if (minutes < 60) return `נבדק לפני ${minutes} דקות`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? 'נבדק לפני שעה' : `נבדק לפני ${hours} שעות`;
}

/**
 * «השבתת התוכנה» (DeviceState.blocked): מסך הנעילה מחליף כל מסך, חוץ ממה
 * שאסור לקטוע — משחק שרץ או מתחיל (הספירה לאחור), עורך פתוח ובניית משחק חדש.
 * הם ממשיכים, והנעילה מופיעה כשהם נסגרים. ההשבתה עצמה מגיעה רק מתשובה מפורשת
 * של המערכת למחשב הזה; בלעדיה התוכנה תמיד פתוחה.
 */
export function deviceLockShown(s: { blocked: boolean; playing: boolean; editing: boolean }): boolean {
  return s.blocked && !s.playing && !s.editing;
}

/** שורת המצב במסך הנעילה: מתי נבדק, או למה לא. */
export function lockStatusText(s: Pick<DeviceState, 'state' | 'syncing' | 'checkedAt'>, now: number): string {
  if (s.syncing || s.state === 'starting') return 'בודק מול המערכת…';
  const ago = checkedAgoText(s.checkedAt, now);
  switch (s.state) {
    case 'ok':
      return ago;
    case 'offline':
      return 'אין חיבור לאינטרנט. התוכנה תיבדק שוב כשהמחשב יתחבר';
    default:
      return `הבדיקה מול המערכת לא הצליחה, ננסה שוב${ago ? ` · ${ago}` : ''}`;
  }
}
