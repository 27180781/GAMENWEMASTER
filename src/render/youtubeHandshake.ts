/**
 * לחיצת היד עם נגן היוטיוב (iframe עם ‎enablejsapi=1‎), בלי React — כדי שאפשר
 * יהיה לבדוק אותה.
 *
 * הנגן שולח הודעות רק אחרי שקיבל מאיתנו ‎{"event":"listening"}‎. קודם שלחנו
 * אותה פעמיים בלבד (ב-load וב-1.5 שנ'), ואם שתיהן הלכו לאיבוד — iframe שעוד לא
 * סיים לטעון ב-Wi-Fi איטי של אולם — הנגן לא ענה לעולם, ואחרי 8 שנ' סרטון שבאמת
 * התנגן הוסר ובמקומו הוצג מסך שגיאה. עכשיו ההודעה נשלחת שוב ושוב עד התשובה
 * הראשונה, ורק אז נעצרת.
 *
 * כשל אמיתי (מזהה שגוי, סרטון פרטי, בעל ערוץ שחסם הטמעה) עדיין מזוהה: נגן כזה
 * לא עונה לשום מספר של בקשות, והטיימר של ALIVE_TIMEOUT_MS יורה.
 */

/** כל כמה זמן לבקש שוב מהנגן להאזין, עד שהוא עונה. */
export const LISTEN_INTERVAL_MS = 400;

/** כמה להמתין לסימן חיים מהנגן לפני שמכריזים על כשל. */
export const ALIVE_TIMEOUT_MS = 8000;

export interface YoutubeHandshake {
  /** הגיעה הודעה מהנגן — הוא חי. עוצר את השליחה החוזרת ואת טיימר הכשל. */
  markAlive(): void;
  /** שליחה מיידית (למשל ב-load של ה-iframe). */
  sendNow(): void;
  dispose(): void;
}

export function startYoutubeHandshake(opts: {
  /** שולח ‎{"event":"listening"}‎ לחלון של ה-iframe. */
  send: () => void;
  /** הנגן לא ענה בתוך ALIVE_TIMEOUT_MS. לא מועבר ברקע — שם אין מה להציג. */
  onTimeout?: (() => void) | undefined;
}): YoutubeHandshake {
  let alive = false;
  let disposed = false;
  const send = () => {
    if (!alive && !disposed) opts.send();
  };
  const interval = setInterval(send, LISTEN_INTERVAL_MS);
  const timeout = setTimeout(() => {
    if (!alive && !disposed) opts.onTimeout?.();
  }, ALIVE_TIMEOUT_MS);
  const stop = () => {
    clearInterval(interval);
    clearTimeout(timeout);
  };
  return {
    markAlive() {
      if (alive) return;
      alive = true;
      stop();
    },
    sendNow: send,
    dispose() {
      disposed = true;
      stop();
    },
  };
}
