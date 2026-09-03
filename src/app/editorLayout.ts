/**
 * סידור עמודת "הגדרות המשחק" בעורך המקומי, כך שתהיה זהה למערכת יצירת המשחקים.
 *
 * הבעיה שזה פותר: עד כה העמודה נגזרה ישירות ממבנה ה-JSON, ולכן היא הציגה את
 * הסכימה ולא את המשחק — קבוצות בשם `nextSlide`, ושדה `limit` ("רישיון ומגבלות")
 * שהוא נתון פנימי של המערכת ולא משהו שמחבר משחק אמור לגעת בו.
 *
 * לכן הסידור כאן **מוצהר**: שש קבוצות בשמות שהמחבר מכיר, בדיוק כמו בעורך
 * המקוון. אבל לא ויתרנו על הגזירה האוטומטית — שדה בסכימה שאינו משויך לאף
 * קבוצה ואינו מוסתר במפורש נאסף ל"שדות נוספים", כך שגם שדה שיתווסף בעתיד
 * יישאר נגיש לעריכה במקום להיעלם בשקט. `unassigned` הוא בדיוק החישוב הזה.
 *
 * טהור (בלי React) כדי שיהיה ניתן לבדיקה: בדיקה מוודאת שכל שדה בסכימה או
 * משויך, או מוסתר במודע — ולא נופל בין הכיסאות.
 */

import type { FieldNode } from './schemaForm.ts';

export interface SettingsSection {
  /** מזהה יציב (גם למפתח React וגם לבדיקות). */
  id: string;
  title: string;
  icon: string;
  /** שדות מתוך `game.setting`, לפי הסדר שבו יוצגו. */
  keys: string[];
}

/**
 * שדות שאינם מוצגים בעורך — **בכוונה**.
 *
 * `limit` הוא הרישיון והמגבלות של המשחק: נתון שהמערכת קובעת, לא המחבר. הוא
 * נשמר בקובץ כרגיל (העורך שומר את האובייקט המלא) — פשוט אין לו פקד.
 */
export const HIDDEN_SETTINGS = ['limit'];

/**
 * הקבוצות, בסדר ובשמות של העורך המקוון. `titleThroughoutGame` ו-`logo` יושבים
 * ב"כללי" יחד עם שם המשחק, שנערך בסרגל העליון.
 */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: 'general',
    title: 'כללי',
    icon: '⚙️',
    keys: ['logo', 'titleThroughoutGame', 'gameType', 'gameTypeSettings'],
  },
  {
    id: 'design',
    title: 'עיצוב ומדיה',
    icon: '🎨',
    keys: [
      'mainColor',
      'secondaryColor',
      'gameMedia',
      'triviaMedia',
      'winnersMedia',
      'winnersListMedia',
      'sound',
    ],
  },
  {
    id: 'flow',
    title: 'מהלך המשחק',
    icon: '▶️',
    keys: ['allowChangeVote', 'autoTransition'],
  },
  {
    id: 'scoring',
    title: 'ניקוד ומנצחים',
    icon: '🏆',
    keys: ['multiWinners', 'winnersListCount', 'showWinnersListAfter'],
  },
  {
    id: 'advanced',
    title: 'הגדרות מתקדמות',
    icon: '🎛',
    keys: ['ansIsNumber'],
  },
];

/**
 * שדות בסכימה שאינם משויכים לאף קבוצה ואינם מוסתרים — הרשת שמונעת ששדה עתידי
 * ייעלם מהעורך. בדרך כלל ריק, ואז קבוצת "שדות נוספים" אינה מוצגת כלל.
 */
export function unassignedSettings(nodes: FieldNode[]): FieldNode[] {
  const claimed = new Set<string>([...HIDDEN_SETTINGS]);
  for (const section of SETTINGS_SECTIONS) for (const key of section.keys) claimed.add(key);
  return nodes.filter((n) => !claimed.has(n.key));
}

/** שדות הקבוצה לפי הסדר המוצהר. שדה שאינו בסכימה מדולג בשקט. */
export function sectionNodes(nodes: FieldNode[], section: SettingsSection): FieldNode[] {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  return section.keys.flatMap((key) => {
    const node = byKey.get(key);
    return node === undefined ? [] : [node];
  });
}
