/**
 * ייבוא שמות/קבוצות מגיליון אקסל אל מרשם השחקנים. שני מצבים:
 *
 *   'full'  — מספר שלט | שם | קבוצה (אופציונלי). הייבוא ה"מלא".
 *   'names' — שם | קבוצה (אופציונלי). השלמה לקליטה החכמה: השמות נקשרים
 *             לשלטים שכבר נלחצו ועדיין בלי שם, והשאר ממתינים ללחיצות הבאות.
 *
 * בשני המצבים **השורה הראשונה היא כותרת ואינה מיובאת**. משתמשים בה רק לדבר
 * אחד: שם עמודת הקבוצה הופך לשם הקטגוריה (כמו "עיר" / "מחלקה"), בדיוק כמו
 * קטגוריה שמגיעה מקובץ ה-JSON.
 *
 * הקובץ טהור — ההמרה מקובץ לשורות נעשית ב-xlsxRead.ts.
 */

import {
  DEFAULT_IMPORT_CATEGORY,
  addPendingNames,
  assignGroup,
  ensureGroupByName,
  upsertPlayer,
  type PendingName,
  type RosterData,
} from './roster.ts';

export type ImportMode = 'full' | 'names';

/** שורה אחת אחרי ניקוי. */
export interface ImportRow {
  /** מספר השלט; ריק במצב 'names'. */
  id: string;
  name: string;
  group: string;
}

export interface ImportSummary {
  roster: RosterData;
  /** שלטים/שמות חדשים שנוספו. */
  added: number;
  /** רשומות קיימות שקיבלו שם מעודכן. */
  updated: number;
  /** כמה שויכו לקבוצה. */
  grouped: number;
  /** שורות שנפסלו (בלי מספר / בלי שם). */
  skipped: number;
  /** שמות שממתינים לשלט אחרי הייבוא (רלוונטי ל-'names'). */
  waiting: number;
  /** שם הקטגוריה שאליה נכנסו הקבוצות. */
  categoryName: string;
}

/** תא בטוח: מחרוזת מנוקה, גם כשהתא חסר. */
function cell(row: string[] | undefined, index: number): string {
  return (row?.[index] ?? '').trim();
}

/**
 * מספר שלט מנורמל. אקסל מחזיר לפעמים מספרים שלמים כ-"105.0" או עם רווחים —
 * ומספר שלט שלא תואם בדיוק ל-voterId שמגיע מהקליקר פשוט לא היה נקשר לאיש.
 */
export function normalizeRemoteId(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, '');
  if (trimmed === '') return '';
  const asNumber = /^\d+(?:\.0+)?$/.exec(trimmed);
  return asNumber === null ? trimmed : String(parseInt(trimmed, 10));
}

/** שם הקטגוריה לפי כותרת עמודת הקבוצה, או ברירת המחדל אם אין כותרת. */
export function categoryNameFromHeader(rows: string[][], mode: ImportMode): string {
  const header = rows[0];
  const name = cell(header, mode === 'full' ? 2 : 1);
  return name === '' ? DEFAULT_IMPORT_CATEGORY : name;
}

/**
 * שורות הגיליון → רשומות לייבוא. **השורה הראשונה מדולגת תמיד** (כותרת).
 * שורות ריקות לגמרי נבלעות בשקט; שורות בלי הערך המחייב נספרות כ"נפסלו".
 */
export function parseImportRows(rows: string[][], mode: ImportMode): ImportRow[] {
  const out: ImportRow[] = [];
  for (const row of rows.slice(1)) {
    if (row.every((c) => c.trim() === '')) continue; // שורה ריקה — לא "נפסלה"
    if (mode === 'full') {
      out.push({ id: normalizeRemoteId(cell(row, 0)), name: cell(row, 1), group: cell(row, 2) });
    } else {
      out.push({ id: '', name: cell(row, 0), group: cell(row, 1) });
    }
  }
  return out;
}

/** ייבוא מלא: מספר שלט → שם (+ קבוצה). */
function importFull(roster: RosterData, rows: ImportRow[], categoryName: string): ImportSummary {
  let r = roster;
  let added = 0;
  let updated = 0;
  let grouped = 0;
  let skipped = 0;
  for (const row of rows) {
    if (row.id === '') {
      skipped += 1; // בלי מספר שלט אין למה לקשור את השם
      continue;
    }
    const existing = r.players.find((p) => p.id === row.id);
    if (existing === undefined) added += 1;
    else if (existing.name.trim() !== row.name && row.name !== '') updated += 1;
    r = upsertPlayer(r, row.id, row.name);
    if (row.group !== '') {
      const ensured = ensureGroupByName(r, categoryName, row.group);
      r = assignGroup(ensured.roster, row.id, ensured.categoryId, ensured.groupId);
      grouped += 1;
    }
  }
  return {
    roster: r,
    added,
    updated,
    grouped,
    skipped,
    waiting: r.pendingNames.length,
    categoryName,
  };
}

/** השלמת שמות: השמות נכנסים לתור ונקשרים לשלטים שכבר נקלטו. */
function importNames(roster: RosterData, rows: ImportRow[], categoryName: string): ImportSummary {
  const names: PendingName[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (row.name === '') {
      skipped += 1;
      continue;
    }
    // הקטגוריה נצרבת בשם עצמו: הלחיצה שתתפוס אותו יכולה להגיע הרבה אחרי
    // הייבוא, ואסור שהקבוצה תיווצר אז תחת קטגוריית ברירת המחדל.
    names.push({ name: row.name, group: row.group, category: categoryName });
  }
  const before = roster.players.filter((p) => p.name.trim() === '').length;
  const next = addPendingNames(roster, names, categoryName);
  const after = next.players.filter((p) => p.name.trim() === '').length;
  const bound = before - after;
  return {
    roster: next,
    added: names.length,
    updated: bound, // כמה שלטים שהמתינו קיבלו שם עכשיו
    grouped: names.filter((n) => n.group !== '').length,
    skipped,
    waiting: next.pendingNames.length,
    categoryName,
  };
}

/** ייבוא גיליון שלם למרשם. */
export function importSheet(
  roster: RosterData,
  rows: string[][],
  mode: ImportMode,
): ImportSummary {
  const categoryName = categoryNameFromHeader(rows, mode);
  const parsed = parseImportRows(rows, mode);
  return mode === 'full'
    ? importFull(roster, parsed, categoryName)
    : importNames(roster, parsed, categoryName);
}

/** משפט סיכום לתצוגה למנחה. */
export function summaryText(summary: ImportSummary, mode: ImportMode): string {
  const parts: string[] = [];
  if (mode === 'full') {
    if (summary.added > 0) parts.push(`${summary.added} שלטים נוספו`);
    if (summary.updated > 0) parts.push(`${summary.updated} שמות עודכנו`);
  } else {
    if (summary.updated > 0) parts.push(`${summary.updated} שמות שובצו לשלטים`);
    if (summary.waiting > 0) parts.push(`${summary.waiting} ממתינים ללחיצה`);
  }
  if (summary.grouped > 0) parts.push(`${summary.grouped} שויכו ל"${summary.categoryName}"`);
  if (summary.skipped > 0) parts.push(`${summary.skipped} שורות נפסלו`);
  return parts.length === 0 ? 'לא נמצאו שורות לייבוא' : parts.join(' · ');
}
