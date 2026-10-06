import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { HostConsole } from './render/HostConsole.tsx';
import { LiveViewer } from './live/LiveViewer.tsx';
import { registerMediaServiceWorker } from './app/mediaSW.ts';
import { VOTE_SERVER_URL } from './app/socketAdapter.ts';
import { parseAppParams } from './app/urlParams.ts';
import './render/styles.css';
import './render/themes.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('אלמנט root לא נמצא');

// ‎#host / ‎?host=1 — "מסך המנחה" הנפרד (קונסולת שליטה). לא מריץ את המשחק עצמו,
// אלא מתחבר למסך הראשי דרך ערוץ השליטה. שאר המקרים — האפליקציה הרגילה.
const isHost =
  window.location.hash === '#host' || new URLSearchParams(window.location.search).get('host') === '1';

// ‎?view=<קוד>‎ — מסך הצפייה של משחק אונליין: המסך הראשי בשידור חי, בלי שום
// שליטה (src/live). לא טוען משחק; מי שכותב את שמו עונה ממנו דרך שרת ההצבעות,
// כמו מהטלפון (‎?voteServer=‎ דורס את השרת, כמו במסך הראשי).
const viewToken = new URLSearchParams(window.location.search).get('view');

createRoot(rootElement).render(
  <StrictMode>
    {viewToken !== null ? (
      <LiveViewer
        token={viewToken.trim().toLowerCase()}
        voteServerUrl={parseAppParams(window.location.search).voteServer ?? VOTE_SERVER_URL}
      />
    ) : isHost ? (
      <HostConsole />
    ) : (
      <App />
    )}
  </StrictMode>,
);

// מטמון מדיה מתמשך (Service Worker) — לא-חוסם, נרשם ברקע אחרי הטעינה. במסך
// המנחה אין צורך בו (אין מדיה למשחק) — נרשם רק באפליקציה הראשית.
if (!isHost) registerMediaServiceWorker();
