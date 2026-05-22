# Training Log

Every workout in Training Studio falls into one of three groups: **Run**, **Strength**, or **HIIT**. The log is your single source of truth — it feeds the stats bar, the charts, the AI coach data block, and the personal-records aggregation.

## Activity types

| Group | Type | Tracks |
|---|---|---|
| Run | Road Run | distance, duration, pace, HR, ascent, cadence, GAP, aerobic TE |
| Run | Trail Run | distance, duration, pace, HR, ascent, aerobic TE |
| Run | Hiking | distance, duration, pace, HR, ascent, aerobic TE |
| Run | Floor Climbing | duration, HR, ascent (no horizontal distance) |
| Strength | Strength | duration, HR, optional body-part split |
| HIIT | HIIT | duration, HR, aerobic TE |

Sub-types behave differently per group:

- **Road Run** requires one pace sub-type (Easy / Aerobic / Tempo / Interval) and can carry a `Race` flag. See [Running](running.md) for the auto-classification rules.
- **Other Run types** (Trail / Hiking / Floor Climbing) can carry the `Race` flag but skip pace classification — terrain dominates pace there.
- **Strength** can pick any combination of Upper Body / Lower Body / Core.
- **HIIT** has no sub-types.

> Active recovery is **not** a workout type. It's a day-level tag (`massage`, etc.) toggled on the Calendar tab.

## Adding a workout (manual)

1. Open the **Training** tab → click **Add Activity**.
2. Pick the date and type. Road Run defaults to Easy Run sub-type; everything else starts blank.
3. Fill in what you have. Only date and duration are required. Distance, HR, ascent, cadence, GAP, and aerobic TE are all optional — leave blank what you didn't measure.
4. Save. The row appears at the top of the Activities list and immediately feeds the period stats + charts.

## Editing a workout

Click any row on Training or Calendar to inline-edit. Clicking outside cancels — if you have unsaved changes, you'll get a confirmation prompt before discarding.

## Bulk operations

- **Select mode** (top-right of Activities) lets you tick multiple rows and bulk-delete.
- **Upload .csv** opens the Garmin CSV importer — see [Data Import](data-import.md).

## Filtering and periods

- The **Global Filter** chips at the top of Training apply to both the Activities list and the Charts sub-view. Filter by run sub-group (Road, Trail, Hiking, Floor Climbing), Strength body-parts, or HIIT.
- The **Period Selector** (Week / Month / Quarter / Year / Custom / All) controls the stats bar and the Activities list scope, but **not** the Charts time window — Charts has its own period chips.

## Notes

- Planned workouts (imported from AI Coach) are visible on the Calendar but **excluded** from the Training tab, the stats bar, the charts, and the personal-records bar. They only count once you mark them done.
- The 8-column metric grid on each row (distance, ascent, duration, pace, GAP, HR, TE, cadence) renders only the cells you populated — empty fields disappear, but the columns stay aligned across rows.
- Mobile (<1024 px wide) drops the grid and stacks metrics in a wrapping flex row.
