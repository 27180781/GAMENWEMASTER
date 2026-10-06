/**
 * בניית מצב המסך למסך הצפייה מתוך מה שהמסך הראשי מציג — **עם הסתרה**.
 *
 * העיקרון: נשלח רק מה שהמסך הראשי מציג ברגע זה, ורק בצורה שבה הוא מציג
 * אותו. כל מה שלא מוצג (התשובה הנכונה לפני החשיפה, כמה הצביעו לכל תשובה
 * כשהמונה החי כבוי, מי ענה נכון, השקופיות הבאות, מספרי הטלפון) לא יוצא
 * מהמחשב של המנחה — כך שגם מי שפותח את כלי המפתחים בדפדפן לא יכול לרמות.
 *
 * רשימה לבנה בלבד: כל שדה בנוי כאן במפורש. שדה חדש במנוע לא "דולף" לצופים
 * מעצמו.
 */

import {
  betSlideFor,
  globalSettingsSchema,
  isImageQuestion,
  isVotableSlide,
  scoredLikeTrivia,
  slideSettingsSchema,
  type GameFile,
  type GameState,
  type GlobalSettings,
  type Slide,
  type SubjectCommand,
} from '../engine/index.ts';
import { imageRevealOf } from '../engine/imageReveal.ts';
import type { RailPlayer, RevealState } from '../render/QuestionSlide.tsx';
import type { RaffleEntry } from '../render/RaffleOverlay.tsx';
import type { TimerView } from '../render/TimerRing.tsx';
import { avatarColor } from '../render/avatar.ts';
import type { BoardState } from '../app/snakesLadders.ts';
import { hasGroupData } from '../app/groupScore.ts';
import type { Group, RosterData } from '../app/roster.ts';
import { AliasTable } from './aliases.ts';
import {
  LIVE_SCHEMA,
  type LiveCue,
  type LiveOverlays,
  type LiveSnapshot,
  type LiveSound,
  type LiveStage,
  type LiveState,
  type LiveTimer,
} from './types.ts';

/** פיקסל שקוף — במקום תמונה שעדיין אסור להראות, כדי שהפריסה לא תשתנה. */
export const BLANK_IMAGE =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** סטייה (שניות) בין הטיימר במסך הראשי לבין מה שהצופה מחשב בעצמו, שמצדיקה עוגן חדש. */
const TIMER_DRIFT_S = 0.3;

/** הקלט: מה שהמסך הראשי מציג עכשיו (ראו useLivePublisher). */
export interface LiveHostInput {
  stage: LiveStage;
  game: GameFile;
  state: GameState;
  reveal: RevealState;
  timer: TimerView | null;
  players: RailPlayer[];
  leaders: RailPlayer[];
  lobby: RailPlayer[];
  nameOf: (voterId: string) => string;
  roster: RosterData;
  groupBonus: Record<string, number>;
  join: { show: boolean; code: string; qrUrl: string | null };
  overlays: {
    leaders: boolean;
    votes: boolean;
    lobby: boolean;
    bet: boolean;
    groups: { categoryIndex: number } | null;
    board: { board: BoardState; groups: Group[]; progression: 'dice' | 'percent' } | null;
    connect: {
      categoryName: string;
      groups: Group[];
      counts: Record<string, number>;
      total: number;
    } | null;
    raffle: { entries: RaffleEntry[]; winner: RaffleEntry; run: number } | null;
  };
  winnersRevealed: number;
  scoresPage: number;
  functionStatus: 'idle' | 'sending' | 'sent' | 'error';
  functionDetail: string;
  paused: boolean;
  mediaStartedAt: number | null;
  sound: LiveSound;
  cues: LiveCue[];
  /**
   * תמונה מוקטנת של תמונת השאלה, לשקופית "התמונה מתבהרת" כל עוד ההצבעה לא
   * נסגרה (ראו revealThumb.ts). null = אין עדיין — נשלח פיקסל שקוף.
   */
  revealThumb: string | null;
}

/**
 * הצגת מספר טלפון בלי לחשוף אותו: 3 הספרות הראשונות ו-3 האחרונות. המסך הראשי
 * מציג את המספר עצמו כשאין לשחקן שם (שחקן שהצטרף בחיוג) — מספיק כדי שאדם
 * יזהה את עצמו, בלי שהקישור, שמועבר הלאה בקלות, יפיץ את המספרים.
 */
