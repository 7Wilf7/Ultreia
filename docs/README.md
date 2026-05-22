# Training Studio

A personal endurance-training workspace for runners — race-prep, daily logging, and an AI coach in one single-page app.

## What it is

A React 19 + Vite single-page app backed by Supabase. Data is per-user (auth via email magic link); every record (workouts, races, coach chat, profile) is scoped by `auth.uid()` through row-level security.

## What you can do

- **Log workouts** — manual entry or bulk-import a Garmin CSV. Supports Road Run, Trail Run, Hiking, Floor Climbing, Strength, and HIIT.
- **Auto-classify road runs** by average heart rate into Easy / Aerobic / Tempo / Interval.
- **Plan and track races** — target races with A/B/C priority, race history with finish times, and an auto-aggregated personal-records bar (one PR per category).
- **Visualize trends** — weekly / monthly / yearly running distance, road-run intensity distribution, and heart-rate-zone time distribution.
- **Chat with an AI coach** that sees your profile, recent training data, target races, and a long-term memory blob; it can propose plans you can import straight onto the Calendar.
- **Plan view on the Calendar tab** — month grid with both completed and planned workouts (planned ones are dashed and don't count toward stats until marked done).

## Layout

Four top-level tabs:

1. **Training** — activity log + the Charts sub-view.
2. **Calendar** — month grid, click a day to edit/plan.
3. **Races** — target list, history list, PR bar.
4. **AI Coach** — chat, memory, prompt preview.

## Tech stack

- Vite 8 + React 19 (JSX, no TypeScript)
- Supabase for auth + data (`profiles`, `user_settings`, `workouts`, `races`, `coach_messages`, `daily_notes`)
- DeepSeek's Anthropic-compatible endpoint for the AI coach
- ESLint 10, no test framework yet

## Where to start

- New here? Read [Training Log](training-log.md) to understand activity types.
- Importing Garmin data? See [Data Import](data-import.md).
- Setting up the AI coach? See [AI Coach](ai-coach.md).
