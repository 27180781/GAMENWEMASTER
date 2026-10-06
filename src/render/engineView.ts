/**
 * מה שהמסכים קוראים מהמנוע. המנוע עצמו עונה על זה, וגם המראה של מסך הצפייה
 * (src/live/mirrorEngine.ts), שבונה את אותן קריאות ממצב המסך שהתקבל ברשת —
 * כך שאותם רכיבים בדיוק מציירים את שני המסכים.
 */

import type { GameEngine } from '../engine/index.ts';

export type EngineView = Pick<
  GameEngine,
  'getState' | 'getGame' | 'getCurrentSlide' | 'getWinners'
>;
