import { useState, useEffect, useRef, useMemo, useLayoutEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { s } from "../styles";
import {
  API_PROVIDERS, DEFAULT_API_PROVIDER,
  COACH_STYLES, OUTPUT_LENGTHS, INTERVENTION_LEVELS,
  DEFAULT_COACH_CONFIG,
} from "../constants";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { buildPromptSkeleton, messageContentForCoach, parseCoachMessageMeta } from "../utils/coachPrompt";
import { ModalRoot } from "./ModalRoot";
import { Spinner } from "./Spinner";
import { CalendarIcon, CoachIcon, SettingsIcon, MailIcon } from "./Icons";

// Custom renderers for the markdown nodes that actually show up in coach
// replies. Keys to know:
//   - All elements `inherit` color from the bubble so user (dark) and
//     assistant (light) bubbles both read cleanly.
//   - GFM tables are wrapped in an overflow-x: auto div so 7-day weekly-plan
//     tables don't blow out the mobile viewport — the table itself stays
//     full-width, the user just horizontally scrolls inside the bubble.
//   - Code blocks get a subtle background that works against both bubble
//     colors.
//   - Margin/padding are tightened from browser defaults so a "###" heading
//     doesn't open up a huge gap inside a chat bubble.
// react-markdown passes a `node` AST entry alongside the standard HTML props.
// We don't need it for any of these renderers — drop it before spreading so
// React doesn't warn about unknown DOM attributes.
const stripNode = ({ node, ...rest }) => rest; // eslint-disable-line no-unused-vars

// Walk a hast subtree and collapse to plain text. Preserves newlines. Used
// by the mobile table renderer — cells inside coach tables are usually
// plain text or simple formatting, so flattening is acceptable.
function hastToText(node) {
  if (!node) return "";
  if (node.type === "text") return node.value || "";
  if (node.tagName === "br") return "\n";
  if (Array.isArray(node.children)) {
    return node.children.map(hastToText).join("");
  }
  return "";
}

// Pull thead headers + tbody rows out of a hast `table` node. Skips
// whitespace nodes that the markdown → hast conversion leaves between
// elements.
function extractTable(tableNode) {
  if (!tableNode || !Array.isArray(tableNode.children)) return { headers: [], rows: [] };
  const sections = tableNode.children.filter(c => c.type === "element");
  const thead = sections.find(c => c.tagName === "thead");
  const tbody = sections.find(c => c.tagName === "tbody");

  const headers = [];
  if (thead) {
    const headerRow = (thead.children || []).find(c => c.type === "element" && c.tagName === "tr");
    if (headerRow) {
      for (const th of headerRow.children || []) {
        if (th.type === "element" && th.tagName === "th") {
          headers.push(hastToText(th).trim());
        }
      }
    }
  }

  const rows = [];
  const trSource = tbody || tableNode;
  for (const tr of trSource.children || []) {
    if (tr.type !== "element" || tr.tagName !== "tr") continue;
    const cells = [];
    for (const cell of tr.children || []) {
      if (cell.type !== "element") continue;
      if (cell.tagName === "td" || cell.tagName === "th") {
        cells.push(hastToText(cell).trim());
      }
    }
    if (cells.length) rows.push(cells);
  }
  return { headers, rows };
}

// Mobile fallback for wide markdown tables. A 7-column weekly-plan table is
// painful to read via horizontal scroll inside a small chat bubble; instead
// each row becomes a stacked card, with the first cell as the card title
// and the remaining cells as "label: value" pairs underneath. Only invoked
// when the table is genuinely wide (cols >= 3) so narrow tables still fit
// naturally without the conversion overhead.
function MobileTableCards({ headers, rows }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "8px 0" }}>
      {rows.map((cells, ri) => (
        <div key={ri} style={{
          border: "1px solid rgba(128,128,128,0.4)",
          borderRadius: 6,
          padding: "8px 10px",
          fontSize: 12,
        }}>
          {cells[0] !== undefined && (
            <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13, whiteSpace: "pre-wrap" }}>
              {headers[0] ? `${headers[0]} ` : ""}{cells[0]}
            </div>
          )}
          {cells.slice(1).map((cell, ci) => {
            const header = headers[ci + 1];
            return (
              <div key={ci} style={{ display: "flex", gap: 6, lineHeight: 1.55, marginBottom: 3 }}>
                {header && (
                  <span style={{ fontWeight: 600, flexShrink: 0, opacity: 0.85 }}>{header}:</span>
                )}
                <span style={{ whiteSpace: "pre-wrap", flex: 1, minWidth: 0 }}>{cell || "—"}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function makeMdComponents(isMobile) {
  return {
  table: (p) => {
    // Mobile + wide table → stacked row cards. Desktop and narrow tables
    // keep the real <table> wrapped in overflow-x:auto.
    if (isMobile && p.node) {
      const { headers, rows } = extractTable(p.node);
      const colCount = Math.max(headers.length, ...rows.map(r => r.length));
      if (colCount >= 3) {
        return <MobileTableCards headers={headers} rows={rows} />;
      }
    }
    return (
      <div style={{ overflowX: "auto", maxWidth: "100%", margin: "8px 0" }}>
        <table {...stripNode(p)} style={{
          borderCollapse: "collapse", fontSize: 12,
          minWidth: "max-content",
        }} />
      </div>
    );
  },
  th: (p) => (
    <th {...stripNode(p)} style={{
      border: "1px solid", borderColor: "rgba(128,128,128,0.4)",
      padding: "5px 8px", textAlign: "left", fontWeight: 600,
      background: "rgba(128,128,128,0.08)",
      whiteSpace: "nowrap",
    }} />
  ),
  td: (p) => (
    <td {...stripNode(p)} style={{
      border: "1px solid", borderColor: "rgba(128,128,128,0.4)",
      padding: "5px 8px", verticalAlign: "top",
    }} />
  ),
  code: (p) => {
    const { inline, ...rest } = stripNode(p);
    return inline
      ? <code {...rest} style={{
          fontFamily: "var(--font-mono)", fontSize: "0.9em",
          background: "rgba(128,128,128,0.18)", padding: "1px 5px",
          borderRadius: 3,
        }} />
      : <code {...rest} style={{
          fontFamily: "var(--font-mono)", fontSize: "0.85em",
          display: "block", whiteSpace: "pre",
        }} />;
  },
  pre: (p) => (
    <pre {...stripNode(p)} style={{
      background: "rgba(128,128,128,0.15)", padding: "8px 10px",
      borderRadius: 4, overflowX: "auto", margin: "6px 0",
      fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.5,
    }} />
  ),
  h1: (p) => <h3 {...stripNode(p)} style={{ fontSize: 14, fontWeight: 600, margin: "10px 0 4px" }} />,
  h2: (p) => <h3 {...stripNode(p)} style={{ fontSize: 14, fontWeight: 600, margin: "10px 0 4px" }} />,
  h3: (p) => <h4 {...stripNode(p)} style={{ fontSize: 13, fontWeight: 600, margin: "8px 0 4px" }} />,
  h4: (p) => <h5 {...stripNode(p)} style={{ fontSize: 13, fontWeight: 600, margin: "8px 0 4px" }} />,
  p:  (p) => <p  {...stripNode(p)} style={{ margin: "4px 0", whiteSpace: "pre-wrap" }} />,
  ul: (p) => <ul {...stripNode(p)} style={{ margin: "4px 0", paddingLeft: 20 }} />,
  ol: (p) => <ol {...stripNode(p)} style={{ margin: "4px 0", paddingLeft: 20 }} />,
  li: (p) => <li {...stripNode(p)} style={{ margin: "2px 0", lineHeight: 1.6 }} />,
  hr: (p) => <hr {...stripNode(p)} style={{ border: "none", borderTop: "1px solid currentColor", opacity: 0.25, margin: "8px 0" }} />,
  a:  (p) => <a  {...stripNode(p)} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "underline" }} />,
  blockquote: (p) => (
    <blockquote {...stripNode(p)} style={{
      borderLeft: "2px solid", borderLeftColor: "rgba(128,128,128,0.5)",
      paddingLeft: 10, margin: "6px 0", opacity: 0.9,
    }} />
  ),
  };
}

// At this many persisted messages, surface a soft hint suggesting the user
// distill Memory + clear the chat. This is NOT a context-window limit — the
// providers we use carry far more than this — it's an attention/cost heuristic:
// older turns start competing with the system prompt for the model's focus.
// 40 (~20 exchanges) keeps the nudge from firing on every short session.
const LONG_CHAT_HINT_THRESHOLD = 40;

export function AICoachTab({
  coachConfig, setCoachConfig,
  coachMemory,
  coachMemoryZh, setCoachMemoryBoth,
  chatMessages,
  logs = [], races = [],
  setConfirmDelete,
  apiProvider, setApiProvider, onEditProfile,
  // Jump to other tabs from the first-send guidance nudge. coachHintsPending
  // (lifted to AppShell so it survives a tab switch) re-opens the nudge when the
  // user comes back from a setting, so multi-item nudges can be worked through.
  onGoToTraining, onGoToRaces, onGoToWeather,
  coachHintsPending, setCoachHintsPending,
  // Lifted from AppShell so they survive tab switches — the user can send
  // a message, tab away, and the spinner badge on the AI Coach tab still
  // shows the model is working.
  chatLoading, extractingForMsgId, sendChat, importToCalendar,
  // Shared weather context — { currentWeather, forecastByDate, status,
  // error, refetch }. Drives the Weather status pill below + the prompt
  // preview's [Current Weather] / [Upcoming Forecast] sections.
  weatherCtx, onOpenLocationSettings,
  // Inbox (delivered coach pushes) — entry lives top-right of this tab's
  // header. Opens the InboxModal owned by AppShell; inboxUnread drives the
  // badge.
  onOpenInbox, inboxUnread = 0,
  // Memory update lifted to AppShell so it survives leaving this tab (the
  // request keeps running; a top banner invites the user back when ready).
  showMemory, setShowMemory,
  memoryUpdating, memoryProposal, setMemoryProposal, proposeMemoryUpdate,
}) {
  // Provider label for the status pill. The memory-update call (which used to
  // need a resolved endpoint + key here) now lives in AppShell.
  const provider = API_PROVIDERS[apiProvider] || API_PROVIDERS[DEFAULT_API_PROVIDER];
  const t = useT();
  const { lang } = useLanguage();
  const isMobile = useIsMobile();
  // Markdown component map depends on isMobile (mobile swaps wide tables to
  // stacked row cards). Memoize so we don't rebuild the renderer object on
  // every chat message render.
  const mdComponents = useMemo(() => makeMdComponents(isMobile), [isMobile]);
  const [showModelSwitch, setShowModelSwitch] = useState(false);
  const [showCoachConfig, setShowCoachConfig] = useState(false);
  const [showCalendarSettings, setShowCalendarSettings] = useState(false);
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  // Preview language is independent of UI language — defaults to UI language
  // but the user can flip it to read the prompt in the other language.
  const [previewLang, setPreviewLang] = useState(lang);
  // showMemory / memoryUpdating / memoryProposal are now lifted to AppShell
  // (props) so the update can finish after the user leaves this tab.
  const [memoryLang, setMemoryLang] = useState(lang); // EN/中 toggle for the memory view
  const [memoryDraft, setMemoryDraft] = useState(coachMemory);
  const [memoryEditing, setMemoryEditing] = useState(false);
  // The memory text shown/edited for the currently-selected language.
  const shownMemory = memoryLang === "zh" ? coachMemoryZh : coachMemory;
  // Empty by default — the daily template is shown as a placeholder so it
  // disappears the moment the user starts typing, instead of being pre-filled
  // content the user has to delete.
  const [chatInput, setChatInput] = useState("");
  // First-send guidance: { msg, hints } while the one-time nudge modal is open.
  const [coachHints, setCoachHints] = useState(null);

  // Single ⚙ toggle replaces the row of toggle buttons (config / memory /
  // prompt preview / edit profile / clear chat). Open the menu to access
  // any of those — keeps the top of the tab uncluttered.
  // Mobile: opens an in-place settings sub-page (kept for the touch flow).
  // Desktop: opens a unified hub modal with vertical tabs on the left + the
  // selected tab's content rendered on the right — see CoachSettingsHub
  // below. coachHubTab tracks which tab is active in that modal.
  const [showCoachMenu, setShowCoachMenu] = useState(false);
  const [showCoachHub, setShowCoachHub] = useState(false);
  // Default to the Prompt preview — it's the "result" the other tabs feed.
  const [coachHubTab, setCoachHubTab] = useState("prompt");
  // Long-chat hint is dismissible. Once dismissed it collapses to a
  // single-line tappable chip that sits between provider pills and the
  // chat scroll area — no longer occupies a full banner, but still
  // reachable so the user can act when they want to. Per-session state
  // (resets on page reload, which is the point — fresh page → fresh
  // reminder if conversation is still long).
  const [longChatHintCollapsed, setLongChatHintCollapsed] = useState(false);

  // (Removed the hourly weather auto-refresh timer: it burned Caiyun calls all
  // day for a runner sitting on this tab. The hook already refetches on tab
  // foreground / app resume, and the realtime cache TTL is now 3h — plenty
  // fresh, and far kinder to the shared free-tier weather quota.)

  // Chat scroll container + the two floating jump buttons. The buttons live
  // inside the (sticky) message window so the provider pills above and the
  // input row below never move while the user scrolls messages.
  const chatScrollRef = useRef(null);
  const chatInputRef = useRef(null);
  const [showJumpTop, setShowJumpTop] = useState(false);
  const [showJumpBottom, setShowJumpBottom] = useState(false);
  const hideJumpTimer = useRef(null);
  // Programmatic scrolls (mount / new message / jump-button taps) fire scroll
  // events too — mute the button logic briefly so they don't flash the arrows.
  const suppressJumpUntil = useRef(0);

  // Jump buttons appear only WHILE the user is actively scrolling, then fade
  // out 2s after scrolling stops — so they never sit on top of the text while
  // reading. Position still decides WHICH arrow is relevant (no "↑ top" when
  // already at the top). 120px hysteresis avoids flicker on a tiny nudge.
  const hideJumpSoon = useCallback(() => {
    clearTimeout(hideJumpTimer.current);
    hideJumpTimer.current = setTimeout(() => {
      setShowJumpTop(false);
      setShowJumpBottom(false);
    }, 700);
  }, []);
  const updateJumpButtons = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    if (Date.now() < suppressJumpUntil.current) return;
    const fromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
    setShowJumpTop(el.scrollTop > 120);
    setShowJumpBottom(fromBottom > 120);
    hideJumpSoon();
  }, [hideJumpSoon]);
  // Both jump helpers + the auto-pin scroll mute the button logic and hide any
  // visible arrow immediately, so tapping an arrow doesn't leave the other one
  // popping up mid-scroll.
  const muteAndHideJumps = useCallback(() => {
    suppressJumpUntil.current = Date.now() + 600;
    clearTimeout(hideJumpTimer.current);
    setShowJumpTop(false);
    setShowJumpBottom(false);
  }, []);
  const scrollToBottom = useCallback((behavior = "auto") => {
    const el = chatScrollRef.current;
    if (!el) return;
    muteAndHideJumps();
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, [muteAndHideJumps]);
  const scrollToTop = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    muteAndHideJumps();
    el.scrollTo({ top: 0, behavior: "smooth" });
  }, [muteAndHideJumps]);

  // rAF-throttle the scroll handler: updateJumpButtons reads scrollHeight +
  // clientHeight, and firing that on every scroll event during a SLOW drag
  // forces repeated layout reads → the stutter felt only on slow drags (fast
  // flings coalesce events so it wasn't noticeable). One read per frame is
  // plenty for showing/hiding the arrows.
  const scrollRaf = useRef(false);
  const onChatScroll = useCallback(() => {
    if (scrollRaf.current) return;
    scrollRaf.current = true;
    requestAnimationFrame(() => {
      scrollRaf.current = false;
      updateJumpButtons();
    });
  }, [updateJumpButtons]);

  // Pin to the latest message on mount (tab switch) and whenever the list
  // grows. Markdown tables/long replies can lay out a frame late, so we set
  // scrollTop synchronously AND again in a post-paint rAF — a plain effect
  // sometimes measured scrollHeight before the content settled and stranded
  // the user near the oldest message (the regression this fixes).
  useLayoutEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    muteAndHideJumps();
    el.scrollTop = el.scrollHeight;
    const id = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    return () => cancelAnimationFrame(id);
  }, [chatMessages.length, muteAndHideJumps]);
  // Drop the pending hide timer if the tab unmounts mid-countdown.
  useEffect(() => () => clearTimeout(hideJumpTimer.current), []);

  useEffect(() => {
    if (!isMobile) return;
    const el = chatInputRef.current;
    if (!el) return;
    const minHeight = 32;
    const maxHeight = Math.round(13 * 1.35 * 7 + 18);
    const hasText = chatInput.trim().length > 0;
    el.style.height = `${minHeight}px`;
    if (hasText) {
      el.style.height = `${Math.min(Math.max(el.scrollHeight, minHeight), maxHeight)}px`;
    }
  }, [chatInput, isMobile]);

  // Small circular jump button, vertically pinned to top/bottom of the window.
  const jumpBtnStyle = (edge) => ({
    position: "absolute",
    left: "50%", transform: "translateX(-50%)",
    [edge]: 12,
    width: 32, height: 32, minHeight: 0, minWidth: 0, padding: 0, boxSizing: "border-box",
    borderRadius: "50%",
    border: "1px solid var(--rule)",
    background: "var(--bg-elevated)", color: "var(--ink-1)",
    boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
    cursor: "pointer", zIndex: 5,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    fontSize: 16, lineHeight: 1, WebkitTapHighlightColor: "transparent",
  });
  function clearChat() {
    setConfirmDelete({ type: "chat", id: null });
  }

  function startEditMemory() {
    setMemoryDraft(shownMemory);
    setMemoryEditing(true);
  }
  function saveMemory() {
    // Option A: a manual edit IS what gets sent to the AI. The prompt only ever
    // sends the canonical (coach_memory) field, so writing just the Chinese mirror
    // used to be silently ignored. Now any manual edit overwrites BOTH fields with
    // the edited text — so what you typed is exactly what the coach receives,
    // regardless of which language tab you were on. (The bilingual split only
    // persists for AI-generated memory proposals, until you edit by hand.)
    setCoachMemoryBoth(memoryDraft, memoryDraft);
    setMemoryEditing(false);
  }
  function cancelEditMemory() {
    setMemoryDraft(shownMemory);
    setMemoryEditing(false);
  }

  // proposeMemoryUpdate lives in AppShell now (lifted) so the request survives
  // this tab unmounting — it's passed in as a prop and triggered from the
  // Memory modal's "Update" button below.

  // Accepts the kept points from the per-point review — both language versions,
  // kept in sync, saved in one write.
  function acceptMemoryProposal(en, zh) {
    const e = (en || "").trim(), z = (zh || "").trim();
    setCoachMemoryBoth(e, z);
    setMemoryDraft(memoryLang === "zh" ? z : e);
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
  // Preview shows EXACTLY what sendChat would send, including the live
  // [Current Weather] + [Upcoming Forecast] sections from the shared
  // weatherCtx. This makes "why doesn't the coach know the weather?"
  // diagnosable from the preview alone — if it's missing here, it's
  // missing from the real send too.
  // Redacted skeleton only — the real prompt (proprietary instructions + the
  // user's actual data) is never shown here, just its architecture. sendChat
  // still sends the full prompt. See buildPromptSkeleton.
  const previewPrompt = buildPromptSkeleton(previewLang);

  // Wrapper around the lifted sendChat — clears the input box on the way
  // through. Guards against empty input + already-loading at this layer so
  // we don't even bother calling up if the input is empty.
  // First-send guidance — gentle, one-time (per device). The more context the
  // user gives, the more tailored the coach is; so before their first message
  // we point out what's still empty (coach style on defaults / few workouts /
  // no target race), each with a jump button. They can also just send anyway.
  const HINTS_FLAG = "ts-coach-hints-seen";
  function computeCoachHints() {
    const out = [];
    const cfgDefault = (coachConfig?.style ?? DEFAULT_COACH_CONFIG.style) === DEFAULT_COACH_CONFIG.style
      && (coachConfig?.outputLength ?? DEFAULT_COACH_CONFIG.outputLength) === DEFAULT_COACH_CONFIG.outputLength
      && (coachConfig?.intervention ?? DEFAULT_COACH_CONFIG.intervention) === DEFAULT_COACH_CONFIG.intervention;
    if (cfgDefault) out.push("config");
    if (logs.filter(l => !l.isPlanned).length < 3) out.push("workouts");
    if (!races.some(r => r.isTarget)) out.push("races");
    return out;
  }
  function markHintsSeen() {
    try { localStorage.setItem(HINTS_FLAG, "1"); } catch { /* private mode */ }
  }
  // After the user handles one nudge item (jumps to a setting), bring the nudge
  // back when they return — recomputed, so resolved items drop off. Waits until
  // the coach-config sub-modal is closed (config is handled in-place).
  useEffect(() => {
    if (!coachHintsPending || coachHints || showCoachConfig) return;
    const hints = computeCoachHints();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hints.length) setCoachHints({ msg: coachHintsPending, hints });
    setCoachHintsPending?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coachHintsPending, coachHints, showCoachConfig]);

  async function handleSend() {
    const userMsg = chatInput.trim();
    if (!userMsg || chatLoading) return;
    let seen = true;
    try { seen = !!localStorage.getItem(HINTS_FLAG); } catch { /* private mode */ }
    if (!seen) {
      const hints = computeCoachHints();
      if (hints.length) { setCoachHints({ msg: userMsg, hints }); return; }
      markHintsSeen();
    }
    setChatInput("");
    await sendChat(userMsg);
  }

  // Mobile has two views inside this tab — chat (default) and a settings
  // sub-page (opened via the ⚙ button in the input row). Desktop shows
  // everything inline.
  // Mobile settings is now a bottom-sheet overlay (CoachMobileMenu, rendered
  // near the modals) instead of a full-page swap, so the chat always renders
  // underneath. Kept `inChat` as a constant to avoid churning the big JSX
  // block guard below.
  const inChat = true;
  const memoryReady = !!coachMemory?.trim();
  const calendarImportOn = coachConfig.showCalendarButton !== false;
  const providerLabel = provider.label || apiProvider;
  const coachStyleLabel = t(`enum.coach.${coachConfig.style || "balanced"}`);
  const outputLabel = t(`enum.length.${coachConfig.outputLength || "standard"}`);
  const interventionLabel = t(`enum.intervention.${coachConfig.intervention || "standard"}`);
  const memoryLabel = lang === "zh"
    ? (memoryReady ? "已设置" : "未设置")
    : (memoryReady ? "ready" : "empty");
  const calendarLabel = lang === "zh"
    ? (calendarImportOn ? "显示" : "隐藏")
    : (calendarImportOn ? "shown" : "hidden");
  // Weather pill value + state. The pill is clickable when location is
  // missing → opens the Settings → Default location modal so the user can
  // fix it without hunting through menus.
  const wStatus = weatherCtx?.status || 'idle';
  const wTemp = weatherCtx?.currentWeather?.apparentC ?? weatherCtx?.currentWeather?.tempC;
  const weatherLabel = lang === "zh"
    ? (wStatus === 'ready' && Number.isFinite(wTemp) ? `${Math.round(wTemp)}°C`
      : wStatus === 'loading' ? '加载中'
      : wStatus === 'no_location' ? '需要位置'
      : wStatus === 'error' ? '出错'
      : '—')
    : (wStatus === 'ready' && Number.isFinite(wTemp) ? `${Math.round(wTemp)}°C`
      : wStatus === 'loading' ? 'loading'
      : wStatus === 'no_location' ? 'need location'
      : wStatus === 'error' ? 'error'
      : '—');
  const weatherActive = wStatus === 'ready';
  const statusPill = (icon, label, value, active = true, compact = false) => (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      minHeight: 26,
      padding: "4px 9px",
      border: "1px solid var(--rule)",
      borderRadius: 2,
      background: active ? "var(--bg-elevated)" : "var(--bg)",
      color: active ? "var(--ink-2)" : "var(--ink-3)",
      fontSize: 11,
      fontFamily: "var(--font-sans)",
      whiteSpace: "nowrap",
    }}>
      <span style={{ color: active ? "var(--moss)" : "var(--ink-3)", display: "inline-flex" }}>{icon}</span>
      {!compact && <span style={{ color: "var(--ink-3)" }}>{label}</span>}
      <span style={{ color: active ? "var(--ink-1)" : "var(--ink-3)", fontWeight: 600 }}>{value}</span>
    </span>
  );

  return (
    <div style={isMobile ? {
      display: "flex", flexDirection: "column",
      height: "100%", minHeight: 0,
    } : {}}>
      {/* DESKTOP top button row was here — removed in the May-26 desktop
          revamp. The ⚙ moved into the input row on the right (mirroring
          mobile), and clicking it now opens the unified CoachSettingsHub
          modal rendered near the bottom of this component. */}

      {/* Mobile settings moved to a bottom-sheet overlay (CoachMobileMenu),
          rendered alongside the other modals below. */}

      {/* Config / Memory / Prompt Preview — now MODALS instead of inline
          panels. The toggle buttons set the show* state which opens the
          modal; the modal has its own ✕ close. No more "I forgot to hide
          this panel" footgun. Modals overlay both desktop and mobile views,
          and the legacy 2-col desktop "memory + prompt" layout is dropped
          (one at a time is fine — these aren't compared often). */}
      {/* Model switch — opened by tapping the Provider pill. A quick way to
          flip the active model; keys / endpoints still live in Settings. */}
      {showModelSwitch && (
        <ModalRoot onClose={() => setShowModelSwitch(false)}>
          <div style={s.modalOverlay(isMobile, { float: true })} onClick={() => setShowModelSwitch(false)}>
            <div style={s.modalCard(isMobile, { maxWidth: 360, float: true })} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <h2 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>{lang === "zh" ? "切换模型" : "Switch model"}</h2>
                <button onClick={() => setShowModelSwitch(false)} style={s.modalCloseBtn} aria-label="Close">×</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {Object.values(API_PROVIDERS).map(p => {
                  const active = p.id === apiProvider;
                  return (
                    <button key={p.id} type="button"
                      onClick={() => { if (!active) setApiProvider?.(p.id); setShowModelSwitch(false); }}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, textAlign: "left", width: "100%",
                        padding: "11px 13px", borderRadius: 3, cursor: "pointer",
                        border: "1px solid " + (active ? "var(--moss)" : "var(--rule)"),
                        background: active ? "var(--moss-bg)" : "var(--bg)",
                      }}>
                      <span style={{ color: active ? "var(--moss)" : "var(--ink-3)", display: "inline-flex" }}><CoachIcon size={14} /></span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "var(--ink-1)" }}>{p.label}</span>
                        <span style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>{p.defaultModel}</span>
                      </span>
                      {active && <span style={{ color: "var(--moss)", fontSize: 14 }}>✓</span>}
                    </button>
                  );
                })}
              </div>
              <div style={{ ...s.muted, fontSize: 11, marginTop: 12, lineHeight: 1.5 }}>
                {lang === "zh" ? "API Key 与线路在「设置」里配置。" : "API keys & endpoints live in Settings."}
              </div>
            </div>
          </div>
        </ModalRoot>
      )}

      {showCoachConfig && (
        <ModalRoot onClose={() => setShowCoachConfig(false)}>
          <div style={s.modalOverlay(isMobile, { float: true })} onClick={() => setShowCoachConfig(false)}>
            <div style={s.modalCard(isMobile, { maxWidth: 600, float: true })} onClick={(e) => e.stopPropagation()}>
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
        <ModalRoot onClose={() => setShowCalendarSettings(false)}>
          <div style={s.modalOverlay(isMobile, { float: true })} onClick={() => setShowCalendarSettings(false)}>
            <div style={s.modalCard(isMobile, { maxWidth: 600, float: true })} onClick={(e) => e.stopPropagation()}>
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
        <ModalRoot onClose={() => setShowMemory(false)}>
          <div style={s.modalOverlay(isMobile, { float: true })} onClick={() => setShowMemory(false)}>
            <div style={s.modalCard(isMobile, { maxWidth: 600, float: true })} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <h2 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>{t("coach.memory_title")}</h2>
                <button onClick={() => setShowMemory(false)} style={s.modalCloseBtn} aria-label="Close">×</button>
              </div>
              <div style={{ ...s.muted, marginBottom: 14, lineHeight: 1.5 }}>{t("coach.memory_hint")}</div>

              {!memoryEditing && !memoryProposal && (
                <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <button onClick={proposeMemoryUpdate}
                    disabled={memoryUpdating || chatMessages.length === 0}
                    style={{ ...s.btnGhost, fontSize: 12, padding: "6px 12px", opacity: (memoryUpdating || chatMessages.length === 0) ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {memoryUpdating && <Spinner size={11} thickness={1.4} />}
                    {memoryUpdating ? t("coach.memory_updating") : t("coach.memory_auto_update")}
                  </button>
                  <button onClick={startEditMemory}
                    style={{ ...s.btnGhost, fontSize: 12, padding: "6px 12px" }}>
                    {t("coach.memory_edit")}
                  </button>
                  <MemoryLangToggle memoryLang={memoryLang} setMemoryLang={setMemoryLang} />
                </div>
              )}

              {memoryProposal ? (
                <MemoryProposalReview
                  proposal={memoryProposal}
                  displayLang={memoryLang}
                  oldEn={coachMemory}
                  oldZh={coachMemoryZh}
                  onAccept={acceptMemoryProposal}
                  onReject={rejectMemoryProposal}
                  t={t}
                />
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
                  color: shownMemory ? "var(--ink-1)" : "var(--ink-3)", background: "var(--bg-elevated)",
                  minHeight: 80,
                }}>{shownMemory || t("coach.memory_empty")}</pre>
              )}
            </div>
          </div>
        </ModalRoot>
      )}

      {showPromptPreview && (
        <ModalRoot onClose={() => setShowPromptPreview(false)}>
          <div style={s.modalOverlay(isMobile, { float: true })} onClick={() => setShowPromptPreview(false)}>
            <div style={s.modalCard(isMobile, { maxWidth: 680, float: true })} onClick={(e) => e.stopPropagation()}>
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

      <div style={{
        display: "flex",
        gap: 6,
        flexWrap: isMobile ? "nowrap" : "wrap",
        alignItems: "center",
        marginBottom: 10,
        padding: isMobile ? "7px 8px" : 0,
        border: isMobile ? "1px solid var(--rule)" : "none",
        background: isMobile ? "var(--bg-elevated)" : "transparent",
        borderRadius: isMobile ? 8 : 0,
        overflowX: isMobile ? "auto" : "visible",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: isMobile ? "none" : undefined,
      }}>
        {/* Provider pill is tappable — opens a small popover to switch the
            active model (DeepSeek ⇄ Claude) without diving into settings. */}
        <button type="button" onClick={() => setShowModelSwitch(true)}
          title={lang === "zh" ? "点击切换模型" : "Tap to switch model"}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            minHeight: 26, padding: "4px 9px",
            border: "1px solid var(--rule)", borderRadius: 2,
            background: "var(--bg-elevated)", color: "var(--ink-2)",
            fontSize: 11, fontFamily: "var(--font-sans)",
            cursor: "pointer", whiteSpace: "nowrap", WebkitTapHighlightColor: "transparent",
          }}>
          <span style={{ color: "var(--moss)", display: "inline-flex" }}><CoachIcon size={12} /></span>
          {!isMobile && <span style={{ color: "var(--ink-3)" }}>Provider</span>}
          <span style={{ color: "var(--ink-1)", fontWeight: 600 }}>{providerLabel}</span>
          <span style={{ color: "var(--ink-3)", fontSize: 9 }}>▾</span>
        </button>
        {/* Mode / Memory / Import pills crowd the mobile header — the same
            info is reachable via ⚙ → settings hub on mobile. Desktop has
            room so it keeps all four. */}
        {!isMobile && statusPill(<SettingsIcon size={12} />, "Mode", `${coachStyleLabel} / ${outputLabel} / ${interventionLabel}`)}
        {!isMobile && statusPill(<CoachIcon size={12} />, "Memory", memoryLabel, memoryReady)}
        {!isMobile && statusPill(<CalendarIcon size={12} />, "Import", calendarLabel, calendarImportOn)}
        {/* Weather pill — kept on mobile because the whole point of weather
            integration is the runner glancing at it before their session.
            Clickable when status is 'no_location' so the user can jump
            straight to the default-location modal. */}
        {wStatus === 'no_location' && onOpenLocationSettings ? (
          <button onClick={onOpenLocationSettings}
            title={lang === 'zh' ? '点击设置默认位置' : 'Click to set a default location'}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              minHeight: 26, padding: "4px 9px",
              border: "1px solid var(--warn)", borderRadius: 2,
              background: "rgba(181,78,26,0.08)", color: "var(--warn)",
              fontSize: 11, fontFamily: "var(--font-sans)",
              cursor: "pointer", whiteSpace: "nowrap",
            }}>
            <span>☁</span>
            <span style={{ fontWeight: 600 }}>{weatherLabel}</span>
          </button>
        ) : onGoToWeather ? (
          <button type="button" onClick={onGoToWeather}
            title={lang === "zh" ? "查看日历天气" : "View weather on the calendar"}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              minHeight: 26, padding: "4px 9px",
              border: "1px solid var(--rule)", borderRadius: 2,
              background: weatherActive ? "var(--bg-elevated)" : "var(--bg)",
              color: weatherActive ? "var(--ink-2)" : "var(--ink-3)",
              fontSize: 11, fontFamily: "var(--font-sans)",
              cursor: "pointer", whiteSpace: "nowrap", WebkitTapHighlightColor: "transparent",
            }}>
            <span style={{ color: weatherActive ? "var(--moss)" : "var(--ink-3)" }}>☁</span>
            {!isMobile && <span style={{ color: "var(--ink-3)" }}>Weather</span>}
            <span style={{ color: weatherActive ? "var(--ink-1)" : "var(--ink-3)", fontWeight: 600 }}>{weatherLabel}</span>
          </button>
        ) : statusPill(<span>☁</span>, "Weather", weatherLabel, weatherActive, isMobile)}

        <span style={{ flex: 1, minWidth: 6 }} />
        {onOpenInbox && (
          <button onClick={onOpenInbox} title={t("inbox.title")} aria-label={t("inbox.title")}
            style={{
              position: "relative",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              minHeight: 26, width: 34, padding: 0,
              border: "1px solid var(--rule)", borderRadius: 2,
              background: "var(--bg-elevated)", color: "var(--ink-2)",
              cursor: "pointer", WebkitTapHighlightColor: "transparent",
            }}>
            <MailIcon size={15} />
            {inboxUnread > 0 && (
              <span style={{
                position: "absolute", top: -6, right: -6,
                minWidth: 16, height: 16, padding: "0 4px", boxSizing: "border-box",
                borderRadius: 8, background: "var(--warn)", color: "#fff",
                fontSize: 9, fontWeight: 700, lineHeight: "16px", textAlign: "center",
                fontFamily: "var(--font-mono)",
              }}>{inboxUnread > 99 ? "99+" : inboxUnread}</span>
            )}
          </button>
        )}
        {isMobile && (
          <button onClick={() => setShowCoachMenu(true)} aria-label={t("coach.menu_open")}
            style={{
              position: "relative",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              minHeight: 26, width: 34, padding: 0,
              border: "1px solid var(--rule)", borderRadius: 2,
              background: "var(--bg-elevated)", color: "var(--ink-2)",
              cursor: "pointer", WebkitTapHighlightColor: "transparent",
            }}>
            <SettingsIcon size={15} />
            {coachMemory && (
              <span style={{
                position: "absolute", top: 4, right: 4,
                width: 5, height: 5, borderRadius: 999,
                background: "var(--moss)",
              }} />
            )}
          </button>
        )}
      </div>
      {/* Soft hint once chat history grows past the threshold. Two states:
          • EXPANDED (default) — full banner with the "consider distilling
            to memory" explanation + Open Memory button + ✕ dismiss
          • COLLAPSED — single-line chip that still nudges the user but
            doesn't take vertical real estate; tap to re-expand.
          Per-session state so the chip reappears full-size on next page
          load when chat is still long. */}
      {chatMessages.length >= LONG_CHAT_HINT_THRESHOLD && !showMemory && (
        longChatHintCollapsed ? (
          <button
            onClick={() => setLongChatHintCollapsed(false)}
            style={{
              marginBottom: 10, padding: "4px 10px",
              border: "1px solid var(--rule)",
              background: "rgba(181,78,26,0.04)",
              color: "var(--warn)",
              fontSize: 11, fontFamily: "var(--font-sans)",
              cursor: "pointer", borderRadius: 2,
              display: "inline-flex", alignItems: "center", gap: 6,
              alignSelf: "flex-start",
            }}>
            <span>⚠</span>
            <span>{t("coach.long_chat_chip", { n: chatMessages.length })}</span>
          </button>
        ) : (
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
            {/* Clear chat right from the nudge. The confirm dialog reminds the
                user to distill Memory first (see ConfirmDeleteModal chat body). */}
            <button onClick={clearChat}
              style={{ ...s.btnGhost, fontSize: 12, padding: "5px 10px", flexShrink: 0, color: "var(--danger)", borderColor: "var(--danger)" }}>
              {t("coach.clear_chat")}
            </button>
            <button onClick={() => setLongChatHintCollapsed(true)}
              aria-label={t("coach.long_chat_dismiss")}
              style={{
                background: "none", border: "none",
                color: "var(--ink-3)", cursor: "pointer",
                fontSize: 16, lineHeight: 1, padding: "0 4px",
                flexShrink: 0, marginTop: -2,
              }}>×</button>
          </div>
        )
      )}

      {/* Message window — fixed in the middle. The pills above and the input
          row below stay put; only this box scrolls. position:relative anchors
          the floating jump buttons. */}
      <div style={{
        position: "relative",
        marginBottom: isMobile ? 0 : 12,
        // Mobile: chat fills available vertical space inside the flex column;
        // min-height: 0 lets it shrink (default min-content would prevent
        // shrinking and break the layout). Desktop: capped between 200-500.
        flex: isMobile ? 1 : undefined,
        minHeight: isMobile ? 0 : 200,
        maxHeight: isMobile ? undefined : 500,
        display: "flex", flexDirection: "column", minWidth: 0,
      }}>
      <div ref={chatScrollRef} onScroll={onChatScroll} style={{
        ...s.card,
        marginBottom: 0,
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        overscrollBehavior: "contain",
        WebkitOverflowScrolling: "touch",
        contain: "layout paint",
      }}>
        {chatMessages.length === 0 ? (
          <div style={{ color: "var(--ink-3)", textAlign: "center", padding: 30, fontSize: 13, whiteSpace: "pre-line" }}>
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
                const parsedMessage = parseCoachMessageMeta(m.content);
                const displayContent = parsedMessage.text;
                const costMeta = parsedMessage.meta;
                const usage = costMeta?.usage;
                const canImport = m.role === "assistant" && !m.isLocal && importToCalendar && coachConfig.showCalendarButton;
                const canResend = isUser && i === lastUserIdx && !chatLoading && sendChat;
                const extracting = extractingForMsgId === m.id;
                return (
                  <div key={i} className="ts-msg-in" style={{
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
                    <div className="selectable" style={{
                      // On-token bubbles: user = stamped ink block (echoes the
                      // s.tag stamp), coach = sunken panel with a hairline (the
                      // app's borders-not-fills rule). Soft 10px radius kept on
                      // purpose — chat reads warmer than the sharp 2px cards.
                      // `.selectable` re-enables long-press select + copy (the
                      // app disables text selection globally) so the runner can
                      // copy the coach's advice.
                      background: isUser ? "var(--ink-1)" : "var(--bg-sunken)",
                      color: isUser ? "var(--ink-inv)" : "var(--ink-1)",
                      border: `1px solid ${isUser ? "var(--ink-1)" : "var(--rule)"}`,
                      borderRadius: 10, padding: "10px 14px",
                      fontSize: 13, lineHeight: 1.7,
                      minWidth: 0, maxWidth: "100%",
                      // Belt-and-braces: even though tables get their own
                      // scroll container, very long unbroken tokens (URLs,
                      // model IDs) could still push the bubble wide. Wrap.
                      wordBreak: "break-word", overflowWrap: "anywhere",
                    }}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={mdComponents}>
                        {displayContent}
                      </ReactMarkdown>
                    </div>

                    {!isUser && usage && (
                      <div style={{
                        color: "var(--ink-3)",
                        fontSize: 11,
                        lineHeight: 1.3,
                        fontFamily: "var(--font-mono)",
                        paddingLeft: 2,
                      }}>
                        {costMeta.freeTier
                          ? t("coach.cost_free", { tokens: String(usage.totalTokens || 0) })
                          : t("coach.cost_paid", {
                              provider: costMeta.provider || "AI",
                              tokens: String(usage.totalTokens || 0),
                              cost: Number(costMeta.costUsd || 0).toFixed(6),
                            })}
                      </div>
                    )}

                    {/* Calendar import affordance — text button below the bubble.
                        Gated by the showCalendarButton coach setting (default ON).
                        Shows on persistent assistant replies only. */}
                    {canImport && (
                      <button
                        onClick={() => importToCalendar(displayContent, m.id)}
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
                        onClick={() => sendChat(messageContentForCoach(m.content))}
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
            {chatLoading && !chatMessages.some(m => m.isStreaming) && (
              <div style={{
                alignSelf: "flex-start", color: "var(--ink-3)", fontSize: 13,
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

      {/* Jump to oldest — shows once the user scrolls down into history. */}
      {showJumpTop && chatMessages.length > 0 && (
        <button onClick={scrollToTop} aria-label={lang === "zh" ? "回到顶部" : "Jump to top"}
          style={jumpBtnStyle("top")}>↑</button>
      )}
      {/* Jump to latest — shows when scrolled up away from the newest message. */}
      {showJumpBottom && chatMessages.length > 0 && (
        <button onClick={() => scrollToBottom("smooth")} aria-label={lang === "zh" ? "回到最新" : "Jump to latest"}
          style={jumpBtnStyle("bottom")}>↓</button>
      )}
      </div>

      {/* Input row. flex-shrink: 0 pins it to the bottom of the AICoachTab
          flex column. Mobile: ⚙ stacked above ⏎ in a slim column on the
          right (⚙ opens the settings sub-page). Desktop: plain Send button.
          --mobile-input-fs is a CSS variable the global mobile rule reads —
          lets this specific textarea drop below 16px without breaking the
          iOS-zoom-prevention rule for every other input. */}
      <div style={{
        display: "flex", gap: 8, alignItems: "flex-end",
        paddingTop: isMobile ? 10 : 0,
        borderTop: isMobile ? "1px solid var(--rule)" : "none",
        flexShrink: 0,
      }}>
        <textarea
          ref={chatInputRef}
          rows={isMobile ? 1 : 9}
          placeholder={t("coach.input_placeholder")}
          value={chatInput}
          onChange={e => setChatInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSend(); }}
          style={{
            ...s.input,
            resize: isMobile ? "none" : "vertical",
            fontFamily: "var(--font-sans)",
            flex: 1,
            lineHeight: isMobile ? 1.35 : 1.45,
            padding: isMobile ? "6px 9px" : undefined,
            minHeight: isMobile ? 32 : undefined,
            height: isMobile ? 32 : undefined,
            maxHeight: isMobile ? "calc(13px * 1.35 * 7 + 18px)" : undefined,
            overflowY: isMobile ? "auto" : undefined,
            "--mobile-input-fs": isMobile ? "13px" : undefined,
          }} />
        {isMobile ? (
          <button onClick={handleSend} disabled={chatLoading || !chatInput.trim()}
            aria-label={t("coach.send")}
            style={{
              ...s.btn,
              width: 40,
              height: 32,
              padding: 0,
              fontSize: 20,
              lineHeight: 1,
              minHeight: 32,
              flexShrink: 0,
              opacity: chatLoading || !chatInput.trim() ? 0.4 : 1,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}>
            ⏎
          </button>
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

      {/* MOBILE settings — bottom sheet (slides up from the bottom for
          one-handed reach). Grouped: a "Prompt" parent (opens the assembled-
          prompt preview) with Edit Profile / Coach Config / Memory nested
          beneath it (they shape the prompt), then a "Chat" group with the
          calendar-button toggle + clear chat. Tapping any item closes the
          sheet and opens the matching modal. */}
      {coachHints && (() => {
        const proceed = () => {
          markHintsSeen();
          const m = coachHints.msg;
          setCoachHintsPending?.(null);
          setCoachHints(null);
          setChatInput("");
          sendChat(m);
        };
        const dismiss = () => { markHintsSeen(); setCoachHintsPending?.(null); setCoachHints(null); };
        // Jump to a setting WITHOUT marking seen: stash the message as pending so
        // the nudge re-opens (recomputed) when the user comes back.
        const jumpTo = (action) => { setCoachHintsPending?.(coachHints.msg); setCoachHints(null); action(); };
        const META = {
          config:   { text: t("coach.hint_config"),   jump: () => jumpTo(() => setShowCoachConfig(true)) },
          workouts: { text: t("coach.hint_workouts"), jump: () => jumpTo(() => onGoToTraining?.()) },
          races:    { text: t("coach.hint_races"),    jump: () => jumpTo(() => onGoToRaces?.()) },
        };
        return (
          <ModalRoot onClose={dismiss}>
            <div onClick={dismiss} className="ts-overlay-in" style={{
              position: "fixed", inset: 0, background: "rgba(20,20,19,0.45)",
              backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
              display: "flex", alignItems: "center", justifyContent: "center",
              zIndex: 9999, overscrollBehavior: "contain", padding: 16,
            }}>
              <div onClick={e => e.stopPropagation()} className="ts-modal-in" style={{
                background: "var(--bg-elevated)", border: "1px solid var(--rule)",
                borderRadius: 12, boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
                width: "100%", maxWidth: 420, maxHeight: "calc(100dvh - 32px)",
                overflowY: "auto", padding: "20px 22px 18px", boxSizing: "border-box",
                fontFamily: "var(--font-sans)",
              }}>
                <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 6px" }}>{t("coach.hints_title")}</h2>
                <p style={{ ...s.muted, fontSize: 12.5, lineHeight: 1.6, margin: "0 0 14px" }}>{t("coach.hints_intro")}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                  {coachHints.hints.map(id => (
                    <div key={id} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      border: "1px solid var(--rule)", borderRadius: 8, padding: "10px 12px",
                    }}>
                      <span style={{ flex: 1, fontSize: 13, lineHeight: 1.5, color: "var(--ink-1)" }}>{META[id].text}</span>
                      <button onClick={META[id].jump} style={{ ...s.btnGhost, fontSize: 12, padding: "6px 12px", minHeight: 0, flexShrink: 0 }}>
                        {t("coach.hint_go")}
                      </button>
                    </div>
                  ))}
                </div>
                <button onClick={proceed} style={{ ...s.btn, width: "100%" }}>
                  {t("coach.hints_proceed")}
                </button>
              </div>
            </div>
          </ModalRoot>
        );
      })()}

      {showCoachMenu && isMobile && (() => {
        // pick: close the menu then act — for items that navigate away (edit
        // profile) or are destructive (clear chat).
        const pick = (fn) => { setShowCoachMenu(false); fn(); };
        // openSub: KEEP the menu open and open a sub-modal on top of it (the menu
        // sits at a lower z-index, below). Closing the sub returns to the menu.
        const openSub = (fn) => { fn(); };
        const sub = (label, onClick, badge) => (
          <button onClick={onClick} style={{
            display: "flex", alignItems: "center", width: "100%", textAlign: "left",
            background: "transparent", border: "none",
            borderTop: "1px solid var(--rule-soft)",
            padding: "13px 16px 13px 28px", minHeight: 50,
            fontFamily: "var(--font-sans)", fontSize: 15, color: "var(--ink-1)",
            cursor: "pointer", borderRadius: 0, WebkitTapHighlightColor: "transparent",
          }}>
            <span style={{ flex: 1 }}>{label}{badge ? <span style={{ color: "var(--moss)", marginLeft: 6 }}>●</span> : null}</span>
            <span style={{ color: "var(--ink-3)", fontSize: 15 }}>›</span>
          </button>
        );
        const groupHeader = (label, hint) => (
          <div style={{ padding: "14px 16px 6px", display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
            {hint && <span style={{ fontSize: 11, color: "var(--ink-3)" }}>({hint})</span>}
          </div>
        );
        return (
          <ModalRoot onClose={() => setShowCoachMenu(false)}>
            <div onClick={() => setShowCoachMenu(false)} className="ts-overlay-in" style={{
              position: "fixed", inset: 0, background: "rgba(20,20,19,0.45)",
              backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
              display: "flex", alignItems: "center", justifyContent: "center",
              // Below the sub-modals (9999) it opens, so closing a sub returns here.
              zIndex: 9990, overscrollBehavior: "contain", padding: 16,
            }}>
              <div onClick={e => e.stopPropagation()} className="ts-modal-in" style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--rule)", borderRadius: 14,
                boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
                width: "100%", maxWidth: 420,
                maxHeight: "calc(100dvh - 32px)", overflowY: "auto",
                paddingBottom: 8,
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px 6px" }}>
                  <div style={{ ...s.section, margin: 0 }}>{t("coach.settings_title")}</div>
                  <button onClick={() => setShowCoachMenu(false)} style={s.modalCloseBtn} aria-label="Close">×</button>
                </div>

                {/* Prompt group — parent row opens preview, sub-items nested */}
                {groupHeader(t("coach.group_prompt"), t("coach.group_prompt_hint"))}
                <button onClick={() => openSub(() => setShowPromptPreview(true))} style={{
                  display: "flex", alignItems: "center", width: "100%", textAlign: "left",
                  background: "transparent", border: "none",
                  borderTop: "1px solid var(--rule-soft)",
                  padding: "13px 16px 13px 28px", minHeight: 50,
                  fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 600, color: "var(--ink-1)",
                  cursor: "pointer", borderRadius: 0, WebkitTapHighlightColor: "transparent",
                }}>
                  <span style={{ flex: 1 }}>{t("coach.preview_prompt")}</span>
                  <span style={{ color: "var(--ink-3)", fontSize: 15 }}>›</span>
                </button>
                {sub(t("coach.edit_profile"), () => pick(onEditProfile))}
                {sub(t("coach.show_config"), () => openSub(() => setShowCoachConfig(true)))}
                {sub(t("coach.show_memory"), () => openSub(() => setShowMemory(true)), !!coachMemory)}

                {/* Chat group */}
                {groupHeader(t("coach.group_chat"))}
                {sub(t("coach.calendar_btn_label"), () => openSub(() => setShowCalendarSettings(true)))}
                {chatMessages.length > 0 && (
                  <button onClick={() => pick(clearChat)} style={{
                    display: "flex", alignItems: "center", width: "100%", textAlign: "left",
                    background: "transparent", border: "none",
                    borderTop: "1px solid var(--rule-soft)",
                    padding: "13px 16px 13px 28px", minHeight: 50,
                    fontFamily: "var(--font-sans)", fontSize: 15, color: "var(--danger)",
                    cursor: "pointer", borderRadius: 0, WebkitTapHighlightColor: "transparent",
                  }}>
                    <span style={{ flex: 1 }}>{t("coach.clear_chat")}</span>
                  </button>
                )}
              </div>
            </div>
          </ModalRoot>
        );
      })()}

      {/* Desktop unified settings hub. Left vertical tabs route the right
          pane to one of the existing config / memory / prompt-preview blocks,
          plus shortcuts to Edit Profile and Clear Chat. */}
      {showCoachHub && !isMobile && (
        <ModalRoot onClose={() => setShowCoachHub(false)}>
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
                  {/* Grouped: "Prompt" (preview parent + the three inputs that
                      shape it) then "Chat" (calendar toggle + clear). */}
                  {[
                    { header: t("coach.group_prompt"), items: [
                      { id: "prompt",  label: t("coach.preview_prompt"), parent: true },
                      { id: "profile", label: t("coach.edit_profile"), indent: true },
                      { id: "config",  label: t("coach.show_config"), indent: true },
                      { id: "memory",  label: t("coach.show_memory") + (coachMemory ? " ●" : ""), indent: true },
                    ] },
                    { header: t("coach.group_chat"), items: [
                      { id: "calendar", label: t("coach.calendar_btn_label") },
                      { id: "clear",    label: t("coach.clear_chat") },
                    ] },
                  ].map((group, gi) => (
                    <div key={group.header}>
                      <div style={{
                        padding: gi === 0 ? "2px 14px 6px" : "16px 14px 6px",
                        fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)",
                        textTransform: "uppercase", letterSpacing: "0.06em",
                      }}>{group.header}</div>
                      {group.items.map(tab => {
                        const active = coachHubTab === tab.id;
                        return (
                          <button key={tab.id}
                            onClick={() => setCoachHubTab(tab.id)}
                            style={{
                              textAlign: "left", width: "100%",
                              background: active ? "var(--bg-elevated)" : "transparent",
                              border: "none",
                              borderLeft: active ? "3px solid var(--ink-1)" : "3px solid transparent",
                              padding: tab.indent ? "9px 14px 9px 26px" : "9px 14px",
                              fontFamily: "var(--font-sans)",
                              fontSize: 13,
                              fontWeight: active ? 600 : (tab.parent ? 600 : 500),
                              color: active ? "var(--ink-1)" : "var(--ink-2)",
                              cursor: "pointer", borderRadius: 0,
                            }}>
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>
                  ))}
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
                        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
                          <button onClick={proposeMemoryUpdate}
                            disabled={memoryUpdating || chatMessages.length === 0}
                            style={{ ...s.btnGhost, fontSize: 12, padding: "6px 12px", opacity: (memoryUpdating || chatMessages.length === 0) ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}>
                            {memoryUpdating && <Spinner size={11} thickness={1.4} />}
                            {memoryUpdating ? t("coach.memory_updating") : t("coach.memory_auto_update")}
                          </button>
                          <button onClick={startEditMemory} style={{ ...s.btnGhost, fontSize: 12, padding: "6px 12px" }}>
                            {t("coach.memory_edit")}
                          </button>
                          <MemoryLangToggle memoryLang={memoryLang} setMemoryLang={setMemoryLang} />
                        </div>
                      )}
                      {memoryProposal ? (
                        <MemoryProposalReview
                          proposal={memoryProposal}
                          displayLang={memoryLang}
                          oldEn={coachMemory}
                          oldZh={coachMemoryZh}
                          onAccept={acceptMemoryProposal}
                          onReject={rejectMemoryProposal}
                          t={t}
                        />
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
                          color: shownMemory ? "var(--ink-1)" : "var(--ink-3)", background: "var(--bg-elevated)",
                          minHeight: 80,
                        }}>{shownMemory || t("coach.memory_empty")}</pre>
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

// Per-point review of a proposed (bilingual) memory update. Shows the points in
// the current display language, each with a checkbox; points not already in the
// old memory are tagged NEW. On accept, keeps the chosen points in BOTH
// languages (index-aligned when the two line counts match; otherwise the shown
// language is filtered and the other language is kept whole so nothing is lost).
function MemoryProposalReview({ proposal, displayLang, oldEn, oldZh, onAccept, onReject, t }) {
  const splitLines = (str) => (str || "").split("\n").map(l => l.replace(/\s+$/, "")).filter(l => l.trim());
  const enLines = splitLines(proposal.en);
  const zhLines = splitLines(proposal.zh);
  const aligned = enLines.length === zhLines.length && enLines.length > 0;
  const displayLines = displayLang === "zh" ? (zhLines.length ? zhLines : enLines) : (enLines.length ? enLines : zhLines);
  const oldLower = ((displayLang === "zh" ? oldZh : oldEn) || "").toLowerCase();
  const [kept, setKept] = useState(() => new Set(displayLines.map((_, i) => i)));
  const isNew = (line) => {
    const probe = line.trim().toLowerCase();
    return probe.length > 0 && !oldLower.includes(probe.slice(0, Math.min(probe.length, 30)));
  };
  function toggle(i) {
    setKept(prev => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  }
  function accept() {
    const keep = (lines) => lines.filter((_, i) => kept.has(i)).join("\n");
    if (aligned) { onAccept(keep(enLines), keep(zhLines)); return; }
    if (displayLang === "zh") onAccept(proposal.en, keep(zhLines));
    else onAccept(keep(enLines), proposal.zh);
  }
  return (
    <>
      <div style={{ ...s.label, marginBottom: 4, color: "var(--moss-deep)" }}>{t("coach.memory_proposal_title")}</div>
      <div style={{ ...s.muted, fontSize: 11, marginBottom: 8, lineHeight: 1.5 }}>{t("coach.memory_proposal_hint")}</div>
      <div style={{
        display: "flex", flexDirection: "column", gap: 2, maxHeight: 320, overflowY: "auto",
        border: "1px solid var(--moss)", background: "var(--moss-bg)", borderRadius: 4, padding: "8px 10px",
      }}>
        {displayLines.map((line, i) => (
          <label key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", padding: "4px 0" }}>
            <input type="checkbox" checked={kept.has(i)} onChange={() => toggle(i)} style={{ marginTop: 4, flexShrink: 0 }} />
            <span style={{
              flex: 1, fontSize: 13, lineHeight: 1.5,
              color: kept.has(i) ? "var(--ink-1)" : "var(--ink-3)",
              textDecoration: kept.has(i) ? "none" : "line-through",
            }}>
              {line}
              {isNew(line) && (
                <span style={{
                  marginLeft: 6, fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--moss)",
                  border: "1px solid var(--moss)", borderRadius: 3, padding: "0 4px", verticalAlign: "middle",
                }}>{t("coach.memory_new")}</span>
              )}
            </span>
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={accept}
          disabled={kept.size === 0}
          style={{ ...s.btn, opacity: kept.size === 0 ? 0.5 : 1 }}>{t("coach.memory_accept")}</button>
        <button onClick={onReject} style={s.btnGhost}>{t("coach.memory_reject")}</button>
      </div>
    </>
  );
}

// EN / 中 segmented toggle for the memory view (mirrors the prompt-preview
// toggle). Picks which stored language version (coach_memory / coach_memory_zh)
// the memory pane shows + edits.
function MemoryLangToggle({ memoryLang, setMemoryLang }) {
  return (
    <div style={{ marginLeft: "auto", display: "flex", border: "1px solid var(--rule)", borderRadius: 4, overflow: "hidden" }}>
      {["en", "zh"].map((lg) => (
        <button key={lg} type="button" onClick={() => setMemoryLang(lg)}
          style={{
            padding: "4px 10px", fontSize: 11, border: "none", cursor: "pointer", minHeight: 0,
            background: memoryLang === lg ? "var(--ink-1)" : "transparent",
            color: memoryLang === lg ? "var(--ink-inv)" : "var(--ink-2)",
          }}>
          {lg === "en" ? "EN" : "中"}
        </button>
      ))}
    </div>
  );
}