export function maskPhoneLike(text: string): string {
  const trimmed = text.trim();
  if (!/^\+?[\d\s-]+$/.test(trimmed)) return text;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7) return text;
  return `${digits.slice(0, 3)}${'•'.repeat(digits.length - 6)}${digits.slice(-3)}`;
}

/** מפתחות ידועים בלבד מתוך אובייקט — סכמות passthrough שומרות כל שדה שהגיע בקובץ. */
function pickKnown<T extends object>(value: T, keys: readonly string[]): T {
  const out: Record<string, unknown> = {};
  const source = value as Record<string, unknown>;
  for (const key of keys) {
    if (Object.hasOwn(source, key) && source[key] !== undefined) out[key] = source[key];
  }
  return out as T;
}

const GLOBAL_SETTING_KEYS = Object.keys(globalSettingsSchema.shape).filter(
  (key) => key !== 'narration',
);
const SLIDE_SETTING_KEYS = Object.keys(slideSettingsSchema.shape);

function liveSetting(setting: GlobalSettings): GlobalSettings {
  return pickKnown(setting, GLOBAL_SETTING_KEYS);
}

function sameAsQuestion(src: string, slide: Slide): boolean {
  return src !== '' && src === slide.question.src;
}

function liveSlideSetting(slide: Slide): Slide['setting'] {
  const setting = pickKnown(slide.setting, SLIDE_SETTING_KEYS);
  if (sameAsQuestion(setting.slidBackgroundMedia.src, slide)) {
    return { ...setting, slidBackgroundMedia: { ...setting.slidBackgroundMedia, src: '' } };
  }
  return setting;
}

interface SlideVisibility {
  questionShown: boolean;
  answersShown: number;
  /** הסימון האמיתי של התשובות הנכונות מוצג על המסך. */
  correctShown: boolean;
  /** תמונת השאלה המלאה מותרת (לא "מתבהרת" עדיין). */
  imageShown: boolean;
  revealThumb: string | null;
}

/**
 * דגלי correct "מטעים" כשהאמיתיים עדיין מוסתרים. במסך הם לא מוצגים לפני
 * החשיפה, אבל `scoredLikeTrivia` (תשובות-כתמונה) נשען עליהם כדי להחליט אם
 * להציג ניקוד יורד ואת פס ההימור. לכן משמרים את הצורה — "יש נכונה וגם יש
 * שגויה" — בלי לגלות איזו.
 */
function decoyCorrect(slide: Slide): boolean[] {
  const answers = slide.question.answers;
  const shapeKept =
    slide.type === 'ans_images' &&
    answers.some((a) => a.correct) &&
    answers.some((a) => !a.correct);
  return answers.map((_, i) => shapeKept && i === 0);
}

