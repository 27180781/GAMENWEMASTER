/**
 * טעינת משחק אופליין מקובץ ZIP (SPEC סעיף 8 — מצב אופליין):
 * ה-ZIP מכיל קובץ `data.json` (המשחק, עם נתיבי מדיה יחסיים) ותיקיית נכסים
 * (למשל `Assets/`). כל נתיב יחסי ממופה לקובץ שבתוך ה-ZIP ומומר ל-Blob URL,
 * כך שהמשחק מתנגן לגמרי אופליין. סוג המדיה של כל blob נרשם ב-classify.
 */

import JSZip from 'jszip';
import {
  classifyMediaUrl,
  parseGameFileLenient,
  registerMediaKind,
  type DroppedSlide,
  type GameFile,
  type Slide,
} from '../engine/index.ts';
import { canStreamMedia, desktopMediaExtract } from './clickerBridge.ts';
import type { MediaIssue } from './mediaCheck.ts';
import { mediaFields } from './mediaFields.ts';

/** אפשרויות טעינה. */
export interface ZipLoadOptions {
  /**
   * מצב EXE: חילוץ המדיה לדיסק וזרימה ממנה (‏trivia-media://) במקום להחזיק את
   * כולה כ-Blob בזיכרון. no-op בדפדפן (אין גשר) — נופל חזרה ל-Blob.
   */
  stream?: boolean;
}

export interface LoadedZipGame {
  game: GameFile;
  /** משחרר את כל ה-Blob URLs שנוצרו (לקריאה כשעוזבים את המשחק). */
  revoke: () => void;
  /** נכסים שהוזכרו ב-data.json אך חסרים בתוך ה-ZIP. */
  missing: MediaIssue[];
  /** שקופיות פגומות שהושמטו בטעינה (ריק = הכול תקין). */
  dropped: DroppedSlide[];
}

/** האם ה-src הוא נתיב יחסי לנכס בתוך ה-ZIP (ולא URL מוחלט / youtube / blob). */
export function isRelativeAsset(src: string): boolean {
  const s = src.trim();
  if (s === '') return false;
  if (/^(https?:|blob:|data:|file:|trivia-media:)/i.test(s)) return false;
  if (classifyMediaUrl(s) === 'youtube') return false;
  return true;
}

// כל שדות המדיה (קריאה+כתיבה) מגיעים מההולך המשותף — ראו mediaFields.ts.

/** dirname פשוט לנתיב בתוך ZIP (קדימה-סלאש בלבד). */
function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i + 1);
}

/** נרמול נתיב: הסרת `./`, מעבר \\ ל-/, וקיפול `..`. */
function normalizePath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/** ה-MIME לפי סיומת (מספיק כדי שהדפדפן ינגן blob). */
function mimeForExtension(ext: string): string {
  const map: Record<string, string> = {
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp',
  };
  return map[ext.toLowerCase()] ?? 'application/octet-stream';
}

function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? '';
  const i = base.lastIndexOf('.');
  return i === -1 ? '' : base.slice(i + 1);
}

/** בניית כתובת trivia-media:// לנתיב שחולץ (כל מקטע מקודד בנפרד). */
function mediaUrl(cacheKey: string, name: string): string {
  const rel = normalizePath(name)
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `trivia-media://${cacheKey}/${rel}`;
}

/**
 * טעינת משחק שכבר חולץ לדיסק ע"י תהליך ה-main (טעינה אוטומטית ב-EXE): מקבלים
 * רק את `data.json` ואת רשימת שמות הקבצים, ולכן בייטי ה-ZIP (שיכולים להיות
 * גיגה-בייטים) אינם עוברים בצינור ואינם מועתקים לזיכרון ה-renderer כלל.
 * המדיה מוגשת מהדיסק בזרימה, בדיוק כמו במסלול ה-stream הרגיל.
 */
export function loadGameFromExtracted(src: {
  cacheKey: string;
  dataPath: string;
  dataJson: string;
  names: string[];
}): LoadedZipGame {
  let data: unknown;
  try {
    data = JSON.parse(src.dataJson);
  } catch (e) {
    throw new Error(`data.json אינו JSON תקין: ${(e as Error).message}`);
  }
  const { game, dropped } = parseGameFileLenient(data);

  const baseDir = dirOf(src.dataPath);
  // אינדקסים לחיפוש: לפי נתיב מלא (ללא רישיות) ולפי שם קובץ בלבד (נפילה אחורה).
  const byPath = new Map<string, string>();
  const byBase = new Map<string, string>();
  for (const name of src.names) {
    byPath.set(normalizePath(name).toLowerCase(), name);
    const base = (name.split('/').pop() ?? '').toLowerCase();
    if (base !== '' && !byBase.has(base)) byBase.set(base, name);
  }

  const cache = new Map<string, string>();
  const resolve = (relSrc: string): string | null => {
    const resolvedPath = normalizePath(baseDir + relSrc);
    const cached = cache.get(resolvedPath);
    if (cached !== undefined) return cached;
    const match =
      byPath.get(resolvedPath.toLowerCase()) ??
      byBase.get((relSrc.split('/').pop() ?? '').toLowerCase());
    if (match === undefined) return null;
    const url = mediaUrl(src.cacheKey, match);
    registerMediaKind(url, classifyMediaUrl(relSrc));
    cache.set(resolvedPath, url);
    return url;
  };

  const missing: MediaIssue[] = [];
  for (const field of mediaFields(game)) {
    const rel = field.get();
    if (!isRelativeAsset(rel)) continue;
    const url = resolve(rel);
    if (url !== null) field.set(url);
    else missing.push({ src: rel, context: field.label, reason: 'missing' });
  }

  // אין Blob URLs במסלול הזה — אין מה לשחרר.
  return { game, revoke: () => {}, missing, dropped };
}

