/**
 * רענון קובצי ההתקנה בזמן ריצה (tools/refresh-desktop-assets.mjs).
 *
 * זה המנגנון שמנתק את האתר מתזמון הבנייה: התמונה נבנית לפני שה-EXE של אותו
 * קומיט פורסם, ולכן בלי הרענון השרת מגיש לצמיתות גרסה אחת אחורה. הבדיקות כאן
 * נועלות את ההחלטה *מתי* מרעננים — כולל המקרה שהוליד את התקלה.
 */

import { describe, expect, it } from 'vitest';
// @ts-expect-error — כלי בנייה ב-JS, בלי הצהרות טיפוסים
import { needsRefresh, servedVersion } from '../tools/refresh-desktop-assets.mjs';
// @ts-expect-error — כלי בנייה ב-JS, בלי הצהרות טיפוסים
import { parseFeed } from '../tools/fetch-desktop-assets.mjs';

const FEED = `version: 0.1.164
files:
  - url: HavayaBeClick-Setup-0.1.164.exe
    sha512: AAAA==
    size: 107512860
path: HavayaBeClick-Setup-0.1.164.exe
sha512: AAAA==
releaseDate: '2026-09-03T03:24:00.000Z'
`;

describe('קריאת latest.yml', () => {
  it('★ שלושת השדות ש-electron-updater צריך', () => {
    expect(parseFeed(FEED)).toEqual({
      version: '0.1.164',
      installer: 'HavayaBeClick-Setup-0.1.164.exe',
      sha512: 'AAAA==',
    });
  });

  it('פיד פגום נדחה ברעש, ולא מחזיר ערכים חלקיים', () => {
    expect(() => parseFeed('version: 0.1.164\n')).toThrow(/latest\.yml/);
  });
});

describe('הגרסה שהשרת מגיש', () => {
  it('נקראת מ-index.json', () => {
    expect(servedVersion('{"version":"0.1.162"}')).toBe('0.1.162');
  });

  it('★ קובץ פגום/ריק מחזיר null — ולא מתפרש כגרסה כלשהי', () => {
    for (const bad of ['', 'not json', '{}', '{"version":""}', '{"version":7}']) {
      expect(servedVersion(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('מתי מרעננים', () => {
  it('★ המקרה שהוליד את התקלה: מוגש 0.1.162, פורסם 0.1.163 → מרעננים', () => {
    expect(needsRefresh('0.1.162', '0.1.163')).toBe(true);
  });

  it('★ אותה גרסה → לא מורידים 215MB לחינם', () => {
    expect(needsRefresh('0.1.164', '0.1.164')).toBe(false);
  });

  it('★ אין index.json תקין → מרעננים, כי לא ידוע מה יש בתיקייה', () => {
    expect(needsRefresh(null, '0.1.164')).toBe(true);
  });

  it('לא הצלחנו לקרוא את המהדורה → לא נוגעים במה שקיים', () => {
    expect(needsRefresh('0.1.164', null)).toBe(false);
    expect(needsRefresh(null, null)).toBe(false);
  });
});

/**
 * המשיכה בסבבים (fetchDesktopAssets): הפריסה ב-CapRover נכשלה כשהבנייה תפסה
 * את חלון ההחלפה של המהדורה — 504 מ-GitHub, ואחר כך פיד חדש עם מתקין ישן.
 * הבדיקות מדמות fetch: סבב ראשון בתוך החלון, סבב שני אחרי שהמהדורה יציבה.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, vi } from 'vitest';
// @ts-expect-error — כלי בנייה ב-JS, בלי הצהרות טיפוסים
import { fetchDesktopAssets, SOURCE } from '../tools/fetch-desktop-assets.mjs';

const b64sha = (buf: Buffer) => createHash('sha512').update(buf).digest('base64');
const feedFor = (version: string, installer: Buffer) =>
  `version: ${version}\npath: HavayaBeClick-Setup-${version}.exe\nsha512: ${b64sha(installer)}\n`;
const ok = (body: Buffer | string) =>
  new Response(body, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
const fail = (status: number) => new Response('', { status });

const QUICK = { waitMs: 5, retryBaseMs: 1, minExeBytes: 4 };

describe('משיכה בסבבים — חלון ההחלפה של המהדורה', () => {
  let dir: string;
  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it('★ 504 ואז פיד חדש עם מתקין ישן — הסבב הבא מצליח, והיעד נקי ביניהם', async () => {
    dir = mkdtempSync(join(tmpdir(), 'desktop-'));
    const oldExe = Buffer.from('OLD-INSTALLER');
    const newExe = Buffer.from('NEW-INSTALLER');
    const portable = Buffer.from('PORTABLE-EXE');
    let calls = 0;
    const responder = (url: string): Response => {
      calls += 1;
      // סבב 1: ארבעת הניסיונות הפנימיים על latest.yml נופלים ב-504 (קריאות 1–4).
      // סבב 2: הפיד כבר חדש אבל המתקין עדיין ישן — sha512 לא תואם (קריאות 5–6).
      // סבב 3: המהדורה יציבה (קריאה 7 ואילך).
      const phase = calls <= 4 ? 'outage' : calls <= 6 ? 'mid-update' : 'stable';
      if (phase === 'outage') return fail(504); // ארבעת הניסיונות הפנימיים על latest.yml
      if (url.endsWith('/latest.yml')) return ok(feedFor('0.1.173', newExe));
      if (url.endsWith('/HavayaBeClick-Setup-0.1.173.exe')) {
        return ok(phase === 'mid-update' ? oldExe : newExe); // sha512 לא תואם באמצע העדכון
      }
      if (url.endsWith('/HavayaBeClick-0.1.173.exe')) return ok(portable);
      return fail(404);
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => responder(url)));

    const version = await fetchDesktopAssets(dir, { ...QUICK, attempts: 4 });
    expect(version).toBe('0.1.173');
    expect(readFileSync(join(dir, 'HavayaBeClick-Setup-0.1.173.exe'))).toEqual(newExe);
    expect(readFileSync(join(dir, 'TriviaEngine-Portable.exe'))).toEqual(portable);
    expect(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).version).toBe('0.1.173');
    expect(calls).toBeGreaterThanOrEqual(9); // באמת עברנו דרך שני הסבבים הכושלים
  });

  it('★ מהדורה שנשארת פגומה — נופלים אחרי כל הסבבים, בלי תיקייה חלקית', async () => {
    dir = join(mkdtempSync(join(tmpdir(), 'desktop-')), 'out');
    const exe = Buffer.from('INSTALLER');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/latest.yml')
          ? ok(`version: 0.1.170\npath: HavayaBeClick-Setup-0.1.170.exe\nsha512: WRONG==\n`)
          : ok(exe),
      ),
    );
    await expect(fetchDesktopAssets(dir, { ...QUICK, attempts: 3 })).rejects.toThrow(/sha512.*3 סבבים/);
    expect(existsSync(dir)).toBe(false);
  });

  it('DESKTOP_ASSETS=0 מדלג בלי לגעת ברשת', async () => {
    dir = mkdtempSync(join(tmpdir(), 'desktop-'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('DESKTOP_ASSETS', '0');
    expect(await fetchDesktopAssets(dir, QUICK)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('מקור ברירת המחדל הוא המהדורה היציבה ב-GitHub', () => {
    expect(SOURCE).toMatch(/releases\/download\/desktop-latest$/);
  });
});
