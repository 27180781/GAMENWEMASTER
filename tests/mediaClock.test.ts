/**
 * שעון המדיה של מסך הצפייה: מתי התחילה המדיה החוסמת במסך הראשי, בלי הזמן
 * שבו עמדה מתחת לשכבה חוסמת — כדי שצופה שנכנס באמצע יקפוץ לנקודה הנכונה.
 */

import { describe, expect, it } from 'vitest';
import { NO_MEDIA, nextMediaClock } from '../src/live/mediaClock.ts';

describe('nextMediaClock', () => {
  it('מדיה חדשה מתחילה עכשיו', () => {
    expect(nextMediaClock(NO_MEDIA, 's1:open', false, 1000)).toEqual({
      key: 's1:open',
      at: 1000,
      heldAt: null,
    });
  });

  it('סוף המדיה מאפס', () => {
    const clock = nextMediaClock(NO_MEDIA, 's1:open', false, 1000);
    expect(nextMediaClock(clock, null, false, 5000)).toEqual(NO_MEDIA);
  });

  it('עצירה מתחת לשכבה לא מזיזה את ההתחלה עד שהמדיה ממשיכה, ואז מזיזה אותה במשך העצירה', () => {
    let clock = nextMediaClock(NO_MEDIA, 's1:open', false, 1000);
    clock = nextMediaClock(clock, 's1:open', true, 4000); // שכבה נפתחה אחרי 3 שניות
    expect(clock.at).toBe(1000);
    clock = nextMediaClock(clock, 's1:open', true, 9000); // עדיין פתוחה — בלי שינוי
    expect(clock.at).toBe(1000);
    clock = nextMediaClock(clock, 's1:open', false, 14000); // נסגרה אחרי 10 שניות
    expect(clock).toEqual({ key: 's1:open', at: 11000, heldAt: null });
    // 3 שניות ניגון לפני השכבה + 2 אחריה = 5 שניות מההתחלה
    expect(16000 - clock.at!).toBe(5000);
  });

  it('מדיה שעלתה מתחת לשכבה (טבלה אוטומטית) מתחילה כשהשכבה יורדת', () => {
    let clock = nextMediaClock(NO_MEDIA, 's3:open', true, 2000);
    expect(clock).toEqual({ key: 's3:open', at: 2000, heldAt: 2000 });
    clock = nextMediaClock(clock, 's3:open', false, 30000);
    expect(clock.at).toBe(30000);
  });

  it('אותה מדיה, אותו מצב — אותו אובייקט (בלי עדכון לצופים)', () => {
    const clock = nextMediaClock(NO_MEDIA, 's1:open', false, 1000);
    expect(nextMediaClock(clock, 's1:open', false, 2000)).toBe(clock);
  });

  it('שכבה בלי מדיה לא מתחילה שעון', () => {
    expect(nextMediaClock(NO_MEDIA, null, true, 1000)).toBe(NO_MEDIA);
  });
});
