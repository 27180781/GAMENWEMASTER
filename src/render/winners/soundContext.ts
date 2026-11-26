/**
 * איפה מסך המנצחים משמיע את האפקטים שלו. GameHost נותן את ה-AudioManager של
 * המשחק, ומסך הצפייה את שלו כשהצופה הפעיל צליל. בלי ספק (גלריה, צילומי מסך)
 * המסך שקט.
 */

import { createContext } from 'react';
import type { SoundPlan } from '../../app/winnersSynth.ts';

export interface WinnersSoundSink {
  /**
   * מסך המנצחים הסופי מוצג: צליל המנצחים של המשחק (ערוץ 'winners') מתנגן כמוזיקת
   * רקע, מעט נמוך יותר, ומתכופף לפי התוכנית של כל חשיפה.
   */
  setWinnersScreen(active: boolean): void;
  /** בונה מראש את מאגרי השמע (מחיאות כפיים, רעש), כדי שהחשיפה לא תיתקע. */
  prepareWinnersSound(): void;
  /** מתזמן תוכנית צלילים, delay שניות מעכשיו. */
  playWinnersSound(plan: SoundPlan, delay?: number): void;
  /** עוצר (בדעיכה קצרה) את כל האפקטים, גם כאלה שתוזמנו להמשך. */
  stopWinnersSound(): void;
}

export const WinnersSoundContext = createContext<WinnersSoundSink | null>(null);
