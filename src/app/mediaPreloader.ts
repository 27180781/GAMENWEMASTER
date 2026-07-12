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
