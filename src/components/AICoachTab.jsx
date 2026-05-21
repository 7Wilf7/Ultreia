import { useState } from "react";
import { s } from "../styles";
import {
  DEFAULT_API_ENDPOINT,
  COACH_STYLES, OUTPUT_LENGTHS, INTERVENTION_LEVELS,
  ACTIVITY_TYPES,
} from "../constants";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { formatDuration, formatPaceFromSec } from "../utils/format";
import { buildSystemPrompt } from "../utils/profile";
import { CoachPlanImportModal } from "./CoachPlanImportModal";

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
// section titles change. The "en" version is canonical (LLM-facing).
const DATA_LABELS = {
  en: {
    currentDate: "[Current Date]",
    targets: "[Target Races]",
    history: "[Race History]",
    recent: "[Recent Activities (last 10)]",
    none: "None",
    goal: "goal",
  },
  zh: {
    currentDate: "[当前时间]",
    targets: "[目标比赛]",
    history: "[比赛历史]",
    recent: "[近期活动（最近 10 条）]",
    none: "无",
    goal: "目标",
  },
};

export function AICoachTab({
  logs, races, profile, coachConfig, setCoachConfig,
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
          max_tokens: 4000,
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
  function buildDataBlock(useLang = "en") {
    const D = DATA_LABELS[useLang] || DATA_LABELS.en;
    // Strip future-planned entries — the LLM should only see what actually
    // happened. Planned rows would otherwise be misread as "recent activity"
    // (e.g. "your last run was 10km" when the user hasn't run it yet).
    const recentLogs = logs.filter(l => !l.isPlanned).slice(0, 10).map(l =>
      `${l.date} ${l.type}${l.subTypes.length ? "(" + l.subTypes.join(",") + ")" : ""} ${l.distance > 0 ? l.distance + "km" : ""} ${formatDuration(l.duration)}${l.pace ? " " + formatPaceFromSec(l.pace) + "/km" : ""}${l.hr ? " HR" + l.hr : ""}${l.maxHR ? "/" + l.maxHR : ""}${l.ascent ? " +" + l.ascent + "m" : ""}${l.cadence ? " cad" + l.cadence : ""}${l.aerobicTE ? " TE" + l.aerobicTE : ""}${l.gap ? " GAP" + formatPaceFromSec(l.gap) : ""}`
    ).join("\n");
    const targetRaces = races.filter(r => r.isTarget).map(r => {
      const goal = [r.resultH, r.resultM, r.resultS].some(Boolean) ? `${r.resultH || "0"}h${r.resultM || "0"}m${r.resultS || "0"}s` : "—";
      return `[${r.priority}] ${r.name}${r.category ? ` (${r.category})` : ""} on ${r.date} (${r.distance}${r.ascent ? ", +" + r.ascent + "m" : ""}) - ${D.goal}: ${goal}`;
    }).join("\n") || D.none;
    const historyRaces = races.filter(r => !r.isTarget).map(r => {
      const result = [r.resultH, r.resultM, r.resultS].some(Boolean) ? `${r.resultH || "0"}:${r.resultM || "0"}:${r.resultS || "0"}` : "—";
      return `${r.date} ${r.name}${r.category ? ` [${r.category}]` : ""} ${r.distance} → ${result}${r.itraScore ? " ITRA " + r.itraScore : ""}`;
    }).join("\n") || D.none;

    return `${D.currentDate} ${now.toISOString().slice(0, 16).replace("T", " ")} GMT+8

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
          max_tokens: 1500,
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

    // Canonical English prompt for LLM (more stable). The model still replies
    // in the user's language because FIXED_SYSTEM_PROMPT includes that directive.
    const systemPrompt = buildSystemPrompt({
      profile, coachConfig, coachMemory,
      dataBlock: buildDataBlock("en"),
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
          max_tokens: 1200,
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

  return (
    <div>
      <div style={{ marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={onEditProfile} style={s.btnGhost}>{t("coach.edit_profile")}</button>
        <button onClick={() => setShowCoachConfig(!showCoachConfig)} style={s.btnGhost}>
          {showCoachConfig ? t("coach.hide_config") : t("coach.show_config")}
        </button>
        <button onClick={() => setShowMemory(!showMemory)} style={s.btnGhost}>
          {showMemory ? t("coach.hide_memory") : t("coach.show_memory")}{coachMemory ? " ●" : ""}
        </button>
        <button onClick={() => setShowPromptPreview(!showPromptPreview)} style={s.btnGhost}>
          {showPromptPreview ? t("coach.hide_prompt") : t("coach.show_prompt")}
        </button>
        {chatMessages.length > 0 && (
          <button onClick={clearChat} style={s.btnGhost}>{t("coach.clear_chat")}</button>
        )}
      </div>

      {showCoachConfig && (
        <div style={{ ...s.cardDark, marginBottom: 14 }}>
          <div style={s.section}>{t("coach.behavior")}</div>
          <div style={{ ...s.muted, marginBottom: 12, lineHeight: 1.5 }}>{t("coach.behavior_hint")}</div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ ...s.label, marginBottom: 6 }}>{t("coach.style")}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {COACH_STYLES.map(o => (
                <button key={o.id} onClick={() => setStyle(o.id)}
                  style={s.chip(coachConfig.style === o.id)}>{t(`enum.coach.${o.id}`)}</button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ ...s.label, marginBottom: 6 }}>{t("coach.length")}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {OUTPUT_LENGTHS.map(o => (
                <button key={o.id} onClick={() => setOutputLength(o.id)}
                  style={s.chip(coachConfig.outputLength === o.id)}>{t(`enum.length.${o.id}`)}</button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 4 }}>
            <div style={{ ...s.label, marginBottom: 6 }}>{t("coach.intervention")}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {INTERVENTION_LEVELS.map(o => (
                <button key={o.id} onClick={() => setIntervention(o.id)}
                  style={s.chip(coachConfig.intervention === o.id)}>{t(`enum.intervention.${o.id}`)}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showMemory && (
        <div style={{ ...s.cardDark, marginBottom: 14 }}>
          <div style={{ ...s.section, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span>{t("coach.memory_title")}</span>
            <div style={{ display: "flex", gap: 6 }}>
              {!memoryEditing && !memoryProposal && (
                <>
                  <button onClick={proposeMemoryUpdate}
                    disabled={memoryUpdating || chatMessages.length === 0}
                    style={{ ...s.btnGhost, fontSize: 12, padding: "5px 10px", opacity: (memoryUpdating || chatMessages.length === 0) ? 0.5 : 1 }}>
                    {memoryUpdating ? t("coach.memory_updating") : t("coach.memory_auto_update")}
                  </button>
                  <button onClick={startEditMemory}
                    style={{ ...s.btnGhost, fontSize: 12, padding: "5px 10px" }}>
                    {t("coach.memory_edit")}
                  </button>
                </>
              )}
            </div>
          </div>
          <div style={{ ...s.muted, marginBottom: 10, lineHeight: 1.5 }}>{t("coach.memory_hint")}</div>

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
              whiteSpace: "pre-wrap", lineHeight: 1.55, maxHeight: 360, overflowY: "auto",
              color: coachMemory ? "var(--ink-1)" : "var(--ink-3)", background: "var(--bg-elevated)",
              minHeight: 80,
            }}>{coachMemory || t("coach.memory_empty")}</pre>
          )}
        </div>
      )}

      {showPromptPreview && (
        <div style={{ ...s.cardDark, marginBottom: 14 }}>
          <div style={{ ...s.section, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span>{t("coach.prompt_title")}</span>
            {/* EN ↔ ZH toggle — only affects the preview, not what the LLM sees. */}
            <div style={{ display: "flex", gap: 0 }}>
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
          </div>
          <pre style={{
            ...s.input, fontFamily: "var(--font-mono)", fontSize: 11,
            whiteSpace: "pre-wrap", lineHeight: 1.55, maxHeight: 380, overflowY: "auto",
            color: "var(--ink-1)", background: "var(--bg-elevated)",
          }}>{previewPrompt}</pre>
          <div style={{ ...s.muted, marginTop: 6, lineHeight: 1.5 }}>{t("coach.prompt_hint")}{previewLang === "zh" ? ` ${t("coach.prompt_zh_note")}` : ""}</div>
        </div>
      )}

      <div style={{ ...s.card, marginBottom: 12, minHeight: 200, maxHeight: 500, overflowY: "auto" }}>
        {chatMessages.length === 0 ? (
          <div style={{ color: "#888", textAlign: "center", padding: 30, fontSize: 13, whiteSpace: "pre-line" }}>
            {t("coach.empty")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {chatMessages.map((m, i) => {
              // Persistent assistant replies (i.e. not local error bubbles) get
              // an "Import to Calendar" affordance — the button lives in its
              // own row right under the bubble so the bubble itself stays clean.
              const canImport = m.role === "assistant" && !m.isLocal && bulkAddLogs;
              const extracting = extractingForIdx === i;
              return (
                <div key={i} style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  display: "flex", flexDirection: "column",
                }}>
                  <div style={{
                    background: m.role === "user" ? "#222" : "#f5f5f5",
                    color: m.role === "user" ? "#fff" : "#222",
                    borderRadius: 10, padding: "10px 14px",
                    fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap",
                  }}>{m.content}</div>
                  {canImport && (
                    <button
                      onClick={() => importToCalendar(m.content, i)}
                      disabled={extracting}
                      style={{
                        ...s.btnGhost,
                        alignSelf: "flex-start",
                        marginTop: 5,
                        fontSize: 11, padding: "4px 10px",
                        opacity: extracting ? 0.5 : 1,
                      }}>
                      {extracting ? t("coach.extracting") : t("coach.import_button")}
                    </button>
                  )}
                </div>
              );
            })}
            {chatLoading && <div style={{ alignSelf: "flex-start", color: "#888", fontSize: 13 }}>{t("coach.thinking")}</div>}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea rows={9} placeholder={t("coach.input_placeholder")} value={chatInput}
          onChange={e => setChatInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendChat(); }}
          style={{ ...s.input, resize: "vertical", fontFamily: "var(--font-sans)", flex: 1, lineHeight: 1.5 }} />
        <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()} style={{ ...s.btn, padding: "10px 20px", opacity: chatLoading || !chatInput.trim() ? 0.5 : 1 }}>{t("coach.send")}</button>
      </div>
      <div style={{ ...s.muted, marginTop: 6, fontSize: 11 }}>{t("coach.tip")}</div>

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
