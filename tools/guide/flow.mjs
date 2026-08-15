/**
 * מעברים חוזרים בין מסכי התוכנה, כדי שכל פרק לא יחזור עליהם.
 * כתובים מול המסכים האמיתיים — אם מסך ישתנה, ההקלטות ייכשלו כאן בקול רם
 * במקום להמשיך ולהקליט משהו לא נכון.
 */

/** מדווח שהשרת המקומי מאזין, שתוכנת הקליטה מחוברת ושהדונגל מזוהה. */
export async function receiverOnline(page) {
  await page.evaluate(() => {
    window.__desk.server({ listening: true, port: 8090 });
    window.__desk.receiver({ connected: true, who: '127.0.0.1' });
    window.__desk.clicker({ type: 'status', code: 1, status: 'connected' });
  });
  await page.waitForTimeout(700);
}

/**
 * מסך "איך משחקים?" ← שלטים ← מסך ההמתנה ← לובי המשחק.
 * הדיווח על הריסיבר נשלח פעמיים: פעם ראשונה כדי לשחרר את ההמתנה, ופעם שנייה
 * אחרי שהלובי עלה — כי המנוי לאירועים נוצר רק כשמסך המשחק נטען.
 */
export async function enterClickerGame(g) {
  const { page } = g;
  await page.waitForSelector('.clicker-intro-screen', { timeout: 15000 });
  await g.click('button:has(.clicker-choice-title:text-is("שחק עם שלטים"))', { after: 1200 });
  await receiverOnline(page);
  await page.waitForSelector('.lobby-screen', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await receiverOnline(page);
}
