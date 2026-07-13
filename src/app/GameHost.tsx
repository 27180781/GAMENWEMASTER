/**
 * GameHost — שכבת ה-host שסביב המנוע (SPEC סעיפים 1, 5, 9):
 * מריצה את הטיימרים (המנוע עצמו חסר שעון), מזרימה קהל סינתטי דרך
 * ReplayAdapter, מנהלת מקלדת/סאונד/מסכי מסגרת, תפריט מפעיל ופקודות מנחה.
 *
 * זרימת שלבים בשקופית שאלה — כל מעבר ברווח (מקלדת) או 0 (שלט מנחה/טלפון):
 *   כניסה לשקופית → [מדיית פתיחה] → הצגת השאלה → חשיפת כל תשובה בלחיצה
 *   → לחיצה להפעלת הטיימר ופתיחת ההצבעה → עצירת הטיימר (אם לא נגמר לבד)
 *   → חשיפת התשובה הנכונה → [מדיית סיום] → השקופית הבאה.
 * מקש 2 צועד אחורה בכל שלב, עד חזרה לשקופית הקודמת.
 *
 * שאר פקודות המנחה (מקלדת או שלט): 1 מסך מובילים/חזרה · 3 מחיאות כפיים ·
 * 4 ‎+10 שניות · 5 ‎-10 שניות · 6 עצירת/המשך טיימר והצבעה.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GameEngine,
  ReplayAdapter,
  isVotableSlide,
  type GameFile,
  type VoteAdapter,
  type VoteSnapshot,
} from '../engine/index.ts';
import { SocketVoteAdapter } from './socketAdapter.ts';
import { LobbyScreen, WinnersListScreen, WinnersScreen } from '../render/screens.tsx';
import { OperatorMenu } from '../render/OperatorMenu.tsx';
import type { RailPlayer, RevealState } from '../render/QuestionSlide.tsx';
import { RosterPanel } from '../render/RosterPanel.tsx';
import { SlideView } from '../render/SlideView.tsx';
import { Stage } from '../render/Stage.tsx';
import { themeStyle } from '../render/theme.ts';
import type { TimerView } from '../render/TimerRing.tsx';
import { SettingsScreen } from '../render/SettingsScreen.tsx';
import { AudioManager } from './AudioManager.ts';
import { extractHostVote } from './hostRemote.ts';
import { MediaPreloader, slidePreloadUrls } from './mediaPreloader.ts';
import {
  assignGroupByNumber,
  categoryMemberTotal,
  displayName,
  groupCounts,
  loadRoster,
  resetCategoryMemberships,
  saveRoster,
  type RosterData,
} from './roster.ts';
import { GroupConnectScreen } from '../render/GroupConnectScreen.tsx';
import {
  DEFAULT_BACKUP_CONFIG,
  endGame,
  fetchBackup,
  saveBackup,
  type BackupConfig,
  type BackupData,
} from './backup.ts';
import { backupToSnapshot, buildBackupPayload, rosterFromBackup } from './backupState.ts';
import { useConnectionHealth } from './useConnectionHealth.ts';
import { planCrowdVotes, snapshotAt } from './syntheticVotes.ts';
import { joinQrUrl, type GameSettings } from './urlParams.ts';
import { QrCode } from '../render/QrCode.tsx';
import { DebugOverlay } from '../render/DebugOverlay.tsx';
import { debugLog } from './debugLog.ts';
import { useEngineState } from './useEngineState.ts';

type HostStage = 'opening' | 'playing' | 'winners' | 'winnersList';

const NO_REVEAL: RevealState = { questionShown: false, answersShown: 0, revealCorrect: false };

/** מספר המצטרפים המרבי שמוצג במסילה בכל רגע. */
const RAIL_MAX = 9;
/**
 * קצב עדכון ה-UI מהצבעות אמת (ms) — השרת שולח כל הצבעה בנפרד, ובהמון גדול
 * זה מאות אירועים בשנייה. צוברים ומעדכנים לכל היותר פעם ב-VOTE_THROTTLE_MS
 * (‏~7 עדכונים/שנייה) כדי למנוע סופת רינדור. ההצבעות מצטברות — לא הולך לאיבוד.
 */
const VOTE_THROTTLE_MS = 140;
/** השהיה בין שלבי מעבר אוטומטי (הצגת שאלה/תשובה · פתיחת הצבעה · חשיפת תשובה). */
const AUTO_STEP_MS = 1000;
/** פלטת צבעים לאווטרים במסילת המצטרפים (מהעיצוב). */
const RAIL_COLORS = [
  '#FF6B6B',
  '#4ECDC4',
  '#FFD93D',
  '#6BCB77',
  '#A66CFF',
  '#FF9F45',
  '#4D96FF',
  '#FF6FB5',
  '#22D3EE',
];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

/** האות הראשונה להצגה באווטר (מהשם, אחרת '?'). */
function railInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed === '' ? '?' : [...trimmed][0]!;
}

interface GameHostProps {
  game: GameFile;
  /** הגדרות המשחק (שחקני דמה, שלט מנחה...) — נשמרות ברמת האפליקציה. */
  settings: GameSettings;
  onSettingsChange: (settings: GameSettings) => void;
  /**
   * "פוש רענון" למשחק אונליין: משיכה חוזרת של קובץ המשחק מכתובת ‎?game=URL‎.
   * מוזרק מ-App; undefined כשאין מקור למשוך ממנו (אופליין/העלאה ידנית).
   */
  onRequestRefresh?: () => void;
  /** כתובת שרת ההצבעות (ברירת מחדל מוזרקת מ-App). */
  voteServerUrl: string;
  /** המשחק נטען כאופליין (ZIP) — פטור מבאנר ההצטרפות ומבדיקת הרישיון. */
  offline: boolean;
}

/** מספר החיוג להצטרפות למשחקי טלפונים. */
const JOIN_DIAL_NUMBER = '033064361';

