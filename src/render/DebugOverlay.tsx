/**
 * חלונית דיבוג (מקש F12) — מציגה בזמן אמת את מצב המשחק ואת יומן האירועים
 * (קליטת הצבעות, פקודות מפעיל, מעברים אוטומטיים, סוקט, סאונד, מדיה). היומן
 * הוא טבעת גלובלית מ-debugLog; החלונית רק מציגה אותו, מסננת ומעתיקה.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  clearDebugLog,
  getConsoleEcho,
  getDebugEntries,
  setConsoleEcho,
  subscribeDebug,
  type DebugCategory,
  type DebugEntry,
} from '../app/debugLog.ts';

/** שורות מצב חי שמוצגות בראש החלונית (מחושבות ב-GameHost). */
export interface DebugInfo {
  label: string;
  value: string;
}

const CATEGORIES: { cat: DebugCategory; label: string; color: string }[] = [
  { cat: 'phase', label: 'שלב', color: '#a78bfa' },
  { cat: 'vote', label: 'הצבעות', color: '#34d399' },
  { cat: 'command', label: 'פקודות', color: '#f59e0b' },
  { cat: 'auto', label: 'אוטומטי', color: '#38bdf8' },
  { cat: 'socket', label: 'חיבור', color: '#fb7185' },
  { cat: 'audio', label: 'סאונד', color: '#f472b6' },
  { cat: 'media', label: 'מדיה', color: '#c084fc' },
  { cat: 'game', label: 'כללי', color: '#94a3b8' },
];
const COLOR_OF = new Map(CATEGORIES.map((c) => [c.cat, c.color]));
const LABEL_OF = new Map(CATEGORIES.map((c) => [c.cat, c.label]));

function fmtTime(t: number): string {
  const d = new Date(t);
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${mm}:${ss}.${ms}`;
}

function fmtData(data: unknown): string {
  if (data === undefined) return '';
  try {
    return typeof data === 'string' ? data : JSON.stringify(data);
  } catch {
    return String(data);
  }
}

export function DebugOverlay({ info, onClose }: { info: DebugInfo[]; onClose: () => void }) {
  const entries = useSyncExternalStore(subscribeDebug, getDebugEntries);
  const [hidden, setHidden] = useState<Set<DebugCategory>>(new Set());
  const [autoscroll, setAutoscroll] = useState(true);
  const [echo, setEcho] = useState(getConsoleEcho());
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(
    () => entries.filter((e) => !hidden.has(e.cat)),
    [entries, hidden],
  );

  useEffect(() => {
    if (autoscroll && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [visible, autoscroll]);

  const toggleCat = (cat: DebugCategory) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });

  const copyLog = () => {
    const text = visible
      .map((e: DebugEntry) => `${fmtTime(e.t)} [${e.cat}] ${e.msg}${e.data !== undefined ? ' · ' + fmtData(e.data) : ''}`)
      .join('\n');
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      },
      () => {},
    );
  };

  return (
    <div className="debug-overlay" dir="rtl">
      <div className="debug-head">
        <span className="debug-title">🐞 דיבוג · F12</span>
        <button className="debug-x" onClick={onClose} title="סגירה (F12)">
          ✕
        </button>
      </div>

      <div className="debug-info">
        {info.map((row) => (
          <div key={row.label} className="debug-info-row">
            <span className="debug-info-label">{row.label}</span>
            <span className="debug-info-value">{row.value}</span>
          </div>
        ))}
      </div>

      <div className="debug-filters">
        {CATEGORIES.map((c) => {
          const off = hidden.has(c.cat);
          return (
            <button
              key={c.cat}
              className={`debug-chip${off ? ' debug-chip--off' : ''}`}
              style={{ '--chip': c.color } as React.CSSProperties}
              onClick={() => toggleCat(c.cat)}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <div className="debug-toolbar">
        <label className="debug-toggle">
          <input type="checkbox" checked={autoscroll} onChange={(e) => setAutoscroll(e.target.checked)} />
          גלילה אוטו׳
        </label>
        <label className="debug-toggle">
          <input
            type="checkbox"
            checked={echo}
            onChange={(e) => {
              setEcho(e.target.checked);
              setConsoleEcho(e.target.checked);
            }}
          />
          Console
        </label>
        <button className="debug-btn" onClick={copyLog}>
          {copied ? '✓ הועתק' : 'העתק'}
        </button>
        <button className="debug-btn" onClick={clearDebugLog}>
          נקה
        </button>
        <span className="debug-count">{visible.length}</span>
      </div>

      <div className="debug-list" ref={listRef}>
        {visible.map((e) => (
          <div key={e.id} className="debug-row">
            <span className="debug-t">{fmtTime(e.t)}</span>
            <span className="debug-cat" style={{ color: COLOR_OF.get(e.cat) }}>
              {LABEL_OF.get(e.cat)}
            </span>
            <span className="debug-msg">
              {e.msg}
              {e.data !== undefined && <span className="debug-data"> · {fmtData(e.data)}</span>}
            </span>
          </div>
        ))}
        {visible.length === 0 && <div className="debug-empty">אין אירועים (או שהכל מסונן)</div>}
      </div>
    </div>
  );
}
