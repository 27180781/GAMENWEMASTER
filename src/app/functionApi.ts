/**
 * שקופית "פונקציה" (type: "function") — כשמגיעים אליה, המערכת שולחת את כל
 * נתוני המשחק ל-webhook חיצוני שהוגדר בעורך (function.api.url + method).
 *
 * המטען כולל, לכל משתתף: המספר (קליקר/טלפון), השם המשויך (אם יש), הניקוד,
 * ומה ענה בכל שאלה. בנוסף — סיכום שאלות וקבוצות. buildFunctionPayload טהור
 * (נבדק ביחידה); sendFunctionApi מבצע את הקריאה בפועל.
 */

import { isVotableSlide, type GameFile } from '../engine/index.ts';
import type { GameState } from '../engine/types.ts';
import type { RosterData } from './roster.ts';

/** קונפיג ה-API כפי שנשמר בשקופית (function.api). */
export interface FunctionApiConfig {
  url: string;
  method: string;
}

export interface FunctionAnswer {
  queId: number;
  answerId: number;
  correct: boolean;
}

export interface FunctionParticipant {
  /** המספר של הקליקר/הטלפון (voterId). */
  number: string;
  /** השם המשויך מהמרשם, או "" אם אין שם (רק מספר). */
  name: string;
  score: number;
  numAnswers: number;
  numCorrect: number;
  /** groupId המשויך (מהקטגוריה הראשונה), או null. */
  groupId: string | null;
  /** מה ענה בכל שאלה שהצביע בה. */
  answers: FunctionAnswer[];
}

export interface FunctionQuestion {
  queId: number;
  type: string;
  que: string;
  correctAnswerIds: number[];
}

export interface FunctionGroup {
  id: string;
  name: string;
  category: string;
  memberNumbers: string[];
  totalScore: number;
  avgScore: number;
}

export interface FunctionPayload {
  gameId: string;
  gameName: string;
  /** המייל שאליו המשחק מקושר (מגיע מ-cloudinaryFolder בקובץ המשחק); "" אם אין. */
  ownerEmail: string;
  sentAt: string;
  participantCount: number;
  participants: FunctionParticipant[];
  questions: FunctionQuestion[];
  groups: FunctionGroup[];
}

/** בונה את מטען נתוני המשחק שיישלח ל-webhook. */
export function buildFunctionPayload(
  game: GameFile,
  state: GameState,
  roster: RosterData,
  nameOf: (voterId: string) => string,
  now: Date = new Date(),
): FunctionPayload {
  const votable = game.questions.filter((s) => isVotableSlide(s));
  const correctBySlide = new Map<number, Set<number>>();
  for (const s of votable) {
    correctBySlide.set(s.id, new Set(s.question.answers.filter((a) => a.correct).map((a) => a.id)));
  }

  // כל המשתתפים: מי שהצביע, מי שיש לו ניקוד, ומי שמשויך לקבוצה.
  const voterIds = new Set<string>();
  for (const votes of Object.values(state.votesBySlide)) for (const id of Object.keys(votes)) voterIds.add(id);
  for (const id of Object.keys(state.scores)) voterIds.add(id);
  for (const id of Object.keys(roster.memberships)) voterIds.add(id);

  const participants: FunctionParticipant[] = [...voterIds].map((id) => {
    const answers: FunctionAnswer[] = [];
    let numCorrect = 0;
    for (const s of votable) {
      const answerId = state.votesBySlide[s.id]?.[id];
      if (answerId === undefined) continue;
      const correct = correctBySlide.get(s.id)?.has(answerId) ?? false;
      if (correct) numCorrect += 1;
      answers.push({ queId: s.id, answerId, correct });
    }
    const resolved = nameOf(id);
    const byCat = roster.memberships[id];
    const groupId = byCat !== undefined ? Object.values(byCat)[0] ?? null : null;
    return {
      number: id,
      name: resolved === id ? '' : resolved, // "" = אין שם משויך, רק מספר
      score: state.scores[id] ?? 0,
      numAnswers: answers.length,
      numCorrect,
      groupId,
      answers,
    };
  });
  participants.sort((a, b) => b.score - a.score || a.number.localeCompare(b.number));

  const questions: FunctionQuestion[] = votable.map((s) => ({
    queId: s.id,
    type: s.type,
    que: s.question.que,
    correctAnswerIds: s.question.answers.filter((a) => a.correct).map((a) => a.id),
  }));

  const groups: FunctionGroup[] = [];
  for (const category of roster.categories) {
    for (const group of category.groups) {
      const memberNumbers: string[] = [];
      for (const [playerId, byCat] of Object.entries(roster.memberships)) {
        if (byCat[category.id] === group.id) memberNumbers.push(playerId);
      }
      const totalScore = memberNumbers.reduce((sum, m) => sum + (state.scores[m] ?? 0), 0);
      groups.push({
        id: group.id,
        name: group.name,
        category: category.name,
        memberNumbers,
        totalScore,
        avgScore: memberNumbers.length > 0 ? totalScore / memberNumbers.length : 0,
      });
    }
  }

  return {
    gameId: game.id,
    gameName: game.name,
    ownerEmail: game.cloudinaryFolder,
    sentAt: now.toISOString(),
    participantCount: participants.length,
    participants,
    questions,
    groups,
  };
}

/**
 * שולח את המטען ל-webhook. POST — גוף JSON; GET — המטען מקודד בפרמטר `payload`
 * בכתובת (שימו לב: ב-GET ייתכן חשש מאורך URL במשחקים גדולים; מומלץ POST).
 * אין שימוש ב-keepalive בכוונה: keepalive מגביל את גוף הבקשה ל-64KB, ובמשחקים
 * גדולים המטען עלול לחרוג מכך ולהיכשל. זורק בשגיאה/סטטוס לא-תקין.
 */
export async function sendFunctionApi(api: FunctionApiConfig, payload: FunctionPayload): Promise<void> {
  const url = api.url.trim();
  if (url === '') throw new Error('לשקופית הפונקציה אין כתובת API');
  const method = api.method.trim().toUpperCase() === 'POST' ? 'POST' : 'GET';
  const body = JSON.stringify(payload);

  if (method === 'POST') {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return;
  }

  const sep = url.includes('?') ? '&' : '?';
  const res = await fetch(`${url}${sep}payload=${encodeURIComponent(body)}`, {
    method: 'GET',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
