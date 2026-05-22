# Data Import (Garmin CSV)

Training Studio imports activities from a **Garmin Connect CSV export**. (Direct `.fit` parsing was removed in commit `487f409`; CSV is the only batch path now.)

## Exporting from Garmin Connect

1. Go to Garmin Connect → **Activities** → list view.
2. Filter / date-range as you want (the importer doesn't care — it'll show you every row).
3. Click the **Export CSV** button (top-right of the list).
4. Save the file locally.

## Importing

1. Open the **Training** tab → **Activities** sub-view.
2. Click **Upload .csv** and pick the file.
3. Two review modals may appear, in order:
   - **Unknown activity types** — if any rows have a type the mapper doesn't recognize (e.g. "Open Water Swim", "Padel"), you'll be asked to pick a Training Studio type for each one. The mapper covers the common cases (run, trail run, hiking, walking, stair stepper, HIIT, crossfit, strength, weight training, yoga, pilates).
   - **Duplicate warning** — if any incoming row matches an existing workout on the same date/type/duration, you'll be offered **Skip duplicates** or **Add anyway**.
4. The **Review** panel then shows every row with its parsed metrics and a checkbox per row. You can:
   - Untick rows you don't want imported.
   - For Road Run rows, override the auto-classified pace sub-type via the dropdown.
5. Click **Import** to write the selected rows to Supabase.

## What gets parsed

The importer looks for these Garmin column names (case-insensitive, first match wins for duration):

| CSV column | Maps to |
|---|---|
| Activity Type | type (via the mapper) |
| Date | date (only the YYYY-MM-DD part) |
| Distance | distance (km) |
| Time / Total Time / Moving Time / Elapsed Time | duration |
| Avg HR | hr |
| Max HR | maxHR |
| Total Ascent | ascent |
| Avg Run Cadence | cadence |
| Aerobic TE | aerobicTE |
| Avg GAP | gap (grade-adjusted pace) |

Pace is computed: `duration / distance` (only when both > 0). For Strength and HIIT the pace field stays 0 — those have no meaningful pace.

## Activity type mapping

The mapper inspects the lowercased "Activity Type" cell:

| If it contains | Mapped to |
|---|---|
| `trail` | Trail Run |
| `hiking`, `walking`, `walk` | Hiking |
| `stair`, `stepper`, `step machine`, `floor` | Floor Climbing |
| `hiit`, `interval training`, `crossfit` | HIIT |
| `strength`, `weight` | Strength |
| `yoga`, `pilates`, `stretch` | Strength |
| `run` (and none of the above) | Road Run |
| anything else | flagged as unknown (you'll be asked) |

See `mapGarminActivityType` in [ActivitiesTab.jsx](../src/components/ActivitiesTab.jsx).

## Duplicate detection

A row is considered a duplicate of an existing log if all of these match:

- date (YYYY-MM-DD)
- type
- duration in seconds

See `isDuplicate` in `src/utils/format.js`. **Skip** drops only the duplicates from the import; **Add anyway** brings them in (you'll end up with two rows for the same workout — useful only if Garmin split a single session into two exports).

## Notes

- The CSV file is parsed entirely client-side. It is **not** uploaded anywhere except as individual rows written to Supabase after you confirm.
- The Garmin export's column names change between app versions / locales / device types. If the importer says "No duration column found" check the browser console — it logs the headers it actually saw, so you can spot the version drift.
- The "Activity Type" mapper is intentionally conservative. New activity types (e.g. rowing, cycling) currently fall through to the unknown-type modal — extend `mapGarminActivityType` to add proper handling.
- The numeric `id` Garmin gives each row is discarded — Supabase generates a UUID server-side. Staging-only fields (anything prefixed `_`) are stripped before insert.
