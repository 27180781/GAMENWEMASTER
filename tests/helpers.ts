/**
 * עזרי בדיקות: טעינת fixtures, בניית קבצי משחק סינתטיים, והרצת משחק מלא
 * מתחילתו לסופו עם ReplayAdapter שמזרים VoteSnapshots מזויפים.
 */

import { readFileSync } from 'node:fs';
import {
  GameEngine,
  ReplayAdapter,
  countsOfVotes,
  isVotableSlide,
  parseGameFile,
  type GameFile,
  type Slide,
  type VoteSnapshot,
} from '../src/engine/index.ts';

export const FIXTURE_NAMES = [
  'hadassah-ozen.json',
  'masaa-sync-manual-link.json',
  'beficha-uvilvavcha.json',
  'neuwirth.json',
] as const;

export function loadFixtureRaw(name: string): unknown {
  const url = new URL(`../fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf-8'));
}

export function loadFixture(name: string): GameFile {
  return parseGameFile(loadFixtureRaw(name));
}

// ---------------------------------------------------------------------------
// בניית קבצי משחק סינתטיים (אובייקטים "גולמיים" שעוברים דרך parseGameFile,
// כולל מחרוזות ריקות בשדות מספריים — בדיוק כמו בקבצים האמיתיים)
// ---------------------------------------------------------------------------

export interface RawSlideSpec {
  id: number;
  type: 'trivia' | 'survey' | 'ans_images' | 'media' | 'subject';
  que?: string;
  answers?: { ans: string; correct: boolean; id: number }[];
  scoreForQue?: number | '';
  timeForQue?: number | '';
  questionSrc?: string;
  openMediaSrc?: string;
  endMediaSrc?: string;
  settings?: Record<string, unknown>;
}

export function rawSlide(spec: RawSlideSpec): Record<string, unknown> {
  return {
    id: spec.id,
    type: spec.type,
    question: {
      que: spec.que ?? '',
      scoreForQue: spec.scoreForQue ?? '',
      timeForQue: spec.timeForQue ?? '',
      answers: spec.answers ?? [],
      src: spec.questionSrc ?? '',
    },
    openMedia: { src: spec.openMediaSrc ?? '' },
    endMedia: { src: spec.endMediaSrc ?? '' },
    backgroundMedia: { src: '' },
    setting: {
      allowChangeVote: false,
      slideStartVoting: true,
      playAfterClicking: false,
      exitGame: false,
      correctlyAnsweredBefore: false,
      firstClicker: false,
      answerIsSequenceClicks: false,
      fullscreen: false,
      scoringReduction: { active: false, seconds: '', score: '' },
      slidBackgroundMedia: { src: '' },
      automaticSkip: { active: false, seconds: '' },
      showInLoop: false,
      ...(spec.settings ?? {}),
    },
  };
}

/** 4 תשובות סטנדרטיות; הנכונה לפי `correctId`. */
export function fourAnswers(correctId: number): { ans: string; correct: boolean; id: number }[] {
  return [1, 2, 3, 4].map((id) => ({ ans: `תשובה ${id}`, correct: id === correctId, id }));
}

export function rawGame(
  slides: Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: 'משחק בדיקה',
    id: 'test-game-0000',
    questions: slides,
    setting: {
      titleThroughoutGame: 'בדיקה',
      ansIsNumber: true,
      multiWinners: 5,
      showWinnersListAfter: null,
      mainColor: '#222B45C2',
      secondaryColor: '#FFFFFF',
      gameMedia: { src: '' },
      logo: { src: '' },
      triviaMedia: { src: '' },
      winnersListMedia: { src: '' },
      winnersMedia: { src: '' },
      sound: {
        playersConnectingMediaSound: { src: null },
        showQuestionMediaSound: { src: null },
        winnersMediaSound: { src: null },
        winnersListMediaSound: { src: null },
        genericMediaSound: { src: null },
        timerMediaSound: { src: null },
        inShowAnsMediaSound: { src: null },
      },
      limit: { type: 'phones' },
    },
    assets: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    cloudinaryFolder: '',
    credit: null,
    users: '{}',
    room: null,
    baseUrl: '',
    cloudinaryAbsolutePathImage: '',
    cloudinaryAbsolutePathVideo: '',
  };
  return { ...base, ...overrides };
}

export function makeGame(
  slides: Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
): GameFile {
  return parseGameFile(rawGame(slides, overrides));
}

// ---------------------------------------------------------------------------
// סימולציית משחק מלא
// ---------------------------------------------------------------------------

/** בהינתן שקופית — מפת הצבעות voterId → answerId (או null לדילוג על הצבעה). */
export type VotePlan = (slide: Slide) => Record<string, number> | null;

export interface SimulationLog {
  /** רצף (slideId, phase) שנצפה — לאימות מעברי מצבים. */
  transitions: { slideId: number; phase: string; activeMedia: string | null }[];
  /** מספר הצעדים שבוצעו. */
  steps: number;
}

/**
 * מריץ משחק שלם מתחילתו ועד phase='ended', עם ReplayAdapter שמזרים
 * snapshot מזויף אחד לכל חלון הצבעה ואז VOTING_TIMEOUT. הזמן (at) מדומה
 * ומקודם בכל צעד.
 */
export function runFullGame(
  engine: GameEngine,
  votePlan: VotePlan,
  { stepLimit = 5000 }: { stepLimit?: number } = {},
): SimulationLog {
  const adapter = new ReplayAdapter();
  let now = 1_000_000;
  adapter.onVoteSnapshot((snapshot) => {
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot, at: now });
  });
  void adapter.connect('test-room');

  const log: SimulationLog = { transitions: [], steps: 0 };
  let seq = 0;

  while (engine.getState().phase !== 'ended') {
    if (++log.steps > stepLimit) {
      throw new Error(`הסימולציה חצתה את מגבלת הצעדים (${stepLimit}) — כנראה לולאה אינסופית`);
    }
    const state = engine.getState();
    log.transitions.push({
      slideId: state.currentSlideId,
      phase: state.phase,
      activeMedia: state.activeMedia,
    });

    if (state.activeMedia !== null) {
      engine.dispatch({ type: 'MEDIA_ENDED', at: now });
      continue;
    }

    if (state.phase === 'voting') {
      const slide = engine.getCurrentSlide();
      const votes = votePlan(slide);
      if (votes !== null && Object.keys(votes).length > 0) {
        adapter.emit(makeSnapshot(++seq, slide.id, votes));
      }
      now += slide.question.timeForQue * 1000;
      engine.dispatch({ type: 'VOTING_TIMEOUT', at: now });
      continue;
    }

    // showing / results — הצעד הבא במחזור
    engine.dispatch({ type: 'ADVANCE', at: now });
    now += 1000;
  }
  return log;
}

export function makeSnapshot(
  seq: number,
  slideId: number,
  voters: Record<string, number>,
  firstVoter?: string,
): VoteSnapshot {
  const snapshot: VoteSnapshot = {
    seq,
    slideId,
    counts: countsOfVotes(voters),
    total: Object.keys(voters).length,
    voters,
  };
  const first = firstVoter ?? Object.keys(voters)[0];
  if (first !== undefined) snapshot.firstVoter = first;
  return snapshot;
}

/** תשובת ה-trivia הנכונה של שקופית (בהנחה שקיימת אחת). */
export function correctAnswerId(slide: Slide): number {
  const answer = slide.question.answers.find((a) => a.correct);
  if (!answer) throw new Error(`לשקופית id=${slide.id} אין תשובה נכונה`);
  return answer.id;
}

export { isVotableSlide };
