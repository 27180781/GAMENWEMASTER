/**
 * בדיקות לפס הקבוצות שבצד מסך השאלה (groupRail.ts): מה מוצג בכל שלב, מתוך
 * מי מחושבים האחוזים, הסדר (כולל הבונוס), שקופית שמוגבלת לקבוצה, והגבלת
 * מספר השורות. וגם engine.getLiveVoters, שממנו הפס יודע מי הצביע בזמן ההצבעה.
 */

import { describe, expect, it } from 'vitest';
import { GameEngine, type GamePhase, type Slide } from '../src/engine/index.ts';
import {
  GROUP_RAIL_MAX,
  buildGroupRail,
  groupRailAvailable,
  groupRailMode,
  presentPlayers,
  type GroupRailInput,
} from '../src/app/groupRail.ts';
import {
  EMPTY_ROSTER,
  addCategory,
  addGroup,
  assignGroupByNumber,
  type RosterData,
} from '../src/app/roster.ts';
import { fourAnswers, makeGame, makeSnapshot, rawSlide } from './helpers.ts';

/** שתי קבוצות: «אדומים» (a, b, c, d) ו«כחולים» (e, f). */
function roster(): RosterData {
  let r = addCategory(EMPTY_ROSTER, 'צבעים', 'cat1');
  r = addGroup(r, 'cat1', 'אדומים', 'red');
  r = addGroup(r, 'cat1', 'כחולים', 'blue');
  for (const id of ['a', 'b', 'c', 'd']) r = assignGroupByNumber(r, id, 'cat1', 1);
  for (const id of ['e', 'f']) r = assignGroupByNumber(r, id, 'cat1', 2);
  return r;
}

function slideOf(spec: Parameters<typeof rawSlide>[0]): Slide {
  return makeGame([rawSlide(spec)]).questions[0]!;
}

const TRIVIA = slideOf({ id: 1, type: 'trivia', que: 'שאלה', answers: fourAnswers(2) });
const SURVEY = slideOf({ id: 1, type: 'survey', que: 'סקר', answers: fourAnswers(0) });
const SURVEY_LIVE = slideOf({
  id: 1,
  type: 'survey',
  que: 'סקר',
  answers: fourAnswers(0),
  settings: { liveVoteCounts: true },
});

function input(overrides: Partial<GroupRailInput> = {}): GroupRailInput {
  return {
    roster: roster(),
    categoryIndex: 0,
    slide: TRIVIA,
    phase: 'voting',
    revealCorrect: false,
    votes: null,
    scores: {},
    answerTimes: {},
    ...overrides,
  };
}

describe('groupRailMode — מה הפס מראה בכל שלב', () => {
  const cases: [string, Slide, GamePhase, boolean, string][] = [
    ['לפני ההצבעה — דירוג', TRIVIA, 'showing', false, 'standings'],
    ['טריוויה בזמן ההצבעה — כמה ענו, לא כמה צדקו', TRIVIA, 'voting', false, 'answered'],
    ['אחרי הסגירה ולפני החשיפה — עדיין כמה ענו', TRIVIA, 'results', false, 'answered'],
    ['טריוויה בחשיפה — כמה צדקו', TRIVIA, 'results', true, 'correct'],
    ['סקר בזמן ההצבעה בלי מונה חי — כמה ענו', SURVEY, 'voting', false, 'answered'],
    ['סקר עם מונה חי — העוגה חיה כבר בהצבעה', SURVEY_LIVE, 'voting', false, 'split'],
    ['סקר בחשיפה — עוגה', SURVEY, 'results', true, 'split'],
  ];
  for (const [name, slide, phase, revealed, mode] of cases) {
    it(name, () => expect(groupRailMode(slide, phase, revealed)).toBe(mode));
  }

  it('תשובה כתמונה שכל התמונות בה מסומנות נכונות — עוגה, כי אין נכונה להצביע עליה', () => {
    const legacy = slideOf({
      id: 1,
      type: 'ans_images',
      que: 'תמונות',
      answers: [1, 2, 3].map((id) => ({ ans: `img${id}.png`, correct: true, id })),
    });
    expect(groupRailMode(legacy, 'results', true)).toBe('split');
  });
});

