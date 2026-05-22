# Running (Pace Classification)

Road Run workouts get one **pace sub-type** so the Charts and the AI coach can reason about intensity allocation. There are four sub-types and one orthogonal flag.

## Sub-types

| Sub-type | What it means |
|---|---|
| Easy Run | Conversational, recovery / base mileage |
| Aerobic Run | Steady aerobic effort, still below threshold |
| Tempo Run | Lactate-threshold work, comfortably hard |
| Interval Run | Above-threshold reps, VO2max range |

Plus one independent flag that can coexist with any pace sub-type:

- **Race** — marks the session as a competitive effort. Surfaced with a different chip color (warning amber) in the activity list.

## Auto-classification (Garmin CSV imports only)

When you import a Garmin CSV, Road Run rows get a pace sub-type pre-filled from average heart rate via `autoClassifyRun` ([utils/format.js](../src/utils/format.js)):

| Avg HR (bpm) | Sub-type assigned |
|---|---|
| missing | Easy Run |
| < 150 | Easy Run |
| 150 – 164 | Aerobic Run |
| 165 – 174 | Tempo Run |
| ≥ 175 | Interval Run |

These thresholds are **hardcoded global constants**, not derived from your personal HR zones in Profile. They're designed for a moderately trained adult; if your zones sit much higher or lower, expect the pre-fill to drift — review and adjust in the CSV-import preview before confirming.

> Trail Run / Hiking / Floor Climbing do **not** get auto-classified — terrain dominates pace there, so an HR-based intensity bucket would mislead. The function returns an empty sub-type list for these.

## Manual sub-type selection

For new activities entered through the form, Road Run defaults to **Easy Run**. Change it by clicking another pace chip before saving. The pace chips are mutually exclusive — picking one replaces the previous; the Race flag toggles independently.

## How it shows up in stats

- The **Charts → Run type distribution** chart aggregates Road Run rows by sub-type, weighted by **duration in seconds** (not session count). A 90-minute tempo run weighs more than three 20-minute easies, which better reflects training load.
- Other Run types (Trail / Hiking / Floor Climbing) are excluded from this chart since they have no pace sub-type.
- The **AI Coach data block** sends each activity with its sub-type appended in parentheses, so the coach knows whether last week's 60 km was easy base or tempo-heavy.

## Notes

- Sub-types are stored as an array on the workout row (`subTypes: ["Tempo Run", "Race"]`) — that's how the Race flag coexists with a pace bucket.
- Changing the thresholds means editing `autoClassifyRun` in `src/utils/format.js`. There's no UI for this and no per-user override.
- If your profile has Resting HR + Max HR + an HR zone method set, the Charts tab will also render a **HR Zone Distribution** card — that one *does* use your personal Karvonen zones. See [Charts](charts.md).
