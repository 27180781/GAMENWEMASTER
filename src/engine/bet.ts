/**
 * שקופית הימור (type: "bet") — הלוגיקה הטהורה, משותפת למנוע ולתצוגה.
 *
 * הרעיון: לפני שאלה שמים שקופית הימור. הכרטיסים שלה הם אפשרויות ההימור
 * ("בלי הימור", "רבע מהניקוד", "חצי", "הכול!"), והמשתתפים לוחצים עליהן
 * בדיוק כמו על תשובות סקר — אותו צינור הצבעה, אותם כפתורים. בסגירת ההצבעה
 * המנוע רושם לכל משתתף כמה הוא שם על הכף, לפי הניקוד שלו באותו רגע
 * (`stakesFor`). השאלה המנוקדת הבאה מכריעה (`resolveBets`): מי שענה נכון
 * מקבל את ההימור (כפול המכפיל), מי שטעה או לא ענה מאבד אותו.
 *
 * הכול טהור ודטרמיניסטי: בלי React, בלי זמן, בלי אקראיות — נבדק ביחידה
 * ומחושב מחדש בדיוק באותה צורה בחזרה אחורה ובשחזור מגיבוי.
 */

import type { GameFile, Slide } from './schema.ts';
import { scoredLikeTrivia } from './scoring.ts';
import type { BetOutcome } from './types.ts';

/** הקונפיג של שקופית ההימור, כפי שהסכימה מנרמלת אותו (אופציה לכל תשובה). */
export type BetConfig = NonNullable<Slide['bet']>;
export type BetOption = BetConfig['options'][number];

/** ברירת המחדל כשלשקופית הימור אין קונפיג — כל האפשרויות "בלי הימור". */
export const EMPTY_BET_CONFIG: BetConfig = { options: [], payout: 1, allowNegative: false };

/** מספר האפשרויות המרבי בשקופית הימור — כמספר הכפתורים שכל שחקן בטוח שיש לו. */
export const MAX_BET_OPTIONS = 4;

/** הקונפיג של שקופית ההימור (null לכל סוג אחר). */
export function betConfigOf(slide: Slide): BetConfig | null {
  if (slide.type !== 'bet') return null;
  return slide.bet ?? EMPTY_BET_CONFIG;
}

/** האפשרות שמאחורי כפתור (answerId הוא 1-based, כמו בכל שקופית מצביעה). */
export function betOptionFor(config: BetConfig, answerId: number): BetOption | null {
  return config.options[answerId - 1] ?? null;
}

/**
 * גובה ההימור של משתתף לפי האפשרות שבחר והניקוד שלו ברגע הסגירה.
 * תמיד שלם ולא שלילי; "אחוז" ו"הכול" נגזרים מהניקוד (ניקוד 0 → הימור 0),
 * "סכום קבוע" הוא הסכום עצמו — כך שגם מי שעדיין בלי נקודות יכול להמר.
 */
export function stakeFor(option: BetOption | null, score: number): number {
  if (option === null) return 0;
  const base = Math.max(0, Math.floor(Number.isFinite(score) ? score : 0));
  switch (option.kind) {
    case 'all':
      return base;
    case 'percent': {
      const pct = Math.min(100, Math.max(0, option.value ?? 0));
      return Math.floor((base * pct) / 100);
    }
    case 'fixed':
      return Math.max(0, Math.floor(option.value ?? 0));
    default:
      return 0;
  }
}

/** מכפיל הזכייה של אפשרות — שלה, ואם אין לה: של השקופית; לעולם לא 0 או שלילי. */
export function payoutFor(config: BetConfig, option: BetOption | null): number {
  const own = option?.payout;
  if (own !== undefined && Number.isFinite(own) && own > 0) return own;
  return Number.isFinite(config.payout) && config.payout > 0 ? config.payout : 1;
}

/**
 * ההימורים בסגירת שקופית ההימור: voterId → גובה ההימור, רק למי ששם משהו על
 * הכף (מי שבחר "בלי הימור" או שאין לו נקודות אינו ברשימה).
 */
export function stakesFor(
  config: BetConfig,
  votes: Readonly<Record<string, number>>,
  scores: Readonly<Record<string, number>>,
): Record<string, number> {
  const stakes: Record<string, number> = {};
  for (const [voterId, answerId] of Object.entries(votes)) {
    const stake = stakeFor(betOptionFor(config, answerId), scores[voterId] ?? 0);
    if (stake > 0) stakes[voterId] = stake;
  }
  return stakes;
}

/**
 * שקופית ההימור שחלה על השקופית במיקום הנתון: ההימור הקרוב ביותר לפניה,
 * ובלבד שאין ביניהם שאלה מנוקדת אחרת (טקסט, מדיה, פונקציה וסקר אינם
 * "מנצלים" את ההימור). שני הימורים ברצף — הקרוב לשאלה קובע.
 */
export function betSlideFor(game: GameFile, slideIndex: number): Slide | null {
  for (let i = slideIndex - 1; i >= 0; i -= 1) {
    const slide = game.questions[i];
    if (slide === undefined) return null;
    if (slide.type === 'bet') return slide;
    if (scoredLikeTrivia(slide)) return null;
  }
  return null;
}

/** האם השקופית במיקום הנתון היא זו שמכריעה את ההימור שלפניה. */
export function resolvesBet(game: GameFile, slideIndex: number): boolean {
  const slide = game.questions[slideIndex];
  return slide !== undefined && scoredLikeTrivia(slide) && betSlideFor(game, slideIndex) !== null;
}

