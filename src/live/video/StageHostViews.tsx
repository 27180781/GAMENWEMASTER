/**
 * «במה» אצל המסך הראשי:
 * - `StageMenuSection` — סקציה בתפריט המפעיל: פתיחה, סגירה, וכניסה לניהול.
 * - `StageManager` — חלון ניהול הבמה: מי הדליק מצלמה (תצוגה מקדימה, רק למנחה),
 *   להעלות לבמה, להוריד ממנה, ולכבות מצלמה.
 * - `StageWindow` — חלונית צפה עם מי שעל הבמה, כמו שהצופים רואים אותם. גוררים,
 *   מגדילים וממזערים, כמו «המצלמה שלי» (HostSelfView.tsx).
 * - `StageChipButton` — כפתור בתג הווידאו שבפינה, לניהול באמצע המשחק.
 *
 * מה שמוצג כאן נראה גם למי שרואה את המסך הראשי עצמו (מקרן, שיתוף מסך), ולכן
 * חלון הניהול אומר את זה. הצופים בקישור רואים רק את מי שעל הבמה (snapshot.ts).
 *
 * הכפתורים על המסך עצמו (החלונית והתג) לא לוקחים פוקוס: רווח הוא «השלב הבא»
 * של המנחה. חלון הניהול חוסם את מקשי המשחק כל עוד הוא פתוח, כמו תפריט המפעיל.
 */