function liveSlide(slide: Slide, view: SlideVisibility | null): Slide {
  const votable = isVotableSlide(slide);
  const decoy = view !== null && !view.correctShown ? decoyCorrect(slide) : null;
  const imageQuestion = isImageQuestion(slide.question);
  const revealImage = imageRevealOf(slide) !== null;
  let src = slide.question.src;
  if (view !== null && revealImage && !view.imageShown) src = view.revealThumb ?? BLANK_IMAGE;
  let que = slide.question.que;
  // בשאלת תמונה הטקסט הוא שם פנימי שאסור שיגיע למסך (questionMode.ts).
  if (imageQuestion) que = '';
  else if (view !== null && votable && !view.questionShown) que = '';

  const out: Record<string, unknown> = {
    id: slide.id,
    type: slide.type,
    question: {
      que,
      queMode: slide.question.queMode,
      scoreForQue: slide.question.scoreForQue,
      timeForQue: slide.question.timeForQue,
      src,
      answers: slide.question.answers.map((a, i) => ({
        // תשובת טקסט שעוד לא נחשפה — ריקה. תמונות נשארות כדי שייטענו מראש.
        ans:
          view !== null && votable && slide.type !== 'ans_images' && i >= view.answersShown
            ? ''
            : a.ans,
        correct: decoy === null ? a.correct : decoy[i]!,
        id: a.id,
      })),
    },
    openMedia: { src: slide.openMedia.src },
    endMedia: { src: slide.endMedia.src },
    // רקע שמצביע על תמונת השאלה עצמה ממילא לא מוצג (slideBackgroundSrc) — ריק
    // שקול לו, ובלי זה הכתובת החדה של "התמונה מתבהרת" הייתה מגיעה דרכו.
    backgroundMedia: {
      src: sameAsQuestion(slide.backgroundMedia.src, slide) ? '' : slide.backgroundMedia.src,
    },
    setting: liveSlideSetting(slide),
  };
  if (slide.function !== undefined) {
    // כתובת ה-API ופרטי הפעולה נשארים אצל המנחה; המסך צריך רק את סוג המסך.
    out.function = {
      action: slide.function.action,
      ...(slide.function.screen !== undefined
        ? { screen: { type: slide.function.screen.type } }
        : {}),
    };
  }
  if (slide.bet !== undefined) {
    out.bet = {
      options: slide.bet.options.map((o) => ({
        kind: o.kind,
        ...(o.value !== undefined ? { value: o.value } : {}),
        ...(o.payout !== undefined ? { payout: o.payout } : {}),
      })),
      payout: slide.bet.payout,
      allowNegative: slide.bet.allowNegative,
    };
  }
  return out as unknown as Slide;
}

/** עוגן הטיימר הקודם עדיין מתאר את הטיימר הנוכחי? (אז לא שולחים כלום חדש) */
function timerStillMatches(anchor: LiveTimer, timer: TimerView): boolean {
  if (anchor.paused !== timer.paused || anchor.total !== timer.total) return false;
  const since = (timer.sampledAt - anchor.at) / 1000;
  const predicted = anchor.paused ? anchor.remaining : anchor.remaining - since;
  return Math.abs(predicted - timer.remaining) <= TIMER_DRIFT_S;
}

export class LiveSnapshotBuilder {
  readonly aliases: AliasTable;
  private timerAnchor: LiveTimer | null = null;

  constructor(aliases: AliasTable = new AliasTable()) {
    this.aliases = aliases;
  }

