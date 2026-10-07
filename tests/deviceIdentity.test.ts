/**
 * הזהות של המחשב (electron/deviceIdentity.cjs): מספר וסוד שנשמרים בתיקיית
 * הנתונים, שם שהוקלד כאן, והאישורים שהמנהל נתן. הכלל החשוב: אישור נשמר
 * כפי שהגיע מהשרת ותקף גם בלי רשת, ובלי אישור מפורש — נעול.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
type Permissions = { createGame: boolean; editGame: boolean };
type Device = {
  id: string;
  secret: string;
  name: string | null;
  pendingName: string | null;
  registered: boolean;
  createdAt: number;
  permissions: Permissions;
  permissionsAt: number;
  blocked: boolean;
};
type Random = { randomInt: (min: number, max: number) => number; randomBytes: (n: number) => Buffer };
const identity = require('../electron/deviceIdentity.cjs') as {
  NAME_MAX: number;
  devicePath: (userData: string) => string;
  cleanName: (name: unknown) => string | null;
  readPermissions: (raw: unknown) => Permissions;
  readBlocked: (serverDevice: unknown, sentId: string) => boolean;
  readDevice: (userData: string) => Device | null;
  loadDevice: (userData: string, rand?: Random) => Device;
  regenerateDevice: (userData: string, device: Device, rand?: Random) => Device;
  setPendingName: (userData: string, name: unknown) => Device;
  applyServerAnswer: (userData: string, sentId: string, sentPending: string | null, serverDevice: unknown) => Device;
  formatDeviceId: (id: string) => string;
};

/** הגרלה צפויה: המספרים לפי הסדר, והסוד בית קבוע. */
const fixedRandom = (...ids: number[]): Random => {
  let i = 0;
  return {
    randomInt: () => ids[Math.min(i++, ids.length - 1)]!,
    randomBytes: (n) => Buffer.alloc(n, 0xab),
  };
};

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'device-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('מזהה המחשב', () => {
  it('★ נוצר בפעם הראשונה ונשמר — אותו מספר ואותו סוד בכל פתיחה', () => {
    const first = identity.loadDevice(dir);
    expect(first.id).toMatch(/^[1-9][0-9]{7}$/);
    expect(first.secret).toMatch(/^[0-9a-f]{64}$/);
    const again = identity.loadDevice(dir);
    expect(again.id).toBe(first.id);
    expect(again.secret).toBe(first.secret);
  });

  it('★ מחשב חדש: בלי שם, לא רשום, ובלי שום אישור', () => {
    const d = identity.loadDevice(dir, fixedRandom(48217730));
    expect(d).toMatchObject({ id: '48217730', name: null, pendingName: null, registered: false });
    expect(d.permissions).toEqual({ createGame: false, editGame: false });
  });

  it('קובץ פגום — זהות חדשה במקומו, והתוכנה ממשיכה', () => {
    writeFileSync(identity.devicePath(dir), 'not json');
    const d = identity.loadDevice(dir, fixedRandom(12345678));
    expect(d.id).toBe('12345678');
    expect(identity.readDevice(dir)?.id).toBe('12345678');
  });

  it('השמירה אינה משאירה קובץ זמני', () => {
    identity.loadDevice(dir);
    expect(existsSync(`${identity.devicePath(dir)}.saving`)).toBe(false);
  });

  it('★ המספר תפוס במחשב אחר: מספר חדש ושונה, השם שהוקלד כאן עובר, והשם והאישורים של המחשב האחר לא', () => {
    const d = identity.loadDevice(dir, fixedRandom(11111111));
    writeFileSync(
      identity.devicePath(dir),
      JSON.stringify({ ...d, name: 'המחשב האחר', pendingName: 'אולם 2', registered: true, permissions: { createGame: true, editGame: true } }),
    );
    const before = identity.loadDevice(dir);
    // ההגרלה הראשונה מחזירה שוב את אותו מספר — חייבים לקבל מספר אחר.
    const next = identity.regenerateDevice(dir, before, fixedRandom(11111111, 22222222));
    expect(next.id).toBe('22222222');
    expect(next).toMatchObject({ name: null, pendingName: 'אולם 2', registered: false });
    expect(next.permissions).toEqual({ createGame: false, editGame: false });
    expect(identity.loadDevice(dir).id).toBe('22222222');
  });

  it('מספר המחשב בשתי קבוצות', () => {
    expect(identity.formatDeviceId('48217730')).toBe('4821-7730');
    expect(identity.formatDeviceId('123')).toBe('123');
  });
});

