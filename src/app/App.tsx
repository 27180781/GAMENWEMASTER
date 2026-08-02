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
import { parseGameFileLenient, type DroppedSlide, type GameFile } from '../engine/index.ts';
import { DebugApp } from '../debug/DebugApp.tsx';
import { SettingsScreen } from '../render/SettingsScreen.tsx';
import { Stage } from '../render/Stage.tsx';
import { themeStyle } from '../render/theme.ts';
import { GameHost } from './GameHost.tsx';
import { prefetchBackup, resolveBackupConfig } from './backup.ts';
import { useMediaPreload } from './useMediaPreload.ts';
import { MediaLoadBar, MediaLoadDot } from '../render/MediaLoadBar.tsx';
import { StartupOverlay } from '../render/StartupOverlay.tsx';
import { ErrorScreen } from '../render/ErrorScreen.tsx';
import { ClickerDiagnostic } from '../render/ClickerDiagnostic.tsx';
import { FloatingWindowControls } from '../render/WindowControls.tsx';
import { SealScreen } from '../render/SealScreen.tsx';
import { GameEditor } from '../render/GameEditor.tsx';
import {
  isDesktopClicker,
  isDesktopApp,
  rememberGame,
  getLastGame,
  forgetGame,
  getSealedGame,
  getSealMode,
  onUpdateStatus,
  getAppVersion,
  canSaveEdits,
  canDownloadByCode,
  downloadGameByCode,
  onDownloadProgress,
  canStreamMedia,
  desktopMediaClear,
  desktopLoadSavedGame,
  type SealConfig,
  type UpdateStatus,
  type DownloadProgress,
} from './clickerBridge.ts';
import { collectMediaRefs, probeMediaRefs, type MediaIssue } from './mediaCheck.ts';
import { decodeInitialMedia } from './mediaDecode.ts';
import { openPushChannel } from './pushChannel.ts';
import {
  EMPTY_ROSTER,
  fingerprintUsers,
  loadRoster,
  loadRosterSource,
  mergeGameUsers,
  parseGameUsers,
  rosterIsStale,
  saveRoster,
  saveRosterSource,
} from './roster.ts';
import { VOTE_SERVER_URL } from './socketAdapter.ts';
import {
  DEFAULT_GAME_SETTINGS,
  loadAutoTransition,
  MAIN_SITE_URL,
  parseAppParams,
  saveAutoTransition,
  shouldRedirectHome,
  type GameSettings,
} from './urlParams.ts';
import { loadGameFromExtracted, loadGameFromZip } from './zipLoader.ts';

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

/**
 * מיזוג שמות/קבוצות משדה `users` של קובץ המשחק אל המרשם השמור (לפי id המשחק).
 * אידמפוטנטי (upsert לפי מספר; קטגוריה/קבוצות לפי שם) — בטוח להריץ גם בטעינה
 * וגם בכל רענון חם באמצע משחק.
 */
function mergeUsersIntoRoster(file: GameFile, opts: { sealed?: boolean } = {}): void {
  const users = parseGameUsers(file.users);
  if (users.length === 0) return;
  const categoryName = file.name.trim() !== '' ? file.name.trim() : 'קבוצות המשחק';

  // מהדורה חדשה של אותו משחק: אותו id, אבל רשימת משתתפים אחרת (למשל EXE שנחתם
  // מחדש עם מספרי שלטים אחרים). המרשם ממוזג ולעולם אינו מוחק, ולכן בלי הבדיקה
  // הזו המספרים הישנים היו נשארים לצד החדשים. כשהרשימה השתנתה — בונים מחדש.
  const fingerprint = fingerprintUsers(String(file.users ?? ''));
  const previous = loadRosterSource(file.id);
  const stale = rosterIsStale(previous, fingerprint, opts.sealed === true);
  const base = stale ? { ...EMPTY_ROSTER } : loadRoster(file.id);

  saveRoster(file.id, mergeGameUsers(base, users, categoryName));
  saveRosterSource(file.id, fingerprint);
}

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
function Shell({
  children,
  style,
  bare = false,
}: {
  children: ReactNode;
  style?: Record<string, string>;
  /** בלי חיווי הריסיבר — למסכים שאינם משחק (כלי "חתום EXE"), שם הוא רק רעש. */
  bare?: boolean;
}) {
  return (
    <div className="game-root" dir="rtl" style={style}>
      <Stage>{children}</Stage>
      {!bare && <ClickerDiagnostic />}
      {/* מסכים שאינם המשחק (הגדרות/פתיחה/עורך) — גם מהם צריך לצאת ממסך מלא
          כדי לגרור את החלון למסך השני. במשחק עצמו הכפתורים כבר בפינה. */}
      <FloatingWindowControls />
    </div>
  );
}

/**
 * חיווי עדכון — פס עדין בפינה. מוצג רק מחוץ למשחק חי: ההתקנה קורית בסגירת
 * התוכנה ואינה קוטעת דבר, ולכן אין שום סיבה להסיח את המנחה באמצע אירוע.
 */
