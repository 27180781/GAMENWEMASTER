/**
 * פרק 1 — פתיחת התוכנה וטעינת קובץ המשחק.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openGuide } from '../harness.mjs';
import { demoZipB64 } from '../demoGame.mjs';

export const meta = {
  slug: '01-pticha-vetinat-mishak',
  index: 'פרק 1',
  name: 'פתיחת התוכנה וטעינת המשחק',
  blurb: 'המסך הראשון: טעינת קובץ המשחק מהמחשב או לפי קוד, וכפתורי החלון.',
};

export async function record() {
  const zipB64 = await demoZipB64();
  const tmp = mkdtempSync(join(tmpdir(), 'guide-zip-'));
  // שם קובץ באנגלית: Playwright אינו מצרף קבצים בשם שאינו ASCII.
  const zipFile = join(tmp, 'game.zip');
  writeFileSync(zipFile, Buffer.from(zipB64, 'base64'));

  // lastGame: false — כדי שמסך הטעינה יוצג ולא ייטען משחק אחרון אוטומטית.
  const g = await openGuide({ ...meta, zipB64, lastGame: false });
  const { page } = g;

  await g.card('פתיחת התוכנה', 'המסך הראשון וטעינת קובץ המשחק', 'פרק 1 מתוך 6', 3800);
  await g.cardOff();

  await page.waitForSelector('.offline-open-screen', { timeout: 15000 });
  await g.say('זה המסך שמתקבל בפתיחת התוכנה.');
  await g.point('.offline-open-card', { hold: 1600, pad: 10 });
  await g.pointOff();

  await g.point('.offline-open-load', { hold: 1400 });
  await g.say('הדרך הרגילה: טעינת קובץ המשחק (קובץ ZIP) מהמחשב.');
  await g.pointOff();

  if (await g.pointMaybe('.offline-open-code', { hold: 1400 })) {
    await g.say('לחלופין — הקלדת קוד המשחק, והתוכנה תוריד אותו מהשרת.');
    await g.say('הורדה לפי קוד דורשת אינטרנט. קובץ מהמחשב עובד גם בלי.', 4400);
    await g.pointOff();
  }

  await g.say('נטען עכשיו קובץ מהמחשב.', 2600);
  await page.locator('.offline-open-load input[type=file]').setInputFiles(zipFile);
  await page.waitForSelector('.clicker-intro-screen', { timeout: 20000 });
  await g.wait(1200);
  await g.say('המשחק נטען, והתוכנה שואלת איך רוצים להצביע — על כך בפרק הבא.', 4600);
  await g.sayOff();

  await g.card(
    'בפרק הבא',
    'בחירת מקור ההצבעה: שלטים, טלפונים, או שניהם',
    '',
    3400,
  );

  const out = await g.finish();
  rmSync(tmp, { recursive: true, force: true });
  return out;
}
