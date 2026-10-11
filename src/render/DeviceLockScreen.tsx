/**
 * «השבתת התוכנה»: המנהל השבית את התוכנה במחשב הזה במערכת יצירת המשחקים,
 * והמסך הזה מוצג במקום מסך הפתיחה. מספר המחשב הוא מה שמוסרים לחוויה בקליק,
 * ו"בדיקה חוזרת" קיימת כי ביטול ההשבתה מגיע רק בבדיקה מוצלחת מול המערכת
 * (התוכנה בודקת גם לבד, כל דקה כשיש רשת). מתי הוא מוצג — deviceLockShown
 * ב-src/app/devicePlan.ts.
 */

import { useEffect, useState, type ReactNode } from 'react';
import type { DeviceState } from '../app/clickerBridge.ts';
import { formatDeviceId, lockStatusText } from '../app/devicePlan.ts';

interface DeviceLockScreenProps {
  state: DeviceState;
  onRetry: () => void;
  /** סגירת התוכנה; null כשאין איך (לא EXE). */
  onQuit: (() => void) | null;
  /** שורת הגרסה וחיווי העדכון, כמו במסך הפתיחה. */
  children?: ReactNode;
}

export function DeviceLockScreen({ state, onRetry, onQuit, children }: DeviceLockScreenProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const id = state.device?.id ?? null;
  const status = lockStatusText(state, now);
  return (
    <div className="screen settings-screen offline-open-screen">
      <div className="screen-content offline-open">
        <div className="offline-open-card device-lock" role="alert">
          <div className="offline-open-icon" aria-hidden="true">
            🔒
          </div>
          <h1 className="offline-open-title">לא ניתן להפעיל את התוכנה</h1>
          <p className="offline-open-lead">יש לפנות לחוויה בקליק</p>
          {id !== null && (
            <p className="device-lock-id">
              מספר המחשב: <bdi dir="ltr">{formatDeviceId(id)}</bdi>
            </p>
          )}
          <button type="button" className="device-lock-retry" onClick={onRetry} disabled={state.syncing}>
            {state.syncing ? 'בודק…' : '⟳ בדיקה חוזרת'}
          </button>
          {status !== '' && <p className="device-lock-status">{status}</p>}
          {onQuit !== null && (
            <button type="button" className="offline-open-clear" onClick={onQuit}>
              סגירת התוכנה
            </button>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
