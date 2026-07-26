/**
 * "סולמות וחבלים קבוצתי" (gameType: snakes_ladders_team) — לוגיקה טהורה.
 *
 * הרעיון: כל הקהל עונה על אותה שאלה במקביל, אבל הניקוד האישי אינו העיקר —
 * מה שקובע הוא **אחוז התשובות הנכונות של כל קבוצה**. בסיום ההצבעה כל קבוצה
 * מתקדמת על לוח סולמות-וחבלים, ואז מטפסת בסולם או מחליקה בחבל.
 *
 * שני מצבי התקדמות (setting.gameTypeSettings.snakesLadders.progression):
 *   • 'percent' — כל קבוצה מתקדמת לפי אחוז ההצלחה שלה (0..MAX_STEPS צעדים).
 *   • 'dice'    — רק הקבוצה המובילה (אחוז הכי גבוה) "מטילה קובייה" ומתקדמת;
 *                 השאר נשארות במקום. הטלה דטרמיניסטית לפי seed, כדי שהמצב
 *                 יהיה משוחזר (גיבוי/רענון מציגים בדיוק את אותו לוח).
 *
 * הכול טהור וניתן לבדיקה — בלי React, בלי DOM, בלי אקראיות לא-מבוקרת.
 */

import type { RosterData } from './roster.ts';
import { playerGroupNames } from './roster.ts';

/** מספר המשבצות בלוח ברירת המחדל. */
export const BOARD_SIZE = 30;

/**
 * לוח ברירת המחדל: סולמות (עלייה) וחבלים (ירידה), במיקומים **ובאורכים מגוונים**
 * — קפיצה קצרצרה של 2-3 משבצות לצד "מכה" של 15 — כדי שהלוח יהיה דרמטי ולא
 * צפוי. מאוזן: אין מלכודת ממש לפני הסוף שמייאשת, ואין סולם שמנצח מיד.
 *
 * אין שרשור: יעד של סולם לעולם אינו כניסה של נחש (ולהפך), כך שקבוצה לא
 * "נשאבת" בשרשרת אחת.
 *
 * מפתח = משבצת הכניסה, ערך = משבצת היעד.
 */
export const DEFAULT_LADDERS: Record<number, number> = {
  2: 8, // בינוני (6)
  5: 17, // ארוך (12)
  12: 15, // קצרצר (3)
  20: 28, // בינוני-ארוך (8)
};
export const DEFAULT_SNAKES: Record<number, number> = {
  14: 4, // ארוך (10)
  18: 16, // קצרצר (2)
  24: 9, // ארוך מאוד (15)
  27: 22, // בינוני (5)
};

/**
 * חוק "אין נשיכה כפולה": נחש לא מפיל את אותה קבוצה פעמיים **ברצף**.
 *
 * למה זה נחוץ: בהתקדמות לפי אחוזים, קבוצה שעונה נכון באופן עקבי מתקדמת מספר
 * צעדים *קבוע* — ואז היא עלולה לנחות שוב ושוב בדיוק על אותו נחש ולחזור לאותה
 * משבצת לנצח (למשל 22 →(+5) 27 → נחש → 22). זה נראה כאילו המשחק "תקוע" למרות
 * שהקבוצה מצטיינת. עם החוק הזה הנחש מדלג בפעם השנייה ("כבר נשך אתכם — הפעם
 * חמקתם"), הקבוצה מתקדמת, והדרמה נשמרת.
 */

/** מקסימום צעדים בהתקדמות לפי אחוזים (100% הצלחה). */
export const MAX_STEPS = 5;

export interface GroupProgress {
  groupId: string;
  name: string;
  /** משבצת נוכחית (0 = לפני תחילת הלוח). */
  position: number;
  /** האם הקבוצה סיימה את הלוח. */
  finished: boolean;
}

export interface GroupRoundResult {
  groupId: string;
  name: string;
  /** כמה חברי קבוצה ענו נכון. */
  correct: number;
  /** כמה חברי קבוצה ענו בכלל. */
  answered: number;
  /** כמה חברים יש בקבוצה (כולל מי שלא ענה). */
  members: number;
  /** אחוז הצלחה 0..100 — מתוך כלל חברי הקבוצה (מי שלא ענה נחשב טעות). */
  percent: number;
  /** כמה צעדים הקבוצה מתקדמת בסבב הזה. */
  steps: number;
  /** המשבצת לפני ההזזה. */
  from: number;
  /** המשבצת אחרי ההזזה, לפני סולם/חבל. */
  landed: number;
  /** המשבצת הסופית אחרי סולם/חבל. */
  to: number;
  /** 'ladder' = טיפס בסולם · 'snake' = החליק בחבל · null = תזוזה רגילה. */
  jump: 'ladder' | 'snake' | null;
}

