import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const BASE = '/certifyd-fan-pwa/';

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      workbox: {
        navigateFallback: `${BASE}index.html`,
      },
      manifest: {
        name: 'Certifyd Fan',
        short_name: 'Certifyd Fan',
        description: 'Public discovery app for Certifyd Creator nodes',
        theme_color: '#09090b',
        background_color: '#09090b',
        display: 'standalone',
        start_url: BASE,
        scope: BASE,
        icons: [
          {
            src: `${BASE}pwa-192.png`,
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: `${BASE}pwa-512.png`,
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
});
