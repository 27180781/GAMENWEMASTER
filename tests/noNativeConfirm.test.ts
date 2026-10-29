/**
 * אין window.confirm / alert / prompt בתוכנה.
 *
 * ב-Electron ב-Windows, אחרי שחלון כזה נסגר, המקלדת כבר לא מגיעה לשדות הטקסט
 * עד שהתוכנה נפתחת מחדש. כך, אחרי מחיקת משחק אחד מרשימת המשחקים שבמחשב,
 * אי אפשר היה להקליד את קוד הגישה למחיקה הבאה. במקומם: askConfirm
 * (src/render/ConfirmDialog.tsx), חלון שמצויר בתוך הדף.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|m?js|cjs)$/.test(name) ? [path] : [];
  });
}

/** הקוד בלי הערות, כדי שהסבר על window.confirm לא ייחשב לשימוש בו. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('no native confirm dialogs', () => {
  it('nothing in src calls window.confirm, alert or prompt', () => {
    const hits = sources(join(ROOT, 'src')).flatMap((file) =>
      code(readFileSync(file, 'utf8'))
        .split('\n')
        .filter(
          (line) =>
            /\b(window\.)?(confirm|alert|prompt)\s*\(/.test(line) && !/askConfirm\s*\(/.test(line),
        )
        .map((line) => `${relative(ROOT, file)}: ${line.trim()}`),
    );
    expect(hits).toEqual([]);
  });
});
