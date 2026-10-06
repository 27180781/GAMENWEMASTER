/**
 * "התמונה מתבהרת" במסך הצפייה — בלי לשלוח את התמונה החדה לפני הזמן.
 *
 * במסך הראשי התמונה המקורית מוצגת עם טשטוש CSS שהולך ונעלם. אילו מסך הצפייה
 * היה מקבל את אותה כתובת, צופה (שהוא גם משתתף) היה יכול לפתוח אותה ולראות את
 * התשובה. לכן הוא מקבל עותק מוקטן — ברזולוציה שאינה מוסיפה פרט מעבר למה שהטשטוש
 * הנוכחי ממילא מסתיר — ועליו הוא מפעיל את אותו טשטוש. ככל שהתמונה מתבהרת
 * נשלח עותק גדול יותר; התמונה המקורית נשלחת רק כשההצבעה נסגרת.
 *
 * העותקים נוצרים ב-canvas מהתמונה שכבר נטענה. תמונה משרת שאינו מתיר קריאה
 * (CORS) לא ניתנת להקטנה — אז מסך הצפייה מקבל מקום ריק עד החשיפה.
 */

/** רוחבי העותקים (px). הגדול ביותר משמש גם כשהטשטוש כמעט נעלם. */
export const THUMB_WIDTHS = [16, 24, 32, 48, 64, 96, 128, 192, 256, 384] as const;

/** כמה רחבה התמונה על הבמה (1920) לכל היותר — לחישוב הרזולוציה הדרושה. */
const DISPLAY_WIDTH = 960;

/** הרוחב הקטן ביותר שמספיק לטשטוש הנתון: פרט קטן מחצי רדיוס הטשטוש ממילא לא נראה. */
export function thumbWidthFor(blur: number): number {
  const needed = blur <= 0 ? Number.POSITIVE_INFINITY : (DISPLAY_WIDTH * 2) / blur;
  return THUMB_WIDTHS.find((w) => w >= needed) ?? THUMB_WIDTHS[THUMB_WIDTHS.length - 1]!;
}

type Entry =
  { state: 'loading' } | { state: 'ready'; byWidth: Map<number, string> } | { state: 'failed' };

export class RevealThumbs {
  private readonly entries = new Map<string, Entry>();
  private readonly onReady: () => void;

  constructor(onReady: () => void) {
    this.onReady = onReady;
  }

  /**
   * העותק לטשטוש הנוכחי, או null כשאין (עדיין נטען, או שאי אפשר להקטין) —
   * ואז נשלח מקום ריק.
   */
  get(src: string, blur: number): string | null {
    const entry = this.entries.get(src);
    if (entry === undefined) {
      this.prepare(src);
      return null;
    }
    if (entry.state !== 'ready') return null;
    return entry.byWidth.get(thumbWidthFor(blur)) ?? null;
  }

  private prepare(src: string): void {
    if (typeof document === 'undefined' || typeof Image === 'undefined') {
      this.entries.set(src, { state: 'failed' });
      return;
    }
    // שקופית אחת בכל רגע — מנקים עותקים של שקופיות קודמות.
    if (this.entries.size > 4) this.entries.clear();
    this.entries.set(src, { state: 'loading' });
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const byWidth = new Map<number, string>();
        const ratio = img.naturalHeight / Math.max(1, img.naturalWidth);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx === null) throw new Error('no canvas');
        for (const width of THUMB_WIDTHS) {
          const w = Math.min(width, img.naturalWidth);
          canvas.width = w;
          canvas.height = Math.max(1, Math.round(w * ratio));
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          byWidth.set(width, canvas.toDataURL('image/webp', 0.75));
        }
        this.entries.set(src, { state: 'ready', byWidth });
      } catch {
        // canvas "מוכתם" (השרת לא התיר קריאה) — אין עותק.
        this.entries.set(src, { state: 'failed' });
      }
      this.onReady();
    };
    img.onerror = () => {
      this.entries.set(src, { state: 'failed' });
    };
    img.src = src;
  }
}
