import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_SETTINGS, parseAppParams, shouldRedirectHome } from '../src/app/urlParams.ts';
import { planCrowdVotes } from '../src/app/syntheticVotes.ts';
import { fourAnswers, makeGame, rawSlide } from './helpers.ts';

describe('parseAppParams — פרמטרים בכתובת', () => {
  it('?game=<URL> נקלט', () => {
    expect(parseAppParams('?game=https://example.com/game.json')).toEqual({
      gameUrl: 'https://example.com/game.json',
      pushUrl: null,
      voteServer: null,
      demo: false,
    });
  });

  it('&demo=1 (וגם demo ריק / true) מדליק מצב דמו', () => {
    expect(parseAppParams('?game=https://x.dev/g.json&demo=1')).toEqual({
      gameUrl: 'https://x.dev/g.json',
      pushUrl: null,
      voteServer: null,
      demo: true,
    });
    expect(parseAppParams('?demo').demo).toBe(true);
    expect(parseAppParams('?demo=true').demo).toBe(true);
    expect(parseAppParams('?demo=0').demo).toBe(false);
  });

  it('&push=<URL> — ערוץ הפוש נקלט', () => {
    const encoded = encodeURIComponent('https://srv.example/events?room=42');
    const { pushUrl } = parseAppParams(`?game=https://x.dev/g.json&push=${encoded}`);
    expect(pushUrl).toBe('https://srv.example/events?room=42');
    expect(parseAppParams('?game=https://x.dev/g.json').pushUrl).toBe(null);
    expect(parseAppParams('?push=').pushUrl).toBe(null);
  });

  it('בלי פרמטרים — ברירות מחדל', () => {
    expect(parseAppParams('')).toEqual({ gameUrl: null, pushUrl: null, voteServer: null, demo: false });
    expect(parseAppParams('?game=')).toEqual({
      gameUrl: null,
      pushUrl: null,
      voteServer: null,
      demo: false,
    });
  });

  it('URL עם פרמטרים משלו (מקודד) נשמר במלואו', () => {
    const encoded = encodeURIComponent('https://cdn.example/games/1.json?v=2&sig=abc');
    const { gameUrl } = parseAppParams(`?game=${encoded}&demo=1`);
    expect(gameUrl).toBe('https://cdn.example/games/1.json?v=2&sig=abc');
  });
});

describe('shouldRedirectHome — הפניה לאתר הראשי ב-URL הציבורי', () => {
  const prod = 'gamemwemaster.caprover.clicker.co.il';

  it('ווב ציבורי בלי ?game= → מפנים', () => {
    expect(shouldRedirectHome({ protocol: 'https:', hostname: prod, hasGameUrl: false })).toBe(true);
    // גם GitHub Pages
    expect(shouldRedirectHome({ protocol: 'https:', hostname: '27180781.github.io', hasGameUrl: false })).toBe(true);
  });

  it('ווב ציבורי עם ?game= → לא מפנים (המשחק תקין)', () => {
    expect(shouldRedirectHome({ protocol: 'https:', hostname: prod, hasGameUrl: true })).toBe(false);
  });

  it('פיתוח מקומי (localhost/127.0.0.1/.local/ריק) → לא מפנים גם בלי ?game=', () => {
    for (const hostname of ['localhost', '127.0.0.1', 'my-box.local', '']) {
      expect(shouldRedirectHome({ protocol: 'http:', hostname, hasGameUrl: false })).toBe(false);
    }
  });

  it('EXE אופליין (file://) → לא מפנים', () => {
    expect(shouldRedirectHome({ protocol: 'file:', hostname: '', hasGameUrl: false })).toBe(false);
  });
});

describe('מהירות הצבעה (speedFactor) בקהל הדמה', () => {
  const game = makeGame([
    rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(2), scoreForQue: 10, timeForQue: 20 }),
  ]);
  const slide = game.questions[0]!;

  it('speedFactor קטן דוחס את כל ההצבעות לתחילת החלון', () => {
    const fast = planCrowdVotes(slide, { seed: 5, voterCount: 200, speedFactor: 0.12 });
    const slow = planCrowdVotes(slide, { seed: 5, voterCount: 200, speedFactor: 1 });
    const maxFast = Math.max(...fast.map((v) => v.atOffsetMs));
    const maxSlow = Math.max(...slow.map((v) => v.atOffsetMs));
    expect(maxFast).toBeLessThanOrEqual(0.12 * 20000);
    expect(maxSlow).toBeGreaterThan(maxFast * 2);
  });

  it('תומך בעומס של 5,000 שחקנים (SPEC סעיף 6)', () => {
    const plan = planCrowdVotes(slide, { voterCount: 5000, speedFactor: 0.75 });
    expect(plan).toHaveLength(5000);
    expect(new Set(plan.map((v) => v.voterId)).size).toBe(5000);
  });

  it('קונפיגורציית ברירת המחדל של ההגדרות שפויה', () => {
    expect(DEFAULT_GAME_SETTINGS.voterCount).toBeGreaterThan(0);
    expect(DEFAULT_GAME_SETTINGS.speedFactor).toBeGreaterThan(0);
    expect(DEFAULT_GAME_SETTINGS.speedFactor).toBeLessThanOrEqual(1);
    expect(DEFAULT_GAME_SETTINGS.correctBias).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_GAME_SETTINGS.correctBias).toBeLessThanOrEqual(1);
    expect(DEFAULT_GAME_SETTINGS.intervalMs).toBeGreaterThanOrEqual(50);
    expect(typeof DEFAULT_GAME_SETTINGS.crowdEnabled).toBe('boolean');
    expect(DEFAULT_GAME_SETTINGS.hostVoterId).toBe('');
  });
});
