/**
 * טעינת משחק אופליין מקובץ ZIP (SPEC סעיף 8 — מצב אופליין):
 * ה-ZIP מכיל קובץ `data.json` (המשחק, עם נתיבי מדיה יחסיים) ותיקיית נכסים
 * (למשל `Assets/`). כל נתיב יחסי ממופה לקובץ שבתוך ה-ZIP ומומר ל-Blob URL,
 * כך שהמשחק מתנגן לגמרי אופליין. סוג המדיה של כל blob נרשם ב-classify.
 */

import JSZip from 'jszip';
import {
  classifyMediaUrl,
  parseGameFile,
  registerMediaKind,
  type GameFile,
  type Slide,
} from '../engine/index.ts';

export interface LoadedZipGame {
  game: GameFile;
  /** משחרר את כל ה-Blob URLs שנוצרו (לקריאה כשעוזבים את המשחק). */
  revoke: () => void;
}

/** האם ה-src הוא נתיב יחסי לנכס בתוך ה-ZIP (ולא URL מוחלט / youtube / blob). */
export function isRelativeAsset(src: string): boolean {
  const s = src.trim();
  if (s === '') return false;
  if (/^(https?:|blob:|data:|file:)/i.test(s)) return false;
  if (classifyMediaUrl(s) === 'youtube') return false;
  return true;
}

/**
 * מחזיר accessors לכל שדות המדיה במשחק (קריאה + כתיבה), כדי למפות נתיבים
 * יחסיים בלי לשכפל את מבנה המשחק.
 */
function mediaAccessors(game: GameFile): { get: () => string; set: (v: string) => void }[] {
  const acc: { get: () => string; set: (v: string) => void }[] = [];
  const s = game.setting;
  const push = (obj: { src: string }) => acc.push({ get: () => obj.src, set: (v) => (obj.src = v) });

  push(s.gameMedia);
  push(s.logo);
  push(s.triviaMedia);
  push(s.winnersMedia);
  push(s.winnersListMedia);
  for (const channel of Object.values(s.sound)) {
    if (channel.src !== null) {
      acc.push({ get: () => channel.src ?? '', set: (v) => (channel.src = v) });
    }
  }

  for (const slide of game.questions) {
    push(slide.openMedia);
    push(slide.endMedia);
    push(slide.backgroundMedia);
    push(slide.setting.slidBackgroundMedia);
    acc.push({ get: () => slide.question.src, set: (v) => (slide.question.src = v) });
    // ans_images: כל תשובה היא נתיב תמונה
    if (slide.type === 'ans_images') {
      for (const answer of slide.question.answers) {
        acc.push({ get: () => answer.ans, set: (v) => (answer.ans = v) });
      }
    }
  }
  return acc;
}

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

/** טעינת ZIP והמרתו למשחק עם Blob URLs מקומיים. */
export async function loadGameFromZip(input: ArrayBuffer | Uint8Array | Blob): Promise<LoadedZipGame> {
  const zip = await JSZip.loadAsync(input);

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
  const game = parseGameFile(data);

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

    const bytes = await entry.async('uint8array');
    const ext = extensionOf(entry.name);
    const blob = new Blob([bytes], { type: mimeForExtension(ext) });
    const url = URL.createObjectURL(blob);
    created.push(url);
    registerMediaKind(url, classifyMediaUrl(relSrc));
    cache.set(resolvedPath, url);
    return url;
  };

  for (const field of mediaAccessors(game)) {
    const src = field.get();
    if (!isRelativeAsset(src)) continue;
    const url = await resolve(src);
    if (url !== null) field.set(url);
    // אם הנכס חסר ב-ZIP — משאירים את הנתיב היחסי (המדיה פשוט לא תיטען)
  }

  return {
    game,
    revoke: () => {
      for (const url of created) URL.revokeObjectURL(url);
    },
  };
}

export type { Slide };
