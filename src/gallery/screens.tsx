/**
 * רישום המסכים של הגלריה. כל מסך בונה משחק דמה משלו (דרך parseGameFile),
 * מניע את המנוע האמיתי לשלב הנכון, ומרנדר את הקומפוננטות האמיתיות בדיוק כפי
 * ש-GameHost מחבר אותן. מסך חדש במשחק = רשומה חדשה כאן, ו-tools/theme-shots.mjs
 * יצלם אותו אוטומטית בכל הערכות.
 */

import type { ReactNode } from 'react';
import type { GameEngine, GameFile } from '../engine/index.ts';
import { SlideView } from '../render/SlideView.tsx';
import { AllScoresScreen, LobbyScreen, WinnersListScreen, WinnersScreen } from '../render/screens.tsx';
import { VotesBreakdown } from '../render/VotesBreakdown.tsx';
import { GroupStandingsOverlay } from '../render/GroupStandingsOverlay.tsx';
import { BetResultsOverlay } from '../render/BetResultsOverlay.tsx';
import { RaffleOverlay } from '../render/RaffleOverlay.tsx';
import { SnakesLaddersBoard } from '../render/SnakesLaddersBoard.tsx';
import { GroupConnectScreen } from '../render/GroupConnectScreen.tsx';
import type { RailPlayer, RevealState } from '../render/QuestionSlide.tsx';
import type { TimerView } from '../render/TimerRing.tsx';
import { JOIN_DIAL_DISPLAY } from '../app/urlParams.ts';
import { playRound, EMPTY_BOARD } from '../app/snakesLadders.ts';
import type { RosterData } from '../app/roster.ts';
import {
  GROUP_LIST,
  IMAGES,
  VOTER_IDS,
  driveSlide,
  engineAt,
  makeGame,
  makeRoster,
  midTimer,
  nameOfFor,
  railPlayers,
  revealDone,
  revealVoting,
  scoresFor,
  votesBy,
  type GalleryContext,
  type SlideSpec,
} from './mockData.ts';

export interface BuiltScreen {
  game: GameFile;
  node: ReactNode;
  /** באנר ההצטרפות העליון (משחק אונליין, לא בלובי) — מוסיף has-banner לשורש. */
  banner?: boolean;
}

export interface ScreenDef {
  id: string;
  label: string;
  /** כמה זמן (ms) לחכות אחרי הרינדור לפני צילום — לאנימציות מבוססות טיימר/rAF. */
  settleMs?: number;
  build: (ctx: GalleryContext) => BuiltScreen;
}

// ---------------------------------------------------------------------------
// שקופיות לדוגמה
// ---------------------------------------------------------------------------

const Q2: SlideSpec = {
  id: 1,
  type: 'trivia',
  que: 'האם מותר לאכול בסוכה כשיורד גשם?',
  answers: [
    ['כן, אבל רק פירות', false],
    ['לא, מצטער פטור מן הסוכה', true],
  ],
};

const Q4: SlideSpec = {
  id: 1,
  type: 'trivia',
  que: 'כמה ימים חוגגים את חג הסוכות בארץ ישראל?',
  answers: [
    ['שישה ימים', false],
    ['שבעה ימים', true],
    ['שמונה ימים', false],
    ['תשעה ימים', false],
  ],
};

const Q8: SlideSpec = {
  id: 1,
  type: 'trivia',
  que:
    'לפי המסורת, באילו מן המינים הבאים נוהגים ליטול בחג הסוכות כחלק ממצוות ארבעת המינים, ומה הסדר הנכון שבו מחזיקים אותם בשעת הנענועים לכל אחת מששת הרוחות, כפי שמובא בשולחן ערוך ובפוסקים האחרונים?',
  answers: [
    ['אתרוג, לולב, שלושה הדסים ושתי ערבות — הלולב בימין והאתרוג בשמאל', true],
    ['רימון, תמר, גפן ותאנה — כולם יחד ביד ימין בלבד בשעת ההלל', false],
    ['לולב לבדו, ואת שאר המינים מניחים על השולחן ליד הסוכה כל ימי החג', false],
    ['אתרוג ולולב בלבד, וההדסים והערבות נשמרים להושענא רבה בלבד', false],
    ['שבעת המינים כולם, אחד בכל יום מימי החג לפי הסדר שבפסוק', false],
    ['ערבה, הדס, לולב ואתרוג — אך רק בשבת חול המועד ולא ביום טוב', false],
    ['אין חובה ליטול, זהו מנהג עדות מסוימות בלבד ואין לו מקור', false],
    ['לולב ואתרוג ביד שמאל, הדסים וערבות ביד ימין — ההפך מהמקובל', false],
  ],
};

