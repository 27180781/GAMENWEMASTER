/**
 * שאלות הדאבל של הגרלת הווילה (חנוכה 2026; החוזה המלא: INTEGRATION.md › «שאלות הדאבל»).
 *
 * מערכת יצירת המשחקים מכניסה למשחק של הזמנה שנכנסה להגרלה עד 10 שאלות קשות
 * במיוחד, כל אחת אחרי מסך הכרזה (`doubleIntro` על שקופית subject). שאלת הדאבל
 * עצמה היא trivia רגילה עם `double`. אחרי חשיפת התשובה, הרווח הבא פותח את
 * «תוצאת הדאבל»: כמה מבני המשפחה צדקו, כמה כרטיסים זה שווה, והשוואה לשאר
 * המשפחות בארץ. הכרטיסים עצמם נספרים בשרת, מתוך ההצבעות בגיבוי, ורק על שאלה
 * שהמשפחה בה גדולה מ-4.
 *
 * פעם אחת (בקשת נסים, 2026-11-26: «מספיק לי שיראו אפילו איש אחד את שאלות הדאבל
 * בשביל להרוס»): ההפעלה הראשונה שמגיעה לשאלת דאבל משתמשת בהן, גם עם אדם אחד.
 * השרת מחזיר אותן אחר כך רק לרענון של אותה הפעלה (`run` על השקופיות), והמנוע
 * מוריד אותן מכל הפעלה אחרת: «משחק חדש» במקום המשך, התחלה מחדש באותו חלון אחרי
 * שאחת הופיעה, ושחקני דמה. משחק בלי שאלות הדאבל הוא בדיוק הקובץ שהשרת שולח למשחק
 * שאין לו (stripVillaSlides), כך שהגיבוי, התוצאות והקריין לא מרגישים בהן.
 *
 * הכלל (החלטת נסים, 2026-11-25): עד 10 כרטיסים לכל שאלת דאבל, לפי אחוז המשפחה
 * שצדק. «המשפחה» = מי שהצביע בשקופית כלשהי עד שאלת הדאבל הזאת (כולל), כך שמי
 * ששיחק ולא ענה עליה נספר כמי שלא צדק. מי שהמנחה הסיר לא נספר.
 *
 * הכול כאן טהור, כדי שייבדק ביחידה (tests/villaDouble.test.ts).
 */

import type { GameFile, Slide, VillaDouble, VillaDoubleStats } from '../engine/index.ts';
import type { GamePhase } from '../engine/types.ts';

/** הכי הרבה כרטיסים ששאלת דאבל אחת נותנת. */
export const VILLA_DOUBLE_MAX_TICKETS = 10;
/** שאלת דאבל שהמשפחה בה (מי ששיחק עד אליה) גדולה מזה נותנת כרטיסים; עד זה היא לא נספרת (villa_double_tally בשרת). */
export const VILLA_REHEARSAL_MAX_PLAYERS = 4;
/** פחות משפחות מזה, וההשוואה הארצית עוד לא אומרת כלום. */
export const VILLA_MIN_FAMILIES_FOR_COMPARISON = 5;

export type DoubleSlide = Slide & { double: VillaDouble };

/** שאלת דאבל: trivia שמערכת יצירת המשחקים סימנה. */
export function isDoubleSlide(slide: Slide | undefined): slide is DoubleSlide {
  return slide !== undefined && slide.type === 'trivia' && slide.double !== undefined;
}

/** מסך ההכרזה שלפני שאלת דאבל. */
export function isDoubleIntro(slide: Slide | undefined): boolean {
  return slide !== undefined && slide.type === 'subject' && slide.doubleIntro !== undefined;
}

/** «שאלת דאבל 3 מתוך 10». */
export function doubleTitle(n: number, of: number): string {
  return `שאלת דאבל ${n} מתוך ${of}`;
}

/** כמה כרטיסים שווה אחוז כזה של המשפחה (0..1): עד 10, מעוגל. */
export function doubleTickets(share: number): number {
  if (!Number.isFinite(share) || share <= 0) return 0;
  return Math.min(VILLA_DOUBLE_MAX_TICKETS, Math.round(Math.min(1, share) * VILLA_DOUBLE_MAX_TICKETS));
}

