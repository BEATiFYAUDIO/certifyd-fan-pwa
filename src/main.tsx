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

if ('serviceWorker' in navigator) {
  let reloadingForServiceWorkerUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForServiceWorkerUpdate) return;
    reloadingForServiceWorkerUpdate = true;
    window.location.reload();
  });
}

void cleanupLegacyServiceWorkers().finally(() => {
  let applyServiceWorkerUpdate: ((reloadPage?: boolean) => Promise<void>) | undefined;
  applyServiceWorkerUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      void applyServiceWorkerUpdate?.(true);
    },
    onRegisteredSW(_scriptUrl, registration) {
      if (!registration) return;
      void registration.update();
      window.setInterval(() => {
        void registration.update();
      }, 15 * 60 * 1000);
    },
  });
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={BASE}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
