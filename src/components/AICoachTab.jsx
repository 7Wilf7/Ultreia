import { useState, useEffect, useRef } from "react";
import { s } from "../styles";
import {
  DEFAULT_API_ENDPOINT,
  COACH_STYLES, OUTPUT_LENGTHS, INTERVENTION_LEVELS,
  ACTIVITY_TYPES, SPARTAN_SUBTYPES,
} from "../constants";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { useIsNarrow, useIsMobile } from "../hooks/useMediaQuery";
import { formatDuration, formatPaceFromSec } from "../utils/format";
import { buildSystemPrompt } from "../utils/profile";
import { CoachPlanImportModal } from "./CoachPlanImportModal";
import { ModalRoot } from "./ModalRoot";

// At this many persisted messages, surface a soft hint suggesting the user
// distill Memory + clear the chat. Older turns start competing with the
// system prompt for the model's attention past ~20 turns.
const LONG_CHAT_HINT_THRESHOLD = 20;

// Local time formatter — explicit per-component build, locale-independent.
// `now.toISOString()` returns UTC, which mislabels as GMT+8 in the data
// block; this returns the user's wall-clock time as "YYYY-MM-DD HH:MM".
function formatLocalDateTime(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Difficulty rank for Spartan subtypes — higher = harder.
const SPARTAN_RANK = SPARTAN_SUBTYPES.reduce((acc, name, i) => {
  acc[name] = i + 1;
  return acc;
}, {});

// Pick a representative subset of history races to send to the coach.
// Per category:
//   • 10K / HM / Marathon / Hyrox / Other / Uncategorized → latest 3 by date
//   • Trail   → latest 3 + longest by distance (if not already in the 3)
//   • Spartan → latest 3 + toughest by subtype rank (if not already in the 3)
// Goal: keep the prompt focused on recent form, while always anchoring trail
// and Spartan signal with the user's peak performance for each.
function selectHistoryForPrompt(historyRaces) {
  const groups = {};
  for (const r of historyRaces) {
    const cat = r.category || "Uncategorized";
    (groups[cat] = groups[cat] || []).push(r);
  }
  const picked = new Set();
  for (const [cat, group] of Object.entries(groups)) {
    const byDate = [...group].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    byDate.slice(0, 3).forEach(r => picked.add(r.id));
    if (cat === "Trail") {
      const longest = [...group].filter(r => r.distance > 0)
        .sort((a, b) => b.distance - a.distance)[0];
      if (longest) picked.add(longest.id);
    } else if (cat === "Spartan") {
      const toughest = [...group].filter(r => SPARTAN_RANK[r.subtype])
        .sort((a, b) => SPARTAN_RANK[b.subtype] - SPARTAN_RANK[a.subtype])[0];
      if (toughest) picked.add(toughest.id);
    }
  }
  return historyRaces
    .filter(r => picked.has(r.id))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

// Tolerant JSON-array extraction from a coach reply. The LLM may wrap its
// output in markdown fences, prefix it with commentary, or even return a
// plain object — we try a few peelings before giving up.
function parsePlansFromLLM(text) {
  if (!text) return [];
  let cleaned = text.trim();
  // Strip ```json … ``` or ``` … ``` fences if present.
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* fall through */ }
  // Last resort — find the FIRST `[ … ]` substring and try that.
  const m = cleaned.match(/\[[\s\S]*\]/);
  if (m) {
    try {
      const parsed = JSON.parse(m[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* give up */ }
  }
  return [];
}

// Locale-aware headers for the dynamic data block (current date / target races /
// race history / recent activities). Numbers + race names stay as-is — only the
// section titles + the priority label change. The "en" version is canonical
// (LLM-facing); "zh" is for the in-app preview only.
const DATA_LABELS = {
  en: {
    currentDate: "[Current Date]",
    targets: "[Target Races]",
    history: "[Race History]",
    recent: "[Recent Activities (last 10)]",
    none: "None",
    priorityTag: (p) => `[Priority ${p}]`,
  },
  zh: {
    currentDate: "[当前时间]",
    targets: "[目标比赛]",
    history: "[比赛历史]",
    recent: "[近期活动（最近 10 条）]",
    none: "无",
    priorityTag: (p) => `[${p} 级目标]`,
  },
};

// Format a race finish time as H:MM:SS (h unpadded; m/s padded). Returns ""
// when no time recorded so callers can omit the "→ time" suffix.
function formatRaceTime(r) {
  if (![r.resultH, r.resultM, r.resultS].some(Boolean)) return "";
  return `${r.resultH || "0"}:${String(r.resultM || "0").padStart(2, "0")}:${String(r.resultS || "0").padStart(2, "0")}`;
}

// Build the category tag for a race entry. Spartan includes its tier
// (Sprint/Super/Beast/Ultra) inline so the LLM doesn't have to guess.
function categoryTagFor(r, brackets = "[]") {
  if (!r.category) return "";
  const inside = r.category === "Spartan" && r.subtype ? `${r.category} ${r.subtype}` : r.category;
  return `${brackets[0]}${inside}${brackets[1]}`;
}

// Target race line — no more "goal: X" (targets don't capture a finish time).
// Priority is spelled out ("Priority A" / "A 级目标") so the LLM doesn't have
// to infer the meaning of a bare `[A]`. Distance + ascent carry units.
function formatTargetRace(r, lang) {
  const L_ = DATA_LABELS[lang] || DATA_LABELS.en;
  const priority = r.priority ? L_.priorityTag(r.priority) : "";
  const catTag = categoryTagFor(r, "()");
  const dateStr = r.date ? `on ${r.date}` : "";
  const metrics = [];
  if (r.distance > 0) metrics.push(`${r.distance} km`);
  if (r.ascent && parseInt(r.ascent) > 0) metrics.push(`+${r.ascent} m`);
  const metricStr = metrics.length ? `(${metrics.join(", ")})` : "";
  return [priority, r.name, catTag, dateStr, metricStr].filter(Boolean).join(" ");
}

// History race line — only emit metrics that are meaningful for the category:
//   Trail   → distance + ascent (the defining metrics)
//   Spartan → tier inline with category tag
//   Road / Hyrox / Other → distance is implicit in the category, so just time
// "→ time" appended only when a finish time was recorded.
function formatHistoryRace(r) {
  const parts = [r.date, r.name, categoryTagFor(r, "[]")].filter(Boolean);
  if (r.category === "Trail") {
    const metrics = [];
    if (r.distance > 0) metrics.push(`${r.distance} km`);
    if (r.ascent && parseInt(r.ascent) > 0) metrics.push(`+${r.ascent} m`);
    if (metrics.length) parts.push(metrics.join(", "));
  }
  let line = parts.join(" ");
  const t = formatRaceTime(r);
  if (t) line += ` → ${t}`;
  if (r.itraScore) line += ` ITRA ${r.itraScore}`;
  return line;
}

export function AICoachTab({
  logs, refreshLogs, races, profile, coachConfig, setCoachConfig,
  coachMemory, setCoachMemory,
  chatMessages, appendChatMessage, appendLocalChatMessage,
  bulkAddLogs,
  now, setConfirmDelete,
  apiKey, apiModel, onEditProfile,
}) {
  // DeepSeek is the only supported provider now; endpoint is hardcoded.
  const apiEndpoint = DEFAULT_API_ENDPOINT;
  const t = useT();
  const { lang } = useLanguage();
  const isNarrow = useIsNarrow();
  const isMobile = useIsMobile();
  const [showCoachConfig, setShowCoachConfig] = useState(false);
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  // Preview language is independent of UI language — defaults to UI language
  // but the user can flip it to read the prompt in the other language.
  const [previewLang, setPreviewLang] = useState(lang);
  const [showMemory, setShowMemory] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState(coachMemory);
  const [memoryEditing, setMemoryEditing] = useState(false);
  const [memoryUpdating, setMemoryUpdating] = useState(false);
  const [memoryProposal, setMemoryProposal] = useState(null); // { text } when LLM has proposed an update
  // Empty by default — the daily template is shown as a placeholder so it
  // disappears the moment the user starts typing, instead of being pre-filled
  // content the user has to delete.
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // Single ⚙ toggle replaces the row of toggle buttons (config / memory /
  // prompt preview / edit profile / clear chat). Open the menu to access
  // any of those — keeps the top of the tab uncluttered.
  const [showCoachMenu, setShowCoachMenu] = useState(false);

  // Auto-scroll the chat container to the latest message whenever the
  // message list grows (new send/receive) or whenever the tab is mounted
  // (so switching back from another tab doesn't strand the user on the
  // oldest message).
  const chatScrollRef = useRef(null);
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chatMessages.length, chatLoading]);
  // Plan-import state. `extractingForIdx` = msg index whose "→ Calendar"
  // button is currently calling the LLM; `planProposal` opens the review
  // modal once the structured array is parsed.
  const [extractingForIdx, setExtractingForIdx] = useState(null);
  const [planProposal, setPlanProposal] = useState(null);

  function clearChat() {
    setConfirmDelete({ type: "chat", id: null });
  }

  function startEditMemory() {
    setMemoryDraft(coachMemory);
    setMemoryEditing(true);
  }
  function saveMemory() {
    setCoachMemory(memoryDraft);
    setMemoryEditing(false);
  }
  function cancelEditMemory() {
    setMemoryDraft(coachMemory);
    setMemoryEditing(false);
  }

  // Ask the LLM to produce an updated memory from the current chat + existing memory.
  // User reviews the proposal before it replaces the live memory.
  async function proposeMemoryUpdate() {
    if (!apiKey) {
      alert(t("coach.no_key"));
      return;
    }
    if (chatMessages.length === 0) {
      alert(t("coach.memory_need_chat"));
      return;
    }
    setMemoryUpdating(true);
    const chatTranscript = chatMessages.map(m => `[${m.role}]\n${m.content}`).join("\n\n");
    // Output language = current UI language. Chinese users get Chinese memory,
    // English users get English memory. This is regardless of the prompt language.
    const outputLangHint = lang === "zh"
      ? "Write the memory in Chinese (简体中文)."
      : "Write the memory in English.";
    const memoryPrompt = `You are updating a long-term memory file about a runner. The memory captures DURABLE, repeatedly-useful facts about the user — training patterns, preferences, injuries, recurring concerns, coaching style preferences.

Current memory:
${coachMemory || "(empty)"}

Recent conversation:
${chatTranscript}

Return ONLY the updated memory text. Guidelines:
- Plain text, no markdown headings. Short labeled lines or paragraphs.
- Keep durable facts (preferences, goals, injuries, training style, recurring concerns).
- DROP session-specific things (today's specific question, one-off advice).
- Don't repeat what's already in the user's profile (age, location, basic stats).
- Maximum ~500 words. Trim older entries if needed.
- If nothing meaningful to add or update, return the existing memory unchanged.
- ${outputLangHint}

Output the memory text only, nothing else.`;

    try {
      const resp = await fetch(apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: apiModel,
          // 8000 = DeepSeek's hard output ceiling (with small margin). Memory
          // prompt asks for ~500 words so this is generous headroom — billed
          // by actual tokens, the cap costs nothing if unused.
          max_tokens: 8000,
          messages: [{ role: "user", content: memoryPrompt }],
        }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        alert(t("coach.api_error", { msg: data.error?.message || `HTTP ${resp.status}` }));
        setMemoryUpdating(false);
        return;
      }
      const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("") || "";
      if (!text.trim()) {
        alert(t("coach.memory_empty_response"));
        setMemoryUpdating(false);
        return;
      }
      setMemoryProposal({ text: text.trim() });
    } catch (err) {
      console.error("[AI Coach] Memory update error:", err);
      alert(t("coach.network_error", { msg: err.message, url: apiEndpoint }));
    }
    setMemoryUpdating(false);
  }

  function acceptMemoryProposal() {
    setCoachMemory(memoryProposal.text);
    setMemoryDraft(memoryProposal.text);
    setMemoryProposal(null);
  }
  function rejectMemoryProposal() {
    setMemoryProposal(null);
  }

  function setStyle(id)        { setCoachConfig({ ...coachConfig, style: id }); }
  function setOutputLength(id) { setCoachConfig({ ...coachConfig, outputLength: id }); }
  function setIntervention(id) { setCoachConfig({ ...coachConfig, intervention: id }); }

  // Dynamic data block injected into the system prompt. Only the section titles
  // are localized; values (dates, race names, numbers) stay verbatim across
  // languages so the model receives consistent data.
  // `logsOverride` lets sendChat pass freshly-refetched logs directly without
  // waiting for the next React render (avoids the "I just added a workout
  // but Coach can't see it" cross-tab/device race condition).
  function buildDataBlock(useLang = "en", logsOverride = null) {
    const D = DATA_LABELS[useLang] || DATA_LABELS.en;
    const sourceLogs = logsOverride || logs;
    // Strip future-planned entries — the LLM should only see what actually
    // happened. Planned rows would otherwise be misread as "recent activity"
    // (e.g. "your last run was 10km" when the user hasn't run it yet).
    const recentLogs = sourceLogs.filter(l => !l.isPlanned).slice(0, 10).map(l =>
      `${l.date} ${l.type}${l.subTypes.length ? "(" + l.subTypes.join(",") + ")" : ""} ${l.distance > 0 ? l.distance + "km" : ""} ${formatDuration(l.duration)}${l.pace ? " " + formatPaceFromSec(l.pace) + "/km" : ""}${l.hr ? " HR" + l.hr : ""}${l.maxHR ? "/" + l.maxHR : ""}${l.ascent ? " +" + l.ascent + "m" : ""}${l.cadence ? " cad" + l.cadence : ""}${l.aerobicTE ? " TE" + l.aerobicTE : ""}${l.gap ? " GAP" + formatPaceFromSec(l.gap) : ""}`
    ).join("\n");
    const targetRaces = races.filter(r => r.isTarget)
      .map(r => formatTargetRace(r, useLang)).join("\n") || D.none;
    const historyRaces = selectHistoryForPrompt(races.filter(r => !r.isTarget))
      .map(formatHistoryRace).join("\n") || D.none;

    return `${D.currentDate} ${formatLocalDateTime(now)} GMT+8

${D.targets}
${targetRaces}

${D.history}
${historyRaces}

${D.recent}
${recentLogs}`;
  }

  // Preview honors the user's toggle. The actual prompt sent to the LLM (in
  // sendChat below) always uses English for stable instruction-following.
  const previewPrompt = buildSystemPrompt({
    profile, coachConfig, coachMemory,
    dataBlock: buildDataBlock(previewLang),
    lang: previewLang,
  });

  // Second-pass LLM call: take the last assistant reply and ask the model to
  // re-emit any concrete training suggestions as a structured JSON array.
  // We send this as a fresh single-turn request (no chat history needed) and
  // do NOT persist either side — it's a one-shot extraction.
  async function importToCalendar(assistantContent, msgIdx) {
    if (!apiKey) {
      alert(t("coach.no_key"));
      return;
    }
    setExtractingForIdx(msgIdx);

    // Anchor relative dates ("Wednesday", "明天") on today's date in GMT+8.
    const todayStr = now.toISOString().slice(0, 10);
    const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });
    const typeUnion = ACTIVITY_TYPES.map(at => `"${at}"`).join(" | ");

    const extractPrompt = `You are a structured-data extractor. The user's AI running coach just produced the reply below. Extract any concrete training suggestions into a JSON array.

Today is ${todayStr} (${dayOfWeek}, GMT+8).

Coach's reply:
---
${assistantContent}
---

Output a JSON array. Each item:
{
  "date": "YYYY-MM-DD",
  "type": ${typeUnion},
  "distance": number (kilometres, optional — omit if not specified),
  "duration": number (MINUTES, optional — omit if not specified),
  "subTypes": ["Easy Run" | "Aerobic Run" | "Tempo Run" | "Interval Run" | "Race" | "Upper Body" | "Lower Body" | "Core"] (optional, only when relevant),
  "notes": string (brief — optional)
}

Rules:
- Only extract suggestions that have a clear day (explicit date OR a weekday like "Wednesday" / "周三" / "tomorrow"). Resolve weekdays to the next upcoming occurrence from today.
- Skip vague advice ("rest more", "stay hydrated"), past references, and analysis-only text.
- If the coach explicitly suggests a rest / recovery day with no activity, set type to "Recovery".
- If you cannot find any concrete plan, output [].
- Output the JSON array ONLY. No prose, no markdown fences, no comments.`;

    try {
      const resp = await fetch(apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: apiModel,
          // 8000 = DeepSeek's hard output ceiling. A long multi-week plan can
          // easily exceed 1500 tokens; truncating mid-JSON makes parsePlansFromLLM
          // fail silently (user sees "no plans found" when really we got cut off).
          max_tokens: 8000,
          messages: [{ role: "user", content: extractPrompt }],
        }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        alert(t("coach.api_error", { msg: data.error?.message || `HTTP ${resp.status}` }));
        return;
      }
      const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("") || "";
      const plans = parsePlansFromLLM(text);
      if (plans.length === 0) {
        alert(t("coach.import_no_plans"));
        return;
      }
      setPlanProposal({ plans });
    } catch (err) {
      console.error("[AI Coach] Plan-extract error:", err);
      alert(t("coach.network_error", { msg: err.message, url: apiEndpoint }));
    } finally {
      setExtractingForIdx(null);
    }
  }

  async function confirmImportPlans(workouts) {
    try {
      await bulkAddLogs(workouts, { source: "ai_coach_plan" });
      setPlanProposal(null);
      // Lightweight confirmation. The user will see the new pills on
      // the Calendar view themselves — no need for a heavy banner.
      alert(t("coach.import_success", { n: workouts.length }));
    } catch {
      // bulkAddLogs wrapper already showed an alert; leave the modal open so
      // the user can adjust and retry without losing their edits.
    }
  }

  async function sendChat() {
    if (!chatInput.trim() || chatLoading) return;
    if (!apiKey) {
      // Transient — refreshing should clear this hint, not pollute history.
      appendLocalChatMessage("assistant", t("coach.no_key"));
      return;
    }
    const userMsg = chatInput.trim();
    setChatLoading(true);

    // Refetch workouts from the DB so the prompt reflects writes from OTHER
    // tabs / devices since this React tree mounted. Single-tab adds are
    // already covered by addLog's optimistic setLogs, but cross-context
    // staleness was the user-visible "Coach can't see my new workout" bug.
    // If refresh fails (network), fall back to whatever's in props.
    let freshLogs = logs;
    if (refreshLogs) {
      try {
        freshLogs = await refreshLogs();
      } catch (err) {
        console.warn("[AI Coach] refreshLogs failed, using cached state:", err);
      }
    }

    // Canonical English prompt for LLM (more stable). The model still replies
    // in the user's language because FIXED_SYSTEM_PROMPT includes that directive.
    const systemPrompt = buildSystemPrompt({
      profile, coachConfig, coachMemory,
      dataBlock: buildDataBlock("en", freshLogs),
      lang: "en",
    });
    // Snapshot the history + this turn's user message for the API call. The
    // closure value of chatMessages matches what the user sees right now;
    // appending to the live state happens via the wrapper just below.
    const messagesToSend = [...chatMessages, { role: "user", content: userMsg }];
    setChatInput("");

    // Persist the user turn first. If this fails, the wrapper has already
    // alerted — bail out before spending an API call.
    try {
      await appendChatMessage("user", userMsg);
    } catch {
      setChatLoading(false);
      return;
    }

    console.log("[AI Coach] POST to:", apiEndpoint, "key length:", apiKey.length, "prompt length:", systemPrompt.length);
    try {
      const resp = await fetch(apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: apiModel,
          // Practical ceiling: DeepSeek's hard output cap is 8192 tokens on
          // the Anthropic-compat endpoint, so 8000 leaves a small margin.
          // The model decides how much to actually write — this is just the
          // "don't get cut off mid-sentence" headroom.
          max_tokens: 8000,
          system: systemPrompt,
          messages: messagesToSend,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        const msg = data.error?.message || `HTTP ${resp.status}`;
        console.error("[AI Coach] API error:", data);
        // Transient error bubble — kept out of the DB.
        appendLocalChatMessage("assistant", t("coach.api_error", { msg }));
      } else {
        const reply = data.content?.filter(b => b.type === "text").map(b => b.text).join("") || t("coach.no_response");
        if (!reply || reply === t("coach.no_response")) {
          // Diagnostic: API said 200 OK with no error, but we extracted no
          // text. Most likely the model ID is unknown to DeepSeek (they
          // silently return an empty payload). Dump full response so we can see.
          console.warn("[AI Coach] Empty reply. Full response:", data, "model sent:", apiModel);
        }
        try {
          await appendChatMessage("assistant", reply);
        } catch { /* alerted by wrapper */ }
      }
    } catch (err) {
      console.error("[AI Coach] Network error fetching", apiEndpoint, err);
      // Transient error bubble — kept out of the DB.
      appendLocalChatMessage("assistant", t("coach.network_error", { msg: err.message, url: apiEndpoint }));
    }
    setChatLoading(false);
  }

  // Mobile has two views inside this tab — chat (default) and a settings
  // sub-page (opened via the ⚙ button in the input row). Desktop shows
  // everything inline.
  const inSettings = isMobile && showCoachMenu;
  const inChat = !inSettings;

  return (
    <div style={isMobile ? {
      display: "flex", flexDirection: "column",
      height: "100%", minHeight: 0,
    } : {}}>
      {/* Top gutter — MobileShell's main has no top padding (sticky tabs own
          their own); non-sticky tabs add a flex-shrink:0 spacer instead of
          paddingTop on the wrapper, because paddingTop + height:100% + flex
          column inside a scroll-auto parent makes the chat container collapse
          to zero on some browsers (rendering the tab blank). */}
      {isMobile && <div style={{ height: 14, flexShrink: 0 }} />}
      {/* DESKTOP top button row: ⚙ Settings collapses the row of advanced
          controls; tap to expand, tap again to collapse. */}
      {!isMobile && (
        <div style={{ marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={() => setShowCoachMenu(!showCoachMenu)}
            style={{ ...s.btnGhost, fontWeight: 600 }}>
            {showCoachMenu ? `▲ ${t("coach.menu_close")}` : `⚙ ${t("coach.menu_open")}`}
            {coachMemory && !showCoachMenu ? " ●" : ""}
          </button>
          {showCoachMenu && (
            <>
              <button onClick={onEditProfile} style={s.btnGhost}>{t("coach.edit_profile")}</button>
              <button onClick={() => setShowCoachConfig(true)} style={s.btnGhost}>{t("coach.show_config")}</button>
              <button onClick={() => setShowMemory(true)} style={s.btnGhost}>
                {t("coach.show_memory")}{coachMemory ? " ●" : ""}
              </button>
              <button onClick={() => setShowPromptPreview(true)} style={s.btnGhost}>{t("coach.show_prompt")}</button>
              {chatMessages.length > 0 && (
                <button onClick={clearChat} style={s.btnGhost}>{t("coach.clear_chat")}</button>
              )}
            </>
          )}
        </div>
      )}

      {/* MOBILE settings sub-page header: ← back + title + vertical button
          list (one per row, centered). The mobile sub-page has plenty of
          vertical room so we stop cramming the toggle buttons into a wrap. */}
      {inSettings && (
        <div style={{ flexShrink: 0, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <button onClick={() => setShowCoachMenu(false)} aria-label={t("coach.back_to_chat")}
              style={{ ...s.btnGhost, fontSize: 16, width: 44, height: 36, padding: 0, minHeight: 36 }}>
              ←
            </button>
            <div style={{ ...s.section, margin: 0, flex: 1 }}>{t("coach.settings_title")}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button onClick={onEditProfile}
              style={{ ...s.btnGhost, textAlign: "center", padding: "10px 14px" }}>
              {t("coach.edit_profile")}
            </button>
            <button onClick={() => setShowCoachConfig(true)}
              style={{ ...s.btnGhost, textAlign: "center", padding: "10px 14px" }}>
              {t("coach.show_config")}
            </button>
            <button onClick={() => setShowMemory(true)}
              style={{ ...s.btnGhost, textAlign: "center", padding: "10px 14px" }}>
              {t("coach.show_memory")}{coachMemory ? " ●" : ""}
            </button>
            <button onClick={() => setShowPromptPreview(true)}
              style={{ ...s.btnGhost, textAlign: "center", padding: "10px 14px" }}>
              {t("coach.show_prompt")}
            </button>
            {chatMessages.length > 0 && (
              <button onClick={clearChat}
                style={{ ...s.btnGhost, textAlign: "center", padding: "10px 14px" }}>
                {t("coach.clear_chat")}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Config / Memory / Prompt Preview — now MODALS instead of inline
          panels. The toggle buttons set the show* state which opens the
          modal; the modal has its own ✕ close. No more "I forgot to hide
          this panel" footgun. Modals overlay both desktop and mobile views,
          and the legacy 2-col desktop "memory + prompt" layout is dropped
          (one at a time is fine — these aren't compared often). */}
      {showCoachConfig && (
        <ModalRoot>
          <div style={s.modalOverlay(isMobile)} onClick={() => setShowCoachConfig(false)}>
            <div style={s.modalCard(isMobile, { maxWidth: 600 })} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <h2 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>{t("coach.behavior")}</h2>
                <button onClick={() => setShowCoachConfig(false)} style={s.modalCloseBtn} aria-label="Close">×</button>
              </div>
              <div style={{ ...s.muted, marginBottom: 16, lineHeight: 1.5 }}>{t("coach.behavior_hint")}</div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ ...s.label, marginBottom: 6 }}>{t("coach.style")}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {COACH_STYLES.map(o => (
                    <button key={o.id} onClick={() => setStyle(o.id)}
                      style={{ ...s.chip(coachConfig.style === o.id), padding: "10px 14px", width: "100%", textAlign: "center" }}>
                      {t(`enum.coach.${o.id}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ ...s.label, marginBottom: 6 }}>{t("coach.length")}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {OUTPUT_LENGTHS.map(o => (
                    <button key={o.id} onClick={() => setOutputLength(o.id)}
                      style={{ ...s.chip(coachConfig.outputLength === o.id), padding: "10px 14px", width: "100%", textAlign: "center" }}>
                      {t(`enum.length.${o.id}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ ...s.label, marginBottom: 6 }}>{t("coach.intervention")}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {INTERVENTION_LEVELS.map(o => (
                    <button key={o.id} onClick={() => setIntervention(o.id)}
                      style={{ ...s.chip(coachConfig.intervention === o.id), padding: "10px 14px", width: "100%", textAlign: "center" }}>
                      {t(`enum.intervention.${o.id}`)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </ModalRoot>
      )}

      {showMemory && (
        <ModalRoot>
          <div style={s.modalOverlay(isMobile)} onClick={() => setShowMemory(false)}>
            <div style={s.modalCard(isMobile, { maxWidth: 600 })} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <h2 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>{t("coach.memory_title")}</h2>
                <button onClick={() => setShowMemory(false)} style={s.modalCloseBtn} aria-label="Close">×</button>
              </div>
              <div style={{ ...s.muted, marginBottom: 14, lineHeight: 1.5 }}>{t("coach.memory_hint")}</div>

              {!memoryEditing && !memoryProposal && (
                <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                  <button onClick={proposeMemoryUpdate}
                    disabled={memoryUpdating || chatMessages.length === 0}
                    style={{ ...s.btnGhost, fontSize: 12, padding: "6px 12px", opacity: (memoryUpdating || chatMessages.length === 0) ? 0.5 : 1 }}>
                    {memoryUpdating ? t("coach.memory_updating") : t("coach.memory_auto_update")}
                  </button>
                  <button onClick={startEditMemory}
                    style={{ ...s.btnGhost, fontSize: 12, padding: "6px 12px" }}>
                    {t("coach.memory_edit")}
                  </button>
                </div>
              )}

              {memoryProposal ? (
                <>
                  <div style={{ ...s.label, marginBottom: 6, color: "var(--moss-deep)" }}>{t("coach.memory_proposal_title")}</div>
                  <pre style={{
                    ...s.input, fontFamily: "var(--font-mono)", fontSize: 12,
                    whiteSpace: "pre-wrap", lineHeight: 1.55, maxHeight: 360, overflowY: "auto",
                    color: "var(--ink-1)", background: "var(--moss-bg)",
                    borderColor: "var(--moss)",
                  }}>{memoryProposal.text}</pre>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button onClick={acceptMemoryProposal} style={s.btn}>{t("coach.memory_accept")}</button>
                    <button onClick={rejectMemoryProposal} style={s.btnGhost}>{t("coach.memory_reject")}</button>
                  </div>
                </>
              ) : memoryEditing ? (
                <>
                  <textarea rows={10} value={memoryDraft}
                    onChange={e => setMemoryDraft(e.target.value)}
                    placeholder={t("coach.memory_placeholder")}
                    style={{ ...s.input, fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.55, resize: "vertical" }} />
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button onClick={saveMemory} style={s.btn}>{t("common.save")}</button>
                    <button onClick={cancelEditMemory} style={s.btnGhost}>{t("common.cancel")}</button>
                  </div>
                </>
              ) : (
                <pre style={{
                  ...s.input, fontFamily: "var(--font-mono)", fontSize: 12,
                  whiteSpace: "pre-wrap", lineHeight: 1.55, maxHeight: 420, overflowY: "auto",
                  color: coachMemory ? "var(--ink-1)" : "var(--ink-3)", background: "var(--bg-elevated)",
                  minHeight: 80,
                }}>{coachMemory || t("coach.memory_empty")}</pre>
              )}
            </div>
          </div>
        </ModalRoot>
      )}

      {showPromptPreview && (
        <ModalRoot>
          <div style={s.modalOverlay(isMobile)} onClick={() => setShowPromptPreview(false)}>
            <div style={s.modalCard(isMobile, { maxWidth: 680 })} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
                <h2 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>{t("coach.prompt_title")}</h2>
                <div style={{ display: "flex", gap: 0, marginLeft: "auto" }}>
                  <button onClick={() => setPreviewLang("en")}
                    style={{ ...s.btnGhost, fontSize: 11, padding: "4px 10px",
                      borderRight: "none",
                      background: previewLang === "en" ? "var(--ink-1)" : "transparent",
                      color: previewLang === "en" ? "var(--ink-inv)" : "var(--ink-2)" }}>
                    EN
                  </button>
                  <button onClick={() => setPreviewLang("zh")}
                    style={{ ...s.btnGhost, fontSize: 11, padding: "4px 10px",
                      background: previewLang === "zh" ? "var(--ink-1)" : "transparent",
                      color: previewLang === "zh" ? "var(--ink-inv)" : "var(--ink-2)" }}>
                    中
                  </button>
                </div>
                <button onClick={() => setShowPromptPreview(false)} style={s.modalCloseBtn} aria-label="Close">×</button>
              </div>
              <pre style={{
                ...s.input, fontFamily: "var(--font-mono)", fontSize: 12,
                whiteSpace: "pre-wrap", lineHeight: 1.55, maxHeight: "60vh", overflowY: "auto",
                color: "var(--ink-1)", background: "var(--bg-elevated)",
              }}>{previewPrompt}</pre>
              <div style={{ ...s.muted, marginTop: 6, lineHeight: 1.5 }}>{t("coach.prompt_hint")}{previewLang === "zh" ? ` ${t("coach.prompt_zh_note")}` : ""}</div>
            </div>
          </div>
        </ModalRoot>
      )}

      {/* CHAT VIEW (hidden on mobile when in the settings sub-page) ──────── */}
      {inChat && (<>
      {/* Soft hint once chat history grows past the threshold — older turns
          start competing with the system prompt for the model's attention.
          One-tap to open Memory; not blocking. */}
      {chatMessages.length >= LONG_CHAT_HINT_THRESHOLD && !showMemory && (
        <div style={{
          marginBottom: 14, padding: "10px 14px",
          border: "1px solid var(--rule)",
          background: "rgba(181,78,26,0.06)",
          display: "flex", gap: 12, alignItems: "flex-start",
          flexWrap: "wrap",
        }}>
          <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.55, flex: 1, minWidth: 220 }}>
            {t("coach.long_chat_hint", { n: chatMessages.length })}
          </div>
          <button onClick={() => setShowMemory(true)}
            style={{ ...s.btnGhost, fontSize: 12, padding: "5px 10px", flexShrink: 0 }}>
            {t("coach.long_chat_action")}
          </button>
        </div>
      )}

      <div ref={chatScrollRef} style={{
        ...s.card,
        marginBottom: isMobile ? 0 : 12,
        // Mobile: chat fills available vertical space inside the flex column;
        // min-height: 0 lets it shrink (default min-content would prevent
        // shrinking and break the layout). Desktop: capped between 200-500.
        flex: isMobile ? 1 : undefined,
        minHeight: isMobile ? 0 : 200,
        maxHeight: isMobile ? undefined : 500,
        overflowY: "auto",
      }}>
        {chatMessages.length === 0 ? (
          <div style={{ color: "#888", textAlign: "center", padding: 30, fontSize: 13, whiteSpace: "pre-line" }}>
            {t("coach.empty")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {chatMessages.map((m, i) => {
              // Persistent assistant replies (i.e. not local error bubbles) get
              // an "Import to Calendar" affordance — a tiny 📅 icon button sitting
              // to the right of the bubble. Avoids the extra row the old wide
              // button took up under every assistant message.
              const canImport = m.role === "assistant" && !m.isLocal && bulkAddLogs;
              const extracting = extractingForIdx === i;
              return (
                <div key={i} style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  display: "flex", flexDirection: "row", alignItems: "flex-end", gap: 6,
                }}>
                  <div style={{
                    background: m.role === "user" ? "#222" : "#f5f5f5",
                    color: m.role === "user" ? "#fff" : "#222",
                    borderRadius: 10, padding: "10px 14px",
                    fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap",
                    minWidth: 0,
                  }}>{m.content}</div>
                  {canImport && (
                    <button
                      onClick={() => importToCalendar(m.content, i)}
                      disabled={extracting}
                      aria-label={t("coach.import_button")}
                      title={extracting ? t("coach.extracting") : t("coach.import_button")}
                      style={{
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--rule)",
                        borderRadius: 4,
                        width: 32, height: 32, minHeight: 32,
                        padding: 0, fontSize: 15, lineHeight: 1,
                        cursor: extracting ? "default" : "pointer",
                        opacity: extracting ? 0.5 : 1,
                        flexShrink: 0,
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                      }}>
                      📅
                    </button>
                  )}
                </div>
              );
            })}
            {chatLoading && <div style={{ alignSelf: "flex-start", color: "#888", fontSize: 13 }}>{t("coach.thinking")}</div>}
          </div>
        )}
      </div>

      {/* Input row. flex-shrink: 0 pins it to the bottom of the AICoachTab
          flex column. Mobile: ⚙ stacked above ⏎ in a slim column on the
          right (⚙ opens the settings sub-page). Desktop: plain Send button.
          --mobile-input-fs is a CSS variable the global mobile rule reads —
          lets this specific textarea drop below 16px without breaking the
          iOS-zoom-prevention rule for every other input. */}
      <div style={{
        display: "flex", gap: 8, alignItems: "stretch",
        paddingTop: isMobile ? 10 : 0,
        borderTop: isMobile ? "1px solid var(--rule)" : "none",
        flexShrink: 0,
      }}>
        <textarea
          rows={isMobile ? 3 : 9}
          placeholder={t("coach.input_placeholder")}
          value={chatInput}
          onChange={e => setChatInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendChat(); }}
          style={{
            ...s.input,
            resize: isMobile ? "none" : "vertical",
            fontFamily: "var(--font-sans)",
            flex: 1,
            lineHeight: 1.45,
            "--mobile-input-fs": isMobile ? "14px" : undefined,
          }} />
        {isMobile ? (
          // align-items: stretch on the parent row already matches the column
          // height to the textarea. flex: 1 on each button splits that evenly
          // so ⚙ and ⏎ are exactly the same height — no more visual jitter.
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0, width: 44 }}>
            <button onClick={() => setShowCoachMenu(true)} aria-label={t("coach.menu_open")}
              style={{
                ...s.btnGhost,
                flex: 1, width: "100%",
                padding: 0, fontSize: 14, lineHeight: 1,
                minHeight: 0,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}>
              ⚙{coachMemory ? " ●" : ""}
            </button>
            <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()}
              aria-label={t("coach.send")}
              style={{
                ...s.btn,
                flex: 1, width: "100%",
                padding: 0, fontSize: 20, lineHeight: 1,
                minHeight: 0,
                opacity: chatLoading || !chatInput.trim() ? 0.4 : 1,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}>
              ⏎
            </button>
          </div>
        ) : (
          <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()}
            style={{ ...s.btn, padding: "10px 20px", opacity: chatLoading || !chatInput.trim() ? 0.5 : 1 }}>
            {t("coach.send")}
          </button>
        )}
      </div>
      </>)}

      {planProposal && (
        <CoachPlanImportModal
          plans={planProposal.plans}
          onConfirm={confirmImportPlans}
          onCancel={() => setPlanProposal(null)}
        />
      )}
    </div>
  );
}