  build(input: LiveHostInput): LiveSnapshot {
    const { game, state, reveal } = input;
    const used = new Map<string, string>(); // כינוי → מזהה מקורי (לשמות ולצבעים)
    const alias = (id: string): string => {
      const a = this.aliases.alias(id);
      used.set(a, id);
      return a;
    };
    const aliasMap = <V>(record: Readonly<Record<string, V>>): Record<string, V> => {
      const out: Record<string, V> = {};
      for (const [id, value] of Object.entries(record)) out[alias(id)] = value;
      return out;
    };
    const railColors = new Map<string, string>();
    const rail = (list: RailPlayer[]): RailPlayer[] =>
      list.map((p) => {
        const a = alias(p.id);
        railColors.set(a, p.color);
        return { id: a, name: maskPhoneLike(p.name), initial: p.initial, color: p.color };
      });

    const slide = game.questions[state.currentSlideIndex];
    const playing = input.stage === 'playing';
    const voting = state.phase === 'voting';
    const revealed = reveal.revealCorrect;
    const votesOpen = playing && input.overlays.votes;
    const correctShown = revealed || votesOpen;
    const majority = slide?.setting.majorityDecides === true;

    // ---- השקופית הנוכחית ושקופית ההימור שהיא מכריעה ----
    const slides: Record<string, Slide> = {};
    let armedBetId: number | null = null;
    if (slide !== undefined) {
      const imageShown = state.phase === 'results' || state.phase === 'ended';
      slides[String(state.currentSlideIndex)] = liveSlide(slide, {
        questionShown: reveal.questionShown,
        answersShown: reveal.answersShown,
        correctShown,
        imageShown,
        revealThumb: input.revealThumb,
      });
      const armed = scoredLikeTrivia(slide) ? betSlideFor(game, state.currentSlideIndex) : null;
      if (armed !== null) {
        const index = game.questions.indexOf(armed);
        if (index >= 0) slides[String(index)] = liveSlide(armed, null);
        armedBetId = armed.id;
      }
    }

    // ---- הצבעות: רק מה שהמסך מציג ----
    let liveVotes: LiveState['liveVotes'] = null;
    if (state.liveVotes !== null) {
      const countsShown =
        slide !== undefined &&
        (correctShown || slide.type === 'bet' || (voting && slide.setting.liveVoteCounts));
      liveVotes = {
        counts: countsShown ? { ...state.liveVotes.counts } : {},
        total: state.liveVotes.total,
      };
    }
    let liveCorrectCount: number | null = null;
    if (
      slide !== undefined &&
      voting &&
      slide.type === 'trivia' &&
      !majority &&
      state.liveVotes !== null
    ) {
      const counts = state.liveVotes.counts;
      liveCorrectCount = slide.question.answers
        .filter((a) => a.correct)
        .reduce((sum, a) => sum + (counts[String(a.id)] ?? 0), 0);
    }

    // ---- ניקוד: רק כשמוצג מסך שמשתמש בו ----
    const fnScreen = playing && slide?.type === 'function' && slide.function?.action === 'screen';
    const groupsShown = playing && (input.overlays.groups !== null || input.overlays.leaders);
    const scoresShown =
      input.stage === 'winners' || input.stage === 'scoreboard' || groupsShown || fnScreen;
    const scores = scoresShown ? aliasMap(state.scores) : {};
    const answerTimes = scoresShown ? aliasMap(state.answerTimes) : {};

    const votesBySlide: LiveState['votesBySlide'] = {};
    if (input.stage === 'scoreboard') {
      // "הניקוד של כל המשתתפים" מציג גם מי שהצביע ולא צבר ניקוד — מספיק לדעת מי.
      const voted: Record<string, number> = {};
      for (const votes of Object.values(state.votesBySlide)) {
        for (const id of Object.keys(votes)) voted[alias(id)] = 0;
      }
      votesBySlide[-1] = voted;
    }
    if (votesOpen) {
      votesBySlide[state.currentSlideId] = aliasMap(state.votesBySlide[state.currentSlideId] ?? {});
    }

    const betStakes: LiveState['betStakes'] = {};
    if (armedBetId !== null && state.betStakes[armedBetId] !== undefined) {
      betStakes[armedBetId] = aliasMap(state.betStakes[armedBetId]!);
    }
    if (slide?.type === 'bet' && state.betStakes[slide.id] !== undefined) {
      betStakes[slide.id] = aliasMap(state.betStakes[slide.id]!);
    }
    const betOutcomes: LiveState['betOutcomes'] = {};
    if (playing && input.overlays.bet && state.betOutcomes[state.currentSlideId] !== undefined) {
      betOutcomes[state.currentSlideId] = aliasMap(state.betOutcomes[state.currentSlideId]!);
    }

    // ---- פקודת שקופית טקסט: תמונה דינמית שהכתובת שלה מכילה את מזהה המשחק ----
    let subjectCommand: SubjectCommand = state.subjectCommand;
    if (
      subjectCommand?.kind === 'dynamic-image' &&
      game.id !== '' &&
      subjectCommand.url.includes(game.id)
    ) {
      // מזהה המשחק פותח את קובץ המשחק כולו (כולל טלפונים) — אסור שיגיע לצופים.
      subjectCommand = null;
      const key = String(state.currentSlideIndex);
      const current = slides[key];
      if (current !== undefined)
        slides[key] = { ...current, type: 'media', question: { ...current.question, que: '' } };
    }

    const liveState: LiveState = {
      phase: state.phase,
      currentSlideId: state.currentSlideId,
      currentSlideIndex: state.currentSlideIndex,
      activeMedia: state.activeMedia,
      openMediaPlayed: state.openMediaPlayed,
      endMediaPlayed: state.endMediaPlayed,
      subjectCommand,
      liveVotes,
      scores,
      answerTimes,
      votesBySlide,
      slidesCompleted: [],
      firstClickWinners: {},
      betStakes,
      betOutcomes,
      majorityBySlide: {},
    };

    // ---- טיימר: עוגן חדש רק כשהספירה של הצופה הייתה סוטה ----
    let timer: LiveTimer | null = null;
    if (input.timer !== null) {
      const anchor = this.timerAnchor;
      timer =
        anchor !== null && timerStillMatches(anchor, input.timer)
          ? anchor
          : {
              remaining: input.timer.remaining,
              total: input.timer.total,
              paused: input.timer.paused,
              elapsedMs: input.timer.elapsedMs,
              at: input.timer.sampledAt,
            };
    }
    this.timerAnchor = timer;

    // ---- קבוצות ----
    const boardShown = playing && input.overlays.board !== null;
    const connectShown = input.overlays.connect !== null;
    const rosterNeeded =
      (groupsShown || fnScreen || boardShown || connectShown) && hasGroupData(input.roster);
    const memberships: Record<string, Record<string, string>> = {};
    if (rosterNeeded) {
      for (const [id, byCat] of Object.entries(input.roster.memberships))
        memberships[alias(id)] = { ...byCat };
    }

    const overlays: LiveOverlays = {
      leaders: playing && input.overlays.leaders,
      votes: votesOpen,
      lobby: input.overlays.lobby && input.stage !== 'opening',
      bet:
        playing && input.overlays.bet
          ? { title: armedBetTitle(game, state.currentSlideIndex) }
          : null,
      groups: playing ? input.overlays.groups : null,
      board: boardShown ? input.overlays.board : null,
      connect: input.overlays.connect,
      raffle:
        input.overlays.raffle === null
          ? null
          : {
              run: input.overlays.raffle.run,
              entries: input.overlays.raffle.entries.map((e) => raffleEntry(e, alias(e.id))),
              winner: raffleEntry(
                input.overlays.raffle.winner,
                alias(input.overlays.raffle.winner.id),
              ),
            },
    };

    const players = playing ? rail(input.players) : [];
    // מי ענה נכון מוצג רק אחרי החשיפה — לפני כן הוא היה מגלה מה התשובה.
    const leaders = playing && revealed ? rail(input.leaders) : [];
    const lobby = input.stage === 'opening' || overlays.lobby ? rail(input.lobby) : [];

    // ---- שמות וצבעים לכל כינוי שבשימוש ----
    const names: Record<string, string> = {};
    const colors: Record<string, string> = {};
    for (const [a, id] of used) {
      names[a] = maskPhoneLike(input.nameOf(id));
      colors[a] = railColors.get(a) ?? avatarColor(id);
    }

    return {
      schema: LIVE_SCHEMA,
      stage: input.stage,
      game: {
        name: game.name,
        setting: liveSetting(game.setting),
        slideCount: game.questions.length,
        slides,
      },
      state: liveState,
      reveal: { ...reveal },
      timer,
      liveCorrectCount,
      players,
      leaders,
      lobby,
      join: {
        show: input.join.show,
        code: input.join.show ? input.join.code : '',
        qr: input.join.show && input.join.qrUrl !== null ? input.join.qrUrl : '',
      },
      overlays,
      winnersRevealed: input.winnersRevealed,
      scoresPage: input.scoresPage,
      fn: { status: input.functionStatus, detail: input.functionDetail },
      paused: input.paused,
      mediaAt: state.activeMedia !== null ? input.mediaStartedAt : null,
      roster: { categories: rosterNeeded ? input.roster.categories : [], memberships },
      groupBonus: rosterNeeded ? { ...input.groupBonus } : {},
      names,
      colors,
      sound: { ...input.sound },
      cues: input.cues.map((c) => ({ ...c })),
    };
  }
}

/** כותרת מסך תוצאות ההימור — נוסח שקופית ההימור שהשאלה הנוכחית הכריעה. */
function armedBetTitle(game: GameFile, index: number): string {
  return betSlideFor(game, index)?.question.que ?? '';
}

function raffleEntry(entry: RaffleEntry, aliasId: string): RaffleEntry {
  const name = maskPhoneLike(entry.name);
  // המסך הראשי מציג מתחת לשם את המזהה (מספר שלט / טלפון) כשהוא שונה מהשם.
  // תמיד נשלח idLabel (גם ריק), כדי שמסך הצפייה לא יציג במקומו את הכינוי.
  const label = entry.id !== '' && entry.id !== entry.name ? maskPhoneLike(entry.id) : '';
  return { id: aliasId, name, idLabel: label };
}
