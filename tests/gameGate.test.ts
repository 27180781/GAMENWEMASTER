/**
 * קוד הגישה להחלפת/עריכת המשחק.
 *
 * מחסום ממשק, לא הצפנה — אבל גם מחסום ממשק חייב להתנהג נכון: לא לשמור את הקוד
 * בגלוי, לא להיפתח בקוד ריק, ולשרוד עדכון תוכנה.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const gate = require('../electron/gameGate.cjs') as {
  gateFile: (dir: string) => string;
  gateStatus: (dir: string) => { configured: boolean; enabled: boolean };
  setGate: (dir: string, code: string | null) => boolean;
  verifyGate: (dir: string, code: string) => boolean;
  changeGate: (dir: string, current: string, next: string | null) => boolean;
};

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gamegate-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('לפני שהמשתמש נשאל', () => {
  it('★ לא מוגדר — ולכן יוצג לו חלון ההגדרה', () => {
    expect(gate.gateStatus(dir)).toEqual({ configured: false, enabled: false });
  });

  it('★ וכל עוד לא הוגדר — הכול פתוח, כדי שלא ייחסם משום מקום', () => {
    expect(gate.verifyGate(dir, '')).toBe(true);
  });
});

describe('ויתור על קוד', () => {
  beforeEach(() => {
    gate.setGate(dir, null);
  });

  it('★ נרשם כמוגדר — ולכן החלון לא יחזור בפתיחה הבאה', () => {
    expect(gate.gateStatus(dir)).toEqual({ configured: true, enabled: false });
  });

  it('כל בדיקה עוברת', () => {
    expect(gate.verifyGate(dir, '')).toBe(true);
    expect(gate.verifyGate(dir, 'משהו')).toBe(true);
  });
});

describe('קוד פעיל', () => {
  beforeEach(() => {
    gate.setGate(dir, '1234');
  });

  it('★ מוגדר ופעיל', () => {
    expect(gate.gateStatus(dir)).toEqual({ configured: true, enabled: true });
  });

  it('★ הקוד הנכון פותח', () => {
    expect(gate.verifyGate(dir, '1234')).toBe(true);
  });

  it('★ קוד שגוי, ריק או חסר — נחסם', () => {
    for (const bad of ['', '   ', '1235', '123', '12345', 'abc']) {
      expect(gate.verifyGate(dir, bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('רווחים מסביב אינם משנים — הקלדה באולם לא תיכשל בגללם', () => {
    expect(gate.verifyGate(dir, '  1234  ')).toBe(true);
  });

  it('★ הקוד עצמו אינו נשמר בקובץ', () => {
    const raw = readFileSync(gate.gateFile(dir), 'utf8');
    expect(raw).not.toContain('1234');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed['hash']).toEqual(expect.any(String));
    expect(parsed['salt']).toEqual(expect.any(String));
  });

  it('★ אותו קוד בשתי התקנות מייצר גיבוב שונה (מלח אקראי)', () => {
    const first = JSON.parse(readFileSync(gate.gateFile(dir), 'utf8')) as { hash: string };
    gate.setGate(dir, '1234');
    const second = JSON.parse(readFileSync(gate.gateFile(dir), 'utf8')) as { hash: string };
    expect(second.hash).not.toBe(first.hash);
  });
});

describe('החלפת קוד', () => {
  beforeEach(() => {
    gate.setGate(dir, 'old');
  });

  it('★ דורשת את הקוד הנוכחי — אחרת המחסום היה חסר משמעות', () => {
    expect(gate.changeGate(dir, 'wrong', 'new')).toBe(false);
    expect(gate.verifyGate(dir, 'old')).toBe(true); // לא השתנה
  });

  it('★ עם הקוד הנכון — מתחלף', () => {
    expect(gate.changeGate(dir, 'old', 'new')).toBe(true);
    expect(gate.verifyGate(dir, 'new')).toBe(true);
    expect(gate.verifyGate(dir, 'old')).toBe(false);
  });

  it('★ אפשר גם להסיר את הקוד לגמרי', () => {
    expect(gate.changeGate(dir, 'old', null)).toBe(true);
    expect(gate.gateStatus(dir)).toEqual({ configured: true, enabled: false });
    expect(gate.verifyGate(dir, '')).toBe(true);
  });
});

describe('קובץ הגדרות פגום', () => {
  it('★ נחשב כלא-מוגדר, ולא חוסם', () => {
    writeFileSync(gate.gateFile(dir), 'not json');
    expect(gate.gateStatus(dir)).toEqual({ configured: false, enabled: false });
    expect(gate.verifyGate(dir, '')).toBe(true);
  });

  it('★ קובץ שמצהיר enabled בלי גיבוב — חוסם, ולא נפתח בטעות', () => {
    // מצב שלא אמור לקרות; אם קרה, עדיף לחסום מאשר לפתוח לכולם.
    writeFileSync(gate.gateFile(dir), JSON.stringify({ enabled: true }));
    expect(gate.verifyGate(dir, 'משהו')).toBe(false);
  });
});

describe('שרידות לעדכון תוכנה', () => {
  it('★ ההגדרה יושבת ב-userData — קובץ אחד שנשאר בין גרסאות', () => {
    gate.setGate(dir, '1234');
    expect(existsSync(gate.gateFile(dir))).toBe(true);
    // "עדכון" = אותו userData, תהליך חדש. הקריאה הבאה קוראת מהדיסק.
    expect(gate.gateStatus(dir)).toEqual({ configured: true, enabled: true });
    expect(gate.verifyGate(dir, '1234')).toBe(true);
  });
});