describe('buildGroupRail — מתי אין פס', () => {
  it('בלי קבוצות', () => {
    expect(buildGroupRail(input({ roster: EMPTY_ROSTER }))).toBeNull();
  });

  it('קבוצה אחת בלבד', () => {
    let r = addCategory(EMPTY_ROSTER, 'צבעים', 'cat1');
    r = addGroup(r, 'cat1', 'אדומים', 'red');
    r = assignGroupByNumber(r, 'a', 'cat1', 1);
    expect(buildGroupRail(input({ roster: r }))).toBeNull();
  });

  it('קבוצות בלי אף חבר', () => {
    let r = addCategory(EMPTY_ROSTER, 'צבעים', 'cat1');
    r = addGroup(r, 'cat1', 'אדומים', 'red');
    r = addGroup(r, 'cat1', 'כחולים', 'blue');
    expect(buildGroupRail(input({ roster: r }))).toBeNull();
  });

  it('בסולמות וחבלים — הלוח הוא הדירוג', () => {
    expect(buildGroupRail(input({ gameType: 'snakes_ladders_team' }))).toBeNull();
  });

  it('שקופית טקסט', () => {
    const subject = slideOf({ id: 1, type: 'subject', que: 'סבב שני' });
    expect(buildGroupRail(input({ slide: subject, phase: 'showing' }))).toBeNull();
  });
});

describe('buildGroupRail — האחוזים', () => {
  it('בזמן ההצבעה: כמה מחברי הקבוצה כבר ענו', () => {
    const rail = buildGroupRail(input({ votes: { a: 2, b: 1, e: 3 } }))!;
    const red = rail.rows.find((r) => r.groupId === 'red')!;
    const blue = rail.rows.find((r) => r.groupId === 'blue')!;
    expect(rail.mode).toBe('answered');
    expect(red).toMatchObject({ members: 4, voted: 2, pct: 50, split: null });
    expect(blue).toMatchObject({ members: 2, voted: 1, pct: 50 });
  });

  it('בחשיפה: כמה מחברי הקבוצה צדקו (מי שלא ענה — לא צדק)', () => {
    const rail = buildGroupRail(
      input({ phase: 'results', revealCorrect: true, votes: { a: 2, b: 2, c: 1, e: 2, f: 4 } }),
    )!;
    expect(rail.mode).toBe('correct');
    expect(rail.rows.find((r) => r.groupId === 'red')).toMatchObject({ voted: 3, pct: 50 });
    expect(rail.rows.find((r) => r.groupId === 'blue')).toMatchObject({ voted: 2, pct: 50 });
  });

  it('מתוך מי שנמצא במשחק: רשום שלא לחץ אף פעם לא מוריד לקבוצה אחוזים', () => {
    const rail = buildGroupRail(
      input({
        phase: 'results',
        revealCorrect: true,
        votes: { a: 2, b: 2 },
        present: new Set(['a', 'b', 'c', 'e', 'f']),
      }),
    )!;
    // d רשום באדומים ולא נמצא: 2 צדקו מתוך 3 שנמצאים
    expect(rail.rows.find((r) => r.groupId === 'red')).toMatchObject({ members: 3, pct: 67 });
  });

  it('מי שמצביע עכשיו נחשב נמצא, גם אם עוד לא נרשם כמחובר', () => {
    const rail = buildGroupRail(input({ votes: { d: 1 }, present: new Set(['a']) }))!;
    expect(rail.rows.find((r) => r.groupId === 'red')).toMatchObject({ members: 2, voted: 1, pct: 50 });
  });

  it('קבוצה שאף אחד ממנה לא נמצא — בלי אחוז (ולא 0%)', () => {
    const rail = buildGroupRail(input({ votes: { a: 1 }, present: new Set(['a']) }))!;
    expect(rail.rows.find((r) => r.groupId === 'blue')).toMatchObject({ members: 0, pct: null });
  });

  it('סקר בחשיפה: כמה מכל קבוצה בחרו בכל תשובה, לפי סדר התשובות', () => {
    const rail = buildGroupRail(
      input({ slide: SURVEY, phase: 'results', revealCorrect: true, votes: { a: 1, b: 1, c: 4, e: 2 } }),
    )!;
    expect(rail.mode).toBe('split');
    expect(rail.rows.find((r) => r.groupId === 'red')).toMatchObject({ split: [2, 0, 0, 1], pct: null });
    expect(rail.rows.find((r) => r.groupId === 'blue')).toMatchObject({ split: [0, 1, 0, 0] });
  });

  it('לפני ההצבעה: רק הדירוג, בלי אחוזים ובלי עוגה', () => {
    const rail = buildGroupRail(input({ phase: 'showing' }))!;
    expect(rail.mode).toBe('standings');
    for (const row of rail.rows) expect(row).toMatchObject({ pct: null, split: null });
  });
});

