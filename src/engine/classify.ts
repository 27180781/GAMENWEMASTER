/**
 * מסווגים (SPEC סעיפים 3.5 + 4):
 * - classifySubjectSlide: זיהוי "שקופיות קסם" לפי תבנית התוכן של que.
 * - classifyMediaUrl: זיהוי סוג מדיה לפי ה-URL בלבד — assets[].type לא אמין
 *   (סרטוני YouTube רשומים שם כ-"image").
 */

export type SubjectSlideKind = 'dynamic-image' | 'send-data' | 'plain';

export type MediaKind = 'youtube' | 'image' | 'video' | 'audio' | 'unknown';

/** תבנית שקופית תמונה דינמית: שורה ראשונה "image_URL" ואחריה URL. */
const DYNAMIC_IMAGE_PATTERN = /^image_URL\s*\r?\n\s*(https?:\/\/\S+)/;

/**
 * זיהוי שקופיות פקודה מבין שקופיות ה-subject.
 * כל שאר השקופיות (כולל "סגרו את הכרטיסיה" וכדומה) הן טקסט לתצוגה בלבד.
 */
export function classifySubjectSlide(que: string): SubjectSlideKind {
  if (DYNAMIC_IMAGE_PATTERN.test(que)) return 'dynamic-image';
  if (que.trim() === 'Send_data') return 'send-data';
  return 'plain';
}

/**
 * חילוץ ה-URL משקופית תמונה דינמית, עם החלפת {{GAMA_ID}} ב-id שסופק.
 * מחזיר null אם השקופית אינה dynamic-image.
 */
export function extractDynamicImageUrl(que: string, gamaId: string): string | null {
  const match = DYNAMIC_IMAGE_PATTERN.exec(que);
  if (!match || match[1] === undefined) return null;
  return match[1].replaceAll('{{GAMA_ID}}', gamaId);
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac']);

/** זיהוי סוג מדיה לפי ה-URL בלבד. */
export function classifyMediaUrl(src: string): MediaKind {
  const url = src.trim();
  if (url.length === 0) return 'unknown';

  if (/(?:youtube\.com\/embed\/|youtube\.com\/watch|youtu\.be\/)/i.test(url)) {
    return 'youtube';
  }

  // סיומת הקובץ — בלי query string ו-hash
  const path = url.split(/[?#]/, 1)[0] ?? url;
  const lastSegment = path.split('/').pop() ?? '';
  const dotIndex = lastSegment.lastIndexOf('.');
  if (dotIndex === -1) return 'unknown';
  const ext = lastSegment.slice(dotIndex + 1).toLowerCase();

  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  return 'unknown';
}
