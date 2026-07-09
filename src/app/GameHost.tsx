/**
 * GameHost — שכבת ה-host שסביב המנוע (SPEC סעיפים 1, 5, 9):
 * מריצה את הטיימרים (המנוע עצמו חסר שעון), מזרימה קהל סינתטי דרך
 * ReplayAdapter, מנהלת מקלדת/סאונד/מסכי מסגרת, תפריט מפעיל ופקודות מנחה.
 *
 * זרימת שלבים בשקופית שאלה — כל מעבר ברווח (מקלדת) או 0 (שלט מנחה/טלפון):
 *   כניסה לשקופית → [מדיית פתיחה] → הצגת השאלה → חשיפת כל תשובה בלחיצה
 *   (חשיפת האחרונה פותחת הצבעה וטיימר) → עצירת הטיימר (אם לא נגמר לבד)
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
} from '../engine/index.ts';
import { OpeningScreen, WinnersListScreen, WinnersScreen } from '../render/screens.tsx';
import { OperatorMenu } from '../render/OperatorMenu.tsx';
import type { RevealState } from '../render/QuestionSlide.tsx';
import { SlideView } from '../render/SlideView.tsx';
import { Stage } from '../render/Stage.tsx';
import { themeStyle } from '../render/theme.ts';
import type { TimerView } from '../render/TimerRing.tsx';
import { AudioManager } from './AudioManager.ts';
import { extractHostVote } from './hostRemote.ts';
import { planCrowdVotes, snapshotAt } from './syntheticVotes.ts';
import { DEFAULT_DEMO_CONFIG, type DemoConfig } from './urlParams.ts';
import { useEngineState } from './useEngineState.ts';

type HostStage = 'opening' | 'playing' | 'winners' | 'winnersList';

const NO_REVEAL: RevealState = { questionShown: false, answersShown: 0, revealCorrect: false };

interface GameHostProps {
  game: GameFile;
  /** מצב דמו: הצבעות משחקני דמה לפי הקונפיגורציה, במקום מהסוקט (M3). */
  demo?: DemoConfig | null;
}

