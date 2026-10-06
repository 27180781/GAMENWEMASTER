/**
 * המחשב הזה מול מערכת יצירת המשחקים: המספר שמוסרים למנהל, השם, מה אושר
 * למחשב, והמשחקים שנשלחו אליו (src/app/devicePlan.ts מחליט מה מהם יורד
 * ונפתח לבד). שני חלקים:
 *   • DevicePanel — כרטיס בפינת מסך הפתיחה, עם כל הפרטים.
 *   • DeviceNotices — שורות קצרות מעל מסך ההגדרות, רק כשיש מה לעשות.
 * בלי רשת הכול ממשיך לעבוד: המשחקים כבר במחשב, והאישורים נשמרו בו.
 */

import { useEffect, useState } from 'react';
import type { DeviceDownloadProgress, DeviceState } from '../app/clickerBridge.ts';
import {
  checkedAgoText,
  deliveryStatusText,
  formatDeviceId,
  type DeliveryItem,
} from '../app/devicePlan.ts';

/** כמה תווים לשם — כמו במערכת. */
const NAME_MAX = 60;

/** "מוריד… 45%" / "מוריד… 12MB" / "מתחבר…". */
export function deviceProgressText(p: DeviceDownloadProgress | null): string {
  if (p === null || p.phase === 'connect') return 'מתחבר לשרת…';
  if (p.phase === 'pack') return 'אורז במחשב…';
  const received = p.received ?? 0;
  const total = p.total ?? 0;
  if (total > 0) return `${Math.round((received / total) * 100)}%`;
  return `${(received / 1048576).toFixed(1)}MB`;
}

function statusLine(state: DeviceState, now: number): { text: string; tone: 'ok' | 'warn' | 'muted' } {
  if (state.syncing && state.checkedAt === null) return { text: 'בודק מול המערכת…', tone: 'muted' };
  const ago = checkedAgoText(state.checkedAt, now);
  switch (state.state) {
    case 'ok':
      return { text: `✅ מחובר למערכת${ago ? ` · ${ago}` : ''}`, tone: 'ok' };
    case 'offline':
      return {
        text: `אין חיבור לאינטרנט — הכול עובד כרגיל${ago ? ` · ${ago}` : ''}`,
        tone: 'warn',
      };
    case 'busy':
    case 'error':
      return { text: `הבדיקה מול המערכת לא הצליחה, ננסה שוב${ago ? ` · ${ago}` : ''}`, tone: 'warn' };
    case 'starting':
      return { text: 'בודק מול המערכת…', tone: 'muted' };
    default:
      return { text: '', tone: 'muted' };
  }
}

interface DevicePanelProps {
  state: DeviceState;
  items: DeliveryItem[];
  /** משחק שנשלח למחשב ויורד עכשיו (קוד), וההתקדמות שלו. */
  downloadingCode: string | null;
  progress: DeviceDownloadProgress | null;
  /** משחקים שההורדה שלהם נכשלה בהפעלה הזו (attemptKey). */
  failed: (item: DeliveryItem) => boolean;
  /** הורדה של המפעיל פעילה — לא מציעים פעולות שמתחרות בה. */
  busy: boolean;
  /** הקוד של המשחק שעל המסך (null = אין, או קובץ ZIP). */
  screenCode: string | null;
  onSync: () => void;
  onRename: (name: string) => void;
  onOpen: (item: DeliveryItem) => void;
  onLoad: (item: DeliveryItem) => void;
  onCancel: () => void;
}