describe('buildGroupRail — הסדר', () => {
  it('לפי ממוצע החברים, ובונוס הקבוצה נספר — כמו מסך הקבוצות (מקש 4)', () => {
    const scores = { a: 10, b: 10, c: 10, d: 10, e: 8, f: 8 };
    const plain = buildGroupRail(input({ scores }))!;
    expect(plain.rows.map((r) => [r.groupId, r.rank, r.score])).toEqual([
      ['red', 1, 10],
      ['blue', 2, 8],
    ]);
    const withBonus = buildGroupRail(input({ scores, groupBonus: { blue: 5 } }))!;
    expect(withBonus.rows.map((r) => [r.groupId, r.rank, r.score])).toEqual([
      ['blue', 1, 13],
      ['red', 2, 10],
    ]);
  });

  it(`לכל היותר ${GROUP_RAIL_MAX} קבוצות, והשאר נספרות ב-more`, () => {
    let r = addCategory(EMPTY_ROSTER, 'שולחנות', 'cat1');
    for (let n = 1; n <= GROUP_RAIL_MAX + 2; n++) {
      r = addGroup(r, 'cat1', `שולחן ${n}`, `t${n}`);
      r = assignGroupByNumber(r, `p${n}`, 'cat1', n);
    }
    const rail = buildGroupRail(input({ roster: r }))!;
    expect(rail.rows).toHaveLength(GROUP_RAIL_MAX);
    expect(rail.more).toBe(2);
  });

  it('כמה סוגי קבוצות: האינדקס בוחר את הסוג, מודולו (כמו מקש 5)', () => {
    let r = roster();
    r = addCategory(r, 'עיר', 'cat2');
    r = addGroup(r, 'cat2', 'ירושלים', 'jlm');
    r = addGroup(r, 'cat2', 'חיפה', 'hfa');
    r = assignGroupByNumber(r, 'a', 'cat2', 1);
    expect(buildGroupRail(input({ roster: r, categoryIndex: 1 }))).toMatchObject({
      categoryName: 'עיר',
      categoryCount: 2,
    });
    expect(buildGroupRail(input({ roster: r, categoryIndex: 2 }))!.categoryName).toBe('צבעים');
  });
});

describe('buildGroupRail — שקופית שמוגבלת לקבוצה', () => {
  const restricted = slideOf({
    id: 1,
    type: 'trivia',
    que: 'שאלה לכחולים',
    answers: fourAnswers(2),
    settings: { groupRestriction: { active: true, groupName: 'כחולים' } },
  });

  it('הקבוצה האחרת מסומנת שאינה משתתפת, בלי אחוז', () => {
    const rail = buildGroupRail(input({ slide: restricted, votes: { e: 2 } }))!;
    expect(rail.rows.find((r) => r.groupId === 'red')).toMatchObject({ out: true, pct: null, members: 0 });
    expect(rail.rows.find((r) => r.groupId === 'blue')).toMatchObject({ out: false, pct: 50 });
  });

  it('במשחק שאינו קלאסי ההגבלה מנוטרלת — אבל שם ממילא אין פס', () => {
    expect(buildGroupRail(input({ slide: restricted, gameType: 'snakes_ladders_team' }))).toBeNull();
  });
});