const MULTI: SlideSpec = {
  id: 1,
  type: 'multiselect',
  que: 'אילו מהבאים הם משבעת המינים שנשתבחה בהם ארץ ישראל?',
  answers: [
    ['רימון', true],
    ['תפוח', false],
    ['זית', true],
    ['אבטיח', false],
    ['תפוז', false],
    ['בננה', false],
  ],
};

const POLL: SlideSpec = {
  id: 1,
  type: 'poll',
  que: 'מה המאכל האהוב עליכם בסעודת החג?',
  answers: [
    ['דג גפילטע', false],
    ['קוגל ירושלמי', false],
    ['צימעס', false],
    ['עוף ממולא', false],
  ],
};

const IMAGE_SIDE: SlideSpec = {
  id: 1,
  type: 'trivia',
  que: 'איזה מבנה מופיע בתמונה?',
  src: IMAGES.questionImage,
  answers: [
    ['מגדל דוד', false],
    ['כיפת הסלע', true],
    ['בית הכנסת החורבה', false],
    ['הכותל המערבי', false],
  ],
};

const IMAGE_MODE: SlideSpec = {
  id: 1,
  type: 'trivia',
  que: 'שם פנימי — לא יוצג',
  queMode: 'image',
  src: IMAGES.questionImage,
  answers: [
    ['ירושלים', true],
    ['צפת', false],
    ['טבריה', false],
    ['חברון', false],
  ],
};

const IMAGE_ANSWERS: SlideSpec = {
  id: 1,
  type: 'ans_images',
  que: 'איזה מהפירות הוא הרימון?',
  answers: [
    [IMAGES.grapes, false],
    [IMAGES.pomegranate, true],
    [IMAGES.olives, false],
    [IMAGES.dates, false],
  ],
};

const SUBJECT: SlideSpec = {
  id: 1,
  type: 'subject',
  que: 'סבב שני: חגי תשרי\nבסבב הזה כל תשובה נכונה שווה כפול!\nהתכוננו — השאלה הבאה בעוד רגע',
  score: '',
};

const FUNCTION: SlideSpec = {
  id: 1,
  type: 'function',
  score: '',
  fn: { action: 'players', players: { mode: 'remove', unit: 'percent', amount: 20, selection: 'bottom' } },
};

const BET: SlideSpec = {
  id: 1,
  type: 'bet',
  que: 'על כמה מהנקודות שלכם אתם מהמרים בשאלה הבאה?',
  score: '',
  time: 15,
  settings: { liveVoteCounts: true },
  answers: [
    ['בלי הימור', false],
    ['רבע מהנקודות', false],
    ['חצי מהנקודות', false],
    ['הכול על הכול', false],
  ],
  bet: {
    options: [{ kind: 'none' }, { kind: 'percent', value: 25 }, { kind: 'percent', value: 50 }, { kind: 'all' }],
    payout: 1,
    allowNegative: false,
  },
};

// ---------------------------------------------------------------------------
// עזרי רינדור — כמו GameHost
// ---------------------------------------------------------------------------

interface SlideViewOpts {
  timer?: TimerView | null;
  reveal: RevealState;
  players?: RailPlayer[];
  leaders?: RailPlayer[];
  roster?: RosterData;
  functionDetail?: string;
}

/** SlideView + מונה השקופיות, כמו stage === 'playing' ב-GameHost. */
function playing(engine: GameEngine, opts: SlideViewOpts): ReactNode {
  const state = engine.getState();
  const roster = opts.roster ?? makeRoster(false);
  return (
    <>
      <SlideView
        engine={engine}
        state={state}
        timer={opts.timer ?? null}
        reveal={opts.reveal}
        players={opts.players ?? []}
        leaders={opts.leaders ?? []}
        functionStatus="sent"
        functionDetail={opts.functionDetail ?? ''}
        nameOf={nameOfFor(roster)}
        roster={roster}
      />
      <span className="slide-counter" dir="ltr">
        {state.currentSlideIndex + 1}/{engine.getGame().questions.length}
      </span>
    </>
  );
}

