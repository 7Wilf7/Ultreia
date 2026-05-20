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

## Stages

1. **Scaffold (current)** — every function exists with the right signature
   but throws `'… not implemented yet'`. Files carry an
   `eslint-disable no-unused-vars` header that should be removed once the
   real implementation lands.
2. **Implementation** — fill in real Supabase queries, table by table.
3. **Migration** — switch call sites from `localStorage` to these functions.
4. **Cleanup** — remove `src/utils/migrate.js` and other legacy
   `localStorage`-only code paths.
