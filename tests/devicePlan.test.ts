/**
 * משחקים שהמנהל שלח למחשב (src/app/devicePlan.ts): מה מצב כל אחד במחשב, ומה
 * הצעד הבא. הכללים כאן הם ההבטחה למפעיל: המשלוח מהמערכת לעולם אינו קוטע
 * אירוע, אינו מחליף את מה שעל המסך ואינו דורס עריכה שנעשתה במחשב.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_ATTEMPTS,
  attemptKey,
  checkedAgoText,
  deliveryStatusText,
  formatDeviceId,
  nextDeliveryAction,
  planDelivery,
  type DeliveryContext,
  type DeliveryItem,
} from '../src/app/devicePlan.ts';
import type { DeviceGame, LibraryGame } from '../src/app/clickerBridge.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

const sent = (gameId: string, code: string | null, version: string | null, extra: Partial<DeviceGame> = {}): DeviceGame => ({
  gameId,
  name: `משחק ${code ?? gameId.slice(0, 4)}`,
  code,
  version,
  expiresAt: null,
  ...extra,
});

const copy = (code: string, gameId: string | null, version: string | null, extra: Partial<LibraryGame> = {}): LibraryGame => ({
  code,
  name: `עותק ${code}`,
  savedAt: 1000,
  size: 10,
  gameId,
  version,
  editedAt: 0,
  pendingOpen: false,
  ...extra,
});

const nothingOnScreen = { code: null, gameId: null };

const ctx = (patch: Partial<DeliveryContext> = {}): DeliveryContext => ({
  quiet: true,
  busy: false,
  auto: null,
  attempts: () => 0,
  ...patch,
});

const only = (items: DeliveryItem[]): DeliveryItem => {
  expect(items).toHaveLength(1);
  return items[0]!;
};

describe('planDelivery — מה מצב המשחק במחשב', () => {
  it('★ משחק שאינו במחשב — חדש; אותה גרסה — במחשב; גרסה אחרת — עדכון', () => {
    const library = [copy('200', B, 'v1'), copy('300', C, 'v1')];
    const items = planDelivery([sent(A, '100', 'v1'), sent(B, '200', 'v1'), sent(C, '300', 'v2')], library, nothingOnScreen);
    expect(items.map((i) => i.kind)).toEqual(['new', 'current', 'update']);
  });

  it('עותק שהגרסה שלו לא ידועה (הורד לפני שהתוכנה רשמה גרסאות) — עדכון', () => {
    const item = only(planDelivery([sent(A, '100', 'v1')], [copy('100', A, null)], nothingOnScreen));
    expect(item.kind).toBe('update');
  });

  it('בלי קוד או בלי גרסה — אין מה להוריד, לפי הסיבה שהשרת נתן', () => {
    const items = planDelivery(
      [sent(A, null, null, { reason: 'no_license' }), sent(B, null, null, { reason: 'unavailable' }), sent(C, null, null)],
      [],
      nothingOnScreen,
    );
    expect(items.map((i) => i.kind)).toEqual(['no_license', 'unavailable', 'no_license']);
  });

  it('★ משחק שנבנה במחשב אינו עותק של משחק מהמערכת, גם אם המזהה זהה', () => {
    const item = only(planDelivery([sent(A, '100', 'v1')], [copy('local-1', A, 'v1', { local: true })], nothingOnScreen));
    expect(item.kind).toBe('new');
    expect(item.copy).toBeNull();
  });

  it('המזהה מושווה בלי תלות באותיות גדולות', () => {
    const item = only(planDelivery([sent(A, '100', 'v1')], [copy('100', A.toUpperCase(), 'v1')], nothingOnScreen));
    expect(item.kind).toBe('current');
  });

  it('★ העותק באותו קוד (זה שההורדה תחליף) קודם לעותק חדש יותר בקוד אחר', () => {
    const library = [copy('old', A, 'v2', { savedAt: 5000 }), copy('100', A, 'v1', { savedAt: 1000 })];
    const item = only(planDelivery([sent(A, '100', 'v2')], library, nothingOnScreen));
    expect(item.copy?.code).toBe('100');
    expect(item.kind).toBe('update');
  });

  it('בלי עותק באותו קוד (רישיון שחודש) — העותק החדש ביותר קובע', () => {
    const library = [copy('old1', A, 'v1', { savedAt: 1000 }), copy('old2', A, 'v2', { savedAt: 3000 })];
    const item = only(planDelivery([sent(A, 'renewed', 'v2')], library, nothingOnScreen));
    expect(item.copy?.code).toBe('old2');
    expect(item.kind).toBe('current');
  });

  it('★ "נערך" רק כשהחבילה שההורדה תחליף נערכה במחשב', () => {
    const editedTarget = only(planDelivery([sent(A, '100', 'v2')], [copy('100', A, 'v1', { editedAt: 77 })], nothingOnScreen));
    expect(editedTarget.edited).toBe(true);
    // עותק שנערך בקוד אחר אינו נדרס — ההורדה כותבת לקוד החדש.
    const editedOther = only(planDelivery([sent(A, '200', 'v2')], [copy('100', A, 'v1', { editedAt: 77 })], nothingOnScreen));
    expect(editedOther.edited).toBe(false);
  });

  it('★ על המסך: לפי הקוד (החבילה שתוחלף) ולפי המזהה (המשחק עצמו)', () => {
    const library = [copy('100', A, 'v1')];
    const item = only(planDelivery([sent(A, '100', 'v2')], library, { code: '100', gameId: A }));
    expect(item.targetOnScreen).toBe(true);
    expect(item.onScreen).toBe(true);
    expect(item.screenOutdated).toBe(true);
  });

  it('משחק שנטען מקובץ ZIP (בלי קוד) אך הוא אותו משחק — על המסך וישן', () => {
    const item = only(planDelivery([sent(A, '100', 'v1')], [copy('100', A, 'v1')], { code: null, gameId: A }));
    expect(item.onScreen).toBe(true);
    expect(item.targetOnScreen).toBe(false);
    expect(item.screenOutdated).toBe(true);
  });

  it('המשחק שעל המסך בגרסה האחרונה — לא ישן', () => {
    const item = only(planDelivery([sent(A, '100', 'v1')], [copy('100', A, 'v1')], { code: '100', gameId: A }));
    expect(item.screenOutdated).toBe(false);
  });

  it('משחק בלי רישיון בתוקף אינו "ישן" על המסך — אין לאן לעדכן', () => {
    const item = only(planDelivery([sent(A, null, null)], [copy('100', A, 'v1')], { code: '100', gameId: A }));
    expect(item.screenOutdated).toBe(false);
  });

  it('העותק שעל המסך נערך במחשב', () => {
    const item = only(planDelivery([sent(A, '100', 'v2')], [copy('100', A, 'v1', { editedAt: 5 })], { code: '100', gameId: A }));
    expect(item.screenEdited).toBe(true);
  });
});

describe('nextDeliveryAction — הצעד הבא', () => {
  it('★ בזמן משחק חי, או כשהורדה אחרת פעילה — כלום', () => {
    const items = planDelivery([sent(A, '100', 'v1')], [], nothingOnScreen);
    expect(nextDeliveryAction(items, ctx({ quiet: false }))).toBeNull();
    expect(nextDeliveryAction(items, ctx({ busy: true }))).toBeNull();
  });

  it('★ משחק חדש — הורדה ברקע, מסומן "ממתין לפתיחה"', () => {
    const items = planDelivery([sent(A, '100', 'v1')], [], nothingOnScreen);
    expect(nextDeliveryAction(items, ctx())).toEqual({ type: 'background', item: items[0], pendingOpen: true });
  });

  it(`★ אחרי ${MAX_ATTEMPTS} ניסיונות לאותה גרסה — מוותרים עד "נסו שוב"`, () => {
    const items = planDelivery([sent(A, '100', 'v1')], [], nothingOnScreen);
    const key = attemptKey(items[0]!.game);
    expect(nextDeliveryAction(items, ctx({ attempts: (k) => (k === key ? MAX_ATTEMPTS : 0) }))).toBeNull();
    expect(nextDeliveryAction(items, ctx({ attempts: (k) => (k === key ? MAX_ATTEMPTS - 1 : 0) }))?.type).toBe('background');
  });

  it('גרסה חדשה מתחילה את הספירה מאפס', () => {
    expect(attemptKey(sent(A, '100', 'v1'))).not.toBe(attemptKey(sent(A, '100', 'v2')));
  });

  it('★ עדכון שאינו נוגע במסך ובעריכה — ברקע, ושומר את "ממתין לפתיחה" כפי שהיה', () => {
    const plain = planDelivery([sent(A, '100', 'v2')], [copy('100', A, 'v1')], nothingOnScreen);
    expect(nextDeliveryAction(plain, ctx())).toEqual({ type: 'background', item: plain[0], pendingOpen: false });
    const pending = planDelivery([sent(A, '100', 'v2')], [copy('100', A, 'v1', { pendingOpen: true })], nothingOnScreen);
    expect(nextDeliveryAction(pending, ctx())).toEqual({ type: 'background', item: pending[0], pendingOpen: true });
  });

  it('★ עותק שנערך במחשב אינו מתעדכן לבד — גם לא בפתיחת התוכנה', () => {
    const items = planDelivery([sent(A, '100', 'v2')], [copy('100', A, 'v1', { editedAt: 9 })], nothingOnScreen);
    expect(nextDeliveryAction(items, ctx())).toBeNull();
    expect(nextDeliveryAction(items, ctx({ auto: 'any' }))).toBeNull();
  });

  it('★ החבילה שעל המסך אינה מוחלפת ברקע', () => {
    const items = planDelivery([sent(A, '100', 'v2')], [copy('100', A, 'v1')], { code: '100', gameId: A });
    expect(nextDeliveryAction(items, ctx())).toBeNull();
  });

  it('★ בפתיחת התוכנה (לפני שהמפעיל נגע במשהו) — המשחק שעל המסך מתעדכן ונפתח מחדש', () => {
    const items = planDelivery([sent(A, '100', 'v2')], [copy('100', A, 'v1')], { code: '100', gameId: A });
    expect(nextDeliveryAction(items, ctx({ auto: 'any' }))).toEqual({ type: 'foreground', item: items[0] });
  });

  it('…אבל לא כשהעותק שעל המסך נערך במחשב', () => {
    const items = planDelivery([sent(A, '100', 'v2')], [copy('100', A, 'v1', { editedAt: 3 })], { code: '100', gameId: A });
    expect(nextDeliveryAction(items, ctx({ auto: 'any' }))).toBeNull();
  });

  it('רישיון שחודש: הגרסה האחרונה כבר במחשב בקוד אחר — פותחים אותה במקום הישנה', () => {
    const library = [copy('old', A, 'v1', { savedAt: 1000 }), copy('new', A, 'v2', { savedAt: 2000 })];
    const items = planDelivery([sent(A, 'new', 'v2')], library, { code: 'old', gameId: A });
    expect(nextDeliveryAction(items, ctx({ auto: 'any' }))).toEqual({ type: 'open', item: items[0] });
    expect(nextDeliveryAction(items, ctx())).toBeNull(); // אחרי שהמפעיל בחר — רק הודעה
  });

  it('★ משחק שהורד וממתין — נפתח לבד רק כשמותר, והחדש ביותר קודם', () => {
    const library = [copy('100', A, 'v1', { pendingOpen: true, savedAt: 1000 }), copy('200', B, 'v1', { pendingOpen: true, savedAt: 2000 })];
    const items = planDelivery([sent(A, '100', 'v1'), sent(B, '200', 'v1')], library, nothingOnScreen);
    expect(nextDeliveryAction(items, ctx({ auto: 'any' }))).toEqual({ type: 'open', item: items[1] });
    expect(nextDeliveryAction(items, ctx({ auto: A }))).toEqual({ type: 'open', item: items[0] });
    expect(nextDeliveryAction(items, ctx({ auto: null }))).toBeNull();
  });

  it('פתיחה של משחק שממתין קודמת להורדה של משחק חדש', () => {
    const library = [copy('100', A, 'v1', { pendingOpen: true })];
    const items = planDelivery([sent(B, '200', 'v1'), sent(A, '100', 'v1')], library, nothingOnScreen);
    expect(nextDeliveryAction(items, ctx({ auto: 'any' }))?.type).toBe('open');
    expect(nextDeliveryAction(items, ctx())?.type).toBe('background');
  });

  it('משחק שממתין וכבר על המסך אינו נפתח שוב', () => {
    const items = planDelivery([sent(A, '100', 'v1')], [copy('100', A, 'v1', { pendingOpen: true })], { code: '100', gameId: A });
    expect(nextDeliveryAction(items, ctx({ auto: 'any' }))).toBeNull();
  });

  it('בלי רישיון — לא מורידים כלום', () => {
    const items = planDelivery([sent(A, null, null)], [], nothingOnScreen);
    expect(nextDeliveryAction(items, ctx({ auto: 'any' }))).toBeNull();
  });
});

describe('נוסחים', () => {
  it('מצב כל משחק ברשימה', () => {
    const [fresh, update, edited, current, pending, noLicense, unavailable] = planDelivery(
      [
        sent(A, '100', 'v1'),
        sent(B, '200', 'v2'),
        sent(C, '300', 'v2'),
        sent('44444444-4444-4444-8444-444444444444', '400', 'v1'),
        sent('55555555-5555-4555-8555-555555555555', '500', 'v1'),
        sent('66666666-6666-4666-8666-666666666666', null, null, { reason: 'no_license' }),
        sent('77777777-7777-4777-8777-777777777777', null, null, { reason: 'unavailable' }),
      ],
      [
        copy('200', B, 'v1'),
        copy('300', C, 'v1', { editedAt: 1 }),
        copy('400', '44444444-4444-4444-8444-444444444444', 'v1'),
        copy('500', '55555555-5555-4555-8555-555555555555', 'v1', { pendingOpen: true }),
      ],
      nothingOnScreen,
    );
    expect(deliveryStatusText(fresh!, null)).toBe('ממתין להורדה');
    expect(deliveryStatusText(fresh!, '100')).toBe('מוריד…');
    expect(deliveryStatusText(update!, null)).toBe('יש עדכון');
    expect(deliveryStatusText(edited!, null)).toBe('יש עדכון (העותק כאן נערך)');
    expect(deliveryStatusText(current!, null)).toBe('במחשב ✓');
    expect(deliveryStatusText(pending!, null)).toBe('הורד, ממתין לפתיחה');
    expect(deliveryStatusText(noLicense!, null)).toBe('אין רישיון בתוקף');
    expect(deliveryStatusText(unavailable!, null)).toBe('לא זמין כרגע');
  });

  it('מספר המחשב בשתי קבוצות, כמו במערכת', () => {
    expect(formatDeviceId('48217730')).toBe('4821-7730');
    expect(formatDeviceId('abc')).toBe('abc');
  });

  it('מתי נבדק', () => {
    const now = 10_000_000;
    expect(checkedAgoText(null, now)).toBe('');
    expect(checkedAgoText(now - 20_000, now)).toBe('נבדק עכשיו');
    expect(checkedAgoText(now - 60_000, now)).toBe('נבדק לפני דקה');
    expect(checkedAgoText(now - 7 * 60_000, now)).toBe('נבדק לפני 7 דקות');
    expect(checkedAgoText(now - 60 * 60_000, now)).toBe('נבדק לפני שעה');
    expect(checkedAgoText(now - 3 * 60 * 60_000, now)).toBe('נבדק לפני 3 שעות');
  });
});
