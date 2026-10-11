/**
 * מתי התחילה המדיה החוסמת שמוצגת במסך הראשי — כדי שצופה שנכנס באמצע יקפוץ
 * לאותה נקודה (MediaPlayer, MediaClockContext).
 *
 * המדיה עומדת מתחת לשכבה חוסמת (MediaPauseContext), ולכן הזמן שבו עמדה לא
 * נספר: כשהיא ממשיכה, ההתחלה זזה קדימה במשך העצירה. בלי זה צופה שנכנס אחרי
 * טבלת מובילים, שמתחתיה סרטון חיכה בפריים הראשון, היה קופץ קדימה בכל הזמן
 * שהטבלה הייתה פתוחה. בזמן העצירה עצמה ההתחלה לא משתנה, כדי שלא יישלח עדכון
 * לצופים בכל רגע.
 */

export interface MediaClock {
  /** המדיה הנוכחית (שקופית + סוג מדיה), null = אין מדיה חוסמת. */
  key: string | null;
  /** מתי התחילה, בשעון המנחה, בלי העצירות שכבר נגמרו. */
  at: number | null;
  /** מתי נעצרה מתחת לשכבה (null = רצה). */
  heldAt: number | null;
}

export const NO_MEDIA: MediaClock = { key: null, at: null, heldAt: null };

/** השעון אחרי רינדור של המסך הראשי: מדיה אחרת, או עצירה/המשך של אותה מדיה. */
export function nextMediaClock(
  prev: MediaClock,
  key: string | null,
  held: boolean,
  now: number,
): MediaClock {
  if (prev.key !== key)
    return key === null ? NO_MEDIA : { key, at: now, heldAt: held ? now : null };
  if (prev.at === null) return prev;
  if (held && prev.heldAt === null) return { ...prev, heldAt: now };
  if (!held && prev.heldAt !== null)
    return { ...prev, at: prev.at + (now - prev.heldAt), heldAt: null };
  return prev;
}
