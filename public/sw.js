/*
 * Service Worker — מטמון מדיה בלבד.
 *
 * מטרה: במחשב אירועים קבוע, המדיה הכבדה (תמונות/וידאו/סאונד) תישמר במטמון
 * מתמשך אחרי הורדה אחת, כך שהמשחק ירוץ אונליין (הצבעות דרך הסוקט) אך כמעט
 * לא יזדקק לרשת עבור המדיה — גם אחרי רענון, גם יום אחרי, גם אם ה-CDN איטי/נפל.
 *
 * עיקרון בטיחות מרכזי: **לא שומרים את קבצי האפליקציה** (HTML/JS/CSS). רק מדיה.
 * כך עדכוני גרסה תמיד נטענים מהרשת ולעולם לא נתקעים על גרסה ישנה. כל בקשה שאינה
 * מדיה עוברת ישירות לרשת בלי שה-SW נוגע בה (כולל ניווט, סקריפטים, סוקט ו-API).
 * במקרה של כשל/היעדר מטמון — נפילה חיננית לרשת, כלומר לכל היותר התנהגות כמו היום.
 */

const CACHE = 'media-cache-v1';

// סיומות מדיה שנשמרות. שאר הבקשות אינן מיורטות כלל.
const MEDIA_EXT =
  /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg|mp3|wav|ogg|oga|m4a|aac|flac|opus|mp4|m4v|webm|mov|ogv)(\?.*)?$/i;

function isMediaRequest(request) {
  if (request.method !== 'GET') return false;
  const dest = request.destination;
  if (dest === 'image' || dest === 'audio' || dest === 'video') return true;
  try {
    return MEDIA_EXT.test(new URL(request.url).pathname);
  } catch {
    return false;
  }
}

self.addEventListener('install', () => {
  // מפעילים מיד — אין מה לחכות (לא שומרים אפליקציה, רק מדיה לפי דרישה)
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // ניקוי גרסאות מטמון מדיה ישנות
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith('media-cache-') && n !== CACHE).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // רק מדיה. כל השאר (אפליקציה/סוקט/API/YouTube/ניווט) — לא נוגעים, עובר לרשת.
  if (!isMediaRequest(req)) return;
  event.respondWith(cacheFirstMedia(req));
});

/** cache-first: מגישים מהמטמון אם קיים; אחרת מהרשת ושומרים. */
async function cacheFirstMedia(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req, { ignoreVary: true });
  if (cached) return withRange(req, cached);
  try {
    const res = await fetch(req);
    // שומרים רק תשובה שלמה (200) או opaque (מדיה cross-origin מ-no-cors) —
    // לא 206 חלקי ולא שגיאות. clone לפני שמחזירים כי אפשר לצרוך גוף פעם אחת.
    if (res && (res.status === 200 || res.type === 'opaque')) {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    const fallback = await cache.match(req, { ignoreVary: true });
    if (fallback) return withRange(req, fallback);
    throw err;
  }
}

/**
 * נגני וידאו/אודיו מבקשים טווחי בייטים (Range). התשובה שבמטמון היא 200 מלאה —
 * כשמתבקש טווח, חותכים ממנה 206 תקני כדי ש-seek יעבוד חלק. תשובת opaque
 * (cross-origin ללא CORS) אינה קריאה — מוחזרת כמות שהיא (הדפדפן מתמודד עם
 * 200 מלא כמו מול שרת בלי תמיכת Range).
 */
async function withRange(req, cached) {
  const rangeHeader = req.headers.get('range');
  if (!rangeHeader || cached.type === 'opaque' || cached.status !== 200) return cached;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || (match[1] === '' && match[2] === '')) return cached;
  try {
    const buf = await cached.clone().arrayBuffer();
    const size = buf.byteLength;
    let start;
    let end;
    if (match[1] === '') {
      // צורת suffix: bytes=-N (N הבייטים האחרונים)
      const n = Number(match[2]);
      start = Math.max(0, size - n);
      end = size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
    }
    if (start >= size || start > end) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` },
      });
    }
    const headers = new Headers(cached.headers);
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    headers.set('Content-Length', String(end - start + 1));
    headers.set('Accept-Ranges', 'bytes');
    return new Response(buf.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers });
  } catch {
    return cached; // גוף לא קריא — נופלים לתשובה המלאה כמו קודם
  }
}

// הודעות מהאפליקציה — פתח מילוט לניקוי המטמון.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (data && data.type === 'clear-media-cache') {
    event.waitUntil(caches.delete(CACHE));
  }
});
