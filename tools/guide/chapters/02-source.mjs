/**
 * פרק 2 — בחירת מקור ההצבעה.
 */

import { openGuide } from '../harness.mjs';
import { DEMO_GAME, demoZipB64 } from '../demoGame.mjs';
import { ofTotal } from '../chapters.mjs';

export const meta = {
  slug: '02-bchirat-makor-hatzbaa',
  index: 'פרק 2',
  name: 'בחירת מקור ההצבעה',
  blurb: 'שלטים, טלפונים, שניהם יחד או מצב דמה — מה כל אפשרות עושה.',
};

export async function record() {
  // משחק עם קוד חדר (רישיון שכולל טלפונים) — כך מוצגות כל ארבע האפשרויות.
  const g = await openGuide({ ...meta, zipB64: await demoZipB64({ ...DEMO_GAME, room: 2047 }) });
  const { page } = g;

  await g.card('איך משחקים?', 'בחירת מקור ההצבעה', ofTotal(meta), 3600);
  await g.cardOff();

  await page.waitForSelector('.clicker-intro-screen', { timeout: 15000 });
  await g.say('אחרי טעינת המשחק, התוכנה שואלת מאיפה יגיעו ההצבעות.');

  const choices = await page.locator('.clicker-choice-title').allInnerTexts();

  await g.point('button:has(.clicker-choice-title:text-is("שחק עם שלטים"))', { hold: 1500 });
  await g.say('"שחק עם שלטים" — התוכנה מפעילה לבד את תוכנת הקליטה של הריסיבר.');
  await g.say('זו האפשרות הרגילה לאירוע עם שלטים פיזיים, והיא עובדת בלי אינטרנט.', 4200);
  await g.pointOff();

  if (choices.includes('שחק עם טלפונים')) {
    await g.point('button:has(.clicker-choice-title:text-is("שחק עם טלפונים"))', { hold: 1500 });
    await g.say('"שחק עם טלפונים" — המשתתפים מצביעים מהנייד, עם קוד החדר של המשחק.');
    await g.say('האפשרות הזו דורשת אינטרנט במחשב בזמן המשחק.', 3400);
    await g.pointOff();
  }
  if (choices.includes('שלטים + טלפונים')) {
    await g.point('button:has(.clicker-choice-title:text-is("שלטים + טלפונים"))', { hold: 1500 });
    await g.say('אפשר גם לשלב: חלק מהקהל בשלטים וחלק בטלפונים.');
    await g.pointOff();
  }
  await g.say('אפשרויות הטלפונים מופיעות רק במשחק שהרישיון שלו כולל טלפונים.', 4200);

  await g.point('button:has(.clicker-choice-title:text-is("מצב דמה"))', { hold: 1500 });
  await g.say('"מצב דמה" — הרצה עם משתתפים מדומים, בלי שום חומרה.');
  await g.say('מצוין כדי לבדוק את המשחק לפני האירוע.', 3400);
  await g.pointOff();

  await g.point('button:has-text("הגדרות מתקדמות")', { hold: 1400 });
  await g.say('בהגדרות המתקדמות אפשר לכוון פרטים נוספים לפני שמתחילים.');
  await g.pointOff();
  await g.point('.settings-host-link', { hold: 1200 });
  await g.say('ו"מסך מנחה" פותח חלון שליטה נפרד: המשחק על המקרן, והשליטה על מסך המחשב.');
  await g.pointOff();
  await g.sayOff();

  await g.card('בפרק הבא', 'חיבור הריסיבר והשלטים', '', 3200);

  return g.finish();
}
