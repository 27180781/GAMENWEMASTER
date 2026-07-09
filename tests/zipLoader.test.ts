import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { isRelativeAsset, loadGameFromZip } from '../src/app/zipLoader.ts';
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

  it('נכס חסר ב-ZIP — הנתיב היחסי נשאר, בלי לקרוס', async () => {
    const slim = rawGame([rawSlide({ id: 1, type: 'trivia', answers: fourAnswers(2), scoreForQue: 3 })]);
    (slim.setting as { logo: { src: string } }).logo = { src: 'Assets/missing.png' };
    const zip = new JSZip();
    zip.file('data.json', JSON.stringify(slim));
    const { game } = await loadGameFromZip(await zip.generateAsync({ type: 'uint8array' }));
    expect(game.setting.logo.src).toBe('Assets/missing.png');
  });
});
