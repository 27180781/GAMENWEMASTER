/**
 * הבמאי של הקריינות — **טהור לגמרי** (בלי React, בלי DOM, בלי שעון): מקבל
 * תמונת מצב של מה שמוצג על המסך + הזיכרון שלו, ומחזיר את רשימת הקטעים לומר
 * עכשיו, האם לבטל את מה שמתנגן, והזיכרון המעודכן. כל הכללים מ-
 * ENGINE-narration.md סעיף 2 והטבלה ב-2.1 יושבים כאן, ורק כאן.
 *
 * שלושת הכללים שמנחים את הכול:
 *   1. **נגררת אחרי המסך** — כל שינוי במצב המוצג מבטל את מה שמתנגן.
 *   2. **לא חוזרת על עצמה** — בתוך ביקור בשקופית כל אירוע נאמר פעם אחת בלבד,
 *      ולכן צעד אחורה וקדימה אינו מקריא שוב. שקופית אחרת = ביקור חדש.
 *   3. **לעולם לא חוסמת** — מפתח בנק חסר או קטע null מדולגים בשקט.
 *
 * הבמאי אידמפוטנטי: אותו מצב פעמיים = אין מה לומר בפעם השנייה.
 */

import { numberClipKeys, participantsClipKeys, pointsClipKeys } from './hebrewNumber.ts';
import {
  AMB_ALL_CORRECT,
  AMB_LOBBY,
  AMB_NEXT,
  AMB_NONE_CORRECT,
  AMB_RAFFLE,
  AMB_START,
  AMB_VOTING,
  HURRY_SECONDS,
  LOBBY_COUNT_EVERY,
  LOBBY_INTERVAL_MS,
  pickAmbience,
  type AmbienceRotation,
} from './ambience.ts';

/** השלב החיצוני של ה-host (HostStage ב-GameHost). */
export type NarrationStage = 'opening' | 'playing' | 'winners' | 'scoreboard';

/** פאזת המנוע. */
export type NarrationPhase = 'showing' | 'voting' | 'results' | 'ended';

/**
 * איזו שכבה פתוחה מעל המשחק. חמש מהן מוקראות (מובילים, תוצאות הימור, דירוג
 * קבוצות, הגרלה ולוח הסולמות), וכל השאר (תפריט, הגדרות, שמות, לובי, קליטת
 * שלטים, התחברות לקבוצות, פירוט הצבעות) מחייבות שקט מוחלט — המשחק עומד,
 * והקריין אינו מדבר על מסך אחר.
 */
export type NarrationOverlay =
  | 'none'
  | 'leaders'
  | 'betResults'
  | 'groups'
  | 'raffle'
  | 'board'
  | 'other';

/** דירוג קבוצה אחת למסך הקבוצות (ה-host מחשב, הבמאי רק מחליט מה לומר). */
export interface NarrationGroupStanding {
  /** שם הקבוצה **בדיוק** כפי שהוא במרשם — המפתח לקטע השם ב-setting.narration.groups. */
  name: string;
  points: number;
}

/** סיכום תוצאות ההימור למסך התוצאות (ה-host מחשב מ-betOutcomeSummary). */
export interface NarrationBetSummary {
  /** מישהו בכלל הימר? */
  anyStake: boolean;
  /** הזכייה הגדולה ביותר בנקודות (0 כשאיש לא זכה). */
  biggestWin: number;
  /** ההפסד הגדול ביותר בנקודות, כערך חיובי (0 כשאיש לא הפסיד). */
  biggestLoss: number;
  /** ניקוד המוביל כרגע — סף ההשוואה ל"הימור גדול" (חצי ממנו). */
  leaderScore: number;
}

export interface NarrationAnswerView {
  /** האם מסומנת נכונה *ברגע זה* (ב"הרוב קובע" המנוע קובע בסגירת ההצבעה). */
  correct: boolean;
  /** קטע הקריינות של התשובה, או null (למשל תשובות-תמונה). */
  clip: string | null;
}

