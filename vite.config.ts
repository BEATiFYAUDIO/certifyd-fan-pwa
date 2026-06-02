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
      includeAssets: ['favicon.svg'],
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
            src: `${BASE}favicon.svg`,
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
});