export function GameHost({ game, demo = null }: GameHostProps) {
  const engine = useMemo(() => new GameEngine(game), [game]);
  const adapter = useMemo(() => new ReplayAdapter(), []);
  const audio = useMemo(() => new AudioManager(), []);
  const state = useEngineState(engine);

  const [stage, setStage] = useState<HostStage>('opening');
  const [menuOpen, setMenuOpen] = useState(false);
  const [volume, setVolume] = useState(1);
  // בלי דמו — ההצבעות יגיעו מהסוקט (M3); המפעיל יכול להדליק קהל דמה מהתפריט
  const [syntheticCrowd, setSyntheticCrowd] = useState(demo !== null);
  /** מסך מובילים באמצע משחק (פקודת מנחה 1) — שכבה מעל, המשחק ממשיך מתחת. */
  const [leadersOverlay, setLeadersOverlay] = useState(false);
  const [timer, setTimer] = useState<TimerView | null>(null);
  /** שלבי החשיפה של השקופית הנוכחית (שאלה / תשובות / תשובה נכונה). */
  const [reveal, setReveal] = useState<RevealState>(NO_REVEAL);

  const crowdConfig = demo ?? DEFAULT_DEMO_CONFIG;
  const hostVoterId = demo?.hostVoterId.trim() ?? '';

  const slide = engine.getCurrentSlide();
  const setting = engine.getGame().setting;
  const sounds = setting.sound;

  const stageRef = useRef<HostStage>('opening');
  stageRef.current = stage;
  const revealRef = useRef<RevealState>(reveal);
  revealRef.current = reveal;

  // איפוס שלבי חשיפה במעבר שקופית
  useEffect(() => {
    setReveal(NO_REVEAL);
  }, [state.currentSlideId]);

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

    // מדיה מתנגנת — הלחיצה מדלגת עליה
    if (current.activeMedia !== null) {
      engine.dispatch({ type: 'MEDIA_ENDED', at: now });
      return;
    }

    if (current.phase === 'showing' && isVotableSlide(s)) {
      // שלב מדיית הפתיחה
      if (s.openMedia.src !== '' && !current.openMediaPlayed) {
        engine.dispatch({ type: 'ADVANCE', at: now });
        return;
      }
      // שלב הצגת השאלה
      if (!revealRef.current.questionShown) {
        setReveal((r) => ({ ...r, questionShown: true }));
        audio.play('showQuestion', sounds.showQuestionMediaSound.src);
        return;
      }
      // שלב חשיפת התשובות — האחרונה פותחת את ההצבעה והטיימר
      const totalAnswers = s.question.answers.length;
      if (revealRef.current.answersShown < totalAnswers) {
        const next = revealRef.current.answersShown + 1;
        setReveal((r) => ({ ...r, answersShown: next }));
        if (next === totalAnswers) engine.dispatch({ type: 'OPEN_VOTING', at: now });
        return;
      }
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

  /** צעד אחד אחורה בכל שלב — מקש 2; בתחילת שקופית חוזר לשקופית הקודמת. */
  const stepBack = useCallback(() => {
    const current = engine.getState();
    const s = engine.getCurrentSlide();
    const now = Date.now();

    if (current.phase === 'ended') {
      engine.dispatch({ type: 'BACK', at: now });
      return;
    }
    // מדיה מתנגנת — הלחיצה סוגרת אותה
    if (current.activeMedia !== null) {
      engine.dispatch({ type: 'MEDIA_ENDED', at: now });
      return;
    }
    if (current.phase === 'results') {
      if (revealRef.current.revealCorrect) {
        setReveal((r) => ({ ...r, revealCorrect: false }));
        return;
      }
      // חזרה לשלב שלפני ההצבעה: כניסה מחדש לשקופית עם הכל חשוף
      engine.dispatch({ type: 'GOTO', slideId: s.id, at: now });
      setReveal({ questionShown: true, answersShown: s.question.answers.length, revealCorrect: false });
      return;
    }
    if (current.phase === 'voting') {
      engine.dispatch({ type: 'GOTO', slideId: s.id, at: now });
      setReveal({
        questionShown: true,
        answersShown: Math.max(0, s.question.answers.length - 1),
        revealCorrect: false,
      });
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
  }, [engine]);

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
    });
    void adapter.connect('replay');
    return () => adapter.disconnect();
  }, [adapter, engine]);

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
      adapter.emit(snapshotAt(plan, slide.id, elapsed, ++seq));
    }, crowdConfig.intervalMs);
    return () => window.clearInterval(interval);
  }, [votingActive, state.currentSlideId, syntheticCrowd, adapter, slide, crowdConfig]);

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
        setMenuOpen((open) => !open);
        return;
      }
      if (menuOpen) return;
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
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [stage, menuOpen, engine, advanceStep, stepBack]);

  const handleClick = (event: React.MouseEvent) => {
    if (menuOpen) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input, select, textarea, a')) return;
    if (stage === 'opening') setStage('playing');
    else if (stage === 'playing' && !leadersOverlay) advanceStep();
    else if (stage === 'winners') setStage('winnersList');
  };

  return (
    <div className="game-root" dir="rtl" style={themeStyle(setting)} onClick={handleClick}>
      <Stage>
        {stage === 'opening' && <OpeningScreen engine={engine} />}
        {stage === 'playing' && (
          <SlideView engine={engine} state={state} timer={timer} reveal={reveal} />
        )}
        {stage === 'winners' && <WinnersScreen engine={engine} />}
        {stage === 'winnersList' && <WinnersListScreen engine={engine} />}

        {/* מסך מובילים באמצע משחק (פקודת מנחה 1) — שכבה מעל, המשחק ממשיך מתחת */}
        {stage === 'playing' && leadersOverlay && <WinnersListScreen engine={engine} />}

        <span
          className="status-dot status-dot--connected"
          title={
            demo !== null
              ? `מצב דמו: ${crowdConfig.voterCount} שחקני דמה`
              : 'מקור הצבעות: Replay (סוקט יגיע ב-M3)'
          }
        />
        {demo !== null && (
          <span className="demo-badge">
            דמו · {crowdConfig.voterCount.toLocaleString()} שחקנים
            {hostVoterId !== '' && ` · שלט מנחה: ${hostVoterId}`}
          </span>
        )}

        {menuOpen && (
          <OperatorMenu
            engine={engine}
            state={state}
            volume={volume}
            onVolumeChange={setVolume}
            syntheticCrowd={syntheticCrowd}
            onSyntheticCrowdChange={setSyntheticCrowd}
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
