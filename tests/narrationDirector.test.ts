/**
 * הבמאי של הקריינות — הטבלה ב-ENGINE-narration.md 2.1, כלל אחר כלל.
 *
 * שלושת הכללים שנבדקים כאן שוב ושוב: הקריינות נגררת אחרי המסך (כל שינוי
 * מבטל), אינה חוזרת על עצמה בתוך ביקור בשקופית, ולעולם אינה חוסמת (מפתח בנק
 * חסר או קטע null מדולגים).
 */

import { describe, expect, it } from 'vitest';
import {
  emptyNarrationMemory,
  narrationStep,
  type DisplayedState,
  type NarrationDecision,
  type NarrationMemory,
} from '../src/app/narration/narrationDirector.ts';

/** בנק "מלא": כל מפתח מחזיר קובץ בשם שלו — כך הבדיקות קריאות. */
const BANK = new Proxy(
  {},
  { get: (_target, key: string) => `${key}.mp3` },
) as Record<string, string>;

function base(over: Partial<DisplayedState> = {}): DisplayedState {
  return {
    stage: 'playing',
    phase: 'showing',
    slideId: 1,
    slideType: 'trivia',
    votable: true,
    questionOrdinal: 1,
    answers: [
      { correct: true, clip: 'ans1.mp3' },
      { correct: false, clip: 'ans2.mp3' },
    ],
    questionClip: 'q1.mp3',
    correctClip: null,
    majorityDecides: false,
    activeMedia: null,
    questionShown: false,
    answersShown: 0,
    revealCorrect: false,
    timer: null,
    overlay: 'none',
    leaders: [],
    winners: [],
    winnersRevealed: 0,
    functionAction: null,
    functionDone: false,
    remaining: null,
    announceQuestionNumber: true,
    enabled: true,
    bank: BANK,
    ...over,
  };
}

/** מריץ רצף מצבים ומחזיר את ההחלטות, עם זיכרון שנשמר ביניהן. */
function runSteps(states: DisplayedState[], from = emptyNarrationMemory()): NarrationDecision[] {
  let memory: NarrationMemory = from;
  const decisions: NarrationDecision[] = [];
  for (const state of states) {
    const decision = narrationStep(state, memory);
    memory = decision.memory;
    decisions.push(decision);
  }
  return decisions;
}

const clipsOf = (states: DisplayedState[]) => runSteps(states).map((d) => d.clips);

describe('הצגת השאלה', () => {
  it('★ שאלה מוצגת → "שאלה מספר" + המספר + נוסח השאלה', () => {
    const [d] = runSteps([base({ questionShown: true })]);
    expect(d!.clips).toEqual(['flow_question_number.mp3', 'num_f_1.mp3', 'q1.mp3']);
  });

  it('כשההכרזה כבויה — רק נוסח השאלה', () => {
    const [d] = runSteps([base({ questionShown: true, announceQuestionNumber: false })]);
    expect(d!.clips).toEqual(['q1.mp3']);
  });

  it('שקופית שאינה שאלה (הימור) אינה מקבלת מספר — אלא "סיבוב הימורים"', () => {
    const [d] = runSteps([
      base({ slideType: 'bet', questionOrdinal: 0, questionShown: true, questionClip: 'bet.mp3' }),
    ]);
    expect(d!.clips).toEqual(['bet_round.mp3', 'bet.mp3']);
  });

  it('★ אותו מצב פעמיים — אין מה לומר בפעם השנייה', () => {
    const state = base({ questionShown: true });
    expect(clipsOf([state, state])).toEqual([
      ['flow_question_number.mp3', 'num_f_1.mp3', 'q1.mp3'],
      [],
    ]);
  });
});