describe('שם המחשב', () => {
  it('★ שם שהוקלד מחכה לבדיקה הבאה — רווחים מקופלים, עד 60 תווים', () => {
    identity.loadDevice(dir);
    const d = identity.setPendingName(dir, `  אולם   ${'א'.repeat(80)}  `);
    expect(d.pendingName).toBe(`אולם ${'א'.repeat(80)}`.slice(0, identity.NAME_MAX));
    expect(identity.loadDevice(dir).pendingName).toBe(d.pendingName);
  });

  it('שם זהה למה שהשרת כבר מכיר — אין מה לשלוח', () => {
    const d = identity.loadDevice(dir);
    identity.applyServerAnswer(dir, d.id, null, { name: 'אולם 1' });
    expect(identity.setPendingName(dir, ' אולם 1 ').pendingName).toBeNull();
  });

  it('מחיקת השם נשלחת כמחרוזת ריקה', () => {
    const d = identity.loadDevice(dir);
    identity.applyServerAnswer(dir, d.id, null, { name: 'אולם 1' });
    expect(identity.setPendingName(dir, '').pendingName).toBe('');
  });

  it('cleanName', () => {
    expect(identity.cleanName(5)).toBeNull();
    expect(identity.cleanName(' a \n b ')).toBe('a b');
  });
});

describe('תשובת השרת', () => {
  it('★ השם והאישורים של השרת נשמרים, והמחשב רשום', () => {
    const d = identity.loadDevice(dir);
    const next = identity.applyServerAnswer(dir, d.id, null, { name: 'אולם 1', permissions: { createGame: true, editGame: false } });
    expect(next).toMatchObject({ name: 'אולם 1', registered: true });
    expect(next.permissions).toEqual({ createGame: true, editGame: false });
    expect(next.permissionsAt).toBeGreaterThan(0);
    // ★ בלי רשת: מה שנשמר הוא מה שתקף
    expect(identity.loadDevice(dir).permissions).toEqual({ createGame: true, editGame: false });
  });

  it('★ אישור שבוטל במערכת נסגר גם במחשב', () => {
    const d = identity.loadDevice(dir);
    identity.applyServerAnswer(dir, d.id, null, { permissions: { createGame: true, editGame: true } });
    const next = identity.applyServerAnswer(dir, d.id, null, { permissions: { createGame: false, editGame: true } });
    expect(next.permissions).toEqual({ createGame: false, editGame: true });
  });

  it('★ רק true מפורש הוא אישור — שרת ישן בלי השדה, או ערך אחר, נעול', () => {
    expect(identity.readPermissions(undefined)).toEqual({ createGame: false, editGame: false });
    expect(identity.readPermissions({ createGame: 'true', editGame: 1 })).toEqual({ createGame: false, editGame: false });
    const d = identity.loadDevice(dir);
    identity.applyServerAnswer(dir, d.id, null, { permissions: { createGame: true, editGame: true } });
    expect(identity.applyServerAnswer(dir, d.id, null, { name: 'x' }).permissions).toEqual({ createGame: false, editGame: false });
  });

  it('★ השם שנשלח יורד מהתור, אבל שם שהוקלד שוב בזמן שהבקשה הייתה בדרך נשאר', () => {
    const d = identity.loadDevice(dir);
    identity.setPendingName(dir, 'אולם 1');
    identity.setPendingName(dir, 'אולם 2'); // הוקלד שוב לפני שהתשובה הגיעה
    const next = identity.applyServerAnswer(dir, d.id, 'אולם 1', { name: 'אולם 1' });
    expect(next.name).toBe('אולם 1');
    expect(next.pendingName).toBe('אולם 2');
    expect(identity.applyServerAnswer(dir, d.id, 'אולם 2', { name: 'אולם 2' }).pendingName).toBeNull();
  });

  it('תשובה למספר שכבר הוחלף אינה נוגעת במחשב', () => {
    const d = identity.loadDevice(dir, fixedRandom(11111111));
    const next = identity.regenerateDevice(dir, d, fixedRandom(22222222));
    const after = identity.applyServerAnswer(dir, d.id, null, { name: 'ישן', permissions: { createGame: true, editGame: true } });
    expect(after.id).toBe(next.id);
    expect(after.registered).toBe(false);
    expect(after.permissions).toEqual({ createGame: false, editGame: false });
  });

  it('הקובץ שומר את הסוד ואת השם מהשרת', () => {
    const d = identity.loadDevice(dir);
    identity.applyServerAnswer(dir, d.id, null, { name: 'אולם 1' });
    const raw = JSON.parse(readFileSync(identity.devicePath(dir), 'utf8'));
    expect(raw.secret).toBe(d.secret);
    expect(raw.name).toBe('אולם 1');
  });
});

