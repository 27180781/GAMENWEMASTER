/**
 * שורש האפליקציה.
 *
 * פרמטרים בכתובת:
 *   ?game=<URL של game.json>  — טעינת קובץ המשחק מהכתובת ופתיחתו ישירות.
 *   &demo=1                   — מדליק מראש את שחקני הדמה במסך ההגדרות.
 *
 * הזרימה: בחירת/טעינת משחק → מסך ההגדרות (תמיד ראשון) → המשחק.
 * ניתוב מינימלי לפי hash: ‎#debug פותח את מסך הדיבאג של M1.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { parseGameFile, type GameFile } from '../engine/index.ts';
import { DebugApp } from '../debug/DebugApp.tsx';
import { SettingsScreen } from '../render/SettingsScreen.tsx';
import { Stage } from '../render/Stage.tsx';
import { themeStyle } from '../render/theme.ts';
import { GameHost } from './GameHost.tsx';
import { collectMediaRefs, probeMediaRefs, type MediaIssue } from './mediaCheck.ts';
import { openPushChannel } from './pushChannel.ts';
import { VOTE_SERVER_URL } from './socketAdapter.ts';
import {
  DEFAULT_GAME_SETTINGS,
  loadAutoTransition,
  parseAppParams,
  saveAutoTransition,
  type GameSettings,
} from './urlParams.ts';
import { loadGameFromZip } from './zipLoader.ts';

import hadassah from '../../fixtures/hadassah-ozen.json';
import masaa from '../../fixtures/masaa-sync-manual-link.json';
import beficha from '../../fixtures/beficha-uvilvavcha.json';
import neuwirth from '../../fixtures/neuwirth.json';

const RAW_FIXTURES: Record<string, unknown> = {
  'hadassah-ozen': hadassah,
  'masaa-sync-manual-link': masaa,
  'beficha-uvilvavcha': beficha,
  neuwirth: neuwirth,
};

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

/** מעטפת במה 16:9 למסכים שמחוץ למשחק עצמו (בחירה, הגדרות, טעינה). */
function Shell({ children, style }: { children: ReactNode; style?: Record<string, string> }) {
  return (
    <div className="game-root" dir="rtl" style={style}>
      <Stage>{children}</Stage>
    </div>
  );
}

/** התראת בעיות מדיה בטעינה — קישורים שבורים (אונליין) / נכסים חסרים (אופליין). */
function MediaIssuesAlert({ issues, onClose }: { issues: MediaIssue[]; onClose: () => void }) {
  const missing = issues.filter((i) => i.reason === 'missing').length;
  const broken = issues.length - missing;
  return (
    <div className="media-alert">
      <div className="media-alert-box">
        <div className="media-alert-icon">⚠️</div>
        <h2>נמצאו בעיות מדיה ({issues.length})</h2>
        <p className="media-alert-sub">
          {missing > 0 && `${missing} נכסים חסרים`}
          {missing > 0 && broken > 0 && ' · '}
          {broken > 0 && `${broken} קישורים שבורים`}
        </p>
        <ul className="media-alert-list">
          {issues.slice(0, 40).map((issue, idx) => (
            <li key={`${issue.reason}-${issue.src}-${idx}`}>
              <span className={`media-alert-tag media-alert-tag--${issue.reason}`}>
                {issue.reason === 'missing' ? 'חסר' : 'שבור'}
              </span>
              <span className="media-alert-ctx">{issue.context}</span>
              <span className="media-alert-src" dir="ltr">
                {issue.src}
              </span>
            </li>
          ))}
          {issues.length > 40 && <li className="media-alert-more">…ועוד {issues.length - 40}</li>}
        </ul>
        <button onClick={onClose}>המשך בכל זאת</button>
      </div>
    </div>
  );
}

