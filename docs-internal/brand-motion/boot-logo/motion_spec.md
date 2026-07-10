# Ultreia Boot Logo Motion Spec

## Motion brief

- Personality: grounded, progressive, precise.
- Context: mobile app/PWA splash. The reveal plays once on launch, then holds the exact product logo while core data finishes loading.
- Source of truth: `resources/splash-logo.png`, generated from `resources/brand/ultreia-original.png`.
- Final Frame Contract: the finished frame must be the source bitmap at the same size and position. No replacement drawing, scale snap, brightness pulse, blur, or cross-fade into a second logo is allowed.

The metallic texture, shadows, glow, and fine contour antialiasing are intentionally kept as the source bitmap inside a motion-ready SVG. Converting those pixels into traced paths would lower fidelity and create the rough edges this redesign is meant to remove. The vector geometry is limited to temporary semantic occluders; none remain visible in the final frame.

## Visual diagnosis

The 2026-07-09 mask version reveals the source through broad hand-authored strokes. Its intermediate frames therefore show disconnected border fragments, isolated contour segments, and mountain shards. A large late mask then fills the missing pixels, so the mark only becomes coherent near the end.

The earlier layered version became recognizable sooner, but its temporary geometry and whole-mark scale movement did not preserve the final artwork precisely. The new motion keeps the early coherence while making the final bitmap the only painted logo.

## Actors

1. `field`: the exact final bitmap, including the double frame and real contour lines.
2. `left-ridge-cover`, `summit-cover`, `right-ridge-cover`: dark occluders that initially hide the metallic ridge pixels, then fade away in a short stagger so each whole ridge develops from the exact artwork.
3. `route-cover`: a dark occluder that withdraws from the bottom of the real route toward the summit.
4. `wordmark`: the existing Ultreia script wordmark.
5. `greeting`: greeting, training line, loading status, and build credit.

The covers never paint a substitute logo. They only temporarily hide regions of the exact bitmap and are fully absent in the final pose.

## Timeline

Total reveal: 2600ms.

| Time | Phase | Motion |
| --- | --- | --- |
| 0-420ms | Anticipation | Quiet hold; the field begins to emerge from the app background. |
| 100-936ms | Establish terrain | Exact double frame and contour field reach full opacity together. No root scale or translation. |
| 520-1612ms | Main action | Left ridge, summit, then right ridge develop with short overlaps. |
| 884-1768ms | Forward motion | The real route is uncovered from bottom to top. |
| 1144-2028ms | Wordmark | Script wordmark wipes in once the mark is already readable. |
| 1716-2444ms | Follow-through | Greeting and credit settle in; all occluders finish withdrawing. |
| 2440-2600ms | Hold | Exact final frame only. |

## Easing tokens

- Establish: `cubic-bezier(0.33, 0, 0.2, 1)`.
- Ridge/route reveal: `cubic-bezier(0.16, 1, 0.3, 1)`.
- Text settle: `cubic-bezier(0.22, 1, 0.36, 1)`.

Literal easing values are used inside keyframes so Chromium does not silently fall back to linear motion.

## Principles

- Staging: terrain first, then ridge mass, then the route, then text.
- Slow in/slow out: every reveal uses an explicit non-linear curve.
- Timing: the logo is recognizable before the midpoint; the final 30% is follow-through and hold.
- Follow-through/overlap: ridge actors start and finish on separate frames.
- Solid drawing: the final bitmap never deforms and cover boundaries only reveal exact source pixels.
- Appeal: one restrained upward progression echoes climbing and the route through the mountains.

## Rejected effects

- No blur-to-sharp transition.
- No animated brightness, glow pulse, or final flash.
- No whole-logo scale, bounce, or sudden shrink.
- No rough outline drawn before the real logo.
- No second frame that fades away.
- No late full-image cross-fade.

## QA results

- Deterministic key frames: 0, 400, 800, 1200, 1600, 2000, 2400, and 2600ms.
- The logo is recognizable by 1200ms and fully formed before the wordmark finishes.
- A 100ms luminance sweep from 0-2600ms found zero negative brightness steps in the logo region.
- 10ms samples around actor starts and finishes found no flatline-then-pop handoff.
- The same-pipeline animated final frame and static SVG frame have an exact zero-pixel diff.
- The cross-renderer overlay reports IoU 0.9593 (`src_only_px=10651`, `render_only_px=0`). Visual inspection shows the residual is the Chrome/Pillow alpha and resampling boundary, not a silhouette or internal-art mismatch; the same-pipeline zero diff is decisive for the shipped animation.