export interface DoubleResult {
  slideId: number;
  poolId: string;
  n: number;
  of: number;
  /** כמה מבני המשפחה ענו נכון על שאלת הדאבל. */
  correct: number;
  /** כמה בני משפחה שיחקו עד עכשיו (הצביעו בשקופית כלשהי עד השאלה הזאת, כולל). */
  base: number;
  /** correct / base, בין 0 ל-1. */
  share: number;
  /** כמה כרטיסים התוצאה שווה (0..10). */
  tickets: number;
  /** ההפעלה הזאת יכולה לזכות בכרטיסים (`double.tickets` מהשרת). */
  ticketsOpen: boolean;
  /** הכרטיסים באמת נספרים: ההפעלה יכולה לזכות, ויש בה יותר מ-4 משתתפים. */
  counts: boolean;
}

/**
 * התוצאה של שאלת הדאבל שבמקום `slideIndex`, לפי ההצבעות שנרשמו. null כשזו
 * אינה שאלת דאבל.
 */
export function doubleResult(
  game: GameFile,
  slideIndex: number,
  votesBySlide: Readonly<Record<number, Readonly<Record<string, number>>>>,
  removed: ReadonlySet<string> = new Set(),
): DoubleResult | null {
  const slide = game.questions[slideIndex];
  if (!isDoubleSlide(slide)) return null;
  const family = new Set<string>();
  for (let i = 0; i <= slideIndex; i += 1) {
    const s = game.questions[i];
    if (s === undefined) continue;
    const votes = votesBySlide[s.id];
    if (votes === undefined) continue;
    for (const id of Object.keys(votes)) if (!removed.has(id)) family.add(id);
  }
  const correctIds = new Set(slide.question.answers.filter((a) => a.correct).map((a) => a.id));
  let correct = 0;
  for (const [id, answerId] of Object.entries(votesBySlide[slide.id] ?? {})) {
    if (!removed.has(id) && correctIds.has(answerId)) correct += 1;
  }
  const base = family.size;
  const share = base > 0 ? correct / base : 0;
  const tickets = doubleTickets(share);
  const ticketsOpen = slide.double.tickets === true;
  return {
    slideId: slide.id,
    poolId: slide.double.poolId,
    n: slide.double.n,
    of: slide.double.of,
    correct,
    base,
    share,
    tickets,
    ticketsOpen,
    counts: ticketsOpen && base > VILLA_REHEARSAL_MAX_PLAYERS,
  };
}

/**
 * השורה שמשווה את המשפחה לשאר המשפחות בארץ (הנתונים מהשרת, נכונים לרגע שהמשחק
 * נטען). מעט משפחות → «מהראשונות»; תוצאה שרוב המשפחות לא הגיעו אליה → «רק X%»;
 * אחרת הממוצע הארצי של השאלה.
 */
export function doubleComparison(stats: VillaDoubleStats | undefined, tickets: number): string {
  if (stats === undefined || stats.families < VILLA_MIN_FAMILIES_FOR_COMPARISON) {
    return 'אתם מהמשפחות הראשונות בארץ שענו על השאלה הזאת!';
  }
  const reached = stats.atLeast[Math.max(0, Math.min(VILLA_DOUBLE_MAX_TICKETS, tickets))] ?? 0;
  if (tickets > 0 && reached === 0) return 'אתם המשפחה הראשונה בארץ שהגיעה לתוצאה כזאת!';
  const pct = Math.round((100 * reached) / stats.families);
  if (tickets > 0 && pct <= 50) return `רק ${Math.max(1, pct)}% מהמשפחות בארץ הגיעו לתוצאה כזאת!`;
  return `בממוצע ${Math.round(stats.avg)}% מבני המשפחה בכל הארץ ענו נכון על השאלה הזאת`;
}

/**
 * מה שמסך «תוצאת הדאבל» מציג. נבנה במסך הראשי מההצבעות, ונשלח כמו שהוא לקישור
 * הצפייה (שאין בו את ההצבעות של כולם).
 */