/** מצב הלוח: מיקום כל קבוצה + תוצאות הסבב האחרון (לאנימציה). */
export interface BoardState {
  positions: Record<string, number>;
  /** מזהה קבוצה → משבצת הנחש שנשך אותה בסבב הקודם (לחוק "אין נשיכה כפולה"). */
  lastSnake: Record<string, number>;
  lastRound: GroupRoundResult[];
  /** תוצאת הקובייה בסבב האחרון (רק במצב 'dice'), או null. */
  lastDice: number | null;
  /** מזהה הקבוצה שזכתה בהטלה (מצב 'dice'), או null. */
  diceWinner: string | null;
}

export const EMPTY_BOARD: BoardState = {
  positions: {},
  lastSnake: {},
  lastRound: [],
  lastDice: null,
  diceWinner: null,
};

/**
 * חברי כל קבוצה בקטגוריה — רק משתתפים שמשויכים לקבוצה. במשחק הקבוצתי מי שלא
 * שויך לקבוצה פשוט אינו חלק מהמשחק (כפי שהוגדר), ולכן אינו מופיע כאן.
 */
export function membersByGroup(
  roster: RosterData,
  categoryId: string,
): Record<string, string[]> {
  const category = roster.categories.find((c) => c.id === categoryId);
  if (!category) return {};
  const out: Record<string, string[]> = {};
  for (const g of category.groups) out[g.id] = [];
  for (const [playerId, byCat] of Object.entries(roster.memberships)) {
    const groupId = byCat[categoryId];
    if (groupId !== undefined && out[groupId] !== undefined) out[groupId]!.push(playerId);
  }
  return out;
}

/** הקטגוריה שמשמשת כחלוקה לקבוצות במשחק (הראשונה שיש בה קבוצות). */
export function boardCategoryId(roster: RosterData): string | null {
  return roster.categories.find((c) => c.groups.length > 0)?.id ?? null;
}

