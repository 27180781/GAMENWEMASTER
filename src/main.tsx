import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DebugApp } from './debug/DebugApp.tsx';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('אלמנט root לא נמצא');

createRoot(rootElement).render(
  <StrictMode>
    <DebugApp />
  </StrictMode>,
);