describe('חשיפת תשובות', () => {
  it('★ תשובה k → "תשובה מספר" + k + הקטע של התשובה', () => {
    const states = [
      base({ questionShown: true }),
      base({ questionShown: true, answersShown: 1 }),
      base({ questionShown: true, answersShown: 2 }),
    ];
    expect(clipsOf(states).slice(1)).toEqual([
      ['flow_answer_number.mp3', 'num_f_1.mp3', 'ans1.mp3'],
      ['flow_answer_number.mp3', 'num_f_2.mp3', 'ans2.mp3'],
    ]);
  });

  it('תשובה בלי קטע (תשובות-תמונה) — אומרים את המספר בלבד', () => {
    const answers = [
      { correct: true, clip: null },
      { correct: false, clip: null },
    ];
    const [, d] = runSteps([
      base({ questionShown: true, answers }),
      base({ questionShown: true, answersShown: 1, answers }),
    ]);
    expect(d!.clips).toEqual(['flow_answer_number.mp3', 'num_f_1.mp3']);
  });

  it('★ צעד אחורה וקדימה אינו מקריא שוב', () => {
    const states = [
      base({ questionShown: true, answersShown: 1 }),
      base({ questionShown: true, answersShown: 2 }),
      base({ questionShown: true, answersShown: 1 }), // אחורה
      base({ questionShown: true, answersShown: 2 }), // וקדימה
    ];
    const clips = clipsOf(states);
    expect(clips[1]).toHaveLength(3);
    expect(clips[2]).toEqual([]);
    expect(clips[3]).toEqual([]);
  });

  it('חשיפה מלאה בבת אחת (מקש N) אומרת רק את האחרונה', () => {
    const [, d] = runSteps([
      base({ questionShown: true }),
      base({ questionShown: true, answersShown: 2 }),
    ]);
    expect(d!.clips).toEqual(['flow_answer_number.mp3', 'num_f_2.mp3', 'ans2.mp3']);
  });

  it('★ שקופית אחרת = ביקור חדש — והשאלה מוקראת שוב', () => {
    const states = [
      base({ questionShown: true }),
      base({ slideId: 2, questionOrdinal: 2, questionShown: true, questionClip: 'q2.mp3' }),
    ];
    expect(clipsOf(states)[1]).toEqual(['flow_question_number.mp3', 'num_f_2.mp3', 'q2.mp3']);
  });
});

describe('הצבעה וטיימר', () => {
  const opened = base({ questionShown: true, answersShown: 2, phase: 'voting' });

  it('★ ההצבעה נפתחה → "הצביעו עכשיו"', () => {
    const [, d] = runSteps([base({ questionShown: true, answersShown: 2 }), opened]);
    expect(d!.clips).toEqual(['flow_vote_open.mp3']);
  });

  it('★ עשר שניות אחרונות — פעם אחת, ורק כשהזמן הכולל ≥ 20', () => {
    const tick = (remaining: number, total = 30) =>
      base({ ...opened, timer: { remaining, total, paused: false } });
    const clips = clipsOf([tick(30), tick(12), tick(9.8), tick(8), tick(4)]);
    expect(clips[2]).toEqual(['timer_ten_left.mp3']);
    expect(clips[3]).toEqual([]);
    expect(clips[4]).toEqual([]);
  });

  it('טיימר קצר (15 שניות) — לא מכריזים "עשר שניות"', () => {
    const tick = (remaining: number) =>
      base({ ...opened, timer: { remaining, total: 15, paused: false } });
    expect(clipsOf([tick(15), tick(9), tick(3)]).flat()).not.toContain('timer_ten_left.mp3');
  });

  it('חלון הצבעה חדש מאפס את הנעילה של "עשר שניות"', () => {
    const tick = (remaining: number) =>
      base({ ...opened, timer: { remaining, total: 30, paused: false } });
    const back = base({ questionShown: true, answersShown: 2 }); // חזרה לפני ההצבעה
    const clips = clipsOf([tick(30), tick(5), back, tick(30), tick(5)]);
    expect(clips[1]).toEqual(['timer_ten_left.mp3']);
    expect(clips[4]).toEqual(['timer_ten_left.mp3']);
  });

  it('עצירה והמשך של המנחה', () => {
    const tick = (paused: boolean) =>
      base({ ...opened, timer: { remaining: 20, total: 30, paused } });
    const clips = clipsOf([tick(false), tick(true), tick(false)]);
    expect(clips[1]).toEqual(['timer_paused.mp3']);
    expect(clips[2]).toEqual(['timer_resumed.mp3']);
  });

  it('★ ההצבעה נסגרה → "הזמן נגמר"; בהימור → "ההימור נסגר"', () => {
    const closed = base({ questionShown: true, answersShown: 2, phase: 'results' });
    expect(clipsOf([opened, closed])[1]).toEqual(['timer_times_up.mp3']);
    const betOpen = base({ ...opened, slideType: 'bet', questionOrdinal: 0 });
    const betClosed = base({ ...closed, slideType: 'bet', questionOrdinal: 0 });
    expect(clipsOf([betOpen, betClosed])[1]).toEqual(['bet_closed.mp3']);
  });
});

