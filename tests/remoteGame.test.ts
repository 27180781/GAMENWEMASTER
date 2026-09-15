/**
 * הורדה ישירה לפי קוד (electron/remoteGame.cjs): הרשימה מהשרת, הקבצים
 * מהאחסון במקביל, המשך אחרי ניתוק, ואריזה לחבילה שהספרייה מכירה. הרשת
 * מדומה: `downloadFile` כותב את מה ש"ירד" לדיסק בדיוק כמו המוריד האמיתי.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
type FileResult = { ok: true; bytes: number } | { ok: false; error: string; retryable: boolean; status?: number };
type DownloadFile = (url: string, dest: string, opts: { onProgress: (p: { received: number; total: number }) => void }) => Promise<FileResult>;
type Progress = { phase: string; received?: number; total?: number; files?: number; filesDone?: number };
const remote = require('../electron/remoteGame.cjs') as {
  downloadGameDirect: (
    code: string,
    deps: { userData: string; fetchManifest: (code: string) => Promise<unknown>; downloadFile: DownloadFile; onProgress?: (p: Progress) => void; concurrency?: number },
  ) => Promise<{ ok: boolean; bytes?: number; files?: number; skipped?: string[]; error?: string; resumable?: boolean }>;
  planMedia: (files: unknown[]) => { url: string; localPath: string }[];
  safeLocalPath: (p: unknown) => string | null;
  downloadDir: (userData: string, code: string) => string;
};
const lib = require('../electron/gameLibrary.cjs') as {
  libraryZipPath: (userData: string, code: string) => string;
  libraryList: (userData: string) => { code: string; name: string }[];
  libraryDelete: (userData: string, code: string) => boolean;
};

const GAME = { name: 'חידון', questions: [] };
const MEDIA = [
  { url: 'https://cdn.example/a.mp4', localPath: 'Assets/a.mp4' },
  { url: 'https://cdn.example/b.jpg', localPath: 'Assets/b.jpg' },
  { url: 'https://cdn.example/c.mp3', localPath: 'Assets/c.mp3' },
];
const CONTENT: Record<string, Buffer> = {
  'https://cdn.example/a.mp4': Buffer.alloc(50_000, 1),
  'https://cdn.example/b.jpg': Buffer.alloc(20_000, 2),
  'https://cdn.example/c.mp3': Buffer.alloc(30_000, 3),
};

/** מוריד מדומה: מצליח וכותב את התוכן ליעד (כמו המוריד האמיתי אחרי rename). */
const okDownloader = (): DownloadFile =>
  vi.fn(async (url: string, dest: string, { onProgress }: { onProgress: (p: { received: number; total: number }) => void }): Promise<FileResult> => {
    const body = CONTENT[url];
    if (body === undefined) return { ok: false, error: 'קוד לא נמצא', retryable: false, status: 404 };
    mkdirSync(dirname(dest), { recursive: true });
    onProgress({ received: Math.floor(body.length / 2), total: body.length });
    writeFileSync(dest, body);
    return { ok: true, bytes: body.length };
  });

