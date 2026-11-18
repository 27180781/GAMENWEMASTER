/**
 * המרת קישור יוטיוב לצורה שניתנת להטמעה.
 *
 * הבאג שזה פותר: כתובת ‎youtube.com/watch?v=…‎ הוזרמה ישירות ל-iframe, ויוטיוב
 * מסרב להיות ממוסגר בעמוד ה-watch (‎X-Frame-Options: SAMEORIGIN‎). התוצאה על
 * המסך הייתה ריבוע אפור עם סמל "עמוד שבור" — בלי שום הודעת שגיאה בתוכנה,
 * ובלי רמז שהבעיה היא בצורת הכתובת ולא בסרטון.
 *
 * רק ‎youtube.com/embed/<id>‎ ניתן להטמעה, ולכן כל צורה מומרת אליה. מערכת יצירת
 * המשחקים מציעה למחבר להדביק "קישור יוטיוב" — כלומר בדיוק כתובת ה-watch —
 * וזו הצורה שתגיע ברוב המקרים.
 *
 * טהור (בלי DOM) כדי שיהיה ניתן לבדיקה.
 */

/** מזהה סרטון ביוטיוב: 11 תווים מטווח base64url. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** מארחים שנחשבים יוטיוב (כולל m. ו-music., ו-nocookie לפרטיות). */
const YOUTUBE_HOST = /^(?:(?:www|m|music)\.)?youtube(?:-nocookie)?\.com$/i;
const SHORT_HOST = /^(?:www\.)?youtu\.be$/i;

/**
 * שניות מתוך פרמטר זמן של יוטיוב. תומך ב-‎90‎, ‎90s‎, ‎1m30s‎, ‎1h2m3s‎.
 * מחזיר null כשאין זמן תקין — ואז פשוט לא מוסיפים start.
 */
export function youtubeStartSeconds(raw: string | null): number | null {
  if (raw === null) return null;
  const value = raw.trim();
  if (value === '') return null;
  if (/^\d+$/.test(value)) {
    const n = Number(value);
    return n > 0 ? n : null;
  }
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(value);
  if (m === null || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return null;
  const total = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return total > 0 ? total : null;
}

/**
 * האם זו בכלל כתובת של יוטיוב — לפי המארח בלבד, בלי לדרוש מזהה תקין.
 *
 * מכוון **רחב** בכוונה, ובנפרד מ-youtubeVideoId שמכוון צר: הסיווג קובע גם מה
 * *לא* לעשות — לא למשוך מראש לזיכרון ולא לבדוק אם הקישור שבור. קישור יוטיוב
 * עם מזהה משובש שהיה מסווג כ"לא מוכר" היה נשלח להורדה מלאה של עמוד יוטיוב,
 * ועוד היה מדווח למנחה כ"מדיה שבורה". עדיף לזהות אותו כיוטיוב, ואם ההטמעה
 * תיכשל — הנגן כבר יודע לומר את זה (ראו ALIVE_TIMEOUT_MS).
 */
export function isYoutubeUrl(src: string): boolean {
  try {
    const host = new URL(src.trim()).hostname;
    return YOUTUBE_HOST.test(host) || SHORT_HOST.test(host);
  } catch {
    return false;
  }
}

/**
 * מזהה הסרטון מתוך כל צורה מוכרת של קישור יוטיוב, או null.
 *
 * הצורות: ‎watch?v=‎ · ‎youtu.be/‎ · ‎embed/‎ · ‎shorts/‎ · ‎live/‎ · ‎v/‎.
 */
export function youtubeVideoId(src: string): string | null {
  let url: URL;
  try {
    url = new URL(src.trim());
  } catch {
    return null;
  }
  const host = url.hostname;
  if (SHORT_HOST.test(host)) {
    const id = url.pathname.split('/').filter(Boolean)[0] ?? '';
    return VIDEO_ID.test(id) ? id : null;
  }
  if (!YOUTUBE_HOST.test(host)) return null;

  const v = url.searchParams.get('v');
  if (v !== null && VIDEO_ID.test(v)) return v;

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length >= 2 && ['embed', 'shorts', 'live', 'v'].includes(parts[0]!.toLowerCase())) {
    const id = parts[1]!;
    return VIDEO_ID.test(id) ? id : null;
  }
  return null;
}

/**
 * כתובת ההטמעה המתאימה, או null אם אין זה קישור יוטיוב מזוהה.
 *
 * נשמרים זמן התחלה (‎t‎/‎start‎) ורשימת השמעה (‎list‎), כי שניהם נפוצים בקישורים
 * שמדביקים מהדפדפן ושניהם עובדים ב-embed.
 */
