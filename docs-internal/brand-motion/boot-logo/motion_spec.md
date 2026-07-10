# Ultreia Boot Lockup Spec

## Current contract

- Context: mobile app and PWA splash.
- Logo source: `resources/brand/ultreia-original.png`.
- Source verification: the repository file is byte-identical to `Desktop/logo/Ultreia.png` (1024 x 1024).
- Splash duration: 1800ms.
- Wordmark reveal: 1200ms, left to right, `linear`.

## Logo rules

The source bitmap is visible in its finished state from the first rendered frame. The full double-line border, contour field, mountains, route, texture, shadows, and glow all come directly from the desktop source.

The Logo has no motion:

- no traced or substitute geometry;
- no assembly, mask, wipe, fade, scale, translation, blur, brightness change, sheen, pulse, or final-frame handoff;
- no second Logo layer becoming visible later;
- no CSS filter applied to the Logo.

## Wordmark rules

The signature-style Ultreia wordmark is the only animated brand actor. It uses a single clip-path progression:

```css
from { clip-path: inset(0 100% 0 0); }
to   { clip-path: inset(0 0 0 0); }
```

The animation timing function must remain `linear`. Do not add intermediate keyframes because they recreate the fast-slow-fast pacing that this contract replaces.

Under `prefers-reduced-motion: reduce`, the finished wordmark appears immediately.

## Family alignment

Aevum, Ultreia, Viatica, and Sidera use the same splash contract: exact desktop source Logo from frame 0, 1200ms linear wordmark reveal, 1800ms total splash. Product color, source artwork, and wordmark text remain product-specific.

## Archived evidence

The HTML, SVG, CSS, frame strips, and metrics beside this file document the retired 2026-07-10 animated Logo exploration. They are retained as historical comparison artifacts and are not the current runtime specification.
