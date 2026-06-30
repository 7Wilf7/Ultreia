// Phase 2b — daily AI coach push dispatcher.
//
// Triggered by pg_cron every ~30 min. For each user who has daily push enabled
// and whose chosen local hour matches "now" in their timezone (and who hasn't
// been pushed today), it: pulls their recent training + target race, asks the
// configured AI route for ONE short check-in line, and pushes it to their
// devices via FCM. AI calls do not check wallet balance or debit wallet records
// in personal mode.
//
// Optional request body:
//   { "mode": "weekly_recap", "force": true, "user_id": "..." }
// runs the Phase 2 weekly report loop: reads the user's configured local
// weekday/time, writes the full report to coach_reports, then sends a short
// inbox/system notification. No calendar or Memory data is changed.
//   { "mode": "memory_update", "force": true, "user_id": "..." }
// runs a nightly Memory review: if the user has opted in and had new coach
// chat on the previous local day, create a pending memory_update Action Card.
// It does NOT write coach_memory_facts; the app opens the normal review UI next launch.
// Daily dedup is enforced by push_log (unique on user_id + local date).
// Weekly recap dedup is enforced by an existing ready auto report for the same
// report period; failed/interrupted attempts remain retryable.
//
// Auth: this function runs with Verify JWT = OFF (it's called by cron, not a
// logged-in user). It instead checks a shared header x-cron-secret == CRON_SECRET.
//
// Secrets (Edge Function → Secrets):
//   FCM_SERVICE_ACCOUNT  – service-account JSON (same one push-test uses)
//   CRON_SECRET          – random string; must match what the cron SQL sends
//   SHARED_DEEPSEEK_KEY  – owner DeepSeek key used server-side only as fallback
// Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";

const DEEPSEEK_URL = "https://api.deepseek.com/anthropic/v1/messages";
const DEEPSEEK_MODEL = "deepseek-v4-pro";
const DESKTOP_CODEX = {
  id: "desktop_codex",
  model: "codex-cli",
} as const;
const DESKTOP_RUNNER_FRESH_MS = 20_000;
const DESKTOP_CODEX_ERROR_COOLDOWN_MS = 5 * 60_000;
const DESKTOP_CODEX_AUTH_ERROR_COOLDOWN_MS = 24 * 60 * 60_000;
const DESKTOP_JOB_TTL_MS = 2 * 60_000;
const DESKTOP_POLL_MS = 1000;

type DispatchMode = "daily_checkin" | "weekly_recap" | "memory_update";
type AiJobKind = "daily_checkin" | "weekly_report" | "memory_update";
type LlmProvider = "desktop_codex" | "deepseek";
type LlmResult = {
  text: string;
  usage: unknown;
  id: string;
  provider: LlmProvider;
  model: string;
  fallback: Record<string, unknown> | null;
  desktopJob?: Record<string, unknown> | null;
};

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
  return { actualCostCents: 0, chargeCents: 0, billableUsage: tokenUsage(usage) };
}

