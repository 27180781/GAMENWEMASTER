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
