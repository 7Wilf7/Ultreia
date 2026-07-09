// Single source of truth for the in-app product logo asset. Components import
// the URL from here — never from resources/ directly — so the next logo swap
// touches exactly one file.
//
// NOTE: the native Android splash is generated separately from
// resources/splash-logo.png by scripts/make-splash.mjs. When changing the
// product logo, update both runtime assets plus the native splash source, or
// the native-splash → web-view handoff shows two different logos.
import productLogoUrl from "../../resources/ultreia-logo.webp";
import productBootLogoUrl from "../../resources/splash-logo.png";
import productBootLinesUrl from "../../resources/ultreia-boot-lines.png";
import productBootMountainsUrl from "../../resources/ultreia-boot-mountains.png";

export { productBootLinesUrl, productBootLogoUrl, productBootMountainsUrl, productLogoUrl };
