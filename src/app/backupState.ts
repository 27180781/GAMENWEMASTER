/**
 * המרות טהורות בין מצב המשחק (מנוע + מרשם) לפורמט הגיבוי של Supabase, ובחזרה.
 * ראו backup.ts למבנה השדות ולמסמך האינטגרציה.
 */

import { isVotableSlide, type GameFile } from '../engine/index.ts';
import type { GamePhase, GameSnapshot, GameState } from '../engine/types.ts';
import type { RosterData } from './roster.ts';
import type { BackupData, BackupGroup, BackupPayload, BackupQuestion, BackupUser } from './backup.ts';

/** קבוצת התשובות הנכונות לכל שקופית trivia. */
function correctAnswersBySlide(game: GameFile): Map<number, Set<number>> {
  const map = new Map<number, Set<number>>();
  for (const slide of game.questions) {
    if (slide.type === 'trivia') {
      map.set(slide.id, new Set(slide.question.answers.filter((a) => a.correct).map((a) => a.id)));
    }
  }
  return map;
}

/**
 * בונה את מטען הגיבוי מהמצב הנוכחי: משתמשים (ניקוד/סטטיסטיקה/שיוך), שאלות
 * (התקדמות + פילוח הצבעות), קבוצות (סך ניקוד + חברים), ומטא (איפה אוחזים).
 */
export function buildBackupPayload(
  game: GameFile,
  state: GameState,
  roster: RosterData,
  nameOf: (voterId: string) => string,
  startedAt: number,
): BackupPayload {
  const correctBySlide = correctAnswersBySlide(game);
  const votesBySlide = state.votesBySlide;

  const voterIds = new Set<string>();
  for (const votes of Object.values(votesBySlide)) for (const id of Object.keys(votes)) voterIds.add(id);
  for (const id of Object.keys(state.scores)) voterIds.add(id);
  for (const id of Object.keys(roster.memberships)) voterIds.add(id);

  const users: Record<string, BackupUser> = {};
  for (const voterId of voterIds) {
    let numAnswers = 0;
    let numCorrect = 0;
    let lastQue: number | null = null;
    let lastVote: number | null = null;
    for (const slide of game.questions) {
      const answerId = votesBySlide[slide.id]?.[voterId];
      if (answerId === undefined) continue;
      numAnswers += 1;
      if (correctBySlide.get(slide.id)?.has(answerId)) numCorrect += 1;
      lastQue = slide.id;
      lastVote = answerId;
    }
    const byCat = roster.memberships[voterId];
    const groupId = byCat !== undefined ? Object.values(byCat)[0] ?? null : null;
    users[voterId] = {
      name: nameOf(voterId),
      score: state.scores[voterId] ?? 0,
      groupId,
      numAnswers,
      numCorrect,
      details: { lastQue, lastVote },
    };
  }

  const questions: Record<string, BackupQuestion> = {};
  for (const slide of game.questions) {
    if (!isVotableSlide(slide)) continue;
    const votes = votesBySlide[slide.id];
    const correctSet = correctBySlide.get(slide.id);
    const answers: Record<string, number> = {};
    let numVotes = 0;
    let correctVotes = 0;
    if (votes !== undefined) {
      for (const answerId of Object.values(votes)) {
        answers[String(answerId)] = (answers[String(answerId)] ?? 0) + 1;
        numVotes += 1;
        if (correctSet?.has(answerId)) correctVotes += 1;
      }
    }
    questions[String(slide.id)] = {
      queId: slide.id,
      type: slide.type,
      display: state.slidesCompleted.includes(slide.id) || slide.id === state.currentSlideId,
      numVotes,
      correctVotes,
      answers,
    };
  }

  const groups: BackupGroup[] = [];
  for (const category of roster.categories) {
    for (const group of category.groups) {
      const memberIds: string[] = [];
      for (const [playerId, byCat] of Object.entries(roster.memberships)) {
        if (byCat[category.id] === group.id) memberIds.push(playerId);
      }
      const score = memberIds.reduce((sum, m) => sum + (state.scores[m] ?? 0), 0);
      groups.push({ id: group.id, name: group.name, score, memberIds });
    }
  }

  return {
    users,
    questions,
    groups,
    meta: { currentQueId: state.currentSlideId, phase: state.phase, startedAt },
  };
}

/** מיפוי מחרוזת השלב מהגיבוי לשלב המנוע (תומך גם במחרוזות תיאוריות). */
function mapPhase(phase: string): GamePhase {
  if (phase === 'showing' || phase === 'voting' || phase === 'results' || phase === 'ended') return phase;
  if (phase.includes('vot')) return 'voting';
  if (phase.includes('result') || phase.includes('winner')) return 'results';
  if (phase.includes('end')) return 'ended';
  return 'showing';
}

/**
 * בונה GameSnapshot של המנוע מגיבוי — לשחזור. הניקוד והמיקום משוחזרים במלואם;
 * votesBySlide אינו ניתן לשחזור מדויק (הפורמט מצטבר) ולכן ריק — חזרה אחורה
 * לשקופית שכבר נוקדה תחשב אותה מחדש (מגבלה מתועדת, כמו בשחזור snapshot רגיל).
 */
export function backupToSnapshot(game: GameFile, backup: BackupData): GameSnapshot {
  const scores: Record<string, number> = {};
  for (const [voterId, user] of Object.entries(backup.users)) {
    if (user.score !== 0) scores[voterId] = user.score;
  }
  const currentSlideId = backup.meta.currentQueId ?? game.questions[0]?.id ?? 0;
  const slidesCompleted = Object.values(backup.questions)
    .filter((q) => q.display && q.queId !== currentSlideId)
    .map((q) => q.queId);
  return {
    version: 1,
    gameId: game.id,
    roomId: game.room !== undefined && game.room !== '' ? game.room : null,
    seq: 0,
    savedAt: new Date().toISOString(),
    currentSlideId,
    phase: mapPhase(backup.meta.phase),
    scores,
    votesBySlide: {},
    slidesCompleted,
    firstClickWinners: {},
  };
}

/**
 * בונה מרשם מגיבוי (fallback לשחזור במכשיר אחר שבו אין את המרשם ב-localStorage).
 * הקבוצות מהגיבוי שטוחות (בלי קטגוריות) — מאוחדות תחת קטגוריה אחת "קבוצות".
 */
export function rosterFromBackup(backup: BackupData): RosterData {
  const CAT = 'restored';
  const groups = backup.groups.map((g) => ({ id: g.id, name: g.name }));
  const memberships: RosterData['memberships'] = {};
  for (const g of backup.groups) {
    for (const memberId of g.memberIds) {
      memberships[memberId] = { ...(memberships[memberId] ?? {}), [CAT]: g.id };
    }
  }
  const players = Object.entries(backup.users).map(([id, u]) => ({ id, name: u.name }));
  return {
    players,
    categories: groups.length > 0 ? [{ id: CAT, name: 'קבוצות', groups }] : [],
    memberships,
  };
}
