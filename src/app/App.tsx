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

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { parseGameFile, type GameFile } from '../engine/index.ts';
import { DebugApp } from '../debug/DebugApp.tsx';
import { SettingsScreen } from '../render/SettingsScreen.tsx';
import { Stage } from '../render/Stage.tsx';
import { GameHost } from './GameHost.tsx';
import { DEFAULT_GAME_SETTINGS, parseAppParams, type GameSettings } from './urlParams.ts';

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
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="game-root" dir="rtl">
      <Stage>{children}</Stage>
    </div>
  );
}

export function App() {
  const hash = useHash();
  const params = useMemo(() => parseAppParams(window.location.search), []);

  /** משחק שנטען וממתין למסך ההגדרות (המסך הראשון תמיד). */
  const [pendingGame, setPendingGame] = useState<GameFile | null>(null);
  const [game, setGame] = useState<GameFile | null>(null);
  const [settings, setSettings] = useState<GameSettings>({
    ...DEFAULT_GAME_SETTINGS,
    crowdEnabled: params.demo || DEFAULT_GAME_SETTINGS.crowdEnabled,
  });
  const [remoteLoading, setRemoteLoading] = useState(params.gameUrl !== null);
  const [error, setError] = useState<string | null>(null);

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

  if (hash === '#debug') return <DebugApp />;

  if (game !== null) {
    return (
      <GameHost key={game.id} game={game} settings={settings} onSettingsChange={setSettings} />
    );
  }

  // מסך ההגדרות — המסך הראשון אחרי טעינת משחק
  if (pendingGame !== null) {
    return (
      <Shell>
        <SettingsScreen
          game={pendingGame}
          initial={settings}
          mode="start"
          onSave={(saved) => {
            setSettings(saved);
            setGame(pendingGame);
          }}
        />
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
      setPendingGame(parseGameFile(raw));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
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
