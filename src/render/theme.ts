/**
 * צבעי המשחק כ-CSS variables (SPEC סעיף 9).
 * הצבעים מגיעים כ-HEX של 6 או 8 ספרות (עם אלפא) — דפדפנים מודרניים תומכים
 * ב-#RRGGBBAA ישירות, אך אנחנו מפרקים גם ל-RGB כדי לאפשר וריאציות שקיפות.
 */

import type { GlobalSettings } from '../engine/index.ts';

export interface ThemeColors {
  /** הצבע כפי שהוא (כולל אלפא אם יש) — תקין כערך CSS. */
  main: string;
  secondary: string;
  /** רכיבי RGB בלבד ("r, g, b") לשימוש בתוך rgba() עם אלפא משתנה. */
  mainRgb: string;
  secondaryRgb: string;
}

/** מפרק צבע HEX של 6/8 ספרות לרכיבי RGB. מחזיר null על קלט לא צפוי. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-fA-F]{6})(?:[0-9a-fA-F]{2})?$/.exec(hex);
  if (!match || match[1] === undefined) return null;
  const value = parseInt(match[1], 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

export function themeColors(setting: GlobalSettings): ThemeColors {
  const main = hexToRgb(setting.mainColor);
  const secondary = hexToRgb(setting.secondaryColor);
  return {
    main: setting.mainColor,
    secondary: setting.secondaryColor,
    mainRgb: main ? `${main.r}, ${main.g}, ${main.b}` : '34, 43, 69',
    secondaryRgb: secondary ? `${secondary.r}, ${secondary.g}, ${secondary.b}` : '255, 255, 255',
  };
}

/** מזריק את צבעי המשחק כ-CSS variables על אלמנט (בד"כ ה-root של המסך). */
export function themeStyle(setting: GlobalSettings): Record<string, string> {
  const colors = themeColors(setting);
  return {
    '--main-color': colors.main,
    '--secondary-color': colors.secondary,
    '--main-rgb': colors.mainRgb,
    '--secondary-rgb': colors.secondaryRgb,
  };
}