import { useCallback, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { clampSelfViewPos, compactPos, expandedPos } from './selfView.ts';
import {
  DEFAULT_STAGE_WINDOW_PREFS,
  galleryLayout,
  parseStageWindowPrefs,
  previewIds,
  resizedStageWindow,
  serializeStageWindowPrefs,
  STAGE_WINDOW_STORAGE_KEY,
  stageWindowSizes,
  type StageWindowPrefs,
} from './stage.ts';
import type { StageCam, StageHostError, StageHostState } from './stageHost.ts';
import { StageVideo } from './StageVideo.tsx';
import { useFloatingDrag } from './useFloatingDrag.ts';
import { useStageReceiver, type StageHostHandle, type StageKeys } from './useStage.ts';
import './stage.css';

const keepFocus = (event: MouseEvent) => event.preventDefault();
const stopDrag = (event: PointerEvent) => event.stopPropagation();

const ERROR_TEXT: Record<StageHostError, string> = {
  'no-video': 'הבמה נפתחת רק כשהווידאו שלכם משודר. הפעילו קודם את הווידאו.',
  'not-entitled': 'הרישיון של המשחק לא כולל במה.',
  'not-configured': 'הבמה עוד לא הופעלה בשרת.',
};

const BLOCK_TITLE =
  'כיבוי המצלמה של המשתתף. בחצי השעה הקרובה לא יהיה אפשר להדליק אותה שוב במשחק הזה.';

function camsText(n: number): string {
  if (n === 0) return 'אף מצלמה עוד לא דלוקה';
  return n === 1 ? 'מצלמה אחת דלוקה' : `${n} מצלמות דלוקות`;
}

function statusText(state: StageHostState, videoLive: boolean): string {
  if (state.error !== null) return ERROR_TEXT[state.error];
  switch (state.phase) {
    case 'closed':
      return videoLive
        ? 'סגורה. כשתפתחו אותה, המשתתפים יוכלו להדליק מצלמה בקישור הצפייה, ואתם תבחרו מי עולה למסך של כולם.'
        : ERROR_TEXT['no-video'];
    case 'opening':
      return 'פותחים את הבמה…';
    case 'open':
      return `🟢 פתוחה · ${camsText(state.cams.length)} · על הבמה ${state.wanted.length} מתוך ${state.maxOnStage}`;
  }
}

/** אפשר לנסות לפתוח: הווידאו משודר, והשרת לא אמר שהבמה לא שייכת למשחק הזה. */
function canOpen(state: StageHostState, videoLive: boolean): boolean {
  return videoLive && state.error !== 'not-entitled' && state.error !== 'not-configured';
}

// ---------------------------------------------------------------- תפריט המפעיל

export function StageMenuSection({
  stage,
  videoLive,
  onManage,
}: {
  stage: StageHostHandle;
  /** וידאו המנחה משודר — רק אז אפשר לפתוח את הבמה. */
  videoLive: boolean;
  /** פתיחת חלון ניהול הבמה (במקום התפריט). */
  onManage: () => void;
}) {
  const { state } = stage;
  return (
    <section className="stage-panel">
      <h3>👥 במה: המשתתפים בווידאו</h3>
      <p className={`stage-panel-status${state.error !== null ? ' is-error' : ''}`}>
        {statusText(state, videoLive)}
      </p>
      <div className="stage-panel-buttons">
        {state.phase === 'closed' ? (
          <button
            className="stage-go"
            onClick={() => {
              stage.open();
              onManage();
            }}
            disabled={!canOpen(state, videoLive)}
          >
            ▶ פתיחת הבמה
          </button>
        ) : (
          <>
            <button className="stage-go" onClick={onManage}>
              👥 ניהול הבמה
            </button>
            <button onClick={stage.close}>⏹ סגירת הבמה</button>
          </>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------- חלון ניהול הבמה

/** השמות של מי שהמצלמה שלו כבתה לרגע: כדי להציג אותו ברשימת הבמה עד שיחזור. */
function useNameMemory(cams: readonly StageCam[]): ReadonlyMap<string, string> {
  const memory = useRef(new Map<string, string>());
  for (const cam of cams) memory.current.set(cam.id, cam.name);
  return memory.current;
}

export function StageManager({
  stage,
  videoLive,
  onClose,
}: {
  stage: StageHostHandle;
  videoLive: boolean;
  onClose: () => void;
}) {
  const { state } = stage;
  const open = state.phase === 'open';
  // מי שהמנחה ביקש לראות כשיש יותר מצלמות ממה שהתצוגה המקדימה מחזיקה.
  const [focus, setFocus] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const names = useNameMemory(state.cams);

  const live = useMemo(() => new Set(state.cams.map((c) => c.id)), [state.cams]);
  const preview = useMemo(
    () => (open ? previewIds(state.cams, state.wanted, focus, state.maxPreview) : []),
    [open, state.cams, state.wanted, focus, state.maxPreview],
  );
  const previewed = useMemo(() => new Set(preview), [preview]);
  // מצלמה שהתחלפה (המשתתף התחבר מחדש) — מתחברים אליה מחדש מיד.
  const at = useMemo(() => new Map(state.cams.map((c) => [c.id, c.at])), [state.cams]);
  const view = useStageReceiver({
    keys: stage.keys,
    ids: preview,
    version: preview.map((id) => at.get(id) ?? 0).join(','),
    // חלונות קטנים: השכבה הנמוכה מספיקה, וחוסכת לכם רוחב פס.
    layer: 'low',
  });

  const peek = (id: string) =>
    setFocus((f) => [...f.filter((x) => x !== id && live.has(x)), id].slice(-state.maxPreview));
  const full = state.wanted.length >= state.maxOnStage;

  return (
    <div className="stage-manager" dir="rtl">
      <div className="stage-manager-panel">
        <header className="stage-manager-header">
          <h2>👥 הבמה</h2>
          {open && (
            <span className="stage-manager-count">
              {camsText(state.cams.length)} · על הבמה {state.wanted.length} מתוך {state.maxOnStage}
            </span>
          )}
          <span className="stage-manager-spacer" />
          {open && <button onClick={stage.close}>⏹ סגירת הבמה</button>}
          <button onClick={onClose}>סגירת החלון (ESC)</button>
        </header>

        {!open ? (
          <div className="stage-manager-closed">
            <p className={`stage-manager-status${state.error !== null ? ' is-error' : ''}`}>
              {statusText(state, videoLive)}
            </p>
            {state.phase === 'closed' && (
              <button
                className="stage-go"
                onClick={stage.open}
                disabled={!canOpen(state, videoLive)}
              >
                ▶ פתיחת הבמה
              </button>
            )}
          </div>
        ) : (
          <>
            <p className="stage-manager-hint">
              המשתתפים מדליקים מצלמה בקישור הצפייה, בכפתור «📷 מצלמה». כאן רק אתם רואים אותם, בלי
              קול. מי שתעלו לבמה מופיע לכל הצופים, וגם בחלונית הבמה במסך הזה. אם המסך הזה מוקרן או
              משותף, רואים שם גם את החלון הזה.
            </p>

            <div className="stage-manager-onstage">
              <span className="stage-manager-label">על הבמה:</span>
              {state.wanted.length === 0 ? (
                <span className="stage-manager-empty">אף אחד. לחצו «⬆ לבמה» על מצלמה.</span>
              ) : (
                state.wanted.map((id, i) => {
                  const here = live.has(id);
                  return (
                    <span
                      key={id}
                      className={`stage-chip${here ? '' : ' is-missing'}`}
                      title={
                        here
                          ? undefined
                          : 'המצלמה כבתה לרגע. היא חוזרת לבמה כשהיא נדלקת שוב, עד דקה.'
                      }
                    >
                      <span className="stage-chip-name">
                        {i + 1}. {names.get(id) || 'משתתף'}
                        {here ? '' : ' ⏳'}
                      </span>
                      <button onClick={() => stage.remove(id)} title="הורדה מהבמה">
                        ✕
                      </button>
                    </span>
                  );
                })
              )}
              {state.wanted.length > 0 && (
                <button className="stage-manager-clear" onClick={stage.clear}>
                  ⬇ כולם יורדים
                </button>
              )}
            </div>

            {state.cams.length >= state.maxCams && (
              <p className="stage-manager-note">
                הגעתם ל-{state.maxCams} מצלמות דלוקות. משתתפים נוספים יוכלו להדליק רק אחרי שמישהו
                יכבה.
              </p>
            )}
            {state.cams.length > preview.length && (
              <p className="stage-manager-note">
                מוצגות {preview.length} מצלמות בבת אחת. «👁 להציג» מחליף את זו שהוצגה הכי מזמן.
              </p>
            )}

            {state.cams.length === 0 ? (
              <p className="stage-manager-grid-empty">
                עוד אף אחד לא הדליק מצלמה. בקישור הצפייה יש עכשיו כפתור «📷 מצלמה», ומי שלוחץ עליו
                מופיע כאן.
              </p>
            ) : (
              <div className="stage-manager-grid">
                {state.cams.map((cam) => {
                  const pos = state.wanted.indexOf(cam.id);
                  const stream = view.streams.get(cam.id) ?? null;
                  return (
                    <div key={cam.id} className={`stage-card${pos >= 0 ? ' is-on' : ''}`}>
                      <div className="stage-card-video">
                        {previewed.has(cam.id) ? (
                          <>
                            <StageVideo stream={stream} />
                            {stream === null && <span className="stage-card-cover">מתחברים…</span>}
                          </>
                        ) : (
                          <button
                            className="stage-card-cover stage-card-peek"
                            onClick={() => peek(cam.id)}
                          >
                            👁 להציג
                          </button>
                        )}
                        {pos >= 0 && <span className="stage-card-badge">על הבמה · {pos + 1}</span>}
                      </div>
                      <div className="stage-card-name" title={cam.name}>
                        {cam.name}
                      </div>
                      <div className="stage-card-actions">
                        {confirming === cam.id ? (
                          <>
                            <span className="stage-card-ask">לכבות?</span>
                            <button
                              className="is-danger"
                              onClick={() => {
                                stage.block(cam.id);
                                setConfirming(null);
                              }}
                            >
                              כן, לכבות
                            </button>
                            <button onClick={() => setConfirming(null)}>ביטול</button>
                          </>
                        ) : (
                          <>
                            {pos >= 0 ? (
                              <button onClick={() => stage.remove(cam.id)}>⬇ מהבמה</button>
                            ) : (
                              <button
                                className="stage-go"
                                onClick={() => stage.put(cam.id)}
                                disabled={full}
                                title={full ? `על הבמה כבר ${state.maxOnStage}` : undefined}
                              >
                                ⬆ לבמה
                              </button>
                            )}
                            <button onClick={() => setConfirming(cam.id)} title={BLOCK_TITLE}>
                              🚫 כיבוי
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------- חלונית הבמה הצפה

/** רווח בין החלונות ומסביבם, בפיקסלים של הבמה. */
const WINDOW_PAD = 8;
const WINDOW_GAP = 6;
/** המסגרת של החלונית (stage.css) — נכללת ברוחב שלה, ולכן יורדת מהמקום לחלונות. */
const WINDOW_BORDER = 2;

function readWindowPrefs(): StageWindowPrefs {
  try {
    return parseStageWindowPrefs(localStorage.getItem(STAGE_WINDOW_STORAGE_KEY));
  } catch {
    return DEFAULT_STAGE_WINDOW_PREFS;
  }
}

function writeWindowPrefs(prefs: StageWindowPrefs): void {
  try {
    localStorage.setItem(STAGE_WINDOW_STORAGE_KEY, serializeStageWindowPrefs(prefs));
  } catch {
    /* אין אחסון — המיקום פשוט לא נשמר */
  }
}

/** החלונית מוצגת כל עוד יש מישהו על הבמה. */
export function StageWindow({ stage }: { stage: StageHostHandle }) {
  const { state, keys } = stage;
  if (state.phase !== 'open' || state.ids.length === 0 || keys === null) return null;
  return <StageWindowView keys={keys} ids={state.ids} cams={state.cams} />;
}

function StageWindowView({
  keys,
  ids,
  cams,
}: {
  keys: StageKeys;
  ids: readonly string[];
  cams: readonly StageCam[];
}) {
  const [prefs, setPrefs] = useState<StageWindowPrefs>(readWindowPrefs);
  const sizes = stageWindowSizes(prefs.large);
  const size = prefs.minimized ? sizes.pill : sizes.tile;
  const shown = clampSelfViewPos(prefs.pos, size);

  const byId = useMemo(() => new Map(cams.map((c) => [c.id, c])), [cams]);
  const layout = galleryLayout(
    ids.length,
    {
      width: sizes.tile.width - (WINDOW_PAD + WINDOW_BORDER) * 2,
      height: sizes.tile.height - (WINDOW_PAD + WINDOW_BORDER) * 2,
    },
    WINDOW_GAP,
  );
  // ממוזערת: לא מקבלים וידאו בכלל.
  const view = useStageReceiver({
    keys,
    ids: prefs.minimized ? [] : ids,
    version: ids.map((id) => byId.get(id)?.at ?? 0).join(','),
    layer: layout.tile.width >= 400 ? 'high' : 'low',
  });

  const save = useCallback((next: StageWindowPrefs) => {
    setPrefs(next);
    writeWindowPrefs(next);
  }, []);
  const minimize = () => save({ ...prefs, pos: compactPos(shown, sizes), minimized: true });
  const toggleLarge = () => save(resizedStageWindow(prefs, shown));

  const { dragging, handlers } = useFloatingDrag({
    shown,
    size,
    onMove: (pos) => setPrefs((p) => ({ ...p, pos })),
    onDrop: (pos) => save({ ...prefs, pos }),
    // לחיצה בלי גרירה על הכפתור הממוזער פותחת אותו.
    onTap: () => {
      if (prefs.minimized) save({ ...prefs, pos: expandedPos(shown, sizes), minimized: false });
    },
  });

  const className = `stage-window${prefs.minimized ? ' is-compact' : ''}${dragging ? ' is-dragging' : ''}`;
  const { cols, tile } = layout;
  return (
    <div
      className={className}
      dir="rtl"
      style={{ left: shown.x, top: shown.y, width: size.width, height: size.height }}
      title={
        prefs.minimized
          ? 'לחיצה פותחת את חלונית הבמה. אפשר גם לגרור.'
          : 'מי שעל הבמה, כמו שהצופים רואים. גוררים כדי להזיז.'
      }
      {...handlers}
      onMouseDown={keepFocus}
      onClick={(event) => event.stopPropagation()}
    >
      {prefs.minimized ? (
        <span className="stage-window-pill">👥 הבמה · {ids.length}</span>
      ) : (
        <>
          <div className="stage-window-grid">
            <div
              className="stage-window-tiles"
              style={{ width: cols * tile.width + (cols - 1) * WINDOW_GAP }}
            >
              {ids.map((id) => {
                const stream = view.streams.get(id) ?? null;
                return (
                  <div
                    key={id}
                    className="stage-tile"
                    style={{ width: tile.width, height: tile.height }}
                  >
                    <StageVideo stream={stream} />
                    {stream === null && <span className="stage-tile-wait">⏳</span>}
                    <span className="stage-tile-name">{byId.get(id)?.name ?? ''}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="stage-window-bar">
            <button
              tabIndex={-1}
              onPointerDown={stopDrag}
              onMouseDown={keepFocus}
              onClick={toggleLarge}
              title={prefs.large ? 'הקטנה' : 'הגדלה'}
            >
              {prefs.large ? '⤡' : '⤢'}
            </button>
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

// -------------------------------------------------------------- תג הווידאו

/** בתג הווידאו שבפינה: ניהול הבמה באמצע המשחק, בלי לפתוח את תפריט המפעיל. */
export function StageChipButton({
  stage,
  onManage,
}: {
  stage: StageHostHandle;
  onManage: () => void;
}) {
  const { state } = stage;
  const open = state.phase === 'open';
  return (
    <button
      tabIndex={-1}
      onMouseDown={keepFocus}
      onClick={onManage}
      className={open ? 'is-stage-open' : ''}
      title={
        open
          ? `הבמה פתוחה · ${camsText(state.cams.length)}. לחיצה לניהול הבמה.`
          : 'במה: המשתתפים בווידאו. לחיצה לפתיחה.'
      }
    >
      👥{open ? ` ${state.cams.length}` : ''}
    </button>
  );
}
