/**
 * ערכות נושא חזותיות (setting.visualTheme).
 *
 * ערכה משנה רק מראה: צורה, מסגרת, מרקם, גופן, צל ותנועה. היא לעולם לא משנה גדלים,
 * מיקומים או ריפוד, ולכן תקציבי הגובה של FitText ומיקומי השמות על הפודיום
 * (PODIUM_POS) תקפים בכל ערכה. הצבעים נשארים של המשחק: mainColor הוא מילוי תיבות
 * השאלה והתשובות, secondaryColor הוא הטקסט עליהן, ובתשובה הנכונה הם מתחלפים.
 * הרקע האחורי מגיע תמיד ממדיית המשחק; רקע הבמה של הערכה הוא רק גיבוי כשאין מדיה.
 *
 * הכללים עצמם ב-src/render/themes.css (שלוש הראשונות) וב-src/render/themes/<id>.css, תחת ‎.game-root[data-visual-theme="…"]‎. 'classic' אינו
 * מקבל אף כלל — הוא המראה של styles.css כפי שהוא.
 *
 * 'neondraw' («ניאון מצטייר») היא החריגה היחידה בכלל המילוי: הקפסולות שלה זכוכית
 * שקופה (גוון עדין של mainColor) שהרקע נראה דרכה, וקו ניאון כחול-מג'נטה מצטייר
 * סביבן מ-0 ל-100% בכל חשיפה (NeonRing). הגופן Kanuba — הגופן של חוויה בקליק.
 */

export const VISUAL_THEMES = ['classic', 'studio', 'glass', 'scroll', 'neon', 'gala', 'comic', 'chalk', 'led', 'neondraw'] as const;
export type VisualTheme = (typeof VISUAL_THEMES)[number];

export const VISUAL_THEME_LABELS: Record<VisualTheme, string> = {
  classic: 'קלאסי',
  studio: 'אולפן',
  glass: 'זכוכית',
  scroll: 'מגילה',
  neon: 'ניאון',
  gala: 'ערב גאלה',
  comic: 'קומיקס',
  chalk: 'לוח גיר',
  led: 'לוח תוצאות',
  neondraw: 'ניאון מצטייר',
};

/** ערך חסר/לא מוכר (כולל ערכות שעוד לא נבנו במנוע הזה) = 'classic'. */
export function normalizeVisualTheme(value: unknown): VisualTheme {
  return typeof value === 'string' && (VISUAL_THEMES as readonly string[]).includes(value)
    ? (value as VisualTheme)
    : 'classic';
}
