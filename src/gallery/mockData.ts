/**
 * נתוני דמה לגלריית המסכים (gallery.html) — קובץ משחק גולמי שעובר דרך
 * parseGameFile האמיתי, שמות עבריים, מרשם קבוצות וניקוד. כלי פיתוח בלבד.
 */

import {
  GameEngine,
  countsOfVotes,
  parseGameFile,
  type GameFile,
  type GameSnapshot,
} from '../engine/index.ts';
import { avatarColor, railInitial } from '../render/avatar.ts';
import type { RailPlayer, RevealState } from '../render/QuestionSlide.tsx';
import type { TimerView } from '../render/TimerRing.tsx';
import type { RosterData } from '../app/roster.ts';
import questionImage from './assets/question-jerusalem.svg';
import pomegranate from './assets/answer-pomegranate.svg';
import grapes from './assets/answer-grapes.svg';
import olives from './assets/answer-olives.svg';
import dates from './assets/answer-dates.svg';
import logo from './assets/logo.svg';
import busyBackground from './assets/bg-busy.svg';

export const IMAGES = { questionImage, pomegranate, grapes, olives, dates, logo, busyBackground };

export const GAME_ID = 'gallery-game';

/** ערכות הצבעים לבדיקה (`?colors=`). */
export const COLOR_PRESETS: Record<string, { main: string; secondary: string }> = {
  // ברירת המחדל החיה של המערכת: תיבות לבנות, טקסט כהה
  default: { main: '#FFFFFFEB', secondary: '#17064FCC' },
  dark: { main: '#6d28d9', secondary: '#ffffff' },
  contrast: { main: '#f5c518', secondary: '#111111' },
  // בחירה גרועה של בעלים — חייבת להישאר שמישה
  'light-on-light': { main: '#e0f2fe', secondary: '#ffffff' },
};

const NAMES = [
  'משה כהן', 'שרה לוי', 'יוסף מזרחי', 'רבקה פרץ', 'דוד ביטון', 'רחל אברהם', 'אברהם פרידמן',
  'לאה שפירא', 'יעקב אוחיון', 'מרים דהן', 'שמואל גולדברג', 'חנה אזולאי', 'אהרון רוזנברג',
  'אסתר חדד', 'יצחק וייס', 'נעמי עמר', 'בנימין קליין', 'דבורה אלמוג', 'מנחם שטרן',
  'צביה בן דוד', 'אליהו גבאי', 'שושנה טל', 'נחום ברגר', 'רות סויסה', 'חיים אלבז',
  'תמר נחמיאס', 'מרדכי-יהושע בן-ציון אברמוביץ׳', 'יהודית אקרמן', 'זאב מרקוביץ', 'אביגיל שלום',
];

/** מזהי המצביעים — מספרי טלפון, כמו במצב טלפונים. */
export const VOTER_IDS = NAMES.map((_, i) => `05012345${String(i + 10).padStart(2, '0')}`);

const GROUPS = [
  { id: 'g1', name: 'אריות יהודה' },
  { id: 'g2', name: 'נשרי הגליל' },
  { id: 'g3', name: 'צבאות הנגב' },
  { id: 'g4', name: 'דולפיני הים התיכון' },
];

/** מרשם: שמות לכל המצביעים, ואופציונלית קטגוריית קבוצות עם שיוך מחזורי. */
export function makeRoster(withGroups: boolean): RosterData {
  const players = VOTER_IDS.map((id, i) => ({ id, name: NAMES[i]! }));
  if (!withGroups) return { players, categories: [], memberships: {}, pendingNames: [] };
  const memberships: RosterData['memberships'] = {};
  VOTER_IDS.forEach((id, i) => {
    memberships[id] = { cat1: GROUPS[i % GROUPS.length]!.id };
  });
  return {
    players,
    categories: [{ id: 'cat1', name: 'שבטים', groups: GROUPS }],
    memberships,
    pendingNames: [],
  };
}

export const GROUP_LIST = GROUPS;

export function nameOfFor(roster: RosterData): (id: string) => string {
  const byId = new Map(roster.players.map((p) => [p.id, p.name]));
  return (id) => byId.get(id) ?? id;
}

export function railPlayers(count: number, offset = 0): RailPlayer[] {
  return VOTER_IDS.slice(offset, offset + count).map((id, i) => {
    const name = NAMES[offset + i]!;
    return { id, name, initial: railInitial(name), color: avatarColor(id) };
  });
}

/** ניקוד יורד ומגוון ל-n המצביעים הראשונים. */
export function scoresFor(count: number): Record<string, number> {
  const scores: Record<string, number> = {};
  VOTER_IDS.slice(0, count).forEach((id, i) => {
    scores[id] = Math.max(3, 96 - i * 7 + ((i * 13) % 5));
  });
  return scores;
}

/** חלוקה דטרמיניסטית של המצביעים בין התשובות לפי משקלים. */
export function votesBy(weights: number[], voters = VOTER_IDS.length): Record<string, number> {
  const total = weights.reduce((a, b) => a + b, 0);
  const votes: Record<string, number> = {};
  let cursor = 0;
  weights.forEach((w, answerIndex) => {
    const n = answerIndex === weights.length - 1 ? voters - cursor : Math.round((w / total) * voters);
    for (let k = 0; k < n && cursor < voters; k++) {
      votes[VOTER_IDS[cursor]!] = answerIndex + 1;
      cursor += 1;
    }
  });
  return votes;
}