describe('חשיפת התשובה הנכונה', () => {
  const results = (over: Partial<DisplayedState> = {}) =>
    base({ questionShown: true, answersShown: 2, phase: 'results', ...over });

  it('★ תשובה נכונה אחת → "התשובה הנכונה היא" + הקטע שלה', () => {
    const [, d] = runSteps([results(), results({ revealCorrect: true })]);
    expect(d!.clips).toEqual(['score_correct_is.mp3', 'ans1.mp3']);
  });

  it('★ בחירה מרובה → "התשובות הנכונות הן" + כל הקטעים', () => {
    const answers = [
      { correct: true, clip: 'ans1.mp3' },
      { correct: true, clip: 'ans2.mp3' },
    ];
    const [, d] = runSteps([results({ answers }), results({ revealCorrect: true, answers })]);
    expect(d!.clips).toEqual(['score_correct_multi.mp3', 'ans1.mp3', 'ans2.mp3']);
  });

  it('★ תשובה נכונה בלי קטע (תשובות-תמונה) → מספרה', () => {
    const answers = [
      { correct: false, clip: null },
      { correct: true, clip: null },
    ];
    const [, d] = runSteps([
      results({ answers, slideType: 'ans_images' }),
      results({ revealCorrect: true, answers, slideType: 'ans_images' }),
    ]);
    expect(d!.clips).toEqual(['score_correct_is.mp3', 'score_correct_number.mp3', 'num_f_2.mp3']);
  });

  it('★ סקר → "תוצאות הסקר" בלבד', () => {
    const [, d] = runSteps([
      results({ slideType: 'survey' }),
      results({ revealCorrect: true, slideType: 'survey' }),
    ]);
    expect(d!.clips).toEqual(['misc_poll_results.mp3']);
  });

  it('★ "הרוב קובע" → "הרוב קובע" + התשובה שנבחרה', () => {
    const [, d] = runSteps([
      results({ majorityDecides: true }),
      results({ revealCorrect: true, majorityDecides: true }),
    ]);
    expect(d!.clips).toEqual(['misc_majority.mp3', 'ans1.mp3']);
  });

  it('שקופית הימור — אין הכרזת תשובה נכונה', () => {
    const [, d] = runSteps([
      results({ slideType: 'bet', questionOrdinal: 0 }),
      results({ revealCorrect: true, slideType: 'bet', questionOrdinal: 0 }),
    ]);
    expect(d!.clips).toEqual([]);
  });

  it('קטע "תשובה נכונה" מוכן בקובץ גובר על הרכבת הקטעים', () => {
    const [, d] = runSteps([
      results({ correctClip: 'correct.mp3' }),
      results({ revealCorrect: true, correctClip: 'correct.mp3' }),
    ]);
    expect(d!.clips).toEqual(['score_correct_is.mp3', 'correct.mp3']);
  });
});

describe('שכבות מעל המשחק', () => {
  it('★ מסך המובילים → "לוח המובילים" + שלושת הראשונים עם הניקוד', () => {
    const [d] = runSteps([base({ overlay: 'leaders', leaders: [1000, 2, 1] })]);
    expect(d!.clips).toEqual([
      'lb_title.mp3',
      'lb_place_1.mp3',
      'thousands_1000.mp3',
      'unit_points.mp3',
      'lb_place_2.mp3',
      'num_f_2_construct.mp3',
      'unit_points.mp3',
      'lb_place_3.mp3',
      'unit_point_one.mp3',
    ]);
  });

  it('★ מסך תוצאות ההימור → "תוצאות ההימור"', () => {
    const [d] = runSteps([base({ overlay: 'betResults' })]);
    expect(d!.clips).toEqual(['bet_results.mp3']);
  });

  it('★ שכבה שאינה מוקראת (תפריט/הגדרות/הגרלה) — שקט, וביטול של מה שמתנגן', () => {
    const [, d] = runSteps([base({ questionShown: true }), base({ questionShown: true, overlay: 'other' })]);
    expect(d!.clips).toEqual([]);
    expect(d!.cancel).toBe(true);
  });

  it('★ מדיה חוסמת — שקט מוחלט', () => {
    const [d] = runSteps([base({ questionShown: true, activeMedia: 'open' })]);
    expect(d!.clips).toEqual([]);
  });
});

