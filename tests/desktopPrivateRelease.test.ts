/**
 * קריאת המהדורה כשהריפו פרטי (openSource ב-tools/fetch-desktop-assets.mjs).
 *
 * בריפו פרטי הכתובת הציבורית של המהדורה עונה 404, ושרת האתר — בבניית התמונה
 * וברענון שבמכולה — קורא את הקבצים דרך ה-API של GitHub עם GITHUB_RELEASES_TOKEN.
 * ה-API מפנה כל קובץ לכתובת חתומה באחסון של GitHub, ולשם המפתח לא אמור לעבור:
 * הוא היה יוצא מ-GitHub, והאחסון דוחה בקשה שנושאת הרשאה שנייה. ה-fetch המדומה
 * כאן מתנהג כך, כולל הדחייה, ובודק שכל בקשה הגיעה עם הכותרות הנכונות.
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error — כלי בנייה ב-JS, בלי הצהרות טיפוסים
import { fetchDesktopAssets, openSource, SOURCE } from '../tools/fetch-desktop-assets.mjs';

const TOKEN = 'github_pat_TEST_ONLY';
const API = 'https://api.github.com/repos/27180781/GAMENWEMASTER';
const LISTING = `${API}/releases/tags/desktop-latest`;
const STORAGE = 'https://release-assets.githubusercontent.com/github-production-release-asset';

type Call = { url: string; headers: Record<string, string>; redirect: string | undefined };

/**
 * GitHub כפי שהוא נראה עם מפתח: רשימת הקבצים של המהדורה, כל קובץ לפי המזהה
 * שלו (302 לאחסון), והאחסון עצמו. `generation` הוא הדור הנוכחי של קובצי
 * המהדורה, ונקרא בכל בקשה: כש-build-desktop מחליף קבצים הדור עולה, ומזהה
 * מדור קודם עונה 404, בדיוק כמו קובץ שהוחלף.
 */
function fakeGitHub(files: Record<string, Buffer | string>, opts: { generation?: () => number; listingStatus?: number } = {}) {
  const generation = opts.generation ?? (() => 1);
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: string, init: RequestInit = {}) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    calls.push({ url: input, headers, redirect: init.redirect });
    if (input === LISTING) {
      if (headers.authorization !== `Bearer ${TOKEN}`) return new Response('', { status: 404 });
      if (opts.listingStatus !== undefined) return new Response('', { status: opts.listingStatus });
      expect(headers.accept).toBe('application/vnd.github+json');
      const gen = generation();
      return Response.json({
        assets: Object.keys(files).map((name, i) => ({ name, url: `${API}/releases/assets/${gen}0${i}`, size: 1 })),
      });
    }
    const asset = /\/releases\/assets\/(\d+)0(\d+)$/.exec(input);
    if (asset) {
      expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(headers.accept).toBe('application/octet-stream');
      expect(init.redirect).toBe('manual');
      if (Number(asset[1]) !== generation()) return new Response('', { status: 404 }); // הוחלף מאז הרשימה
      return new Response(null, { status: 302, headers: { location: `${STORAGE}/${asset[1]}0${asset[2]}?sig=x` } });
    }
    if (input.startsWith(STORAGE)) {
      // האחסון של GitHub דוחה בקשה שנושאת גם Authorization וגם חתימה בכתובת
      if (headers.authorization !== undefined) return new Response('two auth mechanisms', { status: 400 });
      const id = /\/(\d+)0(\d+)\?/.exec(input)!;
      const name = Object.keys(files)[Number(id[2])]!;
      return new Response(files[name], { status: 200 });
    }
    return new Response('', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, listings: () => calls.filter((c) => c.url === LISTING).length };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('openSource — מאיפה נקראים קובצי המהדורה', () => {
  it('★ עם מפתח: הרשימה נקראת פעם אחת, כל קובץ יורד לפי המזהה שלו, והמפתח לא עובר לאחסון', async () => {
    const gh = fakeGitHub({ 'latest.yml': 'version: 0.1.204\n', 'changelog.json': '{"versions":[]}' });
    const source = openSource({ GITHUB_RELEASES_TOKEN: TOKEN });

    const feed = await source.request('latest.yml');
    expect(feed.status).toBe(200);
    expect(await feed.text()).toBe('version: 0.1.204\n');
    expect(await (await source.request('changelog.json')).text()).toBe('{"versions":[]}');

    expect(gh.listings()).toBe(1);
    const storage = gh.calls.filter((c) => c.url.startsWith(STORAGE));
    expect(storage).toHaveLength(2);
    for (const c of storage) expect(c.headers.authorization).toBeUndefined();
    expect(source.label).toBe(LISTING);
    expect(source.label).not.toContain(TOKEN);
  });

  it('קובץ שאינו במהדורה = 404, כמו בכתובת הציבורית (כך מפה ישנה שחסרה פשוט מדולגת)', async () => {
    fakeGitHub({ 'latest.yml': 'x' });
    const source = openSource({ GITHUB_RELEASES_TOKEN: TOKEN });
    expect((await source.request('HavayaBeClick-Setup-0.1.150.exe.blockmap')).status).toBe(404);
  });

  it('רשימה שנדחתה (מפתח שגוי או בלי גישה) מוחזרת כמו שהיא, ונקראת שוב בבקשה הבאה', async () => {
    const gh = fakeGitHub({ 'latest.yml': 'x' }, { listingStatus: 401 });
    const source = openSource({ GITHUB_RELEASES_TOKEN: TOKEN });
    expect((await source.request('latest.yml')).status).toBe(401);
    expect((await source.request('latest.yml')).status).toBe(401);
    expect(gh.listings()).toBe(2);
  });

  it('★ בלי מפתח: הכתובת הציבורית, בלי שום כותרת — מה שהיה עד היום', async () => {
    const gh = fakeGitHub({});
    const source = openSource({});
    await source.request('latest.yml');
    expect(gh.calls).toEqual([{ url: `${SOURCE}/latest.yml`, headers: {}, redirect: 'follow' }]);
    expect(source.label).toBe(SOURCE);
  });

  it('מפתח ריק או רווחים = אין מפתח', async () => {
    const gh = fakeGitHub({});
    await openSource({ GITHUB_RELEASES_TOKEN: '  ' }).request('latest.yml');
    expect(gh.calls[0]!.url).toBe(`${SOURCE}/latest.yml`);
  });

  it('DESKTOP_SOURCE_URL גובר על המפתח, והמפתח לא נשלח לשם', async () => {
    const gh = fakeGitHub({});
    const source = openSource({ GITHUB_RELEASES_TOKEN: TOKEN, DESKTOP_SOURCE_URL: 'https://mirror.example/desktop' });
    await source.request('latest.yml');
    expect(gh.calls).toEqual([{ url: 'https://mirror.example/desktop/latest.yml', headers: {}, redirect: 'follow' }]);
  });
});

