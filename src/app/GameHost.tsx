/**
 * GameHost — שכבת ה-host שסביב המנוע (SPEC סעיפים 1, 5, 9):
 * מריצה את הטיימרים (המנוע עצמו חסר שעון), מזרימה קהל סינתטי דרך
 * ReplayAdapter, מנהלת מקלדת/סאונד/מסכי מסגרת ותפריט מפעיל.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GameEngine,
  ReplayAdapter,
  isVotableSlide,
  type GameFile,
} from '../engine/index.ts';
import { OpeningScreen, WinnersListScreen, WinnersScreen } from '../render/screens.tsx';
import { OperatorMenu } from '../render/OperatorMenu.tsx';
import { SlideView } from '../render/SlideView.tsx';
import { themeStyle } from '../render/theme.ts';
import { AudioManager } from './AudioManager.ts';
import { planCrowdVotes, snapshotAt } from './syntheticVotes.ts';
import { useEngineState } from './useEngineState.ts';

type Stage = 'opening' | 'playing' | 'winners' | 'winnersList';

export function GameHost({ game }: { game: GameFile }) {
  const engine = useMemo(() => new GameEngine(game), [game]);
  const adapter = useMemo(() => new ReplayAdapter(), []);
  const audio = useMemo(() => new AudioManager(), []);
  const state = useEngineState(engine);

  const [stage, setStage] = useState<Stage>('opening');
  const [menuOpen, setMenuOpen] = useState(false);
  const [volume, setVolume] = useState(1);
  const [syntheticCrowd, setSyntheticCrowd] = useState(true);
  const [timer, setTimer] = useState<{ remaining: number; total: number } | null>(null);
  const snapshotSeqRef = useRef(0);

  const slide = engine.getCurrentSlide();
  const setting = engine.getGame().setting;
  const sounds = setting.sound;

  // חיבור ה-ReplayAdapter כמקור הצבעות
  useEffect(() => {
    adapter.onVoteSnapshot((snapshot) => {
      engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot, at: Date.now() });
    });
    void adapter.connect('replay');
    return () => adapter.disconnect();
  }, [adapter, engine]);

  // ווליום
  useEffect(() => audio.setVolume(volume), [audio, volume]);

  // סוף המשחק במנוע → מסך זוכים
  useEffect(() => {
    if (stage === 'playing' && state.phase === 'ended') setStage('winners');
  }, [stage, state.phase]);

  // טיימר חלון ההצבעה: ספירה לאחור → VOTING_TIMEOUT (+סאונד טיימר)
  useEffect(() => {
    if (stage !== 'playing' || state.phase !== 'voting') {
      setTimer(null);
      return;
    }
    const total = slide.question.timeForQue;
    const deadline = Date.now() + total * 1000;
    setTimer({ remaining: total, total });
    audio.play('timer', sounds.timerMediaSound.src, { loop: true });

    const interval = window.setInterval(() => {
      const remaining = (deadline - Date.now()) / 1000;
      if (remaining <= 0) {
        engine.dispatch({ type: 'VOTING_TIMEOUT', at: Date.now() });
      } else {
        setTimer({ remaining, total });
      }
    }, 200);
    return () => {
      window.clearInterval(interval);
      audio.stop('timer');
    };
    // מפתח על השקופית והפאזה — פתיחה מחדש מאתחלת את הספירה
  }, [stage, state.phase, state.currentSlideId, engine, audio, slide, sounds]);

  // קהל סינתטי: מזרים snapshots מצטברים כל ~300ms בזמן הצבעה
  useEffect(() => {
    if (stage !== 'playing' || state.phase !== 'voting' || !syntheticCrowd) return;
    const plan = planCrowdVotes(slide);
    const openedAt = Date.now();
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - openedAt;
      adapter.emit(snapshotAt(plan, slide.id, elapsed, ++snapshotSeqRef.current));
    }, 300);
    return () => window.clearInterval(interval);
  }, [stage, state.phase, state.currentSlideId, syntheticCrowd, adapter, slide]);

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

  // סאונד לפי מצב
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

  // סאונד הצגת שאלה + סאונד חשיפת תשובה (פעם אחת לכל שקופית)
  const questionSoundPlayedRef = useRef<number | null>(null);
  const answerSoundPlayedRef = useRef<number | null>(null);
  useEffect(() => {
    if (stage !== 'playing' || state.activeMedia !== null || !isVotableSlide(slide)) return;
    if (
      (state.phase === 'showing' || state.phase === 'voting') &&
      questionSoundPlayedRef.current !== slide.id
    ) {
      questionSoundPlayedRef.current = slide.id;
      audio.play('showQuestion', sounds.showQuestionMediaSound.src);
    }
    if (
      state.phase === 'results' &&
      slide.type === 'trivia' &&
      answerSoundPlayedRef.current !== slide.id
    ) {
      answerSoundPlayedRef.current = slide.id;
      audio.play('inShowAns', sounds.inShowAnsMediaSound.src);
    }
  }, [stage, state.phase, state.activeMedia, state.currentSlideId, audio, slide, sounds]);

  // שליטת מפעיל: רווח/חצים/קליק = ADVANCE, אחורה עם אישור, ESC = תפריט
  useEffect(() => {
    const advance = () => {
      if (stage === 'opening') setStage('playing');
      else if (stage === 'playing') engine.dispatch({ type: 'ADVANCE', at: Date.now() });
      else if (stage === 'winners') setStage('winnersList');
    };
    const back = () => {
      if (stage === 'playing') {
        if (window.confirm('לחזור שקופית אחורה?')) {
          engine.dispatch({ type: 'BACK', at: Date.now() });
        }
      } else if (stage === 'winners') {
        setStage('playing');
      } else if (stage === 'winnersList') {
        setStage('winners');
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen((open) => !open);
        return;
      }
      if (menuOpen) return;
      if (event.key === ' ' || event.key === 'Enter' || event.key === 'ArrowLeft') {
        event.preventDefault();
        advance();
      } else if (event.key === 'Backspace' || event.key === 'ArrowRight') {
        event.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [stage, menuOpen, engine]);

  const handleClick = (event: React.MouseEvent) => {
    if (menuOpen) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input, select, textarea, a')) return;
    if (stage === 'opening') setStage('playing');
    else if (stage === 'playing') engine.dispatch({ type: 'ADVANCE', at: Date.now() });
    else if (stage === 'winners') setStage('winnersList');
  };

  return (
    <div className="game-root" dir="rtl" style={themeStyle(setting)} onClick={handleClick}>
      {stage === 'opening' && <OpeningScreen engine={engine} />}
      {stage === 'playing' && <SlideView engine={engine} state={state} timer={timer} />}
      {stage === 'winners' && <WinnersScreen engine={engine} />}
      {stage === 'winnersList' && <WinnersListScreen engine={engine} />}

      <span className="status-dot status-dot--connected" title="מקור הצבעות: Replay (ללא שרת)" />

      {menuOpen && (
        <OperatorMenu
          engine={engine}
          state={state}
          volume={volume}
          onVolumeChange={setVolume}
          syntheticCrowd={syntheticCrowd}
          onSyntheticCrowdChange={setSyntheticCrowd}
          onEndGame={() => {
            setStage('winners');
            setMenuOpen(false);
          }}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
}
