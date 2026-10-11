/**
 * הרצת פיתוח מול התוכנה הארוזה (electron/runMode.cjs). עותק של התוכנה בשם
 * electron.exe הוא "לא ארוז" בעיני Electron, ועד אוקטובר 2026 קיבל בגלל זה את
 * כל האישורים ואת כלי הפיתוח.
 */

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isDevRun, remoteOverride, testSigningKeys } = require('../electron/runMode.cjs') as {
  isDevRun: (ctx: { isPackaged: boolean; defaultApp: unknown }) => boolean;
  remoteOverride: (dev: boolean, env: Record<string, string | undefined>) => { url: string | null; key: string | null };
  testSigningKeys: (dev: boolean, env: Record<string, string | undefined>) => Record<string, string>;
};

describe('isDevRun', () => {
  it('רק `electron .` מתיקיית הקוד', () => {
    expect(isDevRun({ isPackaged: false, defaultApp: true })).toBe(true);
  });

  it('התוכנה הארוזה בשם electron.exe אינה הרצת פיתוח', () => {
    // כך זה נראה בפועל: Electron מחזיר isPackaged=false לפי שם הקובץ, ו-defaultApp לא דולק.
    expect(isDevRun({ isPackaged: false, defaultApp: undefined })).toBe(false);
    expect(isDevRun({ isPackaged: false, defaultApp: false })).toBe(false);
  });

  it('תוכנה ארוזה לעולם אינה הרצת פיתוח', () => {
    expect(isDevRun({ isPackaged: true, defaultApp: undefined })).toBe(false);
    expect(isDevRun({ isPackaged: true, defaultApp: true })).toBe(false);
  });

  it('רק true מפורש', () => {
    expect(isDevRun({ isPackaged: false, defaultApp: 'true' })).toBe(false);
    expect(isDevRun({ isPackaged: false, defaultApp: 1 })).toBe(false);
  });
});

describe('remoteOverride', () => {
  const env = { TRIVIA_REMOTE_URL: 'http://127.0.0.1:9', TRIVIA_REMOTE_KEY: 'k' };

  it('בהרצת פיתוח — השרת והמפתח ממשתני הסביבה', () => {
    expect(remoteOverride(true, env)).toEqual({ url: 'http://127.0.0.1:9', key: 'k' });
    expect(remoteOverride(true, {})).toEqual({ url: null, key: null });
    expect(remoteOverride(true, { TRIVIA_REMOTE_URL: '' })).toEqual({ url: null, key: null });
  });

  it('בתוכנה הארוזה משתני הסביבה אינם מפנים אותה לשרת אחר', () => {
    expect(remoteOverride(false, env)).toEqual({ url: null, key: null });
  });
});

describe('testSigningKeys', () => {
  const KEYS = JSON.stringify({ '21fe31dfa154a261': '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo' });

  it('בהרצת פיתוח — מפתחות הבדיקה מהסביבה', () => {
    expect(testSigningKeys(true, { TRIVIA_TEST_SIGNING_KEYS: KEYS })).toEqual({
      '21fe31dfa154a261': '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
    });
  });

  it('בתוכנה הארוזה מפתח ממשתנה סביבה לעולם אינו נכנס', () => {
    expect(testSigningKeys(false, { TRIVIA_TEST_SIGNING_KEYS: KEYS })).toEqual({});
  });

  it('ערך שאינו אובייקט של מחרוזות — כלום', () => {
    expect(testSigningKeys(true, {})).toEqual({});
    expect(testSigningKeys(true, { TRIVIA_TEST_SIGNING_KEYS: '{' })).toEqual({});
    expect(testSigningKeys(true, { TRIVIA_TEST_SIGNING_KEYS: '["x"]' })).toEqual({});
    expect(testSigningKeys(true, { TRIVIA_TEST_SIGNING_KEYS: 'null' })).toEqual({});
    expect(testSigningKeys(true, { TRIVIA_TEST_SIGNING_KEYS: '{"a":1,"b":"","c":"x"}' })).toEqual({ c: 'x' });
  });
});
