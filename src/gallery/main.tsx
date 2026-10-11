/**
 * נקודת הכניסה של גלריית המסכים (gallery.html) — כלי פיתוח בלבד, לא נכנס ל-build.
 * מייבא את ה-CSS בדיוק כמו src/main.tsx.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { VISUAL_THEMES } from '../engine/index.ts';
import { Gallery, readParams } from './Gallery.tsx';
import { COLOR_PRESETS } from './mockData.ts';
import { SCREENS } from './screens.tsx';
import '../render/styles.css';
import '../render/themes.css';
import '../render/themes/neon.css';
import '../render/themes/gala.css';
import '../render/themes/comic.css';
import '../render/themes/chalk.css';
import '../render/themes/led.css';
import './gallery.css';

const params = readParams(window.location.search);

// רשימת המסכים/הערכות/הצבעים — tools/theme-shots.mjs קורא אותה מכאן, כך שמסך
// חדש שנרשם ב-screens.tsx נכנס לצילומים בלי לגעת בכלי.
(window as unknown as { __galleryMeta: unknown }).__galleryMeta = {
  screens: SCREENS.map((s) => ({ id: s.id, label: s.label })),
  themes: [...VISUAL_THEMES],
  colors: Object.keys(COLOR_PRESETS),
};

// צילומים דטרמיניסטיים: Math.random קבוע (מיקום השמות המתעופפים וכו').
if (params.freeze) {
  let seed = 0x9e3779b9;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('אלמנט root לא נמצא');

createRoot(rootElement).render(
  <StrictMode>
    <Gallery params={params} />
  </StrictMode>,
);
