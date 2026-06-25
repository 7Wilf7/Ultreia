// Build the share-poster background mark from the master logo.
//
// The master logo is a raster app icon: metallic moss ridges / route on top of
// a dark tile, with topographic lines and a rounded-square chrome frame. For
// the poster watermark we do NOT want to cut out a brittle, jagged logo shape.
// Instead this script rebuilds a clean dark moss ground, removes the contour
// lines / outer frame entirely, then composites only the metallic logo body back
// on top with a soft halo. This keeps the logo complete while avoiding the
// dirty line remnants that come from colour-threshold cutouts.
import sharp from 'sharp';

const SRC = 'resources/brand/ultreia-original.png';
const OUT = {
  day: 'resources/poster-mark-day.webp',
  night: 'resources/poster-mark-night.webp',
};

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const N = W * H;

const idx = (x, y) => y * W + x;
const clamp = (v, min = 0, max = 255) => Math.max(min, Math.min(max, v));

function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function mix(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}

function hashNoise(x, y) {
  let n = (x * 374761393 + y * 668265263) ^ (x * y);
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const hit = ((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

// Hand-tuned body polygons for the metallic mountain / route mark only.
// They intentionally exclude the icon's topographic background and chrome frame.
const BODY_POLYS = [
  // Central route, including the dark right side but fading the frame-cut tail.
  [[225, 1024], [282, 935], [350, 845], [430, 758], [505, 685], [552, 626],
    [530, 585], [465, 528], [430, 488], [450, 450], [510, 420], [560, 384],
    [590, 340], [625, 360], [613, 425], [548, 466], [500, 490], [552, 522],
    [632, 560], [690, 612], [645, 665], [570, 735], [495, 820], [420, 910],
    [366, 1024]],
  // Left ridge.
  [[148, 720], [222, 625], [312, 522], [405, 410], [455, 376], [452, 458],
    [390, 520], [344, 588], [258, 622], [195, 682]],
  // Top ridge.
  [[452, 410], [555, 276], [620, 226], [620, 336], [538, 446], [498, 440]],
  // Right ridge.
  [[602, 306], [850, 570], [652, 502], [615, 384]],
  // Small central fold around the S bend.
  [[555, 346], [612, 380], [604, 420], [558, 456], [530, 438], [562, 395]],
];

function buildMask(polys) {
  const mask = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (const poly of polys) {
        if (inPoly(x + 0.5, y + 0.5, poly)) {
          mask[idx(x, y)] = 1;
          break;
        }
      }
    }
  }
  return mask;
}

function diskPoints(rad) {
  const pts = [];
  for (let dy = -rad; dy <= rad; dy++) {
    for (let dx = -rad; dx <= rad; dx++) {
      if (dx * dx + dy * dy <= rad * rad) pts.push([dx, dy]);
    }
  }
  return pts;
}

function dilate(mask, rad) {
  const out = new Uint8Array(N);
  const pts = diskPoints(rad);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let hit = false;
      for (const [dx, dy] of pts) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && mask[idx(xx, yy)]) {
          hit = true;
          break;
        }
      }
      out[idx(x, y)] = hit ? 1 : 0;
    }
  }
  return out;
}

function erode(mask, rad) {
  const out = new Uint8Array(N);
  const pts = diskPoints(rad);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let ok = true;
      for (const [dx, dy] of pts) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H || !mask[idx(xx, yy)]) {
          ok = false;
          break;
        }
      }
      out[idx(x, y)] = ok ? 1 : 0;
    }
  }
  return out;
}

function cleanGroundRGB(x, y) {
  const distCenter = Math.hypot((x - 520) / 560, (y - 500) / 560);
  const topLight = smoothstep(1.0, 0.0, Math.hypot((x - 385) / 760, (y - 120) / 620));
  const centerLight = smoothstep(1.05, 0.0, distCenter);
  const vignette = smoothstep(0.25, 1.2, distCenter);
  const noise = (hashNoise(x, y) - 0.5) * 3.2;
  return mix([5, 10, 7], [29, 37, 28], Math.min(1, centerLight * 0.55 + topLight * 0.25))
    .map(v => clamp(Math.round(v - vignette * 7 + noise)));
}

function build() {
  const body = buildMask(BODY_POLYS);
  const halo = dilate(body, 24);
  const bodyInner = erode(body, 1);
  const out = Buffer.alloc(N * 4);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      let [r, g, b] = cleanGroundRGB(x, y);

      if (halo[i] && !body[i]) {
        const glow = 0.14;
        r = Math.round(r * (1 - glow) + 18 * glow);
        g = Math.round(g * (1 - glow) + 42 * glow);
        b = Math.round(b * (1 - glow) + 16 * glow);
      }

      if (body[i]) {
        const sr = data[i * 4], sg = data[i * 4 + 1], sb = data[i * 4 + 2];
        const luma = 0.299 * sr + 0.587 * sg + 0.114 * sb;
        const tailFrameCut = y > 940 && luma > 24 && (Math.abs(sr - sg) < 36 || sg >= sb);
        const tailFade = x < 390 ? 1 - smoothstep(910, 1015, y) : 1;
        const shadowLift = luma < 18 ? 0.45 : 0;
        const a = tailFrameCut ? 0 : tailFade;
        const cr = Math.round(sr * (1 - shadowLift) + r * shadowLift);
        const cg = Math.round(sg * (1 - shadowLift) + g * shadowLift);
        const cb = Math.round(sb * (1 - shadowLift) + b * shadowLift);
        r = Math.round(cr * a + r * (1 - a));
        g = Math.round(cg * a + g * (1 - a));
        b = Math.round(cb * a + b * (1 - a));
      }

      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      const edgeFade = smoothstep(0, 165, edge);
      const ambient = Math.round(42 * (1 - smoothstep(470, 690, Math.hypot(x - 520, y - 540))));
      const alpha = bodyInner[i] ? 255 : (body[i] ? 238 : (halo[i] ? 80 : ambient));

      out[i * 4] = r;
      out[i * 4 + 1] = g;
      out[i * 4 + 2] = b;
      out[i * 4 + 3] = Math.round(alpha * edgeFade);
    }
  }

  return out;
}

const mark = build();

for (const [theme, file] of Object.entries(OUT)) {
  await sharp(mark, { raw: { width: W, height: H, channels: 4 } })
    .webp({ quality: 92, alphaQuality: 100 })
    .toFile(file);
  console.log(`wrote ${file}`);
}
