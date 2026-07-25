import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { isRelativeAsset, loadGameFromExtracted, loadGameFromZip } from '../src/app/zipLoader.ts';
import { classifyMediaUrl, clearMediaKindRegistry } from '../src/engine/index.ts';
import { fourAnswers, rawGame, rawSlide } from './helpers.ts';

// סביבת node ללא URL.createObjectURL — stub שמחזיר כתובת blob דמה ייחודית
let blobCounter = 0;
beforeEach(() => {
  blobCounter = 0;
  clearMediaKindRegistry();
  globalThis.URL.createObjectURL = vi.fn(() => `blob:mock-${++blobCounter}`);
  globalThis.URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

/** בונה ZIP אופליין: data.json + תיקיית Assets עם קבצים מזויפים. */
async function buildZip(dataDir = ''): Promise<Uint8Array> {
  const slim = rawGame([
    rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(2), scoreForQue: 3 }),
  ]);
  // מוחקים שדות עליונים (פורמט אופליין דק) ומגדירים נתיבי מדיה יחסיים
  for (const k of ['id', 'assets', 'createdAt', 'baseUrl']) delete slim[k];
  (slim.setting as { logo: { src: string } }).logo = { src: 'Assets/logo.png' };
  (slim.setting as { gameMedia: { src: string } }).gameMedia = { src: 'Assets/intro.mp4' };
  (slim.setting as { triviaMedia: { src: string } }).triviaMedia = { src: 'https://cdn/keep.mp4' };

  const zip = new JSZip();
  const dir = dataDir === '' ? '' : `${dataDir}/`;
  zip.file(`${dir}data.json`, JSON.stringify(slim));
  zip.file(`${dir}Assets/logo.png`, new Uint8Array([1, 2, 3]));
  zip.file(`${dir}Assets/intro.mp4`, new Uint8Array([4, 5, 6, 7]));
  return zip.generateAsync({ type: 'uint8array' });
}

describe('isRelativeAsset', () => {
  it('מזהה נתיבים יחסיים בלבד', () => {
    expect(isRelativeAsset('Assets/logo.png')).toBe(true);
    expect(isRelativeAsset('media/x.mp4')).toBe(true);
    expect(isRelativeAsset('https://cdn/x.mp4')).toBe(false);
    expect(isRelativeAsset('blob:abc')).toBe(false);
    expect(isRelativeAsset('https://youtube.com/embed/x')).toBe(false);
    expect(isRelativeAsset('')).toBe(false);
  });
});