export interface DoubleView {
  n: number;
  of: number;
  correct: number;
  base: number;
  tickets: number;
  ticketsOpen: boolean;
  counts: boolean;
  /** הכרטיסים שההפעלה צברה עד עכשיו בכל שאלות הדאבל שנחשפו, כולל זו. */
  soFar: number;
  /** שורת ההשוואה לשאר המשפחות בארץ (doubleComparison). */
  comparison: string;
}

/** מסך «תוצאת הדאבל» של השקופית שבמקום `slideIndex`; null כשאין מה להציג (לא דאבל, או שאיש עוד לא שיחק). */
export function doubleView(
  game: GameFile,
  slideIndex: number,
  votesBySlide: Readonly<Record<number, Readonly<Record<string, number>>>>,
  removed: ReadonlySet<string> = new Set(),
): DoubleView | null {
  const r = doubleResult(game, slideIndex, votesBySlide, removed);
  if (r === null || r.base === 0) return null;
  const slide = game.questions[slideIndex] as DoubleSlide;
  return {
    n: r.n,
    of: r.of,
    correct: r.correct,
    base: r.base,
    tickets: r.tickets,
    ticketsOpen: r.ticketsOpen,
    counts: r.counts,
    soFar: doubleTicketsSoFar(game, slideIndex, votesBySlide, removed),
    comparison: doubleComparison(slide.double.stats, r.tickets),
  };
}

/** התוצאה באמת מוסיפה כרטיסים (ואז המסך נפתח בתרועה): לא בהפעלת ניסיון ולא במשחק שכבר אינו יכול לזכות. */
export function doubleWinsTickets(view: DoubleView | null): boolean {
  return view !== null && view.counts && view.tickets > 0;
}

/** השורות של מסך ההכרזה שלפני שאלת דאבל (SubjectSlide). */
export function doubleIntroLines(intro: { n: number; of: number; tickets: boolean }): {
  title: string;
  counter: string;
  lines: string[];
} {
  return {
    title: 'שאלת דאבל',
    counter: `${intro.n} מתוך ${intro.of}`,
    lines: intro.tickets
      ? [
          'שאלה קשה במיוחד, עם ניקוד כפול!',
          `ככל שיותר מכם יענו נכון, כך תקבלו יותר כרטיסים להגרלת הווילה: עד ${VILLA_DOUBLE_MAX_TICKETS} בשאלה`,
        ]
      : ['שאלה קשה במיוחד, עם ניקוד כפול!'],
  };
}

/** שורת הכרטיסים במסך התוצאה, לפי המצב (null = לא מדברים על כרטיסים). */
export function doubleTicketLines(view: DoubleView): { main: string; note: string | null } | null {
  if (!view.ticketsOpen) return null;
  const worth =
    view.tickets === 0 ? 'אף כרטיס' : view.tickets === 1 ? 'כרטיס אחד' : `${view.tickets} כרטיסים`;
  if (!view.counts) {
    return {
      main: `עם יותר מ-${VILLA_REHEARSAL_MAX_PLAYERS} משתתפים זה היה שווה ${worth}`,
      note: `כשמשתתפים עד ${VILLA_REHEARSAL_MAX_PLAYERS}, הכרטיסים להגרלת הווילה לא נספרים`,
    };
  }
  const main =
    view.tickets === 0
      ? view.n < view.of
        ? 'הפעם בלי כרטיסים, אבל עוד מחכות לכם שאלות דאבל!'
        : 'הפעם בלי כרטיסים נוספים'
      : view.tickets === 1
        ? 'קיבלתם עוד כרטיס להגרלת הווילה!'
        : `קיבלתם עוד ${view.tickets} כרטיסים להגרלת הווילה!`;
  const note =
    view.n > 1 && view.soFar > 0
      ? `עד עכשיו צברתם ${view.soFar === 1 ? 'כרטיס אחד' : `${view.soFar} כרטיסים`} בשאלות הדאבל`
      : null;
  return { main, note };
}

/** הכרטיסים שההפעלה צברה עד עכשיו בשאלות הדאבל שכבר נחשפו (כולל `upToIndex`). */
export function doubleTicketsSoFar(
  game: GameFile,
  upToIndex: number,
  votesBySlide: Readonly<Record<number, Readonly<Record<string, number>>>>,
  removed: ReadonlySet<string> = new Set(),
): number {
  let sum = 0;
  for (let i = 0; i <= upToIndex && i < game.questions.length; i += 1) {
    const r = doubleResult(game, i, votesBySlide, removed);
    if (r !== null && votesBySlide[r.slideId] !== undefined) sum += r.tickets;
  }
  return sum;
}

