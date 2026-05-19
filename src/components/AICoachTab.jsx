import { useState } from "react";
import { s } from "../styles";
import {
  DEFAULT_DAILY_TEMPLATE,
  COACH_STYLES, OUTPUT_LENGTHS, INTERVENTION_LEVELS,
} from "../constants";
import { useT } from "../i18n/LanguageContext";
import { formatDuration, formatPaceFromSec } from "../utils/format";
import { buildSystemPrompt } from "../utils/profile";

export function AICoachTab({
  logs, races, profile, coachConfig, setCoachConfig,
  coachMemory, setCoachMemory,
  chatMessages, setChatMessages, now, setConfirmDelete,
  apiKey, apiEndpoint, apiModel, onEditProfile,
}) {
  const t = useT();
  const [showCoachConfig, setShowCoachConfig] = useState(false);
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState(coachMemory);
  const [memoryEditing, setMemoryEditing] = useState(false);
  const [memoryUpdating, setMemoryUpdating] = useState(false);
  const [memoryProposal, setMemoryProposal] = useState(null); // { text } when LLM has proposed an update
  const [chatInput, setChatInput] = useState(DEFAULT_DAILY_TEMPLATE);
  const [chatLoading, setChatLoading] = useState(false);

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

  // Dynamic data block injected into the system prompt. Always sent in English to
  // keep prompt structure stable across languages; the model replies in user's language.
  function buildDataBlock() {
    const recentLogs = logs.slice(0, 10).map(l =>
      `${l.date} ${l.type}${l.subTypes.length ? "(" + l.subTypes.join(",") + ")" : ""} ${l.distance > 0 ? l.distance + "km" : ""} ${formatDuration(l.duration)}${l.pace ? " " + formatPaceFromSec(l.pace) + "/km" : ""}${l.hr ? " HR" + l.hr : ""}${l.maxHR ? "/" + l.maxHR : ""}${l.ascent ? " +" + l.ascent + "m" : ""}${l.cadence ? " cad" + l.cadence : ""}${l.aerobicTE ? " TE" + l.aerobicTE : ""}${l.gap ? " GAP" + formatPaceFromSec(l.gap) : ""}`
    ).join("\n");
    const targetRaces = races.filter(r => r.isTarget).map(r => {
      const goal = [r.resultH, r.resultM, r.resultS].some(Boolean) ? `${r.resultH || "0"}h${r.resultM || "0"}m${r.resultS || "0"}s` : "—";
      return `[${r.priority}] ${r.name}${r.category ? ` (${r.category})` : ""} on ${r.date} (${r.distance}${r.ascent ? ", +" + r.ascent + "m" : ""}) - goal: ${goal}`;
    }).join("\n") || "None";
    const historyRaces = races.filter(r => !r.isTarget).map(r => {
      const result = [r.resultH, r.resultM, r.resultS].some(Boolean) ? `${r.resultH || "0"}:${r.resultM || "0"}:${r.resultS || "0"}` : "—";
      return `${r.date} ${r.name}${r.category ? ` [${r.category}]` : ""} ${r.distance} → ${result}${r.itraScore ? " ITRA " + r.itraScore : ""}`;
    }).join("\n") || "None";

    return `[Current Date] ${now.toISOString().slice(0, 16).replace("T", " ")} GMT+8

[Target Races]
${targetRaces}

[Race History]
${historyRaces}

[Recent Activities (last 10)]
${recentLogs}`;
  }

  const previewPrompt = buildSystemPrompt({ profile, coachConfig, coachMemory, dataBlock: buildDataBlock() });

  async function sendChat() {
    if (!chatInput.trim() || chatLoading) return;
    if (!apiKey) {
      setChatMessages([...chatMessages, { role: "assistant", content: t("coach.no_key") }]);
      return;
    }
    const userMsg = chatInput.trim();
    setChatLoading(true);

    const systemPrompt = buildSystemPrompt({ profile, coachConfig, coachMemory, dataBlock: buildDataBlock() });
    const newMessages = [...chatMessages, { role: "user", content: userMsg }];
    setChatMessages(newMessages);
    setChatInput("");

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
          messages: newMessages,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        const msg = data.error?.message || `HTTP ${resp.status}`;
        console.error("[AI Coach] API error:", data);
        setChatMessages([...newMessages, { role: "assistant", content: t("coach.api_error", { msg }) }]);
      } else {
        const reply = data.content?.filter(b => b.type === "text").map(b => b.text).join("") || t("coach.no_response");
        setChatMessages([...newMessages, { role: "assistant", content: reply }]);
      }
    } catch (err) {
      console.error("[AI Coach] Network error fetching", apiEndpoint, err);
      setChatMessages([
        ...newMessages,
        { role: "assistant", content: t("coach.network_error", { msg: err.message, url: apiEndpoint }) },
      ]);
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
          <div style={s.section}>{t("coach.prompt_title")}</div>
          <pre style={{
            ...s.input, fontFamily: "var(--font-mono)", fontSize: 11,
            whiteSpace: "pre-wrap", lineHeight: 1.5, maxHeight: 360, overflowY: "auto",
            color: "#444", background: "#fafafa",
          }}>{previewPrompt}</pre>
          <div style={{ ...s.muted, marginTop: 6 }}>{t("coach.prompt_hint")}</div>
        </div>
      )}

      <div style={{ ...s.card, marginBottom: 12, minHeight: 200, maxHeight: 500, overflowY: "auto" }}>
        {chatMessages.length === 0 ? (
          <div style={{ color: "#888", textAlign: "center", padding: 30, fontSize: 13, whiteSpace: "pre-line" }}>
            {t("coach.empty")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {chatMessages.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "85%",
                background: m.role === "user" ? "#222" : "#f5f5f5",
                color: m.role === "user" ? "#fff" : "#222",
                borderRadius: 10, padding: "10px 14px", fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap",
              }}>{m.content}</div>
            ))}
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
    </div>
  );
}
