// @ts-check
/**
 * תרגום קוד תשובה מהשרת להודעה שאומרת למנחה מה קרה ומה לעשות עכשיו.
 *
 * הרקע: הודעה כמו "השרת החזיר שגיאה (546)" חסרת ערך למי שעומד באירוע חי.
 * 546 בפרט אינו שגיאה של הקוד שהוקלד — זו מגבלת זיכרון של ה-Edge Function
 * שאורזת את ה-ZIP (WORKER_LIMIT): משחק עם וידאו כבד עובר את התקרה והריצה
 * נקטעת. במקרה כזה אין טעם לנסות שוב — התוצאה תהיה זהה — ולכן ההודעה מפנה
 * ישר לדרך שכן תעבוד: טעינת קובץ ה-ZIP מהדיסק.
 *
 * טהור (בלי Electron) כדי שיהיה ניתן לבדיקת יחידה.
 */

/**
 * @param {number} status קוד ה-HTTP שהתקבל
 * @returns {string} הודעה בעברית
 */
function remoteErrorMessage(status) {
  if (status === 404) return 'קוד לא נמצא, או שהרישיון אינו בתוקף';
  if (status === 401 || status === 403) return 'אין הרשאה לשרת המשחקים — פנו לתמיכה';
  if (status === 429) return 'יותר מדי בקשות לשרת — המתינו רגע ונסו שוב';
  // 546 = WORKER_LIMIT של Supabase Edge Functions. 507/413 הם המקבילות
  // התקניות ל"גדול מדי" — אותה מסקנה מעשית.
  if (status === 546 || status === 507 || status === 413) {
    return 'המשחק כבד מדי לאריזה בשרת (מדיה גדולה) — טענו את קובץ ה-ZIP מהמחשב, או בקשו מיוצר המשחק לייצא אותו מחדש';
  }
  if (status >= 500) return `השרת לא זמין כרגע (${status}) — נסו שוב בעוד רגע`;
  if (status >= 400) return `הבקשה נדחתה על ידי השרת (${status})`;
  return `השרת החזיר תשובה לא צפויה (${status})`;
}

/**
 * האם יש טעם לנסות שוב את אותה בקשה. כשל זיכרון באריזה הוא דטרמיניסטי —
 * ניסיון חוזר רק יבזבז את זמנו של המנחה.
 * @param {number} status
 * @returns {boolean}
 */
function isRetryable(status) {
  if (status === 546 || status === 507 || status === 413) return false;
  return status === 429 || status >= 500;
}

module.exports = { remoteErrorMessage, isRetryable };