/** טעינת ZIP והמרתו למשחק. ב-EXE (stream) המדיה נזרמת מהדיסק; אחרת Blob בזיכרון. */
export async function loadGameFromZip(
  input: ArrayBuffer | Uint8Array | Blob,
  opts: ZipLoadOptions = {},
): Promise<LoadedZipGame> {
  const zipBytes =
    input instanceof Uint8Array
      ? input
      : input instanceof Blob
        ? new Uint8Array(await input.arrayBuffer())
        : new Uint8Array(input);
  const zip = await JSZip.loadAsync(zipBytes);

  // מצב זרימה (EXE): מחלצים את כל המדיה לדיסק פעם אחת ומקבלים מזהה מטמון;
  // כל נכס יקבל כתובת trivia-media:// שנטענת לפי דרישה — לא לזיכרון. אם החילוץ
  // נכשל או אין גשר (דפדפן) — cacheKey יישאר null ונופלים חזרה ל-Blob.
  let cacheKey: string | null = null;
  if (opts.stream === true && canStreamMedia()) {
    const res = await desktopMediaExtract(zipBytes);
    cacheKey = res?.cacheKey ?? null;
  }

  // איתור data.json (בכל עומק, ללא תלות ברישיות)
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  const dataEntry =
    entries.find((f) => (f.name.split('/').pop() ?? '').toLowerCase() === 'data.json') ??
    entries.find((f) => f.name.toLowerCase().endsWith('.json'));
  if (!dataEntry) {
    throw new Error('לא נמצא קובץ data.json בתוך ה-ZIP');
  }

  const rawJson = await dataEntry.async('string');
  let data: unknown;
  try {
    data = JSON.parse(rawJson);
  } catch (e) {
    throw new Error(`data.json אינו JSON תקין: ${(e as Error).message}`);
  }
  const { game, dropped } = parseGameFileLenient(data);

  // מיפוי נתיבים יחסיים → Blob URLs (עם cache לפי נתיב, ורישום סוג המדיה)
  const baseDir = dirOf(dataEntry.name);
  const created: string[] = [];
  const cache = new Map<string, string>();

  const resolve = async (relSrc: string): Promise<string | null> => {
    const resolvedPath = normalizePath(baseDir + relSrc);
    const cached = cache.get(resolvedPath);
    if (cached) return cached;

    const entry =
      zip.file(resolvedPath) ??
      entries.find((f) => f.name.toLowerCase() === resolvedPath.toLowerCase()) ??
      // נפילה אחורה: התאמה לפי שם הקובץ בלבד (למקרה של תיקיית עטיפה)
      entries.find(
        (f) =>
          (f.name.split('/').pop() ?? '').toLowerCase() ===
          (relSrc.split('/').pop() ?? '').toLowerCase(),
      );
    if (!entry) return null;

    // מצב זרימה: הקובץ כבר חולץ לדיסק — מחזירים כתובת שמצביעה אליו (נטענת לפי
    // דרישה, בלי לקרוא בייטים לזיכרון). הנתיב זהה לזה שבו ה-main חילץ (safeRelPath).
    if (cacheKey !== null) {
      const url = mediaUrl(cacheKey, entry.name);
      registerMediaKind(url, classifyMediaUrl(relSrc));
      cache.set(resolvedPath, url);
      return url;
    }

    const bytes = await entry.async('uint8array');
    const ext = extensionOf(entry.name);
    const blob = new Blob([bytes], { type: mimeForExtension(ext) });
    const url = URL.createObjectURL(blob);
    created.push(url);
    registerMediaKind(url, classifyMediaUrl(relSrc));
    cache.set(resolvedPath, url);
    return url;
  };

  const missing: MediaIssue[] = [];
  for (const field of mediaFields(game)) {
    const src = field.get();
    if (!isRelativeAsset(src)) continue;
    const url = await resolve(src);
    if (url !== null) field.set(url);
    // אם הנכס חסר ב-ZIP — משאירים את הנתיב היחסי ומדווחים עליו כחסר
    else missing.push({ src, context: field.label, reason: 'missing' });
  }

  return {
    game,
    revoke: () => {
      for (const url of created) URL.revokeObjectURL(url);
    },
    missing,
    dropped,
  };
}

export type { Slide };
