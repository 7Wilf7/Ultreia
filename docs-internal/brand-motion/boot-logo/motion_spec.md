# Ultreia Boot Lockup Spec

## Current contract

- Context: mobile app and PWA splash.
- Logo source: `resources/brand/ultreia-original.png`.
- Source verification: the repository file is byte-identical to `Desktop/logo/Ultreia.png` (1024 x 1024).
- Splash duration: 1800ms.
- Logo stage: `min(33vmin, 158px)` square.
- Wordmark: `min(12.5vmin, 52px)`, weight 400, line-height 1.
- Wordmark reveal: 1200ms, left to right, fast-slow-fast.

## Logo rules

The source bitmap is visible in its finished state from the first rendered frame. The full double-line border, contour field, mountains, route, texture, shadows, and glow all come directly from the desktop source.

The Logo has no motion:

- no traced or substitute geometry;
- no assembly, mask, wipe, fade, scale, translation, blur, brightness change, sheen, pulse, or final-frame handoff;
- no second Logo layer becoming visible later;
- no CSS filter applied to the Logo.

## Wordmark rules

The signature-style Ultreia wordmark is the only animated brand actor. It uses
the same three-part clip-path progression as Aevum, Viatica, and Sidera:

```css
0%   { clip-path: inset(0 100% 0 0); animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1); }
26%  { clip-path: inset(0 56% 0 0);  animation-timing-function: linear; }
74%  { clip-path: inset(0 42% 0 0);  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1); }
100% { clip-path: inset(0 0 0 0); }
```

The opening 26% reveals 44% of the wordmark, the middle 48% advances only 14%,
and the closing 26% finishes the remaining 42%. Literal easing values stay in
the keyframes so Chromium does not silently fall back to a uniform curve.

Under `prefers-reduced-motion: reduce`, the finished wordmark appears immediately.

## Family alignment

Aevum, Ultreia, Viatica, and Sidera use the same splash contract: exact desktop
source Logo from frame 0, identical responsive Logo and wordmark sizes, one
1200ms fast-slow-fast wordmark reveal, and one 1800ms core splash clock. Product
color, source artwork, and wordmark text remain product-specific. A slow data
load may hold the finished lockup after 1800ms, but must not restart the motion.

## Archived evidence

The HTML, SVG, CSS, frame strips, and metrics beside this file document the retired 2026-07-10 animated Logo exploration. They are retained as historical comparison artifacts and are not the current runtime specification.