/** תמונת המצב של מה שמוצג — נאספת ב-GameHost מה-state/refs הקיימים. */
export interface DisplayedState {
  stage: NarrationStage;
  phase: NarrationPhase;
  slideId: number;
  slideType: string;
  votable: boolean;
  /** מספר סידורי של השקופית בין שקופיות השאלה (1-based); 0 = אינה שאלה. */
  questionOrdinal: number;
  answers: NarrationAnswerView[];
  /** קטע נוסח השאלה (או ההימור). */
  questionClip: string | null;
  /** קטע מוכן להכרזת התשובה הנכונה; בדרך כלל null. */
  correctClip: string | null;
  majorityDecides: boolean;
  activeMedia: 'open' | 'end' | null;
  questionShown: boolean;
  answersShown: number;
  revealCorrect: boolean;
  /** שניות שנותרו / סה"כ / עצור — null כשאין הצבעה פתוחה. */
  timer: { remaining: number; total: number; paused: boolean } | null;
  overlay: NarrationOverlay;
  /** שלושת המובילים (ניקוד בלבד) — למסך המובילים. */
  leaders: number[];
  /** ניקוד הזוכים לפי סדר המקומות (1,2,3…) — למסך המנצחים. */
  winners: number[];
  /** כמה מקומות פודיום כבר נחשפו (החשיפה מהאחרון לראשון). */
  winnersRevealed: number;
  /** שקופית פונקציה: הפעולה שהיא מבצעת (null בכל שקופית אחרת). */
  functionAction: 'api' | 'screen' | 'score' | 'players' | null;
  /** האם פעולת הפונקציה כבר בוצעה (ה-host כתב functionDetail). */
  functionDone: boolean;
  /** כמה משתתפים נשארו מחוברים אחרי ההסרה; null/0 = לא ידוע. */
  remaining: number | null;
  announceQuestionNumber: boolean;
  /**
   * כמה זמן מוצג מסך ההתחברות (ms). ה-host דוגם אותו בתדר נמוך ורק כל עוד
   * `stage === 'opening'` — הוא *לא* נכנס לחתימת המצב, כדי שדגימה לא תבטל את
   * מה שמתנגן.
   */
  lobbyElapsedMs: number;
  /** כמה משתתפים מחוברים (0 = לא ידוע) — למספר שנאמר בלובי. */
  connectedCount: number;
  /** כמה שקופיות שאלה יש במשחק — ל"חצי הדרך" ול"שאלה אחרונה". */
  questionTotal: number;
  /** כמה ענו נכונה בשאלה שנסגרה, וכמה הצביעו בכלל; null = לא ידוע. */
  correctCount: number | null;
  votedCount: number | null;
  /** מזהי שלושת המובילים, באותו סדר כמו `leaders` — לזיהוי חילופי הובלה. */
  leaderIds: string[];
  /** דירוג הקבוצות (יורד) — רק כשמסך הקבוצות מוצג. */
  groups: NarrationGroupStanding[];
  /** קטעי שמות הקבוצות מהקובץ (`setting.narration.groups`): שם מדויק → כתובת. */
  groupClips: Record<string, string>;
  /** סיכום ההימור — רק כשמסך תוצאות ההימור מוצג. */
  bet: NarrationBetSummary | null;
  /** כיוון התזוזה בלוח הסולמות בסבב האחרון (null = תזוזה רגילה / לא ידוע). */
  boardMove: 'climb' | 'fall' | null;
  /**
   * תצוגה מקדימה של מסך המנצחים (מקש W באמצע המשחק) — אינה סוף המשחק, ולכן
   * הקריין שותק בה לגמרי: אחרת ההכרזות של הסיום (ובראשן `flow_thanks`, שנאמר
   * פעם אחת למשחק) היו נצרכות באמצע ומסך הסיום האמיתי היה שותק.
   */
  winnersPreview: boolean;
  /** הקריינות פעילה (קיימת בקובץ, דלוקה, ולא הושתקה בתפריט המפעיל). */
  enabled: boolean;
  /** מילון הביטויים הקבועים של הקול (bank_key → url). */
  bank: Record<string, string>;
}

