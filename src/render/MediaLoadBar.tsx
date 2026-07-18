/**
 * חיווי טעינת המדיה בשתי צורות:
 *   • MediaLoadBar — פיל מלא בתחתית מסך ההגדרות (X/N + אחוז + רמז).
 *   • MediaLoadDot — עיגול זעיר בפינה השמאלית-תחתונה, לשימוש בזמן המשחק (לא
 *     חוסם/מכער את המסך) עם טבעת התקדמות ואחוז קטן במרכז.
 * שניהם מוצגים רק כל עוד יש מה לטעון; נעלמים כשהכול מוכן.
 */

import type { CSSProperties } from 'react';
import type { MediaPreloadState } from '../app/useMediaPreload.ts';

function percent({ total, loaded, failed }: MediaPreloadState): number {
  const done = loaded + failed;
  return total > 0 ? Math.round((done / total) * 100) : 100;
}

export function MediaLoadBar(state: MediaPreloadState) {
  const { total, loaded, failed } = state;
  const done = loaded + failed;
  return (
    <div className="media-load-bar" role="status" aria-live="polite">
      <div className="media-load-track">
        <div className="media-load-fill" style={{ width: `${percent(state)}%` }} />
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

/** עיגול זעיר בפינה השמאלית-תחתונה — חיווי טעינה לא-מפריע בזמן המשחק. */
export function MediaLoadDot(state: MediaPreloadState) {
  const pct = percent(state);
  return (
    <div
      className="media-load-dot"
      role="status"
      aria-label={`טוען מדיה ${pct}%`}
      title={`טוען מדיה… ${state.loaded + state.failed}/${state.total}`}
    >
      <div className="media-load-dot-ring" style={{ '--pct': pct } as CSSProperties}>
        <span className="media-load-dot-pct">{pct}</span>
      </div>
    </div>
  );
}
