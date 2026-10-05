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
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: false, // provided by public/manifest.webmanifest (see infra task)
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff,woff2,webmanifest}'],
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
  },
});
