/**
 * ההולך היחיד על כל שדות המדיה של קובץ משחק — המקור המשותף לשלושת הצרכנים:
 *   • mediaLoader.orderedMediaUrls — טעינה מוקדמת לפי סדר עדיפות.
 *   • mediaCheck.collectMediaRefs — בדיקת קישורים שבורים בטעינה.
 *   • zipLoader — מיפוי נתיבים יחסיים ל-Blob URLs (קריאה+כתיבה).
 * שדה מדיה חדש שמתווסף למשחק מתווסף כאן פעם אחת ומכוסה בשלושתם.
 *
 * הסדר קבוע והוא גם סדר העדיפות לטעינה: מדיית הלובי (פתיחה/לוגו/רקע שאלות) →
 * שקופיות לפי סדרן → מסכי הזוכים → סאונדים.
 */

import type { GameFile } from '../engine/index.ts';

export interface MediaField {
  get: () => string;
  set: (value: string) => void;
  /** תיאור היכן המדיה משמשת — לדיווחי בדיקה/נכסים חסרים. */
  label: string;
  /**
   * `'narration'` = קטע קריינות. לפי ENGINE-narration.md הקטעים **אינם** חלק
   * ממדיית המשחק: הם לא נספרים ב-`assets`, לא נטענים מראש בטעינה החוסמת ולא
   * נבדקים בבדיקת הקישורים השבורים — קטע שלא נטען מדולג בשקט (`NarrationPlayer`
   * טוען אותם בעצמו ברקע). הצרכן היחיד שכן רואה אותם הוא `zipLoader`, שממפה
   * להם נתיבים יחסיים בחבילה האופליינית.
   */
  kind?: 'narration';
}

export const SOUND_LABELS: Record<string, string> = {
  playersConnectingMediaSound: 'סאונד התחברות',
  showQuestionMediaSound: 'סאונד הצגת שאלה',
  winnersMediaSound: 'סאונד זוכים',
  winnersListMediaSound: 'סאונד טבלת זוכים',
  genericMediaSound: 'סאונד כללי',
  timerMediaSound: 'סאונד טיימר',
  inShowAnsMediaSound: 'סאונד חשיפת תשובה',
};

export function mediaFields(game: GameFile): MediaField[] {
  const fields: MediaField[] = [];
  const push = (obj: { src: string }, label: string) =>
    fields.push({ get: () => obj.src, set: (v) => (obj.src = v), label });

  const s = game.setting;
  // מדיית הלובי — נטענת ראשונה (המסך הראשון שהקהל רואה)
  push(s.gameMedia, 'מדיית פתיחה');
  push(s.logo, 'לוגו');
  push(s.triviaMedia, 'רקע שאלות');

  game.questions.forEach((slide, i) => {
    const n = `שקופית ${i + 1}`;
    push(slide.openMedia, `${n} · מדיית פתיחה`);
    fields.push({
      get: () => slide.question.src,
      set: (v) => (slide.question.src = v),
      label: `${n} · תמונת שאלה`,
    });
    push(slide.backgroundMedia, `${n} · רקע`);
    push(slide.setting.slidBackgroundMedia, `${n} · רקע שקופית`);
    push(slide.endMedia, `${n} · מדיית סיום`);
    // ans_images: כל תשובה היא נתיב תמונה
    if (slide.type === 'ans_images') {
      slide.question.answers.forEach((answer, j) => {
        fields.push({
          get: () => answer.ans,
          set: (v) => (answer.ans = v),
          label: `${n} · תמונת תשובה ${j + 1}`,
        });
      });
    }
  });

  push(s.winnersMedia, 'רקע זוכים');
  push(s.winnersListMedia, 'רקע טבלת זוכים');

  for (const [key, channel] of Object.entries(s.sound)) {
    fields.push({
      get: () => channel.src ?? '',
      set: (v) => (channel.src = v),
      label: SOUND_LABELS[key] ?? `סאונד (${key})`,
    });
  }

  // קטעי הקריינות — אחרונים ומסומנים ב-kind: 'narration'. הם כאן **רק** כדי
  // שמיפוי הנתיבים של החבילה האופליינית יכסה אותם; הטעינה המוקדמת החוסמת
  // ובדיקת הקישורים מדלגות עליהם (ראו MediaField.kind).
  const narration = s.narration;
  if (narration) {
    const bank = narration.bank;
    for (const key of Object.keys(bank)) {
      fields.push({
        get: () => bank[key] ?? '',
        set: (v) => (bank[key] = v),
        label: `קריינות · בנק · ${key}`,
        kind: 'narration',
      });
    }
  }
  game.questions.forEach((slide, i) => {
    const nar = slide.narration;
    if (!nar) return;
    const n = `שקופית ${i + 1} · קריינות`;
    fields.push({
      get: () => nar.question ?? '',
      set: (v) => (nar.question = v),
      label: `${n} · שאלה`,
      kind: 'narration',
    });
    nar.answers.forEach((_, j) => {
      fields.push({
        get: () => nar.answers[j] ?? '',
        set: (v) => (nar.answers[j] = v),
        label: `${n} · תשובה ${j + 1}`,
        kind: 'narration',
      });
    });
    fields.push({
      get: () => nar.correct ?? '',
      set: (v) => (nar.correct = v),
      label: `${n} · תשובה נכונה`,
      kind: 'narration',
    });
  });
  return fields;
}
