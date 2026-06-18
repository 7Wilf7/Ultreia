// Phase 2b — daily AI coach push dispatcher.
//
// Triggered by pg_cron every ~30 min. For each user who has daily push enabled
// and whose chosen local hour matches "now" in their timezone (and who hasn't
// been pushed today), it: pulls their recent training + target race, asks their
// wallet-backed shared DeepSeek key for ONE short check-in line, debits the
// wallet after a successful reply, and pushes it to their devices via FCM.
// Dedup is enforced by push_log (unique on user_id + local date).
//
// Auth: this function runs with Verify JWT = OFF (it's called by cron, not a
// logged-in user). It instead checks a shared header x-cron-secret == CRON_SECRET.
//
// Secrets (Edge Function → Secrets):
//   FCM_SERVICE_ACCOUNT  – service-account JSON (same one push-test uses)
//   CRON_SECRET          – random string; must match what the cron SQL sends
//   SHARED_DEEPSEEK_KEY  – owner DeepSeek key used server-side only
// Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";

const DEEPSEEK_URL = "https://api.deepseek.com/anthropic/v1/messages";
const DEEPSEEK_MODEL = "deepseek-v4-pro";
const DEEPSEEK_PRICING_CNY_PER_M = { input: 3.16, inputCacheHit: 0.026, output: 6.32 };
const MIN_AI_CHARGE_CENTS = 1;
const AI_CHARGE_POLICY = "actual_cost_min_1_cent";

function tokenUsage(usage: unknown): {
  input: number;
  output: number;
  total: number;
  inputCacheHit: number;
  inputCacheMiss: number;
} {
  const u = (usage && typeof usage === "object") ? usage as Record<string, unknown> : {};
  const input = Number(u.input_tokens ?? u.prompt_tokens ?? u.inputTokens ?? u.promptTokens ?? 0);
  const output = Number(u.output_tokens ?? u.completion_tokens ?? u.outputTokens ?? u.completionTokens ?? 0);
  const inputCacheHit = Number(u.prompt_cache_hit_tokens ?? u.cache_read_input_tokens ?? 0);
  const inputCacheMiss = Number(u.prompt_cache_miss_tokens ?? 0);
  const totalInput = Math.max(input, inputCacheHit + inputCacheMiss);
  const total = Number(u.total_tokens ?? u.totalTokens ?? totalInput + output);
  return {
    input: Number.isFinite(input) ? input : 0,
    output: Number.isFinite(output) ? output : 0,
    total: Number.isFinite(total) ? Math.max(total, totalInput + output) : 0,
    inputCacheHit: Number.isFinite(inputCacheHit) ? inputCacheHit : 0,
    inputCacheMiss: Number.isFinite(inputCacheMiss) ? inputCacheMiss : 0,
  };
}

function calcChargeCents(usage: unknown): {
  actualCostCents: number;
  chargeCents: number;
  billableUsage: ReturnType<typeof tokenUsage>;
} {
  const tokens = tokenUsage(usage);
  const hasInputCacheBreakdown = tokens.inputCacheHit > 0 || tokens.inputCacheMiss > 0;
  const inputCny = hasInputCacheBreakdown
    ? (tokens.inputCacheHit / 1_000_000) * DEEPSEEK_PRICING_CNY_PER_M.inputCacheHit
      + (tokens.inputCacheMiss / 1_000_000) * DEEPSEEK_PRICING_CNY_PER_M.input
      + (Math.max(0, tokens.input - tokens.inputCacheHit - tokens.inputCacheMiss) / 1_000_000) * DEEPSEEK_PRICING_CNY_PER_M.input
    : (tokens.input / 1_000_000) * DEEPSEEK_PRICING_CNY_PER_M.input;
  const actualCny = inputCny + (tokens.output / 1_000_000) * DEEPSEEK_PRICING_CNY_PER_M.output;
  const actualCostCents = Math.round(actualCny * 100);
  const chargeCents = Math.max(MIN_AI_CHARGE_CENTS, actualCostCents);
  return { actualCostCents, chargeCents, billableUsage: tokens };
}

