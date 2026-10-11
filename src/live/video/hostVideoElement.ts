/**
 * רכיב ה-<video> של וידאו המנחה אצל הצופה — אחד לכל הדף, שעובר בין מקומות.
 *
 * דפדפנים (במיוחד באייפון) מתירים קול רק לרכיב שהופעל בנגיעה של המשתמש,
 * וזוכרים את ההיתר לאותו רכיב. רכיב חדש בכל פעם שחלון הווידאו מוצג מחדש
 * (טלפון שהסתובב, שלט שנפתח) היה חוזר להיות מושתק. לכן הרכיב נוצר פעם אחת,
 * ו«הפעלת צליל» של הצופה (ViewerChrome) מדליקה בו את הקול בתוך הלחיצה עצמה.
 */

/** ok — מתנגן כמו שביקשו; muted — מתנגן, אבל הדפדפן סירב לקול; blocked — לא מתנגן. */
export type Playback = 'ok' | 'muted' | 'blocked';

let element: HTMLVideoElement | null = null;
let soundOn = false;

export function hostVideoElement(): HTMLVideoElement {
  if (element === null) {
    const el = document.createElement('video');
    el.className = 'live-video-el';
    el.autoplay = true;
    el.playsInline = true;
    el.muted = true;
    el.setAttribute('playsinline', '');
    el.disablePictureInPicture = true;
    element = el;
  }
  return element;
}

/**
 * הקול של המנחה דולק / כבוי, יחד עם שאר הצליל של מסך הצפייה. **חייב להיקרא
 * בתוך הלחיצה של הצופה** — רק אז הדפדפן מתיר לנגן עם קול.
 */
export function setHostVideoSound(on: boolean): void {
  soundOn = on;
  const el = on ? hostVideoElement() : element;
  if (el === null) return;
  el.muted = !on;
  // גם בלי וידאו עדיין: ההפעלה בתוך הלחיצה היא מה שפותח את הקול לרכיב.
  if (on) void el.play().catch(() => {});
}

/** מציג את `stream` ומנגן — עם קול רק אם הצופה הפעיל צליל. */
export async function showHostStream(stream: MediaStream | null): Promise<Playback> {
  const el = hostVideoElement();
  if (el.srcObject !== stream) el.srcObject = stream;
  if (stream === null) return 'ok';
  el.muted = !soundOn;
  try {
    await el.play();
    return 'ok';
  } catch {
    if (el.muted) return 'blocked';
  }
  // הדפדפן סירב לקול (בלי נגיעה) — עדיף תמונה בלי קול מאשר כלום.
  el.muted = true;
  try {
    await el.play();
    return 'muted';
  } catch {
    return 'blocked';
  }
}

/** נגיעה של הצופה בחלון: עוד ניסיון, הפעם בתוך הלחיצה. */
export function retryHostPlayback(): Promise<Playback> {
  setHostVideoSound(soundOn);
  return showHostStream(element?.srcObject instanceof MediaStream ? element.srcObject : null);
}