export function youtubeEmbedUrl(src: string): string | null {
  const id = youtubeVideoId(src);
  if (id === null) return null;

  let url: URL | null = null;
  try {
    url = new URL(src.trim());
  } catch {
    /* כבר ידוע שהמזהה תקין — ממשיכים בלי פרמטרים */
  }
  const params = new URLSearchParams();
  const start = youtubeStartSeconds(
    url?.searchParams.get('start') ?? url?.searchParams.get('t') ?? null,
  );
  if (start !== null) params.set('start', String(start));
  const list = url?.searchParams.get('list');
  if (list !== null && list !== undefined && list !== '') params.set('list', list);

  const query = params.toString();
  return `https://www.youtube.com/embed/${id}${query === '' ? '' : `?${query}`}`;
}

/**
 * פרמטרי הנגן שהמנוע מטמיע: ניגון אוטומטי בלבד, בלי שום פקד ובלי כתוביות.
 *
 * ‎cc_load_policy=0‎ מבקש מיוטיוב לא להציג כתוביות, אבל יוטיוב מכבד אותו רק
 * כשאין לצופה העדפה אחרת: מחשב שהחשבון שלו ביוטיוב (או הדפדפן) מוגדר "תמיד
 * להציג כתוביות", או סרטון שבעל הערוץ הגדיר לו כתוביות כברירת מחדל, יציג
 * אותן בכל זאת. לכן הוא רק השכבה הראשונה, וראו YOUTUBE_CAPTIONS_OFF_COMMANDS.
 * ‎controls=0‎ ו-‎disablekb=1‎ מסירים גם את כפתור ה-CC ואת המקש C.
 */
export const YOUTUBE_PLAYER_PARAMS = [
  'enablejsapi=1',
  'autoplay=1',
  'controls=0',
  'disablekb=1',
  'fs=0',
  'modestbranding=1',
  'iv_load_policy=3',
  'cc_load_policy=0',
  'rel=0',
  'playsinline=1',
] as const;

/** כתובת ה-iframe המלאה של הנגן. */
export function youtubePlayerUrl(src: string, opts: { muted?: boolean } = {}): string {
  // קישור שלא זוהה נשאר כמו שהוא (עם אותם פרמטרים), כמו קודם: הנגן כבר יודע
  // לומר שהוא לא עונה (ALIVE_TIMEOUT_MS).
  const embed = youtubeEmbedUrl(src) ?? src;
  const params = [...YOUTUBE_PLAYER_PARAMS, ...(opts.muted === true ? ['mute=1'] : [])].join('&');
  return `${embed}${embed.includes('?') ? '&' : '?'}${params}`;
}

/**
 * פקודות שמכבות כתוביות בנגן שכבר רץ (דרך ה-postMessage של ‎enablejsapi=1‎,
 * אותו ערוץ של ‎pauseVideo‎). פורקים את מודול הכתוביות (‎captions‎, ובנגנים
 * ישנים ‎cc‎) ומאפסים את הרצועה הנבחרת. יוטיוב טוען את המודול מחדש כשהסרטון
 * מתחיל לנגן, כשעוברים לסרטון הבא ברשימת השמעה ולפעמים אחרי טעינה מחדש, ולכן
 * הן נשלחות שוב בכל אחד מהאירועים האלה (ראו shouldResendCaptionsOff).
 *
 * ‎unloadModule‎ ו-‎setOption('captions', …)‎ אינם חלק מהתיעוד הרשמי של יוטיוב:
 * הם עובדים היום, ופקודה שהנגן לא מכיר פשוט נבלעת בלי נזק.
 */
export const YOUTUBE_CAPTIONS_OFF_COMMANDS: readonly { func: string; args: unknown[] }[] = [
  { func: 'unloadModule', args: ['captions'] },
  { func: 'unloadModule', args: ['cc'] },
  { func: 'setOption', args: ['captions', 'track', {}] },
];

/**
 * האם הודעה מהנגן היא רגע שבו כדאי לכבות שוב את הכתוביות: הנגן מוכן, מצב
 * הנגינה השתנה (מתנגן, נטען, סרטון חדש מוכן), או שמודול נטען (‎apiInfoDelivery‎
 * בערוץ ה-postMessage, ‎onApiChange‎ ב-IFrame API: כך יוטיוב מודיע שמודול
 * הכתוביות עלה; נצפה בהרצה מול יוטיוב, עם ‎"namespaces":["captions"]‎). ‎infoDelivery‎ נשלחת כמה פעמים בשנייה
 * עם הזמן הנוכחי, ולכן היא נחשבת רק כשהיא נושאת מצב נגינה של התחלה.
 */
export function shouldResendCaptionsOff(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as { event?: unknown; info?: unknown };
  switch (msg.event) {
    case 'onReady':
    case 'initialDelivery':
    case 'onApiChange':
    case 'apiInfoDelivery':
      return true;
    case 'onStateChange':
      return msg.info === 1 || msg.info === 3 || msg.info === 5 || msg.info === -1;
    case 'infoDelivery': {
      const info = msg.info as { playerState?: unknown; videoData?: unknown } | null | undefined;
      if (info === null || typeof info !== 'object') return false;
      return info.playerState === 1 || info.playerState === 3 || info.videoData !== undefined;
    }
    default:
      return false;
  }
}
