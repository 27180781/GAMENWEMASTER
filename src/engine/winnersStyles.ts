/**
 * סגנונות מסך המנצחים (setting.winnersStyle).
 *
 * המסך כולו בקוד, בלי וידאו: הבמה, האורות, הקונפטי והצלילים נגזרים מצבעי המשחק
 * (mainColor / secondaryColor), והוא מתאים את עצמו למספר המנצחים (1–5). החשיפה
 * ממקום אחרון לראשון; המקום הראשון מקבל תופים ומתח, ובו הצבעים מתחלפים כמו בתשובה
 * נכונה. setting.winnersMedia נשאר בקובץ רק כדי שמנועים ישנים ימשיכו לקרוא אותו:
 * המסך הזה מתעלם ממנו.
 *
 * הכללים ב-src/render/winners/. ערך חסר או לא מוכר = 'stage' («הבמה»).
 */

export const WINNERS_STYLES = ['stage', 'cards', 'medals'] as const;
export type WinnersStyle = (typeof WINNERS_STYLES)[number];

export const WINNERS_STYLE_LABELS: Record<WinnersStyle, string> = {
  stage: 'הבמה',
  cards: 'קלפי האלופים',
  medals: 'טקס המדליות',
};

/** ערך חסר/לא מוכר (כולל סגנונות שעוד לא נבנו במנוע הזה) = 'stage'. */
export function normalizeWinnersStyle(value: unknown): WinnersStyle {
  return typeof value === 'string' && (WINNERS_STYLES as readonly string[]).includes(value)
    ? (value as WinnersStyle)
    : 'stage';
}

/** כמה מנצחים מוצגים במסך לכל היותר (הבונה מתיר 1–5 ב-multiWinners). */
export const WINNERS_MAX = 5;

/** כמה מקומות המסך מציג בפועל: multiWinners, ולא יותר משחקנים עם ניקוד ומ-WINNERS_MAX. */
export function winnersShownCount(available: number): number {
  return Math.max(0, Math.min(available, WINNERS_MAX));
}

/**
 * אחרי חשיפת המקום הראשון, רווח שמגיע מהר מדי לא עובר עדיין למסך הניקוד: התיפוף
 * (2 שניות) והחבטה שאחריו לא נקטעים בלחיצה כפולה.
 */
export const WINNERS_CHAMPION_GUARD_MS = 2500;

/**
 * מתי הקריין מכריז על המקום הראשון, מהלחיצה שחשפה אותו. המסך מתופף 2 שניות (SUSPENSE)
 * ורק אז מעלה את השם, עם חבטה ומצלתיים. הקריין שותק בזמן התיפוף (בלי «רולאדת תופים» מעל
 * התופים של המסך), ונכנס קצת אחרי החבטה: השם כבר על המסך, והמילה הראשונה שלו לא נבלעת בה.
 */
export const WINNERS_CHAMPION_SPEAK_MS = 2400;
