// @ts-check
/**
 * הזהות של המחשב הזה מול מערכת יצירת המשחקים: מספר בן 8 ספרות שמוצג במסך
 * הפתיחה, וסוד שרק המחשב מכיר (השרת שומר רק את הגיבוב שלו). המנהל משייך
 * משחקים למספר בחלון הרישיון, והתוכנה מורידה אותם (deviceSync.cjs).
 *
 * device.json יושב בתיקיית הנתונים, שמשותפת לכל העותקים של התוכנה באותו מחשב
 * (גרסת ההתקנה והקובץ הנייד) — ולכן המזהה הוא של המחשב ולא של עותק. כלי
 * החתימה ו-EXE סגור אינם משתתפים (ראו main.cjs).
 *
 * השם: `name` הוא השם כפי שהשרת מכיר אותו (המנהל יכול לשנות אותו מהמערכת),
 * ו-`pendingName` הוא שם שהוקלד כאן ועוד לא הגיע לשרת ('' = מחיקת השם).
 *
 * האישורים (`permissions`): מה שהמנהל אישר למחשב הזה — בניית משחק חדש
 * ועריכה. כבויים עד שהמנהל מדליק אותם, ונשמרים כאן כפי שהגיעו בתשובה
 * האחרונה: בלי רשת המחשב ממשיך עם מה שכבר קיבל, ומשחק תמיד אפשר להריץ.
 *
 * ההשבתה (`blocked`, «השבתת התוכנה» במערכת): הפוך מהאישורים — התוכנה פתוחה
 * תמיד, ולעולם אינה מבקשת אישור להיפתח. היא ננעלת רק כשתשובה מוצלחת מהשרת
 * אמרה במפורש `blocked: true` על המספר שלה; זה נשמר כאן, ולכן הנעילה נשארת
 * גם בלי רשת, עד תשובה מוצלחת שאינה אומרת זאת. מחשב חדש, קובץ ישן בלי השדה,
 * קובץ פגום, מספר שהוגרל מחדש, שרת ישן, תקלה או ניתוק — כולם פתוחים.
 *
 * הקובץ מקבל את תיקיית הנתונים כפרמטר ואינו נוגע ב-Electron — ראו
 * tests/deviceIdentity.test.ts.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ID_RE = /^[1-9][0-9]{7}$/;
const SECRET_RE = /^[0-9a-f]{64}$/;
/** כמו במערכת (offline_devices.name). */
const NAME_MAX = 60;

/**
 * @typedef {{ createGame: boolean, editGame: boolean }} Permissions
 * @typedef {{
 *   id: string,
 *   secret: string,
 *   name: string | null,
 *   pendingName: string | null,
 *   registered: boolean,
 *   createdAt: number,
 *   permissions: Permissions,
 *   permissionsAt: number,
 *   blocked: boolean,
 * }} Device
 * @typedef {{ randomInt: (min: number, max: number) => number, randomBytes: (n: number) => Buffer }} Random
 */

/** @param {string} userData */
const devicePath = (userData) => path.join(userData, 'device.json');

