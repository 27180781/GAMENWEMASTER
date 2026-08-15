/**
 * פרק 6 — עריכת קובץ המשחק בתוך התוכנה.
 */

import { openGuide } from '../harness.mjs';
import { demoZipB64 } from '../demoGame.mjs';

export const meta = {
  slug: '06-arichat-hamishak',
  index: 'פרק 6',
  name: 'עריכת המשחק במחשב',
  blurb: 'הוספה ועריכה של שקופיות, סוגי שקופיות, הגדרות ושמירה לקובץ.',
};

export async function record() {
  const g = await openGuide({ ...meta, zipB64: await demoZipB64() });
  const { page } = g;

  await g.card('עריכת המשחק', 'לשנות את קובץ המשחק בלי לצאת מהתוכנה', 'פרק 6 מתוך 6', 3800);
  await g.cardOff();

  await page.waitForSelector('.clicker-intro-screen', { timeout: 15000 });
  await g.say('במסך הפתיחה יש כפתור "עריכת המשחק" — שם עורכים את הקובץ עצמו.', 4200);
  await g.click('button:has-text("עריכת המשחק")', { after: 1800 });
  await page.waitForSelector('.editor-screen', { timeout: 15000 });
  await g.wait(900);
  await g.sayOff();

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
  await g.say('הפכנו את הסקר לשאלת טריוויה — וכעת יש לסמן תשובה נכונה.', 4400);
  await g.pointOff();
  await g.click('.se-tick >> nth=0', { after: 1200 });
  await g.say('התשובות שנכתבו נשמרות גם כשמחליפים סוג הלוך ושוב.', 4200);
  await g.sayOff();

  // --- זמן וניקוד ---
  await g.point('.se-num-row', { hold: 1800, pad: 6 });
  await g.say('זמן וניקוד לשאלה — במחוון או בהקלדת המספר המדויק.');
  await g.pointOff();
  await g.sayOff();

  // --- מדיה ---
  await g.point('.se-media-grid', { hold: 1800, pad: 6 });
  await g.say('אפשר לצרף תמונה או וידאו לשאלה, ורקע לשקופית.');
  await g.pointOff();
  await g.sayOff();

  // --- הגדרות המשחק ---
  await g.point('.ge-acc >> nth=0', { hold: 1500, pad: 4 });
  await g.say('בעמודת ההגדרות — כותרת קבועה, צבעים, מספר זוכים ועוד.');
  await g.pointOff();
  await g.sayOff();

  // --- שמירה ---
  await g.point('.editor-save', { hold: 1800 });
  await g.say('ולבסוף — שמירה. השינויים נכתבים לקובץ המשחק שעל המחשב.');
  await g.say('בלי השמירה הזו השינויים תקפים לפעם הזו בלבד.', 4200);
  await g.pointOff();
  await g.click('.editor-save', { after: 1800 });
  await g.say('נשמר. הפתיחה הבאה כבר תטען את הגרסה המעודכנת.', 4000);
  await g.sayOff();

  await g.card('סוף המדריך', 'בהצלחה באירוע!', '', 3600);

  return g.finish();
}