/** מה שקרה בשאלת דאבל, כפי שנשמר בגיבוי (`meta.villaDoubles`) והשרת סופר ממנו כרטיסים. */
export interface VillaDoubleMeta {
  slideId: number;
  /** מסך ההכרזה שלפניה, אם יש. */
  introSlideId?: number;
  poolId: string;
  n: number;
  correct: number;
  base: number;
  tickets: number;
  /** הנוסח והתשובות, כדי שדוח התוצאות במערכת יצירת המשחקים יציג את השאלה. */
  que: string;
  answers: Array<{ id: number; ans: string; correct: boolean }>;
}

/** כל השקופיות שמערכת יצירת המשחקים הוסיפה בשביל הדאבל (הכרזות ושאלות), לפי הסדר. */
export function villaSlideIds(game: GameFile): number[] {
  return game.questions.filter(isVillaSlide).map((s) => s.id);
}

/** שקופית שנוספה בשביל הדאבל: הכרזה או שאלה. */
export function isVillaSlide(slide: Slide | undefined): boolean {
  return isDoubleSlide(slide) || isDoubleIntro(slide);
}

/** יש בקובץ שאלות דאבל. */
export function hasVillaSlides(game: GameFile): boolean {
  return game.questions.some(isVillaSlide);
}

/**
 * מזהי השאלות במאגר של שאלות הדאבל שבקובץ, לגיבוי (`meta.villaPool`): כך השרת
 * יודע איזו תוכנית ההפעלה משחקת עוד לפני שנסגרה בה שאלה.
 */
export function villaPoolIds(game: GameFile): string[] {
  return game.questions.filter(isDoubleSlide).map((s) => s.double.poolId);
}

/**
 * ההפעלה ששאלות הדאבל קשורות אליה (`run` על השקופיות שלהן: ה-startedAt של
 * ההפעלה שהן כבר הופיעו בה), או null כשהן פתוחות לכל הפעלה. שקופיות שאינן
 * מסכימות → 1-, שאף הפעלה אינה מתאימה לו.
 */
export function villaRunOf(game: GameFile): number | null {
  const runs = new Set<number>();
  for (const s of game.questions) {
    const run = isDoubleSlide(s) ? s.double.run : isDoubleIntro(s) ? s.doubleIntro?.run : undefined;
    if (run !== undefined) runs.add(run);
  }
  if (runs.size === 0) return null;
  return runs.size === 1 ? [...runs][0]! : -1;
}

/**
 * הקובץ בלי שאלות הדאבל: ההכרזות והשאלות יוצאות, ושאר השקופיות ממוספרות מחדש
 * 1..N לפי הסדר, בדיוק כמו הקובץ שהשרת שולח למשחק שאין לו שאלות דאבל (המזהה
 * הוא המקום). קובץ שהמזהים בו אינם המקום נשאר עם המזהים שלו. קובץ בלי שאלות
 * דאבל חוזר כמו שהוא.
 */
export function stripVillaSlides(game: GameFile): GameFile {
  if (!hasVillaSlides(game)) return game;
  const kept = game.questions.filter((s) => !isVillaSlide(s));
  if (kept.length === 0) return game; // לא קורה: שאלות הדאבל יושבות רק בין שתי שאלות של המשחק
  const positional = game.questions.every((s, i) => s.id === i + 1);
  return {
    ...game,
    questions: positional ? kept.map((s, i) => (s.id === i + 1 ? s : { ...s, id: i + 1 })) : kept,
  };
}

/** ההפעלה כבר הגיעה לשאלת דאבל: אחת מהן על המסך או מאחורינו (כמו `display` בגיבוי, שלפיו השרת סופר). */
export function villaReachedIn(
  game: GameFile,
  state: { slidesCompleted: readonly number[]; currentSlideId: number },
): boolean {
  const done = new Set(state.slidesCompleted);
  return game.questions.some((s) => isDoubleSlide(s) && (done.has(s.id) || s.id === state.currentSlideId));
}

