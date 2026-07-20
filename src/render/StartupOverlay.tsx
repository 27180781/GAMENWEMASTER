/**
 * מסך "פתיחת המשחק" — מוצג אחרי לחיצה על "התחל" כשחסימת-הטעינה פעילה (ברירת
 * מחדל). שני שלבים:
 *   1. טעינה: פס התקדמות של הורדת כל המדיה, עם חיווי "מנסה שוב" כשמשהו נכשל.
 *   2. ספירה-לאחור: אחרי שהכול ירד, ספירה קצרה (בזמן שהדפדפן מפענח/מצייר) ואז
 *      מעבר למסך ההתחברות.
 * כשההגדרה "אפשר להתחיל מיד" מסומנת — המסך הזה לא מוצג כלל (מעבר ישיר למשחק).
 */

import type { MediaPreloadState } from '../app/useMediaPreload.ts';

interface StartupOverlayProps {
  logo: string;
  preload: MediaPreloadState;
  /** true כשמנסים שוב לטעון נכסים שנכשלו (כשל זמני של פרוקסי/Worker). */
  retrying: boolean;
  /** ספירה-לאחור בשניות עד פתיחת המשחק; null = עדיין בשלב הטעינה. */
  countdown: number | null;
}

export function StartupOverlay({ logo, preload, retrying, countdown }: StartupOverlayProps) {
  const { total, loaded, failed } = preload;
  const done = loaded + failed;
  const pct = total > 0 ? Math.round((done / total) * 100) : 100;
  const counting = countdown !== null;

  return (
    <div className="screen startup-screen">
      <div className="screen-content startup-content">
        {logo !== '' && <img className="startup-logo" src={logo} alt="" />}

        {counting ? (
          <div className="startup-count-wrap">
            <p className="startup-text">המשחק נפתח בעוד</p>
            <div className="startup-countdown" aria-live="polite">
              {countdown}
            </div>
          </div>
        ) : (
          <div className="startup-load-wrap">
            <div className="startup-bar-track">
              <div className="startup-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <p className="startup-text">
              {retrying ? 'מנסה שוב לטעון מדיה שנכשלה…' : 'טוען את המדיה של המשחק…'}
            </p>
            <p className="startup-sub">
              {done}/{total} ({pct}%)
              {failed > 0 && <span className="startup-failed"> · {failed} נכשלו</span>}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