export interface NarrationMemory {
  /** מזהה הביקור הנוכחי בשקופית — מתחלף בכל כניסה מחדש. */
  visit: string;
  /** אירועים שכבר נאמרו בביקור הזה. */
  spoken: ReadonlySet<string>;
  /** אירועים שנאמרים פעם אחת לכל המשחק (פתיחה, לוח ניקוד סופי). */
  global: ReadonlySet<string>;
  /** חתימת המצב המוצג הקודם — כל שינוי בה מבטל את מה שמתנגן. */
  signature: string;
  /** "עשר שניות אחרונות" כבר נאמר בחלון ההצבעה הנוכחי. */
  tenLeft: boolean;
  lastPhase: NarrationPhase | null;
  lastPaused: boolean;
  /** מונה הסיבוב של ניסוחי האווירה (ראו ambience.ts). */
  rotation: AmbienceRotation;
  /** כמה קריאות אווירה כבר נאמרו במסך ההתחברות. */
  lobbyLines: number;
  /** השלב החיצוני בצעד הקודם — לזיהוי המעבר מסך פתיחה → משחק. */
  lastStage: NarrationStage | null;
  /** המעבר למשחק זוהה ו"מתחילים!" עדיין לא נאמר (למשל בגלל מדיה חוסמת). */
  startPending: boolean;
  /** מזהה המוביל כפי שהוכרז בפעם הקודמת בלוח המובילים. */
  topId: string | null;
  /** קריאות חלון ההצבעה הנוכחי — מתאפסות עם כל פתיחת הצבעה. */
  ambVoting: boolean;
  ambHurry: boolean;
}

export interface NarrationDecision {
  /** הקטעים לומר עכשיו (כתובות מלאות, אחרי פענוח מול הבנק). */
  clips: string[];
  /** לעצור מיד את מה שמתנגן (המסך השתנה, או שמתחיל משפט חדש). */
  cancel: boolean;
  /** שמות האירועים שנאמרו — ללוג הדיבוג. */
  events: string[];
  memory: NarrationMemory;
}

export function emptyNarrationMemory(): NarrationMemory {
  return {
    visit: '',
    spoken: new Set<string>(),
    global: new Set<string>(),
    signature: '',
    tenLeft: false,
    lastPhase: null,
    lastPaused: false,
    rotation: {},
    lobbyLines: 0,
    lastStage: null,
    startPending: false,
    topId: null,
    ambVoting: false,
    ambHurry: false,
  };
}

/** סוגי השקופיות שנספרות כ"שאלה" להכרזת מספר (ההימור אינו שאלה). */
const QUESTION_TYPES = new Set(['trivia', 'survey', 'ans_images']);

export function isNarratedQuestionType(type: string): boolean {
  return QUESTION_TYPES.has(type);
}

/**
 * חתימת המצב המוצג — רק ערכים בדידים. שניות הטיימר *לא* נכללות בכוונה: הן
 * משתנות כל 200ms, וכל שינוי בחתימה מבטל את מה שמתנגן.
 */
function signatureOf(s: DisplayedState): string {
  return [
    s.stage,
    s.phase,
    s.slideId,
    s.activeMedia ?? '-',
    s.questionShown ? 'q' : '-',
    s.answersShown,
    s.revealCorrect ? 'c' : '-',
    s.overlay,
    s.winnersRevealed,
    s.timer === null ? '-' : s.timer.paused ? 'p' : 'r',
    s.functionDone ? 'f' : '-',
  ].join('|');
}

/** מזהה הביקור: שקופית + שלב חיצוני. כניסה מחדש מ-"ended" מקבלת ביקור חדש. */
function visitOf(s: DisplayedState, memory: NarrationMemory): string {
  const reentered = memory.lastPhase === 'ended' && s.phase !== 'ended';
  const base = `${s.stage}:${s.slideId}`;
  if (!reentered) {
    // אותו ביקור כל עוד הבסיס לא השתנה — כולל צעדים אחורה בתוך השקופית.
    return memory.visit.startsWith(`${base}#`) ? memory.visit : `${base}#0`;
  }
  const seq = Number(memory.visit.split('#')[1] ?? '0') + 1;
  return `${base}#${seq}`;
}

/**
 * חלק של משפט: מפתח בנק (מחרוזת), כתובת קטע ישירה ({ url }), קבוצת ניסוחים
 * חלופיים ({ variants }) שמתוכה נבחר אחד בסיבוב (ראו ambience.ts), או פתיח
 * שגורר אחריו זנב ({ pre, tail }).
 *
 * `{ pre, tail }` הוא הכול-או-כלום של שורות ה-`_pre` (ENGINE-narration.md 1.1):
 * "ההפרש בין הראשון לשני הוא" + מספר. בלי הפתיח המספר לבדו הוא ג'יבריש, ולכן
 * פתיח חסר בבנק מפיל גם את הזנב — בשונה מהכלל הרגיל, שבו כל חלק מדולג לחוד.
 */
export type NarrationPart =
  | string
  | { url: string | null }
  | { variants: readonly string[] }
  | { pre: string; tail: NarrationPart[] };

