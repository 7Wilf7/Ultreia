# Charts

The Charts sub-view (Training tab → **Charts**) renders three visualizations over a configurable time window. All three respect the **Global Filter** at the top of the Training tab.

## Period picker

Five presets above the charts:

- Last **4 weeks** / Last **8 weeks**
- Last **6 months** / Last **12 months**
- Last **5 years**

Picking a preset changes the window for **all three charts** at once. The window always ends at "now" — there's no custom range here (that's on the period selector for the Activities view, not Charts).

## 1. Running distance trend

Line chart of total **running distance** (km) per bucket, where a bucket is a week / month / year depending on the active preset. "Running" here means any of the `RUN_GROUP_TYPES` — Road Run, Trail Run, Hiking, Floor Climbing. Strength and HIIT are excluded; they have no meaningful distance.

- Weeks bucket Mon → Sun (ISO-style); labels read e.g. `5-18~24` or `5-30~6-5` for cross-month weeks.
- Month buckets are calendar months.
- Year buckets are calendar years.
- The filled area under the line is purely decorative — "elevation profile" feel.

## 2. Run-type distribution

Horizontal bars showing how your Road Run time was split across the four pace sub-types (Easy / Aerobic / Tempo / Interval) over the current window.

**Weighted by duration in seconds**, not session count. Rationale: a 90-minute tempo run carries more training load than three 20-minute easy runs, so duration-weighting reflects intensity allocation better than frequency.

Trail Run / Hiking / Floor Climbing don't appear here — they have no pace sub-type. Strength and HIIT also excluded.

## 3. HR Zone distribution

Bars showing how your time was split across **your personal Karvonen zones** (Z1–Z5).

**Requires Profile setup**: Resting HR + Max HR + an HR zone method (Karvonen strict or Standard 5-zone). Without these, the card shows a "set HR zones in your profile" message instead.

**Approximation**: workouts only store avg HR per session (we don't have time-in-zone data from Garmin). Each session's **full duration** gets bucketed into the zone its avg HR falls into. For mixed-intensity sessions (e.g. an interval workout with warmup + cooldown) this under-represents zone diversity, but it's the right approximation given the data we capture.

Two extra rows surface only if non-zero:

- **Below Z1** — sessions whose avg HR was below your Z1 floor (warm-ups, very-easy recovery).
- **Above Z5** — sessions whose avg HR exceeded your Z5 ceiling (rare).

## Notes

- All three charts read from `filteredAllLogs` (the Global-Filtered set), so flipping filter chips on the Training tab immediately re-renders the charts.
- The distance trend uses local-time date components — going through `toISOString()` would shift the date by your timezone offset and cause off-by-one bucket assignment for any user east of UTC. Same trap is in `CalendarTab.dateKey`.
- Run-type chart bar colors ramp from ink (Easy) → moss (Interval) to mirror the intensity progression. HR zone bars ramp moss-light (Z1) → ink-1 (Z5) similarly.
- There is no time-in-zone integration; integrating Garmin's per-second HR samples would require switching back to a `.fit` parser, which was removed.
