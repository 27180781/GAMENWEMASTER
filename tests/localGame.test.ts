/**
 * משחק שנבנה מאפס בתוכנה נשמר בספרייה כמו משחק שהורד, עם סימון local.
 *
 * הבדיקות נועלות: הקובץ נכתב ונבחר כמשחק הנוכחי (ולכן הטעינה, העריכה
 * והשמירה הקיימות עובדות עליו), הסימון שמבדיל אותו ממשחק שהורד, ועדכון השם
 * ברשימה אחרי שמירה בעורך — רק למשחק מקומי.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';

const require = createRequire(import.meta.url);
interface LibEntry {
  code: string;
  name: string;
  savedAt: number;
  size: number;
  local: boolean;
}
const lib = require('../electron/gameLibrary.cjs') as {
  isSafeCode: (code: unknown) => boolean;
  libraryZipPath: (dir: string, code: string) => string;
  libraryMetaPath: (dir: string, code: string) => string;
  lastGameMetaPath: (dir: string) => string;
  currentGameZipPath: (dir: string) => string;
  libraryList: (dir: string) => LibEntry[];
  libraryStore: (dir: string, code: string, name: string, extra?: { local?: boolean }) => boolean;
  libraryDelete: (dir: string, code: string) => boolean;
  currentIsLocal: (dir: string) => boolean;
  renameCurrentLocal: (dir: string, name: string) => boolean;
};
const local = require('../electron/localGame.cjs') as {
  createLocalGame: (
    dir: string,
    name: string,
    dataJson: string,
  ) => Promise<{ ok: boolean; code?: string; error?: string }>;
  newLocalCode: (now?: number) => string;
  isLocalCode: (code: unknown) => boolean;
};

const GAME = { name: 'ערב חנוכה', questions: [{ id: 1 }], setting: { limit: { type: 'clickers' } } };

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'localgame-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('newLocalCode', () => {
  it('קוד תקין כשם קובץ, שמתחיל ב-local- ולא מתנגש בקוד מהשרת', () => {
    for (let i = 0; i < 50; i++) {
      const code = local.newLocalCode();
      expect(lib.isSafeCode(code)).toBe(true);
      expect(local.isLocalCode(code)).toBe(true);
    }
    expect(local.isLocalCode('123456')).toBe(false);
    expect(local.newLocalCode(1)).not.toBe(local.newLocalCode(1));
  });
});

describe('createLocalGame', () => {
  it('כותב ZIP עם data.json לספרייה ובוחר אותו כמשחק הנוכחי', async () => {
    const res = await local.createLocalGame(dir, 'ערב חנוכה', JSON.stringify(GAME));
    expect(res.ok).toBe(true);
    const code = res.code ?? '';
    expect(local.isLocalCode(code)).toBe(true);

    const zipPath = lib.libraryZipPath(dir, code);
    expect(lib.currentGameZipPath(dir)).toBe(zipPath);
    const zip = await JSZip.loadAsync(readFileSync(zipPath));
    expect(Object.keys(zip.files)).toEqual(['data.json']);
    expect(JSON.parse(await zip.file('data.json')!.async('string'))).toEqual(GAME);

    // בלי קובץ זמני שנשאר מאחור
    expect(readdirSync(join(dir, 'games')).filter((f) => f.endsWith('.saving'))).toEqual([]);
  });

  it('מופיע ברשימה כמשחק מקומי, עם השם שנתנו לו', async () => {
    const res = await local.createLocalGame(dir, '  ערב חנוכה  ', JSON.stringify(GAME));
    const [entry] = lib.libraryList(dir);
    expect(entry).toMatchObject({ code: res.code, name: 'ערב חנוכה', local: true });
    expect(entry?.size).toBeGreaterThan(0);
    expect(lib.currentIsLocal(dir)).toBe(true);
    expect(JSON.parse(readFileSync(lib.lastGameMetaPath(dir), 'utf8'))).toMatchObject({
      code: res.code,
      name: 'ערב חנוכה',
    });
  });

  it('שם ריק — נלקח מהקובץ', async () => {
    await local.createLocalGame(dir, '', JSON.stringify(GAME));
    expect(lib.libraryList(dir)[0]?.name).toBe('ערב חנוכה');
  });

  it('JSON לא תקין או בלי שקופיות — נדחה ולא נשאר כלום', async () => {
    expect((await local.createLocalGame(dir, 'x', '{nope')).ok).toBe(false);
    expect((await local.createLocalGame(dir, 'x', '{"name":"x"}')).ok).toBe(false);
    expect(lib.libraryList(dir)).toEqual([]);
  });

  it('משחק שהורד אינו מקומי', () => {
    writeFileSync(lib.libraryZipPath(dir, '123456'), 'zip');
    lib.libraryStore(dir, '123456', 'מהשרת');
    expect(lib.libraryList(dir)[0]?.local).toBe(false);
    expect(lib.currentIsLocal(dir)).toBe(false);
  });

  it('מחיקה מסירה אותו מהרשימה ומבטלת את הבחירה', async () => {
    const res = await local.createLocalGame(dir, 'x', JSON.stringify(GAME));
    lib.libraryDelete(dir, res.code ?? '');
    expect(lib.libraryList(dir)).toEqual([]);
    expect(lib.currentIsLocal(dir)).toBe(false);
  });
});

describe('renameCurrentLocal', () => {
  it('שמירה בעורך עם שם חדש מעדכנת את הרשימה, והסימון המקומי נשמר', async () => {
    const res = await local.createLocalGame(dir, 'ישן', JSON.stringify(GAME));
    expect(lib.renameCurrentLocal(dir, ' חדש ')).toBe(true);
    expect(lib.libraryList(dir)[0]).toMatchObject({ code: res.code, name: 'חדש', local: true });
    expect(JSON.parse(readFileSync(lib.lastGameMetaPath(dir), 'utf8')).name).toBe('חדש');
  });

  it('שם ריק או זהה — לא נוגע', async () => {
    await local.createLocalGame(dir, 'שם', JSON.stringify(GAME));
    expect(lib.renameCurrentLocal(dir, '  ')).toBe(false);
    expect(lib.renameCurrentLocal(dir, 'שם')).toBe(false);
  });

  it('משחק שהורד — השם ברשימה נשאר השם מהשרת', () => {
    writeFileSync(lib.libraryZipPath(dir, '123456'), 'zip');
    lib.libraryStore(dir, '123456', 'מהשרת');
    expect(lib.renameCurrentLocal(dir, 'אחר')).toBe(false);
    expect(lib.libraryList(dir)[0]?.name).toBe('מהשרת');
  });
});
