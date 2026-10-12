/**
 * «המצלמה שלי»: חלונית קטנה מעל המסך הראשי שמראה למנחה את המצלמה שלו, כמו
 * מראה, כל עוד וידאו המנחה דולק. גוררים אותה לכל מקום על המסך, ממזערים אותה
 * לכפתור קטן, או פותחים אותה בחלון נפרד של הדפדפן (Picture-in-Picture): חלון
 * שנשאר מעל הכול ואפשר להזיז גם למסך אחר, למשל כשהמשחק עצמו על מקרן.
 *
 * רק אצל המנחה: מסך הצפייה נבנה ממצב המשחק ולא מצילום של המסך, ולכן הצופים
 * בקישור לא רואים אותה. מי שרואה את המסך הראשי עצמו (מקרן, שיתוף מסך) כן, ובשביל
 * זה המזעור והחלון הנפרד. המיקום והמזעור נשמרים במחשב (selfView.ts).
 *
 * כמו התג (HostVideoControls.tsx), שום דבר כאן לא לוקח פוקוס: רווח הוא «השלב הבא»
 * של המנחה, ולחיצה עליו אחרי לחיצה על כפתור הייתה מפעילה גם את הכפתור.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { STAGE_WIDTH } from '../../render/Stage.tsx';
import type { HostVideoHandle } from './useHostVideo.ts';
import {
  compactPos,
  DEFAULT_SELF_VIEW_PREFS,
  dragSelfView,
  expandedPos,
  isDrag,
  parseSelfViewPrefs,
  prefsAfterDrag,
  SELF_VIEW_STORAGE_KEY,
  selfViewSize,
  serializeSelfViewPrefs,
  shownSelfViewPos,
  type Point,
  type SelfViewPrefs,
} from './selfView.ts';
import './hostVideo.css';

const keepFocus = (event: MouseEvent) => event.preventDefault();
const stopDrag = (event: PointerEvent) => event.stopPropagation();

function readPrefs(): SelfViewPrefs {
  try {
    return parseSelfViewPrefs(localStorage.getItem(SELF_VIEW_STORAGE_KEY));
  } catch {
    return DEFAULT_SELF_VIEW_PREFS;
  }
}

function writePrefs(prefs: SelfViewPrefs): void {
  try {
    localStorage.setItem(SELF_VIEW_STORAGE_KEY, serializeSelfViewPrefs(prefs));
  } catch {
    /* אין אחסון — המיקום פשוט לא נשמר */
  }
}

/** כמה פיקסלים במסך הם פיקסל אחד בבמה (הבמה מוקטנת ב-transform). */
function stageScaleOf(el: HTMLElement): number {
  const width = el.closest('.stage')?.getBoundingClientRect().width ?? 0;
  return width > 0 ? width / STAGE_WIDTH : 1;
}

/** פיירפוקס, למשל, לא נותן לדף לפתוח חלון כזה — אז אין כפתור. */
function pipSupported(): boolean {
  return typeof document !== 'undefined' && document.pictureInPictureEnabled === true;
}

interface DragState {
  id: number;
  start: Point;
  pointer: Point;
  scale: number;
  moved: boolean;
  last: Point;
}

export function HostSelfView({ video }: { video: HostVideoHandle }) {
  const { state } = video;
  const on = state.phase === 'starting' || state.phase === 'live' || state.phase === 'reconnecting';
  if (!on || state.stream === null) return null;
  return <SelfViewWindow stream={state.stream} cam={state.cam} mic={state.mic} />;
}

