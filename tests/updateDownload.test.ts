/**
 * הורדת עדכון הפרשית וניתנת להמשך (electron/updateDownload.cjs).
 *
 * מפות הבלוקים כאן נבנות ביד — רק שוויון ה-checksum קובע מה מועתק מהמתקין
 * הקודם ומה יורד — והרשת מדומה: fetchRange מגיש טווחים מתוך "המתקין החדש"
 * ויכול להיקטע באמצע, כדי לוודא שההמשך באמת ממשיך ולא מתחיל מאפס.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
type RangeResult = { ok: true; bytes: number } | { ok: false; error: string; retryable: boolean; status?: number };
type FetchRange = (url: string, start: number, end: number, sink: (chunk: Buffer) => void) => Promise<RangeResult>;
type BlockMap = { version: string; files: { name: string; offset: number; checksums: string[]; sizes: number[] }[] };
type Progress = { transferred: number; total: number; percent: number; differential: boolean; reason: string | null };
const mod = require('../electron/updateDownload.cjs') as {
  downloadUpdate: (args: {
    pendingDir: string;
    fileName: string;
    sha512: string;
    size: number;
    newUrl: string;
    oldFile: string | null;
    oldBlockMap: BlockMap | null;
    newBlockMap: BlockMap | null;
    fetchRange: FetchRange;
    reason?: string | null;
    onProgress?: (p: Progress) => void;
    log?: (m: string) => void;
  }) => Promise<{ ok: boolean; file?: string; differential?: boolean; transferred?: number; error?: string; retryable?: boolean; reason?: string | null }>;
  buildPlan: (a: { oldBlockMap: BlockMap | null; newBlockMap: BlockMap | null; oldFile: string | null; size: number; log: (m: string) => void; reason?: string | null }) => {
    ops: { kind: number; start: number; end: number }[];
    differential: boolean;
    reason: string | null;
  };
  oldBlockMapUrl: (newUrl: string, newVersion: string, oldVersion: string) => string;
  parseBlockMap: (buf: Buffer | null) => BlockMap | null;
  blockMapSize: (map: BlockMap) => number;
  pickOldBlockMap: (candidates: (BlockMap | null)[], oldSize: number) => BlockMap | null;
  installerCandidates: (a: { cacheDir: string; pendingDir: string; installerName: string; targetName?: string; folders?: string[]; list?: (dir: string) => string[] }) => string[];
  pickOldInstaller: (a: { installers: string[]; maps: (BlockMap | null)[]; sizeOf: (file: string) => number }) => {
    oldFile: string | null;
    oldBlockMap: BlockMap | null;
    reason: string | null;
    sizes: { file: string; size: number }[];
  };
  FULL_REASON: Record<string, string>;
};

/**
 * כמו ב-Windows: ftruncate על ידית שנפתחה להוספה ('a') נכשל ב-EPERM. בלינוקס הוא
 * מצליח, ולכן קיצור דרך ידית כזאת עבר כאן ונפל רק בבניית ה-EXE (7.10.2026). קיצור
 * לפי נתיב (truncateSync, שפותח 'r+') מותר, כמו ב-Windows.
 */
