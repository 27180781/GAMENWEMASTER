/**
 * טעינה מוקדמת של מדיה (preload) — מקדים ומביא לזיכרון המטמון את המדיה של
 * השקופיות הקרובות, כדי שהמעבר אליהן יהיה מיידי בלי מסך שחור/השהיה.
 *
 * משתמש ב-`<link rel="prefetch">` (עדיפות נמוכה, בלי לחסום כלום); כשהאלמנט
 * האמיתי (img/video/audio) יבקש את אותו URL הוא יוגש מהמטמון. מדלגים על
 * YouTube (לא ניתן ל-prefetch פשוט) ועל blob:/data: (אופליין — כבר בזיכרון).
 */

import { classifyMediaUrl, type Slide } from '../engine/index.ts';

/** כל כתובות המדיה של שקופית שכדאי לטעון מראש (בלי כפילויות). */
export function slidePreloadUrls(slide: Slide, triviaMediaSrc = ''): string[] {
  const candidates = [
    slide.openMedia.src,
    slide.endMedia.src,
    slide.question.src,
    slide.backgroundMedia.src,
    slide.setting.slidBackgroundMedia.src,
    triviaMediaSrc,
  ];
  if (slide.type === 'ans_images') {
    for (const answer of slide.question.answers) candidates.push(answer.ans);
  }

  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of candidates) {
    const src = raw.trim();
    if (src === '' || seen.has(src)) continue;
    if (src.startsWith('blob:') || src.startsWith('data:')) continue; // אופליין/מוטמע
    if (classifyMediaUrl(src) === 'youtube') continue; // לא ניתן ל-prefetch
    seen.add(src);
    urls.push(src);
  }
  return urls;
}

// dedup מודול-לבל — כך שקריאה כבר במסך ההגדרות (head start למדיית הלובי
// והשקופית הראשונה) לא תיצור כפילויות מול ה-prefetch שבתוך המשחק.
const prefetchedMedia = new Set<string>();

/** האם כדאי ל-prefetch את הכתובת (לא ריק/‏blob/‏data, ולא YouTube). */
function isPrefetchable(src: string): boolean {
  if (src === '' || src.startsWith('blob:') || src.startsWith('data:')) return false;
  return classifyMediaUrl(src) !== 'youtube';
}

/**
 * prefetch עצמאי (בלי מופע MediaPreloader) — נועד לרוץ כבר במסך ההגדרות כדי
 * לחמם את מדיית הלובי (רקע פתיחה + לוגו) ואת השקופית הראשונה, כך שהמסך הראשון
 * מופיע מיד עם הכניסה למשחק. סלחני לכתובות ריקות/כפולות/לא-ניתנות-ל-prefetch.
 */
export function prefetchMedia(urls: ReadonlyArray<string>): void {
  if (typeof document === 'undefined') return;
  for (const raw of urls) {
    const src = raw.trim();
    if (!isPrefetchable(src) || prefetchedMedia.has(src)) continue;
    prefetchedMedia.add(src);
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = src;
    document.head.appendChild(link);
  }
}

export class MediaPreloader {
  private readonly prefetched = new Set<string>();
  private readonly links = new Map<string, HTMLLinkElement>();

  /** מוסיף רמזי prefetch לכתובות שעוד לא נטענו מראש. */
  prefetch(urls: string[]): void {
    if (typeof document === 'undefined') return;
    for (const url of urls) {
      if (this.prefetched.has(url)) continue;
      this.prefetched.add(url);
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = url;
      document.head.appendChild(link);
      this.links.set(url, link);
    }
  }

  /** מספר הכתובות שכבר נטענו מראש (לבדיקות/דיבאג). */
  get count(): number {
    return this.prefetched.size;
  }

  dispose(): void {
    for (const link of this.links.values()) link.remove();
    this.links.clear();
    this.prefetched.clear();
  }
}
