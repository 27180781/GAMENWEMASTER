/**
 * שקופית function · action "players" — הסרת/השארת משתתפים כך שלא יוכלו
 * להשתתף יותר במשחק. הבחירה לפי כמות (אחוזים/מספר) ודירוג (רנדומלי / ניקוד
 * גבוה / ניקוד נמוך), או לפי שיוך לקבוצות (לפי שמות הקבוצות של המשחק).
 * selectPlayersToRemove טהורה (RNG ומיפוי הקבוצות מוזרקים) — ניתנת לבדיקה.
 */

export interface PlayersConfig {
  /** "remove" = הסר את הנבחרים · "keep" = השאר רק את הנבחרים (הסר את השאר). */
  mode: string;
  /** "random" | "top" (ניקוד גבוה) | "bottom" (ניקוד נמוך) | "groups". */
  selection: string;
  /** "percent" = אחוזים · "count" = מספר שחקנים (ל-random/top/bottom). */
  unit?: string | undefined;
  /** הכמות: 1–100 באחוזים, אחרת מספר שחקנים (ל-random/top/bottom). */
  amount?: number | undefined;
  /** שמות הקבוצות שנבחרו (ל-selection "groups"). */
  groups?: string[] | undefined;
}

export interface SelectOptions {
  rng?: () => number;
  /** שמות כל הקבוצות שהשחקן משויך אליהן (ל-selection "groups"). */
  groupNamesOf?: (id: string) => string[];
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/**
 * מחזיר את רשימת המזהים שיש להסיר מהמשחק לפי הקונפיג. `candidates` הם
 * המשתתפים הפעילים כרגע; `scores` משמש ל-top/bottom, ו-groupNamesOf ל-"groups".
 */
export function selectPlayersToRemove(
  candidates: string[],
  scores: Record<string, number>,
  config: PlayersConfig,
  opts: SelectOptions = {},
): string[] {
  const n = candidates.length;
  if (n === 0) return [];

  let chosen: Set<string>;
  if (config.selection === 'groups') {
    // בחירה לפי שיוך לקבוצות — לפי שם הקבוצה (מתוך שמות הקבוצות של המשחק)
    const wanted = new Set((config.groups ?? []).map((g) => g.trim()).filter((g) => g !== ''));
    const groupNamesOf = opts.groupNamesOf ?? (() => []);
    chosen = new Set(candidates.filter((id) => groupNamesOf(id).some((g) => wanted.has(g.trim()))));
  } else {
    // בחירה לפי כמות ודירוג
    const amount = Number.isFinite(config.amount) ? (config.amount as number) : 0;
    const k =
      config.unit === 'count'
        ? Math.min(n, Math.max(0, Math.floor(amount)))
        : Math.round((Math.min(100, Math.max(0, amount)) / 100) * n);
    let ordered: string[];
    if (config.selection === 'top') {
      ordered = [...candidates].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || a.localeCompare(b));
    } else if (config.selection === 'bottom') {
      ordered = [...candidates].sort((a, b) => (scores[a] ?? 0) - (scores[b] ?? 0) || a.localeCompare(b));
    } else {
      ordered = shuffle([...candidates], opts.rng ?? Math.random);
    }
    chosen = new Set(ordered.slice(0, k));
  }

  // mode "keep" → משאירים את הנבחרים ומסירים את כל השאר; "remove" → מסירים את הנבחרים
  return config.mode === 'keep'
    ? candidates.filter((id) => !chosen.has(id))
    : candidates.filter((id) => chosen.has(id));
}
