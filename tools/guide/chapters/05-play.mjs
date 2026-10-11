/**
 * פרק 5 — הרצת המשחק: מסך ההתחברות, פתיחת ההצבעה וסגירתה, והמקשים.
 *
 * הסדר בשקופית הוא סדר המפעיל (advanceStep ב-GameHost.tsx): השאלה עולה עם
 * הכניסה לשקופית ← כל רווח חושף תשובה אחת ← רווח מפעיל את הטיימר ופותח את
 * ההצבעה ← רווח (או סוף הטיימר) סוגר אותה ← רווח חושף את התשובה הנכונה ←
 * רווח לשקופית הבאה. הצבעה לפני שנפתחה אינה נקלטת, ולכן הלחיצות בסרטון באות
 * רק אחריה.
 */

import { openGuide } from '../harness.mjs';
import { DEMO_GAME, demoZipB64 } from '../demoGame.mjs';
import { enterClickerGame } from '../flow.mjs';
import { ofTotal } from '../chapters.mjs';

export const meta = {
  slug: '05-hatzagat-hamishak',
  index: 'פרק 5',
  name: 'הרצת המשחק',
  blurb: 'מסך ההתחברות, פתיחת ההצבעה וסגירתה, המקשים ותפריט המפעיל.',
};

export async function record() {
  // טיימר ארוך מהרגיל, שלא ייגמר לבד באמצע ההסבר ויסגור את ההצבעה לפני הרווח.
  const game = {
    ...DEMO_GAME,
    questions: DEMO_GAME.questions.map((q) => ({ ...q, question: { ...q.question, timeForQue: 45 } })),
  };
  const g = await openGuide({ ...meta, zipB64: await demoZipB64(game) });
  const { page } = g;
  const key = async (k, ms = 1600) => {
    await page.keyboard.press(k);
    await page.waitForTimeout(ms);
  };

  await g.card('הרצת המשחק', 'מההתחברות ועד חשיפת התשובה', ofTotal(meta), 3600);
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
  await key('Space', 2600);

  // --- שאלה, תשובות, הצבעה, חשיפה ---
  await page.waitForSelector('.q-screen', { timeout: 15000 });
  await g.say('השאלה עולה מיד. רווח הוא המקש המרכזי: כל לחיצה מקדמת צעד אחד.', 4400);
  await g.say('כל רווח חושף תשובה אחת…', 1200);
  for (let i = 0; i < DEMO_GAME.questions[0].question.answers.length; i++) await key('Space', 1100);
  await g.say('…ורווח נוסף מפעיל את הטיימר ופותח את ההצבעה.', 1600);
  await key('Space', 2000);
  await g.say('עכשיו המשתתפים לוחצים בשלט על מספר התשובה.', 1400);
  for (const [id, btn] of [[101, 1], [102, 1], [103, 2], [104, 1]]) {
    await page.evaluate(([n, b]) => window.__desk.press(n, b), [id, btn]);
    await page.waitForTimeout(700);
  }
  await g.wait(800);
  await g.point('.q-answered-pill', { hold: 1000, pad: 6 });
  await g.say('המונה מראה כמה כבר ענו.', 2800);
  await g.pointOff();
  await g.say('רווח עוצר את הטיימר וסוגר את ההצבעה. גם סוף הטיימר סוגר אותה.', 1600);
  await key('Space', 3000);
  await g.say('רווח נוסף חושף את התשובה הנכונה…', 1400);
  await key('Space', 3400);
  await g.say('…ועוד רווח עובר לשאלה הבאה.', 1400);
  await key('Space', 2200);
  await g.say('אפשר גם לקבוע שהשלבים יתקדמו לבד, בהגדרות "מהלך המשחק".');
  await g.sayOff();

  // --- המקשים ---
  await g.card(
    'המקשים',
    'רווח — השלב הבא\n2 — צעד אחורה\n1 — טבלת המובילים\n3 — מחיאות כפיים\n4 / 5 — עוד 10 שניות / פחות 10 שניות\n6 — עצירת הטיימר והמשך\nR — הגרלה בין המשתתפים\nX — מסך ההתחברות',
    'המקשים 0 עד 6 עובדים גם משלט המנחה',
    8200,
  );
  await g.cardOff();

  await key('Digit1', 1800);
  await g.say('1 פותח את טבלת המובילים, ולחיצה נוספת סוגרת אותה.', 3800);
  await key('Digit1', 1200);
  await g.sayOff();

  await key('KeyR', 2600);
  await g.say('R מגריל משתתף. רווח סוגר את ההגרלה וחוזר למשחק.', 3800);
  await key('Space', 1200);
  await g.sayOff();

  // X מאפס רק את רשימת התצוגה (showResetLobby): השחקנים נשארים מחוברים, וכל
  // שלט שנלחץ מופיע בה מחדש — גם שלט חדש שמצטרף באמצע.
  await key('KeyX', 1600);
  await g.say('X פותח שוב את מסך ההתחברות, עם רשימה ריקה.', 3200);
  for (const id of [101, 102, 103, 104, 105]) {
    await page.evaluate((n) => window.__desk.press(n), id);
    await page.waitForTimeout(500);
  }
  await g.say('כל מי שלוחץ עכשיו מופיע בה. כך בודקים שכל השלטים עובדים, ומצרפים משתתפים חדשים.');
  await g.say('אף אחד לא מתנתק, והניקוד נשמר. הטיימר עומד בינתיים.', 3800);
  await key('Space', 1400);
  await g.say('ורווח חוזר בדיוק לאן שהיינו.', 3000);
  await g.sayOff();

  // --- תפריט המפעיל ---
  await g.point('.operator-menu-fab', { hold: 1200 });
  await g.say('הכפתור ☰ בפינה פותח את תפריט המפעיל.', 3200);
  await g.click('.operator-menu-fab', { after: 1200 });
  await g.point('.operator-menu-panel', { hold: 1600, pad: 6 });
  await g.say('שם: קפיצה לכל שקופית, חלון קליטת השלטים, שמירת התוצאות לאקסל וסיום המשחק.');
  await g.pointOff();
  await key('Escape', 900);
  await g.say('Esc סוגר את התפריט. מחוץ לתפריט, Esc שואל אם לצאת מהמשחק.', 4200);
  await g.sayOff();

  await g.card('בפרק הבא', 'מספר המחשב ומשחקים שנשלחים אליו', '', 3200);

  return g.finish();
}