function UpdateBadge({ status }: { status: UpdateStatus }) {
  if (status.state === 'ready') {
    return (
      <div className="update-badge update-badge--ready">
        ✅ גרסה {status.version ?? 'חדשה'} הורדה — תותקן בסגירת התוכנה
      </div>
    );
  }
  if (status.state === 'sealer') {
    return <div className="update-badge update-badge--ready">✅ הכלי עודכן — ייכנס לתוקף בפתיחה הבאה</div>;
  }
  if (status.state === 'manual') {
    return (
      <div className="update-badge update-badge--warn">
        ⚠ יש גרסה חדשה, אך אין הרשאת כתיבה לתיקייה — הורידו את הכלי מחדש
      </div>
    );
  }
  if (status.state === 'downloading') {
    const pct = status.percent ?? 0;
    return <div className="update-badge">⬇ מוריד עדכון… {pct}%</div>;
  }
  // checking / current / offline / unsupported — מידע בלבד, מוצג בשורת הגרסה
  // ולא כפס בפינה (ראו VersionLine).
  return null;
}

/** נוסח מצב העדכון לשורת הגרסה. מופרד כדי שיהיה ניתן לבדיקת יחידה. */
export function updateStatusText(status: UpdateStatus | null): string {
  if (status === null) return 'בודק עדכון…';
  switch (status.state) {
    case 'checking':
      return 'בודק עדכון…';
    case 'current':
      return '✅ מעודכן';
    case 'downloading':
      return `⬇ מוריד עדכון… ${status.percent ?? 0}%`;
    case 'ready':
      return `✅ גרסה ${status.version ?? 'חדשה'} תותקן בסגירת התוכנה`;
    case 'sealer':
      return '✅ עודכן — ייכנס לתוקף בפתיחה הבאה';
    case 'manual':
      return '⚠ יש גרסה חדשה — אין הרשאת כתיבה, הורידו מחדש';
    case 'offline':
      return '⚠ לא הצלחנו לבדוק עדכון (אין רשת?)';
    case 'unsupported':
      if (status.reason === 'sealed') return 'משחק סגור — אינו מתעדכן (במכוון)';
      if (status.reason === 'portable') return 'הקובץ הנייד אינו מתעדכן לבד';
      return 'עדכון אוטומטי כבוי בגרסת פיתוח';
    default:
      return '';
  }
}

/**
 * שורת גרסה קבועה במסכים שלפני המשחק. בלעדיה אין למנחה שום דרך לדעת איזו
 * גרסה רצה אצלו ואם מנגנון העדכון בכלל פועל — וזו בדיוק השאלה שנשאלת כשמשהו
 * שהתווסף לא מופיע.
 */
