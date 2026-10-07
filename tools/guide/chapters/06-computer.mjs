/**
 * פרק 6 — מספר המחשב ומשחקים שנשלחים אליו (DevicePanel, devicePlan.ts).
 *
 * שני המקרים של משחק שנשלח, כמו שהם קורים באמת: בפתיחת התוכנה, לפני שמישהו
 * נגע בה, המשחק יורד ונפתח לבד; אחרי שהמפעיל כבר עובד — הוא יורד ברקע ומחכה
 * ל"פתיחה". לכן עד ההורדה הראשונה הסרטון רק מצביע, ולא לוחץ ולא מקליד:
 * לחיצה או מקש מסמנים שהמפעיל כאן, ומבטלים את הפתיחה האוטומטית.
 */

import { openGuide } from '../harness.mjs';
import { DEMO_GAME, demoZipB64 } from '../demoGame.mjs';
import { ofTotal } from '../chapters.mjs';

export const meta = {
  slug: '06-mispar-hamachshev',
  index: 'פרק 6',
  name: 'מספר המחשב ומשחקים שנשלחים אליו',
  blurb: 'המספר שמוסרים למנהל, משחקים שיורדים לבד, עדכונים מהמערכת והאישורים של המחשב.',
};

/** שני משחקים שהמנהל שולח למחשב — כמו שהבדיקה מול המערכת מחזירה אותם. */
const PURIM = { gameId: 'guide-purim', name: 'חידון פורים למשפחה', code: '731846', version: 'v1', expiresAt: null };
const TEAM = { gameId: 'guide-team', name: 'ערב טריוויה לצוות', code: '529371', version: 'v1', expiresAt: null };

/** מה שהשרת מחזיר לכל קוד. מזהה המשחק בקובץ = המזהה במערכת, כך התוכנה מזהה אותו על המסך. */
const remoteOf = (g, size) => ({
  game: { ...DEMO_GAME, id: g.gameId, name: g.name },
  gameId: g.gameId,
  version: g.version,
  size,
  files: 24,
});