export interface NarrationEvent {
  key: string;
  parts: NarrationPart[];
  /** אירוע חד-פעמי למשחק כולו (ולא לביקור). */
  global?: boolean;
  /**
   * מזהה מצב הסיבוב של הניסוחים (ברירת מחדל: `key`). נדרש כשלכל הופעה יש
   * מפתח משלה — למשל פטפוט הלובי, שבו כל קריאה היא `lobby:n` אחר אבל כולן
   * אותו מצב ולכן מסובבות ביניהן.
   */
  situation?: string;
}

interface ResolvedParts {
  urls: string[];
  rotation: AmbienceRotation;
}

/**
 * ממיר מפתחות/כתובות/ניסוחים לרשימת כתובות; מה שחסר מדולג בשקט. מזהה מצב
 * הסיבוב הוא מפתח האירוע, ולכן לכל אירוע מונה ניסוחים משלו.
 */
function resolve(
  parts: readonly NarrationPart[],
  bank: Record<string, string>,
  situation: string,
  rotation: AmbienceRotation,
): ResolvedParts {
  const urls: string[] = [];
  let next = rotation;
  for (const part of parts) {
    if (typeof part === 'string') {
      const url = bank[part];
      if (url !== undefined && url !== '') urls.push(url);
    } else if ('variants' in part) {
      const pick = pickAmbience(situation, part.variants, bank, next);
      next = pick.rotation;
      if (pick.key !== null) urls.push(bank[pick.key]!);
    } else if ('pre' in part) {
      const head = bank[part.pre];
      if (head !== undefined && head !== '') {
        const inner = resolve(part.tail, bank, situation, next);
        next = inner.rotation;
        urls.push(head, ...inner.urls);
      }
    } else if (part.url !== null && part.url !== '') {
      urls.push(part.url);
    }
  }
  return { urls, rotation: next };
}

/** הכרזת התשובה הנכונה (הטבלה ב-2.1, שורת "התשובה הנכונה נחשפה"). */
function correctParts(s: DisplayedState): NarrationEvent['parts'] {
  if (s.slideType === 'bet') return []; // ההימור מוכרז במסך התוצאות שלו
  if (s.slideType === 'survey') return ['misc_poll_results'];
  if (s.correctClip !== null && s.correctClip !== '') {
    return ['score_correct_is', { url: s.correctClip }];
  }
  const winners = s.answers
    .map((answer, index) => ({ ...answer, position: index + 1 }))
    .filter((answer) => answer.correct);
  if (winners.length === 0) return s.majorityDecides ? ['misc_majority'] : [];
  const hasClip = (winner: { clip: string | null }) => winner.clip !== null && winner.clip !== '';
  // תשובה יחידה בלי קטע (המקרה הרגיל בתשובות-תמונה): `score_correct_number`
  // הוא כבר המשפט השלם — "התשובה הנכונה היא תשובה מספר" — ולכן הוא מחליף את
  // הפתיח ואינו מתווסף אליו. אחרת נאמר "התשובה הנכונה היא" פעמיים.
  if (!s.majorityDecides && winners.length === 1 && !hasClip(winners[0]!)) {
    return ['score_correct_number', ...numberClipKeys(winners[0]!.position, 'f')];
  }
  const head = s.majorityDecides
    ? 'misc_majority'
    : winners.length > 1
      ? 'score_correct_multi'
      : 'score_correct_is';
  const parts: NarrationEvent['parts'] = [head];
  for (const winner of winners) {
    if (hasClip(winner)) {
      parts.push({ url: winner.clip! });
    } else {
      // אין קטע לתשובה — ממשיכים את הפתיח ב"תשובה מספר N" (בלי לחזור עליו).
      parts.push('flow_answer_number', ...numberClipKeys(winner.position, 'f'));
    }
  }
  return parts;
}

/**
 * תגובת האווירה לחשיפת התשובה הנכונה (ENGINE-narration.md 1.2). שותקת
 * כשהמספרים אינם ידועים, בסקר, בשקופית הימור וכש"הרוב קובע" דולק — שם אין
 * "צדקו" ו"טעו" במובן הרגיל.
 */
