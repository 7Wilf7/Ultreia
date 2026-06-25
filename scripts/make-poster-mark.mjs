// Extract the logo's mark (mountain / route strokes + topographic lines) from
// the master logo into two THEMED, transparent marks
// the share poster uses as its background:
//   resources/poster-mark-day.webp   — dark ink lines (for the cream day paper)
//   resources/poster-mark-night.webp — cream lines    (for the night ground)
// Green contour strokes stay green in both. The baked dark tile is dropped so
// the poster can place the mark directly on its own day / night backgrounds.
//
// Why extract instead of recolouring the PNG live: the logo is a raster with a
// baked dark square, so it can't be themed (day needs DARK lines) without
// inverting — which would flip the green. Splitting it once, offline, gives
// clean per-theme marks with the green preserved. Re-run after a logo change.
import sharp from 'sharp';

const SRC = 'resources/brand/ultreia-original.png';
const hex = c => { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const INK = { day: hex('#151610'), night: hex('#f3f0e2') };
const GREEN = hex('#7a8a45'); // the logo's olive tick, nudged so it still reads green

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const N = W * H;

function build(inkRGB) {
  const out = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const greenish = g >= r && g >= b && (g - b) >= 22 && luma >= 55 && luma <= 180;
    let col, a;
    if (greenish) { col = GREEN; a = 255; }
    else if (luma > 130) { col = inkRGB; a = Math.min(255, Math.round((luma - 110) / (245 - 110) * 255)); }
    else { col = inkRGB; a = 0; }
    out[i * 4] = col[0]; out[i * 4 + 1] = col[1]; out[i * 4 + 2] = col[2]; out[i * 4 + 3] = a;
  }
  return out;
}

for (const theme of ['day', 'night']) {
  await sharp(build(INK[theme]), { raw: { width: W, height: H, channels: 4 } })
    .webp({ quality: 92, alphaQuality: 100 })
    .toFile(`resources/poster-mark-${theme}.webp`);
  console.log(`wrote resources/poster-mark-${theme}.webp`);
}
