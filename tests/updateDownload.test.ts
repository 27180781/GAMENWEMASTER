/**
 * הורדת עדכון הפרשית וניתנת להמשך (electron/updateDownload.cjs).
 *
 * מפות הבלוקים כאן נבנות ביד — רק שוויון ה-checksum קובע מה מועתק מהמתקין
 * הקודם ומה יורד — והרשת מדומה: fetchRange מגיש טווחים מתוך "המתקין החדש"
 * ויכול להיקטע באמצע, כדי לוודא שההמשך באמת ממשיך ולא מתחיל מאפס.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
type RangeResult = { ok: true; bytes: number } | { ok: false; error: string; retryable: boolean };
type FetchRange = (url: string, start: number, end: number, sink: (chunk: Buffer) => void) => Promise<RangeResult>;
type BlockMap = { version: string; files: { name: string; offset: number; checksums: string[]; sizes: number[] }[] };
type Progress = { transferred: number; total: number; percent: number; differential: boolean };
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
    onProgress?: (p: Progress) => void;
    log?: (m: string) => void;
  }) => Promise<{ ok: boolean; file?: string; differential?: boolean; transferred?: number; error?: string; retryable?: boolean }>;
  buildPlan: (a: { oldBlockMap: BlockMap | null; newBlockMap: BlockMap | null; oldFile: string | null; size: number; log: (m: string) => void }) => { ops: { kind: number; start: number; end: number }[]; differential: boolean };
  oldBlockMapUrl: (newUrl: string, newVersion: string, oldVersion: string) => string;
  parseBlockMap: (buf: Buffer | null) => BlockMap | null;
};

const BLOCK = 64 * 1024;
const sha512 = (b: Buffer) => createHash('sha512').update(b).digest('base64');
const sum = (b: Buffer) => createHash('sha256').update(b).digest('base64');
/** מפה של קובץ יחיד ("file") מבלוקים בגודל קבוע — הפורמט של electron-builder. */
const mapOf = (blocks: Buffer[]): BlockMap => ({
  version: '2',
  files: [{ name: 'file', offset: 0, checksums: blocks.map(sum), sizes: blocks.map((b) => b.length) }],
});
/** רשת מדומה: מגישה טווחים מהקובץ החדש; `cutAfter` בתים — ניתוק (פעם אחת). */
function server(newFile: Buffer, opts: { cutAfter?: number } = {}) {
  let served = 0;
  let cut = opts.cutAfter;
  const calls: [number, number][] = [];
  const fetchRange: FetchRange = async (_url, start, end, sink) => {
    calls.push([start, end]);
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
});
