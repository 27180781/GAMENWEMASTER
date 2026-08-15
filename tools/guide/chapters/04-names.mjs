/**
 * פרק 4 — חיבור שמות וקבוצות לשלטים.
 * שלוש הדרכים: ייבוא אקסל מלא, קליטה חכמה בלחיצה, והשלמת שמות (אקסל/הקלדה).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openGuide } from '../harness.mjs';
import { demoZipB64 } from '../demoGame.mjs';
import { enterClickerGame } from '../flow.mjs';
import { writeXlsx } from '../sheet.mjs';

export const meta = {
  slug: '04-shemot-vekvutzot',
  index: 'פרק 4',
  name: 'שמות וקבוצות לשלטים',
  blurb: 'שלוש דרכים לשייך שם וקבוצה לכל שלט — ומתי כדאי כל אחת.',
};

export async function record() {
  // שמות קבצים באנגלית: Playwright אינו מצרף קובץ ששמו אינו ASCII.
  const tmp = mkdtempSync(join(tmpdir(), 'guide-sheets-'));
  // אקסל מלא: מספר שלט · שם · קבוצה. שם עמודת הקבוצה הופך לשם הקטגוריה.
  const full = await writeXlsx(join(tmp, 'participants.xlsx'), 'משתתפים', [
    ['מספר שלט', 'שם', 'עיר'],
    [101, 'אבי כהן', 'ירושלים'],
    [102, 'בתיה לוי', 'חיפה'],
    [103, 'גיל אדרי', 'ירושלים'],
    [104, 'דנה מזרחי', 'חיפה'],
  ]);
  // אקסל השלמה: שם · קבוצה בלבד, בלי מספרי שלטים. ארבעה שמות מול שלושה
  // שלטים שנלחצו — כדי שהשם הרביעי יישאר בתור וההדגמה תראה גם את זה.
  const namesOnly = await writeXlsx(join(tmp, 'names-only.xlsx'), 'שמות', [
    ['שם', 'מחלקה'],
    ['הדס פרץ', 'פיתוח'],
    ['ויקטור נחום', 'עיצוב'],
    ['זהר בן דוד', 'פיתוח'],
    ['יעל שגב', 'עיצוב'],
  ]);

  const g = await openGuide({ ...meta, zipB64: await demoZipB64() });
  const { page } = g;

  await g.card('שמות וקבוצות לשלטים', 'שלוש דרכים לשייך שם וקבוצה לכל שלט', 'פרק 4 מתוך 6', 3800);
  await g.cardOff();

  await g.say('נתחיל משחק במצב שלטים — שם מנהלים את רשימת המשתתפים.');
  await enterClickerGame(g);
  await g.sayOff();

  // --- פתיחת חלונית השמות ---
  await g.point('button[title="שמות וקבוצות"]', { hold: 1200 });
  await g.say('כפתור "שמות וקבוצות" בסרגל התחתון פותח את החלונית. (קיצור: מקש R)');
  await g.pointOff();
  await g.click('button[title="שמות וקבוצות"]', { after: 1000 });
  await g.point('.roster-tabs', { hold: 1400 });
  await g.say('שתי לשוניות: השמות עצמם, והקבוצות שאליהן הם משויכים.');
  await g.pointOff();
  await g.sayOff();

  // ===== דרך 1: אקסל מלא =====
  await g.say('דרך ראשונה — כשיש לכם מראש רשימה עם מספרי השלטים.', 3600);
  await g.point('.roster-import-btn', { hold: 1400 });
  await g.say('קובץ אקסל בשלוש עמודות: מספר שלט, שם, וקבוצה (הקבוצה אופציונלית).');
  await g.say('חשוב: השורה הראשונה היא שורת כותרת, והיא אינה מיובאת כמשתתף.', 4600);
  await g.pointOff();
  await page.locator('.roster-file-full').setInputFiles(full);
  await page.waitForTimeout(1500);
  await g.say('ארבעה שלטים נוספו — כל אחד עם השם והעיר שלו.', 3800);
  await g.point('.roster-names', { hold: 2000, pad: 4 });
  await g.pointOff();
  await g.say('שם עמודת הקבוצה — "עיר" — הפך לשם הקטגוריה.', 4000);
  await g.click('.roster-tabs button:nth-child(2)', { after: 1400 });
  await g.point('.roster-category', { hold: 2400, pad: 6 });
  await g.say('ירושלים וחיפה נוצרו לבד, עם המשתתפים שבתוכן.', 4000);
  await g.pointOff();
  await g.click('.roster-tabs button:nth-child(1)', { after: 1000 });
  await g.sayOff();

  // ===== דרך 2: קליטה חכמה בלחיצה =====
  await g.say('דרך שנייה — כשאתם לא יודעים מראש איזה שלט הגיע לידי מי.', 4200);
  await g.point('.roster-capture-btn', { hold: 1400 });
  await g.say('מפעילים "קליטת שלטים בלחיצה", ומבקשים מכל אחד ללחוץ בתורו.');
  await g.pointOff();
  await g.click('.roster-capture-btn', { after: 1000 });
  await g.point('.roster-capture-live', { hold: 1200 });
  await g.say('כל לחיצה מוסיפה את השלט לרשימה, לפי סדר הלחיצות.');
  await g.pointOff();
  for (const id of [501, 502, 503]) {
    await page.evaluate((n) => window.__desk.press(n), id);
    await page.waitForTimeout(1000);
  }
  await g.say('שלושה שלטים נקלטו — וכרגע הם ממתינים לשם.', 3800);

  // ===== דרך 3: השלמת שמות =====
  await g.say('דרך שלישית — משלימים את השמות אחר כך, בלי להקליד מספרי שלטים.', 4400);
  await g.point('.roster-pending .roster-import-btn', { hold: 1500 });
  await g.say('אקסל של שם וקבוצה בלבד. השמות משתבצים לשלטים שכבר נלחצו, לפי הסדר.');
  await g.pointOff();
  await page.locator('.roster-file-names').setInputFiles(namesOnly);
  await page.waitForTimeout(1700);
  await g.say('שלושת השמות הראשונים תפסו את השלטים שנלחצו.', 3800);
  await g.pointMaybe('.roster-pending-list', { hold: 1800 });
  await g.say('והשם הרביעי ממתין בתור — הלחיצה הבאה על שלט תתפוס אותו אוטומטית.', 4800);
  await g.pointOff();
  await page.evaluate(() => window.__desk.press(504));
  await page.waitForTimeout(1600);
  await g.say('בדיוק כך. השלט החדש קיבל את השם ואת הקבוצה מהתור.', 4000);

  // הקלדה ידנית
  await g.say('ואפשר גם להקליד ידנית — שם בכל שורה, או "שם, קבוצה".', 4200);
  await g.type('.roster-names-draft', 'חן שפירא, מכירות\nטל אביבי, מכירות', { after: 1000 });
  await g.click('.roster-names-add', { after: 1300 });
  await g.say('השמות נכנסו לתור וממתינים ללחיצות הבאות.', 3600);
  await page.evaluate(() => window.__desk.press(505));
  await page.waitForTimeout(1500);
  await g.sayOff();

  await g.click('.roster-capture-btn', { after: 1000 });
  await g.say('בסיום מכבים את הקליטה — וממשיכים במשחק כרגיל.', 3800);
  await g.sayOff();

  await g.card(
    'לסיכום',
    'יש רשימה עם מספרי שלטים ← ייבוא אקסל מלא\nלא יודעים מי מחזיק מה ← קליטה בלחיצה\nיש שמות בלי מספרים ← השלמה מאקסל או הקלדה',
    '',
    6000,
  );

  const out = await g.finish();
  rmSync(tmp, { recursive: true, force: true });
  return out;
}
