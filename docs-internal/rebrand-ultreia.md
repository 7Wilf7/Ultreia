# Ultreia Rebrand Status

> Internal handoff note. Current as of 2026-06-25.

## Current Source Of Truth

- Brand name: `Ultreia`
- Web domain: `https://www.ultreia.run/`
- GitHub repo: `https://github.com/7Wilf7/Ultreia`
- npm package name: `ultreia`
- Android applicationId / namespace: `run.ultreia.app`
- Firebase project: `ultreia-ce3d9`
- Demo account: `demo@ultreia.run`
- Main APK mirror object: `releases/ultreia-latest.apk`

## Meaning

`Ultreia` comes from the medieval Camino de Santiago pilgrim call meaning
"onward" or "go further." The brand should read as endurance, direction, and
quiet persistence rather than a generic fitness tracker.

The logo system uses three ideas:

- mountain ridges for long-distance effort and ascent
- a winding route for day-to-day training choices and forward motion
- topographic contour lines for outdoor routes, data layers, and accumulated history
- deep moss / olive light on a near-black tile, avoiding bright fitness green

## Completed

- User-visible app name changed to `Ultreia`.
- Final logo stored under `resources/brand/ultreia-original.png`; lightweight
  runtime asset generated as WebP.
- PWA icon, Android launcher icon, native splash, login logo, in-app logo, and
  poster background now use the current logo system.
- App guide overview includes the product philosophy and logo rationale.
- Onboarding points users to the guide overview instead of carrying a separate
  philosophy chapter.
- Desktop header now displays only `Ultreia`.
- GitHub release checker points at the current repo.
- Android package moved to `run.ultreia.app`.
- Firebase Android config moved to project `ultreia-ce3d9`.
- New demo account created and seeded.
- Release workflow now uploads the stable APK mirror as `ultreia-latest.apk`.

## Dashboard Items

- Firebase `FCM_SERVICE_ACCOUNT` secret in Supabase must contain the full service
  account JSON from the current Firebase project.
- Old web domain entries can be removed from Vercel and Supabase Auth redirect
  settings after confirming no local test flow still needs them.
- The previously shared Supabase service-role key should be rotated after this
  migration work is finished.

## Keystore Note

The signing keystore is intentionally not stored in git. CI signs with GitHub
Secrets. If a new keystore is ever generated, use `ultreia` as the alias and keep
the local file name `android/app/ultreia-release.jks`.

Do not rotate the production signing keystore just for naming cleanup. Android
updates require the same signing identity unless the distribution strategy is
explicitly reset.
