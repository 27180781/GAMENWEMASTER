/**
 * רישום ה-Service Worker של מטמון המדיה (public/sw.js) — לא-חוסם ומדיה בלבד.
 *
 * ה-SW שומר רק מדיה כבדה, לעולם לא את קבצי האפליקציה, כך שאין סיכון להיתקע על
 * גרסה ישנה. הרישום כאן אינו מעכב את פתיחת המשחק: הוא רץ אחרי אירוע load וברקע.
 * לא זמין באופליין (‎file://‎ ב-EXE) ולא בפיתוח — שם נופלים חלק להתנהגות הרגילה.
 */

// מדיניות הסיומות — נשמרת מסונכרנת עם MEDIA_EXT ב-public/sw.js (עותק קטן וזהה).
const MEDIA_EXT =
  /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg|mp3|wav|ogg|oga|m4a|aac|flac|opus|mp4|m4v|webm|mov|ogv)(\?.*)?$/i;

/** האם כתובת נחשבת מדיה לצורך המטמון (משמש לתיעוד/בדיקות; ה-SW מחליט בפועל). */
export function isMediaUrl(url: string): boolean {
  try {
    return MEDIA_EXT.test(new URL(url, 'http://x').pathname);
  } catch {
    return false;
  }
}

/** רושם את ה-SW של מטמון המדיה — בבטחה, ובלי לחסום את הטעינה. */
export function registerMediaServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return; // רק בבנייה — לא מפריע ל-HMR בפיתוח
  if (typeof window === 'undefined' || window.location.protocol === 'file:') return; // EXE אופליין
  const start = () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* רישום נכשל — ממשיכים רגיל מהרשת */
    });
    // מבקשים אחסון בר-קיימא כדי שהדפדפן לא יפנה את מטמון המדיה בלחץ אחסון
    void navigator.storage?.persist?.().catch(() => {});
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}

/** ניקוי מטמון המדיה — פתח מילוט למפעיל ("נקה מדיה שמורה"). */
export async function clearMediaCache(): Promise<void> {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'clear-media-cache' });
    if (typeof caches !== 'undefined') {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith('media-cache-')).map((n) => caches.delete(n)));
    }
  } catch {
    /* אין תמיכה במטמון — מתעלמים */
  }
}
