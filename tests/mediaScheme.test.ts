/**
 * סכימת המדיה מהדיסק (trivia-media://) ב-EXE. הדף נטען מ-‎file://‎, ונגן
 * הקריינות מושך את הקטעים ב-fetch() ומפענח אותם ל-Web Audio — בקשה חוצת-origin.
 * שלא כמו <video>/<img>, היא תלויה בכך שהסכימה corsEnabled ושכל תשובה מאשרת
 * את ה-origin; בלי זה הקריינות האופליינית שותקת כולה, בלי שגיאה נראית.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MEDIA_SCHEME_PRIVILEGES, withCors } = require('../electron/mediaScheme.cjs') as {
  MEDIA_SCHEME_PRIVILEGES: Record<string, boolean>;
  withCors: (response: Response) => Response;
};

describe('הרשאות הסכימה', () => {
  it('★ corsEnabled — ושאר ההרשאות (וידאו, זרימה, fetch) נשמרות', () => {
    expect(MEDIA_SCHEME_PRIVILEGES).toEqual({
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    });
  });
});

describe('withCors', () => {
  it('★ מוסיף Access-Control-Allow-Origin: * ושומר סטטוס, כותרות וגוף (Range)', async () => {
    const res = withCors(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 206,
        statusText: 'Partial Content',
        headers: { 'Content-Type': 'audio/mpeg', 'Content-Range': 'bytes 0-2/10' },
      }),
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.status).toBe(206);
    expect(res.statusText).toBe('Partial Content');
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(res.headers.get('Content-Range')).toBe('bytes 0-2/10');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it('גם תשובה עם כותרות נעולות (כמו של net.fetch) וגם שגיאה', async () => {
    const fetched = await fetch('data:audio/mpeg;base64,AAEC');
    expect(() => fetched.headers.set('x', 'y')).toThrow(); // נעולות באמת
    const res = withCors(fetched);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(await res.arrayBuffer()).toHaveProperty('byteLength', 3);
    const missing = withCors(new Response('not found', { status: 404 }));
    expect(missing.status).toBe(404);
    expect(missing.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('main.cjs משתמש בהם', () => {
  const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');

  it('★ הסכימה נרשמת עם ההרשאות המשותפות', () => {
    expect(main).toMatch(/scheme: 'trivia-media',\s*privileges: MEDIA_SCHEME_PRIVILEGES/);
  });

  it('★ כל תשובה של הפרוטוקול עוברת דרך withCors', () => {
    const handlers = [...main.matchAll(/protocol\.handle\('trivia-media',([^\n]*)/g)].map((m) => m[1]!);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]).toContain('withCors(');
  });
});
