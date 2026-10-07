/**
 * פרק 4 — שמות וקבוצות לשלטים.
 *
 * מתחיל ממה שרוב המפעילים רואים: רשימת המשתתפים שהוזנה באתר מגיעה עם המשחק.
 * מי שהוזן עם מספר שלט מוכן; מי שבלי מספר ממתין בתור, וקליטת השלטים בלחיצה
 * נותנת לכל שלט חדש את השם הבא — והמספר נשמר גם באתר. אחר כך «שיוך מחדש»,
 * הוספת שמות לתור בהקלדה, ורשימה עם מספרים מאקסל.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openGuide } from '../harness.mjs';
import { DEMO_GAME, demoZipB64 } from '../demoGame.mjs';
import { enterClickerGame } from '../flow.mjs';
import { writeXlsx } from '../sheet.mjs';
import { ofTotal } from '../chapters.mjs';

export const meta = {
  slug: '04-shemot-vekvutzot',
  index: 'פרק 4',
  name: 'שמות וקבוצות לשלטים',
  blurb: 'שמות מהאתר, קליטת שלטים בלחיצה לפי התור, שיוך מחדש וייבוא מאקסל.',
};

/** משחק שרשימת המשתתפים שלו נבנתה באתר: שניים עם מספר שלט, שלושה בלי. */
const GAME = {
  ...DEMO_GAME,
  users: JSON.stringify({
    101: { remoteId: '101', name: 'אבי כהן', participantId: 'guide-p-101' },
    102: { remoteId: '102', name: 'בתיה לוי', participantId: 'guide-p-102' },
  }),
  pendingUsers: [
    { id: 'guide-p-1', name: 'הדס פרץ', groupName: '' },
    { id: 'guide-p-2', name: 'ויקטור נחום', groupName: '' },
    { id: 'guide-p-3', name: 'זהר בן דוד', groupName: '' },
  ],
};

/** לחיצה על שלט, בקצב שאפשר לעקוב אחריו בסרטון. */
async function press(page, ids, gap = 1000) {
  for (const id of ids) {
    await page.evaluate((n) => window.__desk.press(n), id);
    await page.waitForTimeout(gap);
  }
}