/** מה קובע אם הפעלה חדשה משחקת את שאלות הדאבל. */
export interface VillaNewRun {
  /** villaRunOf של הקובץ. */
  run: number | null;
  /** שחקני דמה: הפעלה שאינה נשמרת לא מציגה אותן. */
  crowd: boolean;
  /** בחלון הזה כבר הופיעה שאלת דאבל, בהפעלה קודמת. */
  reachedHere: boolean;
  /** המפעיל בחר «הפעלת ניסיון, בלי שאלות הדאבל» להפעלה הזאת. */
  declined?: boolean;
}

/**
 * הפעלה חדשה (המשחק נפתח, «משחק חדש» במקום המשך, או התחלה מחדש) משחקת את
 * שאלות הדאבל רק כשהן בקובץ ופתוחות לכל הפעלה, בלי שחקני דמה, כשעוד לא הופיעו
 * בחלון הזה וכשהמפעיל לא בחר בניסיון בלעדיהן.
 */
export function villaNewRunPlays(game: GameFile, input: VillaNewRun): boolean {
  return (
    hasVillaSlides(game) && input.run === null && !input.crowd && !input.reachedHere && input.declined !== true
  );
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * המשך של הפעלה שמורה: האם היא ממשיכה עם שאלות הדאבל שבקובץ (`play`), והאם
 * צריך להוריד מהגיבוי את שקופיות הדאבל שהיא שיחקה (`drop`, backupWithoutVillas)
 * כי הקובץ כבר אינו נושא אותן.
 *
 * - הקובץ קשור להפעלה (`run`): רק אותה הפעלה, ורק אם הגיבוי שלה שיחק דאבל.
 * - הקובץ פתוח לכל הפעלה: רק הפעלה ששיחקה בדיוק את אותן שקופיות (אותם מזהים).
 *   הפעלה שהתחילה בלעדיהן ממשיכה בלעדיהן, והפעלה ששיחקה תוכנית אחרת (מנהל התחיל
 *   אותן מחדש) ממשיכה בלי דאבל.
 */
export function villaResume(
  game: GameFile,
  backupMeta: { startedAt: number; villaSlides?: readonly number[] | undefined },
): { play: boolean; drop: boolean } {
  const fileIds = villaSlideIds(game);
  const backupIds = Array.isArray(backupMeta.villaSlides) ? backupMeta.villaSlides : [];
  const played = backupIds.length > 0;
  if (fileIds.length === 0) return { play: false, drop: played };
  const run = villaRunOf(game);
  const play = run !== null ? played && backupMeta.startedAt === run : played && sameIds(fileIds, backupIds);
  return { play, drop: played && !play };
}

/**
 * התוצאות לגיבוי: כל שאלת דאבל שההצבעה בה כבר נסגרה (עברנו ממנה, או שהיא
 * הנוכחית בשלב התוצאות). שאלה שדילגו עליה בלי הצבעות נשמרת עם 0 מתוך המשפחה.
 */
export function villaDoublesMeta(
  game: GameFile,
  state: {
    votesBySlide: Readonly<Record<number, Readonly<Record<string, number>>>>;
    slidesCompleted: readonly number[];
    currentSlideId: number;
    phase: GamePhase;
  },
  removed: ReadonlySet<string> = new Set(),
): VillaDoubleMeta[] {
  const completed = new Set(state.slidesCompleted);
  const out: VillaDoubleMeta[] = [];
  game.questions.forEach((slide, index) => {
    if (!isDoubleSlide(slide)) return;
    const closed =
      completed.has(slide.id) ||
      (slide.id === state.currentSlideId && (state.phase === 'results' || state.phase === 'ended'));
    if (!closed) return;
    const r = doubleResult(game, index, state.votesBySlide, removed);
    if (r === null) return;
    const before = game.questions[index - 1];
    out.push({
      slideId: slide.id,
      ...(before !== undefined && isDoubleIntro(before) ? { introSlideId: before.id } : {}),
      poolId: r.poolId,
      n: r.n,
      correct: r.correct,
      base: r.base,
      tickets: r.tickets,
      que: slide.question.que,
      answers: slide.question.answers.map((a) => ({ id: a.id, ans: a.ans, correct: a.correct })),
    });
  });
  return out;
}
