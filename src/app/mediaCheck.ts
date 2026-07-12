/**
 * בדיקת מדיה בטעינת המשחק — מזהה קישורים שבורים / מדיה חסרה ומתריע.
 *
 * אונליין: כל כתובת מדיה נבדקת בפועל (טעינת Image/video/audio) — כישלון טעינה
 *          מסומן כשבור.
 * אופליין: הבדיקה נעשית ב-zipLoader (נכס יחסי שאינו קיים בתיקיית ה-ZIP), ומגיע
 *          לכאן כרשימת "חסרים".
 *
 * `collectMediaRefs` טהור (נבדק ביחידה); הבדיקה בפועל דורשת DOM ולכן מוגנת.
 */

import { classifyMediaUrl, type GameFile, type MediaKind } from '../engine/index.ts';

export interface MediaRef {
  src: string;
  /** היכן המדיה משמשת (לתצוגה בהתראה). */
  context: string;
  kind: MediaKind;
}

export interface MediaIssue {
  src: string;
  context: string;
  reason: 'missing' | 'broken';
}

const SOUND_LABELS: Record<string, string> = {
  playersConnectingMediaSound: 'סאונד התחברות',
  showQuestionMediaSound: 'סאונד הצגת שאלה',
  winnersMediaSound: 'סאונד זוכים',
  winnersListMediaSound: 'סאונד טבלת זוכים',
  genericMediaSound: 'סאונד כללי',
  timerMediaSound: 'סאונד טיימר',
  inShowAnsMediaSound: 'סאונד חשיפת תשובה',
};

/** אוסף את כל הפניות המדיה במשחק, עם תיאור היכן הן משמשות. */
export function collectMediaRefs(game: GameFile): MediaRef[] {
  const refs: MediaRef[] = [];
  const add = (raw: string, context: string) => {
    const src = raw.trim();
    if (src !== '') refs.push({ src, context, kind: classifyMediaUrl(src) });
  };

  const s = game.setting;
  add(s.gameMedia.src, 'מדיית פתיחה');
  add(s.logo.src, 'לוגו');
  add(s.triviaMedia.src, 'רקע שאלות');
  add(s.winnersMedia.src, 'רקע זוכים');
  add(s.winnersListMedia.src, 'רקע טבלת זוכים');
  for (const [key, channel] of Object.entries(s.sound)) {
    if (channel.src) add(channel.src, SOUND_LABELS[key] ?? `סאונד (${key})`);
  }

  game.questions.forEach((slide, i) => {
    const n = `שקופית ${i + 1}`;
    add(slide.openMedia.src, `${n} · מדיית פתיחה`);
    add(slide.endMedia.src, `${n} · מדיית סיום`);
    add(slide.backgroundMedia.src, `${n} · רקע`);
    add(slide.setting.slidBackgroundMedia.src, `${n} · רקע שקופית`);
    add(slide.question.src, `${n} · תמונת שאלה`);
    if (slide.type === 'ans_images') {
      slide.question.answers.forEach((a, j) => add(a.ans, `${n} · תמונת תשובה ${j + 1}`));
    }
  });

  return refs;
}

/** בדיקת reachability עדינה (no-cors) — נכשלת רק על תקלת רשת/DNS אמיתית. */
async function isReachable(src: string): Promise<boolean> {
  try {
    await fetch(src, { method: 'GET', mode: 'no-cors', cache: 'no-store' });
    return true;
  } catch {
    return false;
  }
}

/** בודק כתובת מדיה בודדת: true = תקין/לא-חד-משמעי, false = שבור. */
function probeOne(src: string, kind: MediaKind, timeoutMs: number): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(ok);
    };
    // timeout — לא מסמנים כשבור (מדיה גדולה/רשת איטית עלולה להתעכב)
    const timer = window.setTimeout(() => finish(true), timeoutMs);

    if (kind === 'video' || kind === 'audio') {
      const el = document.createElement(kind);
      el.preload = 'metadata';
      el.onloadedmetadata = () => finish(true);
      el.onerror = () => finish(false);
      el.src = src;
      return;
    }
    // image / unknown
    const img = new Image();
    img.onload = () => finish(true);
    img.onerror = () => {
      // ל-unknown ייתכן שזה וידאו/פורמט אחר ולא באמת שבור — בדיקת רשת עדינה
      if (kind === 'unknown') void isReachable(src).then(finish);
      else finish(false);
    };
    img.src = src;
  });
}

interface ProbeOptions {
  timeoutMs?: number;
  concurrency?: number;
}

/** בודק את כל הפניות המדיה (מלבד YouTube/blob) ומחזיר את השבורות. */
export async function probeMediaRefs(
  refs: MediaRef[],
  { timeoutMs = 8000, concurrency = 8 }: ProbeOptions = {},
): Promise<MediaIssue[]> {
  const toProbe = refs.filter(
    (r) => r.kind !== 'youtube' && !r.src.startsWith('blob:') && !r.src.startsWith('data:'),
  );
  const issues: MediaIssue[] = [];
  let index = 0;
  const worker = async () => {
    while (index < toProbe.length) {
      const ref = toProbe[index++]!;
      const ok = await probeOne(ref.src, ref.kind, timeoutMs);
      if (!ok) issues.push({ src: ref.src, context: ref.context, reason: 'broken' });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, toProbe.length) }, () => worker()),
  );
  return issues;
}