function VersionLine({ status }: { status: UpdateStatus | null }) {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void getAppVersion().then((v) => {
      if (alive) setVersion(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!isDesktopApp()) return null;
  // EXE ישן שאינו חושף לא גרסה ולא מצב עדכון — עדיף בלי שורה מאשר שורה
  // שתקועה על "בודק עדכון…" לנצח.
  if (version === null && status === null) return null;
  return (
    <div className="version-line" title="גרסת התוכנה ומצב העדכון האוטומטי">
      {/* תמיד הגרסה *הרצה*; גרסה חדשה שהורדה מופיעה בתוך נוסח המצב. */}
      חוויה בקליק{version !== null ? ` · גרסה ${version}` : ''} · {updateStatusText(status)}
    </div>
  );
}

/** חיווי הורדת משחק מהשרת — אחוזים כשידוע הגודל, אחרת MB שהתקבלו. */
function DownloadBar({ progress }: { progress: DownloadProgress }) {
  if (progress.phase === 'connect') {
    return <p className="offline-open-note">מתחבר לשרת…</p>;
  }
  const received = progress.received ?? 0;
  const total = progress.total ?? 0;
  const mb = (n: number) => (n / 1048576).toFixed(1);
  const pct = total > 0 ? Math.round((received / total) * 100) : null;
  return (
    <div className="offline-open-dl">
      <p className="offline-open-note">
        {pct !== null
          ? `מוריד את המשחק… ${pct}% (${mb(received)}/${mb(total)}MB)`
          : `מוריד את המשחק… ${mb(received)}MB`}
      </p>
      <div className="offline-open-dl-bar">
        {/* בלי Content-Length אין אחוזים — מציגים פס בתנועה במקום 0% מטעה */}
        <div
          className={pct === null ? 'offline-open-dl-fill is-indeterminate' : 'offline-open-dl-fill'}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
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
  /** האם רצים ב-EXE (אפליקציית שולחן עבודה) — משפיע על מסך הפתיחה וזכירת המשחק. */
  const desktopApp = isDesktopApp();
  /** הגדרות משחק מוטבע ("סגור") ב-EXE — או null אם ה-EXE גנרי. */
  const [sealConfig, setSealConfig] = useState<SealConfig | null>(null);
  /** עקיפת כתובת הגיבוי דרך ‎?backupUrl=‎ (לבדיקות מול שרת מקומי), או null. */
  const backupUrlOverride = useMemo(() => {
    const value = new URLSearchParams(window.location.search).get('backupUrl');
    return value !== null && value.trim() !== '' ? value.trim() : null;
  }, []);

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
    // שחקני דמה נדלקים רק כשהקישור כולל ‎?demo=1‎; אחרת משחק אונליין רגיל.
    crowdEnabled: params.demo,
  });
  const [remoteLoading, setRemoteLoading] = useState(params.gameUrl !== null);
  const [error, setError] = useState<string | null>(null);
  /** חיווי שהמדיה הזמנית נוקתה מהדיסק (EXE) — הגיבויים והתוצאות לא נגעו. */
  const [mediaCleared, setMediaCleared] = useState(false);
  /** מצב העדכון האוטומטי (גרסת ההתקנה) — מוצג רק מחוץ למשחק חי. */
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  /** עורך המשחק המקומי פתוח (EXE, משחק שאינו סגור). */
  const [editorOpen, setEditorOpen] = useState(false);
  /** קוד המשחק שהוקלד, והתקדמות ההורדה מהשרת (null = לא מוריד כרגע). */
  const [gameCode, setGameCode] = useState('');
  const [downloading, setDownloading] = useState<DownloadProgress | null>(null);
  /**
   * שגיאת טעינה-מקוד. *לא* משתמשים ב-error הכללי: הוא מעביר למסך שגיאה מלא,
   * וקוד שגוי הוא טעות קלדה שממנה רוצים פשוט לתקן ולנסות שוב באותו מסך.
   */
  const [codeError, setCodeError] = useState<string | null>(null);
  /** כלי "חתום EXE" — זמין רק בקובץ הנייד שאינו חתום בעצמו, ורק לפי בקשה. */
  const [sealCapable, setSealCapable] = useState(false);
  const [showSeal, setShowSeal] = useState(false);
  /**
   * הקובץ שרץ *הוא* כלי החתימה (‏SealEXE.exe). אז הוא לא נגן: אינו טוען שום
   * משחק שמור, ונפתח ישר על מסך החתימה. null = עוד לא ידוע (בודקים בעלייה),
   * וכל עוד לא ידוע — הטעינה האוטומטית ממתינה, כדי שלא תקדים את הבדיקה.
   */
  const [sealTool, setSealTool] = useState<boolean | null>(isDesktopApp() ? null : false);
  /**
   * טעינה עם שקופיות פגומות בודדות: המשחק תקין-למשחק אך יש שקופיות שנשמטו.
   * מוצג מסך אזהרה (מה לתקן) + "דלג והמשך" — ורק בלחיצה נכנסים למשחק.
   */
  const [loadNotice, setLoadNotice] = useState<{ game: GameFile; dropped: DroppedSlide[] } | null>(
    null,
  );

  // בטעינת משחק — טוענים את המעברים האוטומטיים מברירת המחדל שב-JSON, אלא אם
  // נשמרה דריסה ב-localStorage למשחק הזה (id). כך ההעדפה נשמרת בין רענונים,
  // ומשחק חדש חוזר לברירת המחדל שלו.
  useEffect(() => {
    if (pendingGame === null) return;
    const at =
      loadAutoTransition(pendingGame.id, pendingGame.setting.autoTransition) ??
      pendingGame.setting.autoTransition;
    setSettings((prev) => ({ ...prev, autoTransition: at }));
  }, [pendingGame]);

  // ייבוא שמות/קבוצות מקובץ המשחק (שדה users) למרשם: השמות ללשונית השמות,
  // והשיוך לקבוצות תחת קטגוריה בשם המשחק (השיוך בגייסון מגיע בלי קטגוריה).
  useEffect(() => {
    if (pendingGame === null) return;
    mergeUsersIntoRoster(pendingGame, { sealed: sealConfig !== null });
  }, [pendingGame, sealConfig]);

  // פענוח-מקדים כבר מהמסך הראשון: רקע הלובי והשקופית הראשונה (כולל הסרטון-רקע
  // המשותף, שמפוענח פעם אחת) — כדי שההצגה הראשונה תהיה מיידית ולא "נטענת קצת-קצת".
  useEffect(() => {
    if (pendingGame === null) return;
    decodeInitialMedia(pendingGame);
  }, [pendingGame]);

  // Prefetch גיבוי: מתחילים לבדוק אם יש משחק שמור כבר במסך ההגדרות, במקביל
  // לזמן שהמנחה שוהה בו — כך חלון "להמשיך?" מופיע מיד עם הכניסה למשחק, במקום
  // להמתין ל-round-trip (וקר-סטארט של Supabase) רק אחרי הלחיצה על "התחל".
  useEffect(() => {
    if (pendingGame === null) return;
    const cfg = resolveBackupConfig({
      offline,
      gameId: pendingGame.id,
      hasRoom: (pendingGame.room ?? '') !== '',
      crowdEnabled: settings.crowdEnabled,
      backupUrlOverride,
    });
    if (cfg !== null) prefetchBackup(cfg, pendingGame.id);
  }, [pendingGame, offline, settings.crowdEnabled, backupUrlOverride]);

  // טעינת המדיה המוקדמת (מדיית לובי + שקופיות + סאונדים) מטופלת כולה ב-
  // useMediaPreload, שמתחיל כאן במסך ההגדרות וממשיך למשחק (ראה למטה).

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
        const { game: loaded, dropped } = parseGameFileLenient(raw);
        if (!cancelled) {
          setOffline(false); // ‏?game=URL — משחק אונליין
          setMediaIssues([]);
          setMediaAlertDismissed(false);
          // שקופיות פגומות → מסך אזהרה תחילה; אחרת ישר להגדרות.
          if (dropped.length > 0) setLoadNotice({ game: loaded, dropped });
          else setPendingGame(loaded);
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

  // טעינה אוטומטית של המשחק האחרון (EXE בלבד): בפתיחה מחדש של התוכנה, אם נשמר
  // משחק אחרון — טוענים אותו ישר למסך ההגדרות, כך שאפשר מיד "התחל משחק".
  const autoLoadTriedRef = useRef(false);
  useEffect(() => {
    // ממתינים לתשובה על "האם זה כלי החתימה" — כלי החתימה חולק את תיקיית
    // ה-userData עם הנגן, ובלי ההמתנה הוא היה טוען משחק ישן שנשמר במחשב.
    if (sealTool === null) return;
    if (autoLoadTriedRef.current) return;
    autoLoadTriedRef.current = true;
    if (sealTool || !isDesktopApp() || params.gameUrl !== null) return;
    const toBuffer = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    /**
     * מסלול מהיר (EXE עם זרימת מדיה): ה-main קורא את ה-ZIP מהדיסק, מחלץ, ומחזיר
     * רק את data.json ורשימת השמות — בייטי הארכיון (שיכולים להיות גיגה-בייטים)
     * לא עוברים בצינור ולא מועתקים לזיכרון כאן. מחזיר true אם הצליח.
     */
    const loadSavedFast = async (source: 'last' | 'sealed'): Promise<boolean> => {
      const saved = await desktopLoadSavedGame(source);
      if (saved === null || saved.dataJson === '') return false;
      try {
        const res = loadGameFromExtracted(saved);
        if (saved.config !== undefined) {
          setSealConfig(saved.config);
          applySeal(res.game, saved.config);
        }
        applyLoadedZip(res);
        return true;
      } catch (e) {
        setError(`טעינת המשחק השמור נכשלה:\n${(e as Error).message}`);
        return true; // דווח — לא נופלים למסלול האיטי כדי לא להציג שגיאה כפולה
      }
    };

    void (async () => {
      // עדיפות ראשונה: משחק מוטבע ("סגור") ב-EXE — נטען אוטומטית, לא ניתן להחלפה.
      const sealed = await getSealedGame();
      if (sealed !== null && sealed.bytes.byteLength > 0) {
        if (await loadSavedFast('sealed')) return;
        setSealConfig(sealed.config); // נפילה אחורה: EXE ישן בלי המסלול המהיר
        await loadZipBuffer(toBuffer(sealed.bytes), sealed.config);
        return;
      }
      // אחרת: המשחק האחרון שנשמר (זכירה).
      if (await loadSavedFast('last')) return;
      const last = await getLastGame();
      if (last !== null && last.bytes.byteLength > 0) await loadZipBuffer(toBuffer(last.bytes));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ריצה חד-פעמית בעליית התוכנה
  }, [sealTool]);

  // מצב החתימה — נבדק פעם אחת בעלייה, *לפני* הטעינה האוטומטית. אם הקובץ שרץ
  // הוא כלי החתימה, נפתחים ישר על מסכו ולא טוענים שום משחק שמור.
  useEffect(() => {
    if (!desktopApp) return;
    let cancelled = false;
    void getSealMode().then((mode) => {
      if (cancelled) return;
      setSealCapable(mode.capable);
      setSealTool(mode.tool);
      if (mode.tool) setShowSeal(true);
    });
    return () => {
      cancelled = true;
    };
  }, [desktopApp]);

  // עדכון אוטומטי — מנוי למצב, וגם בדיקה מחדש בכל חזרה לרשת. ההתקנה עצמה
  // קורית בסגירת התוכנה, ולכן החיווי הוא מידע בלבד ואינו קוטע כלום.
  useEffect(() => onUpdateStatus(setUpdateStatus), []);

  // התקדמות הורדת משחק מהשרת (מגיעה מ-main בזמן ההורדה).
  useEffect(
    () => onDownloadProgress((p) => setDownloading((cur) => (cur === null ? cur : p))),
    [],
  );

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

  // שחרור ה-Blob URLs של משחק אופליין (ZIP) בעת החלפתו במשחק אחר או בעזיבה,
  // כדי לא לדלוף זיכרון. משחררים תמיד רק את הקודם — לעולם לא את הפעיל.
  const zipRevokeRef = useRef<(() => void) | null>(null);
  const revokeZip = useCallback(() => {
    zipRevokeRef.current?.();
    zipRevokeRef.current = null;
  }, []);
  useEffect(() => revokeZip, [revokeZip]);

  // --- טעינת קבצי משחק (מוגדרות מוקדם כדי שיהיו זמינות גם בענפי-החזרה למעלה) ---
  const loadRaw = (raw: unknown) => {
    try {
      revokeZip(); // עוזבים אופליין (אם היה) — משחררים את ה-Blob URLs שלו
      setOffline(false); // בחירת fixture / העלאת JSON — משחק אונליין
      setMediaIssues([]);
      setMediaAlertDismissed(false);
      const { game, dropped } = parseGameFileLenient(raw);
      if (dropped.length > 0) setLoadNotice({ game, dropped });
      else setPendingGame(game);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // החלת משחק אופליין שנטען מ-ZIP (משותף לבחירת קובץ ולטעינה-אוטומטית מהזיכרון).
  const applyLoadedZip = ({
    game,
    missing,
    revoke,
    dropped,
  }: Awaited<ReturnType<typeof loadGameFromZip>>) => {
    zipRevokeRef.current?.(); // שחרור משחק אופליין קודם (אם נטען אחד)
    zipRevokeRef.current = revoke;
    setOffline(true); // ZIP — משחק אופליין
    // אופליין: ב-EXE עם קליקרים (RF317) — הקליקרים הם מקור ההצבעות, לכן קהל
    // הדמה כבוי כברירת מחדל. בדפדפן רגיל (בלי קליקרים) — מדליקים קהל דמה.
    setSettings((prev) => ({ ...prev, crowdEnabled: !isDesktopClicker() }));
    setMediaIssues(missing); // נכסים חסרים בתיקיית ה-ZIP
    setMediaAlertDismissed(false);
    if (dropped.length > 0) setLoadNotice({ game, dropped });
    else setPendingGame(game);
    setError(null);
  };

  /** החלת הגדרות משחק מוטבע ("סגור") — קוד חדר ומגבלת משתתפים. */
  const applySeal = (loaded: GameFile, seal?: SealConfig) => {
    if (!seal) return;
    if (seal.room !== undefined && seal.room !== '') loaded.room = seal.room;
    if (seal.limit !== undefined && seal.limit !== null) loaded.setting.limit.number = seal.limit;
  };

  const loadZipBuffer = (buffer: ArrayBuffer, seal?: SealConfig) =>
    // ב-EXE — המדיה נזרמת מהדיסק (‏trivia-media://) במקום Blob בזיכרון, כדי
    // שהזיכרון יישאר נמוך גם למשחקים כבדי-וידאו. בדפדפן — נופל חזרה ל-Blob.
    loadGameFromZip(buffer, { stream: desktopApp })
      .then((res) => {
        applySeal(res.game, seal);
        applyLoadedZip(res);
      })
      .catch((e: unknown) => setError(`טעינת ה-ZIP נכשלה:\n${(e as Error).message}`));

  const loadZipFile = (file: File) => {
    file
      .arrayBuffer()
      .then((buffer) => {
        // ב-EXE — זוכרים את המשחק האחרון (בייטים + שם) לטעינה אוטומטית בהמשך.
        rememberGame(file.name, new Uint8Array(buffer));
        return loadZipBuffer(buffer);
      })
      .catch((e: unknown) => setError(`קריאת הקובץ נכשלה: ${(e as Error).message}`));
  };

  /**
   * טעינת משחק מהשרת לפי קוד — חלופה לטעינת ZIP מהדיסק. ההורדה נעשית ב-main
   * ישר לדיסק (חבילה עם וידאו שוקלת מאות MB), ומשם נטענת במסלול המהיר הרגיל
   * של "המשחק האחרון" — בלי להעביר בייטים דרך ה-renderer.
   */
  const loadFromCode = async (code: string) => {
    setCodeError(null);
    setDownloading({ phase: 'connect' });
    const res = await downloadGameByCode(code);
    if (!res.ok) {
      setDownloading(null);
      setCodeError(res.error ?? 'הורדת המשחק נכשלה');
      return;
    }
    const saved = await desktopLoadSavedGame('last');
    setDownloading(null);
    if (saved === null || saved.dataJson === '') {
      setCodeError('החבילה שהתקבלה מהשרת אינה תקינה');
      return;
    }
    try {
      applyLoadedZip(loadGameFromExtracted(saved));
    } catch (e) {
      setCodeError(`טעינת המשחק שהורד נכשלה: ${(e as Error).message}`);
    }
  };

  // "טען משחק אחר" (EXE) — שכחת המשחק השמור וחזרה לבורר קובץ ה-ZIP.
  const pickAnotherGame = () => {
    forgetGame();
    zipRevokeRef.current?.();
    zipRevokeRef.current = null;
    setOffline(false);
    setGame(null);
    setPendingGame(null);
    setLoadNotice(null);
    setError(null);
  };

  /** החלת קובץ משחק מעודכן: רענון חם באמצע משחק, או עדכון התצוגה לפני התחלה. */
  const applyGame = useCallback((loaded: GameFile) => {
    setError(null);
    if (gameStartedRef.current) {
      // רענון חם באמצע משחק: ממזגים קודם שמות/קבוצות מעודכנים אל המרשם השמור
      // (סינכרונית, לפני setGame) — ואז GameHost טוען את המרשם המעודכן יחד עם
      // התוכן החדש. הניקוד/ההצבעות/המיקום נשמרים ב-engine.updateGame.
      mergeUsersIntoRoster(loaded);
      setGame(loaded); // אותו id → GameHost מרענן בלי remount
    } else setPendingGame(loaded);
  }, []);

  const applyRawGame = useCallback(
    (raw: unknown) => {
      try {
        // רענון חם/פוש: טעינה סלחנית — שקופית שנשברה בעדכון מושמטת ולא מפילה את
        // הרענון. (מסך האזהרה מוצג רק בטעינה הראשונית, לא באמצע משחק חי.)
        applyGame(parseGameFileLenient(raw).game);
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

  // חסימת התחלה עד סיום טעינה (ברירת מחדל): אחרי "התחל" ממתינים לסיום ההורדה
  // (עם סבבי ניסיון-חוזר על כשל), ואז ספירה-לאחור קצרה לפני מסך ההתחברות.
  const STARTUP_COUNTDOWN = 3;
  const MAX_PRELOAD_ROUNDS = 6; // מקסימום סבבי ניסיון-חוזר לפני שממשיכים בכל זאת
  const [starting, setStarting] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [preloadNonce, setPreloadNonce] = useState(0);
  /** אחרי כמה שניות של המתנה מציעים "התחל בכל זאת" (שסתום ביטחון). */
  const STARTUP_SKIP_AFTER_MS = 15000;
  const [canSkipWait, setCanSkipWait] = useState(false);

  // טעינה מוקדמת של כל מדיית המשחק — מתחילה כבר במסך ההגדרות וממשיכה במשחק.
  const mediaPreload = useMediaPreload(game ?? pendingGame, preloadNonce);

  const preloadReady =
    mediaPreload.done && (mediaPreload.failed === 0 || preloadNonce >= MAX_PRELOAD_ROUNDS);
  const preloadRetrying =
    mediaPreload.done && mediaPreload.failed > 0 && preloadNonce < MAX_PRELOAD_ROUNDS;

  // בזמן חסימה: אם ההורדה "הסתיימה" אך יש כשלונות — מנסים שוב סבב נוסף (נכסים
  // שכבר במטמון מסתיימים מיד; רק הנכשלים מנסים שוב), עד MAX_PRELOAD_ROUNDS.
  useEffect(() => {
    if (!starting || !preloadRetrying) return undefined;
    const t = window.setTimeout(() => setPreloadNonce((n) => n + 1), 1500);
    return () => window.clearTimeout(t);
  }, [starting, preloadRetrying]);

  // כשהטעינה מוכנה (או מיצינו את הניסיונות) — פותחים ספירה-לאחור בזמן הפענוח.
  useEffect(() => {
    if (starting && preloadReady && countdown === null) setCountdown(STARTUP_COUNTDOWN);
  }, [starting, preloadReady, countdown]);

  // שסתום ביטחון: מדיה כבדה מקבלת זמן אמיתי להסתיים (כדי שהנגינה תהיה מהמטמון
  // ולא הזרמה חיה מקרטעת), אבל אחרי המתנה סבירה מציעים למנחה להתחיל בכל זאת —
  // כך CDN איטי/תקוע לעולם לא כולא אותו במסך הטעינה.
  useEffect(() => {
    if (!starting) {
      setCanSkipWait(false);
      return undefined;
    }
    const t = window.setTimeout(() => setCanSkipWait(true), STARTUP_SKIP_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [starting]);

  // טיק הספירה-לאחור; ב-0 נכנסים למשחק (מסך ההתחברות).
  useEffect(() => {
    if (countdown === null) return undefined;
    if (countdown <= 0) {
      if (pendingGame !== null) setGame(pendingGame);
      setStarting(false);
      setCountdown(null);
      setPreloadNonce(0);
      return undefined;
    }
    const t = window.setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [countdown, pendingGame]);

  // ב-URL הציבורי בלי קובץ משחק (‎?game=‎) מפנים לאתר הראשי במקום להציג את בורר
  // קבצי הבדיקה — כדי שלא ישחקו בקבצים שנועדו רק לנסיון. פיתוח מקומי ו-EXE אופליין
  // אינם מושפעים (ראו shouldRedirectHome).
  const redirectHome =
    typeof window !== 'undefined' &&
    shouldRedirectHome({
      protocol: window.location.protocol,
      hostname: window.location.hostname,
      hasGameUrl: params.gameUrl !== null,
    });
  useEffect(() => {
    if (redirectHome) window.location.replace(MAIN_SITE_URL);
  }, [redirectHome]);
  if (redirectHome) {
    return (
      <Shell>
        <div className="screen">
          <div className="screen-content">
            <div className="spinner" />
            <p className="opening-hint">מעבירים אתכם לאתר הראשי…</p>
          </div>
        </div>
      </Shell>
    );
  }

  if (hash === '#debug') return <DebugApp />;

  if (game !== null) {
    return (
      <>
        <GameHost
          key={game.id}
          game={game}
          settings={settings}
          onSettingsChange={persistAndSetSettings}
          onRequestRefresh={() => void refetchGame()}
          voteServerUrl={params.voteServer ?? VOTE_SERVER_URL}
          offline={offline}
          onApplyGame={applyRawGame}
        />
        {/* בזמן משחק — עיגול זעיר בפינה, לא פס מלא שמכער את המסך */}
        {!mediaPreload.done && <MediaLoadDot {...mediaPreload} />}
      </>
    );
  }

  // מסך ההגדרות — המסך הראשון אחרי טעינת משחק
  if (pendingGame !== null) {
    // חסימת התחלה עד סיום טעינה: מסך פתיחה עם התקדמות/ניסיונות-חוזרים וספירה.
    if (starting) {
      return (
        <Shell style={themeStyle(pendingGame.setting)}>
          <StartupOverlay
            logo={pendingGame.setting.logo.src}
            preload={mediaPreload}
            retrying={preloadRetrying}
            countdown={countdown}
            {...(canSkipWait && countdown === null
              ? { onStartAnyway: () => setCountdown(0) }
              : {})}
          />
        </Shell>
      );
    }
    // עורך המשחק המקומי — מסך מלא, מעל מסך ההגדרות שממנו נפתח.
    if (editorOpen) {
      return (
        <Shell bare style={themeStyle(pendingGame.setting)}>
          <GameEditor
            game={pendingGame}
            onApply={(edited) => setPendingGame(edited)}
            onClose={() => setEditorOpen(false)}
          />
        </Shell>
      );
    }
    return (
      <Shell style={themeStyle(pendingGame.setting)}>
        <SettingsScreen
          game={pendingGame}
          initial={settings}
          mode="start"
          allowDemo={params.demo || offline}
          offline={offline}
          qrAvailable={!offline && (pendingGame.room ?? '') !== ''}
          {...(sealConfig !== null ? { sealConfig } : {})}
          {...(desktopApp && sealConfig === null ? { onPickAnother: () => pickAnotherGame() } : {})}
          {...(offline && sealConfig === null && canSaveEdits()
            ? { onEditGame: () => setEditorOpen(true) }
            : {})}
          onSave={(saved) => {
            persistAndSetSettings(saved);
            // ברירת מחדל — חוסמים עד סיום טעינה (מסך פתיחה + ספירה); עם ההגדרה
            // "אפשר להתחיל מיד" — מעבר ישיר למשחק כמו קודם.
            if (saved.allowStartBeforeLoad) setGame(pendingGame);
            else setStarting(true);
          }}
        />
        {updateStatus !== null && <UpdateBadge status={updateStatus} />}
        <VersionLine status={updateStatus} />
        {mediaIssues.length > 0 && !mediaAlertDismissed && (
          <MediaIssuesAlert issues={mediaIssues} onClose={() => setMediaAlertDismissed(true)} />
        )}
        {!mediaPreload.done && (
          <MediaLoadBar {...mediaPreload} startsImmediately={settings.allowStartBeforeLoad} />
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

  // מסך אזהרה — נמצאו שקופיות פגומות בודדות, אך שאר המשחק תקין. מציגים מה לתקן
  // בעמוד יצירת המשחק, ומאפשרים לדלג עליהן ולשחק בכל זאת בשאר השקופיות.
  if (loadNotice !== null) {
    const { game: noticeGame, dropped } = loadNotice;
    return (
      <Shell style={themeStyle(noticeGame.setting)}>
        <ErrorScreen
          variant="warning"
          title={`נמצאו ${dropped.length} שקופיות בעייתיות`}
          issues={dropped}
          note="יש לתקן את השקופיות האלו בעמוד יצירת המשחק. אפשר לדלג עליהן ולשחק כרגיל בשאר השקופיות."
          onContinue={() => {
            setPendingGame(noticeGame);
            setLoadNotice(null);
          }}
          continueLabel="דלג על השקופיות הבעייתיות והמשך"
          onBack={params.gameUrl === null ? () => setLoadNotice(null) : undefined}
        />
      </Shell>
    );
  }

  // מסך שגיאה עצמאי — טעינת המשחק נכשלה. מחליף את בורר קבצי-הבדיקה כדי שיוצג רק
  // *מה* נכשל (רלוונטי במיוחד בטעינה מקישור באירוע חי). בטעינה מקישור מציעים
  // "נסה שוב" (טעינה מחדש); בבורר המקומי — "חזרה לבחירת קובץ".
  if (error !== null) {
    return (
      <Shell>
        <ErrorScreen
          variant="error"
          title="לא ניתן לפתוח את המשחק"
          message={error}
          onRetry={params.gameUrl !== null ? () => window.location.reload() : undefined}
          onBack={params.gameUrl === null ? () => setError(null) : undefined}
        />
      </Shell>
    );
  }

  // מסך פתיחה. ב-EXE (אופליין) — רק טעינת ZIP, מעוצב כמו מסכי האונליין; משחקי
  // הדוגמה וטעינת ה-JSON שייכים לפיתוח/אונליין ואינם מוצגים ב-EXE.
  const zipInput = (
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
  );

  // כלי החתימה נפתח ישר על מסכו. ב-SealEXE אין "חזרה" — אין מאחוריו משחק.
  if (desktopApp && showSeal) {
    return (
      <Shell bare>
        <SealScreen {...(sealTool === true ? {} : { onBack: () => setShowSeal(false) })} />
        {updateStatus !== null && <UpdateBadge status={updateStatus} />}
        <VersionLine status={updateStatus} />
      </Shell>
    );
  }

  if (desktopApp) {
    return (
      <Shell>
        <div className="screen settings-screen offline-open-screen">
          <div className="screen-content offline-open">
            <div className="offline-open-card">
              <div className="offline-open-icon" aria-hidden="true">
                🎯
              </div>
              <h1 className="offline-open-title">מנוע הטריוויה</h1>
              <p className="offline-open-lead">
                {canDownloadByCode()
                  ? 'בחרו קובץ משחק (ZIP), או הקלידו את קוד המשחק כדי למשוך אותו מהשרת'
                  : 'בחרו את קובץ המשחק (ZIP) כדי להתחיל'}
              </p>
              <label className="picker-button offline-open-load">
                📦 טעינת משחק (ZIP)
                {zipInput}
              </label>

              {/* חלופה: משיכת המשחק מהשרת לפי קוד — בלי להעביר קובץ ידנית. */}
              {canDownloadByCode() && (
                <form
                  className="offline-open-code"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (gameCode.trim() !== '' && downloading === null) void loadFromCode(gameCode);
                  }}
                >
                  <span className="offline-open-code-or">או</span>
                  <input
                    type="text"
                    dir="ltr"
                    inputMode="numeric"
                    placeholder="קוד משחק"
                    value={gameCode}
                    disabled={downloading !== null}
                    onChange={(e) => {
                      setGameCode(e.target.value);
                      setCodeError(null);
                    }}
                  />
                  <button type="submit" disabled={gameCode.trim() === '' || downloading !== null}>
                    ☁ טען מהשרת
                  </button>
                </form>
              )}
              {downloading !== null && <DownloadBar progress={downloading} />}
              {codeError !== null && <p className="offline-open-error">{codeError}</p>}
              {error !== null && <p className="offline-open-error">{error}</p>}
              {updateStatus !== null && <UpdateBadge status={updateStatus} />}
        <VersionLine status={updateStatus} />
              {sealCapable && (
                <button
                  type="button"
                  className="offline-open-seal"
                  onClick={() => setShowSeal(true)}
                >
                  🔏 חתום EXE — סגירת משחק לקובץ בודד
                </button>
              )}
              {canStreamMedia() && (
                <button
                  type="button"
                  className="offline-open-clear"
                  onClick={() => {
                    setMediaCleared(false);
                    void desktopMediaClear().then((ok) => setMediaCleared(ok));
                  }}
                >
                  🧹 נקה מדיה זמנית מהדיסק
                </button>
              )}
              {mediaCleared && (
                <p className="offline-open-note">
                  המדיה הזמנית נוקתה. הגיבויים וקבצי התוצאות נשמרו כרגיל.
                </p>
              )}
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="screen">
        <div className="screen-content">
          <h1 className="opening-title">חוויה בקליק</h1>
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
            {zipInput}
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
          <p className="opening-hint" style={{ opacity: 0.5 }}>
            טעינה מקישור: ‎?game=&lt;URL&gt;&amp;demo=1 · מסך דיבאג: ‎#debug
          </p>
        </div>
      </div>
    </Shell>
  );
}
