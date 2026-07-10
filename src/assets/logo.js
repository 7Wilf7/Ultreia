// Single source of truth for the in-app product logo asset. Components import
// the URL from here — never from resources/ directly — so the next logo swap
// touches exactly one file.
//
// The web boot splash uses the exact 1024px desktop source artwork. Native
// Android splash assets are generated separately by scripts/make-splash.mjs.
import productLogoUrl from "../../resources/ultreia-logo.webp";
import productBootLogoUrl from "../../resources/brand/ultreia-original.png";

export { productBootLogoUrl, productLogoUrl };
