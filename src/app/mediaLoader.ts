/**
 * טעינה מוקדמת של *כל* מדיית המשחק — כדי שבמהלך המשחק לא תהיה שום המתנה
 * לרשת. הטעינה מתחילה כבר במסך ההגדרות/לובי (זמן שממילא מחכים בו), לפי סדר
 * השקופיות, כך שהטוען תמיד "מקדים את הראש" של המנחה. מבוסס אלמנטים
 * (Image/video/audio) — מחמם את אותו cache שהמשחק יקרא ממנו, בלי בעיות CORS.
 *
 * orderedMediaUrls טהורה (ניתנת לבדיקה); הטעינה בפועל דורשת DOM ומוגנת.
 */

import { classifyMediaUrl, type GameFile, type Slide } from '../engine/index.ts';

/** כל כתובות המדיה החזותית של שקופית, בסדר קבוע. */
function slideMediaUrls(slide: Slide): string[] {
  const urls = [
    slide.openMedia.src,
    slide.question.src,
    slide.backgroundMedia.src,
    slide.setting.slidBackgroundMedia.src,
    slide.endMedia.src,
  ];
  if (slide.type === 'ans_images') {
    for (const answer of slide.question.answers) urls.push(answer.ans);
  }
  return urls;
}

/**
 * כל כתובות המדיה של המשחק בסדר עדיפות: מדיית לובי (פתיחה/לוגו/רקע שאלות) →
 * שקופיות לפי הסדר → מסכי הזוכים → סאונדים. בלי כפילויות, ובלי YouTube/blob/
 * data (לא ניתנים לטעינה מראש / כבר בזיכרון).
 */
export function orderedMediaUrls(game: GameFile): string[] {
  const s = game.setting;
  const raw: string[] = [s.gameMedia.src, s.logo.src, s.triviaMedia.src];
  for (const slide of game.questions) raw.push(...slideMediaUrls(slide));
  raw.push(s.winnersMedia.src, s.winnersListMedia.src);
  for (const channel of Object.values(s.sound)) {
    if (channel.src) raw.push(channel.src);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawUrl of raw) {
    const url = rawUrl.trim();
    if (url === '' || seen.has(url)) continue;
    if (url.startsWith('blob:') || url.startsWith('data:')) continue;
    if (classifyMediaUrl(url) === 'youtube') continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/**
 * טעינה מוקדמת של נכס בודד — מחמם את ה-cache. תמיד נפתר ('loaded'/'failed'),
 * גם ב-timeout (נכס איטי מדי לא חוסם את השאר; ייטען כשיגיעו אליו).
 */
function preloadOne(url: string, timeoutMs: number): Promise<'loaded' | 'failed'> {
  if (typeof document === 'undefined') return Promise.resolve('loaded');
  const kind = classifyMediaUrl(url);
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

    if (kind === 'video' || kind === 'audio') {
      const el = document.createElement(kind);
      el.preload = 'auto';
      el.oncanplaythrough = () => finish('loaded');
      el.onloadeddata = () => finish('loaded'); // גיבוי אם canplaythrough לא נורה
      el.onerror = () => finish('failed');
      el.src = url;
      try {
        el.load();
      } catch {
        /* חלק מהסביבות לא תומכות ב-load() ידני — מתעלמים */
      }
    } else {
      // image / unknown — Image נטען בלי CORS ומחמם את המטמון ל-<img>
      const img = new Image();
      img.onload = () => finish('loaded');
      img.onerror = () => finish('failed');
      img.src = url;
    }
  });
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
      const result = await preloadOne(url, timeoutMs);
      if (result === 'loaded') loaded += 1;
      else failed += 1;
      if (!signal?.aborted) onProgress?.({ total, loaded, failed });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));
  return { total, loaded, failed };
}
