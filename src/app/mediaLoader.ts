/**
 * טעינה מוקדמת של *כל* מדיית המשחק — כדי שבמהלך המשחק לא תהיה שום המתנה
 * לרשת. הטעינה מתחילה כבר במסך ההגדרות/לובי (זמן שממילא מחכים בו), לפי סדר
 * השקופיות, כך שהטוען תמיד "מקדים את הראש" של המנחה. מבוסס אלמנטים
 * (Image/video/audio) — מחמם את אותו cache שהמשחק יקרא ממנו, בלי בעיות CORS.
 *
 * orderedMediaUrls טהורה (ניתנת לבדיקה); הטעינה בפועל דורשת DOM ומוגנת.
 */

import { classifyMediaUrl, type GameFile } from '../engine/index.ts';
import { mediaFields } from './mediaFields.ts';

/**
 * כל כתובות המדיה של המשחק בסדר עדיפות (הסדר של mediaFields): מדיית לובי →
 * שקופיות לפי הסדר → מסכי הזוכים → סאונדים. בלי כפילויות, ובלי YouTube/blob/
 * data (לא ניתנים לטעינה מראש / כבר בזיכרון).
 */
export function orderedMediaUrls(game: GameFile): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const field of mediaFields(game)) {
    const url = field.get().trim();
    if (url === '' || seen.has(url)) continue;
    if (url.startsWith('blob:') || url.startsWith('data:')) continue;
    if (classifyMediaUrl(url) === 'youtube') continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/**
 * וידאו/סאונד — מורידים את *כל* הקובץ (fetch + ריקון הגוף) כדי שיהיה במלואו
 * במטמון, ולא רק "מספיק כדי להתחיל". כך הנגן בפועל מנגן מיד במקום להציג פריים
 * סטטי ולחכות ל-buffering. timeout רך: אחרי הזמן מדווחים 'loaded' אבל ההורדה
 * ממשיכה ברקע (וידאו גדול על רשת איטית לא חוסם את השאר).
 */
async function preloadHeavy(url: string, timeoutMs: number, signal?: AbortSignal): Promise<'loaded' | 'failed'> {
  if (typeof fetch === 'undefined') return 'loaded';
  try {
    const res = await fetch(url, signal ? { signal } : {});
    if (!res.ok || !res.body) return 'failed';
    const reader = res.body.getReader();
    const drain = (async () => {
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    })();
    let softTimer = 0;
    const soft = new Promise<void>((r) => {
      softTimer = setTimeout(r, timeoutMs) as unknown as number;
    });
    await Promise.race([drain, soft]);
    if (softTimer) clearTimeout(softTimer);
    return 'loaded';
  } catch {
    return 'failed';
  }
}

/** תמונה — Image.onload = הורדה מלאה (מחמם את המטמון ל-<img>, בלי CORS). */
function preloadImage(url: string, timeoutMs: number): Promise<'loaded' | 'failed'> {
  if (typeof document === 'undefined') return Promise.resolve('loaded');
  return new Promise((resolve) => {
    let settled = false;
    let timer = 0;
    const finish = (result: 'loaded' | 'failed') => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    timer = setTimeout(() => finish('loaded'), timeoutMs) as unknown as number;
    const img = new Image();
    img.onload = () => finish('loaded');
    img.onerror = () => finish('failed');
    img.src = url;
  });
}

/** טעינה מוקדמת של נכס בודד (ניסיון יחיד). */
function preloadOnce(url: string, timeoutMs: number, signal?: AbortSignal): Promise<'loaded' | 'failed'> {
  const kind = classifyMediaUrl(url);
  if (kind === 'video' || kind === 'audio') return preloadHeavy(url, timeoutMs, signal);
  return preloadImage(url, timeoutMs);
}

const preloadDelay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * טעינה מוקדמת של נכס בודד עם ניסיונות חוזרים — מחמם את ה-cache כדי שהנגינה
 * בפועל תהיה מהמטמון ולא תלויה בהזרמה חיה. כשל זמני של פרוקסי/Worker (Cloudflare)
 * מקבל רענון נוסף במקום להישאר לא-שמור (מה שגרם, למשל, לסאונד שנתקע אחרי כמה
 * שניות כשההזרמה החיה נכשלה). לא מנסים שוב אם בוטל (signal).
 */
async function preloadOne(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
  retries = 2,
): Promise<'loaded' | 'failed'> {
  let result = await preloadOnce(url, timeoutMs, signal);
  for (let attempt = 1; attempt <= retries && result === 'failed'; attempt++) {
    if (signal?.aborted) return 'failed';
    await preloadDelay(400 * attempt);
    if (signal?.aborted) return 'failed';
    result = await preloadOnce(url, timeoutMs, signal);
  }
  return result;
}

export interface PreloadProgress {
  total: number;
  loaded: number;
  failed: number;
}

/**
 * טוען את רשימת הכתובות עם מקביליות מוגבלת, ומדווח התקדמות אחרי כל נכס.
 * ניתן לביטול דרך signal (מנקה כשעוזבים את המשחק).
 */
export async function preloadMediaList(
  urls: string[],
  opts: {
    concurrency?: number;
    timeoutMs?: number;
    onProgress?: (progress: PreloadProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<PreloadProgress> {
  const { concurrency = 5, timeoutMs = 20000, onProgress, signal } = opts;
  const total = urls.length;
  let loaded = 0;
  let failed = 0;
  let index = 0;
  const worker = async () => {
    while (index < urls.length) {
      if (signal?.aborted) return;
      const url = urls[index++]!;
      const result = await preloadOne(url, timeoutMs, signal);
      if (result === 'loaded') loaded += 1;
      else failed += 1;
      if (!signal?.aborted) onProgress?.({ total, loaded, failed });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));
  return { total, loaded, failed };
}