describe('loadGameFromZip', () => {
  it('ממפה נתיבים יחסיים ל-Blob URLs ורושם את סוג המדיה', async () => {
    const { game, revoke } = await loadGameFromZip(await buildZip());

    expect(game.setting.logo.src).toMatch(/^blob:mock-/);
    expect(game.setting.gameMedia.src).toMatch(/^blob:mock-/);
    // סוג המדיה נרשם לפי הסיומת המקורית
    expect(classifyMediaUrl(game.setting.logo.src)).toBe('image');
    expect(classifyMediaUrl(game.setting.gameMedia.src)).toBe('video');
    // URL מוחלט לא נוגעים בו
    expect(game.setting.triviaMedia.src).toBe('https://cdn/keep.mp4');

    revoke();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('עובד גם כשה-data.json בתוך תיקיית עטיפה', async () => {
    const { game } = await loadGameFromZip(await buildZip('game-folder'));
    expect(game.setting.logo.src).toMatch(/^blob:mock-/);
  });

  it('ZIP בלי data.json — שגיאה ברורה', async () => {
    const zip = new JSZip();
    zip.file('readme.txt', 'hi');
    await expect(loadGameFromZip(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(
      /data\.json/,
    );
  });

  it('נכס חסר ב-ZIP — הנתיב היחסי נשאר, בלי לקרוס, ומדווח כחסר', async () => {
    const slim = rawGame([rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(2), scoreForQue: 3 })]);
    (slim.setting as { logo: { src: string } }).logo = { src: 'Assets/missing.png' };
    const zip = new JSZip();
    zip.file('data.json', JSON.stringify(slim));
    const { game, missing } = await loadGameFromZip(await zip.generateAsync({ type: 'uint8array' }));
    expect(game.setting.logo.src).toBe('Assets/missing.png');
    expect(missing).toHaveLength(1);
    expect(missing[0]!.src).toBe('Assets/missing.png');
    expect(missing[0]!.reason).toBe('missing');
    expect(missing[0]!.context).toBe('לוגו');
  });

  it('כל הנכסים קיימים — אין דיווח על חסרים', async () => {
    const { missing } = await loadGameFromZip(await buildZip());
    expect(missing).toEqual([]);
  });
});

describe('loadGameFromZip — מצב זרימה מהדיסק (EXE)', () => {
  const realWindow = (globalThis as { window?: unknown }).window;
  afterEach(() => {
    (globalThis as { window?: unknown }).window = realWindow;
  });

  /** מזריק גשר EXE מדומה עם mediaExtract שמחזיר cacheKey (או null לכשל). */
  function stubDesktop(mediaExtract: unknown) {
    (globalThis as { window?: unknown }).window = {
      triviaDesktop: { isDesktop: true, mediaExtract },
    };
  }

  it('מחלץ פעם אחת ומחזיר כתובות trivia-media:// במקום Blob', async () => {
    const extract = vi.fn(async () => ({ cacheKey: 'abc123' }));
    stubDesktop(extract);
    const { game, missing, revoke } = await loadGameFromZip(await buildZip(), { stream: true });

    expect(extract).toHaveBeenCalledTimes(1);
    expect(game.setting.logo.src).toBe('trivia-media://abc123/Assets/logo.png');
    expect(game.setting.gameMedia.src).toBe('trivia-media://abc123/Assets/intro.mp4');
    // סוג המדיה נגזר מהסיומת שבכתובת
    expect(classifyMediaUrl(game.setting.logo.src)).toBe('image');
    expect(classifyMediaUrl(game.setting.gameMedia.src)).toBe('video');
    // URL מוחלט לא נוגעים בו
    expect(game.setting.triviaMedia.src).toBe('https://cdn/keep.mp4');
    expect(missing).toEqual([]);
    // אין Blob — revoke הוא no-op ולא נוצרו object URLs
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    revoke();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('כשל חילוץ (null) — נפילה חזרה ל-Blob', async () => {
    stubDesktop(vi.fn(async () => null));
    const { game } = await loadGameFromZip(await buildZip(), { stream: true });
    expect(game.setting.logo.src).toMatch(/^blob:mock-/);
  });

  it('בלי גשר (דפדפן) — stream:true נופל ל-Blob', async () => {
    const { game } = await loadGameFromZip(await buildZip(), { stream: true });
    expect(game.setting.logo.src).toMatch(/^blob:mock-/);
  });
});

describe('loadGameFromExtracted — טעינה ממטמון שחולץ ב-main (בלי בייטי ZIP)', () => {
  /** data.json דק כמו בפורמט האופליין, עם נתיבי מדיה יחסיים. */
  function slimData() {
    const slim = rawGame([
      rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(2), scoreForQue: 3 }),
    ]);
    for (const k of ['id', 'assets', 'createdAt', 'baseUrl']) delete slim[k];
    (slim.setting as { logo: { src: string } }).logo = { src: 'Assets/logo.png' };
    (slim.setting as { gameMedia: { src: string } }).gameMedia = { src: 'Assets/intro.mp4' };
    (slim.setting as { triviaMedia: { src: string } }).triviaMedia = { src: 'https://cdn/keep.mp4' };
    return JSON.stringify(slim);
  }

  it('ממפה נתיבים יחסיים ל-trivia-media:// ורושם סוג מדיה, בלי Blob', () => {
    const { game, revoke, missing } = loadGameFromExtracted({
      cacheKey: 'abc123',
      dataPath: 'data.json',
      dataJson: slimData(),
      names: ['data.json', 'Assets/logo.png', 'Assets/intro.mp4'],
    });

    expect(game.setting.logo.src).toBe('trivia-media://abc123/Assets/logo.png');
    expect(game.setting.gameMedia.src).toBe('trivia-media://abc123/Assets/intro.mp4');
    expect(classifyMediaUrl(game.setting.logo.src)).toBe('image');
    expect(classifyMediaUrl(game.setting.gameMedia.src)).toBe('video');
    expect(game.setting.triviaMedia.src).toBe('https://cdn/keep.mp4'); // URL מוחלט נשמר
    expect(missing).toEqual([]);
    // לא נוצרו Blob URLs, ו-revoke הוא no-op
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    revoke();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('עובד עם data.json בתוך תיקיית עטיפה (נתיבים יחסיים אליו)', () => {
    const { game } = loadGameFromExtracted({
      cacheKey: 'k1',
      dataPath: 'game-folder/data.json',
      dataJson: slimData(),
      names: ['game-folder/data.json', 'game-folder/Assets/logo.png', 'game-folder/Assets/intro.mp4'],
    });
    expect(game.setting.logo.src).toBe('trivia-media://k1/game-folder/Assets/logo.png');
  });

  it('נכס חסר — הנתיב נשאר ומדווח כחסר', () => {
    const { game, missing } = loadGameFromExtracted({
      cacheKey: 'k2',
      dataPath: 'data.json',
      dataJson: slimData(),
      names: ['data.json', 'Assets/intro.mp4'], // בלי הלוגו
    });
    expect(game.setting.logo.src).toBe('Assets/logo.png');
    expect(missing).toHaveLength(1);
    expect(missing[0]!.reason).toBe('missing');
    expect(missing[0]!.context).toBe('לוגו');
  });

  it('שמות עם תווים מיוחדים מקודדים בכתובת', () => {
    const slim = rawGame([rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(2), scoreForQue: 3 })]);
    (slim.setting as { logo: { src: string } }).logo = { src: 'נכסים/לוגו של המשחק.png' };
    const { game } = loadGameFromExtracted({
      cacheKey: 'k3',
      dataPath: 'data.json',
      dataJson: JSON.stringify(slim),
      names: ['data.json', 'נכסים/לוגו של המשחק.png'],
    });
    expect(game.setting.logo.src.startsWith('trivia-media://k3/')).toBe(true);
    expect(game.setting.logo.src).toContain('%20'); // רווחים מקודדים
    expect(decodeURIComponent(game.setting.logo.src)).toBe('trivia-media://k3/נכסים/לוגו של המשחק.png');
  });

  it('JSON פגום — שגיאה ברורה', () => {
    expect(() =>
      loadGameFromExtracted({ cacheKey: 'k4', dataPath: 'data.json', dataJson: '{oops', names: [] }),
    ).toThrow(/JSON/);
  });
});
