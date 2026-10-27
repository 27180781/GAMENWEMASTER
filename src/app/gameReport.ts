/**
 * בונה קובץ אקסל סיכום לסוף המשחק. שלושה גליונות:
 *   • משתתפים — מה כל שחקן ענה בכל שאלה, כמה נענו/נכונות, וניקוד סופי.
 *   • שאלות — פילוח הצבעות לכל שאלה (תשובה נכונה, מס׳ עונים, אחוז נכון, בחירות).
 *   • קבוצות — דירוג הקבוצות לכל קטגוריה (ניקוד כולל, בונוס, ממוצע, מהירות
 *     ממוצעת), באותו סדר כמו מסך דירוג הקבוצות (מקש 4) — כולל הבונוס הידני.
 *
 * טהור (פרט לפונקציית ההורדה) — buildReportSheets ניתן לבדיקה ביחידה.
 */

import { betSlideFor, isVotableSlide, questionLabel, type GameFile } from '../engine/index.ts';
import type { GameState } from '../engine/types.ts';
import type { RosterData } from './roster.ts';
import { groupStandings } from './groupScore.ts';
import { buildXlsxBlob, downloadBlob, type Cell, type SheetData } from './xlsx.ts';

/** בונה את שלושת גליונות הסיכום מהמצב הנוכחי של המשחק. */
export function buildReportSheets(
  game: GameFile,
  state: GameState,
  roster: RosterData,
  nameOf: (voterId: string) => string,
  /** בונוסים ידניים לקבוצות (ראו scoreAdjust.ts). חסר = אין בונוסים. */
  groupBonus?: Readonly<Record<string, number>>,
): SheetData[] {
  // הימור מצביע אבל אינו שאלה — הוא מקבל גליון משלו ולא עמודת "ש".
  const votable = game.questions.filter((s) => isVotableSlide(s) && s.type !== 'bet');
  const correctBySlide = new Map<number, Set<number>>();
  for (const s of votable) {
    correctBySlide.set(s.id, new Set(s.question.answers.filter((a) => a.correct).map((a) => a.id)));
  }

  // איסוף כל המשתתפים: מי שהצביע, מי שיש לו ניקוד, ומי שמשויך לקבוצה.
  const voterIds = new Set<string>();
  for (const votes of Object.values(state.votesBySlide)) for (const id of Object.keys(votes)) voterIds.add(id);
  for (const id of Object.keys(state.scores)) voterIds.add(id);
  for (const id of Object.keys(roster.memberships)) voterIds.add(id);

  // ---- גליון משתתפים ----
  const participantHeader: Cell[] = [
    'שם',
    'מזהה',
    ...votable.map((_, i) => `ש${i + 1}`),
    'נענו',
    'נכונות',
    'ניקוד',
  ];
  const participants = [...voterIds].map((id) => {
    let answered = 0;
    let correct = 0;
    const perQuestion: Cell[] = votable.map((s) => {
      const a = state.votesBySlide[s.id]?.[id];
      if (a === undefined) return null;
      answered += 1;
      if (correctBySlide.get(s.id)?.has(a)) correct += 1;
      return a;
    });
    return { id, name: nameOf(id), perQuestion, answered, correct, score: state.scores[id] ?? 0 };
  });
  participants.sort(
    (a, b) => b.score - a.score || b.correct - a.correct || a.name.localeCompare(b.name, 'he'),
  );
  const participantsRows: Cell[][] = [
    participantHeader,
    ...participants.map((p) => [p.name, p.id, ...p.perQuestion, p.answered, p.correct, p.score]),
  ];

  // ---- גליון שאלות ----
  const maxOption = votable.reduce(
    (m, s) => Math.max(m, ...s.question.answers.map((a) => a.id)),
    0,
  );
  const questionHeader: Cell[] = [
    '#',
    'שאלה',
    'תשובה נכונה',
    'מס׳ עונים',
    'ענו נכון',
    '% נכון',
    ...Array.from({ length: maxOption }, (_, i) => `בחרו ${i + 1}`),
  ];
  const questionsRows: Cell[][] = [
    questionHeader,
    ...votable.map((s, idx) => {
      const votes = state.votesBySlide[s.id] ?? {};
      const chosen = Object.values(votes);
      const correctSet = correctBySlide.get(s.id) ?? new Set<number>();
      const numVotes = chosen.length;
      const correctVotes = chosen.filter((a) => correctSet.has(a)).length;
      const pct = numVotes > 0 ? Math.round((correctVotes / numVotes) * 100) : 0;
      const correctLabel =
        s.question.answers
          .filter((a) => a.correct)
          .map((a) => a.id)
          .join(', ') || '—';
      const optionIds = new Set(s.question.answers.map((a) => a.id));
      const perOption: Cell[] = Array.from({ length: maxOption }, (_, i) =>
        optionIds.has(i + 1) ? chosen.filter((a) => a === i + 1).length : null,
      );
      return [idx + 1, questionLabel(s.question), correctLabel, numVotes, correctVotes, `${pct}%`, ...perOption];
    }),
  ];

  // ---- גליון קבוצות ----
  const groupHeader: Cell[] = [
    'קטגוריה',
    'קבוצה',
    'מס׳',
    'חברים',
    'ניקוד כולל',
    'בונוס',
    'ניקוד ממוצע',
    'מהירות ממוצעת (שנ׳)',
  ];
  const groupRows: Cell[][] = [];
  for (const category of roster.categories) {
    if (category.groups.length === 0) continue;
    // הדירוג והממוצע כולל הבונוס — כמו במסך דירוג הקבוצות ובפס הקבוצות. עד
    // 2026-10 הגליון דירג בלעדיו, ואחרי בונוס הראה סדר אחר ממה שהוצג במקש 4.
    for (const st of groupStandings(roster, category.id, state.scores, state.answerTimes, groupBonus)) {
      const speed: Cell = Number.isFinite(st.avgMs) ? Math.round(st.avgMs / 100) / 10 : '—';
      groupRows.push([
        category.name,
        st.name,
        st.number,
        st.memberCount,
        st.totalScore,
        st.bonus,
        Math.round(st.avgScore * 10) / 10,
        speed,
      ]);
    }
  }
  const groupsRows: Cell[][] =
    groupRows.length > 0 ? [groupHeader, ...groupRows] : [groupHeader, ['—', 'אין שיוך קבוצתי']];

  const sheets: SheetData[] = [
    { name: 'משתתפים', rows: participantsRows },
    { name: 'שאלות', rows: questionsRows },
    { name: 'קבוצות', rows: groupsRows },
  ];

  // ---- גליון הימורים (רק כשיש שקופיות הימור במשחק) ----
  if (game.questions.some((s) => s.type === 'bet')) {
    const betHeader: Cell[] = ['הימור', 'שאלה מכריעה', 'שם', 'מזהה', 'הימור (נק׳)', 'תוצאה', 'שינוי בניקוד'];
    const betRows: Cell[][] = [betHeader];
    game.questions.forEach((s, index) => {
      const outcomes = state.betOutcomes[s.id];
      if (outcomes === undefined) return;
      const bet = betSlideFor(game, index);
      const betLabel = bet === null ? 'הימור' : bet.question.que.trim() || 'הימור';
      const rows = Object.entries(outcomes).sort((a, b) => b[1].delta - a[1].delta || a[0].localeCompare(b[0]));
      for (const [id, o] of rows) {
        betRows.push([betLabel, questionLabel(s.question), nameOf(id), id, o.stake, o.won ? 'זכה' : 'הפסיד', o.delta]);
      }
    });
    sheets.push({
      name: 'הימורים',
      rows: betRows.length > 1 ? betRows : [betHeader, ['—', 'לא היו הימורים']],
    });
  }

  return sheets;
}