function SelfViewWindow({ stream, cam, mic }: { stream: MediaStream; cam: boolean; mic: boolean }) {
  const [prefs, setPrefs] = useState<SelfViewPrefs>(readPrefs);
  const [pip, setPip] = useState(false);
  // הכפתור «בחלון נפרד» אחרי שגררו אותו; עד אז הוא בפינה של החלונית.
  const [pipPill, setPipPill] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const drag = useRef<DragState | null>(null);

  const compact = prefs.minimized || pip;
  const size = selfViewSize(compact);
  const shown = shownSelfViewPos(prefs, pip, pipPill);

  useEffect(() => {
    const el = videoRef.current;
    if (el === null) return;
    el.srcObject = stream;
    void el.play().catch(() => {});
  }, [stream]);

  // החלון הנפרד נסגר גם מבחוץ (ה-X שלו); ובכיבוי הווידאו הוא נסגר איתנו.
  useEffect(() => {
    const el = videoRef.current;
    if (el === null) return undefined;
    const enter = () => setPip(true);
    const leave = () => {
      setPip(false);
      setPipPill(null);
    };
    el.addEventListener('enterpictureinpicture', enter);
    el.addEventListener('leavepictureinpicture', leave);
    return () => {
      el.removeEventListener('enterpictureinpicture', enter);
      el.removeEventListener('leavepictureinpicture', leave);
      if (document.pictureInPictureElement === el)
        void document.exitPictureInPicture().catch(() => {});
    };
  }, []);

  const save = useCallback((next: SelfViewPrefs) => {
    setPrefs(next);
    writePrefs(next);
  }, []);

  // הכפתור הממוזער נצמד לפינה של החלונית שקרובה לפינת המסך, והפתיחה מחזירה אותה לשם.
  const minimize = () => save({ pos: compactPos(shown), minimized: true });
  const restore = () => save({ pos: expandedPos(shown), minimized: false });
  const openPip = () => {
    void videoRef.current?.requestPictureInPicture().catch(() => {});
  };
  const closePip = () => {
    void document.exitPictureInPicture().catch(() => {});
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointer = { x: event.clientX, y: event.clientY };
    drag.current = {
      id: event.pointerId,
      start: shown,
      pointer,
      scale: stageScaleOf(event.currentTarget),
      moved: false,
      last: shown,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d === null || d.id !== event.pointerId) return;
    const now = { x: event.clientX, y: event.clientY };
    if (!d.moved && !isDrag(d.pointer, now)) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(true);
    }
    d.last = dragSelfView(d.start, d.pointer, now, d.scale, size);
    const pos = d.last;
    if (pip && !prefs.minimized) setPipPill(pos);
    else setPrefs((p) => ({ ...p, pos }));
  };

  const finish = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    if (d === null || d.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (d.moved) {
      setDragging(false);
      const pos = cancelled
        ? d.last
        : dragSelfView(d.start, d.pointer, { x: event.clientX, y: event.clientY }, d.scale, size);
      if (pip && !prefs.minimized) setPipPill(pos);
      save(prefsAfterDrag(prefs, pip, pos));
      return;
    }
    // לחיצה בלי גרירה על הכפתור הממוזער: פותחת אותו, או מחזירה מהחלון הנפרד.
    if (!cancelled && compact) {
      if (pip) closePip();
      else restore();
    }
  };

  const className = `host-self-view${compact ? ' is-compact' : ''}${dragging ? ' is-dragging' : ''}`;
  const title = pip
    ? 'המצלמה שלכם פתוחה בחלון נפרד. לחיצה מחזירה אותה לכאן.'
    : compact
      ? 'לחיצה פותחת את המצלמה שלכם. אפשר גם לגרור.'
      : 'המצלמה שלכם, כמו מראה. גוררים כדי להזיז.';

  return (
    <div
      className={className}
      dir="rtl"
      style={{ left: shown.x, top: shown.y }}
      title={title}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finish(event, false)}
      onPointerCancel={(event) => finish(event, true)}
      onMouseDown={keepFocus}
      onClick={(event) => event.stopPropagation()}
    >
      <video ref={videoRef} autoPlay playsInline muted />
      {compact ? (
        <span className="host-self-view-pill">{pip ? '📷 בחלון נפרד' : '📷 המצלמה שלי'}</span>
      ) : (
        <>
          {!cam && (
            <div className="host-self-view-off">
              <span>🚫 המצלמה כבויה</span>
              <span>הצופים לא רואים אתכם</span>
            </div>
          )}
          {!mic && (
            <span className="host-self-view-badge" title="המיקרופון כבוי: הצופים לא שומעים אתכם">
              🔇
            </span>
          )}
          <div className="host-self-view-bar">
            {pipSupported() && (
              <button
                tabIndex={-1}
                onPointerDown={stopDrag}
                onMouseDown={keepFocus}
                onClick={openPip}
                title="פתיחה בחלון נפרד, שנשאר מעל הכול ואפשר להזיז גם למסך אחר"
              >
                ↗
              </button>
            )}
            <button
              tabIndex={-1}
              onPointerDown={stopDrag}
              onMouseDown={keepFocus}
              onClick={minimize}
              title="מזעור"
            >
              −
            </button>
          </div>
        </>
      )}
    </div>
  );
}