// ── FCM HTTP v1 auth (mirrors push-test) ──
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function getAccessToken(sa: { client_email: string; private_key: string; token_uri: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: sa.token_uri, iat: now, exp: now + 3600,
  }));
  const signingInput = `${header}.${claims}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${base64url(new Uint8Array(sig))}`;
  const resp = await fetch(sa.token_uri, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`token exchange failed: ${JSON.stringify(data)}`);
  return data.access_token as string;
}
async function sendPush(projectId: string, accessToken: string, token: string, title: string, body: string) {
  const resp = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    // android.notification.channel_id must match a channel created on the
    // device (push.js createChannel) or Android 8+ silently drops the tray
    // notification. priority:high improves delivery on aggressive ROMs.
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        android: { priority: "high", notification: { channel_id: "daily_coach" } },
      },
    }),
  });
  const respBody = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, body: respBody };
}

// ── Wall-clock hour + minute + date in a given IANA timezone ──
function localParts(tz: string): { hour: number; minute: number; date: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    hour: parseInt(get("hour"), 10) % 24,
    minute: parseInt(get("minute"), 10) || 0,
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

// ── Compact daily-checkin prompt ──
function weeksUntil(dateStr: string): number | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return null;
  const days = Math.round((d.getTime() - Date.now()) / 86400000);
  return days < 0 ? null : Math.floor(days / 7);
}
function fmtDuration(sec: number): string {
  if (!sec) return "";
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60}m` : `${m}min`;
}
function buildPrompt(opts: {
  lang: string; name: string; today: string;
  workouts: any[]; targetRace: any | null; memory: string;
  recentChat?: { role: string; content: string }[];
}): { system: string; user: string } {
  const langName = opts.lang === "zh" ? "Chinese (简体中文)" : "English";
  const lines = (opts.workouts || []).slice(0, 8).map((w) => {
    const bits = [w.date, w.type];
    if (w.distance > 0) bits.push(`${w.distance}km`);
    if (w.duration > 0) bits.push(fmtDuration(w.duration));
    if (w.hr > 0) bits.push(`HR${w.hr}`);
    if (w.rpe) bits.push(`RPE${w.rpe}`);
    if (w.note) bits.push(`note:${String(w.note).replace(/\s+/g, " ").slice(0, 60)}`);
    return bits.join(" ");
  });
  let race = "none";
  if (opts.targetRace) {
    const w = weeksUntil(opts.targetRace.date);
    race = `${opts.targetRace.name}${opts.targetRace.date ? ` on ${opts.targetRace.date}` : ""}${w != null ? ` (~${w} weeks out)` : ""}`;
  }
  const system =
    `You are this runner's coach. Write ONE short daily check-in to push as a phone notification. ` +
    `LANGUAGE (most important): write the ENTIRE message in ${langName}, and ONLY ${langName}. ` +
    `The data below (training notes, coach chat, race names) may be in another language — IGNORE its language and still write your message in ${langName}. Do not mix languages. ` +
    `Other hard rules: at most 2 sentences; no greeting, no sign-off, no markdown, no emoji; ` +
    `be specific and actionable using the data (e.g. if yesterday was hard, suggest easy today; mind the race countdown). ` +
    `If [Recent coach chat] is present, treat it as the FRESHEST context: reference what the runner just told you (a session they're doing today, how they feel, a change of plan) and stay consistent with it — do NOT just repeat the same race reminder every day; vary the focus. ` +
    `If there's no recent training, give a brief encouraging nudge. Output ONLY the message text.`;
  // Recent in-app coach chat — most recent last. Lets the push pick up what the
  // runner just told the coach (e.g. "bootcamp tonight") instead of only the
  // structured data. Each turn truncated so a long reply can't blow up the prompt.
  const chatLines = (opts.recentChat || []).map((m) => {
    const who = m.role === "user" ? "Runner" : "Coach";
    const text = String(m.content || "").replace(/\s+/g, " ").trim().slice(0, 200);
    return text ? `${who}: ${text}` : "";
  }).filter(Boolean);
  const chatBlock = chatLines.length
    ? `[Recent coach chat (most recent last)]\n${chatLines.join("\n")}\n`
    : "";
  const user =
    `[Today] ${opts.today}\n` +
    `[Recent training (newest first)]\n${lines.length ? lines.join("\n") : "none"}\n` +
    `[Target race] ${race}\n` +
    chatBlock +
    (opts.memory ? `[Notes about this runner] ${opts.memory.slice(0, 600)}\n` : "");
  return { system, user };
}

