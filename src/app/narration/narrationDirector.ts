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

/** השלב החיצוני של ה-host (HostStage ב-GameHost). */
export type NarrationStage = 'opening' | 'playing' | 'winners' | 'scoreboard';

/** פאזת המנוע. */
export type NarrationPhase = 'showing' | 'voting' | 'results' | 'ended';

/**
 * איזו שכבה פתוחה מעל המשחק: שתיים מהן מוקראות, וכל השאר (תפריט, הגדרות,
 * שמות, לובי, הגרלה, קליטת שלטים, התחברות לקבוצות, פירוט הצבעות, לוח) מחייבות
 * שקט מוחלט — המשחק עומד, והקריין אינו מדבר על מסך אחר.
 */
export type NarrationOverlay = 'none' | 'leaders' | 'betResults' | 'other';

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

export interface NarrationEvent {
  key: string;
  /** מפתחות בנק (מחרוזת) או כתובות קטע ישירות ({ url }). */
  parts: (string | { url: string | null })[];
  /** אירוע חד-פעמי למשחק כולו (ולא לביקור). */
  global?: boolean;
}

/** ממיר מפתחות/כתובות לרשימת כתובות; מה שחסר מדולג בשקט. */
function resolve(parts: NarrationEvent['parts'], bank: Record<string, string>): string[] {
  const out: string[] = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      const url = bank[part];
      if (url !== undefined && url !== '') out.push(url);
    } else if (part.url !== null && part.url !== '') {
      out.push(part.url);
    }
  }
  return out;
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
  const head = s.majorityDecides
    ? 'misc_majority'
    : winners.length > 1
      ? 'score_correct_multi'
      : 'score_correct_is';
  const parts: NarrationEvent['parts'] = [head];
  for (const winner of winners) {
    if (winner.clip !== null && winner.clip !== '') {
      parts.push({ url: winner.clip });
    } else {
      // אין קטע לתשובה (למשל תשובות-תמונה) — אומרים את מספרה.
      parts.push('score_correct_number', ...numberClipKeys(winner.position, 'f'));
    }
  }
  return parts;
}

/** כל האירועים שמתאימים למצב הנוכחי, לפי סדר ההשמעה. */
function candidates(s: DisplayedState, memory: NarrationMemory): NarrationEvent[] {
  const events: NarrationEvent[] = [];

  if (s.stage === 'opening') {
    events.push({ key: 'welcome', parts: ['flow_welcome'], global: true });
    return events;
  }

  if (s.stage === 'winners') {
    events.push({ key: 'winners', parts: ['lb_winners'] });
    // הפודיום נחשף מהמקום האחרון לראשון: בחשיפה מספר r מופיע המקום
    // total − r + 1 (ראו WinnersScreen). מקומות 4–5 שותקים.
    const total = s.winners.length;
    for (let shown = 1; shown <= s.winnersRevealed && shown <= total; shown += 1) {
      const rank = total - shown + 1;
      if (rank > 3) continue;
      const points = s.winners[rank - 1];
      if (points === undefined) continue;
      const parts: NarrationEvent['parts'] = [];
      if (rank === 1) parts.push('lb_winner');
      parts.push(`lb_place_${rank}`, ...pointsClipKeys(points));
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

  if (s.overlay === 'betResults') {
    events.push({ key: 'betResults', parts: ['bet_results'] });
    return events;
  }

  if (s.overlay === 'leaders') {
    const parts: NarrationEvent['parts'] = ['lb_title'];
    s.leaders.slice(0, 3).forEach((points, index) => {
      parts.push(`lb_place_${index + 1}`, ...pointsClipKeys(points));
    });
    events.push({ key: 'leaders', parts });
    return events;
  }

  // שקופית פונקציה
  if (s.functionAction !== null) {
    if (s.functionAction === 'score') {
      events.push({ key: 'fn:reset', parts: ['score_reset'] });
    } else if (s.functionAction === 'players') {
      events.push({ key: 'fn:survival', parts: ['surv_round'] });
      if (s.functionDone && s.remaining !== null && s.remaining > 0) {
        events.push({
          key: 'fn:remaining',
          parts: ['surv_remaining', ...participantsClipKeys(s.remaining)],
        });
      }
    }
    return events;
  }

  if (!s.votable) return events;

  // השאלה מוצגת
  if (s.questionShown) {
    const parts: NarrationEvent['parts'] = [];
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

  // ביקור חדש = זיכרון נקי (אבל ה"פעם אחת למשחק" נשמר).
  const visit = visitOf(s, memory);
  const freshVisit = visit !== memory.visit;
  const spoken = freshVisit ? new Set<string>() : new Set(memory.spoken);
  const global = new Set(memory.global);

  // חלון הצבעה חדש מאפס את הנעילה של "עשר שניות אחרונות".
  const reopened = s.phase === 'voting' && memory.lastPhase !== 'voting';
  const tenLeft = freshVisit || reopened ? false : memory.tenLeft;

  const next: NarrationMemory = {
    visit,
    spoken,
    global,
    signature,
    tenLeft,
    lastPhase: s.phase,
    lastPaused: paused,
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
      const resolved = resolve(event.parts, s.bank);
      if (resolved.length === 0) continue; // אין ולו קטע אחד — מדלגים בשקט
      clips.push(...resolved);
      events.push(event.key);
    }

    // "עשר שניות אחרונות" — רק כשהזמן הכולל ≥ 20, פעם אחת לכל חלון הצבעה.
    if (
      clips.length === 0 &&
      s.stage === 'playing' &&
      s.phase === 'voting' &&
      s.overlay === 'none' &&
      s.activeMedia === null &&
      !tenLeft &&
      s.timer !== null &&
      s.timer.total >= 20 &&
      s.timer.remaining <= 10 &&
      !s.timer.paused
    ) {
      next.tenLeft = true;
      const url = s.bank['timer_ten_left'];
      if (url !== undefined && url !== '') {
        clips.push(url);
        events.push('tenLeft');
      }
    }
  }

  return { clips, cancel: changed || clips.length > 0, events, memory: next };
}
