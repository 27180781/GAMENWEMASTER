import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base יחסי ('./') כדי שהבנייה תיטען גם מ-file:// (Electron אופליין) וגם
// משרת בשורש (CapRover).
export default defineConfig({
  base: './',
  plugins: [react()],
});
