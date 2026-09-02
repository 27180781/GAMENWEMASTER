/**
 * שליטה בזום של חלון התוכנה.
 *
 * הרקע לבאג: Chromium **זוכר** את רמת הזום לכל מקור (origin), וכאן המקור הוא
 * ‎file://‎ אחד לכל התוכנה. לכן זום שנעשה פעם אחת — גם בטעות, למשל Ctrl+גלגלת —
 * נשמר לתמיד, גם אחרי סגירה ופתיחה מחדש, ובלי שום חיווי במסך שמשהו השתנה.
 *
 * מה שהופך את זה למבלבל במיוחד: במסכי המשחק הזום **אינו נראה כלל**. הבמה
 * מודדת את חלון הדפדפן ומתאימה את עצמה אליו (ראו Stage.tsx), וזום מקטין את
 * המידה הלוגית בדיוק באותו יחס — כך שהתוצאה על המסך זהה. לכן מי שמנסה
 * להקטין תצוגה במסך משחק רואה שכלום לא קורה, ומסיק שהתוכנה תקועה, בזמן
 * שהזום כן נשמר ומשפיע אחר כך על מסכי העבודה (עורך, מדריך).
 *
 * הפתרון כאן: הזום מאופס בכל טעינה (ולכן אינו יכול להיתקע בין הפעלות),
 * והקיצורים מטופלים ב-main ולא דרך תפריט — כך שהם עובדים תמיד, בלי תלות
 * בתפריט מוסתר או במה שהדף עושה עם המקלדת.
 */

/** גבולות שפויים: מתחת לזה הטקסט בלתי קריא, מעל זה הכול גולש. */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
/** צעד כפלי — שומר על תחושה אחידה בשני הכיוונים. */
const STEP = 1.1;

/** עיגול לשתי ספרות, כדי שרצף צעדים לא יצבור שארית עשרונית. */
const round2 = (n) => Math.round(n * 100) / 100;

/** הזום הבא בכיוון המבוקש, תחום לגבולות. */
function nextZoomFactor(current, action) {
  const base = Number.isFinite(current) && current > 0 ? current : 1;
  if (action === 'reset') return 1;
  const raw = action === 'in' ? base * STEP : base / STEP;
  return round2(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, raw)));
}

/**
 * איזו פעולת זום מבוקשת באירוע מקלדת של Electron ‎(before-input-event)‎.
 * מחזיר null כשאין קשר לזום — ואז לא נוגעים באירוע.
 */
function zoomActionFor(input) {
  if (input === null || typeof input !== 'object') return null;
  if (input.type !== 'keyDown') return null;
  if (input.control !== true && input.meta !== true) return null;

  const key = typeof input.key === 'string' ? input.key : '';
  const code = typeof input.code === 'string' ? input.code : '';

  if (key === '0' || code === 'Numpad0' || code === 'Digit0') return 'reset';
  // ‎'='‎ ו-‎'+'‎ הם אותו מקש (עם Shift ובלעדיו), ובפריסות שונות גם code שונה.
  if (key === '+' || key === '=' || code === 'NumpadAdd' || code === 'Equal') return 'in';
  if (key === '-' || key === '_' || code === 'NumpadSubtract' || code === 'Minus') return 'out';
  return null;
}

module.exports = { MIN_ZOOM, MAX_ZOOM, nextZoomFactor, zoomActionFor };