export interface ResolveBetsInput {
  /** voterId → גובה ההימור (מ-stakesFor). */
  stakes: Readonly<Record<string, number>>;
  /** voterId → האפשרות שנבחרה בשקופית ההימור (למכפיל הפרטי של האפשרות). */
  betVotes: Readonly<Record<string, number>>;
  config: BetConfig;
  /** voterId → התשובה שנבחרה בשאלה המכריעה. */
  finalVotes: Readonly<Record<string, number>>;
  /** מזהי התשובות הנכונות בשאלה המכריעה. */
  correctIds: ReadonlySet<number>;
  /** הניקוד אחרי הניקוד הרגיל של השאלה — לרצפת האפס. */
  scores: Readonly<Record<string, number>>;
}

/**
 * הכרעת ההימורים בשאלה המנוקדת: נכון → ‎+הימור×מכפיל; טעה או לא ענה →
 * ‎−הימור (ולא מתחת לאפס, אלא אם allowNegative). ה-delta הוא השינוי בפועל,
 * כך שביטול (חזרה אחורה) מחזיר בדיוק את מה שנלקח.
 */
export function resolveBets(input: ResolveBetsInput): Record<string, BetOutcome> {
  const outcomes: Record<string, BetOutcome> = {};
  for (const [voterId, stake] of Object.entries(input.stakes)) {
    if (!(stake > 0)) continue;
    const answerId = input.finalVotes[voterId];
    const won = answerId !== undefined && input.correctIds.has(answerId);
    let delta: number;
    if (won) {
      const option = betOptionFor(input.config, input.betVotes[voterId] ?? 0);
      delta = Math.round(stake * payoutFor(input.config, option));
    } else if (input.config.allowNegative) {
      delta = -stake;
    } else {
      delta = -Math.min(stake, Math.max(0, input.scores[voterId] ?? 0));
    }
    outcomes[voterId] = { stake, won, delta, answerId: answerId ?? null };
  }
  return outcomes;
}

/** תיאור קצר של אפשרות — לכרטיס בשקופית ("25% מהניקוד שלך"). */
export function describeBetOption(option: BetOption | null, config: BetConfig): string {
  if (option === null) return '';
  let text: string;
  switch (option.kind) {
    case 'all':
      text = 'כל הניקוד שלך';
      break;
    case 'percent':
      text = `${Math.round(option.value ?? 0)}% מהניקוד שלך`;
      break;
    case 'fixed':
      text = `${Math.round(option.value ?? 0)} נקודות`;
      break;
    default:
      text = 'שומרים על הנקודות';
  }
  const payout = payoutFor(config, option);
  if (option.kind !== 'none' && payout !== 1) text += ` · זכייה פי ${payout}`;
  return text;
}

/** תיאור קצרצר — לרשימת השקופיות ("בלי · 25% · 50% · הכול"). */
export function describeBetOptionShort(option: BetOption | null): string {
  if (option === null) return '?';
  switch (option.kind) {
    case 'all':
      return 'הכול';
    case 'percent':
      return `${Math.round(option.value ?? 0)}%`;
    case 'fixed':
      return `${Math.round(option.value ?? 0)} נק׳`;
    default:
      return 'בלי';
  }
}

export interface BetSummary {
  /** כמה משתתפים שמו משהו על הכף. */
  bettors: number;
  /** סך הנקודות על הכף. */
  total: number;
  /** המהמרים הגדולים, יורד. */
  top: { voterId: string; stake: number }[];
}

/** סיכום ההימורים אחרי סגירת שקופית ההימור (למסך ולפס "הימור פעיל"). */
export function betSummary(stakes: Readonly<Record<string, number>>, topN = 3): BetSummary {
  const entries = Object.entries(stakes)
    .filter(([, stake]) => stake > 0)
    .map(([voterId, stake]) => ({ voterId, stake }))
    .sort((a, b) => b.stake - a.stake || a.voterId.localeCompare(b.voterId));
  return {
    bettors: entries.length,
    total: entries.reduce((sum, e) => sum + e.stake, 0),
    top: entries.slice(0, Math.max(0, topN)),
  };
}

export interface BetOutcomeSummary {
  won: number;
  lost: number;
  totalWon: number;
  totalLost: number;
  winners: { voterId: string; delta: number; stake: number }[];
  losers: { voterId: string; delta: number; stake: number }[];
  /** הזכייה הגדולה (או null כשאיש לא זכה). */
  biggest: { voterId: string; delta: number; stake: number } | null;
}

/** סיכום תוצאות ההימור בשאלה המכריעה (למסך "תוצאות ההימור"). */
export function betOutcomeSummary(outcomes: Readonly<Record<string, BetOutcome>>): BetOutcomeSummary {
  const winners: BetOutcomeSummary['winners'] = [];
  const losers: BetOutcomeSummary['losers'] = [];
  for (const [voterId, o] of Object.entries(outcomes)) {
    const row = { voterId, delta: o.delta, stake: o.stake };
    if (o.won) winners.push(row);
    else losers.push(row);
  }
  winners.sort((a, b) => b.delta - a.delta || b.stake - a.stake || a.voterId.localeCompare(b.voterId));
  losers.sort((a, b) => a.delta - b.delta || b.stake - a.stake || a.voterId.localeCompare(b.voterId));
  return {
    won: winners.length,
    lost: losers.length,
    totalWon: winners.reduce((s, w) => s + w.delta, 0),
    totalLost: losers.reduce((s, l) => s - l.delta, 0),
    winners,
    losers,
    biggest: winners[0] ?? null,
  };
}
