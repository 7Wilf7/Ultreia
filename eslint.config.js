import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // dist          — Vite build output
  // android        — Capacitor copies the built web bundle into
  //                  android/app/src/main/assets/public on `cap sync`; those
  //                  minified files must never be linted (hundreds of false
  //                  positives). The android/ tree is native, not our JS.
  // .claude        — agent worktrees / scratch copies of the repo
  globalIgnores(['dist', 'android', '.claude']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  // Node-runtime files: Vite config + Vercel serverless functions in /api,
  // scripts, and local tools run under Node, not the browser. Without this override eslint
  // flags every `process.env.*` lookup as "no-undef".
  {
    files: ['vite.config.js', 'api/**/*.js', 'scripts/**/*.{js,mjs}', 'tools/**/*.{js,mjs}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['src/**/*.test.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.vitest },
    },
  },
])
