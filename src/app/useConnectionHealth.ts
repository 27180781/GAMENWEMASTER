/**
 * useConnectionHealth — אוסף אותות איכות רשת חיים (navigator.onLine,
 * Network Information API, וסטטוס הסוקט) ומחזיר אזהרות דרך evaluateHealth.
 * מופעל רק כשהמשחק באמת תלוי בחיבור (משחק אונליין עם סוקט).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { evaluateHealth, type HealthWarning } from './connectionHealth.ts';

interface NetworkInformationLike {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
}

function getConnection(): NetworkInformationLike | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
}

interface ConnInfo {
  effectiveType?: string | undefined;
  downlink?: number | undefined;
  rtt?: number | undefined;
}

function readConn(): ConnInfo {
  const c = getConnection();
  if (!c) return {};
  return { effectiveType: c.effectiveType, downlink: c.downlink, rtt: c.rtt };
}

interface Options {
  /** האם לנטר בכלל (משחק אונליין שתלוי בסוקט). */
  enabled: boolean;
  socketStatus: 'connected' | 'reconnecting' | 'offline';
}

export function useConnectionHealth({ enabled, socketStatus }: Options): HealthWarning[] {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [conn, setConn] = useState<ConnInfo>(() => readConn());
  const [tick, setTick] = useState(0); // אילוץ הערכה-מחדש תקופתית (למד ה-reconnectingMs)

  const notConnectedSinceRef = useRef<number | null>(null);
  const disconnectTimesRef = useRef<number[]>([]);
  const lastStatusRef = useRef<Options['socketStatus']>(socketStatus);
  const prevWarningsRef = useRef<HealthWarning[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    const onConnChange = () => setConn(readConn());
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const c = getConnection();
    c?.addEventListener?.('change', onConnChange);
    const interval = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      c?.removeEventListener?.('change', onConnChange);
      window.clearInterval(interval);
    };
  }, []);

  // מעקב אחרי מעברי סטטוס הסוקט: מתי התנתק, וספירת ניתוקים
  useEffect(() => {
    const prev = lastStatusRef.current;
    lastStatusRef.current = socketStatus;
    if (socketStatus === 'connected') {
      notConnectedSinceRef.current = null;
    } else {
      if (notConnectedSinceRef.current === null) notConnectedSinceRef.current = Date.now();
      if (prev === 'connected') disconnectTimesRef.current.push(Date.now());
    }
  }, [socketStatus]);

  return useMemo(() => {
    const previous = prevWarningsRef.current;
    if (!enabled) {
      if (previous.length === 0) return previous;
      prevWarningsRef.current = [];
      return prevWarningsRef.current;
    }
    const now = Date.now();
    disconnectTimesRef.current = disconnectTimesRef.current.filter((t) => now - t < 60_000);
    const reconnectingMs =
      notConnectedSinceRef.current === null ? 0 : now - notConnectedSinceRef.current;
    const next = evaluateHealth({
      online,
      socketStatus,
      reconnectingMs,
      disconnectsInWindow: disconnectTimesRef.current.length,
      effectiveType: conn.effectiveType,
      downlink: conn.downlink,
      rtt: conn.rtt,
    });
    // מחזירים את אותה הפניה כשהאזהרות לא השתנו — כדי לא לרנדר כל שנייה לחינם
    const same =
      previous.length === next.length && previous.every((w, i) => w.code === next[i]!.code);
    if (same) return previous;
    prevWarningsRef.current = next;
    return next;
    // tick מאלץ הערכה-מחדש תקופתית של reconnectingMs (לא נצרך בגוף עצמו)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, socketStatus, online, conn, tick]);
}
