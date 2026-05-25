import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // autoUpdate: SW reloads itself when a new build is deployed, no
      // "click to refresh" toast needed. Trade-off: a user mid-session may
      // get a refresh between actions; acceptable for a single-user tool.
      registerType: 'autoUpdate',
      // Files the SW pre-caches so the app shell opens offline.
      includeAssets: ['favicon.svg', 'favicon.png', 'training-studio.svg'],
      manifest: {
        name: "Wilf's Training Studio",
        short_name: 'Training Studio',
        description: 'Personal training hub — runs, strength, races, AI coach.',
        theme_color: '#f2f1ec',
        background_color: '#f2f1ec',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'en',
        icons: [
          { src: '/training-studio.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/training-studio.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
          { src: '/favicon.png', sizes: '128x128', type: 'image/png' },
        ],
      },
      workbox: {
        // Pre-cache the build output. Default globs miss .webmanifest;
        // include explicitly so the manifest itself is cached.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff,woff2}'],
        // Bump the per-file size cap; the JS bundle is ~600kB unminified.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          // ── Supabase: always go to network. Caching DB responses would
          // strand the user on stale workouts/races and silently mask write
          // failures. NetworkOnly means: offline → request fails fast,
          // online → fresh every time.
          {
            urlPattern: /^https:\/\/[a-z0-9-]+\.supabase\.co\/.*/i,
            handler: 'NetworkOnly',
          },
          // ── DeepSeek (AI Coach): also never cache. Chat responses are
          // unique per request.
          {
            urlPattern: /^https:\/\/api\.deepseek\.com\/.*/i,
            handler: 'NetworkOnly',
          },
          // ── Google Fonts CSS: change rarely; SWR keeps it warm.
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-css',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          // ── Google Fonts files: hash-stable, can cache aggressively.
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      // Dev-mode SW is opt-in; off by default so HMR isn't fighting the cache.
      devOptions: {
        enabled: false,
      },
    }),
  ],
})
