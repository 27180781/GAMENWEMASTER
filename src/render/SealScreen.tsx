/**
 * כלי "חתום EXE" — סוגר משחק (ZIP) לתוך קובץ EXE בודד שרץ אופליין.
 *
 * הזרימה: בוחרים ZIP (בדיוק כמו טעינת משחק אופליין) → הכלי קורא ממנו את
 * data.json בלבד (בלי לפרוס מדיה — זה מיותר ויקר כאן), מציג מה נמצא, ומאפשר
 * לקבוע את הגדרות המשחק הסגור → "צור EXE חתום" פותח דיאלוג שמירה וכותב.
 *
 * בסיס החתימה הוא **גרסת המנוע האחרונה** שמורדת מהמהדורה היציבה, כך שכל משחק
 * שנסגר יוצא עם המנוע העדכני — גם אם הכלי שביד ישן. בלי רשת נופלים חזרה על
 * הכלי עצמו, ומודיעים על כך בתוצאה.
 */

import { useEffect, useState } from 'react';
import {
  desktopSealGame,
  onSealProgress,
  type SealConfig,
  type SealProgress,
} from '../app/clickerBridge.ts';
import { parseGameUsers } from '../app/roster.ts';
import { readZipGameFile } from '../app/zipLoader.ts';

/** מה שנקרא מה-ZIP להצגה למשתמש לפני החתימה. */
interface ZipInfo {
  fileName: string;
  bytes: Uint8Array;
  gameName: string;
  slides: number;
  users: number;
  groups: number;
  /** מגבלת המשתתפים שכתובה בקובץ המשחק (0 = ללא הגבלה מפורשת). */
  jsonLimit: number;
  /** קוד חדר שכתוב בקובץ המשחק, אם יש. */
  jsonRoom: string;
  dropped: number;
}

type Phase = 'idle' | 'reading' | 'ready' | 'sealing' | 'done';

const MAX_LIMIT = Number.MAX_SAFE_INTEGER;

