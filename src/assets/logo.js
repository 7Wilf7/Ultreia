// Single source of truth for the in-app product logo asset. Components import
// the URL from here — never from resources/ directly — so the next logo swap
// touches exactly one file.
//
// NOTE: the native Android splash is generated separately from
// resources/splash-logo.png by scripts/make-splash.mjs. When changing the
// product logo, update BOTH assets (same artwork) or the native-splash →
// web-view handoff shows two different logos.
import productLogoUrl from "../../resources/original-ui.png";

export { productLogoUrl };