const b64sha = (buf: Buffer) => createHash('sha512').update(buf).digest('base64');
const BLOCKMAP = gzipSync(
  JSON.stringify({ version: '2', files: [{ name: 'file', offset: 0, checksums: ['abc'], sizes: [3] }] }),
);
const QUICK = { waitMs: 5, retryBaseMs: 1, minExeBytes: 4, previousBlockmaps: 0 };

function release(version: string) {
  const installer = Buffer.from(`INSTALLER-${version}`);
  return {
    'latest.yml': `version: ${version}\npath: HavayaBeClick-Setup-${version}.exe\nsha512: ${b64sha(installer)}\n`,
    [`HavayaBeClick-Setup-${version}.exe`]: installer,
    [`HavayaBeClick-Setup-${version}.exe.blockmap`]: BLOCKMAP,
    [`HavayaBeClick-${version}.exe`]: Buffer.from(`PORTABLE-${version}`),
  };
}

describe('משיכה מלאה מריפו פרטי (fetchDesktopAssets)', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('★ כל הקבצים יורדים דרך ה-API, ו-index.json רושם את המקור בלי המפתח', async () => {
    dir = mkdtempSync(join(tmpdir(), 'desktop-private-'));
    vi.stubEnv('GITHUB_RELEASES_TOKEN', TOKEN);
    fakeGitHub(release('0.1.204'));

    expect(await fetchDesktopAssets(dir, { ...QUICK, attempts: 1 })).toBe('0.1.204');
    expect(readFileSync(join(dir, 'HavayaBeClick-Setup-0.1.204.exe'), 'utf8')).toBe('INSTALLER-0.1.204');
    expect(readFileSync(join(dir, 'TriviaEngine-Portable.exe'), 'utf8')).toBe('PORTABLE-0.1.204');
    const index = readFileSync(join(dir, 'index.json'), 'utf8');
    expect(JSON.parse(index).source).toBe(LISTING);
    expect(index).not.toContain(TOKEN);
  });

  it('★ קובץ שהוחלף אחרי קריאת הרשימה (מזהה ישן עונה 404) — הסבב הבא קורא את הרשימה מחדש ומצליח', async () => {
    dir = mkdtempSync(join(tmpdir(), 'desktop-private-'));
    vi.stubEnv('GITHUB_RELEASES_TOKEN', TOKEN);
    // הרשימה הראשונה נקראת בדור 1, ומיד אחריה build-desktop מחליף את הקבצים
    // (דור 2): כל ההורדות של הסבב הראשון עונות 404.
    let requests = 0;
    const gh = fakeGitHub(release('0.1.205'), { generation: () => (requests++ === 0 ? 1 : 2) });

    expect(await fetchDesktopAssets(dir, { ...QUICK, attempts: 2 })).toBe('0.1.205');
    expect(readFileSync(join(dir, 'HavayaBeClick-Setup-0.1.205.exe'), 'utf8')).toBe('INSTALLER-0.1.205');
    expect(gh.listings()).toBe(2);
  });

  it('מפתח בלי גישה — הבנייה נופלת עם שם הקובץ והמקור, בלי המפתח עצמו', async () => {
    dir = join(mkdtempSync(join(tmpdir(), 'desktop-private-')), 'out');
    vi.stubEnv('GITHUB_RELEASES_TOKEN', TOKEN);
    fakeGitHub(release('0.1.204'), { listingStatus: 404 });

    const err = await fetchDesktopAssets(dir, { ...QUICK, attempts: 1 }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('latest.yml');
    expect(err.message).toContain(LISTING);
    expect(err.message).not.toContain(TOKEN);
  });
});