export function SealScreen({ onBack }: { onBack: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [info, setInfo] = useState<ZipInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<SealProgress | null>(null);
  const [result, setResult] = useState<{ path: string; size: number; latest: boolean } | null>(null);

  // הגדרות המשחק הסגור
  const [allowClickers, setAllowClickers] = useState(true);
  const [allowPhones, setAllowPhones] = useState(false);
  const [room, setRoom] = useState('');
  const [limit, setLimit] = useState('');
  const [useLatest, setUseLatest] = useState(true);

  useEffect(() => onSealProgress(setProgress), []);

  const pickZip = (file: File) => {
    setPhase('reading');
    setError(null);
    setResult(null);
    file
      .arrayBuffer()
      .then(async (buffer) => {
        const bytes = new Uint8Array(buffer);
        const { game, dropped } = await readZipGameFile(bytes);
        const users = parseGameUsers(game.users);
        const jsonLimit = game.setting.limit.number ?? 0;
        setInfo({
          fileName: file.name,
          bytes,
          gameName: game.name,
          slides: game.questions.length,
          users: users.length,
          groups: new Set(users.map((u) => u.groupName).filter((g) => g !== '')).size,
          jsonLimit: jsonLimit === MAX_LIMIT ? 0 : jsonLimit,
          jsonRoom: game.room ?? '',
          dropped: dropped.length,
        });
        // ברירות מחדל מתוך הקובץ: אם יש בו קוד חדר — מדובר במשחק טלפונים.
        const gameRoom = game.room ?? '';
        setRoom(gameRoom);
        setAllowPhones(gameRoom !== '');
        setPhase('ready');
      })
      .catch((e: unknown) => {
        setError(`לא ניתן לקרוא את ה-ZIP: ${(e as Error).message}`);
        setInfo(null);
        setPhase('idle');
      });
  };

  const seal = () => {
    if (info === null) return;
    setPhase('sealing');
    setError(null);
    setProgress(null);
    const trimmedRoom = room.trim();
    const parsedLimit = Number.parseInt(limit.trim(), 10);
    const config: SealConfig = {
      room: allowPhones ? trimmedRoom : '',
      allowClickers,
      allowPhones: allowPhones && trimmedRoom !== '',
      limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null,
      name: info.gameName || info.fileName.replace(/\.zip$/i, ''),
    };
    const suggested = (config.name ?? 'משחק').trim() || 'משחק';
    void desktopSealGame(info.bytes, config, suggested, { useLatest }).then((res) => {
      setProgress(null);
      if (res.ok && res.path !== undefined) {
        setResult({ path: res.path, size: res.size ?? 0, latest: res.baseSource === 'latest' });
        setPhase('done');
        return;
      }
      if (res.canceled === true) {
        setPhase('ready');
        return;
      }
      setError(res.error ?? 'החתימה נכשלה');
      setPhase('ready');
    });
  };

  return (
    <div className="screen settings-screen seal-screen">
      <div className="screen-content seal-content">
        <h1 className="seal-title">🔏 חתום EXE</h1>
        <p className="seal-lead">
          בוחרים קובץ משחק (ZIP) — ומקבלים קובץ EXE בודד שמריץ את המשחק אופליין, בלי התקנה
          ובלי קובצי משחק חיצוניים.
        </p>

        <label className="picker-button seal-pick">
          {info === null ? '📦 בחירת קובץ משחק (ZIP)' : '📦 החלפת קובץ ה-ZIP'}
          <input
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) pickZip(file);
              event.target.value = '';
            }}
          />
        </label>

        {phase === 'reading' && (
          <div className="seal-status">
            <div className="spinner" />
            <p>קורא את קובץ המשחק...</p>
          </div>
        )}

        {info !== null && (
          <div className="seal-info">
            <p className="seal-info-name">{info.gameName || info.fileName}</p>
            <ul className="seal-info-list">
              <li>
                <span>שקופיות</span>
                <strong>{info.slides}</strong>
              </li>
              <li>
                <span>משתתפים בקובץ</span>
                <strong>{info.users}</strong>
              </li>
              <li>
                <span>קבוצות</span>
                <strong>{info.groups}</strong>
              </li>
              <li>
                <span>מגבלה בקובץ</span>
                <strong>{info.jsonLimit > 0 ? info.jsonLimit : 'ללא'}</strong>
              </li>
            </ul>
            {info.dropped > 0 && (
              <p className="seal-warn">
                ⚠ {info.dropped} שקופיות פגומות יושמטו במשחק. כדאי לתקן אותן בעמוד יצירת המשחק.
              </p>
            )}
            {info.users === 0 && (
              <p className="seal-warn">
                ⚠ אין שמות/קבוצות בקובץ — במשחק הסגור תופיע רשימת משתתפים ריקה.
              </p>
            )}
          </div>
        )}

        {info !== null && (
          <div className="seal-options">
            <label className="seal-check">
              <input
                type="checkbox"
                checked={allowClickers}
                onChange={(e) => setAllowClickers(e.target.checked)}
              />
              <span>שלטים (קליקרים RF317)</span>
            </label>
            <label className="seal-check">
              <input
                type="checkbox"
                checked={allowPhones}
                onChange={(e) => setAllowPhones(e.target.checked)}
              />
              <span>טלפונים (דורש אינטרנט וקוד חדר)</span>
            </label>
            {allowPhones && (
              <label className="seal-field">
                <span>קוד חדר</span>
                <input
                  type="text"
                  dir="ltr"
                  value={room}
                  placeholder={info.jsonRoom || 'למשל 2047'}
                  onChange={(e) => setRoom(e.target.value)}
                />
              </label>
            )}
            <label className="seal-field">
              <span>מגבלת משתתפים</span>
              <input
                type="number"
                dir="ltr"
                min={1}
                value={limit}
                placeholder={info.jsonLimit > 0 ? String(info.jsonLimit) : 'כמו בקובץ'}
                onChange={(e) => setLimit(e.target.value)}
              />
            </label>
            <label className="seal-check">
              <input
                type="checkbox"
                checked={useLatest}
                onChange={(e) => setUseLatest(e.target.checked)}
              />
              <span>לחתום על גרסת המנוע האחרונה (מוריד מהאינטרנט)</span>
            </label>
          </div>
        )}

        {phase === 'sealing' && (
          <div className="seal-status">
            <div className="spinner" />
            <p>{progressLabel(progress)}</p>
            {progress?.phase === 'base' && (progress.total ?? 0) > 0 && (
              <div className="seal-bar">
                <div
                  className="seal-bar-fill"
                  style={{
                    width: `${Math.round(((progress.received ?? 0) / (progress.total ?? 1)) * 100)}%`,
                  }}
                />
              </div>
            )}
          </div>
        )}

        {error !== null && <p className="seal-error">{error}</p>}

        {result !== null && (
          <div className="seal-done">
            <p className="seal-done-title">✅ ה-EXE נוצר</p>
            <p className="seal-done-path" dir="ltr">
              {result.path}
            </p>
            <p className="seal-done-meta">
              {(result.size / 1048576).toFixed(1)}MB ·{' '}
              {result.latest ? 'נחתם על גרסת המנוע האחרונה' : 'נחתם על גרסת הכלי הזה (בלי רשת)'}
            </p>
          </div>
        )}

        <div className="seal-actions">
          <button
            type="button"
            className="picker-button seal-go"
            disabled={info === null || phase === 'sealing' || phase === 'reading'}
            onClick={seal}
          >
            {phase === 'sealing' ? 'חותם...' : '🔏 צור EXE חתום'}
          </button>
          <button type="button" className="seal-back" onClick={onBack} disabled={phase === 'sealing'}>
            חזרה
          </button>
        </div>
      </div>
    </div>
  );
}

/** תיאור השלב הנוכחי — הורדת הבסיס מציגה גם MB, הכתיבה היא הפעולה הארוכה. */
function progressLabel(p: SealProgress | null): string {
  if (p === null) return 'מתחיל...';
  if (p.phase === 'base') {
    const mb = (n: number) => (n / 1048576).toFixed(0);
    if ((p.total ?? 0) > 0) {
      return `מוריד את גרסת המנוע האחרונה... ${mb(p.received ?? 0)}/${mb(p.total ?? 0)}MB`;
    }
    return 'מוריד את גרסת המנוע האחרונה...';
  }
  return 'כותב את קובץ ה-EXE...';
}
