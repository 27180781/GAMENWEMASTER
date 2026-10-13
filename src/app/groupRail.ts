/**
 * פס הקבוצות בצד מסך השאלה (משוב לקוח, «קליקרים מי בראש», 2026-10).
 *
 * במשחק עם קבוצות מוצגת בצד המסך שורה לכל קבוצה, לאורך כל המשחק, בלי שהמנחה
 * יפתח משהו: המקום, השם וממוצע הניקוד (כמו מסך דירוג הקבוצות, מקש 4), ולצדם
 * מה שהקבוצה עשתה בשאלה הנוכחית:
 *   • לפני ההצבעה — הדירוג בלבד ('standings').
 *   • בזמן ההצבעה — כמה מהקבוצה כבר ענו ('answered'). לא כמה צדקו: האחוז של
 *     הקבוצה היה קופץ ברגע שמישהו מצביע, ומגלה לו אם צדק (ועם שינוי הצבעה גם
 *     מאפשר לתקן).
 *   • בחשיפת התשובה — כמה מהקבוצה צדקו ('correct'). בסקר, ובכל שקופית שאין בה
 *     תשובה נכונה מסומנת, איך הקבוצה התחלקה בין התשובות ('split': עוגה קטנה
 *     בצבעי התשובות). עם מונה הצבעות חי (liveVoteCounts) העוגה חיה כבר בזמן
 *     ההצבעה, כמו המונים שעל התשובות.
 *
 * האחוזים הם מתוך חברי הקבוצה **שנמצאים במשחק** (`present`): מי שרשום בקבוצה
 * ולא לחץ אף פעם על מקש לא מוריד לה אחוזים. בשקופית שמוגבלת לקבוצה נספרים רק
 * מי שבקבוצה המורשית, וקבוצה שאין בה אף אחד כזה מסומנת שאינה משתתפת.
 *
 * הסדר והניקוד הם של groupStandings, כולל הבונוס — בדיוק כמו מקש 4. בין סגירת
 * ההצבעה לחשיפה GameHost מעביר את הניקוד מלפני השאלה, כדי שהסדר לא יגלה מי
 * צדק לפני החשיפה.
 *
 * טהור (בלי React/DOM) — נבדק ביחידה.
 */

import { marksCorrectAnswer, type GamePhase, type Slide } from '../engine/index.ts';
import { isInGroup, slideGroupRestriction } from './groupRestriction.ts';
import { groupCategories, groupStandings, type AnswerTimes } from './groupScore.ts';
import type { RosterData } from './roster.ts';

/** מה הפס מראה ליד כל קבוצה (ראו בראש הקובץ). */
export type GroupRailMode = 'standings' | 'answered' | 'correct' | 'split';

export interface GroupRailRow {
  groupId: string;
  name: string;
  /** המקום בדירוג הקבוצות (1 = מובילה): ממוצע ועוד בונוס, כמו מקש 4. */
  rank: number;
  /** הניקוד שהקבוצה מדורגת לפיו (ממוצע ועוד בונוס), מעוגל. */
  score: number;
  /** חברי הקבוצה שנספרים בשקופית: במשחק, ובשקופית מוגבלת — רק המורשים. */
  members: number;
  /** כמה מהם הצביעו. */
  voted: number;
  /** answered: הצביעו מתוך members · correct: צדקו מתוך members (0–100). null בשאר המצבים, או כשאין חברים. */
  pct: number | null;
  /** split: כמה בחרו בכל תשובה, לפי סדר התשובות בשקופית. null בשאר המצבים. */
  split: number[] | null;
  /** השקופית מוגבלת לקבוצה אחרת, ואין בקבוצה הזאת אף אחד שמורשה לענות. */
  out: boolean;
}

export interface GroupRailData {
  mode: GroupRailMode;
  /** שם סוג הקבוצות (הקטגוריה) שהפס מראה. */
  categoryName: string;
  /** כמה סוגי קבוצות יש — כשיותר מאחד, הפס מציין איזה מהם מוצג. */
  categoryCount: number;
  /** השורות, לפי הדירוג. לכל היותר GROUP_RAIL_MAX. */
  rows: GroupRailRow[];
  /** כמה קבוצות לא נכנסו לפס. */
  more: number;
}

/** כמה קבוצות לכל היותר בפס. מעבר לכך — «ועוד N», והמלא במקש 4. */
export const GROUP_RAIL_MAX = 8;

/** סוגי השקופיות שמסך השאלה מציג (QuestionSlide). */
const RAIL_SLIDE_TYPES = new Set(['trivia', 'survey', 'ans_images']);

/** מה הפס מראה בשלב הזה של השקופית. */
export function groupRailMode(slide: Slide, phase: GamePhase, revealCorrect: boolean): GroupRailMode {
  const marks = marksCorrectAnswer(slide);
  if (phase === 'voting') return !marks && slide.setting.liveVoteCounts ? 'split' : 'answered';
  if (phase === 'results') {
    if (!revealCorrect) return 'answered';
    return marks ? 'correct' : 'split';
  }
  return 'standings';
}

