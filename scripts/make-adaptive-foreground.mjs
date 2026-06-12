// Regenerate ALL Android launcher icon rasters from favicon.jpg.
//
// Why favicon.jpg: it is the same complete square artwork the PWA uses.
//
// The fix: keep the adaptive foreground inside Android's launcher safe area.
// The final Ultreia mark is wider than the old artwork; if the foreground fills
// the 108dp adaptive canvas, some launchers crop the white mountain stroke. We
// now center a slightly smaller favicon on the same dark background so the
// visible mark survives masks, zoom effects, and rounded-square launchers.
//
// @capacitor/assets is NOT run in CI (the release workflow only does
// `cap sync`), so the committed PNGs here are authoritative — this script
// writes them directly.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const SRC = 'public/favicon.jpg';
const BG = { r: 0x1a, g: 0x1a, b: 0x1a, alpha: 1 };   // matches ic_launcher_background.xml
const ADAPTIVE_ICON_SCALE = 0.82;

// Adaptive foreground layers (Android 8+). 108dp logical canvas scaled per
// density. The icon is inset because launchers apply their own masks, zoom,
// and crop behavior around this foreground layer.
const FOREGROUND = [
  { name: 'mdpi',    px: 108 },
  { name: 'hdpi',    px: 162 },
  { name: 'xhdpi',   px: 216 },
  { name: 'xxhdpi',  px: 324 },
  { name: 'xxxhdpi', px: 432 },
];

// Legacy square + round launcher icons (Android <8). Full bleed; the round
// variant gets a circular alpha mask.
const LEGACY = [
  { name: 'ldpi',    px: 36 },
  { name: 'mdpi',    px: 48 },
  { name: 'hdpi',    px: 72 },
  { name: 'xhdpi',   px: 96 },
  { name: 'xxhdpi',  px: 144 },
  { name: 'xxxhdpi', px: 192 },
];

async function squarePng(px) {
  return sharp(SRC)
    .resize(px, px, { fit: 'cover' })
    .flatten({ background: BG })
    .png()
    .toBuffer();
}

async function adaptiveForegroundPng(px) {
  const innerPx = Math.round(px * ADAPTIVE_ICON_SCALE);
  const icon = await sharp(SRC)
    .resize(innerPx, innerPx, { fit: 'contain' })
    .flatten({ background: BG })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: px,
      height: px,
      channels: 3,
      background: BG,
    },
  })
    .composite([{ input: icon, gravity: 'centre' }])
    .png()
    .toBuffer();
}

function circleMaskSvg(px) {
  const r = px / 2;
  return Buffer.from(
    `<svg width="${px}" height="${px}"><circle cx="${r}" cy="${r}" r="${r}" fill="#fff"/></svg>`
  );
}

for (const { name, px } of FOREGROUND) {
  const dir = `android/app/src/main/res/mipmap-${name}`;
  await mkdir(dir, { recursive: true });
  const buf = await adaptiveForegroundPng(px);
  await sharp(buf).toFile(`${dir}/ic_launcher_foreground.png`);
  console.log(`✓ ${dir}/ic_launcher_foreground.png  ${px}x${px} (${Math.round(ADAPTIVE_ICON_SCALE * 100)}% safe-zone icon)`);
}

for (const { name, px } of LEGACY) {
  const dir = `android/app/src/main/res/mipmap-${name}`;
  await mkdir(dir, { recursive: true });

  const sq = await squarePng(px);
  await sharp(sq).toFile(`${dir}/ic_launcher.png`);
  console.log(`✓ ${dir}/ic_launcher.png  ${px}x${px}`);

  const round = await sharp(sq)
    .composite([{ input: circleMaskSvg(px), blend: 'dest-in' }])
    .png()
    .toBuffer();
  await sharp(round).toFile(`${dir}/ic_launcher_round.png`);
  console.log(`✓ ${dir}/ic_launcher_round.png  ${px}x${px} (circle)`);
}

console.log('Done. Adaptive <background> stays #1A1A1A.');