function reactionParts(s: DisplayedState): NarrationPart[] | null {
  if (s.slideType === 'bet' || s.slideType === 'survey' || s.majorityDecides) return null;
  if (s.correctCount === null || s.votedCount === null || s.votedCount <= 0) return null;
  if (s.correctCount >= s.votedCount) return [{ variants: AMB_ALL_CORRECT }];
  if (s.correctCount === 0) return [{ variants: AMB_NONE_CORRECT }];
  const ratio = s.correctCount / s.votedCount;
  if (ratio > 2 / 3) return ['amb_most_correct'];
  if (ratio < 1 / 5) return ['amb_few_correct'];
  return null;
}

/**
 * האם "יאללה, מתחילים!" עדיין ממתין: או שהמעבר ממסך הפתיחה למשחק קורה בצעד
 * הזה, או שהוא זוהה קודם והקריאה טרם נאמרה (למשל בגלל מדיה חוסמת).
 */
function startPendingOf(s: DisplayedState, memory: NarrationMemory): boolean {
  const transition = memory.lastStage === 'opening' && s.stage === 'playing';
  return (memory.startPending || transition) && !memory.global.has('ambStart');
}

/** קריאת האווירה שלפני מספר השאלה — חלק מאותו משפט (ENGINE-narration.md 1.2). */
function questionAmbience(s: DisplayedState, memory: NarrationMemory): NarrationEvent | null {
  if (s.slideType === 'bet' || s.questionOrdinal <= 1) return null;
  if (s.questionTotal > 1 && s.questionOrdinal >= s.questionTotal) {
    return { key: 'ambLast', parts: ['amb_last_question'] };
  }
  // "עברנו את חצי הדרך" — פעם אחת למשחק, בשאלה הראשונה שחוצה את החצי, ורק
  // כשיש בכלל אמצע לחצות (שש שאלות ומעלה).
  if (
    !memory.global.has('ambHalf') &&
    s.questionTotal >= 6 &&
    s.questionOrdinal * 2 > s.questionTotal
  ) {
    return { key: 'ambHalf', parts: ['amb_half'], global: true };
  }
  return { key: 'ambNext', parts: [{ variants: AMB_NEXT }] };
}

/** דירוג הקבוצות (ENGINE-narration.md 1.2, שורת "מסך הקבוצות"). */
function groupParts(s: DisplayedState): NarrationPart[] | null {
  const top = s.groups[0];
  if (top === undefined) return null;
  const second = s.groups[1];
  const rawGap = second === undefined ? 0 : top.points - second.points;
  // הניקוד הקבוצתי הוא *ממוצע* ולכן שבור. מה שנאמר בקול הוא ההפרש המעוגל,
  // ואם הוא מתעגל לאפס לא אומרים "מובילה באפס נקודות" אלא את הביטוי לבדו.
  const gap = Math.round(rawGap);
  // "הקבוצות צמודות" — ההפרש קטן מעשירית מניקוד המובילה (וגם תיקו גמור).
  if (second !== undefined && rawGap <= top.points / 10) return ['amb_group_close'];
  const nameClip = s.groupClips[top.name];
  if (nameClip !== undefined && nameClip !== '') {
    return [{ pre: 'amb_group_lead_pre', tail: [{ url: nameClip }] }];
  }
  // אין קטע לשם הקבוצה: אומרים את ההפרש, ובלית ברירה את הביטוי לבדו.
  if (gap > 0) return [{ pre: 'amb_group_gap_pre', tail: pointsClipKeys(gap) }];
  return ['amb_group_lead_pre'];
}

