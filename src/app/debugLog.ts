/**
 * לוג דיבוג מרכזי — טבעת אירועים גלובלית שרושמת את כל השלבים במשחק: קליטת
 * הצבעות, פקודות מפעיל, מעברים אוטומטיים, אירועי סוקט, סאונד ומדיה. חלונית
 * הדיבוג (מקש F12) נרשמת אליו ומציגה אותו בזמן אמת; במקביל כל רשומה נכתבת
 * גם ל-console.debug כדי שתופיע ב-DevTools האמיתי.
 */

export type DebugCategory =
  | 'phase' // מעברי שלב/שקופית
  | 'vote' // קליטת snapshot הצבעות
  | 'command' // פקודות מפעיל / מקשים
  | 'auto' // מעברים אוטומטיים
  | 'socket' // סטטוס/אירועי חיבור
  | 'audio' // ניגון/חסימת סאונד
  | 'media' // מדיה
  | 'game'; // טעינה/רענון/כללי

export interface DebugEntry {
  id: number;
  t: number; // Date.now()
  cat: DebugCategory;
  msg: string;
  data?: unknown;
}

const MAX_ENTRIES = 700;
let entries: DebugEntry[] = [];
let seq = 0;
let consoleEcho = true;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** רושם אירוע לדיבוג. data אופציונלי (מוצג מורחב בחלונית). */
export function debugLog(cat: DebugCategory, msg: string, data?: unknown): void {
  seq += 1;
  const entry: DebugEntry =
    data === undefined ? { id: seq, t: Date.now(), cat, msg } : { id: seq, t: Date.now(), cat, msg, data };
  // שמירת רפרנס חדש בכל רשומה — כדי ש-useSyncExternalStore יזהה שינוי
  entries = entries.length >= MAX_ENTRIES ? [...entries.slice(entries.length - MAX_ENTRIES + 1), entry] : [...entries, entry];
  if (consoleEcho) {
    try {
      console.debug(`%c[${cat}]%c ${msg}`, 'color:#8ab4ff;font-weight:700', 'color:inherit', data ?? '');
    } catch {
      /* אין console — מתעלמים */
    }
  }
  emit();
}

export function getDebugEntries(): DebugEntry[] {
  return entries;
}

export function clearDebugLog(): void {
  entries = [];
  emit();
}

export function subscribeDebug(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setConsoleEcho(on: boolean): void {
  consoleEcho = on;
}

export function getConsoleEcho(): boolean {
  return consoleEcho;
}
