/**
 * סימולציית משחק מלא (PROMPT-M1 §4): הרצת fixtures אמיתיים מתחילתם לסופם עם
 * ReplayAdapter שמזרים VoteSnapshots מזויפים, ואימות מעברי מצבים, ניקוד,
 * ו-round-trip של serialize→restore.
 *
 * הערת פער מתועדת (הקבצים גוברים על המפרט): אף שקופית ב-4 ה-fixtures לא
 * מגיעה עם scoringReduction.active=true או firstClicker=true — בניגוד לנטען
 * ב-README לגבי beficha-uvilvavcha. לכן מקרי scoringReduction ו-firstClicker
 * מכוסים כאן על עותק של fixture אמיתי שבו הדגלים הודלקו ידנית.
 */

import { describe, expect, it } from 'vitest';
import { GameEngine, isVotableSlide, parseGameFile, type Slide } from '../src/engine/index.ts';
import {
  correctAnswerId,
  FIXTURE_NAMES,
  loadFixture,
  loadFixtureRaw,
  runFullGame,
} from './helpers.ts';

/**
 * תוכנית הצבעה דטרמיניסטית:
 * - alice בוחרת תמיד את התשובה הנכונה (ב-trivia) או תשובה 1 (אחרת).
 * - bob בוחר תמיד את תשובה 1.
 * - carol בוחרת תמיד את תשובה 2 (אם קיימת).
 */
function standardVotePlan(slide: Slide): Record<string, number> | null {
  const ids = slide.question.answers.map((a) => a.id);
  if (ids.length === 0) return null;
  const votes: Record<string, number> = {};
  votes['alice'] = slide.type === 'trivia' ? correctAnswerId(slide) : ids[0]!;
  votes['bob'] = ids[0]!;
  if (ids.length > 1) votes['carol'] = ids[1]!;
  return votes;
}

/** חישוב ניקוד צפוי בלתי-תלוי במנוע, לפי אותה תוכנית הצבעה. */
function expectedScores(game: ReturnType<typeof loadFixture>): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const slide of game.questions) {
    if (slide.type !== 'trivia') continue; // ניקוד השתתפות כבוי כברירת מחדל
    const votes = standardVotePlan(slide);
    if (!votes) continue;
    const correct = correctAnswerId(slide);
    for (const [voter, answerId] of Object.entries(votes)) {
      if (answerId === correct) scores[voter] = (scores[voter] ?? 0) + slide.question.scoreForQue;
    }
  }
  return scores;
}

