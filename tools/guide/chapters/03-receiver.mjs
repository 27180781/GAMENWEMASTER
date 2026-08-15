/**
 * פרק 3 — חיבור הריסיבר (השלטים).
 *
 * הפרק בנוי סביב השרשרת האמיתית: דונגל ← תוכנת הקליטה ← תוכנת המשחק.
 * ההודעות שמוצגות כאן הן ההודעות האמיתיות של התוכנה (ראו clickerLink.ts) —
 * הן מוזרקות דרך מצבי הגשר, ולא נכתבות מחדש בכיתוביות.
 */

import { openGuide } from '../harness.mjs';
import { demoZipB64 } from '../demoGame.mjs';
import { receiverOnline } from '../flow.mjs';

export const meta = {
  slug: '03-chibur-hareceiver',
  index: 'פרק 3',
  name: 'חיבור הריסיבר והשלטים',
  blurb: 'איך השלטים מגיעים למשחק, מה אומר כל חיווי, ומה לעשות כשאין קליטה.',
};

/** מזריק מצב לשרשרת הקליקרים ומחכה שהחיווי יתעדכן. */
async function link(page, { listening = true, busy = false, software = null, dongle = null }) {
  await page.evaluate(
    ([l, b, s, d]) => {
      window.__desk.server({ listening: l, port: 8090, busy: b });
      if (s !== null) window.__desk.receiver({ connected: s, who: '127.0.0.1' });
      if (d !== null) window.__desk.clicker({ type: 'status', code: 1, status: d });
    },
    [listening, busy, software, dongle],
  );
  await page.waitForTimeout(900);
}

export async function record() {
  const g = await openGuide({ ...meta, zipB64: await demoZipB64() });
  const { page } = g;

  await g.card('חיבור הריסיבר', 'איך השלטים מגיעים לתוכנת המשחק', 'פרק 3 מתוך 6', 3800);
  await g.cardOff();

  await g.card(
    'השרשרת',
    'דונגל USB  ←  תוכנת הקליטה RF317  ←  תוכנת המשחק',
    'שתי חוליות — ולכל אחת חיווי משלה',
    5200,
  );
  await g.cardOff();

  await page.waitForSelector('.clicker-intro-screen', { timeout: 15000 });
  await g.say('בוחרים "שחק עם שלטים" — והתוכנה מפעילה לבד את תוכנת הקליטה.');
  await g.click('button:has(.clicker-choice-title:text-is("שחק עם שלטים"))', { after: 1400 });
  await g.sayOff();
  await receiverOnline(page);
  await page.waitForSelector('.lobby-screen', { timeout: 15000 });
  await page.waitForTimeout(1000);

  // --- מצב תקין ---
  await link(page, { software: true, dongle: 'connected' });
  await g.point('.clicker-badge', { hold: 1600 });
  await g.say('החיווי בפינה הוא מצב השלטים. ירוק — הכול מחובר.');
  await g.pointOff();
  await g.sayOff();

  // --- תקלה 1: תוכנת הקליטה אינה מחוברת ---
  await g.say('עכשיו נראה מה קורה כשמשהו לא מחובר — ומה בדיוק לעשות.', 4000);
  await link(page, { software: false });
  await g.pointMaybe('.clicker-toast', { hold: 1800, pad: 6 });
  await g.say('זו התקלה הנפוצה: חלון הקליטה פתוח, אבל אינו מחובר לתוכנת המשחק.');
  await g.say('בחלון הקליטה עצמו זה ייראה תקין — ולכן ההודעה כאן אומרת זאת מפורשות.', 5000);
  await g.pointOff();
  await g.say('הפתרון: לפתוח את חלון הקליטה וללחוץ Connect.', 3800);

  // הכפתור שפותח את חלון הקליטה
  await page.keyboard.press('KeyM').catch(() => {});
  await page.waitForTimeout(600);
  const menu = await page.locator('.operator-clicker-btn').count();
  if (menu > 0) {
    await g.point('.operator-clicker-btn', { hold: 1600 });
    await g.say('מתפריט המפעיל: "חלון קליטת שלטים" — שם נמצא כפתור Connect וטווח השלטים.');
    await g.pointOff();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }

  // --- תקלה 2: הדונגל אינו מחובר ---
  await link(page, { software: true, dongle: 'not_connected' });
  await g.pointMaybe('.clicker-toast', { hold: 1800, pad: 6 });
  await g.say('כאן ההפך: החיבור לתוכנת המשחק תקין, אבל הדונגל עצמו אינו מזוהה.');
  await g.say('מכניסים את הדונגל ל-USB ולוחצים Connect בחלון הקליטה.', 4400);
  await g.pointOff();

  // --- תקלה 3: הפורט תפוס ---
  await link(page, { listening: false, busy: true });
  await g.pointMaybe('.clicker-toast', { hold: 1800, pad: 6 });
  await g.say('ומצב שלישי: תוכנה אחרת במחשב תפסה את הפורט שדרכו מגיעות ההצבעות.');
  await g.say('סוגרים אותה — או מפעילים מחדש את המחשב. החיבור יחזור לבד.', 4600);
  await g.pointOff();

  // --- חזרה לתקין ---
  await link(page, { software: true, dongle: 'connected' });
  await g.say('ברגע שהשרשרת שלמה — החיווי חוזר לירוק בלי לעשות דבר.', 4000);
  await g.point('.clicker-badge', { hold: 1600 });
  await g.pointOff();

  // --- לחיצה נקלטת ---
  await g.say('בדיקה אחרונה: לוחצים על שלט, ורואים שהמונה עולה.', 3800);
  for (const id of [101, 102, 103]) {
    await page.evaluate((n) => window.__desk.press(n), id);
    await page.waitForTimeout(800);
  }
  await g.wait(1200);
  await g.sayOff();

  await g.card(
    'אין קליטה? שלוש בדיקות',
    '1. הדונגל מחובר, וחלון הקליטה מראה Connected\n2. בחלון הקליטה נלחץ Connect\n3. אין תוכנה אחרת שתפסה את הפורט',
    'ההודעה במסך תמיד אומרת איזו חוליה נפלה',
    6400,
  );

  return g.finish();
}