/**
 * שם קובץ בטוח לפי שם/מזהה המשחק, והתאריך והשעה שבהם ההפעלה התחילה (שעון
 * המחשב). כל הפעלה מקבלת קובץ משלה: השמירה החיה אחרי כל שאלה דורסת רק את
 * הקובץ של אותה הפעלה, והמשך מגיבוי (אותו startedAt) ממשיך באותו קובץ. עד
 * 2026-10 השם נשא רק את התאריך, ושתי הפעלות באותו יום נכתבו לאותו קובץ.
 * ‏':' אסור בשם קובץ ב-Windows, ולכן השעה היא HH-MM.
 */
export function reportFilename(game: GameFile, startedAt: Date = new Date()): string {
  const base = (game.name || game.id || 'game').replace(/[\\/?*[\]:]/g, ' ').trim() || 'game';
  const two = (n: number) => String(n).padStart(2, '0');
  const day = `${startedAt.getFullYear()}-${two(startedAt.getMonth() + 1)}-${two(startedAt.getDate())}`;
  return `סיכום-${base}-${day}-${two(startedAt.getHours())}-${two(startedAt.getMinutes())}.xlsx`;
}

/** בונה ומוריד את קובץ הסיכום (בדפדפן). */
export async function downloadGameReport(
  game: GameFile,
  state: GameState,
  roster: RosterData,
  nameOf: (voterId: string) => string,
  groupBonus?: Readonly<Record<string, number>>,
  startedAt?: number,
): Promise<void> {
  const blob = await buildXlsxBlob(buildReportSheets(game, state, roster, nameOf, groupBonus));
  downloadBlob(blob, reportFilename(game, startedAt !== undefined ? new Date(startedAt) : new Date()));
}

/** בונה את קובץ הסיכום כבייטים (לשמירה לדיסק ב-EXE, במקום הורדה בדפדפן). */
export async function buildGameReportBytes(
  game: GameFile,
  state: GameState,
  roster: RosterData,
  nameOf: (voterId: string) => string,
  groupBonus?: Readonly<Record<string, number>>,
): Promise<Uint8Array> {
  const blob = await buildXlsxBlob(buildReportSheets(game, state, roster, nameOf, groupBonus));
  return new Uint8Array(await blob.arrayBuffer());
}