/** מסך שאלה בזמן הצבעה. */
function votingScreen(
  ctx: GalleryContext,
  spec: SlideSpec,
  weights: number[],
  extra: { setting?: Record<string, unknown>; players?: RailPlayer[]; voters?: number } = {},
): BuiltScreen {
  const game = makeGame(ctx, [spec], extra.setting);
  const engine = engineAt(game, spec.id, 'voting', { votes: votesBy(weights, extra.voters ?? 23) });
  const n = game.questions[0]!.question.answers.length;
  return {
    game,
    node: playing(engine, {
      timer: midTimer(),
      reveal: revealVoting(n),
      players: extra.players ?? [],
    }),
  };
}

/** מסך שאלה אחרי חשיפת התשובה (results + revealCorrect). */
function revealScreen(ctx: GalleryContext, spec: SlideSpec, weights: number[]): BuiltScreen {
  const game = makeGame(ctx, [spec]);
  const engine = engineAt(game, spec.id, 'results', { votes: votesBy(weights), scores: scoresFor(20) });
  const n = game.questions[0]!.question.answers.length;
  return { game, node: playing(engine, { reveal: revealDone(n), leaders: railPlayers(5, 1) }) };
}

/** שקופית בתוצאות + שכבה מעליה (overlay של GameHost). */
function withResults(
  ctx: GalleryContext,
  overlay: (engine: GameEngine, game: GameFile) => ReactNode,
  { setting, roster, scores = scoresFor(24) }: { setting?: Record<string, unknown>; roster?: RosterData; scores?: Record<string, number> } = {},
): BuiltScreen {
  const game = makeGame(ctx, [Q4], setting);
  const engine = engineAt(game, 1, 'results', { votes: votesBy([3, 9, 4, 2], 24), scores });
  return {
    game,
    node: (
      <>
        {playing(engine, { reveal: revealDone(4), leaders: railPlayers(5, 1), ...(roster ? { roster } : {}) })}
        {overlay(engine, game)}
      </>
    ),
  };
}

const noop = () => undefined;

// ---------------------------------------------------------------------------
// המסכים
// ---------------------------------------------------------------------------