/** כל האירועים שמתאימים למצב הנוכחי, לפי סדר ההשמעה. */
function candidates(s: DisplayedState, memory: NarrationMemory): NarrationEvent[] {
  const events: NarrationEvent[] = [];

  if (s.stage === 'opening') {
    events.push({ key: 'welcome', parts: ['flow_welcome'], global: true });
    // פטפוט הלובי: כל ~45 שניות, ובכל פעם שלישית מספר המחוברים במקום ניסוח
    // כללי. לא מתנגן מעל שכבה שאינה מוקראת או מדיה חוסמת, ונפסק ברגע
    // שהמשחק מתחיל (השלב כבר אינו 'opening').
    if (s.overlay === 'none' && s.activeMedia === null) {
      const nth = memory.lobbyLines + 1;
      if (s.lobbyElapsedMs >= nth * LOBBY_INTERVAL_MS) {
        const counted = nth % LOBBY_COUNT_EVERY === 0 && s.connectedCount > 0;
        events.push({
          key: `lobby:${memory.lobbyLines}`,
          situation: 'lobby',
          parts: counted
            ? [{ pre: 'amb_connected_pre', tail: participantsClipKeys(s.connectedCount) }]
            : [{ variants: AMB_LOBBY }],
        });
      }
    }
    return events;
  }

  if (s.stage === 'winners') {
    events.push({ key: 'winnersIntro', parts: ['amb_winners_intro'] });
    events.push({ key: 'winners', parts: ['lb_winners'] });
    // הפודיום נחשף מהמקום האחרון לראשון: בחשיפה מספר r מופיע המקום
    // total − r + 1 (ראו WinnersScreen). מקומות 4–5 שותקים.
    const total = s.winners.length;
    for (let shown = 1; shown <= s.winnersRevealed && shown <= total; shown += 1) {
      const rank = total - shown + 1;
      if (rank > 3) continue;
      const points = s.winners[rank - 1];
      if (points === undefined) continue;
      const parts: NarrationPart[] = ['amb_drumroll'];
      if (rank === 1) parts.push('lb_winner');
      parts.push(`lb_place_${rank}`, ...pointsClipKeys(points));
      if (rank === 1) parts.push('amb_congrats');
      events.push({ key: `winner:${rank}`, parts });
    }
    return events;
  }

  if (s.stage === 'scoreboard') {
    events.push({ key: 'scoreboard', parts: ['lb_title', 'flow_thanks'], global: true });
    return events;
  }

  // ---- stage === 'playing' ----

  // מדיה חוסמת על המסך, או שכבה שאינה מוקראת — שקט מוחלט.
  if (s.activeMedia !== null || s.overlay === 'other') return events;

  // "יאללה, מתחילים!" — פעם אחת למשחק, ביציאה ממסך הפתיחה. הדגל נשמר בזיכרון
  // כדי שגם מדיה חוסמת בשקופית הראשונה רק תדחה אותו ולא תבטל אותו.
  if (startPendingOf(s, memory)) {
    events.push({ key: 'ambStart', parts: [{ variants: AMB_START }], global: true });
  }

  if (s.overlay === 'betResults') {
    const parts: NarrationPart[] = ['bet_results'];
    const bet = s.bet;
    if (bet !== null) {
      const threshold = bet.leaderScore / 2;
      if (!bet.anyStake) parts.push('amb_bet_none');
      else if (bet.leaderScore > 0 && bet.biggestWin >= threshold) parts.push('amb_bet_big_win');
      else if (bet.leaderScore > 0 && bet.biggestLoss >= threshold) parts.push('amb_bet_big_loss');
    }
    events.push({ key: 'betResults', parts });
    return events;
  }

  if (s.overlay === 'leaders') {
    const parts: NarrationPart[] = ['lb_title'];
    s.leaders.slice(0, 3).forEach((points, index) => {
      parts.push(`lb_place_${index + 1}`, ...pointsClipKeys(points));
    });
    const topId = s.leaderIds[0];
    // "ניקוד יורד" נותן ניקוד שבור — אומרים את ההפרש המעוגל, ואפס אינו הפרש.
    const gap = Math.round((s.leaders[0] ?? 0) - (s.leaders[1] ?? 0));
    if (topId !== undefined && memory.topId !== null && memory.topId !== topId) {
      parts.push('amb_lead_change');
    } else if (s.leaders.length >= 2 && gap === 0) {
      parts.push('amb_tie_top');
    } else if (gap > 0) {
      parts.push({ pre: 'amb_lead_gap_pre', tail: pointsClipKeys(gap) });
    }
    events.push({ key: 'leaders', parts });
    return events;
  }

  if (s.overlay === 'groups') {
    const parts = groupParts(s);
    if (parts !== null) events.push({ key: 'groups', parts });
    return events;
  }

  if (s.overlay === 'raffle') {
    events.push({ key: 'raffle', parts: [{ variants: AMB_RAFFLE }] });
    return events;
  }

  if (s.overlay === 'board') {
    const key =
      s.boardMove === 'climb'
        ? 'amb_board_climb'
        : s.boardMove === 'fall'
          ? 'amb_board_fall'
          : 'amb_board_move';
    events.push({ key: 'board', parts: [key] });
    return events;
  }

  // שקופית פונקציה
  if (s.functionAction !== null) {
    if (s.functionAction === 'score') {
      events.push({ key: 'fn:reset', parts: ['score_reset'] });
    } else if (s.functionAction === 'players') {
      events.push({ key: 'fn:survival', parts: ['amb_surv_tension', 'surv_round'] });
      if (s.functionDone && s.remaining !== null && s.remaining > 0) {
        events.push({
          key: 'fn:remaining',
          parts: ['surv_remaining', ...participantsClipKeys(s.remaining), 'amb_surv_relief'],
        });
      }
    }
    return events;
  }

  if (!s.votable) return events;

  // השאלה מוצגת
  if (s.questionShown) {
    const ambience = questionAmbience(s, memory);
    if (ambience !== null) events.push(ambience);
    const parts: NarrationPart[] = [];
    if (s.slideType === 'bet') {
      parts.push('bet_round');
    } else if (s.announceQuestionNumber && s.questionOrdinal > 0) {
      parts.push('flow_question_number', ...numberClipKeys(s.questionOrdinal, 'f'));
    }
    parts.push({ url: s.questionClip });
    events.push({ key: 'question', parts });
  }

  // חשיפת תשובה — נאמרת האחרונה שנחשפה (חשיפה מלאה בבת אחת אינה מקריאה הכול)
  if (s.answersShown > 0) {
    const k = Math.min(s.answersShown, s.answers.length);
    const answer = s.answers[k - 1];
    if (answer !== undefined) {
      events.push({
        key: `answer:${k}`,
        parts: ['flow_answer_number', ...numberClipKeys(k, 'f'), { url: answer.clip }],
      });
    }
  }

  if (s.phase === 'voting') {
    events.push({ key: 'voteOpen', parts: ['flow_vote_open'] });
    if (s.slideType === 'bet') events.push({ key: 'ambBetBrave', parts: ['amb_bet_brave'] });
  }

  if (s.phase === 'results' && memory.lastPhase === 'voting') {
    events.push({
      key: 'voteClosed',
      parts: [s.slideType === 'bet' ? 'bet_closed' : 'timer_times_up'],
    });
  }

  if (s.phase === 'results' && s.revealCorrect) {
    const parts = correctParts(s);
    if (parts.length > 0) events.push({ key: 'correct', parts });
    const reaction = reactionParts(s);
    if (reaction !== null) events.push({ key: 'reaction', parts: reaction });
  }

  return events;
}

