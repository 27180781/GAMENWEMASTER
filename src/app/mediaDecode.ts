/**
 * פענוח-מקדים (warm decode) של מדיה — כדי שההצגה הראשונה תהיה מיידית ולא
 * "נטענת קצת-קצת". הורדה למטמון (mediaLoader) מביאה את הבייטים; כאן מפענחים
 * אותם מראש (תמונה: `img.decode()`; וידאו: פריים ראשון דרך אלמנט מוסתר), כך
 * שכשהמרכיב האמיתי מוצג הדפדפן כבר מוכן לצייר.
 *
 * דדופ לפי כתובת: אותו סרטון-רקע (triviaMedia) שחוזר בכל השקופיות מפוענח **פעם
 * אחת בלבד** — לא 300 פעם. ההפעלה מתחילה כבר במסך ההגדרות (decodeInitialMedia)
 * וממשיכה לשקופית הבאה תוך כדי משחק (decodeSlideMedia).
 */

import { classifyMediaUrl, type GameFile, type Slide } from '../engine/index.ts';
import { slideBackgroundSrc } from '../render/SlideView.tsx';

/** כתובות שכבר פוענחו (או בתהליך) — למניעת פענוח כפול באותו סשן. */
const warmed = new Set<string>();

function isRemote(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

/** מפענח תמונה בודדת — מחמם את מטמון הפענוח של הדפדפן (לא דורש DOM). */
function decodeImage(url: string): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    // decode() נדחה אם הטעינה נכשלה — לא נורא, פשוט מדלגים (ההורדה כבר טופלה במטמון).
    img.decode().then(
      () => resolve(),
      () => resolve(),
    );
  });
}

/** מחמם פריים ראשון של וידאו דרך אלמנט מוסתר (loadeddata), פעם אחת. */
function warmVideo(url: string, timeoutMs: number): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      video.onloadeddata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.remove();
      resolve();
    };
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    // מחוץ למסך, זעיר ובלתי-נגיש — רק כדי לפענח פריים, לא להצגה.
    video.style.cssText =
      'position:absolute;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    video.onloadeddata = finish;
    video.onerror = finish;
    const timer = window.setTimeout(finish, timeoutMs);
    video.src = url;
    document.body.appendChild(video);
    video.load();
  });
}

/** מפענח מראש כתובת בודדת לפי סוגה (דדופ). לא חוסם — נכשל בשקט. */
export function warmDecode(url: string, opts: { videoTimeoutMs?: number } = {}): void {
  const src = url.trim();
  if (src === '' || !isRemote(src) || warmed.has(src)) return;
  warmed.add(src); // מסמנים מראש כדי שקריאות מקבילות לא יכפילו
  const kind = classifyMediaUrl(src);
  if (kind === 'image') void decodeImage(src);
  else if (kind === 'video') void warmVideo(src, opts.videoTimeoutMs ?? 15000);
  // audio / youtube — אין "פענוח" חזותי להקדים
}

/** הכתובות שיוצגו בשקופית נתונה: תמונת שאלה, תמונות תשובה (ans_images), והרקע. */
export function slideDecodeUrls(slide: Slide, triviaMedia: string): string[] {
  const urls: string[] = [];
  const questionImage = slide.question.src.trim();
  if (questionImage !== '' && classifyMediaUrl(questionImage) === 'image') urls.push(questionImage);
  if (slide.type === 'ans_images') {
    for (const answer of slide.question.answers) {
      const src = answer.ans.trim();
      if (src !== '' && classifyMediaUrl(src) === 'image') urls.push(src);
    }
  }
  const background = slideBackgroundSrc(slide, triviaMedia);
  if (background !== '') urls.push(background);
  return urls;
}

/** מפענח מראש את כל המדיה של שקופית (כולל הרקע). דדופ אוטומטי לפי כתובת. */
export function decodeSlideMedia(slide: Slide, triviaMedia: string): void {
  for (const url of slideDecodeUrls(slide, triviaMedia)) warmDecode(url);
}

/**
 * פענוח-מקדים ראשוני מהמסך הראשון (הגדרות/לובי): רקע הלובי/פתיחה (gameMedia)
 * והשקופית הראשונה — כדי שהדבר הראשון שיוצג יופיע מיד. הסרטון המשותף מתחמם כאן
 * פעם אחת ומדולג בהמשך.
 */
export function decodeInitialMedia(game: GameFile): void {
  warmDecode(game.setting.gameMedia.src);
  const first = game.questions[0];
  if (first) decodeSlideMedia(first, game.setting.triviaMedia.src);
}
