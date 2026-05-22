# AI Coach

A daily-check-in chat with an LLM that's grounded in your actual training data, target races, and a long-term memory blob you control. Powered by **DeepSeek's Anthropic-compatible endpoint** — the URL is hardcoded; you supply only your API key.

## Setup

1. Click the **API** button in the top-right header.
2. Paste your DeepSeek API key (get one at [platform.deepseek.com](https://platform.deepseek.com/)).
3. Optionally pick a model preset. The key is stored in Supabase under `user_settings.api_key` (RLS-scoped to you).
4. Open the **AI Coach** tab. The chat history is persisted in Supabase (`coach_messages` table), so it survives refreshes and follows you across devices.

## What each turn sends

Every message you send rebuilds the request from scratch — no caching. The payload has two parts:

**1. `system` field** (rebuilt every turn):

- A **fixed prompt** that defines the coach's role and tone — see `FIXED_SYSTEM_PROMPT` in `src/constants.js`. Treats the user as the decision-maker; bans "must" / "禁止" language; tells the model to reply in the user's language.
- **Profile block** — age, gender, city, occupation, experience, injury history, available equipment, HR zones (if both Resting and Max HR are set). See [Profile](../src/utils/profile.js).
- **Coach Config block** — three axes (style, output length, intervention level), each with a 3-step soft-to-strict spectrum.
- **Memory block** — durable facts about you (see Memory below).
- **Data block** — current local time, all target races, a **subset of race history**, and the last 10 non-planned workouts.

**2. `messages` array** — your entire chat history from Supabase, plus the new turn.

## Race history is filtered

Sending every race every turn quickly bloats the prompt and dilutes signal. The data block sends a **per-category subset** of your history:

- **10K / HM / Marathon / Hyrox / Other** — latest 3 entries by date
- **Trail** — latest 3 + longest by distance (deduped if the longest is already in the 3)
- **Spartan** — latest 3 + toughest tier (deduped same way)

See `selectHistoryForPrompt` in [AICoachTab.jsx](../src/components/AICoachTab.jsx).

## Memory

A free-text blob you (or the LLM) curate over time. It's the durable layer: things like "Easy days have to be actually easy or my Achilles flares up" or "Training for 2026 UTMB CCC, August".

Two ways to update it:

- **Edit** — open Memory, click Edit, type, Save.
- **Auto-update from chat** — sends the current memory + the recent chat to the LLM, which returns a proposed updated version. You review and Accept or Discard.

The memory prompt explicitly asks the model to keep durable facts, drop session-specific noise, and stay under ~500 words.

## Long-chat hint

Once `coach_messages` hits **20 entries**, a soft amber banner appears above the chat suggesting you distill into Memory + Clear Chat. The chat history competes with the system prompt for the model's attention; periodically consolidating into Memory keeps responses sharp. Click the banner's button to jump to the Memory section.

## Import plan to Calendar

Below each assistant reply you'll see an **Import to Calendar** button. It makes a second LLM call that parses the reply into a structured JSON array of `{date, type, distance, duration, subTypes, notes}` plan items, with a review modal where you can adjust each item before importing. Imported items are written as `is_planned = true` workouts and show on the Calendar with dashed borders — they don't count toward stats or PRs until you mark them done.

## Preview Prompt

Toggle **Preview Prompt** to see exactly what gets sent. The toggle has an EN / 中 switch — the **English version is what the LLM actually receives** (more stable instruction-following); Chinese is for your reading only.

When both **Memory** and **Preview Prompt** are open on desktop, they render side-by-side so you can compare the durable layer against the assembled prompt.

## Token limits

All three LLM calls (chat / memory auto-update / plan extract) cap at `max_tokens: 8000`, which is DeepSeek's hard output ceiling on the Anthropic-compat endpoint. Anthropic billing is per actual output token, so the cap is free headroom — it only prevents truncation mid-sentence or mid-JSON.

## Notes

- DeepSeek is the only supported provider. The endpoint URL is in `DEFAULT_API_ENDPOINT` ([constants.js](../src/constants.js)) and not exposed in the UI.
- If the API returns 200 OK with an empty `content` array, the chat shows "No response." and logs the full response to the browser console as `[AI Coach] Empty reply` — useful for diagnosing model-ID issues.
- API errors (4xx/5xx) and network errors render as transient bubbles in the chat **without** persisting to Supabase. Refresh and they're gone.
