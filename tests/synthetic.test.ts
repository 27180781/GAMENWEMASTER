import { describe, expect, it } from 'vitest';
import { planCrowdVotes, snapshotAt } from '../src/app/syntheticVotes.ts';
import { hexToRgb, themeColors } from '../src/render/theme.ts';
import { GameEngine } from '../src/engine/index.ts';
import { fourAnswers, loadFixture, makeGame, rawSlide } from './helpers.ts';

describe('planCrowdVotes — קהל סינתטי דטרמיניסטי', () => {
  const game = makeGame([
    rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(2), scoreForQue: 10, timeForQue: 15 }),
  ]);
  const slide = game.questions[0]!;

  it('אותו seed → אותה תוכנית; תוכנית ממוינת לפי זמן ובתוך החלון', () => {
    const a = planCrowdVotes(slide, { seed: 42, voterCount: 30 });
    const b = planCrowdVotes(slide, { seed: 42, voterCount: 30 });
    expect(a).toEqual(b);
    expect(a).toHaveLength(30);
    for (let i = 1; i < a.length; i++) {
      expect(a[i]!.atOffsetMs).toBeGreaterThanOrEqual(a[i - 1]!.atOffsetMs);
    }
    for (const vote of a) {
      expect(vote.atOffsetMs).toBeGreaterThanOrEqual(500);
      expect(vote.atOffsetMs).toBeLessThanOrEqual(15000);
      expect([1, 2, 3, 4]).toContain(vote.answerId);
    }
  });

  it('שקופית ללא תשובות → תוכנית ריקה', () => {
    const mediaGame = makeGame([
      rawSlide({ id: 1, type: 'media', openMediaSrc: 'https://x.dev/v.mp4' }),
    ]);
    expect(planCrowdVotes(mediaGame.questions[0]!)).toEqual([]);
  });

  it('snapshotAt מצטבר: מונים לא יורדים ו-firstVoter הוא המצביע המוקדם ביותר', () => {
    const plan = planCrowdVotes(slide, { seed: 7, voterCount: 25 });
    let previousTotal = 0;
    for (const elapsed of [0, 2000, 5000, 10000, 20000]) {
      const snapshot = snapshotAt(plan, slide.id, elapsed, elapsed / 100 + 1);
      expect(snapshot.total).toBeGreaterThanOrEqual(previousTotal);
      previousTotal = snapshot.total;
      const countsSum = Object.values(snapshot.counts).reduce((a, b) => a + b, 0);
      expect(countsSum).toBe(snapshot.total);
      expect(Object.keys(snapshot.voters ?? {})).toHaveLength(snapshot.total);
    }
    const full = snapshotAt(plan, slide.id, 20000, 99);
    expect(full.total).toBe(25);
    expect(full.firstVoter).toBe(plan[0]!.voterId);
  });

  it('הזרמת הקהל הסינתטי דרך המנוע מולידה ניקוד עקבי עם התוכנית', () => {
    const engine = new GameEngine(game);
    expect(engine.getState().phase).toBe('voting');
    const plan = planCrowdVotes(slide, { seed: 11 });
    engine.dispatch({
      type: 'VOTE_SNAPSHOT',
      snapshot: snapshotAt(plan, slide.id, 20000, 1),
    });
    engine.dispatch({ type: 'VOTING_TIMEOUT' });
    const correctVoters = plan.filter((v) => v.answerId === 2).map((v) => v.voterId);
    const scores = engine.getState().scores;
    expect(Object.keys(scores).sort()).toEqual([...new Set(correctVoters)].sort());
    for (const voter of correctVoters) expect(scores[voter]).toBe(10);
  });
});

describe('theme — צבעים ל-CSS', () => {
  it('מפרק HEX של 8 ספרות (עם אלפא) ושל 6', () => {
    expect(hexToRgb('#FECC39FF')).toEqual({ r: 0xfe, g: 0xcc, b: 0x39 });
    expect(hexToRgb('#222B45C2')).toEqual({ r: 0x22, g: 0x2b, b: 0x45 });
    expect(hexToRgb('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('red')).toBeNull();
  });

  it('themeColors על הקבצים האמיתיים', () => {
    const game = loadFixture('masaa-sync-manual-link.json');
    const colors = themeColors(game.setting);
    expect(colors.main).toBe('#FECC39FF');
    expect(colors.mainRgb).toBe('254, 204, 57');
    expect(colors.secondaryRgb).toBe('3, 16, 81');
  });
});