export interface GroupRailInput {
  roster: RosterData;
  /** איזה סוג קבוצות — אותו אינדקס של מסך הקבוצות (מקש 5 מחליף), מודולו. */
  categoryIndex: number;
  slide: Slide;
  phase: GamePhase;
  revealCorrect: boolean;
  /**
   * ההצבעות על השקופית (voterId → answerId): בזמן ההצבעה — החיות
   * (engine.getLiveVoters), ואחריה — הסופיות (votesBySlide). null = אין.
   */
  votes: Readonly<Record<string, number>> | null;
  scores: Record<string, number>;
  answerTimes: AnswerTimes;
  groupBonus?: Readonly<Record<string, number>>;
  /**
   * מי נמצא במשחק (presentPlayers). מי שמופיע ב-`votes` נחשב נמצא בכל מקרה.
   * חסר = כל הרשומים.
   */
  present?: ReadonlySet<string> | null;
  gameType?: string;
}

/**
 * הנתונים לפס, או null כשאין פס: משחק שאינו «קלאסי» (בסולמות וחבלים הלוח הוא
 * הדירוג), שקופית שאינה שאלה, או סוג קבוצות עם פחות משתי קבוצות או בלי אף חבר.
 */
export function buildGroupRail(input: GroupRailInput): GroupRailData | null {
  const { roster, slide } = input;
  const gameType = input.gameType ?? 'classic';
  if (gameType !== 'classic' || !RAIL_SLIDE_TYPES.has(slide.type)) return null;
  const cats = groupCategories(roster);
  if (cats.length === 0) return null;
  const index = ((input.categoryIndex % cats.length) + cats.length) % cats.length;
  const cat = cats[index]!;
  if (cat.groups.length < 2) return null;

  const mode = groupRailMode(slide, input.phase, input.revealCorrect);
  const answers = slide.question.answers;
  const answerIndex = new Map(answers.map((a, i) => [a.id, i]));
  const correctIds = new Set(answers.filter((a) => a.correct).map((a) => a.id));
  const restriction = slideGroupRestriction(slide, gameType);

  interface Tally {
    /** רשומים שמורשים לענות (בלי קשר לנוכחות) — לסימון «לא משתתפת». */
    eligible: number;
    members: number;
    voted: number;
    correct: number;
    split: number[];
  }
  const tally = new Map<string, Tally>();
  for (const g of cat.groups) {
    tally.set(g.id, { eligible: 0, members: 0, voted: 0, correct: 0, split: answers.map(() => 0) });
  }
  let anyMember = false;
  for (const [playerId, byCat] of Object.entries(roster.memberships)) {
    const groupId = byCat[cat.id];
    const t = groupId === undefined ? undefined : tally.get(groupId);
    if (t === undefined) continue;
    anyMember = true;
    if (restriction !== null && !isInGroup(roster, playerId, restriction)) continue;
    t.eligible += 1;
    const vote = input.votes?.[playerId];
    // מי שמצביע עכשיו נמצא במשחק, גם אם עוד לא נרשם כמחובר.
    if (input.present != null && !input.present.has(playerId) && vote === undefined) continue;
    t.members += 1;
    if (vote === undefined) continue;
    t.voted += 1;
    if (correctIds.has(vote)) t.correct += 1;
    const at = answerIndex.get(vote);
    if (at !== undefined) t.split[at]! += 1;
  }
  if (!anyMember) return null;

  const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);
  const standings = groupStandings(roster, cat.id, input.scores, input.answerTimes, input.groupBonus);
  const rows = standings.slice(0, GROUP_RAIL_MAX).map((st, i): GroupRailRow => {
    const t = tally.get(st.groupId)!;
    const out = restriction !== null && t.eligible === 0;
    return {
      groupId: st.groupId,
      name: st.name,
      rank: i + 1,
      score: Math.round(st.avgScore),
      members: t.members,
      voted: t.voted,
      pct:
        out || (mode !== 'answered' && mode !== 'correct')
          ? null
          : percent(mode === 'answered' ? t.voted : t.correct, t.members),
      split: out || mode !== 'split' ? null : t.split,
      out,
    };
  });

  return {
    mode,
    categoryName: cat.name,
    categoryCount: cats.length,
    rows,
    more: standings.length - rows.length,
  };
}

/**
 * האם יש למשחק פס קבוצות בכלל — משחק «קלאסי» עם סוג קבוצות שיש בו לפחות שתי
 * קבוצות ולפחות חבר אחד. לפי זה מוצגים מתג ההסתרה (תפריט המפעיל, מסך המנחה)
 * ורמז המקש G; האם הפס מופיע בשקופית מסוימת — buildGroupRail.
 */
export function groupRailAvailable(roster: RosterData, gameType?: string): boolean {
  if ((gameType ?? 'classic') !== 'classic') return false;
  const memberships = Object.values(roster.memberships);
  return groupCategories(roster).some((cat) => {
    if (cat.groups.length < 2) return false;
    const ids = new Set(cat.groups.map((g) => g.id));
    return memberships.some((byCat) => {
      const groupId = byCat[cat.id];
      return groupId !== undefined && ids.has(groupId);
    });
  });
}

/**
 * מי נמצא במשחק, לאחוזים של הפס: מי שהתחבר או לחץ (connected), מי שיש לו
 * ניקוד, ומי שהצביע על שקופית כלשהי. ההצבעה הפתוחה עכשיו נספרת ב-buildGroupRail.
 */
export function presentPlayers(
  connected: readonly string[],
  scores: Readonly<Record<string, number>>,
  votesBySlide: Readonly<Record<number, Readonly<Record<string, number>>>>,
): Set<string> {
  const ids = new Set<string>(connected);
  for (const id of Object.keys(scores)) ids.add(id);
  for (const votes of Object.values(votesBySlide)) for (const id of Object.keys(votes)) ids.add(id);
  return ids;
}
