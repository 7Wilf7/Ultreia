# Data Access Layer (DAL)

This directory is the single place where the app talks to Supabase. Components
should never import `supabase` directly — they go through these modules.

## Why a DAL

- All Postgres / RLS / auth assumptions live in one place.
- Components stay focused on UI and state; swapping the backend (or stubbing it
  in tests) means touching only these files.
- Function signatures are stable even while implementations are still being
  filled in (scaffold stage), so call sites can be wired up incrementally.

## Files

| File | Table | Responsibility |
|------|-------|----------------|
| `profiles.js` | `profiles` | One row per user — athlete profile (display name, birth date, HR zones, etc.) |
| `workouts.js` | `workouts` | Training log entries |
| `races.js` | `races` | Race calendar / results |
| `coachMessages.js` | `coach_messages` | AI Coach conversation history |
| `userSettings.js` | `user_settings` | Per-user preferences (language, API model choice, coach config, coach memory…) |
| `index.js` | — | Re-exports each module as a namespace |

## Naming convention

| Prefix | Meaning |
|--------|---------|
| `my*` | Scoped to the currently logged-in user (server enforces this via RLS + `auth.uid()`) — caller never passes a `userId` |
| `list*` | Returns an array, possibly ordered |
| `get*` | Returns a single row (or `null`) |
| `create*` | Inserts a new row, returns the inserted row |
| `update*` | Patches an existing row by id (or implicit "mine"), returns the updated row |
| `delete*` | Removes by id |
| `bulk*` | Multi-row variant (typically inserts) |

## Calling convention

```js
// Recommended — namespaced import gives every call site a hint of what table
// is being touched.
import * as db from './lib/db';
const workouts = await db.workouts.listMyWorkouts();

// Also valid — direct namespace import:
import { workouts } from './lib/db';
await workouts.createWorkout({ ... });
```

All functions are `async` and use the shared `supabase` client from
`../supabase.js`.

## Error handling

Each function throws an `Error` if Supabase returns an error or if the call
fails for any other reason. The caller is responsible for catching and
deciding how to surface the failure to the user (toast, inline message,
silent retry, etc.). Don't swallow errors inside the DAL.

## Status

**Migration complete (3.4).** All 6 user-level data domains (profile,
user_settings, workouts, races, coach_messages, plus the `itra_pi` field
co-located on `profiles`) live on Supabase. `localStorage` is no longer used
by any business code; the legacy `wilf_training_studio_v1` blob is removed
one-time on first login post-migration. `src/utils/migrate.js` has been
deleted.

| Module | Status | Notes |
|--------|--------|-------|
| `profiles.js` | ✅ 3.3b | int fields (`restingHR` / `maxHR` / `itraPI`) round-trip as strings on the UI side; `toRow` skips undefined fields |
| `userSettings.js` | ✅ 3.3b | `coach_config` is `jsonb` — never `JSON.stringify` it on the JS side |
| `workouts.js` | ✅ 3.3c | See below |
| `races.js` | ✅ 3.3d | See below |
| `coachMessages.js` | ✅ 3.3e | Append-only chat history; see below |

### `workouts.js` notes

- `listMyWorkouts()` orders by `date DESC, created_at DESC` — call sites
  (TrainingTab aggregation, AICoachTab `slice(0, 10)`) rely on this ordering.
- `createWorkout(workout, { source })` and `bulkInsertWorkouts(workouts, { source })`
  accept an optional `source` (`'manual'` / `'garmin_csv'` / `'fit_file'`).
  The DB column exists but is not yet exposed in `fromRow`.
- `deleteWorkouts(ids)` (plural) batches via `.in('id', ids)` — one round-trip
  even when the user multi-selects.
- `bulkInsertWorkouts` batches at 500 rows per request. On a mid-batch failure
  it throws with a message that includes how many rows already landed; earlier
  batches are NOT rolled back (Supabase has no cross-batch transaction).
- All insert / update calls use `.select('*').single()` so the caller gets the
  full server-generated row back (uuid `id`, `created_at`, `updated_at`)
  without a follow-up fetch.
- `FIELD_MAP` exposes `createdAt` / `updatedAt` to the UI but `WRITE_SKIP`
  keeps `toRow` from ever sending them back to the server.
- No type coercion in `fromRow` / `toRow` (unlike `profiles.js`):
  `ActivityForm.handleSave` already produces clean numbers before they reach
  the DAL.

### `races.js` notes

- `listMyRaces()` orders by `created_at DESC`. The `date` field can be null
  (a placeholder race is created before the date is known), so sorting by
  `date` would clump those at the top/bottom. `RacesTab` re-sorts internally:
  targets `date ASC` ("next race first"), history `date DESC` ("most recent").
- `result_seconds` is one INTEGER column on the DB. `fromRow` derives the
  three string-typed `resultH / resultM / resultS` fields used by the form
  inputs, **and** keeps the raw `resultSeconds` number for sorting / PR
  calculation. `toRow` accepts either an explicit `resultSeconds` patch or
  the legacy `resultH / resultM / resultS` triple and merges them.
- `distance` accepts both a number (`42.195`) and a legacy string with units
  (`"Marathon (42.195 km)"`); `toRow` extracts the first numeric token if a
  string slips through. `fromRow` always returns a plain number / null.
- `ascent` / `itra_score` are INTEGER columns with `Math.round` defense in
  `toRow`. `fromRow` returns numbers (or `null`), not strings — old
  localStorage data used strings, but the fresh-start migration drops that.
- `priority` enforces the DB CHECK constraint: when `isTarget === false`,
  `toRow` always emits `priority = null`, even if the caller forgot to clear
  the field. Single-field updates that don't touch `isTarget` (e.g.
  `updateRaceCategory`) pass through without altering `priority`.

### `coachMessages.js` notes

- Append-only at the row level — no `update` / single-row `delete`. The three
  exported functions are `listMyMessages`, `appendMessage(role, content)`,
  `clearAllMessages`.
- `listMyMessages()` orders by `created_at ASC` (oldest first) so chat UIs can
  render top-to-bottom without sorting.
- `clearAllMessages()` deletes with an explicit `.eq('user_id', uid)` filter
  in addition to RLS — defence-in-depth in case RLS is ever misconfigured.
- The current DeepSeek call in `AICoachTab.sendChat` is **non-streaming** —
  `resp.json()` returns the full assistant turn at once, so one `appendMessage`
  call per assistant reply is correct. If streaming is ever added, do NOT
  call `appendMessage` per token: hold the partial text in local state and
  commit one row at completion.