/** כרטיס "המחשב הזה" במסך הפתיחה. */
export function DevicePanel({
  state,
  items,
  downloadingCode,
  progress,
  failed,
  busy,
  screenCode,
  onSync,
  onRename,
  onOpen,
  onLoad,
  onCancel,
}: DevicePanelProps) {
  const [now, setNow] = useState(() => Date.now());
  const [editing, setEditing] = useState<string | null>(null);
  // "נבדק לפני X דקות" מתעדכן בלי לחכות לבדיקה הבאה.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, []);
  const device = state.device;
  if (device === null) return null;
  const status = statusLine(state, now);
  const shownName = device.pendingName ?? device.name;
  const perms = state.permissions;

  const save = () => {
    if (editing === null) return;
    onRename(editing.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX));
    setEditing(null);
  };

  return (
    <aside className="device-panel" aria-label="המחשב הזה">
      <div className="device-head">
        <span className="device-head-icon" aria-hidden="true">
          💻
        </span>
        <div className="device-head-text">
          <span className="device-head-label">מספר המחשב</span>
          <span className="device-id" dir="ltr">
            {formatDeviceId(device.id)}
          </span>
        </div>
        <button
          type="button"
          className="device-sync"
          title="בדיקה עכשיו מול המערכת"
          disabled={state.syncing}
          onClick={onSync}
        >
          {state.syncing ? '…' : '⟳'}
        </button>
      </div>

      {editing === null ? (
        <div className="device-name-row">
          <span className={`device-name${shownName ? '' : ' device-name--empty'}`}>
            {shownName || 'בלי שם'}
          </span>
          <button
            type="button"
            className="device-name-edit"
            title="שם למחשב — כך הוא יופיע במערכת"
            onClick={() => setEditing(shownName ?? '')}
          >
            ✎
          </button>
        </div>
      ) : (
        <form
          className="device-name-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input
            autoFocus
            type="text"
            maxLength={NAME_MAX}
            placeholder="למשל: מחשב האולם"
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(null);
            }}
          />
          <button type="submit">שמירה</button>
          <button type="button" className="device-plain" onClick={() => setEditing(null)}>
            ביטול
          </button>
        </form>
      )}
      {device.pendingName !== null && editing === null && (
        <p className="device-note">השם יישלח למערכת בבדיקה הבאה מול האינטרנט.</p>
      )}

      {status.text !== '' && <p className={`device-status device-status--${status.tone}`}>{status.text}</p>}

      {items.length > 0 && (
        <div className="device-games">
          <h3 className="device-games-title">משחקים שנשלחו למחשב</h3>
          <ul>
            {items.map((item) => {
              const g = item.game;
              const isDownloading = g.code !== null && g.code === downloadingCode;
              const didFail = failed(item);
              const copyOnScreen = item.copy !== null && item.copy.code === screenCode;
              const openable =
                item.copy !== null && !copyOnScreen && (item.kind === 'current' || item.kind === 'update');
              const loadLabel =
                item.kind === 'new' ? (didFail ? 'נסו שוב' : 'הורדה') : item.kind === 'update' ? 'עדכון' : null;
              const text = isDownloading
                ? `מוריד… ${deviceProgressText(progress)}`
                : didFail
                  ? 'ההורדה לא הצליחה'
                  : copyOnScreen && item.kind === 'current'
                    ? 'על המסך עכשיו'
                    : deliveryStatusText(item, null);
              return (
                <li key={g.gameId} className="device-game">
                  <div className="device-game-text">
                    <span className="device-game-name" title={g.name || undefined}>
                      {g.name || 'משחק'}
                    </span>
                    <span className={`device-game-status${didFail && !isDownloading ? ' is-failed' : ''}`}>
                      {text}
                    </span>
                  </div>
                  {isDownloading ? (
                    <button type="button" className="device-act device-plain" onClick={onCancel}>
                      עצירה
                    </button>
                  ) : (
                    <>
                      {loadLabel !== null && (
                        <button
                          type="button"
                          className="device-act"
                          disabled={busy || downloadingCode !== null}
                          onClick={() => onLoad(item)}
                        >
                          {loadLabel}
                        </button>
                      )}
                      {openable && (
                        <button type="button" className="device-act" disabled={busy} onClick={() => onOpen(item)}>
                          פתיחה
                        </button>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="device-perms">
        <span className={perms.createGame ? 'is-on' : 'is-off'}>
          {perms.createGame ? '✓' : '🔒'} בניית משחק חדש
        </span>
        <span className={perms.editGame ? 'is-on' : 'is-off'}>{perms.editGame ? '✓' : '🔒'} עריכה</span>
      </p>
      {(!perms.createGame || !perms.editGame) && (
        <p className="device-note">מה שנעול נפתח כשהמנהל מאשר את המחשב הזה במערכת. אפשר לשחק כרגיל בכל מקרה.</p>
      )}
    </aside>
  );
}

/** הודעה אחרי פעולה של המחשב: נפתח משחק שנשלח, עודכן, או הורדה שנכשלה. */
export type DeviceNotice =
  | { kind: 'opened'; name: string; prevCode: string | null; prevName: string }
  | { kind: 'updated'; name: string }
  | { kind: 'failed'; name: string; error: string };

interface DeviceNoticesProps {
  notice: DeviceNotice | null;
  items: DeliveryItem[];
  downloadingName: string | null;
  progress: DeviceDownloadProgress | null;
  onDismiss: () => void;
  onBack: (code: string) => void;
  onOpen: (item: DeliveryItem) => void;
  onLoad: (item: DeliveryItem) => void;
  onCancel: () => void;
}

/** מעל מסך ההגדרות: רק מה שדורש את תשומת לב המפעיל. */
export function DeviceNotices({
  notice,
  items,
  downloadingName,
  progress,
  onDismiss,
  onBack,
  onOpen,
  onLoad,
  onCancel,
}: DeviceNoticesProps) {
  const rows: JSX.Element[] = [];
  if (notice !== null) {
    if (notice.kind === 'opened') {
      rows.push(
        <div key="opened" className="device-notice device-notice--ok">
          <span>📥 נפתח המשחק שנשלח למחשב הזה: {notice.name}</span>
          {notice.prevCode !== null && (
            <button type="button" onClick={() => onBack(notice.prevCode!)}>
              חזרה ל־{notice.prevName || 'משחק הקודם'}
            </button>
          )}
          <button type="button" className="device-notice-x" title="סגירה" onClick={onDismiss}>
            ✕
          </button>
        </div>,
      );
    } else if (notice.kind === 'updated') {
      rows.push(
        <div key="updated" className="device-notice device-notice--ok">
          <span>✅ המשחק עודכן לגרסה האחרונה מהמערכת: {notice.name}</span>
          <button type="button" className="device-notice-x" title="סגירה" onClick={onDismiss}>
            ✕
          </button>
        </div>,
      );
    } else {
      rows.push(
        <div key="failed" className="device-notice device-notice--warn">
          <span>
            ⚠ ההורדה של "{notice.name}" לא הצליחה: {notice.error}
          </span>
          <button type="button" className="device-notice-x" title="סגירה" onClick={onDismiss}>
            ✕
          </button>
        </div>,
      );
    }
  }
  if (downloadingName !== null) {
    rows.push(
      <div key="dl" className="device-notice">
        <span>
          ⬇ מוריד משחק שנשלח למחשב: {downloadingName} · {deviceProgressText(progress)}
        </span>
        <button type="button" onClick={onCancel}>
          עצירה
        </button>
      </div>,
    );
  }
  const screen = items.find((i) => i.screenOutdated);
  if (screen !== undefined && screen.game.code !== null) {
    const ready = screen.kind === 'current';
    rows.push(
      <div key="screen" className={`device-notice${screen.screenEdited ? ' device-notice--warn' : ''}`}>
        <span>
          {screen.screenEdited
            ? '✏️ המשחק עודכן במערכת, אבל העותק כאן נערך במחשב. טעינת העדכון תחליף את השינויים שנעשו כאן.'
            : '🔄 יש גרסה חדשה של המשחק הזה במערכת.'}
        </span>
        {ready ? (
          <button type="button" onClick={() => onOpen(screen)}>
            פתיחת הגרסה החדשה
          </button>
        ) : (
          screen.targetOnScreen && (
            <button type="button" disabled={downloadingName !== null} onClick={() => onLoad(screen)}>
              טעינת העדכון
            </button>
          )
        )}
      </div>,
    );
  }
  for (const item of items) {
    if (item.kind !== 'current' || item.copy?.pendingOpen !== true || item.onScreen) continue;
    rows.push(
      <div key={`pending-${item.game.gameId}`} className="device-notice">
        <span>📥 נשלח למחשב והורד: {item.game.name || 'משחק'}</span>
        <button type="button" onClick={() => onOpen(item)}>
          פתיחה
        </button>
      </div>,
    );
  }
  if (rows.length === 0) return null;
  return <div className="device-notices">{rows.slice(0, 3)}</div>;
}
