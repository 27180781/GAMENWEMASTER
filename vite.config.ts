import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base יחסי ('./') כדי שהבנייה תיטען גם מ-file:// (Electron אופליין) וגם
// משרת בשורש (CapRover). פריסת GitHub Pages דורסת עם --base=/GAMENWEMASTER/.
export default defineConfig({
  base: './',
  plugins: [react()],
});
