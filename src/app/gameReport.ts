/**
 * בונה קובץ אקסל סיכום לסוף המשחק. שלושה גליונות:
 *   • משתתפים — מה כל שחקן ענה בכל שאלה, כמה נענו/נכונות, וניקוד סופי.
 *   • שאלות — פילוח הצבעות לכל שאלה (תשובה נכונה, מס׳ עונים, אחוז נכון, בחירות).
 *   • קבוצות — דירוג הקבוצות לכל קטגוריה (ניקוד כולל/ממוצע, מהירות ממוצעת).
 *
 * טהור (פרט לפונקציית ההורדה) — buildReportSheets ניתן לבדיקה ביחידה.
 */

import { isVotableSlide, type GameFile } from '../engine/index.ts';
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
): SheetData[] {
  const votable = game.questions.filter((s) => isVotableSlide(s));
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
      return [idx + 1, s.question.que, correctLabel, numVotes, correctVotes, `${pct}%`, ...perOption];
    }),
  ];

  // ---- גליון קבוצות ----
  const groupHeader: Cell[] = [
    'קטגוריה',
    'קבוצה',
    'מס׳',
    'חברים',
    'ניקוד כולל',
    'ניקוד ממוצע',
    'מהירות ממוצעת (שנ׳)',
  ];
  const groupRows: Cell[][] = [];
  for (const category of roster.categories) {
    if (category.groups.length === 0) continue;
    for (const st of groupStandings(roster, category.id, state.scores, state.answerTimes)) {
      const speed: Cell = Number.isFinite(st.avgMs) ? Math.round(st.avgMs / 100) / 10 : '—';
      groupRows.push([
        category.name,
        st.name,
        st.number,
        st.memberCount,
        st.totalScore,
        Math.round(st.avgScore * 10) / 10,
        speed,
      ]);
    }
  }
  const groupsRows: Cell[][] =
    groupRows.length > 0 ? [groupHeader, ...groupRows] : [groupHeader, ['—', 'אין שיוך קבוצתי']];

  return [
    { name: 'משתתפים', rows: participantsRows },
    { name: 'שאלות', rows: questionsRows },
    { name: 'קבוצות', rows: groupsRows },
  ];
}

/** שם קובץ בטוח לפי שם/מזהה המשחק ותאריך. */
export function reportFilename(game: GameFile, now: Date = new Date()): string {
  const base = (game.name || game.id || 'game').replace(/[\\/?*[\]:]/g, ' ').trim() || 'game';
  return `סיכום-${base}-${now.toISOString().slice(0, 10)}.xlsx`;
}

/** בונה ומוריד את קובץ הסיכום (בדפדפן). */
export async function downloadGameReport(
  game: GameFile,
  state: GameState,
  roster: RosterData,
  nameOf: (voterId: string) => string,
): Promise<void> {
  const blob = await buildXlsxBlob(buildReportSheets(game, state, roster, nameOf));
  downloadBlob(blob, reportFilename(game));
}

/** בונה את קובץ הסיכום כבייטים (לשמירה לדיסק ב-EXE, במקום הורדה בדפדפן). */
export async function buildGameReportBytes(
  game: GameFile,
  state: GameState,
  roster: RosterData,
  nameOf: (voterId: string) => string,
): Promise<Uint8Array> {
  const blob = await buildXlsxBlob(buildReportSheets(game, state, roster, nameOf));
  return new Uint8Array(await blob.arrayBuffer());
}
