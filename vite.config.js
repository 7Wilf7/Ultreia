import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

// Dev-only middleware that mounts /api/weather locally so `npm run dev` can
// hit the Caiyun proxy the same way the Vercel deploy does. Reads
// CAIYUN_TOKEN from .env.local (Vite's loadEnv only picks up VITE_* by
// default; we pass '' as the third arg to get every var). The shipped
// serverless function lives at api/weather.js — this just wires the same
// behavior into the dev server so we don't have to install the vercel CLI.
function devWeatherProxy(env) {
  return {
    name: 'dev-weather-proxy',
    configureServer(server) {
      server.middlewares.use('/api/weather', async (req, res) => {
        // Inject the token from .env.local into process.env so the imported
        // handler sees it the same way Vercel's runtime would.
        if (env.CAIYUN_TOKEN && !process.env.CAIYUN_TOKEN) {
          process.env.CAIYUN_TOKEN = env.CAIYUN_TOKEN;
        }
        const { default: handler } = await server.ssrLoadModule('/api/weather.js');
        // Parse the querystring into req.query the way Vercel does — the
        // raw Node req object doesn't have .query, only .url.
        const url = new URL(req.url, 'http://localhost');
        req.query = Object.fromEntries(url.searchParams.entries());
        const wrappedRes = Object.assign(res, {
          status(code) { res.statusCode = code; return wrappedRes; },
          json(body) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return wrappedRes; },
          send(body) { res.end(body); return wrappedRes; },
        });
        await handler(req, wrappedRes);
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load every non-prefixed env var (third arg ''), so CAIYUN_TOKEN — which
  // is intentionally NOT prefixed with VITE_ to keep it server-side — is
  // available to the dev middleware. Production: Vercel injects it directly.
  const env = loadEnv(mode, process.cwd(), '');
  return {
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    // Rolldown 1.0.0 on linux-x64 (CI) tree-shakes way too aggressively —
    // entire App.jsx + nearly all components get stripped, producing a
    // half-size bundle with only the React runtime and a few constants.
    // Same lockfile on Windows (win32-x64 binding) is correct. Until the
    // Rolldown bug is fixed upstream, force tree-shaking off so CI matches
    // local. Bundle size goes from ~390KB → ~790KB; cost is acceptable.
    rolldownOptions: {
      treeshake: false,
    },
  },
  plugins: [
    react(),
    devWeatherProxy(env),
    VitePWA({
      // autoUpdate: SW reloads itself when a new build is deployed, no
      // "click to refresh" toast needed. Trade-off: a user mid-session may
      // get a refresh between actions; acceptable for a single-user tool.
      registerType: 'autoUpdate',
      // Don't auto-inject the SW registration script into index.html.
      // We register manually from src/main.jsx so we can SKIP registration
      // when running inside Capacitor's WebView (the SW conflicts with the
      // app-asset scheme and white-screens the APP on boot). On the web
      // side, registration still happens — just via the virtual:pwa-register
      // module loaded from main.jsx.
      injectRegister: false,
      // Files the SW pre-caches so the app shell opens offline.
      includeAssets: ['favicon.jpg'],
      manifest: {
        name: 'Ultreia',
        short_name: 'Ultreia',
        description: 'Personal training hub — runs, strength, races, AI coach.',
        theme_color: '#0b1110',
        background_color: '#0b1110',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'en',
        // Single 512x512 JPG covers both `any` (normal launcher icons) and
        // `maskable` (Android adaptive icons — outer 20% may be cropped, but
        // the icon's content sits in the inner safe zone).
        icons: [
          { src: '/favicon.jpg', sizes: '512x512', type: 'image/jpeg', purpose: 'any' },
          { src: '/favicon.jpg', sizes: '512x512', type: 'image/jpeg', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Pre-cache the build output. Default globs miss .webmanifest and
        // .jpg; include explicitly so the manifest + icon are cached.
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,jpeg,ico,webmanifest,woff,woff2}'],
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
  };
})