export async function record() {
  // שם קובץ באנגלית: Playwright אינו מצרף קובץ ששמו אינו ASCII.
  const tmp = mkdtempSync(join(tmpdir(), 'guide-sheets-'));
  // אקסל מלא: מספר שלט · שם · קבוצה. שם עמודת הקבוצה הופך לשם הקטגוריה.
  const full = await writeXlsx(join(tmp, 'participants.xlsx'), 'משתתפים', [
    ['מספר שלט', 'שם', 'עיר'],
    [301, 'יעל שגב', 'ירושלים'],
    [302, 'משה ברק', 'חיפה'],
    [303, 'נועה כץ', 'ירושלים'],
    [304, 'עמית גל', 'חיפה'],
  ]);

  const g = await openGuide({ ...meta, zipB64: await demoZipB64(GAME) });
  const { page } = g;

  await g.card('שמות וקבוצות לשלטים', 'מי מחזיק איזה שלט', ofTotal(meta), 3800);
  await g.cardOff();

  await g.say('נתחיל משחק במצב שלטים — שם מנהלים את רשימת המשתתפים.');
  await enterClickerGame(g);
  await g.sayOff();

  // --- פתיחת הרשימה ---
  await g.point('button[title="שמות וקבוצות"]', { hold: 1200 });
  await g.say('הכפתור 👥 בפינה פותח את רשימת השמות והקבוצות.', 3600);
  await g.pointOff();
  await g.click('button[title="שמות וקבוצות"]', { after: 1200 });
  await g.sayOff();

  // --- מה שהגיע מהאתר ---
  await g.point('.roster-names', { hold: 1400, pad: 4 });
  await g.say('משתתפים שהוזנו באתר עם מספר שלט כבר כאן, ומוכנים לשחק.');
  await g.pointOff();
  await g.point('.roster-pending-list', { hold: 1400, pad: 6 });
  await g.say('ומי שהוזן באתר בלי מספר שלט מחכה כאן, בתור.');
  await g.pointOff();

  // --- קליטה בלחיצה לפי התור ---
  await g.point('.roster-capture-btn', { hold: 1200 });
  await g.say('מפעילים "קליטת שלטים בלחיצה", ומחלקים את השלטים לפי סדר התור.');
  await g.click('.roster-capture-btn', { after: 1000 });
  await g.pointOff();
  await g.say('כל שלט חדש שנלחץ מקבל את השם הבא בתור.', 3200);
  await press(page, [201, 202, 203], 1300);
  await g.wait(800);
  await g.point('.roster-names', { hold: 1400, pad: 4 });
  await g.say('שלושת השמות קיבלו שלטים — לפי סדר הלחיצות.');
  await g.pointOff();
  await page.waitForSelector('.roster-save-status--ok', { timeout: 15000 });
  await g.point('.roster-save-status', { hold: 1200, pad: 4 });
  await g.say('המספרים נשמרים גם באתר. כך כל מחשב שמריץ את המשחק יקבל אותם.');
  await g.pointOff();

  // --- שיוך מחדש ---
  await g.point('.roster-reassign-btn', { hold: 1200 });
  await g.say('השלטים התבלבלו? "שיוך מחדש" מחזיר את השמות לתור, ולוחצים שוב לפי הסדר.');
  await g.click('.roster-reassign-btn', { after: 1400 });
  await g.pointOff();
  await g.point('.roster-pending-list', { hold: 1200, pad: 6 });
  await g.say('השמות חזרו לתור. מספרים שהוקלדו באתר לא משתנים.');
  await g.pointOff();
  await press(page, [203, 201, 202], 1300);
  await g.wait(800);
  await g.say('והשמות שויכו מחדש, לפי סדר הלחיצות.', 3200);

  // --- הוספה לתור בהקלדה ---
  await g.say('אפשר להוסיף שמות לתור גם בהקלדה — שם בכל שורה, או "שם, קבוצה".');
  await g.type('.roster-names-draft', 'חן שפירא\nטל אביבי', { after: 900 });
  await g.click('.roster-names-add', { after: 1300 });
  await g.pointOff();
  await press(page, [204], 1500);
  await g.say('השם הראשון כבר קיבל שלט, והשני ממתין ללחיצה הבאה.');
  await g.point('.roster-pending .roster-import-btn', { hold: 900 });
  await g.say('ויש גם "השלמת שמות מאקסל" — לרשימה של שמות בלבד.', 3800);
  await g.pointOff();

  await g.click('.roster-capture-btn', { after: 1000 });
  await g.say('בסיום מכבים את הקליטה.', 2800);
  await g.sayOff();

  // --- רשימה עם מספרי שלטים: אקסל ---
  await g.point('.roster-import-btn', { hold: 1200 });
  await g.say('יש לכם רשימה עם מספרי שלטים? "ייבוא מאקסל": מספר שלט, שם וקבוצה.');
  await g.say('השורה הראשונה בקובץ היא שורת כותרת, והיא אינה מיובאת.', 3800);
  await g.pointOff();
  await page.locator('.roster-file-full').setInputFiles(full);
  await page.waitForTimeout(1500);
  await g.point('.roster-names .roster-name-row:last-child', { hold: 900, pad: 4 });
  await g.say('ארבעה משתתפים נוספו לרשימה, כל אחד עם מספר השלט שלו.', 3800);
  await g.pointOff();
  await g.click('.roster-tabs button:nth-child(2)', { after: 1400 });
  await g.point('.roster-category', { hold: 2000, pad: 6 });
  await g.say('ועמודת "עיר" הפכה לקבוצות: ירושלים וחיפה, עם המשתתפים שבהן.');
  await g.pointOff();
  await g.click('.roster-tabs button:nth-child(1)', { after: 800 });
  await g.sayOff();

  await g.card(
    'לסיכום',
    'נרשמו באתר עם מספר שלט ← מוכנים לשחק\nנרשמו בלי מספר ← קליטה בלחיצה לפי התור\nהשלטים התבלבלו ← שיוך מחדש\nרשימה עם מספרים ← ייבוא מאקסל',
    '',
    6800,
  );

  const out = await g.finish();
  rmSync(tmp, { recursive: true, force: true });
  return out;
}
