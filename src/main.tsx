import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import App from './App';

const BASE = import.meta.env.BASE_URL;

async function cleanupLegacyServiceWorkers() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    const allowedScopePrefix = `${window.location.origin}${BASE}`;
    await Promise.all(
      regs.map(async (reg) => {
        const scope = String(reg.scope || '');
        if (!scope.startsWith(allowedScopePrefix)) {
          await reg.unregister();
        }
      }),
    );
  } catch {
    // ignore
  }
}

void cleanupLegacyServiceWorkers().finally(() => {
  registerSW({ immediate: true });
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={BASE}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