/** רווחים מקופלים ושוליים, עד 60 תווים — כמו הטריגר בשרת. @param {unknown} name */
function cleanName(name) {
  if (typeof name !== 'string') return null;
  return name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

/** @type {Permissions} */
const NO_PERMISSIONS = Object.freeze({ createGame: false, editGame: false });

/** רק true מפורש — כל דבר אחר הוא "לא אושר". @param {unknown} raw @returns {Permissions} */
function readPermissions(raw) {
  const p = /** @type {Record<string, unknown> | null} */ (raw !== null && typeof raw === 'object' ? raw : null);
  return { createGame: p?.createGame === true, editGame: p?.editGame === true };
}

/** @param {Random} rand */
function newIdentity(rand) {
  return { id: String(rand.randomInt(10000000, 100000000)), secret: rand.randomBytes(32).toString('hex') };
}

/**
 * המחשב כפי ששמור בדיסק, או null (אין קובץ / קובץ פגום).
 * @param {string} userData
 * @returns {Device | null}
 */
function readDevice(userData) {
  try {
    const d = JSON.parse(fs.readFileSync(devicePath(userData), 'utf8'));
    if (!ID_RE.test(String(d?.id)) || !SECRET_RE.test(String(d?.secret))) return null;
    const name = cleanName(d.name);
    return {
      id: d.id,
      secret: d.secret,
      name: name === '' ? null : name,
      pendingName: typeof d.pendingName === 'string' ? cleanName(d.pendingName) : null,
      registered: d.registered === true,
      createdAt: Number(d.createdAt) || 0,
      permissions: readPermissions(d.permissions),
      permissionsAt: Number(d.permissionsAt) || 0,
      // רק true מפורש נועל — קובץ מגרסה ישנה (בלי השדה) פתוח.
      blocked: d.blocked === true,
    };
  } catch {
    return null;
  }
}

/**
 * כתיבה זמנית ואז החלפה — קריסה באמצע לעולם לא משאירה מחשב בלי זהות.
 * @param {string} userData
 * @param {Device} device
 */
function saveDevice(userData, device) {
  const file = devicePath(userData);
  const tmp = `${file}.saving`;
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(device, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * המחשב, ובפעם הראשונה (או אחרי קובץ פגום) — זהות חדשה שנשמרת מיד.
 * @param {string} userData
 * @param {Random} [rand]
 * @returns {Device}
 */
function loadDevice(userData, rand = crypto) {
  const existing = readDevice(userData);
  if (existing !== null) return existing;
  /** @type {Device} */
  const device = {
    ...newIdentity(rand),
    name: null,
    pendingName: null,
    registered: false,
    createdAt: Date.now(),
    permissions: { ...NO_PERMISSIONS },
    permissionsAt: 0,
    blocked: false,
  };
  saveDevice(userData, device);
  return device;
}

/**
 * המספר שייך למחשב אחר (409 מהשרת): הגרלה מחדש. קורה כשתיקיית הנתונים הועתקה
 * ממחשב אחר, או בהתנגשות מקרית ברישום הראשון. שם שהוקלד כאן ועוד לא נשלח
 * עובר הלאה; שם, אישורים והשבתה שהשרת כבר מכיר שייכים למחשב השני ואינם
 * מועתקים — מספר חדש הוא מחשב חדש, ופתוח.
 * @param {string} userData
 * @param {Device} device
 * @param {Random} [rand]
 * @returns {Device}
 */
function regenerateDevice(userData, device, rand = crypto) {
  /** @type {Device} */
  let next = {
    ...newIdentity(rand),
    name: null,
    pendingName: device.pendingName,
    registered: false,
    createdAt: Date.now(),
    permissions: { ...NO_PERMISSIONS },
    permissionsAt: 0,
    blocked: false,
  };
  while (next.id === device.id) next = { ...next, ...newIdentity(rand) };
  saveDevice(userData, next);
  return next;
}

/**
 * שם שהמפעיל הקליד כאן — יישלח בבדיקה הבאה. '' = מחיקת השם.
 * @param {string} userData
 * @param {unknown} name
 * @returns {Device}
 */
function setPendingName(userData, name) {
  const device = loadDevice(userData);
  const clean = cleanName(name) ?? '';
  const next = { ...device, pendingName: clean === (device.name ?? '') ? null : clean };
  saveDevice(userData, next);
  return next;
}

/**
 * ההשבתה מתוך תשובה מוצלחת: רק `blocked: true` מפורש על המספר שנשלח. כל דבר
 * אחר — שדה חסר (שרת ישן), ערך אחר, או מספר אחר — פתוח.
 * @param {unknown} serverDevice
 * @param {string} sentId
 */
function readBlocked(serverDevice, sentId) {
  const answer = /** @type {Record<string, unknown> | null} */ (
    serverDevice !== null && typeof serverDevice === 'object' ? serverDevice : null
  );
  return answer?.blocked === true && answer.id === sentId;
}

/**
 * תשובת השרת: השם, האישורים וההשבתה שלו גוברים, ושם שהוקלד כאן יורד מהתור
 * רק אם לא שונה שוב בזמן שהבקשה הייתה בדרך.
 * @param {string} userData
 * @param {string} sentId
 * @param {string | null} sentPending
 * @param {unknown} serverDevice
 * @returns {Device}
 */
function applyServerAnswer(userData, sentId, sentPending, serverDevice) {
  const device = loadDevice(userData);
  if (device.id !== sentId) return device;
  const answer = /** @type {{ name?: unknown, permissions?: unknown } | null} */ (serverDevice);
  const name = cleanName(answer?.name);
  const next = {
    ...device,
    name: name === null || name === '' ? null : name,
    pendingName: device.pendingName === sentPending ? null : device.pendingName,
    registered: true,
    permissions: readPermissions(answer?.permissions),
    permissionsAt: Date.now(),
    blocked: readBlocked(serverDevice, sentId),
  };
  saveDevice(userData, next);
  return next;
}

/** 48217730 → "4821-7730", כמו במערכת. @param {string} id */
function formatDeviceId(id) {
  return ID_RE.test(id) ? `${id.slice(0, 4)}-${id.slice(4)}` : id;
}

module.exports = {
  NAME_MAX,
  NO_PERMISSIONS,
  readPermissions,
  readBlocked,
  devicePath,
  cleanName,
  readDevice,
  saveDevice,
  loadDevice,
  regenerateDevice,
  setPendingName,
  applyServerAnswer,
  formatDeviceId,
};
