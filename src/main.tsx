import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { registerMediaServiceWorker } from './app/mediaSW.ts';
import './render/styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('אלמנט root לא נמצא');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// מטמון מדיה מתמשך (Service Worker) — לא-חוסם, נרשם ברקע אחרי הטעינה.
registerMediaServiceWorker();
