import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const BASE = '/';

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'favicon-16.png', 'favicon-32.png', 'favicon-64.png', 'apple-touch-icon.png'],
      workbox: {
        navigateFallback: `${BASE}index.html`,
      },
      manifest: {
        name: 'Certifyd',
        short_name: 'Certifyd',
        description: 'Discover creators and drops across the Certifyd network',
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
            purpose: 'any maskable',
          },
          {
            src: `${BASE}pwa-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
});