async function callLLM(key: string, system: string, user: string): Promise<{ text: string; usage: unknown; id: string }> {
  const resp = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      // Generous cap: deepseek-v4-pro is a reasoning model, so the thinking
      // tokens count against max_tokens — too low and the visible answer comes
      // back empty. The notification stays short via the prompt, not the cap;
      // billing is by actual tokens so unused headroom costs nothing.
      model: DEEPSEEK_MODEL,
      max_tokens: 8000,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`LLM ${resp.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return {
    text: (data.content?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("") || "").trim(),
    usage: data.usage || null,
    id: String(data.id || ""),
  };
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  // Cron-only: reject anything without the shared secret.
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    return json({ error: "unauthorized" }, 401);
  }
  try {
    const saRaw = Deno.env.get("FCM_SERVICE_ACCOUNT");
    if (!saRaw) return json({ error: "FCM_SERVICE_ACCOUNT not set" }, 500);
    const sa = JSON.parse(saRaw);
    const deepseekKey = Deno.env.get("SHARED_DEEPSEEK_KEY");
    if (!deepseekKey) return json({ error: "SHARED_DEEPSEEK_KEY not set" }, 500);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Everyone with push enabled; we filter by local half-hour slot in JS.
    const { data: settings, error: sErr } = await supabase
      .from("user_settings")
      .select("user_id, push_hours, push_times, push_timezone, coach_memory, lang")
      .eq("push_enabled", true);
    if (sErr) return json({ error: sErr.message }, 500);

    let fcmAccessToken: string | null = null;
    const summary: any[] = [];

    for (const u of settings || []) {
      const tz = u.push_timezone || "UTC";
      const { hour, minute, date } = localParts(tz);
      // Floor the wall clock to the half-hour slot this cron tick belongs to.
      const slotMin = minute < 30 ? 0 : 30;
      const slotStr = `${String(hour).padStart(2, "0")}:${slotMin === 0 ? "00" : "30"}`;
      const slotIdx = hour * 2 + (slotMin === 30 ? 1 : 0); // 0..47, stored in push_log.hour
      // Due if the user's chosen times include this slot. Prefer the new
      // push_times ("HH:MM"); fall back to the legacy whole-hour push_hours.
      const times: string[] = Array.isArray(u.push_times) && u.push_times.length
        ? u.push_times
        : (Array.isArray(u.push_hours) ? u.push_hours.map((h: number) => `${String(h).padStart(2, "0")}:00`) : []);
      if (!times.includes(slotStr)) continue;

      // Dedup per (user, local date, slot): each chosen half-hour fires once a
      // day even though the cron polls every 5 min. We reuse push_log.hour to
      // store the slot index 0..47 (hour*2 + half) so no schema change is
      // needed — old rows held 0..23 but they're scoped to past sent_on dates.
      const { data: logged } = await supabase
        .from("push_log").select("id").eq("user_id", u.user_id).eq("sent_on", date).eq("hour", slotIdx).maybeSingle();
      if (logged) continue;

      // Claim the slot first (UNIQUE(user_id, sent_on, hour) stops a double-fire
      // from the next poll tick). Conflict → someone took it.
      const { error: claimErr } = await supabase
        .from("push_log").insert({ user_id: u.user_id, sent_on: date, hour: slotIdx });
      if (claimErr) { summary.push({ user: u.user_id, skipped: "already-claimed" }); continue; }

      const { error: ensureErr } = await supabase.rpc("wallet_ensure", {
        p_user_id: u.user_id,
        p_initial_cents: 500,
      });
      if (ensureErr) { summary.push({ user: u.user_id, error: "wallet_ensure_failed" }); continue; }
      const { data: wallet } = await supabase
        .from("wallets")
        .select("balance_cents")
        .eq("user_id", u.user_id)
        .single();
      if ((wallet?.balance_cents ?? 0) < MIN_AI_CHARGE_CENTS) {
        summary.push({ user: u.user_id, skipped: "insufficient_balance" });
        continue;
      }

      const { data: workouts } = await supabase
        .from("workouts")
        .select("date, type, distance, duration, hr, rpe, note")
        .eq("user_id", u.user_id).eq("is_planned", false)
        .order("date", { ascending: false }).limit(8);
      const { data: races } = await supabase
        .from("races").select("name, date")
        .eq("user_id", u.user_id).eq("is_target", true)
        .order("date", { ascending: true });
      const targetRace = (races || []).find((r) => r.date) || (races || [])[0] || null;

      // Travel today/tomorrow → let the push reference the trip (local running,
      // Recent in-app coach chat (last ~8 turns, chronological) so the push can
      // reference what the runner just told the coach.
      const { data: chatRows } = await supabase
        .from("coach_messages")
        .select("role, content")
        .eq("user_id", u.user_id)
        .order("created_at", { ascending: false })
        .limit(8);
      const recentChat = (chatRows || []).reverse();

      const { system, user } = buildPrompt({
        lang: u.lang || "en", name: "", today: date,
        workouts: workouts || [], targetRace, memory: u.coach_memory || "",
        recentChat,
      });

      let message = "";
      let usage: unknown = null;
      let upstreamId = "";
      try {
        const llm = await callLLM(deepseekKey, system, user);
        message = llm.text;
        usage = llm.usage;
        upstreamId = llm.id;
      } catch (e) {
        summary.push({ user: u.user_id, error: `llm: ${String(e).slice(0, 120)}` });
        continue;
      }
      if (!message) { summary.push({ user: u.user_id, error: "empty llm reply" }); continue; }

      const { actualCostCents, chargeCents, billableUsage } = calcChargeCents(usage);
      const { error: debitErr } = await supabase.rpc("wallet_debit", {
        p_user_id: u.user_id,
        p_amount_cents: chargeCents,
        p_kind: "ai_charge",
        p_provider: "deepseek",
        p_request_id: upstreamId ? `daily-coach:${upstreamId}` : `daily-coach:${u.user_id}:${date}:${slotIdx}`,
        p_metadata: {
          source: "daily_coach_dispatch",
          model: DEEPSEEK_MODEL,
          usage,
          billable_usage: billableUsage,
          actual_cost_cents: actualCostCents,
          charge_policy: AI_CHARGE_POLICY,
        },
      });
      if (debitErr) {
        const insufficient = String(debitErr.message || "").includes("insufficient_balance");
        summary.push({ user: u.user_id, error: insufficient ? "insufficient_balance" : "wallet_debit_failed" });
        continue;
      }

      const { data: subs } = await supabase
        .from("push_subscriptions").select("fcm_token").eq("user_id", u.user_id);
      if (!subs || subs.length === 0) { summary.push({ user: u.user_id, error: "no devices" }); continue; }

      if (!fcmAccessToken) fcmAccessToken = await getAccessToken(sa);
      let sent = 0;
      const fcmErrors: any[] = [];
      for (const s of subs) {
        const r = await sendPush(sa.project_id, fcmAccessToken, s.fcm_token, "Ultreia", message);
        if (r.ok) sent++;
        // Surface FCM rejections (invalid/stale token, sender mismatch, etc.)
        // so a manual invoke shows WHY a push didn't land instead of silently
        // counting 0 sent.
        else fcmErrors.push({ status: r.status, error: (r.body as any)?.error?.status || (r.body as any)?.error?.message || r.body });
      }

      // Persist the message to the in-app inbox so the user can re-read it
      // after the system notification is dismissed. Best-effort: a failed
      // insert shouldn't fail the dispatch (the push already went out).
      const { error: inboxErr } = await supabase
        .from("push_inbox").insert({ user_id: u.user_id, body: message });
      if (inboxErr) summary.push({ user: u.user_id, warn: `inbox insert: ${inboxErr.message}` });

      summary.push({ user: u.user_id, sent, devices: subs.length, fcmErrors, chargeCents, actualCostCents, message });
    }

    return json({ processed: summary.length, summary });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
