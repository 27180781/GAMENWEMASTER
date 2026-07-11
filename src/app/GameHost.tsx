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
import { displayName, loadRoster, saveRoster, type RosterData } from './roster.ts';
import { planCrowdVotes, snapshotAt } from './syntheticVotes.ts';
import type { GameSettings } from './urlParams.ts';
import { useEngineState } from './useEngineState.ts';

type HostStage = 'opening' | 'playing' | 'winners' | 'winnersList';

const NO_REVEAL: RevealState = { questionShown: false, answersShown: 0, revealCorrect: false };

/** מספר המצטרפים המרבי שמוצג במסילה בכל רגע. */
const RAIL_MAX = 9;
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
}

export function GameHost({
  game,
  settings,
  onSettingsChange,
  onRequestRefresh,
  voteServerUrl,
}: GameHostProps) {
  // המנוע נוצר פעם אחת; רענון תוכן מתבצע דרך engine.updateGame בלי remount,
  // כדי לשמר את מהלך המשחק (ניקוד/מיקום). ראו useEffect על שינוי game למטה.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const engine = useMemo(() => new GameEngine(game), []);
  // מקור ההצבעות: שרת הסוקט האמיתי במשחק אונליין (יש קוד חדר ואין שחקני דמה),
  // אחרת ReplayAdapter (דמו/סינתטי, וגם אופליין — בלי רשת).
  const roomId = game.room ?? '';
  const useSocket = !settings.crowdEnabled && roomId !== '';
  const adapter = useMemo<VoteAdapter>(
    () => (useSocket ? new SocketVoteAdapter(voteServerUrl) : new ReplayAdapter()),
    [useSocket, voteServerUrl],
  );
  const audio = useMemo(() => new AudioManager(), []);
  const state = useEngineState(engine);

  const [stage, setStage] = useState<HostStage>('opening');
  const [menuOpen, setMenuOpen] = useState(false);
  /** מסך ההגדרות באמצע משחק (כפתור ⚙) — שכבה מעל; מצב המשחק נשמר. */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** לשונית "שמות וקבוצות" — מרשם השחקנים, נגיש לכל אורך המשחק. */
  const [rosterOpen, setRosterOpen] = useState(false);
  const [roster, setRoster] = useState<RosterData>(() => loadRoster(game.id));
  const updateRoster = useCallback(
    (next: RosterData) => {
      setRoster(next);
      saveRoster(game.id, next);
    },
    [game.id],
  );
  /** שמות שהגיעו מהשרת (טלפון → שם שחקן) — מיפוי אוטומטי במשחק טלפונים. */
  const [serverNames, setServerNames] = useState<Record<string, string>>({});
  /** סטטוס החיבור לשרת ההצבעות (רלוונטי רק במשחק אונליין אמיתי). */
  const [voteStatus, setVoteStatus] = useState<'connected' | 'reconnecting' | 'offline'>(
    'offline',
  );
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
  const [timer, setTimer] = useState<TimerView | null>(null);
  /** שלבי החשיפה של השקופית הנוכחית (שאלה / תשובות / תשובה נכונה). */
  const [reveal, setReveal] = useState<RevealState>(NO_REVEAL);
  /** מזהי המצביעים האחרונים בשקופית הנוכחית (החדש ראשון) — למסילת המצטרפים. */
  const [answerers, setAnswerers] = useState<string[]>([]);
  const players = useMemo<RailPlayer[]>(
    () =>
      answerers.map((id) => {
        const name = nameOf(id);
        return { id, name, initial: railInitial(name), color: RAIL_COLORS[hashId(id) % RAIL_COLORS.length]! };
      }),
    [answerers, nameOf],
  );
  /** כל מי שהתחבר למשחק (לחץ מקש) — למסך הלובי. סדר הצטרפות. */
  const [connectedIds, setConnectedIds] = useState<string[]>([]);
  const addConnected = useCallback((id: string, name?: string) => {
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

  const stageRef = useRef<HostStage>('opening');
  stageRef.current = stage;
  const revealRef = useRef<RevealState>(reveal);
  revealRef.current = reveal;

  // איפוס שלבי חשיפה + מסילת המצטרפים + זיהוי הקשת שלט המנחה, במעבר שקופית
  useEffect(() => {
    setReveal(NO_REVEAL);
    setAnswerers([]);
    lastHostAnswerRef.current = null;
  }, [state.currentSlideId]);

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

  useEffect(() => {
    if (!votingActive) {
      setTimer(null);
      pausedRef.current = false;
      pausedRemainingMsRef.current = null;
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
      // בזמן עצירה (פקודה 6) אין קליטת הצבעות
      if (pausedRef.current) return;
      engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot, at: Date.now() });
      // עדכון מסילת המצטרפים — מזהים חדשים בראש הרשימה
      const voters = snapshot.voters;
      if (voters) {
        setAnswerers((prev) => {
          const seen = new Set(prev);
          const additions = Object.keys(voters).filter((id) => !seen.has(id));
          if (additions.length === 0) return prev;
          return [...additions.reverse(), ...prev].slice(0, RAIL_MAX);
        });
      }
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

  // שרת אמיתי (סוקט): פותח חלון הצבעה בדיוק בגבולות ההצבעה של השקופית, וסוגר
  // בסיומה — כך נספרות רק ההצבעות של השקופית הנוכחית בזמן שהחלון פתוח.
  useEffect(() => {
    if (!(adapter instanceof SocketVoteAdapter)) return;
    adapter.setActiveSlide(votingActive ? slide.id : null);
  }, [adapter, votingActive, slide.id]);

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

  // -------------------------------------------------------------------------
  // שליטת מפעיל: רווח/0 = השלב הבא, 2 = שלב אחורה, ספרות = פקודות מנחה,
  // Backspace = שקופית שלמה אחורה (עם אישור), ESC = תפריט
  // -------------------------------------------------------------------------

  useEffect(() => {
    const advance = () => {
      if (stage === 'opening') setStage('playing');
      else if (stage === 'playing') advanceStep();
      else if (stage === 'winners') setStage('winnersList');
    };
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, select, textarea')) return; // הקלדה בטפסים
      if (event.key === 'Escape') {
        if (rosterOpen) setRosterOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
        else setMenuOpen((open) => !open);
        return;
      }
      if (menuOpen || settingsOpen || rosterOpen) return;
      if (event.key >= '0' && event.key <= '6') {
        if (event.key === '0' && stage !== 'playing') advance();
        else runHostCommandRef.current(Number(event.key));
        return;
      }
      if (event.key === ' ' || event.key === 'Enter' || event.key === 'ArrowLeft') {
        event.preventDefault();
        advance();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (stage === 'playing') stepBack();
        else if (stage === 'winners') setStage('playing');
        else if (stage === 'winnersList') setStage('winners');
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        if (stage === 'playing' && window.confirm('לחזור שקופית שלמה אחורה?')) {
          engine.dispatch({ type: 'BACK', at: Date.now() });
        }
      } else if (event.key === 'r' || event.key === 'R') {
        // רענון יזום של קובץ המשחק מהשרת (בלי לאבד ניקוד/מיקום)
        event.preventDefault();
        onRequestRefresh?.();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [stage, menuOpen, settingsOpen, rosterOpen, engine, advanceStep, stepBack, onRequestRefresh]);

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
    <div className="game-root" dir="rtl" style={themeStyle(setting)}>
      <Stage>
        {stage === 'opening' && <LobbyScreen engine={engine} players={connectedPlayers} />}
        {stage === 'playing' && (
          <>
            <SlideView engine={engine} state={state} timer={timer} reveal={reveal} players={players} />
            {/* מיקום במשחק: שקופית נוכחית מתוך סה"כ */}
            <span className="slide-counter" dir="ltr">
              {state.currentSlideIndex + 1}/{engine.getGame().questions.length}
            </span>
          </>
        )}
        {stage === 'winners' && <WinnersScreen engine={engine} nameOf={nameOf} />}
        {stage === 'winnersList' && <WinnersListScreen engine={engine} nameOf={nameOf} />}

        {/* מסך מובילים באמצע משחק (פקודת מנחה 1) — שכבה מעל, המשחק ממשיך מתחת */}
        {stage === 'playing' && leadersOverlay && (
          <WinnersListScreen engine={engine} nameOf={nameOf} />
        )}

        {/* לשונית "שמות וקבוצות" — נגישה לכל אורך המשחק */}
        <button
          className="roster-tab"
          title="שמות וקבוצות"
          onClick={() => setRosterOpen((open) => !open)}
        >
          👥 שמות וקבוצות
        </button>

        {/* כפתורי פינה: מסך מלא + הגדרות (תפריט המפעיל) */}
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
          />
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
      </Stage>
    </div>
  );
}