export async function record() {
  const g = await openGuide({
    ...meta,
    zipB64: await demoZipB64(),
    // התוכנה נפתחת על המסך הראשון: אין משחק אחרון, והמחשב עוד בלי שם.
    lastGame: false,
    remote: { [PURIM.code]: remoteOf(PURIM, 38 * 1048576), [TEAM.code]: remoteOf(TEAM, 46 * 1048576) },
    device: { id: '48217730', name: null, permissions: { createGame: false, editGame: false }, games: [] },
  });
  const { page } = g;
  const send = (games) => page.evaluate((list) => window.__desk.device({ games: list }), games);

  await g.card('מספר המחשב', 'משחקים שנשלחים ישר למחשב', ofTotal(meta), 3800);
  await g.cardOff();

  // --- הכרטיס של המחשב ---
  await page.waitForSelector('.device-panel', { timeout: 15000 });
  await g.point('.device-panel', { hold: 1200, pad: 6 });
  await g.say('בפינת המסך הראשון — הכרטיס של המחשב הזה.', 3400);
  await g.pointOff();
  await g.point('.device-id', { hold: 1000, pad: 6 });
  await g.say('לכל מחשב יש מספר קבוע. מוסרים אותו למנהל המערכת, והוא שולח למחשב משחקים ומאשר אותו.');
  await g.pointOff();
  await g.point('.device-status', { hold: 900, pad: 4 });
  await g.say('התוכנה בודקת מול המערכת כשהיא נפתחת, ואחר כך כל 10 דקות.');
  await g.say('אין אינטרנט? הכול ממשיך לעבוד עם מה שכבר במחשב.', 3600);
  await g.pointOff();

  // --- משחק שנשלח בפתיחת התוכנה: יורד ונפתח לבד ---
  await g.say('המנהל שלח משחק למחשב. התוכנה רק נפתחה, ואף אחד עוד לא נגע בה…', 4200);
  await send([PURIM]);
  await page.waitForSelector('.device-game', { timeout: 15000 });
  await g.point('.device-games', { hold: 300, pad: 6 });
  await g.say('…לכן המשחק יורד ונפתח לבד, כמו קוד שהוקלד.', 0);
  await page.waitForSelector('.clicker-intro-screen', { timeout: 30000 });
  await g.pointOff();
  await g.wait(1800);
  await page.waitForSelector('.device-notice--ok', { timeout: 15000 });
  await g.point('.device-notice--ok', { hold: 1000, pad: 4 });
  await g.say('ההודעה למעלה אומרת איזה משחק נפתח.', 3200);
  await g.pointOff();
  await g.say('זה קורה רק בדקות הראשונות אחרי שהתוכנה נפתחת, ורק אם עוד לא נגעו בה.');
  await g.say('מעכשיו המשחק במחשב, ונפתח גם בלי אינטרנט.', 3400);
  await g.click('button:has-text("טען משחק אחר")', { after: 1400 });
  await g.sayOff();

  // --- משחק שנשלח כשכבר עובדים: יורד ברקע ומחכה ---
  await page.waitForSelector('.device-panel', { timeout: 15000 });
  await g.say('ומה אם כבר עובדים בתוכנה? המנהל שולח משחק נוסף…', 3600);
  await send([PURIM, TEAM]);
  await g.point('.device-games', { hold: 300, pad: 6 });
  await g.say('הוא יורד ברקע, ולא מחליף את מה שעל המסך.', 0);
  // בזמן ההורדה גם "עצירה" היא device-act — מחכים לשורה שכבר אומרת שהמשחק ירד.
  await page.waitForSelector(`.device-game:has-text("${TEAM.name}"):has-text("ממתין לפתיחה")`, { timeout: 30000 });
  await g.wait(2400);
  await g.pointOff();
  await g.point(`.device-game:has-text("${TEAM.name}")`, { hold: 1000, pad: 4 });
  await g.say('בסוף ההורדה הוא מחכה לכם: "פתיחה" מעלה אותו.');
  await g.pointOff();
  await g.sayOff();

  // --- שם למחשב ---
  await g.point('.device-name-edit', { hold: 900 });
  await g.say('✎ נותן למחשב שם, כדי שיהיה קל לזהות אותו ברשימה של המנהל.');
  await g.click('.device-name-edit', { after: 700 });
  await g.type('.device-name-form input', 'מחשב האולם', { delay: 90, after: 600 });
  await g.click('.device-name-form button[type=submit]', { after: 1200 });
  await g.pointOff();

  // --- מה אושר למחשב ---
  await g.point('.device-perms', { hold: 1000, pad: 6 });
  await g.say('בניית משחק חדש ועריכה במחשב נעולות 🔒 עד שהמנהל מאשר אותו. לשחק אפשר תמיד.');
  await g.pointOff();
  await g.sayOff();

  // --- עדכון של משחק שעל המסך ---
  await g.click(`.device-game:has-text("${TEAM.name}") .device-act:has-text("פתיחה")`, { after: 1600 });
  await page.waitForSelector('.clicker-intro-screen', { timeout: 15000 });
  await g.say('המנהל שינה את המשחק במערכת. בבדיקה הבאה מופיעה הודעה.', 3800);
  await send([PURIM, { ...TEAM, version: 'v2' }]);
  await page.waitForSelector('.device-notice:has-text("טעינת העדכון")', { timeout: 15000 });
  await g.point('.device-notice:has-text("טעינת העדכון")', { hold: 1200, pad: 4 });
  await g.say('ההודעה לא מחליפה כלום לבד. "טעינת העדכון" מוריד את הגרסה החדשה.');
  await g.click('.device-notice button:has-text("טעינת העדכון")', { after: 600 });
  await g.pointOff();
  await page.waitForSelector('.device-notice--ok', { timeout: 30000 });
  await g.wait(600);
  await g.point('.device-notice--ok', { hold: 1000, pad: 4 });
  await g.say('המשחק עודכן, והוא שוב על המסך.', 3200);
  await g.pointOff();
  await g.say('באמצע משחק התוכנה לא מורידה ולא מחליפה כלום — האירוע לא נקטע.');
  await g.sayOff();

  await g.card(
    'לסיכום',
    'מספר המחשב ← מוסרים למנהל המערכת\nמשחק שנשלח ← יורד לבד, ובפתיחת התוכנה גם נפתח\nמשחק שעודכן במערכת ← "טעינת העדכון"\nבנייה ועריכה במחשב ← אחרי אישור המנהל',
    '',
    7000,
  );
  await g.card('בפרק הבא', 'עריכת המשחק במחשב', '', 3200);

  return g.finish();
}