describe('מסכי הפתיחה, המנצחים והניקוד', () => {
  it('★ מסך פתיחה → "ברוכים הבאים", פעם אחת למשחק', () => {
    const clips = clipsOf([
      base({ stage: 'opening' }),
      base({ stage: 'opening' }),
      base({ questionShown: true }),
      base({ stage: 'opening' }),
    ]);
    expect(clips[0]).toEqual(['flow_welcome.mp3']);
    expect(clips[1]).toEqual([]);
    expect(clips[3]).toEqual([]);
  });

  it('★ מסך המנצחים: הכרזה בכניסה, ואז מקום-מקום מהאחרון לראשון', () => {
    const winners = [100, 90, 80, 70, 60];
    const at = (revealed: number) =>
      base({ stage: 'winners', winners, winnersRevealed: revealed });
    const clips = clipsOf([at(0), at(1), at(2), at(3), at(4), at(5)]);
    expect(clips[0]).toEqual(['lb_winners.mp3']);
    expect(clips[1]).toEqual([]); // מקום 5 — שותק
    expect(clips[2]).toEqual([]); // מקום 4 — שותק
    expect(clips[3]).toEqual(['lb_place_3.mp3', 'tens_80.mp3', 'unit_points.mp3']);
    expect(clips[4]).toEqual(['lb_place_2.mp3', 'tens_90.mp3', 'unit_points.mp3']);
    expect(clips[5]).toEqual([
      'lb_winner.mp3',
      'lb_place_1.mp3',
      'hundreds_100.mp3',
      'unit_points.mp3',
    ]);
  });

  it('★ לוח הניקוד המלא → "לוח המובילים" + "תודה שהשתתפתם"', () => {
    const [d] = runSteps([base({ stage: 'scoreboard' })]);
    expect(d!.clips).toEqual(['lb_title.mp3', 'flow_thanks.mp3']);
  });
});

describe('שקופיות פונקציה', () => {
  it('★ איפוס ניקוד → "הניקוד מתאפס"', () => {
    const [d] = runSteps([
      base({ slideType: 'function', votable: false, questionOrdinal: 0, functionAction: 'score' }),
    ]);
    expect(d!.clips).toEqual(['score_reset.mp3']);
  });

  it('★ הישרדות → "סיבוב הישרדות", ואחרי ההסרה "נשארו במשחק" + מספר', () => {
    const survival = (over: Partial<DisplayedState> = {}) =>
      base({
        slideType: 'function',
        votable: false,
        questionOrdinal: 0,
        functionAction: 'players',
        ...over,
      });
    const clips = clipsOf([survival(), survival({ functionDone: true, remaining: 12 })]);
    expect(clips[0]).toEqual(['surv_round.mp3']);
    expect(clips[1]).toEqual(['surv_remaining.mp3', 'num_m_12.mp3', 'unit_participants.mp3']);
  });

  it('שקופית API — שקט', () => {
    const [d] = runSteps([
      base({ slideType: 'function', votable: false, questionOrdinal: 0, functionAction: 'api' }),
    ]);
    expect(d!.clips).toEqual([]);
  });
});

describe('כללי הזהב', () => {
  it('★ קריינות כבויה/מושתקת — שקט מוחלט', () => {
    const [d] = runSteps([base({ questionShown: true, enabled: false })]);
    expect(d!.clips).toEqual([]);
  });

  it('★ מפתח בנק חסר מדולג — והמשפט ממשיך', () => {
    const bank = { flow_question_number: 'qn.mp3' }; // בלי num_f_1
    const [d] = runSteps([base({ questionShown: true, bank })]);
    expect(d!.clips).toEqual(['qn.mp3', 'q1.mp3']);
  });

  it('אין ולו קטע אחד — לא אומרים כלום (ולא מבטלים סתם)', () => {
    const [d] = runSteps([base({ questionShown: true, bank: {}, questionClip: null })]);
    expect(d!.clips).toEqual([]);
  });

  it('★ כל שינוי במצב המוצג מבטל את מה שמתנגן', () => {
    const decisions = runSteps([
      base({ questionShown: true }),
      base({ questionShown: true }), // אותו מצב — אין ביטול
      base({ questionShown: true, answersShown: 1 }),
    ]);
    expect(decisions[0]!.cancel).toBe(true);
    expect(decisions[1]!.cancel).toBe(false);
    expect(decisions[2]!.cancel).toBe(true);
  });

  it('שינוי שאין לו קריינות (למשל פתיחת תפריט) עדיין משתיק', () => {
    const decisions = runSteps([
      base({ questionShown: true }),
      base({ questionShown: true, overlay: 'other' }),
      base({ questionShown: true, overlay: 'other' }),
    ]);
    expect(decisions[1]).toMatchObject({ clips: [], cancel: true });
    expect(decisions[2]).toMatchObject({ clips: [], cancel: false });
  });

  it('כניסה מחדש לשקופית אחרי סוף המשחק = ביקור חדש', () => {
    const clips = clipsOf([
      base({ questionShown: true }),
      base({ questionShown: true, phase: 'ended' }),
      base({ questionShown: true }),
    ]);
    expect(clips[2]).toEqual(['flow_question_number.mp3', 'num_f_1.mp3', 'q1.mp3']);
  });
});
