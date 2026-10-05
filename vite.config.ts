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
        // ...except the Classic Houses: their rooms add up to ~2.4 MB, so each is cached when it is first played
        globIgnores: ['**/assets/houses/**'],
        runtimeCaching: [
          {
            // content-hashed file names: a cached house never goes stale
            urlPattern: ({ url }) => url.pathname.includes('/assets/houses/'),
            handler: 'CacheFirst',
            options: { cacheName: 'classic-houses', expiration: { maxEntries: 60 } },
          },
        ],
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
    rollupOptions: {
      output: {
        // the Classic Houses (src/world/classic/houses/*.json, loaded on demand) get a folder of their own
        chunkFileNames: (chunk) => (chunk.facadeModuleId?.includes('/world/classic/houses/') ? 'assets/houses/[name]-[hash].js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  server: { host: true },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