function numberEnv(name: string, fallback: number): number {
  const n = Number(Deno.env.get(name));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function ageMsFromIso(value: unknown): number | null {
  const text = stringValue(value);
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? Math.max(0, Date.now() - ms) : null;
}

function codexStatusValue(value: unknown): "ok" | "error" | "auth_error" | "unknown" {
  const status = stringValue(value);
  if (status === "ok" || status === "error" || status === "auth_error") return status;
  return "unknown";
}

function codexErrorCooldownMs(status: string): number {
  return status === "auth_error" ? DESKTOP_CODEX_AUTH_ERROR_COOLDOWN_MS : DESKTOP_CODEX_ERROR_COOLDOWN_MS;
}

function aiJobKindForMode(mode: DispatchMode): AiJobKind {
  return mode === "weekly_recap" ? "weekly_report" : mode;
}

function providerPreference(value: unknown): "auto" | "prefer_codex" | "deepseek_only" {
  const pref = String(value || "auto");
  return pref === "prefer_codex" || pref === "deepseek_only" ? pref : "auto";
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

function localDateTimeToUtcIso(dateStr: string, timeStr: string, tz: string): string {
  let guess = new Date(`${dateStr}T${timeStr}:00Z`);
  const desiredMs = Date.parse(`${dateStr}T${timeStr}:00Z`);
  for (let i = 0; i < 3; i += 1) {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    const parts = fmt.formatToParts(guess);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const seenMs = Date.parse(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:00Z`);
    guess = new Date(guess.getTime() + (desiredMs - seenMs));
  }
  return guess.toISOString();
}

function localDateUtcWindow(dateStr: string, tz: string): { startIso: string; endIso: string } {
  return {
    startIso: localDateTimeToUtcIso(dateStr, "00:00", tz),
    endIso: localDateTimeToUtcIso(dateAdd(dateStr, 1), "00:00", tz),
  };
}

function dateAdd(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekWindow(dateStr: string): { start: string; end: string; nextStart: string; nextEnd: string } {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay(); // Sun=0
  const mondayOffset = (day + 6) % 7;
  const start = dateAdd(dateStr, -mondayOffset);
  const end = dateAdd(start, 6);
  return { start, end, nextStart: dateAdd(start, 7), nextEnd: dateAdd(start, 13) };
}

function fmtKm(n: number): string {
  return Number(n || 0) > 0 ? `${Number(n).toFixed(1)}km` : "";
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

const CN_DIGIT: Record<string, number> = {
  "零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4,
  "五": 5, "六": 6, "七": 7, "八": 8, "九": 9,
};
const CN_NUM_RE = "[零〇一二两三四五六七八九十百]+";
const CN_DECIMAL_RE = "[零〇一二两三四五六七八九]+";

function parseChineseInteger(raw: string): number | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  if (!/[十百]/u.test(text)) {
    let out = "";
    for (const ch of text) {
      if (!(ch in CN_DIGIT)) return null;
      out += String(CN_DIGIT[ch]);
    }
    const n = Number(out);
    return Number.isFinite(n) ? n : null;
  }
  let total = 0;
  let section = 0;
  let current = 0;
  for (const ch of text) {
    if (ch in CN_DIGIT) {
      current = CN_DIGIT[ch];
    } else if (ch === "十") {
      section += (current || 1) * 10;
      current = 0;
    } else if (ch === "百") {
      section += (current || 1) * 100;
      current = 0;
    } else {
      return null;
    }
  }
  total = section + current;
  return total > 0 ? total : null;
}

function parseChineseDecimal(intPart: string, decimalPart: string): string | null {
  const n = parseChineseInteger(intPart);
  if (n == null) return null;
  let decimals = "";
  for (const ch of String(decimalPart || "")) {
    if (!(ch in CN_DIGIT)) return null;
    decimals += String(CN_DIGIT[ch]);
  }
  return decimals ? `${n}.${decimals}` : String(n);
}

function normalizeDailyCheckinText(text: string): string {
  let out = String(text || "").trim();
  if (!out) return out;
  out = out
    .replace(/海洛克斯/gu, "HYROX")
    .replace(/\bhyrox\b/gi, "HYROX")
    .replace(new RegExp(`(${CN_NUM_RE})月(${CN_NUM_RE})[日号]`, "gu"), (_m, month, day) => {
      const mm = parseChineseInteger(month);
      const dd = parseChineseInteger(day);
      return mm != null && dd != null ? `${mm}月${dd}日` : _m;
    })
    .replace(new RegExp(`(${CN_NUM_RE})点(${CN_DECIMAL_RE})(?:公里|千米)`, "gu"), (_m, intPart, decimalPart) => {
      const value = parseChineseDecimal(intPart, decimalPart);
      return value ? `${value}km` : _m;
    })
    .replace(new RegExp(`(${CN_NUM_RE})(?:公里|千米)`, "gu"), (_m, value) => {
      const n = parseChineseInteger(value);
      return n != null ? `${n}km` : _m;
    })
    .replace(/(\d+(?:\.\d+)?)\s*(?:公里|千米)/gu, "$1km")
    .replace(new RegExp(`(${CN_NUM_RE})小时`, "gu"), (_m, value) => {
      const n = parseChineseInteger(value);
      return n != null ? `${n}h` : _m;
    })
    .replace(new RegExp(`(${CN_NUM_RE})周`, "gu"), (_m, value) => {
      const n = parseChineseInteger(value);
      return n != null ? `${n}周` : _m;
    });
  return out;
}

function buildPrompt(opts: {
  lang: string; name: string; today: string;
  workouts: any[]; targetRace: any | null; memory: string;
  recentChat?: { role: string; content: string }[];
}): { system: string; user: string } {
  const langName = "Chinese (简体中文)";
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
    `Chinese style rules: write like a Chinese runner would actually read it. Keep race/product names in their standard sports spelling, especially HYROX (never translate it as 海洛克斯). ` +
    `Use Arabic numerals and compact units: 8月15日, 6.2km, 24h, 3-4组. Do NOT spell these as 八月十五日, 六点二公里, 二十四小时, or 三到四组. ` +
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

function buildWeeklyRecapPrompt(opts: {
  lang: string; today: string; weekStart: string; weekEnd: string; nextStart: string; nextEnd: string;
  completed: any[]; plannedThisWeek: any[]; plannedNextWeek: any[]; notes: any[];
  targetRace: any | null; memoryFacts: any[]; agentActions: any[]; coachConfig: Record<string, unknown>;
}): { system: string; user: string } {
  const langName = "Chinese (简体中文)";
  const workoutLine = (w: any) => {
    const bits = [w.date, w.type];
    if (Number(w.distance || 0) > 0) bits.push(fmtKm(w.distance));
    if (Number(w.ascent || 0) > 0) bits.push(`D+${Math.round(Number(w.ascent))}m`);
    if (Number(w.duration || 0) > 0) bits.push(fmtDuration(Number(w.duration)));
    if (Number(w.hr || 0) > 0) bits.push(`HR${Math.round(Number(w.hr))}`);
    if (w.rpe) bits.push(`RPE${w.rpe}`);
    if (w.plan_status) bits.push(`status:${w.plan_status}`);
    if (w.note) bits.push(`note:${String(w.note).replace(/\s+/g, " ").slice(0, 80)}`);
    return bits.filter(Boolean).join(" ");
  };
  const noteLine = (n: any) => {
    const tags = Array.isArray(n.tags) && n.tags.length ? `tags:${n.tags.join(",")}` : "";
    const readiness = [n.readiness_sleep, n.readiness_legs, n.readiness_energy].some(v => v != null)
      ? `readiness sleep/legs/energy=${n.readiness_sleep ?? "-"}-${n.readiness_legs ?? "-"}-${n.readiness_energy ?? "-"}`
      : "";
    return [n.date, tags, readiness].filter(Boolean).join(" ");
  };
  const completedKm = opts.completed.reduce((sum, w) => sum + Number(w.distance || 0), 0);
  const completedAscent = opts.completed.reduce((sum, w) => sum + Number(w.ascent || 0), 0);
  const memoryFacts = (opts.memoryFacts || [])
    .filter((fact) => fact?.status === "active")
    .slice(0, 12)
    .map((fact) => {
      const content = opts.lang === "zh"
        ? (fact.content_zh || fact.content_en || "")
        : (fact.content_en || fact.content_zh || "");
      return content ? `- ${fact.category || "other"}: ${String(content).replace(/\s+/g, " ").trim()}` : "";
    })
    .filter(Boolean);
  const agentActions = (opts.agentActions || []).slice(0, 6).map((action) => {
    const parts = [action.type, action.status, action.source].filter(Boolean);
    const affectedDates = Array.isArray(action.payload?.affectedDates) ? action.payload.affectedDates.slice(0, 5) : [];
    if (affectedDates.length) parts.push(`dates=${affectedDates.join(",")}`);
    if (Number.isFinite(Number(action.result?.createdWorkoutCount))) {
      parts.push(`created=${Number(action.result.createdWorkoutCount)}`);
    }
    if (action.error) parts.push(`error=${String(action.error).replace(/\s+/g, " ").slice(0, 120)}`);
    return parts.length ? `- ${parts.join(" · ")}` : "";
  }).filter(Boolean);
  const system =
    `You are this runner's coach. Write a detailed weekly training report for a full in-app report page. ` +
    `LANGUAGE (most important): write the ENTIRE recap in ${langName}, and ONLY ${langName}. ` +
    `Use the data; do not invent missing details. Be concrete, professional, and opinionated. Long output is OK. ` +
    `Structure with plain-text sections, no markdown tables, no emoji: ` +
    `1) executive summary, 2) session-by-session review of EACH completed workout, ` +
    `3) plan compliance and missed sessions, 4) fatigue/recovery/risk interpretation, ` +
    `5) detailed next 7-day plan with exact dates, type, distance/ascent/duration/intensity/purpose, ` +
    `6) watch list for next week. ` +
    `Do not claim you changed the calendar. Do not prescribe aggressive increases. Output only the report text.`;
  let race = "none";
  if (opts.targetRace) {
    const w = weeksUntil(opts.targetRace.date);
    race = `${opts.targetRace.name}${opts.targetRace.date ? ` on ${opts.targetRace.date}` : ""}${w != null ? ` (~${w} weeks out)` : ""}`;
  }
  const user =
    `[Today] ${opts.today}\n` +
    `[Week] ${opts.weekStart} to ${opts.weekEnd}\n` +
    `[Summary] completed_sessions=${opts.completed.length}; completed_distance=${completedKm.toFixed(1)}km; completed_ascent=${Math.round(completedAscent)}m\n` +
    `[This week completed]\n${opts.completed.length ? opts.completed.map(workoutLine).join("\n") : "none"}\n` +
    `[This week planned rows]\n${opts.plannedThisWeek.length ? opts.plannedThisWeek.map(workoutLine).join("\n") : "none"}\n` +
    `[Next week planned rows]\n${opts.plannedNextWeek.length ? opts.plannedNextWeek.map(workoutLine).join("\n") : "none"}\n` +
    `[Daily notes]\n${opts.notes.length ? opts.notes.map(noteLine).join("\n") : "none"}\n` +
    `[Target race] ${race}\n` +
    `[Coach preference]\n${JSON.stringify(opts.coachConfig || {})}\n` +
    `[Memory facts — reviewed durable facts only]\n${memoryFacts.length ? memoryFacts.join("\n") : "none"}\n` +
    `[Recent agent actions — use as runner feedback]\n${agentActions.length ? agentActions.join("\n") : "none"}\n`;
  return { system, user };
}

function buildMemoryUpdatePrompt(opts: {
  lang: string;
  memory: string;
  chatRows: any[];
  targetRaces?: any[];
}): { system: string; user: string } {
  const langName = opts.lang === "zh" ? "Chinese (简体中文)" : "English";
  const chat = (opts.chatRows || []).map((m) => {
    const who = m.role === "user" ? "Runner" : "Coach";
    const text = String(m.content || "").replace(/\s+/g, " ").trim().slice(0, 1200);
    return text ? `[${who}] ${text}` : "";
  }).filter(Boolean).join("\n\n");
  const sectionsEn = [
    "[Injuries / Health]",
    "[Goals / Races]",
    "[Training Preferences]",
    "[Coaching Style]",
    "[Recurring Patterns]",
  ].join("\n");
  const sectionsZh = [
    "[伤病 / 健康]",
    "[目标 / 比赛]",
    "[训练偏好]",
    "[教练风格]",
    "[长期模式]",
  ].join("\n");
  const targetRaces = formatMemoryTargetRaces(opts.targetRaces || []);
  const system =
    `You update a runner's long-term coach Memory from recent chat. ` +
    `Return only durable, repeatedly useful facts. Do not write one-off session details. ` +
    `Output bilingual Memory in English and Simplified Chinese with exact line-by-line correspondence. ` +
    `The app will ask the runner to review before saving, so do not claim anything was saved.`;
  const user =
    `[Preferred UI language] ${langName}\n\n` +
    `[Current memory]\n${opts.memory || "(empty)"}\n\n` +
    `[Current target races from app settings - source of truth for race status and priority]\n${targetRaces}\n\n` +
    `[Recent coach chat from today]\n${chat || "(empty)"}\n\n` +
    `Guidelines:\n` +
    `- Keep these exact English section headings:\n${sectionsEn}\n` +
    `- Keep these exact Chinese section headings:\n${sectionsZh}\n` +
    `- Under each heading, write one short fact per line as "- ...".\n` +
    `- Keep durable facts only: injuries/health constraints, goals/races, training preferences, coaching style preferences, recurring patterns.\n` +
    `- If recent chat conflicts with current target races, trust Current target races. The runner may have edited race priority after the chat.\n` +
    `- Do not store A/B/C priority, race date, distance, ascent, or target status as Memory when it is already present in Current target races.\n` +
    `- For Goals / Races, store durable strategy boundaries only, e.g. "HYROX should remain auxiliary and must not displace trail-running preparation."\n` +
    `- Drop today's specific question, one-off advice, temporary mood, and generic encouragement.\n` +
    `- If nothing meaningful should change, return the existing memory normalized into the section structure.\n` +
    `- Maximum about 500 words total.\n\n` +
    `Output EXACTLY:\n` +
    `===EN===\n${sectionsEn}\n<english facts>\n` +
    `===ZH===\n${sectionsZh}\n<中文事实>`;
  return { system, user };
}

function formatMemoryTargetRaces(races: any[] = []): string {
  const rows = (Array.isArray(races) ? races : [])
    .slice()
    .sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")));
  if (!rows.length) return "(empty)";

  return rows.map((race) => {
    const name = String(race?.name || race?.category || "Unnamed race").trim();
    const date = String(race?.date || "date unset").trim();
    const category = [race?.category, race?.subtype].filter(Boolean).join(" / ");
    const priority = String(race?.priority || "unset").trim();
    const distance = formatMemoryRaceNumber(race?.distance, "km");
    const ascent = formatMemoryRaceNumber(race?.ascent, "m ascent");
    const details = [
      category ? `Type: ${category}` : "",
      `Priority: ${priority}`,
      distance ? `Distance: ${distance}` : "",
      ascent ? `Ascent: ${ascent}` : "",
    ].filter(Boolean);
    return `- ${date} | ${name}${details.length ? ` | ${details.join(" | ")}` : ""}`;
  }).join("\n");
}

function formatMemoryRaceNumber(value: unknown, suffix: string): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return `${Number.isInteger(n) ? n : Number(n.toFixed(1))}${suffix}`;
}

function parseBilingualMemory(text: string): { en: string; zh: string } {
  const parts = String(text || "").split(/===\s*ZH\s*===/i);
  if (parts.length >= 2) {
    const en = parts[0].replace(/===\s*EN\s*===/i, "").trim();
    const zh = parts.slice(1).join("").replace(/===\s*EN\s*===/i, "").trim();
    if (en || zh) return { en: en || zh, zh: zh || en };
  }
  const plain = String(text || "").replace(/===\s*(EN|ZH)\s*===/ig, "").trim();
  return { en: plain, zh: plain };
}

async function callDeepSeek(key: string, system: string, user: string): Promise<LlmResult> {
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
    provider: "deepseek",
    model: DEEPSEEK_MODEL,
    fallback: null,
  };
}

async function hasFreshDesktopRunner(admin: any): Promise<{ ok: true; runnerId: string } | { ok: false; reason: string }> {
  const cutoff = new Date(Date.now() - DESKTOP_RUNNER_FRESH_MS).toISOString();
  const { data, error } = await admin
    .from("ai_runners")
    .select("id, last_seen_at, metadata")
    .eq("provider", DESKTOP_CODEX.id)
    .eq("status", "online")
    .gte("last_seen_at", cutoff)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, reason: "desktop_schema_unavailable" };
  if (!data?.id) return { ok: false, reason: "desktop_runner_offline" };
  const metadata = objectValue(data.metadata);
  const lastCodexStatus = codexStatusValue(metadata.lastCodexStatus);
  const lastErrorAgeMs = ageMsFromIso(metadata.lastCodexErrorAt);
  if ((lastCodexStatus === "error" || lastCodexStatus === "auth_error")
    && (lastErrorAgeMs === null || lastErrorAgeMs <= codexErrorCooldownMs(lastCodexStatus))) {
    return { ok: false, reason: lastCodexStatus === "auth_error" ? "desktop_codex_auth_error" : "desktop_codex_unhealthy" };
  }
  return { ok: true, runnerId: String(data.id) };
}

function desktopWaitMs(kind: AiJobKind, preference: "auto" | "prefer_codex" | "deepseek_only"): number {
  if (preference === "prefer_codex") return numberEnv("DESKTOP_CODEX_PREFER_WAIT_MS", 90_000);
  if (kind === "daily_checkin") return numberEnv("DESKTOP_CODEX_DISPATCH_WAIT_MS", 60_000);
  return numberEnv("DESKTOP_CODEX_DISPATCH_WAIT_MS", 90_000);
}

async function markDesktopFallback(admin: any, jobId: string, reason: string) {
  await admin
    .from("ai_jobs")
    .update({
      status: "fallback_used",
      fallback_provider: "deepseek",
      fallback_reason: reason,
    })
    .eq("id", jobId)
    .in("status", ["queued", "claimed", "running"]);
}

async function tryDesktopCodex(opts: {
  admin: any;
  userId: string;
  kind: AiJobKind;
  system: string;
  user: string;
  preference: "auto" | "prefer_codex" | "deepseek_only";
}): Promise<{ result: LlmResult | null; fallbackReason: string }> {
  if (opts.preference === "deepseek_only") {
    return { result: null, fallbackReason: "" };
  }

  const runner = await hasFreshDesktopRunner(opts.admin);
  if (!runner.ok) return { result: null, fallbackReason: runner.reason };

  const waitMs = desktopWaitMs(opts.kind, opts.preference);
  const expiresAt = new Date(Date.now() + Math.max(waitMs + 15_000, DESKTOP_JOB_TTL_MS)).toISOString();
  const { data: job, error: jobErr } = await opts.admin
    .from("ai_jobs")
    .insert({
      user_id: opts.userId,
      kind: opts.kind,
      status: "queued",
      provider_requested: DESKTOP_CODEX.id,
      payload: {
        source: "daily_coach_dispatch",
        system: opts.system,
        messages: [{ role: "user", content: opts.user }],
        max_tokens: 8000,
      },
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (jobErr || !job?.id) {
    return { result: null, fallbackReason: "desktop_job_create_failed" };
  }

  const jobId = String(job.id);
  const deadline = Date.now() + waitMs;
  let fallbackReason = "desktop_timeout";
  while (Date.now() < deadline) {
    await delay(DESKTOP_POLL_MS);
    const { data: row, error } = await opts.admin
      .from("ai_jobs")
      .select("status, result, error, provider_actual")
      .eq("id", jobId)
      .maybeSingle();
    if (error) {
      fallbackReason = "desktop_job_read_failed";
      break;
    }
    const status = String(row?.status || "");
    if (status === "completed") {
      const result = objectValue(row?.result);
      const text = typeof result.text === "string" ? result.text.trim() : "";
      if (!text) {
        fallbackReason = "desktop_empty_response";
        break;
      }
      return {
        result: {
          text,
          usage: objectValue(result.usage),
          id: `desktop:${jobId}`,
          provider: DESKTOP_CODEX.id,
          model: typeof result.model === "string" ? result.model : DESKTOP_CODEX.model,
          fallback: null,
          desktopJob: { id: jobId, runner_id: result.runner_id || null },
        },
        fallbackReason: "",
      };
    }
    if (status === "failed" || status === "expired" || status === "fallback_used") {
      fallbackReason = status === "failed"
        ? `desktop_failed:${String(row?.error || "").slice(0, 120) || "unknown"}`
        : `desktop_${status}`;
      break;
    }
  }

  await markDesktopFallback(opts.admin, jobId, fallbackReason).catch(() => {});
  return { result: null, fallbackReason };
}

async function callPreferredLLM(opts: {
  admin: any;
  userId: string;
  kind: AiJobKind;
  preference: "auto" | "prefer_codex" | "deepseek_only";
  deepseekKey: string;
  system: string;
  user: string;
}): Promise<LlmResult> {
  const desktop = await tryDesktopCodex({
    admin: opts.admin,
    userId: opts.userId,
    kind: opts.kind,
    system: opts.system,
    user: opts.user,
    preference: opts.preference,
  });
  if (desktop.result) return desktop.result;

  const deepseek = await callDeepSeek(opts.deepseekKey, opts.system, opts.user);
  if (desktop.fallbackReason && desktop.fallbackReason !== "desktop_schema_unavailable") {
    return {
      ...deepseek,
      fallback: {
        from: DESKTOP_CODEX.id,
        to: "deepseek",
        reason: desktop.fallbackReason,
      },
    };
  }
  return deepseek;
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { "Content-Type": "application/json" } });
}

async function dispatchCoachMessage(opts: {
  supabase: any;
  serviceAccount: { project_id: string; client_email: string; private_key: string; token_uri: string };
  accessToken: string | null;
  userId: string;
  title?: string;
  pushTitle?: string;
  message: string;
  llm: LlmResult;
}): Promise<{
  accessToken: string | null;
  summary: {
    sent: number;
    devices: number;
    fcmErrors: any[];
    chargeCents: number;
    actualCostCents: number;
    inbox: boolean;
  };
}> {
  const charge = await chargeAiUsage({
    usage: opts.llm.usage,
  });
  const delivery = await sendPushAndInbox({
    supabase: opts.supabase,
    serviceAccount: opts.serviceAccount,
    accessToken: opts.accessToken,
    userId: opts.userId,
    title: opts.title,
    pushTitle: opts.pushTitle,
    message: opts.message,
  });

  return {
    accessToken: delivery.accessToken,
    summary: {
      sent: delivery.sent,
      devices: delivery.devices,
      fcmErrors: delivery.fcmErrors,
      chargeCents: charge.chargeCents,
      actualCostCents: charge.actualCostCents,
      inbox: delivery.inbox,
    },
  };
}

async function chargeAiUsage(opts: {
  usage: unknown;
}): Promise<ReturnType<typeof calcChargeCents>> {
  return calcChargeCents(opts.usage);
}

async function sendPushAndInbox(opts: {
  supabase: any;
  serviceAccount: { project_id: string; client_email: string; private_key: string; token_uri: string };
  accessToken: string | null;
  userId: string;
  title?: string;
  pushTitle?: string;
  message: string;
}): Promise<{
  accessToken: string | null;
  sent: number;
  devices: number;
  fcmErrors: any[];
  inbox: boolean;
}> {
  const { data: subs } = await opts.supabase
    .from("push_subscriptions").select("fcm_token").eq("user_id", opts.userId);

  let accessToken = opts.accessToken;
  let sent = 0;
  const fcmErrors: any[] = [];
  if (subs && subs.length > 0) {
    if (!accessToken) accessToken = await getAccessToken(opts.serviceAccount);
    for (const sub of subs) {
      const r = await sendPush(opts.serviceAccount.project_id, accessToken, sub.fcm_token, opts.pushTitle || opts.title || "Ultreia", opts.message);
      if (r.ok) sent++;
      else fcmErrors.push({ status: r.status, error: (r.body as any)?.error?.status || (r.body as any)?.error?.message || r.body });
    }
  }

  const { error: inboxErr } = await opts.supabase
    .from("push_inbox")
    .insert({ user_id: opts.userId, title: opts.title || null, body: opts.message });

  return {
    accessToken,
    sent,
    devices: subs?.length || 0,
    fcmErrors,
    inbox: !inboxErr,
  };
}

Deno.serve(async (req) => {
  // Cron-only: reject anything without the shared secret.
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    return json({ error: "unauthorized" }, 401);
  }
  try {
    const body = await req.json().catch(() => ({})) as {
      mode?: string;
      force?: boolean;
      user_id?: string;
      date?: string;
    };
    const mode = body.mode === "weekly_recap"
      ? "weekly_recap"
      : body.mode === "memory_update"
        ? "memory_update"
        : "daily_checkin";
    const saRaw = Deno.env.get("FCM_SERVICE_ACCOUNT");
    if (!saRaw) return json({ error: "FCM_SERVICE_ACCOUNT not set" }, 500);
    const sa = JSON.parse(saRaw);
    const deepseekKey = Deno.env.get("SHARED_DEEPSEEK_KEY");
    if (!deepseekKey) return json({ error: "SHARED_DEEPSEEK_KEY not set" }, 500);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Everyone with the relevant automation enabled; we filter by local
    // half-hour slot in JS for daily push / weekly reports, and by
    // coach_config for Memory.
    const buildSettingsQuery = (columns: string) => {
      let query = supabase.from("user_settings").select(columns);
      if (mode === "daily_checkin") query = query.eq("push_enabled", true);
      if (mode === "weekly_recap") query = query.eq("weekly_report_enabled", true);
      if (body.user_id) query = query.eq("user_id", body.user_id);
      return query;
    };
    const settingsColumns = "user_id, push_enabled, push_hours, push_times, push_timezone, lang, coach_config, ai_provider_preference, weekly_report_enabled, weekly_report_weekday, weekly_report_time";
    const legacySettingsColumns = "user_id, push_enabled, push_hours, push_times, push_timezone, lang, coach_config, weekly_report_enabled, weekly_report_weekday, weekly_report_time";
    let { data: settings, error: sErr } = await buildSettingsQuery(settingsColumns);
    if (sErr && String(sErr.message || "").includes("ai_provider_preference")) {
      const retry = await buildSettingsQuery(legacySettingsColumns);
      settings = retry.data;
      sErr = retry.error;
    }
    if (sErr) return json({ error: sErr.message }, 500);

    let fcmAccessToken: string | null = null;
    const summary: any[] = [];

    for (const u of settings || []) {
      const tz = u.push_timezone || "Asia/Shanghai";
      const parts = localParts(tz);
      const date = body.date || (mode === "memory_update" && !body.force ? dateAdd(parts.date, -1) : parts.date);
      const preference = providerPreference(u.ai_provider_preference);
      if (mode === "memory_update") {
        if (u.coach_config?.nightlyMemoryReview !== true && !body.force) continue;
        const { startIso, endIso } = localDateUtcWindow(date, tz);

        if (!body.force) {
          const { data: logged } = await supabase
            .from("agent_actions")
            .select("id")
            .eq("user_id", u.user_id)
            .eq("type", "memory_update")
            .eq("source", "nightly_memory_review")
            .gte("created_at", startIso)
            .lt("created_at", endIso)
            .limit(1)
            .maybeSingle();
          if (logged) continue;
        }

        const { data: chatRows, error: chatErr } = await supabase
          .from("coach_messages")
          .select("id, role, content, created_at")
          .eq("user_id", u.user_id)
          .gte("created_at", startIso)
          .lt("created_at", endIso)
          .order("created_at", { ascending: true })
          .limit(30);
        if (chatErr) { summary.push({ user: u.user_id, error: chatErr.message }); continue; }
        if (!chatRows?.some((m: any) => m.role === "user")) {
          summary.push({ user: u.user_id, mode, skipped: "no_user_chat" });
          continue;
        }

        const { data: activeFacts, error: factsErr } = await supabase
          .from("coach_memory_facts")
          .select("category, content_en, content_zh, status, updated_at")
          .eq("user_id", u.user_id)
          .eq("status", "active")
          .order("updated_at", { ascending: false })
          .limit(30);
        if (factsErr) { summary.push({ user: u.user_id, error: `memory_facts: ${factsErr.message}` }); continue; }
        const currentFacts = (activeFacts || []).map((fact: any) => {
          const category = fact.category || "other";
          return `- [${category}] EN: ${fact.content_en || ""}\n  ZH: ${fact.content_zh || ""}`;
        }).join("\n");

        const { data: targetRaces, error: racesErr } = await supabase
          .from("races")
          .select("name, date, category, subtype, priority, distance, ascent")
          .eq("user_id", u.user_id)
          .eq("is_target", true)
          .order("date", { ascending: true })
          .limit(12);
        if (racesErr) { summary.push({ user: u.user_id, error: `target_races: ${racesErr.message}` }); continue; }

        const { system, user } = buildMemoryUpdatePrompt({
          lang: u.lang || "en",
          memory: currentFacts,
          chatRows: chatRows || [],
          targetRaces: targetRaces || [],
        });

        let llm: LlmResult;
        try {
          llm = await callPreferredLLM({
            admin: supabase,
            userId: u.user_id,
            kind: aiJobKindForMode(mode),
            preference,
            deepseekKey,
            system,
            user,
          });
        } catch (e) {
          summary.push({ user: u.user_id, error: `llm: ${String(e).slice(0, 120)}` });
          continue;
        }
        if (!llm.text) { summary.push({ user: u.user_id, error: "empty llm reply" }); continue; }

        const parsed = parseBilingualMemory(llm.text);
        if (!parsed.en && !parsed.zh) { summary.push({ user: u.user_id, error: "empty memory parse" }); continue; }

        let memoryCharge: ReturnType<typeof calcChargeCents>;
        try {
          memoryCharge = await chargeAiUsage({
            usage: llm.usage,
          });
        } catch (e) {
          summary.push({ user: u.user_id, error: String(e).slice(0, 120) });
          continue;
        }
        const requestId = llm.id ? `nightly-memory:${llm.id}` : `nightly-memory:${u.user_id}:${date}`;
        const { actualCostCents, chargeCents } = memoryCharge;

        const clientId = `nightly-memory-${date}-${u.user_id}`;
        const sourceRef = chatRows?.length ? String(chatRows[chatRows.length - 1].id || "") : null;
        const { error: actionErr } = await supabase
          .from("agent_actions")
          .upsert({
            user_id: u.user_id,
            client_id: clientId,
            type: "memory_update",
            status: "proposed",
            title: "Update long-term memory",
            reason: "The coach reviewed today's chat and found durable facts that can be saved to Memory.",
            risk: "low",
            requires_confirmation: true,
            source: "nightly_memory_review",
            source_ref_type: sourceRef ? "coach_message" : null,
            source_ref_id: sourceRef,
            payload: {
              memory: parsed,
              sourceMessageCount: chatRows?.length || 0,
              localDate: date,
            },
            result: {
              chargeCents,
              actualCostCents,
              provider: llm.provider,
              model: llm.model,
              fallback: llm.fallback,
              desktopJob: llm.desktopJob || null,
              requestId,
            },
            created_at: new Date().toISOString(),
          }, { onConflict: "user_id,client_id" });
        if (actionErr) {
          summary.push({ user: u.user_id, error: `agent_action: ${actionErr.message}` });
          continue;
        }

        const title = "记忆更新待审核";
        const message = "教练已根据今天的对话整理出长期记忆建议，打开 AI Coach 审核后才会保存。";
        await supabase.from("push_inbox").insert({ user_id: u.user_id, title, body: message });
        summary.push({ user: u.user_id, mode, date, action: clientId, provider: llm.provider, chargeCents, actualCostCents });
        continue;
      }

      if (mode === "weekly_recap") {
        if (!body.force) {
          const scheduledWeekday = Number.isInteger(Number(u.weekly_report_weekday))
            ? Number(u.weekly_report_weekday)
            : 0;
          const scheduledTime = typeof u.weekly_report_time === "string" && /^\d{2}:\d{2}$/.test(u.weekly_report_time)
            ? u.weekly_report_time
            : "20:00";
          const localWeekday = new Date(`${date}T00:00:00Z`).getUTCDay();
          const localSlot = `${String(parts.hour).padStart(2, "0")}:${parts.minute < 30 ? "00" : "30"}`;
          if (localWeekday !== scheduledWeekday || localSlot !== scheduledTime) continue;
        }

        const { start, end, nextStart, nextEnd } = weekWindow(date);
        if (!body.force) {
          const { data: logged } = await supabase
            .from("coach_reports")
            .select("id")
            .eq("user_id", u.user_id)
            .eq("period_start", start)
            .eq("period_end", end)
            .eq("source", "auto")
            .eq("status", "ready")
            .limit(1)
            .maybeSingle();
          if (logged) continue;
        }

        const reportTitle = "AI 周复盘";
        const { data: reportRow, error: reportCreateErr } = await supabase
          .from("coach_reports")
          .insert({
            user_id: u.user_id,
            period_start: start,
            period_end: end,
            next_start: nextStart,
            next_end: nextEnd,
            range_mode: "this",
            source: "auto",
            status: "running",
            title: reportTitle,
            body: "",
            model: DEEPSEEK_MODEL,
            metadata: {
              trigger: "server_cron",
              timezone: tz,
              scheduled_weekday: u.weekly_report_weekday ?? 0,
              scheduled_time: u.weekly_report_time || "20:00",
            },
          })
          .select("id")
          .single();
        if (reportCreateErr || !reportRow?.id) {
          summary.push({ user: u.user_id, error: `coach_report_create: ${reportCreateErr?.message || "missing id"}` });
          continue;
        }

        const reportId = reportRow.id;
        const [
          completedResult,
          plannedThisResult,
          plannedNextResult,
          notesResult,
          racesResult,
          memoryFactsResult,
          agentActionsResult,
        ] = await Promise.all([
          supabase
            .from("workouts")
            .select("date, type, sub_types, distance, duration, pace, ascent, hr, max_hr, rpe, aerobic_te, note")
            .eq("user_id", u.user_id).eq("is_planned", false)
            .gte("date", start).lte("date", end)
            .order("date", { ascending: true }),
          supabase
            .from("workouts")
            .select("date, type, sub_types, distance, duration, ascent, plan_status, note")
            .eq("user_id", u.user_id).eq("is_planned", true)
            .gte("date", start).lte("date", end)
            .order("date", { ascending: true }),
          supabase
            .from("workouts")
            .select("date, type, sub_types, distance, duration, ascent, plan_status, note")
            .eq("user_id", u.user_id).eq("is_planned", true)
            .gte("date", nextStart).lte("date", nextEnd)
            .order("date", { ascending: true }),
          supabase
            .from("daily_notes")
            .select("date, tags, readiness_sleep, readiness_legs, readiness_energy")
            .eq("user_id", u.user_id)
            .gte("date", start).lte("date", end)
            .order("date", { ascending: true }),
          supabase
            .from("races")
            .select("name, date, category, priority, distance, ascent")
            .eq("user_id", u.user_id).eq("is_target", true)
            .order("date", { ascending: true }),
          supabase
            .from("coach_memory_facts")
            .select("category, content_en, content_zh, status, updated_at")
            .eq("user_id", u.user_id).eq("status", "active")
            .order("updated_at", { ascending: false })
            .limit(12),
          supabase
            .from("agent_actions")
            .select("type, status, source, payload, result, error, updated_at")
            .eq("user_id", u.user_id)
            .order("updated_at", { ascending: false })
            .limit(6),
        ]);
        const dataError = [
          completedResult.error,
          plannedThisResult.error,
          plannedNextResult.error,
          notesResult.error,
          racesResult.error,
          memoryFactsResult.error,
          agentActionsResult.error,
        ].find(Boolean);
        if (dataError) {
          await supabase.from("coach_reports").update({
            status: "failed",
            error: dataError.message,
          }).eq("id", reportId);
          summary.push({ user: u.user_id, error: `weekly_data: ${dataError.message}` });
          continue;
        }

        const completed = completedResult.data || [];
        const plannedThisWeek = plannedThisResult.data || [];
        const plannedNextWeek = plannedNextResult.data || [];
        const notes = notesResult.data || [];
        const races = racesResult.data || [];
        const targetRace = (races || []).find((r) => r.date && r.date >= date) || (races || [])[0] || null;

        const { system, user } = buildWeeklyRecapPrompt({
          lang: u.lang || "en", today: date,
          weekStart: start, weekEnd: end, nextStart, nextEnd,
          completed,
          plannedThisWeek,
          plannedNextWeek,
          notes,
          targetRace,
          memoryFacts: memoryFactsResult.data || [],
          agentActions: agentActionsResult.data || [],
          coachConfig: u.coach_config || {},
        });

        let llm: LlmResult;
        try {
          llm = await callPreferredLLM({
            admin: supabase,
            userId: u.user_id,
            kind: aiJobKindForMode(mode),
            preference,
            deepseekKey,
            system,
            user,
          });
        } catch (e) {
          await supabase.from("coach_reports").update({
            status: "failed",
            error: String(e).slice(0, 500),
          }).eq("id", reportId);
          summary.push({ user: u.user_id, error: `llm: ${String(e).slice(0, 120)}` });
          continue;
        }
        if (!llm.text) {
          await supabase.from("coach_reports").update({
            status: "failed",
            error: "empty llm reply",
          }).eq("id", reportId);
          summary.push({ user: u.user_id, error: "empty llm reply" });
          continue;
        }

        let weeklyCharge: ReturnType<typeof calcChargeCents>;
        try {
          weeklyCharge = await chargeAiUsage({
            usage: llm.usage,
          });
          const { error: reportReadyErr } = await supabase
            .from("coach_reports")
            .update({
              status: "ready",
              body: llm.text,
              error: null,
              wallet_charge_cents: weeklyCharge.chargeCents,
              model: llm.model,
              metadata: {
                trigger: "server_cron",
                timezone: tz,
                scheduled_weekday: u.weekly_report_weekday ?? 0,
                scheduled_time: u.weekly_report_time || "20:00",
                provider: llm.provider,
                fallback: llm.fallback,
                desktop_job: llm.desktopJob || null,
                upstream_id: llm.id || null,
                usage: llm.usage,
                actual_cost_cents: weeklyCharge.actualCostCents,
              },
            })
            .eq("id", reportId);
          if (reportReadyErr) throw new Error(`coach_report_ready: ${reportReadyErr.message}`);
        } catch (e) {
          await supabase.from("coach_reports").update({
            status: "failed",
            error: String(e).slice(0, 500),
          }).eq("id", reportId);
          summary.push({ user: u.user_id, error: String(e).slice(0, 120) });
          continue;
        }

        const notificationTitle = "AI 周复盘已完成";
        const notificationMessage = "打开 Ultreia 查看本周周报，并可审核接下来的训练计划。";
        try {
          const delivery = await sendPushAndInbox({
            supabase,
            serviceAccount: sa,
            accessToken: fcmAccessToken,
            userId: u.user_id,
            title: notificationTitle,
            message: notificationMessage,
          });
          fcmAccessToken = delivery.accessToken;
          summary.push({
            user: u.user_id,
            mode,
            reportId,
            week: `${start}..${end}`,
            provider: llm.provider,
            chargeCents: weeklyCharge.chargeCents,
            actualCostCents: weeklyCharge.actualCostCents,
            sent: delivery.sent,
            devices: delivery.devices,
            inbox: delivery.inbox,
          });
        } catch (e) {
          summary.push({
            user: u.user_id,
            mode,
            reportId,
            week: `${start}..${end}`,
            provider: llm.provider,
            chargeCents: weeklyCharge.chargeCents,
            notificationError: String(e).slice(0, 120),
          });
        }
        continue;
      }

      const { hour, minute } = parts;
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
      const { data: activeFacts } = await supabase
        .from("coach_memory_facts")
        .select("category, content_en, content_zh")
        .eq("user_id", u.user_id)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(12);
      const memory = (activeFacts || []).map((fact: any) => {
        const content = u.lang === "zh"
          ? (fact.content_zh || fact.content_en || "")
          : (fact.content_en || fact.content_zh || "");
        return content ? `${fact.category || "other"}: ${content}` : "";
      }).filter(Boolean).join("; ");

      const { system, user } = buildPrompt({
        lang: u.lang || "en", name: "", today: date,
        workouts: workouts || [], targetRace, memory,
        recentChat,
      });

      let llm: LlmResult;
      try {
        llm = await callPreferredLLM({
          admin: supabase,
          userId: u.user_id,
          kind: aiJobKindForMode(mode),
          preference,
          deepseekKey,
          system,
          user,
        });
      } catch (e) {
        summary.push({ user: u.user_id, error: `llm: ${String(e).slice(0, 120)}` });
        continue;
      }
      if (!llm.text) { summary.push({ user: u.user_id, error: "empty llm reply" }); continue; }
      const message = normalizeDailyCheckinText(llm.text);

      try {
        const result = await dispatchCoachMessage({
          supabase,
          serviceAccount: sa,
          accessToken: fcmAccessToken,
          userId: u.user_id,
          pushTitle: "Ultreia",
          message,
          llm,
        });
        fcmAccessToken = result.accessToken;
        summary.push({ user: u.user_id, mode, provider: llm.provider, ...result.summary, message });
      } catch (e) {
        summary.push({ user: u.user_id, error: String(e).slice(0, 120) });
      }
    }

    return json({ mode, processed: summary.length, summary });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
