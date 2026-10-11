/**
 * פרק 1 — פתיחת התוכנה: קוד הגישה בפתיחה הראשונה, טעינת משחק לפי קוד או
 * מקובץ, המשחקים שכבר במחשב, ועדכוני התוכנה.
 */

import { openGuide } from '../harness.mjs';
import { DEMO_GAME, demoZipB64 } from '../demoGame.mjs';
import { ofTotal } from '../chapters.mjs';

export const meta = {
  slug: '01-pticha-vetinat-mishak',
  index: 'פרק 1',
  name: 'פתיחת התוכנה וטעינת המשחק',
  blurb: 'קוד הגישה, טעינת משחק לפי קוד או מקובץ, המשחקים שבמחשב ועדכוני התוכנה.',
};

/** הקוד שמוקלד בסרטון — 6 ספרות, כמו הקודים שהמערכת מנפיקה. */
const CODE = '482913';

export async function record() {
  const g = await openGuide({
    ...meta,
    zipB64: await demoZipB64(),
    // פתיחה ראשונה: עוד לא נשאלה על קוד גישה, ואין משחק אחרון.
    lastGame: false,
    gate: { configured: false, enabled: false },
    library: [
      {
        code: '615204',
        name: 'חידון חנוכה למשפחה',
        gameId: 'guide-hanukkah',
        version: 'v1',
        size: 31 * 1048576,
        game: { ...DEMO_GAME, id: 'guide-hanukkah', name: 'חידון חנוכה למשפחה' },
      },
    ],
    remote: {
      [CODE]: { game: DEMO_GAME, gameId: 'guide-demo', version: 'v1', size: 54 * 1048576, files: 26 },
    },
    device: { id: '48217730', name: 'מחשב האולם', permissions: { createGame: false, editGame: false } },
  });
  const { page } = g;

  await g.card('פתיחת התוכנה', 'המסך הראשון וטעינת המשחק', ofTotal(meta), 3800);
  await g.cardOff();

  // --- קוד הגישה: פעם אחת, בפתיחה הראשונה ---
  await page.waitForSelector('.gate-box', { timeout: 15000 });
  await g.point('.gate-box', { hold: 1200, pad: 8 });
  await g.say('בפתיחה הראשונה התוכנה מציעה להגדיר קוד גישה.', 3400);
  await g.say('הקוד חוסם החלפה, עריכה ובנייה של משחקים, כדי שלא ישנו אותם בטעות באולם.');
  await g.say('לשחק אפשר תמיד, גם בלי הקוד.', 3000);
  await g.pointOff();
  await g.point('.gate-actions', { hold: 1000 });
  await g.say('אפשר לבחור קוד, או להמשיך בלי קוד ולהגדיר אותו אחר כך. נמשיך בלי.');
  await g.click('.gate-plain', { after: 1200 });
  await g.sayOff();

  // --- המסך הראשון ---
  await page.waitForSelector('.offline-open-screen', { timeout: 15000 });
  await g.point('.offline-open-card', { hold: 1200, pad: 10 });
  await g.say('זה המסך הראשון של התוכנה.', 2800);
  await g.pointOff();

  // --- טעינה לפי קוד ---
  await g.point('.offline-open-code', { hold: 1000 });
  await g.say('הדרך הנפוצה: מקלידים את קוד המשחק שקיבלתם, והתוכנה מורידה אותו מהשרת.');
  await g.type('.offline-open-code input', CODE, { delay: 140, after: 700 });
  await g.click('.offline-open-code button[type=submit]', { after: 600 });
  await g.pointOff();
  await g.say('ההורדה דורשת אינטרנט, רק בפעם הראשונה.', 3200);
  await page.waitForSelector('.clicker-intro-screen', { timeout: 30000 });
  await g.wait(800);
  await g.say('המשחק ירד ונפתח. נחזור רגע למסך הראשון.', 3600);
  await g.click('button:has-text("טען משחק אחר")', { after: 1400 });
  await g.sayOff();
  await page.waitForSelector('.lib', { timeout: 15000 });

  // --- המשחקים במחשב ---
  await g.point('.lib', { hold: 1200, pad: 6 });
  await g.say('כל משחק שהורד נשמר כאן, ונפתח בלחיצה גם בלי אינטרנט.');
  await g.pointOff();
  await g.point('.lib-item:first-child .lib-refresh', { hold: 900 });
  await g.say('שיניתם את המשחק באתר? ⟳ מוריד את הגרסה המעודכנת.');
  await g.pointOff();
  await g.point('.lib-item:first-child .lib-del', { hold: 900 });
  await g.say('ו-🗑 מוחק משחק מהמחשב.', 2800);
  await g.pointOff();

  await g.point('.offline-open-load', { hold: 1000 });
  await g.say('יש לכם קובץ משחק (ZIP)? כאן פותחים אותו מהמחשב, גם בלי אינטרנט.');
  await g.pointOff();

  await g.point('.gate-link', { hold: 900 });
  await g.say('וכאן מגדירים או משנים את קוד הגישה, בכל רגע.');
  await g.pointOff();

  await g.point('.device-panel', { hold: 1000, pad: 6 });
  await g.say('בפינה — מספר המחשב. עליו בפרק 6.', 3200);
  await g.pointOff();

  // --- עדכוני התוכנה ---
  await g.point('.version-line', { hold: 1000, pad: 6 });
  await g.say('למטה — גרסת התוכנה. עדכונים יורדים לבד, ברקע.');
  await page.evaluate(() => window.__desk.update({ state: 'ready', version: '0.1.201' }));
  await g.wait(900);
  await g.point('.update-badge', { hold: 1000, pad: 6 });
  await g.say('עדכון שירד מותקן כשסוגרים את התוכנה, ולעולם לא באמצע אירוע.');
  await g.pointOff();

  await g.point('.guide-open', { hold: 1000, pad: 8 });
  await g.say('וכאן — סרטוני ההדרכה, בכל פעם שצריך.', 3200);
  await g.pointOff();

  // --- פתיחה מהרשימה ---
  await g.click('.lib-item:first-child .lib-open', { after: 1200 });
  await page.waitForSelector('.clicker-intro-screen', { timeout: 15000 });
  await g.wait(600);
  await g.say('פותחים משחק מהרשימה, והתוכנה שואלת איך מצביעים. על כך בפרק הבא.');
  await g.sayOff();

  await g.card('בפרק הבא', 'בחירת מקור ההצבעה: שלטים, טלפונים, או שניהם', '', 3400);

  return g.finish();
}
