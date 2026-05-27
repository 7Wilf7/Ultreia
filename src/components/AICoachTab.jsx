import { useState, useEffect, useRef } from "react";
import { s } from "../styles";
import {
  API_PROVIDERS, DEFAULT_API_PROVIDER, getEndpointUrl,
  COACH_STYLES, OUTPUT_LENGTHS, INTERVENTION_LEVELS,
} from "../constants";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { buildSystemPrompt } from "../utils/profile";
import { buildDataBlock } from "../utils/coachPrompt";
import { ModalRoot } from "./ModalRoot";
import { Spinner } from "./Spinner";

// At this many persisted messages, surface a soft hint suggesting the user
// distill Memory + clear the chat. Older turns start competing with the
// system prompt for the model's attention past ~20 turns.
const LONG_CHAT_HINT_THRESHOLD = 20;

export function AICoachTab({
  logs, races, profile, coachConfig, setCoachConfig,
  coachMemory, setCoachMemory,
  chatMessages,
  now, setConfirmDelete,
  apiProvider, apiKey, claudeApiKey, claudeEndpointId, apiModel, onEditProfile,
  // Lifted from AppShell so they survive tab switches — the user can send
  // a message, tab away, and the spinner badge on the AI Coach tab still
  // shows the model is working.
  chatLoading, extractingForMsgId, sendChat, importToCalendar,
}) {
  // Provider-aware endpoint + key for the memory-proposal call, which still
  // lives in this tab (only triggered from the Memory modal opened inside it).
  const provider = API_PROVIDERS[apiProvider] || API_PROVIDERS[DEFAULT_API_PROVIDER];
  const apiEndpoint = apiProvider === "claude"
    ? getEndpointUrl("claude", claudeEndpointId)
    : provider.endpoints[0].url;
  const activeKey = apiProvider === "claude" ? claudeApiKey : apiKey;
  const t = useT();
  const { lang } = useLanguage();
  const isMobile = useIsMobile();
  const [showCoachConfig, setShowCoachConfig] = useState(false);
  const [showCalendarSettings, setShowCalendarSettings] = useState(false);
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

  // Single ⚙ toggle replaces the row of toggle buttons (config / memory /
  // prompt preview / edit profile / clear chat). Open the menu to access
  // any of those — keeps the top of the tab uncluttered.
  // Mobile: opens an in-place settings sub-page (kept for the touch flow).
  // Desktop: opens a unified hub modal with vertical tabs on the left + the
  // selected tab's content rendered on the right — see CoachSettingsHub
  // below. coachHubTab tracks which tab is active in that modal.
  const [showCoachMenu, setShowCoachMenu] = useState(false);
  const [showCoachHub, setShowCoachHub] = useState(false);
  const [coachHubTab, setCoachHubTab] = useState("config");

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
    if (!activeKey) {
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
          "x-api-key": activeKey,
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
  function setShowCalendarButton(v) { setCoachConfig({ ...coachConfig, showCalendarButton: v }); }

  // Dynamic data block injected into the system prompt. Only the section titles
  // are localized; values (dates, race names, numbers) stay verbatim across
  // languages so the model receives consistent data.
  // `logsOverride` lets sendChat pass freshly-refetched logs directly without
  // waiting for the next React render (avoids the "I just added a workout
  // but Coach can't see it" cross-tab/device race condition).
  // Preview honors the user's toggle. The actual prompt sent to the LLM by
  // sendChat (in AppShell) always uses English for stable instruction-
  // following; this preview is read-only and respects whichever language
  // toggle the user picked above.
  const previewPrompt = buildSystemPrompt({
    profile, coachConfig, coachMemory,
    dataBlock: buildDataBlock({ logs, races, now, lang: previewLang }),
    lang: previewLang,
  });

  // Wrapper around the lifted sendChat — clears the input box on the way
  // through. Guards against empty input + already-loading at this layer so
  // we don't even bother calling up if the input is empty.
  async function handleSend() {
    const userMsg = chatInput.trim();
    if (!userMsg || chatLoading) return;
    setChatInput("");
    await sendChat(userMsg);
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
      {/* DESKTOP top button row was here — removed in the May-26 desktop
          revamp. The ⚙ moved into the input row on the right (mirroring
          mobile), and clicking it now opens the unified CoachSettingsHub
          modal rendered near the bottom of this component. */}

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
            <button onClick={() => setShowCalendarSettings(true)}
              style={{ ...s.btnGhost, textAlign: "center", padding: "10px 14px" }}>
              {t("coach.calendar_btn_label")}
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

      {/* Calendar button toggle — separate modal opened from the mobile settings
          sub-page. Pulled out of the Coach Config modal because it's a display
          preference, not a behavior knob about the coach itself. */}
      {showCalendarSettings && (
        <ModalRoot>
          <div style={s.modalOverlay(isMobile)} onClick={() => setShowCalendarSettings(false)}>
            <div style={s.modalCard(isMobile, { maxWidth: 600 })} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <h2 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>{t("coach.calendar_btn_label")}</h2>
                <button onClick={() => setShowCalendarSettings(false)} style={s.modalCloseBtn} aria-label="Close">×</button>
              </div>
              <div style={{ ...s.muted, marginBottom: 16, lineHeight: 1.5 }}>{t("coach.calendar_btn_hint")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button onClick={() => setShowCalendarButton(true)}
                  style={{ ...s.chip(coachConfig.showCalendarButton !== false), padding: "10px 14px", width: "100%", textAlign: "center" }}>
                  {t("coach.calendar_btn_on")}
                </button>
                <button onClick={() => setShowCalendarButton(false)}
                  style={{ ...s.chip(coachConfig.showCalendarButton === false), padding: "10px 14px", width: "100%", textAlign: "center" }}>
                  {t("coach.calendar_btn_off")}
                </button>
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
            {(() => {
              // The "resend" affordance only shows on the most-recent user message
              // (an older send is rarely what the user wants to retry — usually they
              // hit a network error on the last one).
              let lastUserIdx = -1;
              for (let k = chatMessages.length - 1; k >= 0; k--) {
                if (chatMessages[k].role === "user") { lastUserIdx = k; break; }
              }
              return chatMessages.map((m, i) => {
                const isUser = m.role === "user";
                const canImport = m.role === "assistant" && !m.isLocal && importToCalendar && coachConfig.showCalendarButton;
                const canResend = isUser && i === lastUserIdx && !chatLoading && sendChat;
                const extracting = extractingForMsgId === m.id;
                return (
                  <div key={i} style={{
                    alignSelf: isUser ? "flex-end" : "flex-start",
                    // Mobile bubbles get wider so long messages don't squeeze into
                    // a narrow column the user has to keep scrolling to read.
                    // Color already differentiates user vs coach so the visual
                    // "tail" of leftover horizontal space isn't needed.
                    maxWidth: isMobile ? "94%" : "85%",
                    display: "flex", flexDirection: "column",
                    alignItems: isUser ? "flex-end" : "flex-start",
                    gap: 6, minWidth: 0,
                  }}>
                    <div style={{
                      background: isUser ? "#222" : "#f5f5f5",
                      color: isUser ? "#fff" : "#222",
                      borderRadius: 10, padding: "10px 14px",
                      fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap",
                      minWidth: 0,
                    }}>{m.content}</div>

                    {/* Calendar import affordance — text button below the bubble.
                        Gated by the showCalendarButton coach setting (default ON).
                        Shows on persistent assistant replies only. */}
                    {canImport && (
                      <button
                        onClick={() => importToCalendar(m.content, m.id)}
                        disabled={extracting}
                        style={{
                          background: "var(--bg-elevated)",
                          border: "1px solid var(--rule)",
                          borderRadius: 4,
                          padding: "5px 10px",
                          fontSize: 12, lineHeight: 1.2,
                          color: "var(--ink-2)",
                          fontFamily: "var(--font-sans)",
                          cursor: extracting ? "default" : "pointer",
                          display: "inline-flex", alignItems: "center", gap: 6,
                        }}>
                        {extracting ? <Spinner size={12} thickness={1.5} color="var(--moss)" /> : "📅"}
                        {extracting ? t("coach.extracting") : t("coach.import_button")}
                      </button>
                    )}

                    {/* Resend affordance — only on the latest user msg, only when
                        not currently waiting on a reply. Fixes the "tab away → come
                        back → network error" case where the user wants one-tap retry
                        without having to copy/paste their text. */}
                    {canResend && (
                      <button
                        onClick={() => sendChat(m.content)}
                        style={{
                          background: "var(--bg-elevated)",
                          border: "1px solid var(--rule)",
                          borderRadius: 4,
                          padding: "4px 10px",
                          fontSize: 11, lineHeight: 1.2,
                          color: "var(--ink-3)",
                          fontFamily: "var(--font-sans)",
                          cursor: "pointer",
                          display: "inline-flex", alignItems: "center", gap: 5,
                        }}>
                        ↻ {t("coach.resend")}
                      </button>
                    )}
                  </div>
                );
              });
            })()}
            {chatLoading && (
              <div style={{
                alignSelf: "flex-start", color: "#888", fontSize: 13,
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "10px 14px",
              }}>
                <Spinner size={12} thickness={1.5} color="var(--moss)" />
                {t("coach.thinking")}
              </div>
            )}
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
          onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSend(); }}
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
            <button onClick={handleSend} disabled={chatLoading || !chatInput.trim()}
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
          // Desktop: ⚙ stacked above Send in a slim column, mirroring mobile.
          // ⚙ opens the unified hub modal (vertical tabs on left, content on right).
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0, width: 84 }}>
            <button onClick={() => setShowCoachHub(true)} aria-label={t("coach.menu_open")}
              style={{ ...s.btnGhost, padding: "8px 10px", fontSize: 13, lineHeight: 1.2 }}>
              ⚙{coachMemory ? " ●" : ""}
            </button>
            <button onClick={handleSend} disabled={chatLoading || !chatInput.trim()}
              style={{
                ...s.btn, padding: "10px 20px",
                opacity: chatLoading || !chatInput.trim() ? 0.5 : 1,
                flex: 1,
              }}>
              {t("coach.send")}
            </button>
          </div>
        )}
      </div>
      </>)}

      {/* Desktop unified settings hub. Left vertical tabs route the right
          pane to one of the existing config / memory / prompt-preview blocks,
          plus shortcuts to Edit Profile and Clear Chat. Mobile keeps its
          in-place settings sub-page (rendered above when inSettings). */}
      {showCoachHub && !isMobile && (
        <ModalRoot>
          <div style={s.modalOverlay(false)} onClick={() => setShowCoachHub(false)}>
            <div onClick={(e) => e.stopPropagation()}
              style={{
                ...s.modalCard(false, { maxWidth: 880 }),
                padding: 0,
                display: "flex", flexDirection: "column",
                maxHeight: "85vh",
              }}>
              {/* Header */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "14px 18px", borderBottom: "1px solid var(--rule)",
              }}>
                <h2 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>{t("coach.settings_title")}</h2>
                <button onClick={() => setShowCoachHub(false)} style={s.modalCloseBtn} aria-label="Close">×</button>
              </div>

              {/* Body: left tabs + right content */}
              <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
                {/* Left vertical tab strip */}
                <div style={{
                  width: 180, flexShrink: 0,
                  borderRight: "1px solid var(--rule)",
                  background: "var(--bg-sunken)",
                  display: "flex", flexDirection: "column",
                  padding: "10px 0",
                }}>
                  {[
                    { id: "profile",  label: t("coach.edit_profile") },
                    { id: "config",   label: t("coach.show_config") },
                    { id: "calendar", label: t("coach.calendar_btn_label") },
                    { id: "memory",   label: t("coach.show_memory") + (coachMemory ? " ●" : "") },
                    { id: "prompt",   label: t("coach.show_prompt") },
                    { id: "clear",    label: t("coach.clear_chat") },
                  ].map(tab => {
                    const active = coachHubTab === tab.id;
                    return (
                      <button key={tab.id}
                        onClick={() => setCoachHubTab(tab.id)}
                        style={{
                          textAlign: "left",
                          background: active ? "var(--bg-elevated)" : "transparent",
                          border: "none",
                          borderLeft: active ? "3px solid var(--ink-1)" : "3px solid transparent",
                          padding: "10px 14px",
                          fontFamily: "var(--font-sans)",
                          fontSize: 13,
                          fontWeight: active ? 600 : 500,
                          color: active ? "var(--ink-1)" : "var(--ink-2)",
                          cursor: "pointer", borderRadius: 0,
                        }}>
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {/* Right content pane */}
                <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "18px 22px" }}>
                  {coachHubTab === "profile" && (
                    <div>
                      <p style={{ ...s.muted, lineHeight: 1.6, marginTop: 0 }}>
                        {t("coach.profile_hub_hint")}
                      </p>
                      <button onClick={() => { setShowCoachHub(false); onEditProfile(); }} style={s.btn}>
                        {t("coach.edit_profile")}
                      </button>
                    </div>
                  )}

                  {coachHubTab === "config" && (
                    <div>
                      <div style={{ ...s.muted, marginBottom: 16, lineHeight: 1.5 }}>{t("coach.behavior_hint")}</div>
                      <div style={{ marginBottom: 18 }}>
                        <div style={{ ...s.label, marginBottom: 6 }}>{t("coach.style")}</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {COACH_STYLES.map(o => (
                            <button key={o.id} onClick={() => setStyle(o.id)}
                              style={s.chip(coachConfig.style === o.id)}>
                              {t(`enum.coach.${o.id}`)}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div style={{ marginBottom: 18 }}>
                        <div style={{ ...s.label, marginBottom: 6 }}>{t("coach.length")}</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {OUTPUT_LENGTHS.map(o => (
                            <button key={o.id} onClick={() => setOutputLength(o.id)}
                              style={s.chip(coachConfig.outputLength === o.id)}>
                              {t(`enum.length.${o.id}`)}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div style={{ ...s.label, marginBottom: 6 }}>{t("coach.intervention")}</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {INTERVENTION_LEVELS.map(o => (
                            <button key={o.id} onClick={() => setIntervention(o.id)}
                              style={s.chip(coachConfig.intervention === o.id)}>
                              {t(`enum.intervention.${o.id}`)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {coachHubTab === "calendar" && (
                    <div>
                      <div style={{ ...s.muted, marginBottom: 14, lineHeight: 1.6 }}>{t("coach.calendar_btn_hint")}</div>
                      <div style={{ ...s.label, marginBottom: 6 }}>{t("coach.calendar_btn_label")}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button onClick={() => setShowCalendarButton(true)}
                          style={s.chip(coachConfig.showCalendarButton !== false)}>
                          {t("coach.calendar_btn_on")}
                        </button>
                        <button onClick={() => setShowCalendarButton(false)}
                          style={s.chip(coachConfig.showCalendarButton === false)}>
                          {t("coach.calendar_btn_off")}
                        </button>
                      </div>
                    </div>
                  )}

                  {coachHubTab === "memory" && (
                    <div>
                      <div style={{ ...s.muted, marginBottom: 14, lineHeight: 1.5 }}>{t("coach.memory_hint")}</div>
                      {!memoryEditing && !memoryProposal && (
                        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                          <button onClick={proposeMemoryUpdate}
                            disabled={memoryUpdating || chatMessages.length === 0}
                            style={{ ...s.btnGhost, fontSize: 12, padding: "6px 12px", opacity: (memoryUpdating || chatMessages.length === 0) ? 0.5 : 1 }}>
                            {memoryUpdating ? t("coach.memory_updating") : t("coach.memory_auto_update")}
                          </button>
                          <button onClick={startEditMemory} style={{ ...s.btnGhost, fontSize: 12, padding: "6px 12px" }}>
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
                            color: "var(--ink-1)", background: "var(--moss-bg)", borderColor: "var(--moss)",
                          }}>{memoryProposal.text}</pre>
                          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                            <button onClick={acceptMemoryProposal} style={s.btn}>{t("coach.memory_accept")}</button>
                            <button onClick={rejectMemoryProposal} style={s.btnGhost}>{t("coach.memory_reject")}</button>
                          </div>
                        </>
                      ) : memoryEditing ? (
                        <>
                          <textarea rows={12} value={memoryDraft}
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
                  )}

                  {coachHubTab === "prompt" && (
                    <div>
                      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                        <div style={{ display: "flex", gap: 0 }}>
                          <button onClick={() => setPreviewLang("en")}
                            style={{ ...s.btnGhost, fontSize: 11, padding: "4px 10px", borderRight: "none",
                              background: previewLang === "en" ? "var(--ink-1)" : "transparent",
                              color: previewLang === "en" ? "var(--ink-inv)" : "var(--ink-2)" }}>EN</button>
                          <button onClick={() => setPreviewLang("zh")}
                            style={{ ...s.btnGhost, fontSize: 11, padding: "4px 10px",
                              background: previewLang === "zh" ? "var(--ink-1)" : "transparent",
                              color: previewLang === "zh" ? "var(--ink-inv)" : "var(--ink-2)" }}>中</button>
                        </div>
                      </div>
                      <pre style={{
                        ...s.input, fontFamily: "var(--font-mono)", fontSize: 12,
                        whiteSpace: "pre-wrap", lineHeight: 1.55, maxHeight: "55vh", overflowY: "auto",
                        color: "var(--ink-1)", background: "var(--bg-elevated)",
                      }}>{previewPrompt}</pre>
                      <div style={{ ...s.muted, marginTop: 6, lineHeight: 1.5 }}>
                        {t("coach.prompt_hint")}{previewLang === "zh" ? ` ${t("coach.prompt_zh_note")}` : ""}
                      </div>
                    </div>
                  )}

                  {coachHubTab === "clear" && (
                    <div>
                      <p style={{ ...s.muted, lineHeight: 1.6, marginTop: 0 }}>
                        {t("coach.clear_hub_hint")}
                      </p>
                      <button onClick={() => { setShowCoachHub(false); clearChat(); }}
                        disabled={chatMessages.length === 0}
                        style={{ ...s.btn, background: "#c0392b", borderColor: "#c0392b", opacity: chatMessages.length === 0 ? 0.4 : 1 }}>
                        {t("coach.clear_chat")} ({chatMessages.length})
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </ModalRoot>
      )}

      {/* The plan-import review modal lives at AppShell level (so it pops up
          even if the user walked away from this tab while extraction was
          running). See <CoachPlanImportModal> in App.jsx. */}
    </div>
  );
}