describe('השבתת התוכנה — פתוחה תמיד, נעולה רק בהשבתה מפורשת', () => {
  it('★ מחשב חדש, קובץ מגרסה ישנה בלי השדה, וקובץ פגום — פתוחים', () => {
    expect(identity.loadDevice(dir).blocked).toBe(false);
    const old: Record<string, unknown> = { ...identity.loadDevice(dir) };
    delete old.blocked;
    writeFileSync(identity.devicePath(dir), JSON.stringify(old)); // device.json מגרסה שלפני ההשבתה
    expect(identity.loadDevice(dir).blocked).toBe(false);
    writeFileSync(identity.devicePath(dir), '{"id":"48217730","secret":"oops","blocked":true}');
    expect(identity.loadDevice(dir, fixedRandom(12345678)).blocked).toBe(false);
  });

  it('★ השבתה מפורשת למספר של המחשב — נשמרת, ונשארת גם בפתיחה הבאה בלי רשת', () => {
    const d = identity.loadDevice(dir);
    const next = identity.applyServerAnswer(dir, d.id, null, { id: d.id, name: 'אולם 1', blocked: true });
    expect(next.blocked).toBe(true);
    expect(identity.readDevice(dir)?.blocked).toBe(true);
    expect(identity.loadDevice(dir).blocked).toBe(true);
    expect(JSON.parse(readFileSync(identity.devicePath(dir), 'utf8')).blocked).toBe(true);
  });

  it('★ ביטול: תשובה מוצלחת שאינה אומרת "מושבת" (גם שרת ישן בלי השדה) — פתוח שוב', () => {
    const d = identity.loadDevice(dir);
    identity.applyServerAnswer(dir, d.id, null, { id: d.id, blocked: true });
    expect(identity.applyServerAnswer(dir, d.id, null, { id: d.id, blocked: false }).blocked).toBe(false);
    identity.applyServerAnswer(dir, d.id, null, { id: d.id, blocked: true });
    expect(identity.applyServerAnswer(dir, d.id, null, { id: d.id, name: 'אולם 1' }).blocked).toBe(false);
  });

  it('★ רק true מפורש על אותו מספר נועל', () => {
    expect(identity.readBlocked({ id: '48217730', blocked: true }, '48217730')).toBe(true);
    expect(identity.readBlocked({ id: '48217730', blocked: 'true' }, '48217730')).toBe(false);
    expect(identity.readBlocked({ id: '48217730', blocked: 1 }, '48217730')).toBe(false);
    expect(identity.readBlocked({ blocked: true }, '48217730')).toBe(false); // בלי מספר
    expect(identity.readBlocked({ id: '11111111', blocked: true }, '48217730')).toBe(false); // מספר אחר
    expect(identity.readBlocked(null, '48217730')).toBe(false);
    expect(identity.readBlocked('blocked', '48217730')).toBe(false);
  });

  it('★ מספר שהוגרל מחדש (409) הוא מחשב חדש — פתוח', () => {
    const d = identity.loadDevice(dir, fixedRandom(11111111));
    const locked = identity.applyServerAnswer(dir, d.id, null, { id: d.id, blocked: true });
    expect(locked.blocked).toBe(true);
    const next = identity.regenerateDevice(dir, locked, fixedRandom(22222222));
    expect(next.blocked).toBe(false);
    expect(identity.loadDevice(dir).blocked).toBe(false);
  });

  it('תשובה למספר שכבר הוחלף אינה נועלת', () => {
    const d = identity.loadDevice(dir, fixedRandom(11111111));
    identity.regenerateDevice(dir, d, fixedRandom(22222222));
    expect(identity.applyServerAnswer(dir, d.id, null, { id: d.id, blocked: true }).blocked).toBe(false);
  });

  it('שם שהוקלד כאן אינו נוגע בהשבתה', () => {
    const d = identity.loadDevice(dir);
    identity.applyServerAnswer(dir, d.id, null, { id: d.id, blocked: true });
    expect(identity.setPendingName(dir, 'אולם 2').blocked).toBe(true);
  });
});