describe('downloadGameDirect', () => {
  let userData: string;
  afterEach(() => rmSync(userData, { recursive: true, force: true }));

  it('★ הורדה מלאה: data.json + המדיה + manifest.json בחבילה שהספרייה מכירה, ותיקיית ההורדה נמחקת', async () => {
    userData = mkdtempSync(join(tmpdir(), 'remote-'));
    const downloadFile = okDownloader();
    const progress: Progress[] = [];
    const res = await remote.downloadGameDirect('123456', {
      userData,
      fetchManifest: async () => ({ gameJson: GAME, mediaFiles: MEDIA }),
      downloadFile,
      onProgress: (p) => progress.push(p),
      concurrency: 2,
    });
    expect(res.ok).toBe(true);
    expect(res.files).toBe(3);
    expect(downloadFile).toHaveBeenCalledTimes(3);
    const zipPath = lib.libraryZipPath(userData, '123456');
    const zip = await JSZip.loadAsync(readFileSync(zipPath), { checkCRC32: true });
    expect(Object.keys(zip.files).sort()).toEqual(['Assets/a.mp4', 'Assets/b.jpg', 'Assets/c.mp3', 'data.json', 'manifest.json']);
    expect(JSON.parse(await zip.file('data.json')!.async('string'))).toEqual(GAME);
    expect((await zip.file('Assets/a.mp4')!.async('nodebuffer')).equals(CONTENT['https://cdn.example/a.mp4']!)).toBe(true);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.totalFiles).toBe(3);
    expect(manifest.totalSize).toBe(100_000);
    expect(lib.libraryList(userData).map((g) => [g.code, g.name])).toEqual([['123456', 'חידון']]);
    expect(existsSync(remote.downloadDir(userData, '123456'))).toBe(false);
    expect(progress[0]!.phase).toBe('connect');
    expect(progress.some((p) => p.phase === 'download' && p.files === 3)).toBe(true);
    expect(progress.at(-1)!.phase).toBe('pack');
  });

  it('★ המשך: קובץ שכבר ירד לא יורד שוב, קובץ שנקטע (part) ממשיך, וכתובת שהשתנתה מורידה מחדש', async () => {
    userData = mkdtempSync(join(tmpdir(), 'remote-'));
    const dir = remote.downloadDir(userData, '123456');
    mkdirSync(join(dir, 'Assets'), { recursive: true });
    // a — הושלם בניסיון הקודם; b — נקטע באמצע; c — כתובתו השתנתה מאז
    writeFileSync(join(dir, 'Assets/a.mp4'), CONTENT['https://cdn.example/a.mp4']!);
    writeFileSync(join(dir, 'Assets/b.jpg.part'), Buffer.alloc(5_000, 2));
    writeFileSync(join(dir, 'Assets/c.mp3'), Buffer.alloc(30_000, 9));
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({ code: '123456', files: [...MEDIA.slice(0, 2), { url: 'https://cdn.example/OLD-c.mp3', localPath: 'Assets/c.mp3' }] }),
    );
    const seenPartSizes: Record<string, number> = {};
    const downloadFile: DownloadFile = vi.fn(async (url, dest, opts): Promise<FileResult> => {
      seenPartSizes[url] = existsSync(`${dest}.part`) ? statSync(`${dest}.part`).size : -1;
      return okDownloader()(url, dest, opts);
    });
    const res = await remote.downloadGameDirect('123456', {
      userData,
      fetchManifest: async () => ({ gameJson: GAME, mediaFiles: MEDIA }),
      downloadFile,
    });
    expect(res.ok).toBe(true);
    expect(downloadFile).toHaveBeenCalledTimes(2); // b ו-c בלבד
    expect(seenPartSizes['https://cdn.example/b.jpg']).toBe(5_000); // החלק חיכה למוריד — הוא זה שממשיך אותו
    expect(seenPartSizes['https://cdn.example/c.mp3']).toBe(-1); // הישן נמחק לפני ההורדה
    const zip = await JSZip.loadAsync(readFileSync(lib.libraryZipPath(userData, '123456')), { checkCRC32: true });
    expect((await zip.file('Assets/c.mp3')!.async('nodebuffer')).equals(CONTENT['https://cdn.example/c.mp3']!)).toBe(true);
  });

  it('★ ניתוק אחרי כל הניסיונות: כישלון עם resumable, ומה שירד נשאר לניסיון הבא', async () => {
    userData = mkdtempSync(join(tmpdir(), 'remote-'));
    let calls = 0;
    const downloadFile: DownloadFile = vi.fn(async (url, dest, opts): Promise<FileResult> => {
      if (url.endsWith('b.jpg')) {
        calls += 1;
        return { ok: false, error: 'החיבור נכשל', retryable: true };
      }
      return okDownloader()(url, dest, opts);
    });
    const res = await remote.downloadGameDirect('123456', {
      userData,
      fetchManifest: async () => ({ gameJson: GAME, mediaFiles: MEDIA }),
      downloadFile,
      concurrency: 1,
    });
    expect(res.ok).toBe(false);
    expect(res.resumable).toBe(true);
    expect(res.error).toContain('הקלידו את הקוד שוב');
    expect(calls).toBe(3); // FILE_ATTEMPTS
    const dir = remote.downloadDir(userData, '123456');
    expect(existsSync(join(dir, 'Assets/a.mp4'))).toBe(true); // ירד לפני הכישלון — נשמר
    expect(existsSync(join(dir, 'data.json'))).toBe(true);
    expect(existsSync(lib.libraryZipPath(userData, '123456'))).toBe(false);
    expect(lib.libraryList(userData)).toEqual([]);
  });

  it('קובץ שאינו קיים עוד (404) מדולג ונרשם כחסר, והמשחק עדיין נארז', async () => {
    userData = mkdtempSync(join(tmpdir(), 'remote-'));
    const res = await remote.downloadGameDirect('123456', {
      userData,
      fetchManifest: async () => ({
        gameJson: GAME,
        mediaFiles: [...MEDIA, { url: 'https://cdn.example/gone.png', localPath: 'Assets/gone.png' }],
      }),
      downloadFile: okDownloader(),
    });
    expect(res.ok).toBe(true);
    expect(res.skipped).toEqual(['Assets/gone.png']);
    const zip = await JSZip.loadAsync(readFileSync(lib.libraryZipPath(userData, '123456')));
    expect(zip.file('Assets/gone.png')).toBeNull();
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.failed).toEqual([{ path: 'Assets/gone.png', error: 'not available' }]);
  });

  it('קוד לא תקין נדחה בלי לפנות לשרת', async () => {
    userData = mkdtempSync(join(tmpdir(), 'remote-'));
    const fetchManifest = vi.fn();
    const res = await remote.downloadGameDirect('../x', { userData, fetchManifest, downloadFile: okDownloader() });
    expect(res.ok).toBe(false);
    expect(fetchManifest).not.toHaveBeenCalled();
  });

  it('מחיקה מהספרייה מנקה גם הורדה חלקית', async () => {
    userData = mkdtempSync(join(tmpdir(), 'remote-'));
    const dir = remote.downloadDir(userData, '123456');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'data.json'), '{}');
    expect(lib.libraryDelete(userData, '123456')).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });
});

describe('planMedia / safeLocalPath', () => {
  it('רק http(s), נתיבים יחסיים בטוחים, בלי כפילויות בנתיב', () => {
    expect(
      remote.planMedia([
        { url: 'https://cdn/a.mp4', localPath: 'Assets/a.mp4' },
        { url: 'https://cdn/a2.mp4', localPath: 'Assets/a.mp4' }, // כפול — הראשון מנצח
        { url: 'file:///etc/passwd', localPath: 'Assets/x' },
        { url: 'https://cdn/evil', localPath: '../evil' },
        { url: 'https://cdn/abs', localPath: '/abs' },
        { url: 'https://cdn/win', localPath: 'Assets\\sub\\w.png' },
      ]),
    ).toEqual([
      { url: 'https://cdn/a.mp4', localPath: 'Assets/a.mp4' },
      { url: 'https://cdn/win', localPath: 'Assets/sub/w.png' },
    ]);
    expect(remote.safeLocalPath('C:/x')).toBeNull();
    expect(remote.safeLocalPath('a/./b')).toBeNull();
    expect(remote.safeLocalPath('')).toBeNull();
  });
});