const fsCjs = require('node:fs') as typeof import('node:fs');
const appendFds = new Set<number>();
beforeEach(() => {
  const { openSync, closeSync, ftruncateSync } = fsCjs;
  vi.spyOn(fsCjs, 'openSync').mockImplementation((file, flags, mode) => {
    const fd = openSync(file, flags, mode);
    if (flags === 'a') appendFds.add(fd);
    else appendFds.delete(fd);
    return fd;
  });
  vi.spyOn(fsCjs, 'closeSync').mockImplementation((fd) => {
    appendFds.delete(fd);
    closeSync(fd);
  });
  vi.spyOn(fsCjs, 'ftruncateSync').mockImplementation((fd, len) => {
    if (appendFds.has(fd)) throw Object.assign(new Error('EPERM: operation not permitted, ftruncate'), { code: 'EPERM', syscall: 'ftruncate' });
    ftruncateSync(fd, len);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  appendFds.clear();
});

const BLOCK = 64 * 1024;
const sha512 = (b: Buffer) => createHash('sha512').update(b).digest('base64');
const sum = (b: Buffer) => createHash('sha256').update(b).digest('base64');
/** מפה של קובץ יחיד ("file") מבלוקים בגודל קבוע — הפורמט של electron-builder. */
const mapOf = (blocks: Buffer[]): BlockMap => ({
  version: '2',
  files: [{ name: 'file', offset: 0, checksums: blocks.map(sum), sizes: blocks.map((b) => b.length) }],
});
/**
 * רשת מדומה: מגישה טווחים מהקובץ החדש; `cutAfter` בתים — ניתוק (פעם אחת).
 * `ignoreRange` — כמו אנטי-וירוס/פרוקסי שמתעלם מ-Range: טווח שאינו מבית 0 עונה 200
 * (downloadRange מחזיר אז status 200 בלי להוריד), ומבית 0 — הקובץ עד הגבול שביקשנו.
 */
function server(newFile: Buffer, opts: { cutAfter?: number; ignoreRange?: boolean } = {}) {
  let served = 0;
  let cut = opts.cutAfter;
  const calls: [number, number][] = [];
  const fetchRange: FetchRange = async (_url, start, end, sink) => {
    calls.push([start, end]);
    if (opts.ignoreRange && start > 0) return { ok: false, error: 'השרת אינו תומך בהורדת טווחים', retryable: false, status: 200 };
    let pos = start;
    while (pos < end) {
      const next = Math.min(end, pos + 16 * 1024);
      if (cut !== undefined && served + (next - pos) > cut) {
        const partial = cut - served;
        if (partial > 0) sink(newFile.subarray(pos, pos + partial));
        served += partial;
        cut = undefined;
        return { ok: false, error: 'החיבור נכשל', retryable: true };
      }
      sink(newFile.subarray(pos, next));
      served += next - pos;
      pos = next;
    }
    return { ok: true, bytes: end - start };
  };
  return { fetchRange, calls, served: () => served };
}

describe('downloadUpdate', () => {
  let dir = '';
  afterEach(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  const A = randomBytes(BLOCK);
  const B = randomBytes(BLOCK);
  const C = randomBytes(BLOCK);
  const X = randomBytes(BLOCK);
  const Y = randomBytes(BLOCK / 2);
  const oldBlocks = [A, B, C];
  const newBlocks = [A, X, C, Y];
  const oldFile = Buffer.concat(oldBlocks);
  const newFile = Buffer.concat(newBlocks);

  function setup() {
    dir = mkdtempSync(join(tmpdir(), 'update-'));
    const old = join(dir, 'installer.exe');
    writeFileSync(old, oldFile);
    return { pendingDir: join(dir, 'pending'), oldFile: old };
  }

  it('★ הפרשי: מוריד רק את הבלוקים שהשתנו, מעתיק את השאר, והתוצאה זהה בית-בבית ומאומתת', async () => {
    const { pendingDir, oldFile: old } = setup();
    const net = server(newFile);
    const progress: Progress[] = [];
    const res = await mod.downloadUpdate({
      pendingDir,
      fileName: 'Setup-2.exe',
      sha512: sha512(newFile),
      size: newFile.length,
      newUrl: 'https://host/desktop/Setup-2.exe',
      oldFile: old,
      oldBlockMap: mapOf(oldBlocks),
      newBlockMap: mapOf(newBlocks),
      fetchRange: net.fetchRange,
      onProgress: (p) => progress.push(p),
    });
    expect(res.ok).toBe(true);
    expect(res.differential).toBe(true);
    expect(res.transferred).toBe(X.length + Y.length);
    expect(net.served()).toBe(X.length + Y.length);
    expect(readFileSync(join(pendingDir, 'Setup-2.exe')).equals(newFile)).toBe(true);
    expect(JSON.parse(readFileSync(join(pendingDir, 'update-info.json'), 'utf8'))).toEqual({
      fileName: 'Setup-2.exe',
      sha512: sha512(newFile),
      isAdminRightsRequired: false,
    });
    // המפה החדשה נשמרת — היא ה"ישנה" של העדכון הבא
    expect(JSON.parse(gunzipSync(readFileSync(join(pendingDir, 'current.blockmap'))).toString())).toEqual(mapOf(newBlocks));
    expect(existsSync(join(pendingDir, 'Setup-2.exe.resume.json'))).toBe(false);
    expect(progress.at(-1)).toMatchObject({ transferred: X.length + Y.length, total: X.length + Y.length, percent: 100, differential: true });
  });

  it('★ ניתוק באמצע טווח: הניסיון הבא ממשיך מאותו בית, בלי להוריד שוב מה שכבר ירד', async () => {
    const { pendingDir, oldFile: old } = setup();
    const common = {
      pendingDir,
      fileName: 'Setup-2.exe',
      sha512: sha512(newFile),
      size: newFile.length,
      newUrl: 'https://host/desktop/Setup-2.exe',
      oldFile: old,
      oldBlockMap: mapOf(oldBlocks),
      newBlockMap: mapOf(newBlocks),
    };
    // הניתוק אחרי X ועוד רבע מ-Y (בבתים שהורדו)
    const cutAfter = X.length + Y.length / 4;
    const first = server(newFile, { cutAfter });
    const r1 = await mod.downloadUpdate({ ...common, fetchRange: first.fetchRange });
    expect(r1.ok).toBe(false);
    expect(r1.retryable).toBe(true);
    expect(existsSync(join(pendingDir, 'Setup-2.exe.part'))).toBe(true);
    const state = JSON.parse(readFileSync(join(pendingDir, 'Setup-2.exe.resume.json'), 'utf8'));
    expect(state.transferred).toBe(cutAfter);

    const second = server(newFile);
    const r2 = await mod.downloadUpdate({ ...common, fetchRange: second.fetchRange });
    expect(r2.ok).toBe(true);
    expect(second.served()).toBe(Y.length - Y.length / 4); // רק שארית Y
    expect(second.calls).toEqual([[newFile.length - Y.length + Y.length / 4, newFile.length]]);
    expect(r2.transferred).toBe(X.length + Y.length); // סך הכול, כולל מה שירד לפני הניתוק
    expect(readFileSync(join(pendingDir, 'Setup-2.exe')).equals(newFile)).toBe(true);
  });

  it('★ בלי מפות (או בלי מתקין קודם): הורדה מלאה — וגם היא ממשיכה אחרי ניתוק', async () => {
    const { pendingDir } = setup();
    const common = { pendingDir, fileName: 'Setup-2.exe', sha512: sha512(newFile), size: newFile.length, newUrl: 'https://host/x.exe', oldFile: null, oldBlockMap: null, newBlockMap: null };
    const first = server(newFile, { cutAfter: 100_000 });
    const r1 = await mod.downloadUpdate({ ...common, fetchRange: first.fetchRange });
    expect(r1.ok).toBe(false);
    const second = server(newFile);
    const r2 = await mod.downloadUpdate({ ...common, fetchRange: second.fetchRange });
    expect(r2.ok).toBe(true);
    expect(r2.differential).toBe(false);
    expect(second.calls).toEqual([[100_000, newFile.length]]);
    expect(readFileSync(join(pendingDir, 'Setup-2.exe')).equals(newFile)).toBe(true);
    expect(existsSync(join(pendingDir, 'current.blockmap'))).toBe(false);
  });

  it('★ מתקין קודם פגום: ההפרש נכשל באימות, והניסיון הבא מוריד את הכול ומצליח', async () => {
    const { pendingDir, oldFile: old } = setup();
    writeFileSync(old, Buffer.concat([A, randomBytes(BLOCK), C])); // B "התקלקל" — אבל המפה עדיין אומרת C תקין... נקלקל את C
    writeFileSync(old, Buffer.concat([A, B, randomBytes(BLOCK)]));
    const common = {
      pendingDir,
      fileName: 'Setup-2.exe',
      sha512: sha512(newFile),
      size: newFile.length,
      newUrl: 'https://host/desktop/Setup-2.exe',
      oldFile: old,
      oldBlockMap: mapOf(oldBlocks),
      newBlockMap: mapOf(newBlocks),
    };
    const r1 = await mod.downloadUpdate({ ...common, fetchRange: server(newFile).fetchRange });
    expect(r1.ok).toBe(false);
    expect(r1.retryable).toBe(true);
    expect(existsSync(join(pendingDir, 'Setup-2.exe.part'))).toBe(false);
    const second = server(newFile);
    const r2 = await mod.downloadUpdate({ ...common, fetchRange: second.fetchRange });
    expect(r2.ok).toBe(true);
    expect(r2.differential).toBe(false);
    expect(second.served()).toBe(newFile.length);
  });

  it('תוכנית שהשתנתה (גרסה חדשה יותר בפיד) — החלק הישן נזרק והמשך אינו מנסה להשתמש בו', async () => {
    const { pendingDir, oldFile: old } = setup();
    const r1 = await mod.downloadUpdate({
      pendingDir,
      fileName: 'Setup-2.exe',
      sha512: sha512(newFile),
      size: newFile.length,
      newUrl: 'https://host/desktop/Setup-2.exe',
      oldFile: old,
      oldBlockMap: mapOf(oldBlocks),
      newBlockMap: mapOf(newBlocks),
      fetchRange: server(newFile, { cutAfter: 10_000 }).fetchRange,
    });
    expect(r1.ok).toBe(false);
    const newer = Buffer.concat([A, X, C, randomBytes(BLOCK)]);
    const net = server(newer);
    const r2 = await mod.downloadUpdate({
      pendingDir,
      fileName: 'Setup-3.exe',
      sha512: sha512(newer),
      size: newer.length,
      newUrl: 'https://host/desktop/Setup-3.exe',
      oldFile: old,
      oldBlockMap: mapOf(oldBlocks),
      newBlockMap: mapOf([A, X, C, newer.subarray(3 * BLOCK)]),
      fetchRange: net.fetchRange,
    });
    expect(r2.ok).toBe(true);
    expect(readFileSync(join(pendingDir, 'Setup-3.exe')).equals(newer)).toBe(true);
  });

  it('buildPlan: מסתכם לגודל הקובץ, ומתקין קודם קצר מדי → מלא', () => {
    const { oldFile: old } = setup();
    const plan = mod.buildPlan({ oldBlockMap: mapOf(oldBlocks), newBlockMap: mapOf(newBlocks), oldFile: old, size: newFile.length, log: () => {} });
    expect(plan.differential).toBe(true);
    expect(plan.ops.reduce((s, o) => s + (o.end - o.start), 0)).toBe(newFile.length);
    writeFileSync(old, A); // קצר מהעתקה של C
    expect(mod.buildPlan({ oldBlockMap: mapOf(oldBlocks), newBlockMap: mapOf(newBlocks), oldFile: old, size: newFile.length, log: () => {} }).differential).toBe(false);
    expect(mod.buildPlan({ oldBlockMap: null, newBlockMap: mapOf(newBlocks), oldFile: old, size: 10, log: () => {} }).ops).toEqual([{ kind: 1, start: 0, end: 10 }]);
  });

  it('oldBlockMapUrl / parseBlockMap — כמו electron-updater', () => {
    expect(mod.oldBlockMapUrl('https://h/desktop/HavayaBeClick-Setup-0.1.183.exe', '0.1.183', '0.1.179')).toBe(
      'https://h/desktop/HavayaBeClick-Setup-0.1.179.exe.blockmap',
    );
    expect(mod.parseBlockMap(Buffer.from('<html>'))).toBeNull();
    expect(mod.parseBlockMap(null)).toBeNull();
  });

  it('★ מפה ישנה במטמון (הורדה שלא הותקנה / שארית מהתקנה קודמת): נבחרת המפה שתואמת למתקין, וההפרש מצליח', async () => {
    // המטמון מחזיק מפה של גרסה שהורדה ולא הותקנה — אותו גודל, תוכן אחר.
    const stale = mapOf([A, B, X]);
    const installed = mapOf(oldBlocks);

    // כך היה עד 5.10.2026: המפה מהמטמון קודמת — ההפרש נבנה מבלוקים לא נכונים ונפסל.
    const before = setup();
    const broken = await mod.downloadUpdate({
      pendingDir: before.pendingDir,
      fileName: 'Setup-2.exe',
      sha512: sha512(newFile),
      size: newFile.length,
      newUrl: 'https://host/desktop/Setup-2.exe',
      oldFile: before.oldFile,
      oldBlockMap: stale,
      newBlockMap: mapOf(newBlocks),
      fetchRange: server(newFile).fetchRange,
    });
    expect(broken.ok).toBe(false);
    rmSync(dir, { recursive: true, force: true });

    // עכשיו: המפה מהשרת לגרסה המותקנת קודמת, והמטמון רק כגיבוי.
    const { pendingDir, oldFile: old } = setup();
    const chosen = mod.pickOldBlockMap([installed, stale], oldFile.length);
    expect(chosen).toBe(installed);
    const net = server(newFile);
    const res = await mod.downloadUpdate({
      pendingDir,
      fileName: 'Setup-2.exe',
      sha512: sha512(newFile),
      size: newFile.length,
      newUrl: 'https://host/desktop/Setup-2.exe',
      oldFile: old,
      oldBlockMap: chosen,
      newBlockMap: mapOf(newBlocks),
      fetchRange: net.fetchRange,
    });
    expect(res.ok).toBe(true);
    expect(res.differential).toBe(true);
    expect(net.served()).toBe(X.length + Y.length);
  });

  it('pickOldBlockMap: רק מפה בגודל המתקין שבמטמון, לפי סדר העדיפות', () => {
    const installed = mapOf(oldBlocks);
    const other = mapOf(newBlocks); // גרסה אחרת, גודל אחר
    expect(mod.blockMapSize(installed)).toBe(oldFile.length);
    expect(mod.blockMapSize(other)).toBe(newFile.length);
    expect(
      mod.blockMapSize({ version: '2', files: [{ name: 'a', offset: 0, checksums: ['x'], sizes: [10] }, { name: 'b', offset: 10, checksums: ['y'], sizes: [5, 7] }] }),
    ).toBe(22);
    expect(mod.pickOldBlockMap([installed, other], oldFile.length)).toBe(installed);
    // אין מפה בשרת (גרסה ישנה מ-12 בניות) — המטמון, אם הוא תואם
    expect(mod.pickOldBlockMap([null, installed], oldFile.length)).toBe(installed);
    // המטמון מתאר קובץ אחר — הורדה מלאה מיד, בלי הפרש שייפסל
    expect(mod.pickOldBlockMap([null, other], oldFile.length)).toBeNull();
    expect(mod.pickOldBlockMap([installed], 0)).toBeNull();
    // מפה פגומה (תשובה זרה מהשרת) — נפסלת בלי לזרוק, והמטמון התקין עדיין נבחר
    const broken = { version: '2', files: [{ name: 'file', offset: 0, checksums: ['x'] }] } as unknown as BlockMap;
    expect(Number.isNaN(mod.blockMapSize(broken))).toBe(true);
    expect(mod.pickOldBlockMap([broken, installed], oldFile.length)).toBe(installed);
  });

  const common = (pendingDir: string, old: string | null) => ({
    pendingDir,
    fileName: 'Setup-2.exe',
    sha512: sha512(newFile),
    size: newFile.length,
    newUrl: 'https://host/desktop/Setup-2.exe',
    oldFile: old,
    oldBlockMap: mapOf(oldBlocks),
    newBlockMap: mapOf(newBlocks),
  });

  it('★ installer.exe חסר (העתקת NSIS לא קרתה), אבל המתקין נמצא בהורדות — ההפרש נבנה ממנו', async () => {
    const { pendingDir, oldFile: old } = setup();
    rmSync(old);
    const downloads = join(dir, 'Downloads');
    mkdirSync(downloads);
    writeFileSync(join(downloads, 'HavayaBeClick-Setup-0.1.196 (1).exe'), oldFile);
    writeFileSync(join(downloads, 'notes.txt'), 'x');
    const installers = mod.installerCandidates({ cacheDir: dir, pendingDir, installerName: 'HavayaBeClick-Setup-0.1.196.exe', folders: [downloads, join(dir, 'nope')] });
    const sizeOf = (f: string) => (existsSync(f) ? readFileSync(f).length : 0);
    const picked = mod.pickOldInstaller({ installers, maps: [mapOf(oldBlocks), null], sizeOf });
    expect(picked.oldFile).toBe(join(downloads, 'HavayaBeClick-Setup-0.1.196 (1).exe'));
    expect(picked.reason).toBeNull();
    expect(picked.sizes[0]).toEqual({ file: old, size: 0 });
    const net = server(newFile);
    const res = await mod.downloadUpdate({ ...common(pendingDir, picked.oldFile), oldBlockMap: picked.oldBlockMap, fetchRange: net.fetchRange });
    expect(res.ok).toBe(true);
    expect(res.differential).toBe(true);
    expect(net.served()).toBe(X.length + Y.length);
    // הקובץ בהורדות לא נגע
    expect(readFileSync(join(downloads, 'HavayaBeClick-Setup-0.1.196 (1).exe')).equals(oldFile)).toBe(true);
  });

  it('★ אין מתקין להשוואה בשום מקום — הורדה מלאה עם הסיבה, בהתקדמות ובתוצאה', async () => {
    const { pendingDir, oldFile: old } = setup();
    rmSync(old);
    const picked = mod.pickOldInstaller({ installers: [old], maps: [mapOf(oldBlocks), null], sizeOf: () => 0 });
    expect(picked).toMatchObject({ oldFile: null, oldBlockMap: null, reason: mod.FULL_REASON.NO_INSTALLER });
    const progress: Progress[] = [];
    const net = server(newFile);
    const res = await mod.downloadUpdate({
      ...common(pendingDir, picked.oldFile),
      oldBlockMap: picked.oldBlockMap,
      reason: picked.reason,
      fetchRange: net.fetchRange,
      onProgress: (p) => progress.push(p),
    });
    expect(res).toMatchObject({ ok: true, differential: false, reason: 'no-installer' });
    expect(net.served()).toBe(newFile.length);
    expect(progress.at(-1)).toMatchObject({ differential: false, reason: 'no-installer', total: newFile.length });
  });

  it('pickOldInstaller: הסיבות — אין מתקין / אין מפה לגרסה המותקנת / מתקין של גרסה אחרת', () => {
    const sizes: Record<string, number> = { a: oldFile.length, b: 123 };
    const sizeOf = (f: string) => sizes[f] ?? 0;
    expect(mod.pickOldInstaller({ installers: ['none'], maps: [mapOf(oldBlocks)], sizeOf }).reason).toBe('no-installer');
    expect(mod.pickOldInstaller({ installers: ['b'], maps: [null, null], sizeOf }).reason).toBe('no-old-map');
    expect(mod.pickOldInstaller({ installers: ['b'], maps: [mapOf(oldBlocks), null], sizeOf }).reason).toBe('installer-mismatch');
    // המטמון (current.blockmap) מתאר את המתקין שנמצא — גם בלי מפה מהשרת
    expect(mod.pickOldInstaller({ installers: ['b', 'a'], maps: [null, mapOf(oldBlocks)], sizeOf })).toMatchObject({ oldFile: 'a', reason: null });
    // סדר העדיפות של המתקינים נשמר
    sizes.c = oldFile.length;
    expect(mod.pickOldInstaller({ installers: ['c', 'a'], maps: [mapOf(oldBlocks)], sizeOf }).oldFile).toBe('c');
  });

  it('installerCandidates: installer.exe, אחר כך pending (הגרסה המותקנת קודם), אחר כך הורדות לפי השם', () => {
    const listing: Record<string, string[]> = {
      '/c/pending': ['update-info.json', 'temp-Setup-9.exe', 'Setup-9.exe', 'Setup-8.exe', 'Setup-9.exe.part', 'Setup-10.exe'],
      '/dl': ['TriviaEngine-Setup.exe', 'Setup-8(2).exe', 'Setup-8.exe', 'Setup-80.exe', 'TriviaEngine-Setup (3).exe', 'other.exe'],
    };
    const out = mod.installerCandidates({
      cacheDir: '/c',
      pendingDir: '/c/pending',
      installerName: 'Setup-8.exe',
      targetName: 'Setup-10.exe', // מה שמורידים עכשיו — לא בסיס להפרש
      folders: ['/dl', '/missing'],
      list: (d) => listing[d] ?? [],
    });
    expect(out).toEqual([
      join('/c', 'installer.exe'),
      join('/c/pending', 'Setup-8.exe'),
      join('/c/pending', 'Setup-9.exe'),
      join('/dl', 'Setup-8.exe'),
      join('/dl', 'Setup-8(2).exe'),
      join('/dl', 'TriviaEngine-Setup (3).exe'),
      join('/dl', 'TriviaEngine-Setup.exe'),
    ]);
  });

  it('★ אנטי-וירוס/פרוקסי שמתעלם מ-Range: ההפרש עובר מיד להורדה מלאה שלנו (לא של electron-updater), עם הסיבה', async () => {
    const { pendingDir, oldFile: old } = setup();
    const net = server(newFile, { ignoreRange: true });
    const progress: Progress[] = [];
    const res = await mod.downloadUpdate({ ...common(pendingDir, old), fetchRange: net.fetchRange, onProgress: (p) => progress.push(p) });
    expect(res).toMatchObject({ ok: true, differential: false, reason: 'range-blocked' });
    expect(net.calls[0]?.[0]).toBeGreaterThan(0); // ניסיון ההפרש
    expect(net.calls.at(-1)).toEqual([0, newFile.length]); // ואז הכול מבית 0
    expect(readFileSync(join(pendingDir, 'Setup-2.exe')).equals(newFile)).toBe(true);
    expect(progress.at(-1)).toMatchObject({ reason: 'range-blocked', differential: false });
  });

  it('★ הורדה מלאה שנקטעה ברשת שמתעלמת מ-Range: ההמשך יודע שאין טווחים, מתחיל מבית 0 ולא חוזר להפרש', async () => {
    const { pendingDir, oldFile: old } = setup();
    const r1 = await mod.downloadUpdate({ ...common(pendingDir, old), fetchRange: server(newFile, { ignoreRange: true, cutAfter: 100_000 }).fetchRange });
    expect(r1.ok).toBe(false);
    expect(r1.reason).toBe('range-blocked');
    expect(JSON.parse(readFileSync(join(pendingDir, 'Setup-2.exe.resume.json'), 'utf8')).rangeBlocked).toBe(sha512(newFile));
    const second = server(newFile, { ignoreRange: true });
    const r2 = await mod.downloadUpdate({ ...common(pendingDir, old), fetchRange: second.fetchRange });
    expect(r2).toMatchObject({ ok: true, differential: false, reason: 'range-blocked' });
    // המשך מ-100,000 נענה בקובץ כולו → מתחילים מ-0 (בלי ניסיון הפרש נוסף)
    expect(second.calls).toEqual([
      [100_000, newFile.length],
      [0, newFile.length],
    ]);
    expect(readFileSync(join(pendingDir, 'Setup-2.exe')).equals(newFile)).toBe(true);
  });

  it('★ הפרש שנפסל באימות נשאר "אסור" גם כשההורדה המלאה שאחריו נקטעת וממשיכה', async () => {
    const { pendingDir, oldFile: old } = setup();
    writeFileSync(old, Buffer.concat([A, B, randomBytes(BLOCK)])); // C פגום
    const r1 = await mod.downloadUpdate({ ...common(pendingDir, old), fetchRange: server(newFile).fetchRange });
    expect(r1.ok).toBe(false);
    const r2 = await mod.downloadUpdate({ ...common(pendingDir, old), fetchRange: server(newFile, { cutAfter: 50_000 }).fetchRange });
    expect(r2).toMatchObject({ ok: false, reason: 'bad-differential' });
    const third = server(newFile);
    const r3 = await mod.downloadUpdate({ ...common(pendingDir, old), fetchRange: third.fetchRange });
    expect(r3).toMatchObject({ ok: true, differential: false, reason: 'bad-differential' });
    expect(third.calls).toEqual([[50_000, newFile.length]]); // ממשיך, לא מתחיל שוב ולא מנסה שוב הפרש
  });

  it('★ כבר הורד (התוכנה לא נסגרה מאז): אין שום הורדה', async () => {
    const { pendingDir, oldFile: old } = setup();
    await mod.downloadUpdate({ ...common(pendingDir, old), fetchRange: server(newFile).fetchRange });
    const again = server(newFile);
    const res = await mod.downloadUpdate({ ...common(pendingDir, old), fetchRange: again.fetchRange });
    expect(res).toMatchObject({ ok: true, transferred: 0 });
    expect(again.calls).toEqual([]);
  });

  it('★ pending מתנקה ממתקינים ישנים — חוץ מהמתקין שממנו נבנה ההפרש', async () => {
    const { pendingDir } = setup();
    mkdirSync(pendingDir, { recursive: true });
    const used = join(pendingDir, 'Setup-1.exe');
    writeFileSync(used, oldFile);
    writeFileSync(join(pendingDir, 'Setup-0.exe'), 'old');
    writeFileSync(join(pendingDir, 'temp-Setup-0.exe'), 'old');
    writeFileSync(join(pendingDir, 'Setup-0.exe.part'), 'old');
    writeFileSync(join(pendingDir, 'Setup-0.exe.resume.json'), '{}');
    const res = await mod.downloadUpdate({ ...common(pendingDir, used), fetchRange: server(newFile).fetchRange });
    expect(res.ok).toBe(true);
    expect(readdirSync(pendingDir).sort()).toEqual(['Setup-1.exe', 'Setup-2.exe', 'current.blockmap', 'update-info.json']);
  });
});
