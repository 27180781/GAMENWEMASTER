/**
 * פרק 8 — בניית משחק חדש במחשב, מאפס (NewGameDialog), ומילוי שלו בשאלות
 * מאקסל (ImportExcelDialog) — באותה תבנית של האתר.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openGuide } from '../harness.mjs';
import { DEMO_GAME, demoZipB64 } from '../demoGame.mjs';
import { writeXlsx } from '../sheet.mjs';
import { ofTotal } from '../chapters.mjs';

export const meta = {
  slug: '08-mishak-chadash',
  index: 'פרק 8',
  name: 'בניית משחק חדש במחשב',
  blurb: 'משחק מאפס בלי האתר: שם ורישיון, שאלות מאקסל, שמירה ומשחק.',
};

export async function record() {
  // שם קובץ באנגלית: Playwright אינו מצרף קובץ ששמו אינו ASCII.
  const tmp = mkdtempSync(join(tmpdir(), 'guide-questions-'));
  // הכותרות של תבנית היבוא (TEMPLATE_ROWS ב-questionImport.ts); התשובה הנכונה לפי מספרה.
  const sheet = await writeXlsx(join(tmp, 'questions.xlsx'), 'שאלות', [
    ['סוג שאלה', 'טקסט השאלה', 'תשובה 1', 'תשובה 2', 'תשובה 3', 'תשובה 4', 'תשובה 5', 'תשובה 6', 'תשובה נכונה'],
    ['טריוויה', 'כמה צלעות יש למשושה?', '5', '6', '7', '8', '', '', '2'],
    ['טריוויה', 'איזה כוכב לכת הוא הקרוב ביותר לשמש?', 'נוגה', 'מאדים', 'כוכב חמה', 'צדק', '', '', '3'],
    ['טריוויה', 'כמה דקות יש ביממה?', '1,440', '1,240', '2,400', '1,000', '', '', '1'],
    ['סקר', 'לאן נצא בטיול הצוות הבא?', 'הצפון', 'ים המלח', 'אילת', 'ירושלים', '', '', ''],
  ]);

  const g = await openGuide({
    ...meta,
    zipB64: await demoZipB64(),
    lastGame: false,
    library: [
      { code: '482913', name: DEMO_GAME.name, gameId: 'guide-demo', version: 'v1', size: 54 * 1048576, game: DEMO_GAME },
    ],
    // המנהל כבר אישר את המחשב לבניית משחקים.
    device: { id: '48217730', name: 'מחשב האולם', permissions: { createGame: true, editGame: false } },
  });
  const { page } = g;

  await g.card('משחק חדש מאפס', 'בונים משחק במחשב, בלי האתר', ofTotal(meta), 3800);
  await g.cardOff();

  // --- יצירה ---
  await page.waitForSelector('.offline-open-screen', { timeout: 15000 });
  await g.point('.offline-open-new', { hold: 1200 });
  await g.say('אחרי שהמנהל אישר את המחשב לבנייה, הכפתור "בניית משחק חדש" פתוח.');
  await g.click('.offline-open-new', { after: 1200 });
  await g.sayOff();
  await page.waitForSelector('.new-game-box', { timeout: 15000 });
  await g.type('.new-game-name input', 'חידון ערב צוות', { delay: 90, after: 700 });
  await g.say('נותנים למשחק שם…', 2400);
  await g.pointOff();
  await g.point('.new-game-box .lic', { hold: 1200, pad: 6 });
  await g.say('ובוחרים רישיון: קליקרים, טלפונים או שניהם, ומגבלת משתתפים.');
  await g.say('ברירת המחדל — קליקרים, בלי הגבלת משתתפים.', 3400);
  await g.pointOff();
  await g.click('.new-game-box .gate-primary', { after: 1600 });
  await page.waitForSelector('.editor-screen', { timeout: 15000 });
  await g.say('המשחק נוצר, והעורך נפתח עליו — עם שאלה אחת לדוגמה.', 3800);
  await g.sayOff();

  // --- שאלות מאקסל ---
  await g.point('.ge-import', { hold: 1200 });
  await g.say('את השאלות אפשר להקליד אחת־אחת, או להביא הרבה בבת אחת מאקסל.');
  await g.click('.ge-import', { after: 1200 });
  await g.sayOff();
  await g.point('.xi-template', { hold: 1200 });
  await g.say('מורידים את תבנית האקסל — אותה תבנית כמו באתר — וממלאים בה את השאלות.');
  await g.pointOff();
  await g.point('.xi-drop', { hold: 900, pad: 4 });
  await g.say('ואז בוחרים כאן את הקובץ המלא.', 3000);
  await g.pointOff();
  await page.locator('.xi-drop input[type=file]').setInputFiles(sheet);
  await page.waitForSelector('.xi-chips', { timeout: 15000 });
  await g.wait(600);
  await g.point('.xi-chips', { hold: 1000, pad: 6 });
  await g.say('התוכנה בודקת כל שורה, ומראה מה תקין ומה דולג.');
  await g.pointOff();
  await g.point('.xi-list', { hold: 1400, pad: 6 });
  await g.say('אלה השאלות שייכנסו למשחק.', 3000);
  await g.pointOff();
  await g.click('.xi-go', { after: 1600 });
  await g.point('.ge-state', { hold: 1000, pad: 6 });
  await g.say('ארבע השאלות נוספו לרשימה. הן עוד לא שמורות — צריך לשמור.');
  await g.pointOff();
  await g.sayOff();

  // --- השאלה לדוגמה ---
  await g.click('.se-item:has-text("שאלה חדשה") .se-item-main', { after: 900 });
  await g.point('.se-item--sel .se-del', { hold: 900 });
  await g.say('ואת השאלה לדוגמה מוחקים ב-🗑.', 3000);
  await g.click('.se-item--sel .se-del', { after: 1200 });
  await g.pointOff();
  await g.sayOff();

  // --- רישיון ושמירה ---
  await g.point('.ge-acc:has-text("רישיון")', { hold: 1200, pad: 4 });
  await g.say('את הרישיון אפשר לשנות גם כאן, אחר כך.', 3400);
  await g.pointOff();
  await g.click('.editor-save', { after: 1800 });
  await g.point('.editor-saved', { hold: 900, pad: 4 });
  await g.say('נשמר.', 2200);
  await g.pointOff();
  await g.click('.editor-close', { after: 1600 });
  await page.waitForSelector('.clicker-intro-screen', { timeout: 15000 });
  await g.say('והמשחק מוכן לשחק, בדיוק כמו משחק מהאתר.', 3600);
  await g.point('button.settings-pick-another:has-text("עריכת המשחק")', { hold: 900 });
  await g.say('משחק שנבנה במחשב אפשר לערוך גם בלי אישור עריכה — מספיק האישור לבנייה.');
  await g.pointOff();
  await g.sayOff();

  // --- ברשימה של המחשב ---
  await g.click('button:has-text("טען משחק אחר")', { after: 1400 });
  await page.waitForSelector('.lib', { timeout: 15000 });
  await g.point('.lib-item:first-child', { hold: 1200, pad: 4 });
  await g.say('המשחק נשמר ברשימת המשחקים של המחשב, עם הסימן ✨ נבנה במחשב.');
  await g.say('אין לו עותק באתר, ולכן מחיקה שלו היא סופית.', 3600);
  await g.pointOff();
  await g.sayOff();

  await g.card('סוף המדריך', 'בהצלחה באירוע!', '', 3600);

  const out = await g.finish();
  rmSync(tmp, { recursive: true, force: true });
  return out;
}
