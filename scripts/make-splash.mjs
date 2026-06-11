// Regenerate ALL Android splash rasters: a single boot screen of
//   [rounded logo]  +  "Ultreia"
// centered on the app's cream background (#f2f1ec).
//
// Why per-file regeneration: the splash is wired as the window background
// (android:background="@drawable/splash"), so Android STRETCHES the bitmap to
// fill the screen. capacitor-assets therefore ships one splash.png per
// orientation+density at the screen's aspect ratio, with the logo centered so
// stretching keeps it centered (not distorted). We must keep those exact
// dimensions — so we read each existing splash.png's size and re-render the
// same composition at that size. CI only runs `cap sync` (not this script), so
// the committed PNGs are authoritative.
//
// The React LoadingScreen (src/App.jsx) mirrors this exact layout — same cream
// bg, same logo, same "Ultreia" — so the native-splash → web-view
// handoff is visually seamless (no second "Loading…" page).
import sharp from 'sharp';
import { readdir, stat } from 'node:fs/promises';

// Pre-rounded, transparent-corner logo. This is favicon.jpg center-cropped to
// drop its outer dark frame (the iOS-style bevel border) so the topo tile
// reaches the rounded edge — matching how the launcher icon looks on the home
// screen. Using favicon.jpg directly here showed that dark frame as an ugly
// ring around the splash logo. Lives in resources/ (NOT public/) so it isn't
// shipped + PWA-precached at runtime — it's only a build-time source here.
// The web LoadingScreen shows the same artwork via src/assets/logo.js; keep
// the two in sync when the logo changes.
const LOGO_SRC = 'resources/splash-logo.png';
const BG = '#f2f1ec';                     // app cream (PWA theme/background color)
const TEXT = 'Ultreia';
const TEXT_COLOR = '#141413';             // ink-1
const BASE = 'android/app/src/main/res';

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Build one splash bitmap at w×h: cream bg, rounded logo centered slightly
// above the midline, wordmark beneath.
async function renderSplash(w, h) {
  const minDim = Math.min(w, h);
  const logoSize = Math.round(minDim * 0.30);
  const radius = Math.round(logoSize * 0.22);
  const fontSize = Math.round(minDim * 0.052);
  const gap = Math.round(minDim * 0.05);

  // Logo is already rounded with transparent corners — just resize it
  // (preserving alpha) so it drops cleanly onto the cream canvas.
  const logo = await sharp(LOGO_SRC)
    .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // Vertically center the [logo + gap + text] block.
  const blockH = logoSize + gap + fontSize;
  const top = Math.round((h - blockH) / 2);
  const logoLeft = Math.round((w - logoSize) / 2);

  // Wordmark as a full-width transparent SVG layer (centered text).
  const textTop = top + logoSize + gap;
  const textSvg = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
       <text x="${w / 2}" y="${textTop + fontSize * 0.8}" text-anchor="middle"
             font-family="-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
             font-size="${fontSize}" font-weight="500" letter-spacing="0.5"
             fill="${TEXT_COLOR}">${escapeXml(TEXT)}</text>
     </svg>`
  );

  return sharp({ create: { width: w, height: h, channels: 4, background: BG } })
    .composite([
      { input: logo, left: logoLeft, top },
      { input: textSvg, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

// Walk drawable* dirs, regenerate every splash.png in place at its own size.
const dirs = await readdir(BASE);
let count = 0;
for (const d of dirs) {
  if (!d.startsWith('drawable')) continue;
  const dirPath = `${BASE}/${d}`;
  if (!(await stat(dirPath)).isDirectory()) continue;
  const file = `${dirPath}/splash.png`;
  let meta;
  try {
    meta = await sharp(file).metadata();
  } catch {
    continue; // no splash.png in this dir
  }
  const buf = await renderSplash(meta.width, meta.height);
  await sharp(buf).toFile(file);
  console.log(`✓ ${d}/splash.png  ${meta.width}x${meta.height}`);
  count++;
}
console.log(`Done — ${count} splash rasters regenerated.`);
