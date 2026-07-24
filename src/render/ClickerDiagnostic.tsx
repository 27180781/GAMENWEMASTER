/**
 * חיווי קליקרי RF317 (מוצג רק ב-EXE, כשגשר הקליקרים זמין). מציג בפינה את סטטוס
 * הריסיבר (מחובר/מנותק) ו-"toast" קצר לכל לחיצה שמתקבלת — כדי לאמת בקלות שהזרם
 * מהדונגל מגיע, כולל ערכי הכפתור והמזהה בפועל. גם כל אירוע נרשם ללוג הדיבאג.
 */

import { useEffect, useState } from 'react';
import { debugLog } from '../app/debugLog.ts';
import {
  isDesktopClicker,
  onClickerEvent,
  onReceiverClient,
  type ClickerEvent,
} from '../app/clickerBridge.ts';

interface LastPress {
  button: number;
  remoteId: number;
  at: number;
}

export function ClickerDiagnostic() {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('ממתין לריסיבר…');
  const [last, setLast] = useState<LastPress | null>(null);

  useEffect(() => {
    if (!isDesktopClicker()) return undefined;
    const offEvent = onClickerEvent((ev: ClickerEvent) => {
      if (ev.type === 'key') {
        debugLog('clicker', `כפתור ${ev.button} · קליקר ${ev.remoteId}`, {
          button: ev.button,
          remoteId: ev.remoteId,
        });
        setLast({ button: ev.button, remoteId: ev.remoteId, at: Date.now() });
      } else {
        debugLog('clicker', `סטטוס ריסיבר: ${ev.status}`, { code: ev.code });
        setConnected(ev.status === 'connected');
        setStatus(`ריסיבר: ${ev.status}`);
      }
    });
    const offClient = onReceiverClient((info) => {
      debugLog(
        'clicker',
        info.connected ? `תוכנת הריסיבר התחברה לסוקט${info.who ? ` (${info.who})` : ''}` : 'תוכנת הריסיבר התנתקה מהסוקט',
      );
      setConnected(info.connected);
      setStatus(info.connected ? 'תוכנת הריסיבר מחוברת' : 'תוכנת הריסיבר מנותקת');
    });
    return () => {
      offEvent();
      offClient();
    };
  }, []);

  useEffect(() => {
    if (last === null) return undefined;
    const t = window.setTimeout(() => setLast(null), 1600);
    return () => window.clearTimeout(t);
  }, [last]);

  if (!isDesktopClicker()) return null;
  return (
    <>
      <div className={`clicker-badge${connected ? ' clicker-badge--on' : ''}`} dir="rtl">
        🎯 {status}
      </div>
      {last !== null && (
        <div className="clicker-toast" dir="rtl">
          קליקר <b>{last.remoteId}</b> · כפתור <b>{last.button}</b>
        </div>
      )}
    </>
  );
}