describe('סימולציית משחק מלא על כל 4 הקבצים האמיתיים', () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name}: מתחילתו לסופו — מעברים תקינים וניקוד נכון`, () => {
      const game = loadFixture(name);
      const engine = new GameEngine(game);
      const log = runFullGame(engine, standardVotePlan);

      const finalState = engine.getState();
      expect(finalState.phase).toBe('ended');

      // כל השקופיות הושלמו, לפי הסדר
      expect(finalState.slidesCompleted).toEqual(game.questions.map((s) => s.id));

      // כל שקופית הצבעה עברה דרך voting ואז results
      for (const slide of game.questions) {
        if (!isVotableSlide(slide)) continue;
        const phases = log.transitions
          .filter((t) => t.slideId === slide.id)
          .map((t) => t.phase);
        expect(phases, `שקופית id=${slide.id}`).toContain('voting');
        expect(phases[phases.length - 1], `שקופית id=${slide.id}`).toBe('results');
        // לכל שקופית הצבעה נרשמו ההצבעות הסופיות
        expect(finalState.votesBySlide[slide.id]).toEqual(standardVotePlan(slide));
      }

      // שקופיות שאינן הצבעה לא פותחות חלון הצבעה
      for (const slide of game.questions) {
        if (isVotableSlide(slide)) continue;
        const phases = log.transitions.filter((t) => t.slideId === slide.id).map((t) => t.phase);
        expect(phases, `שקופית id=${slide.id}`).not.toContain('voting');
      }

      // הניקוד תואם חישוב בלתי-תלוי
      expect(finalState.scores).toEqual(expectedScores(game));
    });
  }

  it('serialize→restore באמצע משחק: המשך משני המנועים מגיע לאותה תוצאה', () => {
    const game = loadFixture('hadassah-ozen.json');
    const engine = new GameEngine(game);

    // משחקים עד אמצע הקובץ
    const half = Math.floor(game.questions.length / 2);
    let seq = 0;
    let steps = 0;
    while (engine.getState().slidesCompleted.length < half) {
      if (++steps > 2000) throw new Error('לולאה אינסופית בחצי הראשון');
      const state = engine.getState();
      if (state.activeMedia !== null) {
        engine.dispatch({ type: 'MEDIA_ENDED' });
      } else if (state.phase === 'voting') {
        const slide = engine.getCurrentSlide();
        const votes = standardVotePlan(slide);
        if (votes) {
          engine.dispatch({
            type: 'VOTE_SNAPSHOT',
            snapshot: {
              seq: ++seq,
              slideId: slide.id,
              counts: {},
              total: Object.keys(votes).length,
              voters: votes,
            },
          });
        }
        engine.dispatch({ type: 'VOTING_TIMEOUT' });
      } else {
        engine.dispatch({ type: 'ADVANCE' });
      }
    }

    // round-trip: השחזור משחזר את אותו snapshot בדיוק
    const snapshot = engine.serialize('2026-07-09T12:00:00.000Z');
    const restored = new GameEngine(loadFixture('hadassah-ozen.json'));
    restored.restore(snapshot);
    expect(restored.serialize('2026-07-09T12:00:01.000Z')).toEqual(
      engine.serialize('2026-07-09T12:00:01.000Z'),
    );

    // ממשיכים לשחק בשני המנועים באותם אירועים — תוצאה סופית זהה
    runFullGame(engine, standardVotePlan);
    runFullGame(restored, standardVotePlan);
    expect(restored.getState().phase).toBe('ended');
    expect(restored.getState().scores).toEqual(engine.getState().scores);
    expect(restored.getState().slidesCompleted).toEqual(engine.getState().slidesCompleted);
    expect(restored.getState().votesBySlide).toEqual(engine.getState().votesBySlide);
  });
});

describe('מקרי scoringReduction ו-firstClicker על fixture אמיתי (בהדלקה ידנית)', () => {
  interface RawFixture {
    questions: {
      id: number;
      type: string;
      question: { scoreForQue: number | ''; answers: { correct: boolean; id: number }[] };
      setting: {
        firstClicker: boolean;
        scoringReduction: { active: boolean; seconds: number | ''; score: number | '' };
      };
    }[];
  }

  it('scoringReduction פעיל על שקופית trivia אמיתית — מצביע איטי מקבל ניקוד מופחת', () => {
    const raw = loadFixtureRaw('beficha-uvilvavcha.json') as RawFixture;
    const trivia = raw.questions.find((q) => q.type === 'trivia');
    expect(trivia).toBeDefined();
    trivia!.setting.scoringReduction = { active: true, seconds: 5, score: 1 };
    const game = parseGameFile(raw);
    const slide = game.questions.find((s) => s.id === trivia!.id)!;
    const correct = correctAnswerId(slide);
    const fullScore = slide.question.scoreForQue;

    const engine = new GameEngine(game);
    engine.dispatch({ type: 'GOTO', slideId: slide.id, at: 0 });
    // אם יש openMedia — מדלגים; אם ההצבעה לא נפתחה אוטומטית — פותחים ידנית
    if (engine.getState().activeMedia !== null) engine.dispatch({ type: 'MEDIA_ENDED', at: 0 });
    if (engine.getState().phase === 'showing') engine.dispatch({ type: 'ADVANCE', at: 0 });
    expect(engine.getState().phase).toBe('voting'); // ההצבעה נפתחה ב-t=0
    engine.dispatch({
      type: 'VOTE_SNAPSHOT',
      snapshot: { seq: 1, slideId: slide.id, counts: {}, total: 1, voters: { fast: correct } },
      at: 2000, // אחרי 2 שניות — לפני הסף
    });
    engine.dispatch({
      type: 'VOTE_SNAPSHOT',
      snapshot: {
        seq: 2,
        slideId: slide.id,
        counts: {},
        total: 2,
        voters: { fast: correct, slow: correct },
      },
      at: 8000, // אחרי 8 שניות — מעבר לסף של 5
    });
    engine.dispatch({ type: 'VOTING_TIMEOUT', at: 20000 });
    expect(engine.getState().scores).toEqual({ fast: fullScore, slow: 1 });
  });

  it('firstClicker פעיל על שקופית trivia אמיתית — רק הראשון זוכה בניקוד', () => {
    const raw = loadFixtureRaw('neuwirth.json') as RawFixture;
    const trivia = raw.questions.find((q) => q.type === 'trivia');
    expect(trivia).toBeDefined();
    trivia!.setting.firstClicker = true;
    const game = parseGameFile(raw);
    const slide = game.questions.find((s) => s.id === trivia!.id)!;
    const correct = correctAnswerId(slide);

    const engine = new GameEngine(game);
    engine.dispatch({ type: 'GOTO', slideId: slide.id });
    if (engine.getState().activeMedia !== null) engine.dispatch({ type: 'MEDIA_ENDED' });
    if (engine.getState().phase === 'showing') engine.dispatch({ type: 'ADVANCE' });
    expect(engine.getState().phase).toBe('voting');
    engine.dispatch({
      type: 'VOTE_SNAPSHOT',
      snapshot: {
        seq: 1,
        slideId: slide.id,
        counts: {},
        total: 3,
        voters: { a: correct, b: correct, c: correct },
        firstVoter: 'b',
      },
    });
    engine.dispatch({ type: 'VOTING_TIMEOUT' });
    expect(engine.getState().scores).toEqual({ b: slide.question.scoreForQue });
    expect(engine.getState().firstClickWinners).toEqual({ [slide.id]: 'b' });
  });
});
