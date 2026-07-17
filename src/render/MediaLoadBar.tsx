/**
 * פס חיווי לטעינת המדיה — פיל צף בתחתית המסך שמראה כמה מהמדיה כבר נטענה
 * (X/N + אחוז), עם רמז שאפשר להתחיל כבר עכשיו והטעינה תמשיך ברקע. מוצג רק
 * כל עוד יש מה לטעון; נעלם כשהכול מוכן.
 */

import type { MediaPreloadState } from '../app/useMediaPreload.ts';

export function MediaLoadBar({ total, loaded, failed }: MediaPreloadState) {
  const done = loaded + failed;
  const pct = total > 0 ? Math.round((done / total) * 100) : 100;
  return (
    <div className="media-load-bar" role="status" aria-live="polite">
      <div className="media-load-track">
        <div className="media-load-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="media-load-text">
        <span className="media-load-icon">⏬</span>
        טוען מדיה… {done}/{total}
        {failed > 0 && <span className="media-load-failed"> · {failed} נכשלו</span>}
        <span className="media-load-hint"> · אפשר כבר להתחיל</span>
      </div>
    </div>
  );
}
