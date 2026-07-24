import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { HostConsole } from './render/HostConsole.tsx';
import { registerMediaServiceWorker } from './app/mediaSW.ts';
import './render/styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('אלמנט root לא נמצא');

// ‎#host / ‎?host=1 — "מסך המנחה" הנפרד (קונסולת שליטה). לא מריץ את המשחק עצמו,
// אלא מתחבר למסך הראשי דרך ערוץ השליטה. שאר המקרים — האפליקציה הרגילה.
const isHost =
  window.location.hash === '#host' || new URLSearchParams(window.location.search).get('host') === '1';

createRoot(rootElement).render(
  <StrictMode>{isHost ? <HostConsole /> : <App />}</StrictMode>,
);

// מטמון מדיה מתמשך (Service Worker) — לא-חוסם, נרשם ברקע אחרי הטעינה. במסך
// המנחה אין צורך בו (אין מדיה למשחק) — נרשם רק באפליקציה הראשית.
if (!isHost) registerMediaServiceWorker();
