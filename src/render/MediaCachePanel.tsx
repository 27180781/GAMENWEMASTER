/**
 * פאנל "מדיה לא-מקוונת" בהגדרות המתקדמות — חיווי כמה מדיה נשמרה במטמון המתמשך
 * (Service Worker) במחשב הזה, וכפתור ניקוי (פתח מילוט אם רוצים לרענן/לפנות מקום).
 * מוצג רק כשיש תמיכה ב-Service Worker + Cache Storage; אחרת לא מרונדר כלום.
 */

import { useEffect, useState } from 'react';
import { clearMediaCache } from '../app/mediaSW.ts';

async function countCachedMedia(): Promise<number> {
  if (typeof caches === 'undefined') return 0;
  let total = 0;
  for (const name of await caches.keys()) {
    if (!name.startsWith('media-cache-')) continue;
    const cache = await caches.open(name);
    total += (await cache.keys()).length;
  }
  return total;
}

export function MediaCachePanel() {
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => void countCachedMedia().then(setCount);
  useEffect(() => {
    refresh();
  }, []);

  const supported =
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof caches !== 'undefined';
  if (!supported) return null;

  return (
    <div className="media-cache-panel">
      <h3 className="media-cache-title">מדיה לא-מקוונת</h3>
      <p className="media-cache-status">
        {count === null
          ? 'בודק…'
          : count > 0
            ? `נשמרו ${count.toLocaleString()} קבצי מדיה במחשב זה — המשחק יטען אותם מהמטמון, בלי תלות ברשת.`
            : 'עדיין לא נשמרה מדיה. המדיה נשמרת אוטומטית ברקע כשפותחים משחק.'}
      </p>
      <button
        className="picker-button media-cache-clear"
        disabled={busy || !count}
        onClick={async () => {
          setBusy(true);
          await clearMediaCache();
          refresh();
          setBusy(false);
        }}
      >
        🗑 נקה מדיה שמורה
      </button>
    </div>
  );
}
