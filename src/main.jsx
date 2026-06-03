import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'
import { installErrorOverlay } from './lib/errorOverlay'

// On-screen error reporter — must be installed before anything else so even a
// boot-time crash surfaces (vital for the APK, where the console isn't reachable).
installErrorOverlay()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// ── PWA service-worker lifecycle ────────────────────────────────────────
// On the web (Vercel deploy): register the SW so the app installs as a PWA
// and auto-updates on next visit after a deploy.
// Inside Capacitor's WebView: skip registration AND unregister any SW left
// from an older APK build. The SW intercepts fetches under Capacitor's
// `https://localhost` app-asset scheme and white-screens the app on boot.
const isNative = typeof window !== 'undefined'
  && typeof window.Capacitor !== 'undefined'
  && window.Capacitor.isNativePlatform?.() === true;

if ('serviceWorker' in navigator) {
  if (isNative) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(r => r.unregister());
    }).catch(() => { /* fine — no SW to clean up */ });
  } else {
    import('virtual:pwa-register').then(({ registerSW }) => {
      registerSW({ immediate: true });
    }).catch(() => { /* fine — PWA virtual unavailable in some dev modes */ });
  }
}