// ---------------------------------------------------------------------------
// קובץ משחק גולמי (כמו ה-JSON של get-game-json)
// ---------------------------------------------------------------------------

export interface SlideSpec {
  id: number;
  type: string;
  que?: string;
  answers?: [string, boolean][];
  src?: string;
  queMode?: 'text' | 'image';
  time?: number;
  score?: number | '';
  settings?: Record<string, unknown>;
  fn?: Record<string, unknown>;
  bet?: Record<string, unknown>;
}

export function rawSlide(spec: SlideSpec): Record<string, unknown> {
  return {
    id: spec.id,
    type: spec.type,
    question: {
      que: spec.que ?? '',
      queMode: spec.queMode ?? 'text',
      scoreForQue: spec.score ?? 10,
      timeForQue: spec.time ?? 20,
      answers: (spec.answers ?? []).map(([ans, correct], i) => ({ ans, correct, id: i + 1 })),
      src: spec.src ?? '',
    },
    openMedia: { src: '' },
    endMedia: { src: '' },
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
    ...(spec.fn ? { function: spec.fn } : {}),
    ...(spec.bet ? { bet: spec.bet } : {}),
  };
}

export interface GalleryContext {
  theme: string;
  colors: { main: string; secondary: string };
  /** מדיית רקע לכל המסכים (gameMedia/triviaMedia/winnersMedia/winnersListMedia); '' = גיבוי המנוע. */
  bg: string;
}

export function makeGame(
  ctx: GalleryContext,
  slides: SlideSpec[],
  setting: Record<string, unknown> = {},
): GameFile {
  const bg = { src: ctx.bg };
  return parseGameFile({
    name: 'חידון חגי תשרי',
    id: GAME_ID,
    questions: slides.map(rawSlide),
    setting: {
      titleThroughoutGame: 'חידון חגי תשרי',
      ansIsNumber: false,
      voterNameStyle: 'plain',
      visualTheme: ctx.theme,
      multiWinners: 5,
      showWinnersListAfter: null,
      winnersListCount: 8,
      mainColor: ctx.colors.main,
      secondaryColor: ctx.colors.secondary,
      gameMedia: bg,
      logo: { src: logo },
      triviaMedia: bg,
      winnersListMedia: bg,
      winnersMedia: bg,
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
      ...setting,
    },
    assets: [],
    users: '{}',
    room: 2047,
  });
}

// ---------------------------------------------------------------------------
// הנעת המנוע לשלב הרצוי — דרך ה-API הציבורי בלבד (restore / dispatch)
// ---------------------------------------------------------------------------

export type DrivePhase = 'showing' | 'voting' | 'results';

let snapshotSeq = 0;

/** שחזור למצב התחלתי בשקופית נתונה (עם ניקוד קודם), ואז הנעה לשלב המבוקש. */
export function engineAt(
  game: GameFile,
  slideId: number,
  phase: DrivePhase,
  { votes = {}, scores = {} }: { votes?: Record<string, number>; scores?: Record<string, number> } = {},
): GameEngine {
  const engine = new GameEngine(game);
  const snapshot: GameSnapshot = {
    version: 1,
    gameId: game.id,
    roomId: game.room,
    seq: 0,
    savedAt: '2026-10-05T12:00:00.000Z',
    currentSlideId: slideId,
    phase: 'showing',
    scores,
    votesBySlide: {},
    slidesCompleted: [],
    firstClickWinners: {},
  };
  engine.restore(snapshot);
  driveSlide(engine, phase, votes);
  return engine;
}

/** מהשלב 'showing' של השקופית הנוכחית: פתיחת הצבעה, הזרמת הצבעות, וסגירה. */
export function driveSlide(engine: GameEngine, phase: DrivePhase, votes: Record<string, number>): void {
  if (phase === 'showing') return;
  const at = 1_000_000;
  engine.dispatch({ type: 'ADVANCE', at });
  const slideId = engine.getState().currentSlideId;
  if (Object.keys(votes).length > 0) {
    snapshotSeq += 1;
    engine.dispatch({
      type: 'VOTE_SNAPSHOT',
      snapshot: {
        seq: snapshotSeq,
        slideId,
        counts: countsOfVotes(votes),
        total: Object.keys(votes).length,
        voters: votes,
        firstVoter: Object.keys(votes)[0]!,
      },
      at: at + 4000,
      elapsedMs: 4000,
    });
  }
  if (phase === 'results') engine.dispatch({ type: 'ADVANCE', at: at + 20000 });
}

/** טיימר באמצע ההצבעה. sampledAt בעתיד ⇒ שום השלמה חיה (rAF) — תמונה דטרמיניסטית. */
export function midTimer(total = 20, remaining = 9.4): TimerView {
  return {
    remaining,
    total,
    paused: false,
    elapsedMs: (total - remaining) * 1000,
    sampledAt: Date.now() + 1e10,
  };
}

export function revealVoting(answers: number): RevealState {
  return { questionShown: true, answersShown: answers, revealCorrect: false };
}

export function revealDone(answers: number): RevealState {
  return { questionShown: true, answersShown: answers, revealCorrect: true };
}