/**
 * הצעד הבא של הקריין. מחזיר רשימת קטעים (ריקה = אין מה לומר), דגל ביטול,
 * והזיכרון המעודכן — שיש להעביר לקריאה הבאה.
 */
export function narrationStep(s: DisplayedState, memory: NarrationMemory): NarrationDecision {
  const signature = signatureOf(s);
  const changed = signature !== memory.signature;
  const paused = s.timer?.paused === true;

  // תצוגה מקדימה של המנצחים (W) — הצצה, לא סוף המשחק. שותקים לגמרי **ובלי
  // לגעת בזיכרון**: כך הסיום האמיתי עדיין יאמר את `flow_thanks` (חד-פעמי
  // למשחק), והחזרה למשחק אינה נחשבת ביקור חדש ואינה מקריאה את השקופית שוב.
  if (s.winnersPreview) {
    return { clips: [], cancel: changed, events: [], memory: { ...memory, signature } };
  }

  // ביקור חדש = זיכרון נקי (אבל ה"פעם אחת למשחק" נשמר).
  const visit = visitOf(s, memory);
  const freshVisit = visit !== memory.visit;
  const spoken = freshVisit ? new Set<string>() : new Set(memory.spoken);
  const global = new Set(memory.global);

  // חלון הצבעה חדש מאפס את קריאות החלון ("עשר שניות", "תחשבו טוב", "מהר!").
  const reopened = s.phase === 'voting' && memory.lastPhase !== 'voting';
  const newWindow = freshVisit || reopened;
  const tenLeft = newWindow ? false : memory.tenLeft;

  const next: NarrationMemory = {
    visit,
    spoken,
    global,
    signature,
    tenLeft,
    lastPhase: s.phase,
    lastPaused: paused,
    rotation: memory.rotation,
    lobbyLines: memory.lobbyLines,
    lastStage: s.stage,
    // המעבר ממסך הפתיחה למשחק — נזכר עד ש"מתחילים!" באמת נאמר (פעם אחת למשחק).
    startPending: startPendingOf(s, memory),
    topId: memory.topId,
    ambVoting: newWindow ? false : memory.ambVoting,
    ambHurry: newWindow ? false : memory.ambHurry,
  };

  // קריינות כבויה/מושתקת — שקט מוחלט, בלי לזכור דבר.
  if (!s.enabled) {
    return { clips: [], cancel: changed, events: [], memory: next };
  }

  const clips: string[] = [];
  const events: string[] = [];

  // עצירה/המשך של הטיימר — אירוע מעבר, לא "פעם אחת בביקור".
  if (s.stage === 'playing' && s.phase === 'voting' && paused !== memory.lastPaused) {
    const key = paused ? 'timer_paused' : 'timer_resumed';
    const url = s.bank[key];
    if (url !== undefined && url !== '') clips.push(url);
    events.push(paused ? 'paused' : 'resumed');
  } else {
    for (const event of candidates(s, memory)) {
      const seen = event.global === true ? global : spoken;
      if (seen.has(event.key)) continue;
      seen.add(event.key);
      // תשובות קודמות שדולגו (חשיפה מלאה בבת אחת) נחשבות כאילו נאמרו, כדי
      // שצעד אחורה וקדימה לא יקריא אותן עכשיו.
      if (event.key.startsWith('answer:')) {
        const k = Number(event.key.slice('answer:'.length));
        for (let i = 1; i < k; i += 1) spoken.add(`answer:${i}`);
      }
      // פטפוט הלובי מתקדם בכל פעם שהגיע תורו — גם כשאין לו קטע בבנק, אחרת
      // אותה קריאה הייתה נתקעת ולא הייתה מגיעה אף פעם לקריאה הבאה.
      if (event.key.startsWith('lobby:')) next.lobbyLines = memory.lobbyLines + 1;
      if (event.key === 'ambStart') next.startPending = false;
      if (event.key === 'leaders') next.topId = s.leaderIds[0] ?? next.topId;
      const resolved = resolve(event.parts, s.bank, event.situation ?? event.key, next.rotation);
      next.rotation = resolved.rotation;
      if (resolved.urls.length === 0) continue; // אין ולו קטע אחד — מדלגים בשקט
      clips.push(...resolved.urls);
      events.push(event.key);
    }

    /** קריאות שתלויות בשעון ההצבעה — רק כשההצבעה באמת פתוחה ורצה על המסך. */
    const timerRunning =
      s.stage === 'playing' &&
      s.phase === 'voting' &&
      s.overlay === 'none' &&
      s.activeMedia === null &&
      s.timer !== null &&
      !s.timer.paused;

    // "עשר שניות אחרונות" — רק כשהזמן הכולל ≥ 20, פעם אחת לכל חלון הצבעה.
    let saidTenLeft = false;
    if (
      clips.length === 0 &&
      timerRunning &&
      !tenLeft &&
      s.timer!.total >= 20 &&
      s.timer!.remaining <= 10
    ) {
      next.tenLeft = true;
      saidTenLeft = true;
      const url = s.bank['timer_ten_left'];
      if (url !== undefined && url !== '') {
        clips.push(url);
        events.push('tenLeft');
      }
    }

    // "מהר!" — בשניות האחרונות. כששתי הקריאות נופלות על אותו צעד, "עשר שניות
    // אחרונות" מנצח ו-amb_hurry נופל (ENGINE-narration.md 1.2).
    if (timerRunning && !next.ambHurry && s.timer!.remaining <= HURRY_SECONDS) {
      if (saidTenLeft) {
        next.ambHurry = true;
      } else if (clips.length === 0) {
        next.ambHurry = true;
        next.ambVoting = true; // החלון נגמר — "תחשבו טוב" כבר לא רלוונטי
        const url = s.bank['amb_hurry'];
        if (url !== undefined && url !== '') {
          clips.push(url);
          events.push('ambHurry');
        }
      }
    }

    // "תחשבו טוב" — פעם אחת בחלון, אחרי שחלף חצי מזמן ההצבעה.
    if (
      clips.length === 0 &&
      timerRunning &&
      !next.ambVoting &&
      s.timer!.total > 0 &&
      s.timer!.remaining <= s.timer!.total / 2 &&
      s.timer!.remaining > HURRY_SECONDS
    ) {
      next.ambVoting = true;
      const pick = pickAmbience('ambVoting', AMB_VOTING, s.bank, next.rotation);
      next.rotation = pick.rotation;
      if (pick.key !== null) {
        clips.push(s.bank[pick.key]!);
        events.push('ambVoting');
      }
    }
  }

  return { clips, cancel: changed || clips.length > 0, events, memory: next };
}