export function App() {
  const hash = useHash();
  const params = useMemo(() => parseAppParams(window.location.search), []);

  /** משחק שנטען וממתין למסך ההגדרות (המסך הראשון תמיד). */
  const [pendingGame, setPendingGame] = useState<GameFile | null>(null);
  const [game, setGame] = useState<GameFile | null>(null);
  /** האם המשחק נטען כמשחק אופליין (ZIP) — משפיע על באנר/רישיון במשחק. */
  const [offline, setOffline] = useState(false);
  /** בעיות מדיה שזוהו בטעינה (קישורים שבורים / נכסים חסרים). */
  const [mediaIssues, setMediaIssues] = useState<MediaIssue[]>([]);
  const [mediaAlertDismissed, setMediaAlertDismissed] = useState(false);
  const [settings, setSettings] = useState<GameSettings>({
    ...DEFAULT_GAME_SETTINGS,
    crowdEnabled: params.demo || DEFAULT_GAME_SETTINGS.crowdEnabled,
  });
  const [remoteLoading, setRemoteLoading] = useState(params.gameUrl !== null);
  const [error, setError] = useState<string | null>(null);

  // בטעינת משחק — טוענים את המעברים האוטומטיים מברירת המחדל שב-JSON, אלא אם
  // נשמרה דריסה ב-localStorage למשחק הזה (id). כך ההעדפה נשמרת בין רענונים,
  // ומשחק חדש חוזר לברירת המחדל שלו.
  useEffect(() => {
    if (pendingGame === null) return;
    const at = loadAutoTransition(pendingGame.id) ?? pendingGame.setting.autoTransition;
    setSettings((prev) => ({ ...prev, autoTransition: at }));
  }, [pendingGame]);

  /** עדכון הגדרות + שמירת דריסת המעברים האוטומטיים ל-localStorage (פעולת מפעיל). */
  const persistAndSetSettings = useCallback(
    (next: GameSettings) => {
      const id = game?.id ?? pendingGame?.id;
      if (id !== undefined) saveAutoTransition(id, next.autoTransition);
      setSettings(next);
    },
    [game, pendingGame],
  );

  // טעינת משחק מכתובת חיצונית (?game=URL)
  useEffect(() => {
    if (params.gameUrl === null) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(params.gameUrl!);
        if (!response.ok) {
          throw new Error(`השרת החזיר ${response.status} ${response.statusText}`);
        }
        const raw: unknown = await response.json();
        const loaded = parseGameFile(raw);
        if (!cancelled) {
          setOffline(false); // ‏?game=URL — משחק אונליין
          setMediaIssues([]);
          setMediaAlertDismissed(false);
          setPendingGame(loaded);
          setRemoteLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(`טעינת קובץ המשחק מ-${params.gameUrl} נכשלה:\n${(e as Error).message}`);
          setRemoteLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params]);

  // בדיקת מדיה למשחק אונליין — מזהה קישורים שבורים (אופליין נבדק ב-zipLoader)
  useEffect(() => {
    if (pendingGame === null || offline) return;
    let cancelled = false;
    void probeMediaRefs(collectMediaRefs(pendingGame)).then((issues) => {
      if (!cancelled && issues.length > 0) {
        setMediaIssues(issues);
        setMediaAlertDismissed(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pendingGame, offline]);

  // -------------------------------------------------------------------------
  // רענון יזום ("פוש") למשחק אונליין — התוכן מתעדכן רק כשמגיע אות רענון,
  // בלי לאבד את מהלך המשחק (GameHost מריץ engine.updateGame, בלי remount).
  // -------------------------------------------------------------------------

  const gameStartedRef = useRef(false);
  gameStartedRef.current = game !== null;

  /** החלת קובץ משחק מעודכן: רענון חם באמצע משחק, או עדכון התצוגה לפני התחלה. */
  const applyGame = useCallback((loaded: GameFile) => {
    setError(null);
    if (gameStartedRef.current) setGame(loaded); // אותו id → GameHost מרענן בלי remount
    else setPendingGame(loaded);
  }, []);

  const applyRawGame = useCallback(
    (raw: unknown) => {
      try {
        applyGame(parseGameFile(raw));
      } catch (e) {
        setError(`רענון מהפוש נכשל:\n${(e as Error).message}`);
      }
    },
    [applyGame],
  );

  /** משיכה חוזרת של קובץ המשחק מכתובת ‎?game=URL‎ והחלתו (בלי מטמון). */
  const refetchGame = useCallback(async () => {
    if (params.gameUrl === null) return;
    try {
      const response = await fetch(params.gameUrl, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`השרת החזיר ${response.status} ${response.statusText}`);
      }
      applyRawGame(await response.json());
    } catch (e) {
      setError(`רענון קובץ המשחק נכשל:\n${(e as Error).message}`);
    }
  }, [params, applyRawGame]);

  // ערוץ הפוש (postMessage תמיד; SSE/WebSocket אם סופק &push=)
  useEffect(() => {
    if (params.gameUrl === null && params.pushUrl === null) return;
    return openPushChannel({
      pushUrl: params.pushUrl,
      onRefetch: () => void refetchGame(),
      onGame: applyRawGame,
    });
  }, [params, refetchGame, applyRawGame]);

  if (hash === '#debug') return <DebugApp />;

  if (game !== null) {
    return (
      <GameHost
        key={game.id}
        game={game}
        settings={settings}
        onSettingsChange={persistAndSetSettings}
        onRequestRefresh={() => void refetchGame()}
        voteServerUrl={params.voteServer ?? VOTE_SERVER_URL}
        offline={offline}
      />
    );
  }

  // מסך ההגדרות — המסך הראשון אחרי טעינת משחק
  if (pendingGame !== null) {
    return (
      <Shell style={themeStyle(pendingGame.setting)}>
        <SettingsScreen
          game={pendingGame}
          initial={settings}
          mode="start"
          onSave={(saved) => {
            persistAndSetSettings(saved);
            setGame(pendingGame);
          }}
        />
        {mediaIssues.length > 0 && !mediaAlertDismissed && (
          <MediaIssuesAlert issues={mediaIssues} onClose={() => setMediaAlertDismissed(true)} />
        )}
      </Shell>
    );
  }

  if (remoteLoading) {
    return (
      <Shell>
        <div className="screen">
          <div className="screen-content">
            <div className="spinner" />
            <p className="opening-hint">טוען קובץ משחק מהכתובת...</p>
          </div>
        </div>
      </Shell>
    );
  }

  const loadRaw = (raw: unknown) => {
    try {
      setOffline(false); // בחירת fixture / העלאת JSON — משחק אונליין
      setMediaIssues([]);
      setMediaAlertDismissed(false);
      setPendingGame(parseGameFile(raw));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const loadZipFile = (file: File) => {
    file
      .arrayBuffer()
      .then((buffer) => loadGameFromZip(buffer))
      .then(({ game, missing }) => {
        setOffline(true); // ZIP — משחק אופליין
        setMediaIssues(missing); // נכסים חסרים בתיקיית ה-ZIP
        setMediaAlertDismissed(false);
        setPendingGame(game);
        setError(null);
      })
      .catch((e: unknown) => setError(`טעינת ה-ZIP נכשלה:\n${(e as Error).message}`));
  };

  return (
    <Shell>
      <div className="screen">
        <div className="screen-content">
          <h1 className="opening-title">Trivia Engine</h1>
          <p className="opening-hint">בחרו קובץ משחק</p>
          <div className="picker-buttons">
            {Object.keys(RAW_FIXTURES).map((name) => (
              <button key={name} className="picker-button" onClick={() => loadRaw(RAW_FIXTURES[name])}>
                {name}
              </button>
            ))}
          </div>
          <label className="picker-button picker-upload">
            📦 טעינת משחק אופליין (ZIP)
            <input
              type="file"
              accept=".zip,application/zip"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setError(null);
                loadZipFile(file);
              }}
            />
          </label>
          <label className="picker-button picker-upload picker-upload--secondary">
            העלאת game.json...
            <input
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                file
                  .text()
                  .then((text: string) => loadRaw(JSON.parse(text) as unknown))
                  .catch((e: unknown) => setError(`קריאת הקובץ נכשלה: ${(e as Error).message}`));
              }}
            />
          </label>
          {error !== null && (
            <pre className="picker-error" style={{ whiteSpace: 'pre-wrap' }}>
              {error}
            </pre>
          )}
          <p className="opening-hint" style={{ opacity: 0.5 }}>
            טעינה מקישור: ‎?game=&lt;URL&gt;&amp;demo=1 · מסך דיבאג: ‎#debug
          </p>
        </div>
      </div>
    </Shell>
  );
}
