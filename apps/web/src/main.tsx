import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted Heebo (no third-party font request; lets the CSP stay 'self'-only).
import '@fontsource/heebo/400.css';
import '@fontsource/heebo/500.css';
import '@fontsource/heebo/700.css';
import { App } from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
