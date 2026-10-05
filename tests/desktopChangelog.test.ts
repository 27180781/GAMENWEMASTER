/**
 * «מה חדש» בעמוד ההורדה (tools/desktop-changelog.mjs).
 *
 * הרשימה נבנית מחדש בכל בניית EXE מתוך הריצות שהצליחו, ולכן הבדיקות נועלות
 * את מה שקובע איזה שינוי שייך לאיזו גרסה: ריצה שנכשלה מגלגלת את השינויים שלה
 * הלאה, שינוי פנימי לא מוצג, וה-paths זהים לאלה שמפעילים את הבנייה.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — כלי בנייה ב-JS, בלי הצהרות טיפוסים
import { APP_PATHS, WHATS_NEW, buildChangelog, changeText } from '../tools/desktop-changelog.mjs';

// js-yaml מגיע דרך electron-builder, בלי הצהרות טיפוסים (כמו ב-electronBuilderConfig.test.ts).
const { load } = createRequire(import.meta.url)('js-yaml') as { load: (text: string) => unknown };

type Entry = { version: string; date: string | null; changes: string[] };

/** היסטוריה מדומה: הכותרות של כל קומיט, לפי ה-sha שלו, מהישן לחדש. */
function history(commits: [string, string][]) {
  const order = commits.map(([sha]) => sha);
  const subject = new Map(commits);
  return (from: string, to: string) =>
    order
      .slice(order.indexOf(from) + 1, order.indexOf(to) + 1)
      .reverse()
      .map((sha) => subject.get(sha) as string);
}

describe('changeText', () => {
  it('כותרת ה-PR בלי מספר ה-PR', () => {
    expect(changeText('יבוא שאלות מאקסל בעורך המקומי (אופליין) (#214)')).toBe(
      'יבוא שאלות מאקסל בעורך המקומי (אופליין)',
    );
    expect(changeText('תיקון בלי PR')).toBe('תיקון בלי PR');
  });

  it('ניסוח מחדש ושינוי פנימי לפי מספר ה-PR', () => {
    expect(changeText('Bet slide, majority decides, live vote counts (#196)')).toBe(
      WHATS_NEW['#196'],
    );
    expect(changeText("bet.ts: point at the builder's contract doc (#198)")).toBeNull();
    expect(changeText('   ')).toBeNull();
  });
});

describe('buildChangelog', () => {
  const log = history([
    ['a', 'בסיס (#1)'],
    ['b', 'פיצ׳ר ראשון (#2)'],
    ['c', 'פיצ׳ר שני (#3)'],
    ['d', 'פיצ׳ר שלישי (#4)'],
    ['e', "bet.ts: point at the builder's contract doc (#198)"],
  ]);

  it('★ כל גרסה מקבלת את מה שבין הריצה המוצלחת הקודמת לשלה, מהחדשה לישנה', () => {
    // ריצה 11 נכשלה (אינה ברשימה) — הפיצ׳ר שלה נכנס ל-12.
    const runs = [
      { number: 12, headSha: 'd', createdAt: '2026-10-05T10:00:00Z' },
      { number: 10, headSha: 'b', createdAt: '2026-10-01T10:00:00Z' },
      { number: 9, headSha: 'a', createdAt: '2026-09-30T10:00:00Z' },
    ];
    const entries: Entry[] = buildChangelog(runs, log);
    expect(entries).toEqual([
      { version: '0.1.12', date: '2026-10-05T10:00:00Z', changes: ['פיצ׳ר שלישי', 'פיצ׳ר שני'] },
      { version: '0.1.10', date: '2026-10-01T10:00:00Z', changes: ['פיצ׳ר ראשון'] },
    ]);
  });

  it('גרסה שכל השינויים בה פנימיים מופיעה בלי פירוט; כפילויות נזרקות; תקרה על מספר הגרסאות', () => {
    const runs = [
      { number: 1, headSha: 'a' },
      { number: 2, headSha: 'b' },
      { number: 3, headSha: 'd' },
      { number: 3, headSha: 'd' },
      { number: 4, headSha: 'e' },
    ];
    const entries: Entry[] = buildChangelog(runs, log);
    expect(entries.map((e) => e.version)).toEqual(['0.1.4', '0.1.3', '0.1.2']);
    expect(entries[0]).toEqual({ version: '0.1.4', date: null, changes: [] });
    expect(buildChangelog(runs, log, 1).map((e: Entry) => e.version)).toEqual(['0.1.4']);
    expect(buildChangelog([{ number: 1, headSha: 'a' }], log)).toEqual([]);
  });
});

it('APP_PATHS זהים ל-paths שמפעילים את בניית ה-EXE', () => {
  const workflow = load(
    readFileSync(new URL('../.github/workflows/build-desktop.yml', import.meta.url), 'utf8'),
  ) as {
    on: { push: { paths: string[] } };
  };
  expect(workflow.on.push.paths.length).toBeGreaterThan(5);
  expect(APP_PATHS).toEqual(workflow.on.push.paths);
});
