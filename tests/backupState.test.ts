/**
 * המרות טהורות בין מצב המשחק לפורמט הגיבוי של Supabase ובחזרה (backupState.ts).
 */

import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/engine/index.ts';
import { fourAnswers, makeGame, makeSnapshot, rawSlide } from './helpers.ts';
import { backupToSnapshot, buildBackupPayload, rosterFromBackup } from '../src/app/backupState.ts';
import { addCategory, addGroup, assignGroupByNumber, EMPTY_ROSTER, type RosterData } from '../src/app/roster.ts';
import type { BackupData } from '../src/app/backup.ts';

const T0 = 1_000_000;

function twoTrivia() {
  return makeGame([
    rawSlide({ id: 1, type: 'trivia', que: 'ש1', answers: fourAnswers(2), scoreForQue: 10, timeForQue: 15 }),
    rawSlide({ id: 2, type: 'trivia', que: 'ש2', answers: fourAnswers(1), scoreForQue: 10, timeForQue: 15 }),
  ]);
}

/** מנוע אחרי סבב הצבעה בשקופית 1: a,c ענו נכון (2), b טעה (1). */
function playedEngine(): GameEngine {
  const engine = new GameEngine(twoTrivia());
  engine.dispatch({ type: 'ADVANCE', at: T0 }); // פותח הצבעה בשקופית 1
  engine.dispatch({ type: 'VOTE_SNAPSHOT', snapshot: makeSnapshot(1, 1, { a: 2, b: 1, c: 2 }), at: T0 + 1000 });
  engine.dispatch({ type: 'ADVANCE', at: T0 + 5000 }); // סגירה → תוצאות
  return engine;
}

function roster(): RosterData {
  let r = addCategory(EMPTY_ROSTER, 'עיר', 'cat1');
  r = addGroup(r, 'cat1', 'א', 'g1');
  r = addGroup(r, 'cat1', 'ב', 'g2');
  r = assignGroupByNumber(r, 'a', 'cat1', 1);
  r = assignGroupByNumber(r, 'c', 'cat1', 1);
  r = assignGroupByNumber(r, 'b', 'cat1', 2);
  return r;
}

describe('buildBackupPayload', () => {
  it('משתמשים: ניקוד, נכונות, וההצבעה האחרונה', () => {
    const p = buildBackupPayload(twoTrivia(), playedEngine().getState(), roster(), (id) => `שם-${id}`, 42);
    expect(p.users.a).toEqual({
      name: 'שם-a',
      score: 10,
      groupId: 'g1',
      numAnswers: 1,
      numCorrect: 1,
      details: { lastQue: 1, lastVote: 2 },
    });
    expect(p.users.b!.score).toBe(0);
    expect(p.users.b!.numCorrect).toBe(0);
    expect(p.users.b!.details).toEqual({ lastQue: 1, lastVote: 1 });
  });

  it('שאלות: פילוח הצבעות, נכונות והצגה', () => {
    const p = buildBackupPayload(twoTrivia(), playedEngine().getState(), roster(), (id) => id, 42);
    expect(p.questions['1']).toMatchObject({
      queId: 1,
      type: 'trivia',
      display: true,
      numVotes: 3,
      correctVotes: 2,
      answers: { '1': 1, '2': 2 },
    });
    expect(p.questions['2']!.display).toBe(false); // עוד לא הוצגה
  });

  it('קבוצות: סך ניקוד וחברים; ומטא: מיקום ושלב', () => {
    const p = buildBackupPayload(twoTrivia(), playedEngine().getState(), roster(), (id) => id, 42);
    const g1 = p.groups.find((g) => g.id === 'g1')!;
    expect(g1.score).toBe(20); // a(10)+c(10)
    expect(g1.memberIds.sort()).toEqual(['a', 'c']);
    expect(p.groups.find((g) => g.id === 'g2')!.score).toBe(0);
    expect(p.meta).toEqual({ currentQueId: 1, phase: 'results', startedAt: 42 });
  });
});

describe('backupToSnapshot + שחזור למנוע', () => {
  it('משחזר ניקוד, מיקום ושלב', () => {
    const p = buildBackupPayload(twoTrivia(), playedEngine().getState(), roster(), (id) => id, 42);
    const data: BackupData = { id: 'g', ...p, completed: false };
    const snap = backupToSnapshot(twoTrivia(), data);
    expect(snap.scores).toEqual({ a: 10, c: 10 });
    expect(snap.currentSlideId).toBe(1);
    expect(snap.phase).toBe('results');

    const restored = new GameEngine(twoTrivia());
    restored.restore(snap);
    const winners = restored.getWinners();
    expect(winners.map((w) => w.voterId).sort()).toEqual(['a', 'c']);
    expect(winners[0]!.score).toBe(10);
  });
});

describe('rosterFromBackup', () => {
  it('בונה מרשם עם קטגוריה אחת וקבוצות מהגיבוי', () => {
    const p = buildBackupPayload(twoTrivia(), playedEngine().getState(), roster(), (id) => `שם-${id}`, 42);
    const data: BackupData = { id: 'g', ...p, completed: false };
    const r = rosterFromBackup(data);
    expect(r.categories).toHaveLength(1);
    expect(r.categories[0]!.groups.map((g) => g.id).sort()).toEqual(['g1', 'g2']);
    expect(r.memberships.a).toEqual({ restored: 'g1' });
    expect(r.memberships.b).toEqual({ restored: 'g2' });
  });
});
