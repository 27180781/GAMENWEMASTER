/**
 * פרק 5 — הרצת המשחק בפועל: המקשים, הלובי, וההצבעה.
 */

import { openGuide } from '../harness.mjs';
import { demoZipB64 } from '../demoGame.mjs';
import { enterClickerGame } from '../flow.mjs';

export const meta = {
  slug: '05-hatzagat-hamishak',
  index: 'פרק 5',
  name: 'הרצת המשחק',
  blurb: 'המקשים שמפעילים את המשחק, מסך ההתחברות, ההצבעה וחשיפת התשובה.',
};

export async function record() {
  const g = await openGuide({ ...meta, zipB64: await demoZipB64() });
  const { page } = g;

  await g.card('הרצת המשחק', 'המקשים שצריך להכיר', 'פרק 5 מתוך 6', 3600);
  await g.cardOff();

  await enterClickerGame(g);

  // --- הלובי ---
  await g.say('זהו מסך ההתחברות. כל שלט שנלחץ מצטרף כאן.');
  for (const id of [101, 102, 103, 104]) {
    await page.evaluate((n) => window.__desk.press(n), id);
    await page.waitForTimeout(550);
  }
  await g.wait(900);
  await g.say('כשכולם מחוברים — מקש רווח מתחיל את המשחק.', 3600);
  await g.sayOff();

  await page.keyboard.press('Space');
  await page.waitForTimeout(2200);

  // --- שאלה והצבעה ---
  await g.say('רווח הוא המקש המרכזי: הוא מקדם כל שלב במשחק.', 3800);
  await g.say('עכשיו השאלה על המסך, והמשתתפים לוחצים על מספר התשובה בשלט.', 4400);
  for (const [id, btn] of [[101, 1], [102, 1], [103, 2], [104, 1]]) {
    await page.evaluate(([n, b]) => window.__desk.press(n, b), [id, btn]);
    await page.waitForTimeout(650);
  }
  await g.wait(1000);
  await g.say('מונה המצביעים עולה עם כל לחיצה.', 3200);
  await g.sayOff();

  await page.keyboard.press('Space');
  await page.waitForTimeout(2400);
  await g.say('רווח נוסף — וסוגרים את ההצבעה וחושפים את התשובה הנכונה.', 4200);
  await page.keyboard.press('Space');
  await page.waitForTimeout(2400);
  await g.sayOff();

  // --- מקשים נוספים ---
  await g.card(
    'המקשים',
    'רווח — קדימה\nחץ שמאל — חזרה שלב\nR — שמות וקבוצות\nX — איפוס מסך ההתחברות\n1 — טבלת מובילים',
    '',
    6200,
  );
  await g.cardOff();

  // מקש R
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(1100);
  if ((await page.locator('.roster-panel').count()) > 0) {
    await g.say('R פותח את חלונית השמות והקבוצות — גם באמצע המשחק.', 4000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    await g.sayOff();
  }

  // מקש X — איפוס מסך ההתחברות
  await page.keyboard.press('KeyX');
  await page.waitForTimeout(1600);
  await g.say('X מחזיר את מסך ההתחברות מאופס — נוח כשמחליפים קהל באמצע.', 4600);
  await g.say('חשוב: זה מאפס רק את התצוגה. הניקוד והמשחק ממשיכים כרגיל.', 4600);
  await page.keyboard.press('Space');
  await page.waitForTimeout(1600);
  await g.say('רווח מחזיר את המשחק בדיוק לאן שהיה.', 3600);
  await g.sayOff();

  // תפריט המפעיל
  await page.keyboard.press('KeyM').catch(() => {});
  await page.waitForTimeout(900);
  if ((await page.locator('.operator-menu').count()) > 0) {
    await g.point('.operator-menu-panel', { hold: 1800, pad: 6 });
    await g.say('בתפריט המפעיל: קפיצה לכל שקופית, חלון הקליטה, ודוח תוצאות.');
    await g.pointOff();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    await g.sayOff();
  }

  await g.card('בפרק הבא', 'עריכת קובץ המשחק בתוך התוכנה', '', 3200);

  return g.finish();
}
