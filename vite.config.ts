/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the site from /Gliderama/. Override with BASE_PATH for other hosts.
const base = process.env.BASE_PATH ?? (process.env.NODE_ENV === 'production' ? '/Gliderama/' : '/');

export default defineConfig({
  base,
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt',
      // No auto-injected register script: src/app/pwa.ts registers the service worker via virtual:pwa-register.
      injectRegister: null,
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: false, // provided by public/manifest.webmanifest (linked from index.html)
      workbox: {
        // Precache every build asset (code, styles, images, fonts, the static manifest) so the game runs offline.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,avif,jpg,jpeg,gif,woff,woff2,ttf,otf,json,webmanifest,wasm,ogg,mp3,wav,m4a}'],
        // three.js and the game code are big single chunks; never silently drop one from the precache.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // Resolved against the service worker's own URL (<base>/sw.js), so this is <base>/index.html under any
        // BASE_PATH (e.g. /Gliderama/): every navigation inside the scope falls back to the cached app shell.
        navigateFallback: 'index.html',
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
  server: { host: true },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    // the generator's tests build whole floors (a few seconds each), more on a busy machine
    testTimeout: 15000,
  },
});