export const SCREENS: ScreenDef[] = [
  {
    id: 'lobby',
    label: 'לובי (25 מחוברים)',
    build: (ctx) => {
      const game = makeGame(ctx, [Q4]);
      return { game, node: <LobbyScreen engine={engineAt(game, 1, 'showing')} players={railPlayers(25)} /> };
    },
  },
  {
    id: 'lobby-join',
    label: 'לובי אונליין — חיוג + קוד + QR',
    build: (ctx) => {
      const game = makeGame(ctx, [Q4]);
      return {
        game,
        node: (
          <LobbyScreen
            engine={engineAt(game, 1, 'showing')}
            players={railPlayers(25)}
            qrUrl="https://example.com/join?room=2047"
            joinInfo={{ dial: JOIN_DIAL_DISPLAY, code: '2047' }}
          />
        ),
      };
    },
  },
  { id: 'question-2', label: 'שאלה — 2 תשובות', build: (ctx) => votingScreen(ctx, Q2, [8, 15]) },
  { id: 'question-4', label: 'שאלה — 4 תשובות', build: (ctx) => votingScreen(ctx, Q4, [3, 11, 5, 4]) },
  {
    id: 'question-8',
    label: 'שאלה — 8 תשובות ארוכות',
    build: (ctx) => votingScreen(ctx, Q8, [6, 3, 2, 3, 2, 3, 2, 2]),
  },
  { id: 'question-image', label: 'שאלה עם תמונה', build: (ctx) => votingScreen(ctx, IMAGE_SIDE, [2, 12, 5, 4]) },
  {
    id: 'question-image-mode',
    label: 'שאלה שהיא תמונה (queMode image)',
    build: (ctx) => votingScreen(ctx, IMAGE_MODE, [12, 4, 4, 3]),
  },
  { id: 'image-answers', label: 'תשובות תמונה', build: (ctx) => votingScreen(ctx, IMAGE_ANSWERS, [4, 10, 5, 4]) },
  { id: 'poll', label: 'סקר — עוגה אחרי חשיפה', build: (ctx) => revealScreen(ctx, POLL, [5, 9, 3, 7]) },
  { id: 'multiselect', label: 'בחירה מרובה — חשיפה', build: (ctx) => revealScreen(ctx, MULTI, [8, 2, 6, 3, 2, 2]) },
  { id: 'question-reveal', label: 'חשיפת תשובה + מובילים', build: (ctx) => revealScreen(ctx, Q4, [3, 11, 5, 4]) },
  {
    id: 'question-flyers-plain',
    label: 'שמות מצביעים — טקסט',
    build: (ctx) => votingScreen(ctx, Q4, [3, 11, 5, 4], { players: railPlayers(7, 3) }),
  },
  {
    id: 'question-flyers-bubble',
    label: 'שמות מצביעים — בועה',
    build: (ctx) =>
      votingScreen(ctx, Q4, [3, 11, 5, 4], { players: railPlayers(7, 3), setting: { voterNameStyle: 'bubble' } }),
  },
  {
    id: 'question-countdown-descending',
    label: 'ניקוד יורד',
    build: (ctx) =>
      votingScreen(ctx, { ...Q4, settings: { descendingScore: { active: true, maxScore: 1000 } } }, [3, 11, 5, 4]),
  },
  {
    id: 'subject',
    label: 'שקופית טקסט',
    build: (ctx) => {
      const game = makeGame(ctx, [SUBJECT]);
      return { game, node: playing(engineAt(game, 1, 'showing'), { reveal: revealVoting(0) }) };
    },
  },
  {
    id: 'function',
    label: 'שקופית פונקציה',
    build: (ctx) => {
      const game = makeGame(ctx, [FUNCTION]);
      return {
        game,
        node: playing(engineAt(game, 1, 'showing'), {
          reveal: revealVoting(0),
          functionDetail: '✓ 5 משתתפים הוסרו מהמשחק',
        }),
      };
    },
  },
  {
    id: 'bet',
    label: 'שקופית הימור',
    build: (ctx) => {
      const game = makeGame(ctx, [BET, { ...Q4, id: 2 }]);
      const engine = engineAt(game, 1, 'voting', { votes: votesBy([4, 7, 6, 3], 20), scores: scoresFor(24) });
      return { game, node: playing(engine, { timer: midTimer(15, 8.2), reveal: revealVoting(4) }) };
    },
  },
  {
    id: 'bet-results',
    label: 'תוצאות ההימור',
    settleMs: 1800,
    build: (ctx) => {
      const game = makeGame(ctx, [BET, { ...Q4, id: 2 }]);
      const engine = engineAt(game, 1, 'results', { votes: votesBy([4, 7, 6, 3], 20), scores: scoresFor(24) });
      engine.dispatch({ type: 'ADVANCE' }); // לשאלה המנוקדת שמכריעה את ההימור
      driveSlide(engine, 'results', votesBy([3, 11, 5, 4], 24));
      const roster = makeRoster(false);
      const state = engine.getState();
      return {
        game,
        node: (
          <>
            {playing(engine, { reveal: revealDone(4), leaders: railPlayers(5, 1) })}
            <BetResultsOverlay
              outcomes={state.betOutcomes[state.currentSlideId] ?? {}}
              nameOf={nameOfFor(roster)}
              title={BET.que ?? ''}
              onClose={noop}
            />
          </>
        ),
      };
    },
  },
  {
    id: 'votes-breakdown',
    label: 'פירוט הצבעות',
    build: (ctx) =>
      withResults(ctx, (engine) => {
        const state = engine.getState();
        return (
          <VotesBreakdown
            slide={engine.getCurrentSlide()}
            votes={state.votesBySlide[state.currentSlideId] ?? {}}
            nameOf={nameOfFor(makeRoster(false))}
            ansIsNumber={false}
            onClose={noop}
          />
        );
      }),
  },
  {
    id: 'leaderboard',
    label: 'טבלת מובילים (8)',
    build: (ctx) =>
      withResults(ctx, (engine) => (
        <div className="leaders-overlay">
          <WinnersListScreen engine={engine} nameOf={nameOfFor(makeRoster(false))} roster={makeRoster(false)} />
        </div>
      )),
  },
  {
    id: 'leaderboard-groups',
    label: 'טבלת מובילים + קבוצות',
    build: (ctx) => {
      const roster = makeRoster(true);
      return withResults(
        ctx,
        (engine) => (
          <div className="leaders-overlay">
            <WinnersListScreen engine={engine} nameOf={nameOfFor(roster)} roster={roster} />
          </div>
        ),
        { roster },
      );
    },
  },
  {
    id: 'group-standings',
    label: 'דירוג הקבוצות',
    build: (ctx) => {
      const roster = makeRoster(true);
      return withResults(
        ctx,
        (engine) => {
          const state = engine.getState();
          return (
            <GroupStandingsOverlay
              roster={roster}
              scores={state.scores}
              answerTimes={state.answerTimes}
              nameOf={nameOfFor(roster)}
              categoryIndex={0}
              groupBonus={{ g3: 15 }}
              onClose={noop}
            />
          );
        },
        { roster },
      );
    },
  },
  {
    id: 'winners-podium',
    label: 'פודיום — 5 מנצחים',
    build: (ctx) => {
      const game = makeGame(ctx, [Q4]);
      const engine = engineAt(game, 1, 'showing', { scores: scoresFor(24) });
      return { game, node: <WinnersScreen engine={engine} nameOf={nameOfFor(makeRoster(false))} /> };
    },
  },
  {
    id: 'all-scores',
    label: 'הניקוד של כל המשתתפים',
    build: (ctx) => {
      const game = makeGame(ctx, [Q4]);
      const engine = engineAt(game, 1, 'showing', { scores: scoresFor(24) });
      return { game, node: <AllScoresScreen engine={engine} nameOf={nameOfFor(makeRoster(false))} /> };
    },
  },
  {
    id: 'raffle',
    label: 'הגרלה — זוכה',
    build: (ctx) => {
      const winner = { id: VOTER_IDS[6]!, name: 'אברהם פרידמן' };
      return withResults(ctx, () => <RaffleOverlay entries={[winner]} winner={winner} onClose={noop} />);
    },
  },
  {
    id: 'snakes-ladders',
    label: 'סולמות וחבלים קבוצתי',
    settleMs: 3400,
    build: (ctx) => {
      const roster = makeRoster(true);
      // שני סבבים קודמים + הסבב הנוכחי, כמו שהלוח נבנה במשחק
      let board = EMPTY_BOARD;
      const rounds = [votesBy([5, 9, 4, 6], 30), votesBy([2, 20, 4, 4], 30), votesBy([9, 9, 6, 6], 30)];
      rounds.forEach((votes, i) => {
        board = playRound({
          roster,
          categoryId: 'cat1',
          votes,
          correctAnswerIds: [2],
          progression: 'percent',
          seed: i + 1,
          board,
        });
      });
      return withResults(
        ctx,
        () => <SnakesLaddersBoard board={board} groups={GROUP_LIST} progression="percent" onClose={noop} />,
        { setting: { gameType: 'snakes_ladders_team' }, roster },
      );
    },
  },
  {
    id: 'group-connect',
    label: 'התחברות לקבוצות',
    build: (ctx) => {
      const game = makeGame(ctx, [Q4]);
      return {
        game,
        node: (
          <>
            <LobbyScreen engine={engineAt(game, 1, 'showing')} players={railPlayers(25)} />
            <GroupConnectScreen
              categoryName="שבטים"
              groups={GROUP_LIST}
              counts={{ g1: 8, g2: 7, g3: 5, g4: 6 }}
              total={26}
              onReset={noop}
              onClose={noop}
            />
          </>
        ),
      };
    },
  },
  {
    id: 'join-banner',
    label: 'באנר הצטרפות עליון',
    build: (ctx) => ({ ...votingScreen(ctx, Q4, [3, 11, 5, 4]), banner: true }),
  },
];

export function findScreen(id: string): ScreenDef | undefined {
  return SCREENS.find((s) => s.id === id);
}
