# Races

The Races tab handles two related things: races you're **targeting** in the future, and races you've **completed** in the past. They share a table and the same form — the `is_target` flag distinguishes them. The Personal Records bar at the top auto-aggregates the best entry per category from your history.

## Race categories

Seven canonical categories, in display order:

1. **10K**
2. **Half Marathon**
3. **Marathon**
4. **Trail** — variable distance, has ascent field
5. **Spartan** — sub-typed by tier (Sprint / Super / Beast / Ultra), ranked by difficulty
6. **Hyrox** — fixed indoor format, no distance/ascent fields
7. **Other** — catch-all

This order drives both the form dropdown and the PR bar.

## Target races (`is_target = true`)

Sorted **date ascending** (next race coming up first). Each has:

- **Priority** — A / B / C. A = "the race that shapes the season", B = secondary, C = participation. Priority drives PR-bar color and gets passed to the AI coach as "Priority A/B/C" so the coach knows which races matter most.
- **Category** + (Spartan only) tier
- **Date**
- **Distance / Ascent** — for Trail and Other; hidden for road categories (distance is implicit in the category) and Hyrox
- **Name**

### Adding a target

1. Races tab → **Add Target Race**.
2. Pick category first — the form re-renders to hide/show fields based on what makes sense.
3. Fill name, date, priority, plus distance/ascent if shown.
4. If the date is in the past, you get a warning offering to file it under History instead.

## Race history (`is_target = false`)

Sorted **date descending** (most recent first). Same form as targets, plus a **finish time** field (H:M:S). Trail entries also have an optional **ITRA performance index** badge, edited inline from the PR bar.

## Filtering

Each section (Target + History) has its own row of category filter chips. Multi-select — click any combination of categories to narrow; click **All** to clear. The count next to the section title shows `filtered / total` when a filter is active.

## Personal Records bar

Sits at the top of the Races tab and auto-aggregates one PR per category from your history list:

- **10K / Half Marathon / Marathon / Hyrox / Other** — ranked by **fastest finish time**.
- **Trail** — ranked by **longest distance** (since trail "PR" is more about volume than speed).
- **Spartan** — ranked by **toughest tier** (Ultra > Beast > Super > Sprint).

Expand "+ other finishes" on any PR card to see the rest of the entries for that category.

### ITRA

The Trail PR card has a small badge in its top-right corner labeled **ITRA**. Click it to enter or update your global ITRA Performance Index. This is a single value per user (not per-race) — the per-race ITRA scores on individual history entries are kept for backward-compat but no longer edited from the race form.

## Editing / deleting

Click any race row to inline-edit. The category picker on uncategorized rows lets you set a category without opening the full form. The × at the right deletes (with confirmation).

## Notes

- Target races feed the AI Coach's data block in full; history is **filtered** to keep the prompt focused — latest 3 per category, plus the longest Trail and toughest Spartan as anchors. See [AI Coach](ai-coach.md) for details.
- The PR bar uses CSS Grid `auto-fit` to wrap on narrow screens — vertical dividers are per-cell `border-left`, not modulo-based, so the rule between cards holds at any wrap count.
- Spartan tier is stored in the `subtype` field (shared with Run sub-types in the schema), and the PR bar reads it via the `SPARTAN_RANK` map.
