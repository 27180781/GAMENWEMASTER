/**
 * פרק 7 — עריכת המשחק בתוך התוכנה (GameEditor).
 *
 * העריכה במחשב נפתחת רק אחרי שהמנהל אישר אותו (DevicePanel), ולכן הפרק
 * מתחיל מהכפתור הנעול. המשחק הוא משחק שהורד לפי קוד — המקרה הנפוץ — כדי
 * שההסבר על השמירה יתאים: היא משנה את העותק שבמחשב, לא את המשחק באתר.
 */

import { openGuide } from '../harness.mjs';
import { DEMO_GAME, demoZipB64 } from '../demoGame.mjs';
import { ofTotal } from '../chapters.mjs';

export const meta = {
  slug: '07-arichat-hamishak',
  index: 'פרק 7',
  name: 'עריכת המשחק במחשב',
  blurb: 'אישור העריכה, הוספה ועריכה של שקופיות, הגדרות ושמירה.',
};

const CODE = '482913';

export async function record() {
  const g = await openGuide({
    ...meta,
    zipB64: await demoZipB64(),
    // המשחק האחרון הוא משחק שהורד לפי קוד, והמחשב עוד לא אושר לעריכה.
    lastGame: CODE,
    library: [
      { code: CODE, name: DEMO_GAME.name, gameId: 'guide-demo', version: 'v1', size: 54 * 1048576, game: DEMO_GAME },
    ],
    device: { id: '48217730', name: 'מחשב האולם', permissions: { createGame: false, editGame: false } },
  });
  const { page } = g;
  const editBtn = 'button.settings-pick-another:has-text("עריכת המשחק")';

  await g.card('עריכת המשחק', 'לשנות את המשחק בלי לצאת מהתוכנה', ofTotal(meta), 3800);
  await g.cardOff();

  // --- האישור ---
  await page.waitForSelector('.clicker-intro-screen', { timeout: 15000 });
  await g.point(editBtn, { hold: 1200 });
  await g.say('במסך הזה יש כפתור "עריכת המשחק". כאן הוא עוד נעול 🔒.', 3800);
  await g.say('עריכה במחשב נפתחת אחרי שהמנהל מאשר אותו במערכת, לפי מספר המחשב.');
  await g.pointOff();
  await page.evaluate(() => window.__desk.device({ permissions: { createGame: true, editGame: true } }));
  await g.wait(1000);
  await g.point(editBtn, { hold: 900 });
  await g.say('המנהל אישר, והכפתור נפתח. האישור נשמר במחשב, גם בלי אינטרנט.');
  await g.click(editBtn, { after: 1800 });
  await page.waitForSelector('.editor-screen', { timeout: 15000 });
  await g.wait(900);
  await g.sayOff();

  // --- המבנה ---
  await g.say('העורך בנוי משלוש עמודות.', 2800);
  await g.point('.ge-sidebar', { hold: 1800, pad: 4 });
  await g.say('מימין — הגדרות המשחק: צבעים, ניקוד, מדיה וצלילים.');
  await g.pointOff();
  await g.point('.ge-slides', { hold: 1800, pad: 4 });
  await g.say('באמצע — רשימת השקופיות, עם חיפוש.');
  await g.pointOff();
  await g.point('.ge-canvas', { hold: 1800, pad: 4 });
  await g.say('ומשמאל — עריכת השקופית שנבחרה.');
  await g.pointOff();
  await g.sayOff();

  // --- הוספת שקופית לפי סוג ---
  await g.point('.ge-typebar', { hold: 1800, pad: 6 });
  await g.say('בסרגל העליון — הוספת שקופית. לחיצה על סוג מוסיפה שקופית מהסוג הזה.');
  await g.pointOff();
  await g.click('.ge-type:has-text("סקר")', { after: 1500 });
  await g.say('נוספה שקופית סקר, והיא נבחרה מיד לעריכה.', 3600);

  await g.type('.se-textarea', 'איזו מוזיקה נשמיע בהפסקה?', { after: 900 });
  await g.say('כותבים את השאלה…', 2400);
  await g.type('.se-answer-text >> nth=0', 'ישראלי', { after: 700 });
  await g.type('.se-answer-text >> nth=1', 'לועזי', { after: 900 });
  await g.click('.se-add-answer', { after: 900 });
  await g.type('.se-answer-text >> nth=2', 'שקט, תודה', { after: 900 });
  await g.say('ואת התשובות. בסקר אין תשובה נכונה — רק התפלגות.', 4000);
  await g.sayOff();

  // --- שינוי סוג ---
  await g.point('.se-type', { hold: 1600 });
  await g.say('אפשר להחליף סוג של שקופית קיימת בכל רגע.');
  await page.selectOption('.se-type', 'trivia');
  await page.waitForTimeout(1400);
  await g.say('הפכנו את הסקר לשאלת טריוויה. בטריוויה מסמנים ב-✓ את התשובה הנכונה.', 4400);
  await g.pointOff();
  await g.click('.se-tick >> nth=1', { after: 1200 });
  await g.say('התשובות שנכתבו נשמרות גם כשמחליפים סוג הלוך ושוב.', 4200);
  await g.sayOff();

  // --- זמן, ניקוד ומדיה ---
  await g.point('.se-num-row', { hold: 1800, pad: 6 });
  await g.say('זמן וניקוד לשאלה — במחוון או בהקלדת המספר המדויק.');
  await g.pointOff();
  await g.point('.se-media-grid', { hold: 1800, pad: 6 });
  await g.say('אפשר לצרף תמונה או וידאו לשאלה, ורקע לשקופית.');
  await g.pointOff();
  await g.sayOff();

  // --- הגדרות המשחק ויבוא ---
  await g.point('.ge-acc >> nth=0', { hold: 1500, pad: 4 });
  await g.say('בעמודת ההגדרות — לוגו וכותרת, צבעים וערכת נושא, מדיה, ניקוד ומנצחים.');
  await g.pointOff();
  await g.point('.ge-import', { hold: 1200 });
  await g.say('"יבוא מאקסל" מוסיף הרבה שאלות בבת אחת. נראה אותו בפרק הבא.');
  await g.pointOff();
  await g.sayOff();

  // --- שמירה ---
  await g.point('.editor-save', { hold: 1800 });
  await g.say('ולבסוף — שמירה. בלי השמירה השינויים לא נכנסים למשחק.');
  await g.say('סוגרים בלי לשמור? התוכנה תשאל אם לצאת בלי לשמור.', 3800);
  await g.pointOff();
  await g.click('.editor-save', { after: 1800 });
  await g.point('.editor-saved', { hold: 900, pad: 4 });
  await g.say('נשמר. מעכשיו המשחק נפתח עם השינויים.', 3600);
  await g.pointOff();
  await g.say('העריכה משנה רק את העותק שבמחשב הזה. כדי שהשינוי יגיע לכל המחשבים — ערכו באתר.');
  await g.sayOff();

  await g.card('בפרק הבא', 'בניית משחק חדש במחשב', '', 3200);

  return g.finish();
}