describe('groupRailAvailable — האם יש למשחק פס בכלל', () => {
  it('שתי קבוצות עם חברים — יש', () => {
    expect(groupRailAvailable(roster())).toBe(true);
    expect(groupRailAvailable(roster(), 'classic')).toBe(true);
  });

  it('בלי קבוצות, קבוצה אחת, או קבוצות בלי חברים — אין', () => {
    expect(groupRailAvailable(EMPTY_ROSTER)).toBe(false);
    let one = addCategory(EMPTY_ROSTER, 'צבעים', 'cat1');
    one = addGroup(one, 'cat1', 'אדומים', 'red');
    one = assignGroupByNumber(one, 'a', 'cat1', 1);
    expect(groupRailAvailable(one)).toBe(false);
    let empty = addCategory(EMPTY_ROSTER, 'צבעים', 'cat1');
    empty = addGroup(empty, 'cat1', 'אדומים', 'red');
    empty = addGroup(empty, 'cat1', 'כחולים', 'blue');
    expect(groupRailAvailable(empty)).toBe(false);
  });

  it('מספיק סוג קבוצות אחד שיש בו פס, גם כשהראשון ריק', () => {
    let r = addCategory(EMPTY_ROSTER, 'ריק', 'cat0');
    r = addGroup(r, 'cat0', 'לבד', 'solo');
    r = addCategory(r, 'צבעים', 'cat1');
    r = addGroup(r, 'cat1', 'אדומים', 'red');
    r = addGroup(r, 'cat1', 'כחולים', 'blue');
    r = assignGroupByNumber(r, 'a', 'cat1', 1);
    expect(groupRailAvailable(r)).toBe(true);
  });

  it('בסולמות וחבלים — אין', () => {
    expect(groupRailAvailable(roster(), 'snakes_ladders_team')).toBe(false);
  });
});

describe('presentPlayers', () => {
  it('מחוברים, בעלי ניקוד ומי שהצביע בשקופית כלשהי', () => {
    const ids = presentPlayers(['a'], { b: 3 }, { 1: { c: 2 }, 2: { a: 1 } });
    expect([...ids].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('engine.getLiveVoters', () => {
  function engineWith(allowChangeVote: boolean): GameEngine {
    const game = makeGame([
      rawSlide({
        id: 1,
        type: 'trivia',
        que: 'שאלה',
        answers: fourAnswers(2),
        timeForQue: 20,
        settings: { allowChangeVote },
      }),
      rawSlide({ id: 2, type: 'trivia', que: 'שנייה', answers: fourAnswers(1), timeForQue: 20 }),
    ]);
    return new GameEngine(game);
  }

  it('מחוץ לחלון הצבעה — null', () => {
    expect(engineWith(false).getLiveVoters()).toBeNull();
  });

  it('בלי שינוי הצבעה: ההצבעה הראשונה של כל מצביע (מה שינוקד)', () => {
    const engine = engineWith(false);
    engine.dispatch({ type: 'ADVANCE', at: 1000 });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 1 }), at: 2000 });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(2, 1, { a: 3, b: 2 }), at: 3000 });
    expect(engine.getLiveVoters()).toEqual({ a: 1, b: 2 });
  });

  it('עם שינוי הצבעה: האחרונה', () => {
    const engine = engineWith(true);
    engine.dispatch({ type: 'ADVANCE', at: 1000 });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 1 }), at: 2000 });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(2, 1, { a: 3, b: 2 }), at: 3000 });
    expect(engine.getLiveVoters()).toEqual({ a: 3, b: 2 });
  });

  it('אחרי הסגירה — null, וההצבעות הסופיות ב-votesBySlide', () => {
    const engine = engineWith(false);
    engine.dispatch({ type: 'ADVANCE', at: 1000 });
    engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2 }), at: 2000 });
    engine.dispatch({ type: 'ADVANCE', at: 3000 });
    expect(engine.getState().phase).toBe('results');
    expect(engine.getLiveVoters()).toBeNull();
    expect(engine.getState().votesBySlide[1]).toEqual({ a: 2 });
  });
});