/** מחולל פסאודו-אקראי דטרמיניסטי (mulberry32) — הטלת קובייה משוחזרת. */
function seededRandom(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** הטלת קובייה 1..6 דטרמיניסטית לפי seed (מספר השקופית וכו'). */
export function rollDice(seed: number): number {
  return 1 + Math.floor(seededRandom(seed) * 6);
}

/** צעדים לפי אחוז הצלחה: 0% → 0 צעדים, 100% → MAX_STEPS. */
export function stepsForPercent(percent: number): number {
  const p = Math.max(0, Math.min(100, percent));
  return Math.round((p / 100) * MAX_STEPS);
}

/** החלת סולם/חבל על משבצת נחיתה. */
export function applyJump(
  landed: number,
  ladders: Record<number, number> = DEFAULT_LADDERS,
  snakes: Record<number, number> = DEFAULT_SNAKES,
): { to: number; jump: 'ladder' | 'snake' | null } {
  const up = ladders[landed];
  if (up !== undefined) return { to: up, jump: 'ladder' };
  const down = snakes[landed];
  if (down !== undefined) return { to: down, jump: 'snake' };
  return { to: landed, jump: null };
}

export interface RoundInput {
  roster: RosterData;
  categoryId: string;
  /** ההצבעות של השקופית: voterId → answerId. */
  votes: Record<string, number>;
  /** מזהי התשובות הנכונות בשקופית (ריק בסקר — אז כולם "נכונים"). */
  correctAnswerIds: number[];
  /** 'percent' או 'dice'. */
  progression: 'percent' | 'dice';
  /** seed להטלת הקובייה (למשל מזהה השקופית) — לשחזוריות. */
  seed: number;
  board: BoardState;
  ladders?: Record<number, number>;
  snakes?: Record<number, number>;
  boardSize?: number;
}

/**
 * מחשב סבב אחד: אחוזי הצלחה לכל קבוצה, כמה צעדים, סולמות/חבלים, ומצב הלוח
 * החדש. טהור — אותה קלט תמיד מחזירה אותה תוצאה (כולל הקובייה).
 */
export function playRound(input: RoundInput): BoardState {
  const {
    roster, categoryId, votes, correctAnswerIds, progression, seed, board,
    ladders = DEFAULT_LADDERS, snakes = DEFAULT_SNAKES, boardSize = BOARD_SIZE,
  } = input;

  const category = roster.categories.find((c) => c.id === categoryId);
  if (!category) return board;
  const byGroup = membersByGroup(roster, categoryId);
  const correctSet = new Set(correctAnswerIds);
  const anyCorrect = correctSet.size > 0;

  // שלב א׳: אחוז הצלחה לכל קבוצה (מי שלא ענה נחשב "לא נכון" — הוגן בין
  // קבוצות בגדלים שונים, כי המדד הוא אחוז מכלל החברים).
  const base = category.groups.map((g) => {
    const members = byGroup[g.id] ?? [];
    let correct = 0;
    let answered = 0;
    for (const m of members) {
      const v = votes[m];
      if (v === undefined) continue;
      answered += 1;
      if (!anyCorrect || correctSet.has(v)) correct += 1;
    }
    const percent = members.length > 0 ? Math.round((correct / members.length) * 100) : 0;
    return { groupId: g.id, name: g.name, correct, answered, members: members.length, percent };
  });

  // שלב ב׳: כמה צעדים כל קבוצה מתקדמת.
  let lastDice: number | null = null;
  let diceWinner: string | null = null;
  const stepsByGroup: Record<string, number> = {};
  if (progression === 'dice') {
    // רק המובילה מטילה. שובר-שוויון: מי שענתה יותר, ואז סדר הקבוצות (יציב).
    const best = [...base].sort(
      (a, b) => b.percent - a.percent || b.answered - a.answered || a.groupId.localeCompare(b.groupId),
    )[0];
    // קבוצה שאיש בה לא ענה נכון לא "מנצחת" את ההטלה — אין התקדמות בסבב.
    if (best !== undefined && best.percent > 0) {
      lastDice = rollDice(seed);
      diceWinner = best.groupId;
      stepsByGroup[best.groupId] = lastDice;
    }
    for (const g of base) stepsByGroup[g.groupId] ??= 0;
  } else {
    for (const g of base) stepsByGroup[g.groupId] = stepsForPercent(g.percent);
  }

  // שלב ג׳: הזזה על הלוח + סולמות/חבלים.
  const positions = { ...board.positions };
  const lastSnake = { ...board.lastSnake };
  const lastRound: GroupRoundResult[] = base.map((g) => {
    const from = positions[g.groupId] ?? 0;
    const steps = stepsByGroup[g.groupId] ?? 0;
    // לא חורגים מקצה הלוח (אין "חזרה אחורה" מהסוף — מגיעים ונשארים).
    const landed = Math.min(boardSize, from + steps);
    let to = landed;
    let jump: 'ladder' | 'snake' | null = null;
    if (landed !== boardSize) {
      const res = applyJump(landed, ladders, snakes);
      // "אין נשיכה כפולה": אותו נחש פעמיים ברצף — מדלגים עליו הפעם.
      if (res.jump === 'snake' && lastSnake[g.groupId] === landed) {
        delete lastSnake[g.groupId];
      } else {
        to = res.to;
        jump = res.jump;
        if (res.jump === 'snake') lastSnake[g.groupId] = landed;
        else delete lastSnake[g.groupId];
      }
    } else {
      delete lastSnake[g.groupId];
    }
    positions[g.groupId] = to;
    return { ...g, steps, from, landed, to, jump };
  });

  return { positions, lastSnake, lastRound, lastDice, diceWinner };
}

/** דירוג הקבוצות לפי מיקום בלוח (המוביל ראשון). */
export function boardStandings(
  roster: RosterData,
  categoryId: string,
  board: BoardState,
  boardSize = BOARD_SIZE,
): GroupProgress[] {
  const category = roster.categories.find((c) => c.id === categoryId);
  if (!category) return [];
  return category.groups
    .map((g) => {
      const position = board.positions[g.id] ?? 0;
      return { groupId: g.id, name: g.name, position, finished: position >= boardSize };
    })
    .sort((a, b) => b.position - a.position || a.name.localeCompare(b.name, 'he'));
}

/** האם קבוצה כלשהי סיימה את הלוח (סוף המשחק הקבוצתי). */
export function hasWinner(board: BoardState, boardSize = BOARD_SIZE): boolean {
  return Object.values(board.positions).some((p) => p >= boardSize);
}

/** שמות הקבוצות של משתתף — לשימוש חיצוני (עטיפה נוחה). */
export function groupsOfPlayer(roster: RosterData, playerId: string): string[] {
  return playerGroupNames(roster, playerId);
}