export function GameHost({
  game,
  settings,
  onSettingsChange,
  onRequestRefresh,
  voteServerUrl,
  offline,
}: GameHostProps) {
  // המנוע נוצר פעם אחת; רענון תוכן מתבצע דרך engine.updateGame בלי remount,
  // כדי לשמר את מהלך המשחק (ניקוד/מיקום). ראו useEffect על שינוי game למטה.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const engine = useMemo(() => new GameEngine(game), []);
  // מקור ההצבעות: שרת הסוקט האמיתי במשחק אונליין (יש קוד חדר ואין שחקני דמה),
  // אחרת ReplayAdapter (דמו/סינתטי, וגם אופליין — בלי רשת).
  const roomId = game.room ?? '';
  const hasRoom = roomId !== '';
  const useSocket = !settings.crowdEnabled && roomId !== '';
  // באנר הצטרפות: משחק אונליין עם קוד חדר. אזהרת רישיון: אונליין בלי קוד חדר.
  const showJoinBanner = !offline && hasRoom;
  const showLicenseWarning = !offline && !hasRoom;
  // QR להתחברות מהטלפון — רק במשחק אונליין מורשה (קוד חדר) ושאינו דמו, וכשסומן
  // בהגדרות. הקוד מוביל ל-clicker.clicker.co.il/?game=<קוד המשחק>.
  const qrAvailable = showJoinBanner;
  const showQrCode = settings.showQr && qrAvailable && !settings.crowdEnabled;
  const qrUrl = joinQrUrl(roomId);
  const adapter = useMemo<VoteAdapter>(
    () => (useSocket ? new SocketVoteAdapter(voteServerUrl) : new ReplayAdapter()),
    [useSocket, voteServerUrl],
  );
  const audio = useMemo(() => new AudioManager(), []);
  const preloader = useMemo(() => new MediaPreloader(), []);
  const state = useEngineState(engine);

  const [stage, setStage] = useState<HostStage>('opening');
  const [menuOpen, setMenuOpen] = useState(false);
  /** מסך ההגדרות באמצע משחק (כפתור ⚙) — שכבה מעל; מצב המשחק נשמר. */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** לשונית "שמות וקבוצות" — מרשם השחקנים, נגיש לכל אורך המשחק. */
  const [rosterOpen, setRosterOpen] = useState(false);
  /** אישור אזהרת הרישיון (משחק בלי קוד חדר) — נסגר בלחיצה. */
  const [licenseAck, setLicenseAck] = useState(false);
  const [roster, setRoster] = useState<RosterData>(() => loadRoster(game.id));
  const updateRoster = useCallback(
    (next: RosterData) => {
      setRoster(next);
      saveRoster(game.id, next);
    },
    [game.id],
  );
  /** מסך התחברות לקבוצות פעיל — מזהה הקטגוריה, או null. */
  const [connectCategory, setConnectCategory] = useState<string | null>(null);
  const connectCategoryRef = useRef<string | null>(null);
  connectCategoryRef.current = connectCategory;
  /** מחיל הקשות של שחקנים כשיוך לקבוצה לפי מספר (לחיצה אחרונה קובעת), ושומר. */
  const applyGroupPresses = useCallback(
    (categoryId: string, voters: Record<string, number>) => {
      setRoster((prev) => {
        let next = prev;
        for (const [voterId, num] of Object.entries(voters)) {
          next = assignGroupByNumber(next, voterId, categoryId, Number(num));
        }
        if (next !== prev) saveRoster(game.id, next);
        return next;
      });
    },
    [game.id],
  );
  const applyGroupPressesRef = useRef(applyGroupPresses);
  applyGroupPressesRef.current = applyGroupPresses;
  const rosterRef = useRef(roster);
  rosterRef.current = roster;
  // אם הקטגוריה של מסך ההתחברות נמחקה — סוגרים אותו (אחרת המקשים נחסמים בלי מסך נראה)
  useEffect(() => {
    if (connectCategory !== null && !roster.categories.some((c) => c.id === connectCategory)) {
      setConnectCategory(null);
    }
  }, [connectCategory, roster.categories]);

  // -------------------------------------------------------------------------
  // אכיפת מגבלת הרישיון (setting.limit.number): רק N המשתתפים הראשונים —
  // לפי סדר הופעתם (חיבור/הצבעה/הצטרפות לקבוצה) — מורשים; מעבר לכך מתעלמים
  // מהם לגמרי, כדי שהמשחק ישמש רק כפי הרישיון. חסר/ריק = ללא הגבלה.
  // -------------------------------------------------------------------------
  const participantLimit = game.setting.limit.number ?? Number.MAX_SAFE_INTEGER;
  const participantLimitRef = useRef(participantLimit);
  participantLimitRef.current = participantLimit;
  const admittedRef = useRef<Set<string>>(new Set());
  // איפוס רשימת המורשים כשמתחלף המשחק (id אחר) — רישיון חדש
  useEffect(() => {
    admittedRef.current = new Set();
  }, [game.id]);
  const admit = useCallback((id: string): boolean => {
    const admitted = admittedRef.current;
    if (admitted.has(id)) return true;
    if (admitted.size >= participantLimitRef.current) {
      debugLog('socket', `מעל מגבלת הרישיון (${participantLimitRef.current}) — משתתף ${id} נדחה`);
      return false;
    }
    admitted.add(id);
    return true;
  }, []);
  const admitRef = useRef(admit);
  admitRef.current = admit;
  /** שמות שהגיעו מהשרת (טלפון → שם שחקן) — מיפוי אוטומטי במשחק טלפונים. */
  const [serverNames, setServerNames] = useState<Record<string, string>>({});
  /** סטטוס החיבור לשרת ההצבעות (רלוונטי רק במשחק אונליין אמיתי). */
  const [voteStatus, setVoteStatus] = useState<'connected' | 'reconnecting' | 'offline'>(
    'offline',
  );
  /** אזהרות איכות חיבור — רק כשהמשחק תלוי בסוקט (אונליין אמיתי). */
  const connectionWarnings = useConnectionHealth({ enabled: useSocket, socketStatus: voteStatus });
  // דיבוג: סטטוס חיבור הסוקט (רק במשחק אונליין אמיתי) + אזהרות איכות
  useEffect(() => {
    if (useSocket) debugLog('socket', `סטטוס חיבור: ${voteStatus}`);
  }, [voteStatus, useSocket]);
  useEffect(() => {
    for (const w of connectionWarnings) {
      debugLog('socket', `אזהרת חיבור: ${w.message}`, { code: w.code, severity: w.severity });
    }
  }, [connectionWarnings]);
  /** השם להצגה: מרשם ידני, אחרת שם מהשרת, אחרת המספר עצמו. */
  const nameOf = useCallback(
    (voterId: string) => {
      const fromRoster = displayName(roster, voterId);
      if (fromRoster !== voterId) return fromRoster;
      return serverNames[voterId] ?? voterId;
    },
    [roster, serverNames],
  );
  const [volume, setVolume] = useState(1);
  const syntheticCrowd = settings.crowdEnabled;
  /** מסך מובילים באמצע משחק (פקודת מנחה 1) — שכבה מעל, המשחק ממשיך מתחת. */
  const [leadersOverlay, setLeadersOverlay] = useState(false);
  /** חלונית דיבוג (F12) — מוצגת מעל הכל; ‏?debug=1 פותח אותה מראש. */
  const [debugOpen, setDebugOpen] = useState(
    () => new URLSearchParams(window.location.search).get('debug') === '1',
  );
  const [timer, setTimer] = useState<TimerView | null>(null);
  /** שלבי החשיפה של השקופית הנוכחית (שאלה / תשובות / תשובה נכונה). */
  const [reveal, setReveal] = useState<RevealState>(NO_REVEAL);
  /** מזהי המצביעים האחרונים בשקופית הנוכחית (החדש ראשון) — לאווטרים המתעופפים. */
  const [answerers, setAnswerers] = useState<string[]>([]);
  const players = useMemo<RailPlayer[]>(
    () =>
      answerers.map((id) => {
        const name = nameOf(id);
        return { id, name, initial: railInitial(name), color: RAIL_COLORS[hashId(id) % RAIL_COLORS.length]! };
      }),
    [answerers, nameOf],
  );
  /** מי שענה נכונה על השקופית הנוכחית, לפי סדר הגעה (המהיר ראשון) — לפס המובילים. */
  const [correctAnswerers, setCorrectAnswerers] = useState<string[]>([]);
  const leaders = useMemo<RailPlayer[]>(
    () =>
      correctAnswerers.slice(0, 5).map((id) => {
        const name = nameOf(id);
        return { id, name, initial: railInitial(name), color: RAIL_COLORS[hashId(id) % RAIL_COLORS.length]! };
      }),
    [correctAnswerers, nameOf],
  );
  /** כל מי שהתחבר למשחק (לחץ מקש) — למסך הלובי. סדר הצטרפות. */
  const [connectedIds, setConnectedIds] = useState<string[]>([]);
  const addConnected = useCallback((id: string, name?: string) => {
    if (!admitRef.current(id)) return; // מעל מגבלת הרישיון — לא מצרפים ללובי
    if (name !== undefined && name !== '') {
      setServerNames((prev) => (prev[id] === name ? prev : { ...prev, [id]: name }));
    }
    setConnectedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);
  const connectedPlayers = useMemo<RailPlayer[]>(
    () =>
      connectedIds.map((id) => {
        const name = nameOf(id);
        return { id, name, initial: railInitial(name), color: RAIL_COLORS[hashId(id) % RAIL_COLORS.length]! };
      }),
    [connectedIds, nameOf],
  );

  const crowdConfig = settings;
  const hostVoterId = settings.hostVoterId.trim();

  const slide = engine.getCurrentSlide();
  const setting = engine.getGame().setting;
  const sounds = setting.sound;
  // רפרנס ל-sounds כדי שאפקטים לא יהיו תלויים בזהותו (משתנה ברענון חם) — כך
  // רענון תוכן באמצע שאלה לא מאפס בטעות את שלבי החשיפה.
  const soundsRef = useRef(sounds);
  soundsRef.current = sounds;

  const stageRef = useRef<HostStage>('opening');
  stageRef.current = stage;
  const revealRef = useRef<RevealState>(reveal);
  revealRef.current = reveal;
  /** תצוגה מקדימה של מסך המנצחים (מקש W): השלב לחזור אליו, או null אם לא פעיל. */
  const winnersPreviewRef = useRef<HostStage | null>(null);
  /** הרצה מהירה (מקש N): דגל שמורה ל-effect איפוס-השקופית לחשוף אותה במלואה. */
  const fastRevealRef = useRef(false);

  // -------------------------------------------------------------------------
  // גיבוי ותוצאות מול Supabase (מסמך האינטגרציה). פעיל במשחק אונליין מורשה
  // שאינו דמו; ניתן לעקוף כתובת לבדיקות דרך ‎?backupUrl=‎.
  // -------------------------------------------------------------------------
  const backupUrlOverride = useMemo(() => {
    const value = new URLSearchParams(window.location.search).get('backupUrl');
    return value !== null && value.trim() !== '' ? value.trim() : null;
  }, []);
  // אופציית שחקני הדמה זמינה עם ‎?demo=1‎, וגם באופליין (אין סוקט — הדמה הכרחי).
  const allowDemo = useMemo(() => {
    if (offline) return true;
    const value = new URLSearchParams(window.location.search).get('demo');
    return value !== null && ['', '1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }, [offline]);
  const backupCfg = useMemo<BackupConfig | null>(() => {
    if (offline || game.id === '') return null;
    if (backupUrlOverride !== null) {
      return { baseUrl: backupUrlOverride, anonKey: DEFAULT_BACKUP_CONFIG.anonKey };
    }
    return hasRoom && !syntheticCrowd ? DEFAULT_BACKUP_CONFIG : null;
  }, [offline, backupUrlOverride, hasRoom, syntheticCrowd, game.id]);

  /** גיבוי חי שנמצא בטעינה — מציג חלונית "להמשיך מאותה נקודה?". */
  const [resumePrompt, setResumePrompt] = useState<BackupData | null>(null);
  const startedAtRef = useRef<number>(Date.now());
  const saveTimerRef = useRef<number | null>(null);
  const gameEndedRef = useRef(false);

  /** בונה ושומר את מצב המשחק הנוכחי לגיבוי (זורק כדי שהקורא יידע אם הצליח). */
  const saveBackupNow = useCallback(async () => {
    if (backupCfg === null) return;
    const payload = buildBackupPayload(
      engine.getGame(),
      engine.getState(),
      rosterRef.current,
      nameOf,
      startedAtRef.current,
    );
    await saveBackup(backupCfg, engine.getGame().id, payload);
    debugLog('game', 'גיבוי נשמר', { phase: payload.meta.phase, currentQueId: payload.meta.currentQueId });
  }, [backupCfg, engine, nameOf]);
  const saveBackupNowRef = useRef(saveBackupNow);
  saveBackupNowRef.current = saveBackupNow;

  // טעינה: בדיקת גיבוי חי קיים למשחק (התאוששות מקריסה/רענון)
  useEffect(() => {
    if (backupCfg === null) return;
    let cancelled = false;
    void fetchBackup(backupCfg, game.id).then((data) => {
      if (cancelled || data === null) return;
      const hasProgress = Object.keys(data.users).length > 0 || data.meta.currentQueId !== null;
      if (hasProgress) setResumePrompt(data);
    });
    return () => {
      cancelled = true;
    };
  }, [backupCfg, game.id]);

  /** שחזור מגיבוי: הניקוד והמיקום למנוע, ומרשם מגיבוי אם אין מקומי. */
  const resumeFromBackup = useCallback(
    (data: BackupData) => {
      try {
        engine.restore(backupToSnapshot(game, data));
        startedAtRef.current = data.meta.startedAt || Date.now();
        if (rosterRef.current.categories.length === 0 && rosterRef.current.players.length === 0) {
          const restored = rosterFromBackup(data);
          if (restored.players.length > 0 || restored.categories.length > 0) updateRoster(restored);
        }
        setStage(data.meta.phase === 'ended' ? 'winners' : 'playing');
        debugLog('game', 'שוחזר מגיבוי', { phase: data.meta.phase, currentQueId: data.meta.currentQueId });
      } catch (err) {
        debugLog('game', `שחזור מגיבוי נכשל (${String(err)})`);
      }
      setResumePrompt(null);
    },
    [engine, game, updateRoster],
  );

  // שמירה אוטומטית מדורגת (debounce ~1.5s) בשינויים משמעותיים במצב המשחק
  useEffect(() => {
    if (backupCfg === null || resumePrompt !== null) return;
    if (stage !== 'playing' && stage !== 'winners' && stage !== 'winnersList') return;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void saveBackupNowRef.current().catch((err) => debugLog('game', `שמירת גיבוי נכשלה (${String(err)})`));
    }, 1500);
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, [backupCfg, resumePrompt, stage, state.scores, state.phase, state.currentSlideId, state.votesBySlide, state.slidesCompleted]);

  // סיום משחק: הגענו למסך המנצחים באמת (לא תצוגה מקדימה של W) → שמירה אחרונה
  // ואז נעילת הגיבוי והעברתו לתוצאות.
  useEffect(() => {
    if (backupCfg === null || stage !== 'winners' || winnersPreviewRef.current !== null) return;
    if (gameEndedRef.current) return;
    gameEndedRef.current = true;
    void (async () => {
      try {
        if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
        await saveBackupNowRef.current(); // מוודאים שהניקוד הסופי נשמר לפני game-over
        await endGame(backupCfg, game.id);
        debugLog('game', 'המשחק הסתיים — הגיבוי ננעל והועבר לתוצאות');
      } catch (err) {
        debugLog('game', `סיום משחק (game-over) נכשל (${String(err)})`);
      }
    })();
  }, [backupCfg, stage, game.id]);

  // איפוס שלבי חשיפה + מסילת המצטרפים + זיהוי הקשת שלט המנחה, במעבר שקופית.
  // בהרצה מהירה (מקש N) חושפים את השקופית הבאה במלואה במקום לאפס.
  useEffect(() => {
    const s = engine.getCurrentSlide();
    if (fastRevealRef.current) {
      fastRevealRef.current = false;
      setReveal(
        isVotableSlide(s)
          ? { questionShown: true, answersShown: s.question.answers.length, revealCorrect: false }
          : NO_REVEAL,
      );
    } else if (isVotableSlide(s) && engine.getState().activeMedia !== 'open') {
      // הצגת השאלה מיד עם הכניסה לשקופית הצבעה — בלי "מסך רקע ריק" ולחיצה ראשונה.
      // (אם מתנגנת מדיית פתיחה חוסמת, השאלה מוצגת אחרי סיומה כרגיל.)
      setReveal({ questionShown: true, answersShown: 0, revealCorrect: false });
      audio.play('showQuestion', soundsRef.current.showQuestionMediaSound.src);
    } else {
      setReveal(NO_REVEAL);
    }
    setAnswerers([]);
    setCorrectAnswerers([]);
    lastHostAnswerRef.current = null;
  }, [state.currentSlideId, engine, audio]);

  // דיבוג: רישום מעברי שלב/שקופית/מדיה
  useEffect(() => {
    const total = engine.getGame().questions.length;
    const s = engine.getCurrentSlide();
    debugLog('phase', `${state.phase} · שקופית ${state.currentSlideIndex + 1}/${total}`, {
      slideId: state.currentSlideId,
      type: s.type,
      activeMedia: state.activeMedia,
    });
  }, [state.phase, state.currentSlideId, state.activeMedia, state.currentSlideIndex, engine]);

  // טעינה מוקדמת של המדיה של השקופיות הקרובות — מעבר מיידי בלי מסך שחור/השהיה
  useEffect(() => {
    const questions = game.questions;
    const triviaSrc = game.setting.triviaMedia.src;
    const urls: string[] = [];
    for (let i = state.currentSlideIndex; i <= state.currentSlideIndex + 2 && i < questions.length; i++) {
      urls.push(...slidePreloadUrls(questions[i]!, triviaSrc));
    }
    // קרוב לסוף — גם מדיית מסכי הזוכים
    if (state.currentSlideIndex >= questions.length - 2) {
      for (const src of [game.setting.winnersMedia.src, game.setting.winnersListMedia.src]) {
        if (src.trim() !== '' && !src.startsWith('blob:')) urls.push(src);
      }
    }
    preloader.prefetch(urls);
  }, [state.currentSlideIndex, game, preloader]);

  useEffect(() => () => preloader.dispose(), [preloader]);

  // רענון תוכן חם ("פוש"): כשמגיע אובייקט game חדש — מחליפים את התוכן במנוע
  // בלי remount, כדי לשמר ניקוד/מיקום. שלבי החשיפה של השקופית הנוכחית נשמרים;
  // אם השקופית הנוכחית נמחקה, currentSlideId משתנה וה-effect שלמעלה מאפס אותם.
  const gameRef = useRef(game);
  useEffect(() => {
    if (gameRef.current === game) return; // אותו אובייקט — הטעינה הראשונית, לא רענון
    gameRef.current = game;
    engine.updateGame(game);
  }, [game, engine]);

  // -------------------------------------------------------------------------
  // טיימר ההצבעה — כולל עצירה והוספת/החסרת זמן (פקודות מנחה 4/5/6)
  // -------------------------------------------------------------------------

  const deadlineRef = useRef(0);
  /** לא-null = הטיימר עצור, והערך הוא הזמן שנותר (ms). */
  const pausedRemainingMsRef = useRef<number | null>(null);
  const pausedRef = useRef(false);
  const pauseStartedAtRef = useRef(0);
  /** משך העצירות המצטבר בחלון הנוכחי — להקפאת הקהל הסינתטי. */
  const pausedAccumMsRef = useRef(0);
  const lastHostAnswerRef = useRef<number | null>(null);

  const votingActive = stage === 'playing' && state.phase === 'voting';

  // -------------------------------------------------------------------------
  // Throttle להצבעות אמת — צובר snapshot מצטבר ומעדכן את המנוע/UI בקצב מוגבל
  // (leading + trailing), כדי שהמון גדול לא יגרום לסופת רינדור.
  // -------------------------------------------------------------------------
  const pendingVoteRef = useRef<VoteSnapshot | null>(null);
  const voteFlushTimerRef = useRef<number | null>(null);
  /** האטת רישום ההצבעות ללוג — לכל היותר פעם ב-500ms, שלא יציף. */
  const lastVoteLogRef = useRef(0);

  const flushPendingVotes = useCallback(() => {
    const snapshot = pendingVoteRef.current;
    if (snapshot === null) return;
    pendingVoteRef.current = null;
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot, at: Date.now() });
    const nowLog = Date.now();
    if (nowLog - lastVoteLogRef.current >= 500) {
      lastVoteLogRef.current = nowLog;
      debugLog('vote', `נקלט snapshot · ${snapshot.total} הצביעו`, {
        total: snapshot.total,
        counts: snapshot.counts,
      });
    }
    const voters = snapshot.voters;
    if (voters) {
      setAnswerers((prev) => {
        const seen = new Set(prev);
        const additions = Object.keys(voters).filter((id) => !seen.has(id));
        if (additions.length === 0) return prev;
        return [...additions.reverse(), ...prev].slice(0, RAIL_MAX);
      });
      // מובילים: מזהי מי שענה נכונה, לפי סדר הגעה (המהיר ראשון)
      const correctIds = new Set(
        engine.getCurrentSlide().question.answers.filter((a) => a.correct).map((a) => a.id),
      );
      if (correctIds.size > 0) {
        setCorrectAnswerers((prev) => {
          const seen = new Set(prev);
          const additions: string[] = [];
          for (const [voterId, answerId] of Object.entries(voters)) {
            if (!seen.has(voterId) && correctIds.has(answerId)) {
              seen.add(voterId);
              additions.push(voterId);
            }
          }
          return additions.length === 0 ? prev : [...prev, ...additions];
        });
      }
    }
  }, [engine]);
  const flushVotesRef = useRef(flushPendingVotes);
  flushVotesRef.current = flushPendingVotes;

  const scheduleVoteFlush = useCallback(() => {
    if (voteFlushTimerRef.current !== null) return;
    flushPendingVotes(); // leading — ההצבעה הראשונה בכל חלון throttle נשלחת מיד
    voteFlushTimerRef.current = window.setTimeout(() => {
      voteFlushTimerRef.current = null;
      if (pendingVoteRef.current !== null) flushPendingVotes(); // trailing — האחרון שהצטבר
    }, VOTE_THROTTLE_MS);
  }, [flushPendingVotes]);
  const scheduleVoteFlushRef = useRef(scheduleVoteFlush);
  scheduleVoteFlushRef.current = scheduleVoteFlush;

  // ניקוי טיימר ה-throttle בעזיבת הקומפוננטה
  useEffect(
    () => () => {
      if (voteFlushTimerRef.current !== null) window.clearTimeout(voteFlushTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!votingActive) {
      setTimer(null);
      pausedRef.current = false;
      pausedRemainingMsRef.current = null;
      // סגירת חלון ההצבעה — ניקוי ה-throttle (השאריות כבר נשלחו לפני הסגירה)
      if (voteFlushTimerRef.current !== null) {
        window.clearTimeout(voteFlushTimerRef.current);
        voteFlushTimerRef.current = null;
      }
      pendingVoteRef.current = null;
      return;
    }
    const total = slide.question.timeForQue;
    deadlineRef.current = Date.now() + total * 1000;
    pausedRemainingMsRef.current = null;
    pausedRef.current = false;
    pausedAccumMsRef.current = 0;
    setTimer({ remaining: total, total, paused: false });
    audio.play('timer', sounds.timerMediaSound.src, { loop: true });

    const interval = window.setInterval(() => {
      if (pausedRef.current) return;
      const remainingMs = deadlineRef.current - Date.now();
      if (remainingMs <= 0) {
        flushVotesRef.current(); // ההצבעות האחרונות שהצטברו נספרות לפני הסגירה
        engine.dispatch({ type: 'VOTING_TIMEOUT', at: Date.now() });
      } else {
        setTimer({ remaining: remainingMs / 1000, total, paused: false });
      }
    }, 200);
    return () => {
      window.clearInterval(interval);
      audio.stop('timer');
    };
  }, [votingActive, state.currentSlideId, engine, audio, slide, sounds]);

  /** הוספת/החסרת שניות לטיימר הפעיל (פקודות 4/5). */
  const adjustTimer = useCallback(
    (deltaSeconds: number) => {
      if (engine.getState().phase !== 'voting') return;
      const deltaMs = deltaSeconds * 1000;
      if (pausedRemainingMsRef.current !== null) {
        pausedRemainingMsRef.current = Math.max(0, pausedRemainingMsRef.current + deltaMs);
        const remaining = pausedRemainingMsRef.current / 1000;
        setTimer((t) => (t ? { ...t, remaining, total: Math.max(t.total, remaining) } : t));
      } else {
        deadlineRef.current += deltaMs;
        const remaining = Math.max(0, (deadlineRef.current - Date.now()) / 1000);
        setTimer((t) => (t ? { ...t, remaining, total: Math.max(t.total, remaining) } : t));
      }
    },
    [engine],
  );

  /** עצירת/המשך הטיימר וההצבעה (פקודה 6). */
  const togglePause = useCallback(() => {
    if (engine.getState().phase !== 'voting') return;
    if (pausedRemainingMsRef.current === null) {
      pausedRemainingMsRef.current = Math.max(0, deadlineRef.current - Date.now());
      pausedRef.current = true;
      pauseStartedAtRef.current = Date.now();
      audio.stop('timer');
      const remaining = pausedRemainingMsRef.current / 1000;
      setTimer((t) => (t ? { ...t, remaining, paused: true } : t));
    } else {
      deadlineRef.current = Date.now() + pausedRemainingMsRef.current;
      pausedAccumMsRef.current += Date.now() - pauseStartedAtRef.current;
      pausedRemainingMsRef.current = null;
      pausedRef.current = false;
      audio.play('timer', sounds.timerMediaSound.src, { loop: true });
      setTimer((t) => (t ? { ...t, paused: false } : t));
    }
  }, [engine, audio, sounds]);

  // -------------------------------------------------------------------------
  // זרימת השלבים: קדימה (רווח / 0) ואחורה (2)
  // -------------------------------------------------------------------------

  /** הצעד הבא במחזור השקופית — רווח במקלדת או 0 בשלט המנחה. */
  const advanceStep = useCallback(() => {
    const current = engine.getState();
    if (current.phase === 'ended') return;
    const s = engine.getCurrentSlide();
    const now = Date.now();

    // מדיה חוסמת מוצגת — הלחיצה מסיימת אותה ועוברת מיד לשלב הבא
    if (current.activeMedia !== null) {
      const wasOpen = current.activeMedia === 'open';
      engine.dispatch({ type: 'MEDIA_ENDED', at: now });
      if (wasOpen && isVotableSlide(s)) {
        // מדיית הפתיחה הסתיימה → הצגת השאלה (אותה לחיצה, בלי מסך ביניים)
        setReveal((r) => ({ ...r, questionShown: true }));
        audio.play('showQuestion', sounds.showQuestionMediaSound.src);
      } else {
        // שקופית מדיה בלבד, או מדיית סיום → השקופית הבאה (בלי מסך צבע ריק)
        engine.dispatch({ type: 'ADVANCE', at: now });
      }
      return;
    }

    if (current.phase === 'showing' && isVotableSlide(s)) {
      // שלב הצגת השאלה
      if (!revealRef.current.questionShown) {
        setReveal((r) => ({ ...r, questionShown: true }));
        audio.play('showQuestion', sounds.showQuestionMediaSound.src);
        return;
      }
      // שלב חשיפת התשובות — אחת בכל לחיצה
      const totalAnswers = s.question.answers.length;
      if (revealRef.current.answersShown < totalAnswers) {
        setReveal((r) => ({ ...r, answersShown: r.answersShown + 1 }));
        return;
      }
      // כל התשובות חשופות — לחיצה נוספת מפעילה את הטיימר ופותחת את ההצבעה
      engine.dispatch({ type: 'OPEN_VOTING', at: now });
      return;
    }

    if (current.phase === 'voting') {
      // עצירת הטיימר וסגירת ההצבעה (אם לא נגמר כבר לבד)
      flushVotesRef.current(); // ההצבעות האחרונות שהצטברו נספרות לפני הסגירה
      engine.dispatch({ type: 'ADVANCE', at: now });
      return;
    }

    if (current.phase === 'results') {
      // שלב חשיפת התשובה הנכונה (ב-trivia בלבד)
      if (s.type === 'trivia' && !revealRef.current.revealCorrect) {
        setReveal((r) => ({ ...r, revealCorrect: true }));
        audio.play('inShowAns', sounds.inShowAnsMediaSound.src);
        return;
      }
      // מדיית סיום (אם יש) ואז השקופית הבאה
      engine.dispatch({ type: 'ADVANCE', at: now });
      return;
    }

    // showing של שקופית מדיה/טקסט: מדיית פתיחה → השקופית הבאה
    engine.dispatch({ type: 'ADVANCE', at: now });
  }, [engine, audio, sounds]);

  /**
   * כניסה מחדש לשקופית במצב "כל התשובות חשופות, טיימר טרם הופעל" — בלי
   * לנגן שוב את מדיית הפתיחה (GOTO לבדו היה מציג אותה מחדש בשקופיות עם מדיה).
   */
  const reenterAtAnswers = useCallback(
    (slideId: number) => {
      const now = Date.now();
      engine.dispatch({ type: 'GOTO', slideId, at: now });
      if (engine.getState().activeMedia === 'open') {
        engine.dispatch({ type: 'MEDIA_ENDED', at: now });
      }
      setReveal({
        questionShown: true,
        answersShown: engine.getCurrentSlide().question.answers.length,
        revealCorrect: false,
      });
    },
    [engine],
  );

  /** צעד אחד אחורה בכל שלב — מקש 2; בתחילת שקופית חוזר לשקופית הקודמת. */
  const stepBack = useCallback(() => {
    const current = engine.getState();
    const s = engine.getCurrentSlide();
    const now = Date.now();

    if (current.phase === 'ended') {
      engine.dispatch({ type: 'BACK', at: now });
      return;
    }
    // מדיה חוסמת מוצגת:
    if (current.activeMedia === 'open') {
      // מדיית הפתיחה היא ההתחלה של השקופית — חזרה = לשקופית הקודמת
      engine.dispatch({ type: 'BACK', at: now });
      return;
    }
    if (current.activeMedia === 'end') {
      // ביטול מדיית הסיום — חזרה לתוצאות עם התשובה הנכונה חשופה
      engine.dispatch({ type: 'MEDIA_ENDED', at: now });
      setReveal({ questionShown: true, answersShown: s.question.answers.length, revealCorrect: true });
      return;
    }
    if (current.phase === 'results') {
      if (revealRef.current.revealCorrect) {
        setReveal((r) => ({ ...r, revealCorrect: false }));
        return;
      }
      // חזרה לשלב שלפני ההצבעה: כל התשובות חשופות, בלי לנגן שוב את המדיה
      reenterAtAnswers(s.id);
      return;
    }
    if (current.phase === 'voting') {
      // ביטול ההצבעה — חזרה למצב שבו כל התשובות חשופות והטיימר טרם הופעל
      reenterAtAnswers(s.id);
      return;
    }
    // showing
    if (isVotableSlide(s)) {
      if (revealRef.current.answersShown > 0) {
        setReveal((r) => ({ ...r, answersShown: r.answersShown - 1 }));
        return;
      }
      if (revealRef.current.questionShown) {
        setReveal((r) => ({ ...r, questionShown: false }));
        return;
      }
    }
    engine.dispatch({ type: 'BACK', at: now });
  }, [engine, reenterAtAnswers]);

  /**
   * הרצה מהירה (מקש N): לחיצה אחת מדלגת לשקופית הבאה ומציגה אותה במלואה
   * (שאלה + כל התשובות), בלי לעבור שלב-שלב. בשקופית האחרונה — סיום המשחק.
   */
  const fastNextSlide = useCallback(() => {
    const now = Date.now();
    const questions = engine.getGame().questions;
    const nextIndex = engine.getState().currentSlideIndex + 1;
    if (nextIndex >= questions.length) {
      setStage('winners'); // אין שקופית הבאה — סיום
      return;
    }
    // דגל שגורם ל-effect איפוס-השקופית לחשוף במלואה (במקום לאפס)
    fastRevealRef.current = true;
    const target = questions[nextIndex]!;
    engine.dispatch({ type: 'GOTO', slideId: target.id, at: now });
    // מדלגים על מדיית הפתיחה רק בשקופית הצבעה (כדי להגיע לשאלה החשופה). בשקופית
    // מדיה/טקסט המדיה עצמה היא התוכן — נותנים לה להתנגן, לא מדלגים למסך ריק.
    if (engine.getState().activeMedia === 'open' && isVotableSlide(target)) {
      engine.dispatch({ type: 'MEDIA_ENDED', at: now });
    }
  }, [engine]);
  const fastNextSlideRef = useRef(fastNextSlide);
  fastNextSlideRef.current = fastNextSlide;

  // -------------------------------------------------------------------------
  // פקודות מנחה (מקלדת + שלט מנחה): 0 קדימה · 1 מובילים · 2 אחורה ·
  // 3 כפיים · 4/5 ‎±10 שניות · 6 עצירה/המשך
  // -------------------------------------------------------------------------

  const runHostCommand = useCallback(
    (command: number) => {
      switch (command) {
        case 0:
          if (stageRef.current === 'playing') advanceStep();
          break;
        case 1:
          if (stageRef.current === 'playing') setLeadersOverlay((open) => !open);
          break;
        case 2:
          if (stageRef.current === 'playing') stepBack();
          break;
        case 3:
          audio.playApplause();
          break;
        case 4:
          adjustTimer(10);
          break;
        case 5:
          adjustTimer(-10);
          break;
        case 6:
          togglePause();
          break;
      }
    },
    [audio, adjustTimer, togglePause, advanceStep, stepBack],
  );
  const runHostCommandRef = useRef(runHostCommand);
  runHostCommandRef.current = runHostCommand;

  // חיבור ה-ReplayAdapter כמקור הצבעות: סינון שלט המנחה + הקפאה בעצירה
  const hostVoterIdRef = useRef(hostVoterId);
  hostVoterIdRef.current = hostVoterId;
  useEffect(() => {
    adapter.onVoteSnapshot((incoming) => {
      let snapshot = incoming;
      if (hostVoterIdRef.current !== '') {
        const extraction = extractHostVote(incoming, hostVoterIdRef.current);
        snapshot = extraction.snapshot;
        if (extraction.hostAnswer !== null && extraction.hostAnswer !== lastHostAnswerRef.current) {
          lastHostAnswerRef.current = extraction.hostAnswer;
          runHostCommandRef.current(extraction.hostAnswer);
        }
      }
      // אכיפת מגבלת הרישיון: מסננים ל-N המשתתפים המורשים בלבד, ובונים מחדש את
      // המונים/סה"כ מתוכם — כך שהצבעות מעבר לרישיון לא נספרות ולא משפיעות על הניקוד.
      if (snapshot.voters) {
        const voters: Record<string, number> = {};
        const counts: Record<string, number> = {};
        let total = 0;
        for (const [voterId, answerId] of Object.entries(snapshot.voters)) {
          if (!admitRef.current(voterId)) continue;
          voters[voterId] = answerId;
          counts[String(answerId)] = (counts[String(answerId)] ?? 0) + 1;
          total += 1;
        }
        snapshot = { ...snapshot, voters, counts, total };
      }
      // מסך התחברות לקבוצות פעיל: ההקשות הן שיוך לקבוצה לפי מספר, לא הצבעה לשאלה
      const connectCat = connectCategoryRef.current;
      if (connectCat !== null) {
        if (snapshot.voters) applyGroupPressesRef.current(connectCat, snapshot.voters);
        return;
      }
      // בזמן עצירה (פקודה 6) אין קליטת הצבעות
      if (pausedRef.current) return;
      // צובר את ה-snapshot המצטבר; העדכון למנוע/UI מוגבל בקצב (leading+trailing)
      pendingVoteRef.current = snapshot;
      scheduleVoteFlushRef.current();
    });
    if (adapter instanceof SocketVoteAdapter) {
      // שרת אמיתי: סטטוס חיבור + מיפוי אוטומטי של שם השחקן מהטלפון + לובי
      adapter.onStatusChange(setVoteStatus);
      adapter.onPlayerIdentified((phone, name) =>
        setServerNames((prev) => (prev[phone] === name ? prev : { ...prev, [phone]: name })),
      );
      adapter.onPlayerJoined((phone, name) => addConnected(phone, name));
      void adapter.connect(roomId);
    } else {
      setVoteStatus('connected');
      void adapter.connect('replay');
    }
    return () => adapter.disconnect();
  }, [adapter, engine, roomId, addConnected]);

  // ווליום
  useEffect(() => audio.setVolume(volume), [audio, volume]);

  // סוף המשחק במנוע → מסך זוכים
  useEffect(() => {
    if (stage === 'playing' && state.phase === 'ended') {
      setLeadersOverlay(false);
      setStage('winners');
    }
  }, [stage, state.phase]);

  // קהל סינתטי: מזרים snapshots מצטברים בזמן הצבעה, לפי קונפיגורציית הדמו
  useEffect(() => {
    if (!votingActive || !syntheticCrowd) return;
    if (!(adapter instanceof ReplayAdapter)) return; // רק במצב דמו
    const replay = adapter;
    const plan = planCrowdVotes(slide, {
      voterCount: crowdConfig.voterCount,
      speedFactor: crowdConfig.speedFactor,
      correctBias: crowdConfig.correctBias,
    });
    const openedAt = Date.now();
    let seq = Date.now(); // seq גדל בין חלונות הצבעה חוזרים של אותה שקופית
    const interval = window.setInterval(() => {
      if (pausedRef.current) return; // הזמן קפוא בעצירה
      const elapsed = Date.now() - openedAt - pausedAccumMsRef.current;
      replay.emit(snapshotAt(plan, slide.id, elapsed, ++seq));
    }, crowdConfig.intervalMs);
    return () => window.clearInterval(interval);
  }, [votingActive, state.currentSlideId, syntheticCrowd, adapter, slide, crowdConfig]);

  // שרת אמיתי (סוקט): פותח חלון הצבעה בגבולות ההצבעה של השקופית, וגם בזמן מסך
  // ההתחברות לקבוצות — כדי שהקשות השחקנים יתקבלו תמיד (גם בין שאלה לשאלה), לא
  // רק בזמן הצבעה על שאלה. אחרת השרת שולח הקשות אך הן נזרקות (אין חלון פתוח).
  useEffect(() => {
    if (!(adapter instanceof SocketVoteAdapter)) return;
    const windowOpen = votingActive || connectCategory !== null;
    adapter.setActiveSlide(windowOpen ? slide.id : null);
  }, [adapter, votingActive, connectCategory, slide.id]);

  // לובי בדמו: מדמה שחקנים שמתחברים בזמן מסך ההתחברות (באונליין ההתחברות
  // אמיתית דרך player/joined מהסוקט).
  useEffect(() => {
    if (stage !== 'opening' || !syntheticCrowd) return;
    const max = Math.min(crowdConfig.voterCount, 80);
    let i = 0;
    const interval = window.setInterval(() => {
      i += 1;
      if (i > max) {
        window.clearInterval(interval);
        return;
      }
      addConnected(`משתתף ${i}`);
    }, 140);
    return () => window.clearInterval(interval);
  }, [stage, syntheticCrowd, crowdConfig.voterCount, addConnected]);

  // automaticSkip: מעבר אוטומטי אחרי X שניות כשאין מדיה פעילה
  useEffect(() => {
    if (stage !== 'playing' || state.activeMedia !== null) return;
    const skip = slide.setting.automaticSkip;
    const waiting =
      state.phase === 'results' || (state.phase === 'showing' && !isVotableSlide(slide));
    if (!skip.active || !waiting) return;
    const timeout = window.setTimeout(
      () => engine.dispatch({ type: 'ADVANCE', at: Date.now() }),
      Math.max(1, skip.seconds) * 1000,
    );
    return () => window.clearTimeout(timeout);
  }, [stage, state.phase, state.activeMedia, state.currentSlideId, engine, slide]);

  // -------------------------------------------------------------------------
  // מעברים אוטומטיים (autoTransition) — מבצע אוטומטית את השלב הבא לפי הדגלים:
  // הצגת השאלה+תשובות · פתיחת הטיימר · חשיפת התשובה הנכונה · מעבר לשקופית הבאה.
  // בכל רגע נבחרת פעולה אחת; לחיצת מפעיל ידנית פשוט מקדימה את אותה פעולה.
  // -------------------------------------------------------------------------
  const autoT = settings.autoTransition;
  useEffect(() => {
    if (stage !== 'playing' || state.activeMedia !== null) return;
    const s = engine.getCurrentSlide();
    const votable = isVotableSlide(s);
    const totalAnswers = s.question.answers.length;

    let action: (() => void) | null = null;
    let label = '';
    let delayMs = AUTO_STEP_MS;

    if (state.phase === 'showing' && votable) {
      if (autoT.showAnswersAfterQuestion && !reveal.questionShown) {
        label = 'הצגת השאלה';
        action = () => {
          setReveal((r) => ({ ...r, questionShown: true }));
          audio.play('showQuestion', sounds.showQuestionMediaSound.src);
        };
      } else if (autoT.showAnswersAfterQuestion && reveal.questionShown && reveal.answersShown < totalAnswers) {
        label = 'חשיפת תשובה';
        action = () => setReveal((r) => ({ ...r, answersShown: r.answersShown + 1 }));
      } else if (autoT.startTimerAfterLastAnswer && reveal.questionShown && reveal.answersShown >= totalAnswers) {
        label = 'פתיחת הצבעה + טיימר';
        action = () => engine.dispatch({ type: 'OPEN_VOTING', at: Date.now() });
      }
    } else if (state.phase === 'showing' && !votable) {
      if (autoT.nextSlide.active) {
        label = 'שקופית הבאה';
        action = () => engine.dispatch({ type: 'ADVANCE', at: Date.now() });
        delayMs = Math.max(1, autoT.nextSlide.seconds) * 1000;
      }
    } else if (state.phase === 'results') {
      const isTrivia = s.type === 'trivia';
      if (autoT.showCorrectAnswerAfterTimer && isTrivia && !reveal.revealCorrect) {
        label = 'חשיפת התשובה הנכונה';
        action = () => {
          setReveal((r) => ({ ...r, revealCorrect: true }));
          audio.play('inShowAns', sounds.inShowAnsMediaSound.src);
        };
      } else if (autoT.nextSlide.active && (!isTrivia || reveal.revealCorrect)) {
        label = 'שקופית הבאה';
        action = () => engine.dispatch({ type: 'ADVANCE', at: Date.now() });
        delayMs = Math.max(1, autoT.nextSlide.seconds) * 1000;
      }
    }

    if (action === null) return;
    const fire = action;
    const desc = label;
    const timeout = window.setTimeout(() => {
      debugLog('auto', `מעבר אוטומטי: ${desc}`, { delayMs });
      fire();
    }, delayMs);
    return () => window.clearTimeout(timeout);
  }, [stage, state.phase, state.currentSlideId, state.activeMedia, reveal, autoT, engine, audio, sounds]);

  // -------------------------------------------------------------------------
  // סאונד לפי מצב (SPEC סעיף 9): התחברות / מנצחים / רשימת זוכים / מובילים
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (stage === 'opening') {
      audio.play('playersConnecting', sounds.playersConnectingMediaSound.src, { loop: true });
      return () => audio.stop('playersConnecting');
    }
    if (stage === 'winners') {
      audio.play('winners', sounds.winnersMediaSound.src);
      return () => audio.stop('winners');
    }
    if (stage === 'winnersList') {
      audio.play('winnersList', sounds.winnersListMediaSound.src);
      return () => audio.stop('winnersList');
    }
    return undefined;
  }, [stage, audio, sounds]);

  // מסך מובילים באמצע המשחק (פקודה 1) — סאונד רשימת הזוכים
  useEffect(() => {
    if (!leadersOverlay) return;
    audio.play('winnersList', sounds.winnersListMediaSound.src);
    return () => audio.stop('winnersList');
  }, [leadersOverlay, audio, sounds]);

  // דמו: במסך התחברות קבוצות מדמים הצטרפויות אקראיות (בלי קליקר אמיתי) כדי
  // שאפשר יהיה להדגים ולבדוק את המסך. במשחק אמיתי ההקשות מגיעות מהסוקט.
  useEffect(() => {
    if (connectCategory === null || !syntheticCrowd) return;
    const timer = window.setInterval(() => {
      const cat = rosterRef.current.categories.find((c) => c.id === connectCategory);
      const groupCount = cat?.groups.length ?? 0;
      if (groupCount === 0) return;
      const voters: Record<string, number> = {};
      const batch = 3 + Math.floor(Math.random() * 6);
      for (let i = 0; i < batch; i++) {
        const voterId = String(1 + Math.floor(Math.random() * crowdConfig.voterCount));
        voters[voterId] = 1 + Math.floor(Math.random() * groupCount);
      }
      applyGroupPresses(connectCategory, voters);
    }, 500);
    return () => window.clearInterval(timer);
  }, [connectCategory, syntheticCrowd, crowdConfig.voterCount, applyGroupPresses]);

  // -------------------------------------------------------------------------
  // שליטת מפעיל: רווח/0 = השלב הבא, 2 = שלב אחורה, ספרות = פקודות מנחה,
  // Backspace = שקופית שלמה אחורה (עם אישור), ESC = תפריט
  // -------------------------------------------------------------------------

  useEffect(() => {
    const advance = () => {
      // מסך המובילים (מקש 1) פתוח מעל המשחק — רווח/קדימה מסירים אותו (כמו לחיצה
      // נוספת על 1) במקום לקדם את המשחק שמאחוריו.
      if (leadersOverlay) {
        setLeadersOverlay(false);
        return;
      }
      if (stage === 'opening') setStage('playing');
      else if (stage === 'playing') advanceStep();
      else if (stage === 'winners') setStage('winnersList');
    };
    // חזרה שלב אחד אחורה — עובדת בכל מצב: בשקופית (stepBack), וגם במסכי הסיום
    // (רשימת מובילים → מנצחים → חזרה למשחק).
    const goBack = () => {
      if (stage === 'playing') stepBack();
      else if (stage === 'winners') setStage('playing');
      else if (stage === 'winnersList') setStage('winners');
    };
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target;
      // הקלדה בשדות טופס לא נחשבת פקודה. (בודקים instanceof Element כי מטרת
      // אירוע מ-window יכולה להיות window עצמו — בלי closest.)
      if (target instanceof Element && target.closest('input, select, textarea')) return;
      // F12 — פתיחה/סגירה של חלונית הדיבוג (עובד תמיד, גם כשתפריט/הגדרות פתוחים)
      if (event.key === 'F12' || event.code === 'F12') {
        event.preventDefault();
        debugLog('command', 'F12 — החלפת חלונית דיבוג');
        setDebugOpen((open) => !open);
        return;
      }
      // צירופים עם Ctrl/Cmd/Alt שייכים לדפדפן (Ctrl+R לרענון, DevTools וכו') —
      // לא חוטפים אותם כדי שלא נחסום פעולות דפדפן בזמן המשחק.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // מסך התחברות קבוצות פתוח — חוסם שליטת מקלדת במשחק; Escape סוגר אותו
      if (connectCategory !== null) {
        if (event.key === 'Escape') setConnectCategory(null);
        return;
      }
      if (event.key === 'Escape') {
        if (rosterOpen) setRosterOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
        else setMenuOpen((open) => !open);
        return;
      }
      if (menuOpen || settingsOpen || rosterOpen) return;
      if (event.key >= '0' && event.key <= '6') {
        debugLog('command', `שלט: מקש ${event.key}`, { stage });
        // מסך מובילים פתוח — קדימה (0) מסיר אותו במקום לקדם את המשחק שמאחוריו
        if (leadersOverlay && event.key === '0') setLeadersOverlay(false);
        else if (event.key === '0' && stage !== 'playing') advance();
        // מקש 2 (אחורה) — עובד גם במסכי הזוכים/מובילים, לא רק בשקופית
        else if (event.key === '2' && stage !== 'playing') goBack();
        else runHostCommandRef.current(Number(event.key));
        return;
      }
      if (event.key === ' ' || event.key === 'Enter' || event.key === 'ArrowLeft') {
        event.preventDefault();
        debugLog('command', 'קדימה (רווח/Enter)', { stage });
        advance();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        debugLog('command', 'אחורה (חץ)', { stage });
        goBack();
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        if (stage === 'playing' && window.confirm('לחזור שקופית שלמה אחורה?')) {
          debugLog('command', 'BACK — שקופית שלמה אחורה');
          engine.dispatch({ type: 'BACK', at: Date.now() });
        }
      } else if (event.code === 'KeyR' || event.key === 'r' || event.key === 'R') {
        // רענון יזום של קובץ המשחק מהשרת (בלי לאבד ניקוד/מיקום)
        event.preventDefault();
        debugLog('command', 'R — רענון קובץ המשחק');
        onRequestRefresh?.();
      } else if (event.code === 'KeyW' || event.key === 'w' || event.key === 'W') {
        // תצוגה מקדימה של מסך המנצחים הסופי — ובלחיצה נוספת חזרה למיקום במשחק.
        // לפי event.code (מיקום פיזי) כדי שיעבוד גם בפריסת מקלדת עברית.
        event.preventDefault();
        debugLog('command', 'W — תצוגת מנצחים מקדימה');
        if (winnersPreviewRef.current !== null) {
          setStage(winnersPreviewRef.current);
          winnersPreviewRef.current = null;
        } else if (stage === 'playing') {
          winnersPreviewRef.current = 'playing';
          setLeadersOverlay(false);
          setStage('winners');
        }
      } else if (event.code === 'KeyN' || event.key === 'n' || event.key === 'N') {
        // הרצה מהירה — כל לחיצה מדלגת לשקופית הבאה, חשופה במלואה (מיקום פיזי)
        event.preventDefault();
        debugLog('command', 'N — הרצה מהירה');
        if (stage === 'playing') fastNextSlideRef.current();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [stage, menuOpen, settingsOpen, rosterOpen, leadersOverlay, connectCategory, engine, advanceStep, stepBack, onRequestRefresh]);

  // מסך מלא — כפתור בפינה (window resize מעדכן את סקייל הבמה אוטומטית)
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  }, []);

  // קליק עכבר אינו מקדם שלבים — קידום רק ברווח/0 (בקשת המנחה)
  return (
    <div
      className={`game-root${showJoinBanner ? ' has-banner' : ''}`}
      dir="rtl"
      style={themeStyle(setting)}
    >
      <Stage>
        {/* באנר הצטרפות עליון — משחק אונליין עם קוד חדר, לכל אורך המשחק */}
        {showJoinBanner && (
          <div className="join-banner">
            📞 להצטרפות למשחק חייגו <b>{JOIN_DIAL_NUMBER}</b> והקישו את קוד המשחק:{' '}
            <b className="join-banner-code">{roomId}</b>
            {showQrCode && <QrCode value={qrUrl} size={40} className="qr-banner" />}
          </div>
        )}

        {/* אזהרות איכות חיבור — מופיעות רק כשהחיבור באמת בעייתי */}
        {connectionWarnings.length > 0 && (
          <div className={`conn-warnings${showJoinBanner ? ' conn-warnings--below-banner' : ''}`}>
            {connectionWarnings.map((warning) => (
              <div key={warning.code} className={`conn-warning conn-warning--${warning.severity}`}>
                {warning.severity === 'error' ? '⛔' : '⚠️'} {warning.message}
              </div>
            ))}
          </div>
        )}
        {stage === 'opening' && (
          <LobbyScreen
            engine={engine}
            players={connectedPlayers}
            {...(showQrCode ? { qrUrl } : {})}
          />
        )}
        {stage === 'playing' && (
          <>
            <SlideView
              engine={engine}
              state={state}
              timer={timer}
              reveal={reveal}
              players={players}
              leaders={leaders}
            />
            {/* מיקום במשחק: שקופית נוכחית מתוך סה"כ */}
            <span className="slide-counter" dir="ltr">
              {state.currentSlideIndex + 1}/{engine.getGame().questions.length}
            </span>
          </>
        )}
        {stage === 'winners' && <WinnersScreen engine={engine} nameOf={nameOf} />}
        {stage === 'winnersList' && (
          <WinnersListScreen engine={engine} nameOf={nameOf} roster={roster} />
        )}

        {/* טבלת הניקוד באמצע משחק (פקודת מנחה 1) — מסך נפרד מלא מעל כל התצוגה */}
        {stage === 'playing' && leadersOverlay && (
          <div className="leaders-overlay">
            <WinnersListScreen engine={engine} nameOf={nameOf} roster={roster} />
          </div>
        )}

        {/* כפתורי פינה: מסך מלא + הגדרות + שמות וקבוצות */}
        <div className="corner-buttons">
          <button
            title={isFullscreen ? 'יציאה ממסך מלא' : 'מסך מלא'}
            onClick={toggleFullscreen}
          >
            {isFullscreen ? '🗗' : '⛶'}
          </button>
          <button title="הגדרות" onClick={() => setSettingsOpen((open) => !open)}>
            ⚙
          </button>
          <button title="שמות וקבוצות" onClick={() => setRosterOpen((open) => !open)}>
            👥
          </button>
        </div>

        {rosterOpen && (
          <RosterPanel
            roster={roster}
            onChange={updateRoster}
            onClose={() => setRosterOpen(false)}
            onOpenConnect={(categoryId) => {
              setConnectCategory(categoryId);
              setRosterOpen(false);
            }}
          />
        )}

        {/* מסך התחברות לקבוצות — מסך מלא; ההקשות מצרפות שחקנים לקבוצה לפי מספר */}
        {connectCategory !== null &&
          (() => {
            const cat = roster.categories.find((c) => c.id === connectCategory);
            if (!cat) return null;
            return (
              <GroupConnectScreen
                categoryName={cat.name || 'קטגוריה'}
                groups={cat.groups}
                counts={groupCounts(roster, connectCategory)}
                total={categoryMemberTotal(roster, connectCategory)}
                onReset={() => updateRoster(resetCategoryMemberships(roster, connectCategory))}
                onClose={() => setConnectCategory(null)}
              />
            );
          })()}

        {/* אזהרת רישיון — משחק אונליין בלי קוד חדר: אפשר להריץ רק עם שחקני דמה */}
        {showLicenseWarning && !licenseAck && (
          <div className="license-modal">
            <div className="license-modal-box">
              <div className="license-modal-icon">🔒</div>
              <h2>אין רישיון פעיל</h2>
              <p>למשחק זה אין קוד חדר — ניתן להפעיל אותו רק עם שחקני דמה.</p>
              <button onClick={() => setLicenseAck(true)}>הבנתי</button>
            </div>
          </div>
        )}

        {/* גיבוי חי נמצא — התאוששות מקריסה/רענון */}
        {resumePrompt !== null && (
          <div className="license-modal">
            <div className="license-modal-box">
              <div className="license-modal-icon">💾</div>
              <h2>נמצא משחק פעיל</h2>
              <p>קיים גיבוי של המשחק. להמשיך מהנקודה שנשמרה, או להתחיל משחק חדש?</p>
              <div className="resume-actions">
                <button onClick={() => resumeFromBackup(resumePrompt)}>▶ המשך מהנקודה</button>
                <button className="resume-new" onClick={() => setResumePrompt(null)}>
                  משחק חדש
                </button>
              </div>
            </div>
          </div>
        )}

        <span
          className={`status-dot status-dot--${useSocket ? voteStatus : 'connected'}`}
          title={
            syntheticCrowd
              ? `מצב דמו: ${crowdConfig.voterCount} שחקני דמה`
              : useSocket
                ? `שרת הצבעות · חדר ${roomId} · ${
                    voteStatus === 'connected'
                      ? 'מחובר'
                      : voteStatus === 'reconnecting'
                        ? 'מתחבר מחדש…'
                        : 'מנותק'
                  }`
                : 'אין מקור הצבעות (אין קוד חדר במשחק)'
          }
        />
        {syntheticCrowd && (
          <span className="demo-badge">
            דמו · {crowdConfig.voterCount.toLocaleString()} שחקנים
            {hostVoterId !== '' && ` · שלט מנחה: ${hostVoterId}`}
          </span>
        )}

        {settingsOpen && (
          <SettingsScreen
            game={game}
            initial={settings}
            mode="ingame"
            allowDemo={allowDemo}
            qrAvailable={qrAvailable}
            onSave={(saved) => {
              onSettingsChange(saved);
              setSettingsOpen(false);
            }}
          />
        )}

        {menuOpen && (
          <OperatorMenu
            engine={engine}
            state={state}
            volume={volume}
            onVolumeChange={setVolume}
            syntheticCrowd={syntheticCrowd}
            onSyntheticCrowdChange={(on) => onSettingsChange({ ...settings, crowdEnabled: on })}
            hostVoterId={hostVoterId}
            onEndGame={() => {
              setLeadersOverlay(false);
              setStage('winners');
              setMenuOpen(false);
            }}
            onClose={() => setMenuOpen(false)}
          />
        )}

        {debugOpen && (
          <DebugOverlay
            onClose={() => setDebugOpen(false)}
            info={[
              { label: 'מצב', value: `${stage} · ${state.phase}` },
              {
                label: 'שקופית',
                value: `${state.currentSlideIndex + 1}/${engine.getGame().questions.length} · ${slide.type}`,
              },
              {
                label: 'טיימר',
                value: timer
                  ? `${timer.remaining.toFixed(1)}ש׳ / ${timer.total}ש׳${timer.paused ? ' ⏸' : ''}`
                  : '—',
              },
              { label: 'הצבעות', value: String(state.liveVotes?.total ?? 0) },
              {
                label: 'חשיפה',
                value: `שאלה ${reveal.questionShown ? '✓' : '✗'} · תשובות ${reveal.answersShown} · נכונה ${reveal.revealCorrect ? '✓' : '✗'}`,
              },
              {
                label: 'מקור הצבעות',
                value: syntheticCrowd
                  ? `דמו · ${crowdConfig.voterCount}`
                  : hasRoom
                    ? `אונליין · חדר ${roomId}`
                    : 'אין',
              },
              { label: 'חיבור', value: useSocket ? voteStatus : syntheticCrowd ? 'דמו (מקומי)' : '—' },
            ]}
          />
        )}
      </Stage>
    </div>
  );
}
