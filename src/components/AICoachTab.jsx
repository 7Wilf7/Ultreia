import { useState, useEffect, useRef, useMemo, useLayoutEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { s } from "../styles";
import {
  COACH_STYLES, OUTPUT_LENGTHS, INTERVENTION_LEVELS,
  DEFAULT_COACH_CONFIG,
} from "../constants";
import { COACH_ACTION_MATRIX } from "../data/coachActionMatrix";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { buildPromptSkeleton, messageContentForCoach, parseCoachMessageMeta } from "../utils/coachPrompt";
import { extractMemoryFacts, fillEmptyMemorySections, isMemorySectionHeading } from "../utils/memory";
import { AGENT_ACTION_STATUS, getPlanTargetId, isPlanUpdateItem, isRaceBriefingAction, isRestPlanItem, markAgentActionStatus } from "../utils/agentActions";
import { planAdjustmentSignature, recoveryAdjustmentSignature, trainingAdjustmentSignature } from "../utils/proactiveTrainingAdjustment";
import { ModalRoot } from "./ModalRoot";
import { Spinner } from "./Spinner";
import { CalendarIcon, CoachIcon, SettingsIcon, MailIcon } from "./Icons";
import { ItemActionModal } from "./ItemActionModal";
import { useAppDialog } from "./AppDialogContext";

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
const PROACTIVE_ADJUSTMENT_SNOOZE_KEY = "ultreia.proactiveAdjustment.snoozedUntil";
const PROACTIVE_ADJUSTMENT_ATTEMPT_KEY = "ultreia.proactiveAdjustment.attemptedSignature";
const PROACTIVE_ADJUSTMENT_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const RACE_BRIEFING_SNOOZE_KEY = "ultreia.raceBriefing.snoozedUntil";
const RACE_BRIEFING_ATTEMPT_KEY = "ultreia.raceBriefing.attemptedSignature";
const RACE_BRIEFING_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

function readProactiveAdjustmentSnooze() {
  try {
    const raw = localStorage.getItem(PROACTIVE_ADJUSTMENT_SNOOZE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    const value = typeof parsed === "number" ? parsed : Number(parsed?.until || parsed?.untilMs || 0);
    return Number.isFinite(value) && value > Date.now() ? value : 0;
  } catch {
    return 0;
  }
}

function readRaceBriefingSnooze() {
  try {
    const raw = localStorage.getItem(RACE_BRIEFING_SNOOZE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    const value = typeof parsed === "number" ? parsed : Number(parsed?.until || parsed?.untilMs || 0);
    return Number.isFinite(value) && value > Date.now() ? value : 0;
  } catch {
    return 0;
  }
}

function formatProviderMeta(meta, lang) {
  if (!meta?.provider) return "";
  const provider = String(meta.provider).toLowerCase();
  const providerLabel = provider === "desktop_codex"
    ? "Codex"
    : provider === "deepseek"
      ? "DeepSeek"
      : String(meta.provider);
  if (meta.fallback?.from === "desktop_codex" && provider === "deepseek") {
    return lang === "zh"
      ? `Codex 不可用 → 已使用 DeepSeek fallback`
      : `Codex unavailable → used DeepSeek fallback`;
  }
  return providerLabel;
}

function formatRunnerClock(iso, lang) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return "";
  }
}

function runnerAgeMs(iso, nowMs) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.max(0, nowMs - ms) : null;
}

export function AICoachTab({
  coachConfig, setCoachConfig,
  chatMessages,
  logs = [], races = [],
  setConfirmDelete,
  onEditProfile,
  // Jump to other tabs from the first-send guidance nudge. coachHintsPending
  // (lifted to AppShell so it survives a tab switch) re-opens the nudge when the
  // user comes back from a setting, so multi-item nudges can be worked through.
  onGoToTraining, onGoToRaces, onGoToWeather,
  coachHintsPending, setCoachHintsPending,
  // Lifted from AppShell so they survive tab switches — the user can send
  // a message, tab away, and the spinner badge on the AI Coach tab still
  // shows the model is working.
  chatLoading, chatInput, setChatInput, coachProviderLabel: currentProviderLabel = "DeepSeek", coachProviderFallback = null, extractingForMsgId, sendChat, importToCalendar, onStopChat, onStopExtraction, hasPlanImportCache, getPlanImportActionStatus,
  codexRunnerStatus = null,
  planDeviationSummary = null,
  recoveryGuardSummary = null,
  raceBriefingSummary = null,
  proactiveAdjustmentLoading = false, onProactiveTrainingAdjustmentRequest, onOpenProactiveAction,
  raceBriefingLoading = false, onRaceBriefingRequest,
  agentActions = [], onDeleteAgentAction,
  memoryFacts = [], onMemoryFactStatus,
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
  memoryUpdating, memoryProposal, setMemoryProposal, lastMemoryAction, setLastMemoryAction, recordMemoryActionDecision, saveMemoryFacts, proposeMemoryUpdate,
}) {
  const t = useT();
  const appDialog = useAppDialog();
  const { lang } = useLanguage();
  const isMobile = useIsMobile();
  const [runnerNowMs, setRunnerNowMs] = useState(() => Date.now());
  // Markdown component map depends on isMobile (mobile swaps wide tables to
  // stacked row cards). Memoize so we don't rebuild the renderer object on
  // every chat message render.
  const mdComponents = useMemo(() => makeMdComponents(isMobile), [isMobile]);
  useEffect(() => {
    const timer = setInterval(() => setRunnerNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const [showCoachConfig, setShowCoachConfig] = useState(false);
  const [showCalendarSettings, setShowCalendarSettings] = useState(false);
  const [showAgentActions, setShowAgentActions] = useState(false);
  const [showActionMatrix, setShowActionMatrix] = useState(false);
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  // Preview language is independent of UI language — defaults to UI language
  // but the user can flip it to read the prompt in the other language.
  const [previewLang, setPreviewLang] = useState(lang);
  // showMemory / memoryUpdating / memoryProposal are now lifted to AppShell
  // (props) so the update can finish after the user leaves this tab.
  const memoryDisplayLang = lang === "zh" ? "zh" : "en";
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
  const [proactiveAdjustmentSnoozedUntil, setProactiveAdjustmentSnoozedUntil] = useState(readProactiveAdjustmentSnooze);
  const [raceBriefingSnoozedUntil, setRaceBriefingSnoozedUntil] = useState(readRaceBriefingSnooze);
  const [raceBriefingAction, setRaceBriefingAction] = useState(null);
  const [attemptedProactiveAdjustmentSignature, setAttemptedProactiveAdjustmentSignature] = useState(() => {
    try { return localStorage.getItem(PROACTIVE_ADJUSTMENT_ATTEMPT_KEY) || ""; }
    catch { return ""; }
  });
  const [attemptedRaceBriefingSignature, setAttemptedRaceBriefingSignature] = useState(() => {
    try { return localStorage.getItem(RACE_BRIEFING_ATTEMPT_KEY) || ""; }
    catch { return ""; }
  });
  const proactiveAdjustmentSnoozed = proactiveAdjustmentSnoozedUntil > runnerNowMs;
  const raceBriefingSnoozed = raceBriefingSnoozedUntil > runnerNowMs;
  const snoozeProactiveAdjustment = useCallback(() => {
    const until = Date.now() + PROACTIVE_ADJUSTMENT_SNOOZE_MS;
    setProactiveAdjustmentSnoozedUntil(until);
    try {
      localStorage.setItem(PROACTIVE_ADJUSTMENT_SNOOZE_KEY, JSON.stringify({ until }));
    } catch { /* private mode */ }
  }, []);
  const markProactiveAdjustmentAttempted = useCallback((signature) => {
    const next = signature || "";
    setAttemptedProactiveAdjustmentSignature(next);
    try {
      if (next) localStorage.setItem(PROACTIVE_ADJUSTMENT_ATTEMPT_KEY, next);
      else localStorage.removeItem(PROACTIVE_ADJUSTMENT_ATTEMPT_KEY);
    } catch { /* private mode */ }
  }, []);
  const snoozeRaceBriefing = useCallback(() => {
    const until = Date.now() + RACE_BRIEFING_SNOOZE_MS;
    setRaceBriefingSnoozedUntil(until);
    try {
      localStorage.setItem(RACE_BRIEFING_SNOOZE_KEY, JSON.stringify({ until }));
    } catch { /* private mode */ }
  }, []);
  const markRaceBriefingAttempted = useCallback((signature) => {
    const next = signature || "";
    setAttemptedRaceBriefingSignature(next);
    try {
      if (next) localStorage.setItem(RACE_BRIEFING_ATTEMPT_KEY, next);
      else localStorage.removeItem(RACE_BRIEFING_ATTEMPT_KEY);
    } catch { /* private mode */ }
  }, []);
  const proactiveAdjustment = useMemo(() => {
    const hasPlanDeviation = planDeviationSummary?.affectedCount > 0;
    const hasRecoverySignal = recoveryGuardSummary?.signalCount > 0;
    if (!hasPlanDeviation && !hasRecoverySignal) return null;
    const kind = hasPlanDeviation && hasRecoverySignal
      ? "combined_training_adjustment"
      : hasRecoverySignal
        ? "recovery_load_guard"
        : "plan_deviation_rescue";
    const signature = kind === "combined_training_adjustment"
      ? trainingAdjustmentSignature(planDeviationSummary, recoveryGuardSummary)
      : kind === "recovery_load_guard"
        ? recoveryAdjustmentSignature(recoveryGuardSummary)
        : planAdjustmentSignature(planDeviationSummary);
    if (!signature) return null;
    const relatedActions = (agentActions || []).filter(action => (
      action?.type === "create_plans"
      && action.payload?.proactiveTrigger?.signature === signature
    ));
    const existingAction = relatedActions.find(action => (
      action.status !== AGENT_ACTION_STATUS.REJECTED
      && action.status !== AGENT_ACTION_STATUS.CANCELLED
    ));
    const settledAction = relatedActions.find(action => (
      action.status === AGENT_ACTION_STATUS.REJECTED
      || action.status === AGENT_ACTION_STATUS.CANCELLED
    ));
    return { kind, signature, existingAction, settledAction };
  }, [agentActions, planDeviationSummary, recoveryGuardSummary]);
  const raceBriefing = useMemo(() => {
    if (!raceBriefingSummary?.signature) return null;
    const summaryRaceId = raceBriefingSummary.race?.id || null;
    const summaryRaceDate = raceBriefingSummary.race?.date || "";
    const relatedActions = (agentActions || []).filter(action => (
      isRaceBriefingAction(action)
      && (
        action.payload?.raceBriefing?.signature === raceBriefingSummary.signature
        || (
          action.payload?.raceBriefing?.date === summaryRaceDate
          && (
            (summaryRaceId && action.payload?.raceBriefing?.raceId === summaryRaceId)
            || (!summaryRaceId && action.payload?.raceBriefing?.name === raceBriefingSummary.race?.name)
          )
        )
      )
    )).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    const existingAction = relatedActions.find(action => (
      action.status !== AGENT_ACTION_STATUS.REJECTED
      && action.status !== AGENT_ACTION_STATUS.CANCELLED
    ));
    const settledAction = relatedActions.find(action => (
      action.status === AGENT_ACTION_STATUS.REJECTED
      || action.status === AGENT_ACTION_STATUS.CANCELLED
    ));
    return {
      ...raceBriefingSummary,
      existingAction,
      settledAction,
    };
  }, [agentActions, raceBriefingSummary]);
  const handleProactiveAdjustmentDismiss = useCallback(() => {
    snoozeProactiveAdjustment();
  }, [snoozeProactiveAdjustment]);
  const handleProactiveAdjustmentRequest = useCallback(async ({ quiet = false } = {}) => {
    if (!proactiveAdjustment?.kind) return;
    const generated = await onProactiveTrainingAdjustmentRequest?.(proactiveAdjustment.kind, { quiet });
    if (proactiveAdjustment.signature) markProactiveAdjustmentAttempted(proactiveAdjustment.signature);
    return generated;
  }, [
    markProactiveAdjustmentAttempted,
    onProactiveTrainingAdjustmentRequest,
    proactiveAdjustment,
  ]);
  const handleRaceBriefingDismiss = useCallback(() => {
    snoozeRaceBriefing();
  }, [snoozeRaceBriefing]);
  const handleRaceBriefingRequest = useCallback(async ({ quiet = false } = {}) => {
    if (!raceBriefing?.signature) return null;
    const action = await onRaceBriefingRequest?.({ quiet });
    markRaceBriefingAttempted(raceBriefing.signature);
    if (action && !quiet) setRaceBriefingAction(action);
    return action;
  }, [markRaceBriefingAttempted, onRaceBriefingRequest, raceBriefing]);
  useEffect(() => {
    if (!proactiveAdjustment) return;
    if (proactiveAdjustment.existingAction) return;
    if (proactiveAdjustment.settledAction) return;
    if (proactiveAdjustmentSnoozed) return;
    if (attemptedProactiveAdjustmentSignature === proactiveAdjustment.signature) return;
    if (proactiveAdjustmentLoading) return;
    if (typeof onProactiveTrainingAdjustmentRequest !== "function") return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) handleProactiveAdjustmentRequest({ quiet: true });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    attemptedProactiveAdjustmentSignature,
    handleProactiveAdjustmentRequest,
    onProactiveTrainingAdjustmentRequest,
    proactiveAdjustment,
    proactiveAdjustmentLoading,
    proactiveAdjustmentSnoozed,
  ]);
  useEffect(() => {
    if (!raceBriefing) return;
    if (raceBriefing.existingAction) return;
    if (raceBriefing.settledAction) return;
    if (raceBriefingSnoozed) return;
    if (attemptedRaceBriefingSignature === raceBriefing.signature) return;
    if (raceBriefingLoading) return;
    if (typeof onRaceBriefingRequest !== "function") return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) handleRaceBriefingRequest({ quiet: true });
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    attemptedRaceBriefingSignature,
    handleRaceBriefingRequest,
    onRaceBriefingRequest,
    raceBriefing,
    raceBriefingLoading,
    raceBriefingSnoozed,
  ]);
  const showProactiveAdjustment = !!(
    proactiveAdjustment
    && !proactiveAdjustment.settledAction
    && !proactiveAdjustmentSnoozed
    && (proactiveAdjustment.existingAction || typeof onProactiveTrainingAdjustmentRequest === "function" || proactiveAdjustmentLoading)
  );
  const showRaceBriefing = !!(
    raceBriefing
    && !raceBriefing.settledAction
    && !raceBriefingSnoozed
    && (raceBriefing.existingAction || typeof onRaceBriefingRequest === "function" || raceBriefingLoading)
  );
  const showManualAdjustmentShortcut = !!(
    proactiveAdjustment
    && !showProactiveAdjustment
    && (proactiveAdjustment.existingAction || typeof onProactiveTrainingAdjustmentRequest === "function" || proactiveAdjustmentLoading)
  );
  const handleManualAdjustmentShortcut = useCallback(() => {
    if (proactiveAdjustment?.existingAction) {
      onOpenProactiveAction?.(proactiveAdjustment.existingAction);
      return;
    }
    handleProactiveAdjustmentRequest();
  }, [handleProactiveAdjustmentRequest, onOpenProactiveAction, proactiveAdjustment]);

  // (Removed the hourly weather auto-refresh timer: it burned Caiyun calls all
  // day for a runner sitting on this tab. The hook already refetches on tab
  // foreground / app resume, and the realtime cache TTL is now 3h — fresh
  // enough while avoiding unnecessary weather calls.)

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

  // proposeMemoryUpdate lives in AppShell now (lifted) so the request survives
  // this tab unmounting — it's passed in as a prop and triggered from the
  // Memory modal's "Update" button below.

  // Accepts the kept points from the per-point review and activates them as
  // structured Memory facts. The legacy free-text Memory is no longer written.
  async function acceptMemoryProposal(en, zh) {
    const e = (en || "").trim(), z = (zh || "").trim();
    const actionId = memoryProposal?.action?.id || `memory-update-${Date.now()}`;
    const facts = extractMemoryFacts({ en: e, zh: z }, {
      clientPrefix: `memory-fact-${actionId}`,
      memoryActionId: actionId,
      sourceMessageCount: memoryProposal?.action?.payload?.sourceMessageCount || 0,
      source: "ai_coach_memory",
      sourceSummary: "Memory auto-update",
      status: "active",
    });
    try {
      if (facts.length && typeof saveMemoryFacts !== "function") {
        throw new Error("Memory facts save handler is unavailable");
      }
      const savedFacts = facts.length ? await saveMemoryFacts(facts) : [];
      if (facts.length && (!Array.isArray(savedFacts) || savedFacts.length < facts.length)) {
        throw new Error(`Only saved ${savedFacts?.length || 0} of ${facts.length} Memory facts`);
      }
      if (memoryProposal?.action) {
        const nextAction = recordMemoryActionDecision
          ? recordMemoryActionDecision(memoryProposal.action, AGENT_ACTION_STATUS.EXECUTED, {
              savedLanguages: [e ? "en" : null, z ? "zh" : null].filter(Boolean),
              savedCharacterCount: { en: e.length, zh: z.length },
              savedFactCount: savedFacts.length,
            })
          : markAgentActionStatus(memoryProposal.action, AGENT_ACTION_STATUS.EXECUTED);
        setLastMemoryAction(nextAction);
      }
      setMemoryProposal(null);
    } catch (err) {
      appDialog.alert(t("coach.memory_facts_save_failed", { msg: err?.message || String(err) }));
    }
  }
  function rejectMemoryProposal() {
    if (memoryProposal?.action) {
      const nextAction = recordMemoryActionDecision
        ? recordMemoryActionDecision(memoryProposal.action, AGENT_ACTION_STATUS.REJECTED)
        : markAgentActionStatus(memoryProposal.action, AGENT_ACTION_STATUS.REJECTED);
      setLastMemoryAction(nextAction);
    }
    setMemoryProposal(null);
  }

  function setStyle(id)        { setCoachConfig({ ...coachConfig, style: id }); }
  function setOutputLength(id) { setCoachConfig({ ...coachConfig, outputLength: id }); }
  function setIntervention(id) { setCoachConfig({ ...coachConfig, intervention: id }); }
  function setShowCalendarButton(v) { setCoachConfig({ ...coachConfig, showCalendarButton: v }); }
  function setNightlyMemoryReview(v) { setCoachConfig({ ...coachConfig, nightlyMemoryReview: v }); }

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
  const HINTS_FLAG = "ultreia.coachHintsSeen";
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
  const activeMemoryFactCount = memoryFacts.filter(f => f?.status === "active").length;
  const memoryReady = activeMemoryFactCount > 0;
  const calendarImportOn = coachConfig.showCalendarButton !== false;
  const providerLabel = currentProviderLabel || "DeepSeek";
  const coachStyleLabel = t(`enum.coach.${coachConfig.style || "balanced"}`);
  const outputLabel = t(`enum.length.${coachConfig.outputLength || "standard"}`);
  const interventionLabel = t(`enum.intervention.${coachConfig.intervention || "standard"}`);
  const memoryLabel = lang === "zh"
    ? (memoryReady ? `${activeMemoryFactCount} 条` : "无")
    : (memoryReady ? `${activeMemoryFactCount} facts` : "empty");
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
  const runnerLastSeenIso = codexRunnerStatus?.last_seen_at || null;
  const runnerAge = runnerAgeMs(runnerLastSeenIso, runnerNowMs);
  const runnerFreshMs = Number(codexRunnerStatus?.fresh_ms) || 20_000;
  const runnerStaleMs = Number(codexRunnerStatus?.stale_ms) || 10_000;
  const serverRunnerState = codexRunnerStatus?.state || "loading";
  const runnerState = (serverRunnerState === "online" || serverRunnerState === "stale") && runnerAge !== null
    ? runnerAge > runnerFreshMs + runnerStaleMs
      ? "offline"
      : runnerAge > runnerFreshMs
        ? "stale"
        : "online"
    : serverRunnerState;
  const runnerCodexStatus = codexRunnerStatus?.codex_status || "unknown";
  const runnerHealthy = runnerState === "online" && runnerCodexStatus !== "error" && runnerCodexStatus !== "auth_error";
  const expectedProvider = runnerHealthy && codexRunnerStatus?.expected_provider !== "deepseek" ? "desktop_codex" : "deepseek";
  const expectedProviderLabel = expectedProvider === "desktop_codex" ? "Codex" : "DeepSeek";
  const runnerChecking = runnerState === "loading";
  const runnerLastSeen = formatRunnerClock(runnerLastSeenIso || codexRunnerStatus?.checked_at, lang);
  const runnerModel = codexRunnerStatus?.model || "Codex";
  const runnerEffort = codexRunnerStatus?.reasoning_effort;
  const runnerPrimary = lang === "zh"
    ? (runnerHealthy ? "Codex 可用"
      : runnerChecking ? "检查 Codex"
      : runnerCodexStatus === "auth_error" ? "Codex 认证异常"
      : runnerState === "error" ? "Codex 异常"
      : runnerState === "stale" ? "Codex 连接不稳"
      : "Codex 离线")
    : (runnerHealthy ? "Codex ready"
      : runnerChecking ? "Checking Codex"
      : runnerCodexStatus === "auth_error" ? "Codex auth issue"
      : runnerState === "error" ? "Codex issue"
      : runnerState === "stale" ? "Codex unstable"
      : "Codex offline");
  const runnerDetailParts = [
    runnerModel,
    runnerEffort,
    runnerLastSeen ? (lang === "zh" ? `${runnerLastSeen} 在线` : `seen ${runnerLastSeen}`) : null,
  ].filter(Boolean);
  const runnerDetail = runnerDetailParts.join(" · ");
  const runnerFallbackText = runnerHealthy
    ? (lang === "zh" ? "优先调用" : "preferred")
    : (lang === "zh" ? "会自动用 DeepSeek" : "DeepSeek fallback");
  const runnerAccent = runnerHealthy
    ? "var(--moss)"
    : (runnerState === "offline" || runnerState === "error" || runnerCodexStatus === "error")
      ? "var(--danger)"
      : "var(--warn)";
  const runnerTitle = [
    runnerPrimary,
    lang === "zh" ? `下一次预计调用 ${expectedProviderLabel}` : `Next call: ${expectedProviderLabel}`,
    runnerDetail,
    runnerFallbackText,
    codexRunnerStatus?.last_error ? `${lang === "zh" ? "上次错误" : "Last error"}: ${codexRunnerStatus.last_error}` : null,
  ].filter(Boolean).join(" · ");
  const displayProviderLabel = expectedProvider === "desktop_codex" ? "Codex" : providerLabel;
  const providerTitle = expectedProvider === "desktop_codex"
    ? (lang === "zh" ? "下一次 AI Coach 对话预计调用 Codex" : "Next AI Coach chat is expected to use Codex")
    : coachProviderFallback
      ? (lang === "zh" ? "Codex 不可用时会自动回退到 DeepSeek" : "Falls back to DeepSeek when Codex is unavailable")
      : (lang === "zh" ? `AI Coach 最近使用 ${providerLabel}` : `AI Coach recently used ${providerLabel}`);
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

      {showAgentActions && (
        <ModalRoot onClose={() => setShowAgentActions(false)}>
          <div style={s.modalOverlay(isMobile, { float: true })} onClick={() => setShowAgentActions(false)}>
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                ...s.modalCard(isMobile, { maxWidth: 520, float: true }),
                maxHeight: isMobile ? "min(72dvh, 560px)" : "min(72vh, 580px)",
                overflowY: "auto",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <h2 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>{t("coach.recent_agent_actions")}</h2>
                <button onClick={() => setShowAgentActions(false)} style={s.modalCloseBtn} aria-label="Close">×</button>
              </div>
              <RecentAgentActions
                actions={agentActions}
                t={t}
                onDelete={onDeleteAgentAction}
                onOpenRaceBriefing={setRaceBriefingAction}
                onAskCoach={(action) => {
                  sendChat?.(buildAgentActionFollowUpMessage(action, t, lang));
                  setShowAgentActions(false);
                }}
              />
            </div>
          </div>
        </ModalRoot>
      )}

      {raceBriefingAction && (
        <RaceBriefingModal
          action={raceBriefingAction}
          t={t}
          isMobile={isMobile}
          mdComponents={mdComponents}
          onClose={() => setRaceBriefingAction(null)}
        />
      )}

      {showActionMatrix && (
        <ModalRoot onClose={() => setShowActionMatrix(false)}>
          <div style={s.modalOverlay(isMobile, { float: true })} onClick={() => setShowActionMatrix(false)}>
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                ...s.modalCard(isMobile, { maxWidth: 560, float: true }),
                maxHeight: isMobile ? "min(74dvh, 580px)" : "min(74vh, 620px)",
                overflowY: "auto",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <h2 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>{t("coach.action_matrix_title")}</h2>
                <button onClick={() => setShowActionMatrix(false)} style={s.modalCloseBtn} aria-label="Close">×</button>
              </div>
              <CoachActionMatrix matrix={COACH_ACTION_MATRIX} lang={lang} t={t} />
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
              <MemoryReviewSetting
                enabled={coachConfig.nightlyMemoryReview === true}
                onToggle={setNightlyMemoryReview}
                t={t}
              />

              {!memoryProposal && (
                <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <button onClick={proposeMemoryUpdate}
                    disabled={memoryUpdating || chatMessages.length === 0}
                    style={{ ...s.btnGhost, fontSize: 12, padding: "6px 12px", opacity: (memoryUpdating || chatMessages.length === 0) ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {memoryUpdating && <Spinner size={11} thickness={1.4} />}
                    {memoryUpdating ? t("coach.memory_updating") : t("coach.memory_auto_update")}
                  </button>
                </div>
              )}
              {lastMemoryAction && !memoryProposal && (
                <MemoryActionStatus action={lastMemoryAction} t={t} />
              )}

              {memoryProposal ? (
                <MemoryProposalReview
                  proposal={memoryProposal}
                  displayLang={memoryDisplayLang}
                  oldFacts={memoryFacts}
                  onAccept={acceptMemoryProposal}
                  onReject={rejectMemoryProposal}
                  t={t}
                />
              ) : (
                <MemoryFactsPanel
                  facts={memoryFacts}
                  displayLang={memoryDisplayLang}
                  onStatus={onMemoryFactStatus}
                  t={t}
                />
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
                      background: previewLang === "en" ? "var(--accent-soft)" : "transparent",
                      color: previewLang === "en" ? "var(--accent-dark)" : "var(--ink-2)" }}>
                    EN
                  </button>
                  <button onClick={() => setPreviewLang("zh")}
                    style={{ ...s.btnGhost, fontSize: 11, padding: "4px 10px",
                      background: previewLang === "zh" ? "var(--accent-soft)" : "transparent",
                      color: previewLang === "zh" ? "var(--accent-dark)" : "var(--ink-2)" }}>
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
        <span
          title={runnerTitle}
          aria-label={runnerTitle}
          style={{
            width: 9,
            height: 9,
            borderRadius: 999,
            background: runnerAccent,
            boxShadow: runnerHealthy ? "0 0 11px rgba(74,107,83,0.7)" : "none",
            flex: "0 0 auto",
          }}
        />
        <span
          title={providerTitle}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            minHeight: 26, padding: "4px 9px",
            border: "1px solid var(--rule)", borderRadius: 2,
            background: "var(--bg-elevated)", color: "var(--ink-2)",
            fontSize: 11, fontFamily: "var(--font-sans)",
            whiteSpace: "nowrap",
          }}>
          <span style={{ color: "var(--moss)", display: "inline-flex" }}><CoachIcon size={12} /></span>
          {!isMobile && <span style={{ color: "var(--ink-3)" }}>Model</span>}
          <span style={{ color: "var(--ink-1)", fontWeight: 600 }}>{displayProviderLabel}</span>
        </span>
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
                borderRadius: 8, background: "var(--warn)", color: "var(--bg-deep)",
                fontSize: 9, fontWeight: 700, lineHeight: "16px", textAlign: "center",
                fontFamily: "var(--font-mono)",
              }}>{inboxUnread > 99 ? "99+" : inboxUnread}</span>
            )}
          </button>
        )}
        {showManualAdjustmentShortcut && (
          <button
            type="button"
            onClick={handleManualAdjustmentShortcut}
            disabled={proactiveAdjustmentLoading}
            title={proactiveAdjustment?.existingAction ? t("coach.proactive_open") : t("coach.proactive_manual_hint")}
            style={{
              ...s.btnGhost,
              minHeight: 26,
              padding: "4px 9px",
              fontSize: 11,
              whiteSpace: "nowrap",
              flex: "0 0 auto",
              opacity: proactiveAdjustmentLoading ? 0.65 : 1,
              cursor: proactiveAdjustmentLoading ? "default" : "pointer",
            }}>
            {proactiveAdjustment?.existingAction
              ? t("coach.proactive_open")
              : proactiveAdjustmentLoading
                ? t("coach.proactive_generating")
                : t("coach.proactive_manual")}
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
            {memoryReady && (
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

      {showProactiveAdjustment && (
        <div style={{
          marginBottom: 12,
          padding: isMobile ? "9px 10px" : "10px 12px",
          border: "1px solid var(--rule)",
          background: "var(--bg-elevated)",
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}>
          <div style={{ flex: 1, minWidth: isMobile ? 180 : 260, lineHeight: 1.5 }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontSize: 12,
              fontWeight: 650,
              color: "var(--ink-1)",
              marginBottom: 2,
            }}>
              <span style={{ color: "var(--warn)" }}>⚠</span>
              <span>{t(`coach.proactive_${proactiveAdjustment.kind}_title`)}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-2)" }}>
              {proactiveAdjustment.kind === "combined_training_adjustment"
                ? t("coach.proactive_combined_training_adjustment_body", {
                  count: planDeviationSummary.affectedCount,
                  missed: planDeviationSummary.missedCount,
                  partial: planDeviationSummary.partialCount,
                  signals: recoveryGuardSummary.signalCount,
                  plans: recoveryGuardSummary.futurePlanCount,
                })
                : proactiveAdjustment.kind === "recovery_load_guard"
                  ? t("coach.proactive_recovery_load_guard_body", {
                    signals: recoveryGuardSummary.signalCount,
                    plans: recoveryGuardSummary.futurePlanCount,
                    hard: recoveryGuardSummary.hardFuturePlanCount,
                  })
                  : t("coach.proactive_plan_deviation_rescue_body", {
                    lookback: planDeviationSummary.lookbackDays,
                    count: planDeviationSummary.affectedCount,
                    missed: planDeviationSummary.missedCount,
                    partial: planDeviationSummary.partialCount,
                  })}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {proactiveAdjustment.existingAction ? (
              <button
                type="button"
                onClick={() => onOpenProactiveAction?.(proactiveAdjustment.existingAction)}
                style={{
                  ...s.btn,
                  fontSize: 12,
                  padding: "6px 10px",
                }}>
                {t("coach.proactive_open")}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleProactiveAdjustmentRequest}
                disabled={proactiveAdjustmentLoading}
                style={{
                  ...s.btn,
                  fontSize: 12,
                  padding: "6px 10px",
                  opacity: proactiveAdjustmentLoading ? 0.65 : 1,
                  cursor: proactiveAdjustmentLoading ? "default" : "pointer",
                }}>
                {proactiveAdjustmentLoading ? t("coach.proactive_generating") : t("coach.proactive_retry")}
              </button>
            )}
            <button
              type="button"
              onClick={handleProactiveAdjustmentDismiss}
              disabled={proactiveAdjustmentLoading}
              style={{
                ...s.btnGhost,
                fontSize: 12,
                padding: "6px 10px",
                opacity: proactiveAdjustmentLoading ? 0.6 : 1,
              }}>
              {t("coach.proactive_dismiss")}
            </button>
          </div>
        </div>
      )}

      {showRaceBriefing && (
        <div style={{
          marginBottom: 12,
          padding: isMobile ? "9px 10px" : "10px 12px",
          border: "1px solid var(--rule)",
          background: "var(--bg-elevated)",
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}>
          <div style={{ flex: 1, minWidth: isMobile ? 180 : 260, lineHeight: 1.5 }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontSize: 12,
              fontWeight: 650,
              color: "var(--ink-1)",
              marginBottom: 2,
            }}>
              <span style={{ color: "var(--moss)" }}>◆</span>
              <span>{t("coach.race_briefing_title")}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-2)" }}>
              {t("coach.race_briefing_body", {
                name: raceBriefing.race?.name || t("coach.race_briefing_target"),
                days: raceBriefing.daysToRace,
              })}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {raceBriefing.existingAction ? (
              <button
                type="button"
                onClick={() => setRaceBriefingAction(raceBriefing.existingAction)}
                style={{
                  ...s.btn,
                  fontSize: 12,
                  padding: "6px 10px",
                }}>
                {t("coach.race_briefing_open")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleRaceBriefingRequest()}
                disabled={raceBriefingLoading}
                style={{
                  ...s.btn,
                  fontSize: 12,
                  padding: "6px 10px",
                  opacity: raceBriefingLoading ? 0.65 : 1,
                  cursor: raceBriefingLoading ? "default" : "pointer",
                }}>
                {raceBriefingLoading ? t("coach.race_briefing_generating") : t("coach.race_briefing_generate")}
              </button>
            )}
            <button
              type="button"
              onClick={handleRaceBriefingDismiss}
              disabled={raceBriefingLoading}
              style={{
                ...s.btnGhost,
                fontSize: 12,
                padding: "6px 10px",
                opacity: raceBriefingLoading ? 0.6 : 1,
              }}>
              {t("coach.proactive_dismiss")}
            </button>
          </div>
        </div>
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
          <div style={{ color: "var(--ink-3)", textAlign: "center", padding: 30, fontSize: 13, lineHeight: 1.6 }}>
            <div style={{ whiteSpace: "pre-line" }}>{t("coach.empty")}</div>
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
                const providerMeta = !isUser ? formatProviderMeta(parsedMessage.meta, lang) : "";
                const hasDisplayContent = String(displayContent || "").trim().length > 0;
                if (!isUser && m.isStreaming && !hasDisplayContent) return null;
                const canImport = m.role === "assistant" && !m.isLocal && importToCalendar && coachConfig.showCalendarButton !== false;
                const canResend = isUser && i === lastUserIdx && !chatLoading && sendChat;
                const extracting = extractingForMsgId === m.id;
                const hasCachedAction = canImport && !!hasPlanImportCache?.(m.id);
                const actionStatus = canImport ? getPlanImportActionStatus?.(m.id) : null;
                const actionCompleted = actionStatus === "executed";
                const actionRejected = actionStatus === "rejected";
                const actionButtonLabel = extracting
                  ? t("coach.extracting")
                  : actionCompleted
                    ? t("coach.import_button_executed")
                    : actionRejected
                      ? t("coach.import_button_rejected")
                      : hasCachedAction
                        ? t("coach.import_button_cached")
                        : t("coach.import_button");
                const actionButtonIcon = extracting
                  ? <Spinner size={12} thickness={1.5} color="var(--moss)" />
                  : actionCompleted
                    ? "✓"
                    : actionRejected
                      ? "×"
                      : hasCachedAction
                        ? "✓"
                        : "📅";
                const actionButtonBg = actionCompleted
                  ? "var(--moss-bg)"
                  : actionRejected
                    ? "var(--bg-elevated)"
                    : hasCachedAction
                      ? "var(--moss-bg)"
                      : "var(--bg-elevated)";
                const actionButtonBorder = actionCompleted || hasCachedAction
                  ? "var(--moss)"
                  : "var(--rule)";
                const actionButtonColor = actionCompleted || hasCachedAction
                  ? "var(--moss-deep)"
                  : actionRejected
                    ? "var(--ink-3)"
                    : "var(--ink-2)";
                return (
                  <div key={i} className="ultreia-msg-in" style={{
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
                      background: isUser ? "var(--accent-soft)" : "var(--bg-sunken)",
                      color: isUser ? "var(--ink-1)" : "var(--ink-1)",
                      border: `1px solid ${isUser ? "var(--accent)" : "var(--rule)"}`,
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

                    {providerMeta && (
                      <div style={{
                        fontSize: 10,
                        lineHeight: 1.2,
                        color: parsedMessage.meta?.fallback ? "var(--warn)" : "var(--ink-3)",
                        fontFamily: "var(--font-sans)",
                        padding: "0 2px",
                      }}>
                        {providerMeta}
                      </div>
                    )}

                    {/* Calendar import affordance — text button below the bubble.
                        Gated by the showCalendarButton coach setting (default ON).
                        Shows on persistent assistant replies only. */}
                    {canImport && (
                      <button
                        onClick={() => extracting ? onStopExtraction?.(m.id) : importToCalendar(displayContent, m.id)}
                        style={{
                          background: actionButtonBg,
                          border: `1px solid ${actionButtonBorder}`,
                          borderRadius: 4,
                          padding: "5px 10px",
                          fontSize: 12, lineHeight: 1.2,
                          color: actionButtonColor,
                          fontFamily: "var(--font-sans)",
                          cursor: "pointer",
                          display: "inline-flex", alignItems: "center", gap: 6,
                        }}>
                        {actionButtonIcon}
                        {actionButtonLabel}
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
            {chatLoading && !chatMessages.some(m => m.isStreaming && String(messageContentForCoach(m.content) || "").trim()) && (
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
          <button onClick={chatLoading ? onStopChat : handleSend} disabled={!chatLoading && !chatInput.trim()}
            aria-label={chatLoading ? t("coach.stop_generating") : t("coach.send")}
            style={{
              ...s.btn,
              width: 40,
              height: 32,
              padding: 0,
              fontSize: 20,
              lineHeight: 1,
              minHeight: 32,
              flexShrink: 0,
              opacity: (!chatLoading && !chatInput.trim()) ? 0.4 : 1,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}>
            {chatLoading ? "×" : "⏎"}
          </button>
        ) : (
          // Desktop: ⚙ stacked above Send in a slim column, mirroring mobile.
          // ⚙ opens the unified hub modal (vertical tabs on left, content on right).
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0, width: 84 }}>
            <button onClick={() => setShowCoachHub(true)} aria-label={t("coach.menu_open")}
              style={{ ...s.btnGhost, padding: "8px 10px", fontSize: 13, lineHeight: 1.2 }}>
              ⚙{memoryReady ? " ●" : ""}
            </button>
            <button onClick={chatLoading ? onStopChat : handleSend} disabled={!chatLoading && !chatInput.trim()}
              style={{
                ...s.btn, padding: "10px 20px",
                opacity: (!chatLoading && !chatInput.trim()) ? 0.5 : 1,
                flex: 1,
              }}>
              {chatLoading ? t("common.stop") : t("coach.send")}
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
            <div onClick={dismiss} className="ultreia-overlay-in" style={{
              position: "fixed", inset: 0, background: "rgba(20,20,19,0.45)",
              backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
              display: "flex", alignItems: "center", justifyContent: "center",
              zIndex: 9999, overscrollBehavior: "contain", padding: 16,
            }}>
              <div onClick={e => e.stopPropagation()} className="ultreia-modal-in" style={{
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
            <div onClick={() => setShowCoachMenu(false)} className="ultreia-overlay-in" style={{
              position: "fixed", inset: 0, background: "rgba(20,20,19,0.45)",
              backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
              display: "flex", alignItems: "center", justifyContent: "center",
              // Below the sub-modals (9999) it opens, so closing a sub returns here.
              zIndex: 9990, overscrollBehavior: "contain", padding: 16,
            }}>
              <div onClick={e => e.stopPropagation()} className="ultreia-modal-in" style={{
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
                {sub(t("coach.show_memory"), () => openSub(() => setShowMemory(true)), memoryReady)}

                {/* Agent group */}
                {groupHeader(t("coach.group_agent"))}
                {sub(t("coach.action_matrix_title"), () => openSub(() => setShowActionMatrix(true)))}
                {sub(t("coach.recent_agent_actions"), () => openSub(() => setShowAgentActions(true)), agentActions.length > 0)}

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
                      shape it), "Agent" (matrix + recent suggestions), then
                      "Chat" (calendar toggle + clear). */}
                  {[
                    { header: t("coach.group_prompt"), items: [
                      { id: "prompt",  label: t("coach.preview_prompt"), parent: true },
                      { id: "profile", label: t("coach.edit_profile"), indent: true },
                      { id: "config",  label: t("coach.show_config"), indent: true },
                      { id: "memory",  label: t("coach.show_memory") + (memoryReady ? " ●" : ""), indent: true },
                    ] },
                    { header: t("coach.group_agent"), items: [
                      { id: "matrix", label: t("coach.action_matrix_title") },
                      { id: "actions", label: t("coach.recent_agent_actions") },
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

                  {coachHubTab === "actions" && (
                    <RecentAgentActions
                      actions={agentActions}
                      t={t}
                      onDelete={onDeleteAgentAction}
                      onOpenRaceBriefing={setRaceBriefingAction}
                      onAskCoach={(action) => {
                        sendChat?.(buildAgentActionFollowUpMessage(action, t, lang));
                        setShowCoachHub(false);
                      }}
                    />
                  )}

                  {coachHubTab === "matrix" && (
                    <CoachActionMatrix matrix={COACH_ACTION_MATRIX} lang={lang} t={t} />
                  )}

                  {coachHubTab === "memory" && (
                    <div>
                      <div style={{ ...s.muted, marginBottom: 14, lineHeight: 1.5 }}>{t("coach.memory_hint")}</div>
                      <MemoryReviewSetting
                        enabled={coachConfig.nightlyMemoryReview === true}
                        onToggle={setNightlyMemoryReview}
                        t={t}
                      />
                      {!memoryProposal && (
                        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
                          <button onClick={proposeMemoryUpdate}
                            disabled={memoryUpdating || chatMessages.length === 0}
                            style={{ ...s.btnGhost, fontSize: 12, padding: "6px 12px", opacity: (memoryUpdating || chatMessages.length === 0) ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}>
                            {memoryUpdating && <Spinner size={11} thickness={1.4} />}
                            {memoryUpdating ? t("coach.memory_updating") : t("coach.memory_auto_update")}
                          </button>
                        </div>
                      )}
                      {lastMemoryAction && !memoryProposal && (
                        <MemoryActionStatus action={lastMemoryAction} t={t} />
                      )}
                      {memoryProposal ? (
                        <MemoryProposalReview
                          proposal={memoryProposal}
                          displayLang={memoryDisplayLang}
                          oldFacts={memoryFacts}
                          onAccept={acceptMemoryProposal}
                          onReject={rejectMemoryProposal}
                          t={t}
                        />
                      ) : (
                        <MemoryFactsPanel
                          facts={memoryFacts}
                          displayLang={memoryDisplayLang}
                          onStatus={onMemoryFactStatus}
                          t={t}
                        />
                      )}
                    </div>
                  )}

                  {coachHubTab === "prompt" && (
                    <div>
                      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                        <div style={{ display: "flex", gap: 0 }}>
                          <button onClick={() => setPreviewLang("en")}
                            style={{ ...s.btnGhost, fontSize: 11, padding: "4px 10px", borderRight: "none",
                              background: previewLang === "en" ? "var(--accent-soft)" : "transparent",
                              color: previewLang === "en" ? "var(--accent-dark)" : "var(--ink-2)" }}>EN</button>
                          <button onClick={() => setPreviewLang("zh")}
                            style={{ ...s.btnGhost, fontSize: 11, padding: "4px 10px",
                              background: previewLang === "zh" ? "var(--accent-soft)" : "transparent",
                              color: previewLang === "zh" ? "var(--accent-dark)" : "var(--ink-2)" }}>中</button>
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
                        style={{ ...s.btn, background: "var(--danger)", borderColor: "var(--danger)", color: "var(--ink-inv)", opacity: chatMessages.length === 0 ? 0.4 : 1 }}>
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
function MemoryActionStatus({ action, t }) {
  const isExecuted = action?.status === AGENT_ACTION_STATUS.EXECUTED;
  const isRejected = action?.status === AGENT_ACTION_STATUS.REJECTED;
  if (!isExecuted && !isRejected) return null;
  return (
    <div style={{
      border: "1px solid var(--rule)", borderRadius: 4, padding: "8px 10px",
      marginBottom: 12, fontSize: 12, lineHeight: 1.45, color: "var(--ink-2)",
      background: "var(--paper-2)",
    }}>
      {isExecuted ? t("coach.memory_action_executed") : t("coach.memory_action_rejected")}
    </div>
  );
}

function RaceBriefingModal({ action, t, isMobile, mdComponents, onClose }) {
  const race = action?.payload?.raceBriefing || {};
  const markdown = String(action?.payload?.briefingMarkdown || "").trim();
  return (
    <ModalRoot onClose={onClose}>
      <div style={s.modalOverlay(isMobile, { float: true })} onClick={onClose}>
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            ...s.modalCard(isMobile, { maxWidth: 680, float: true }),
            maxHeight: isMobile ? "min(82dvh, 680px)" : "min(82vh, 720px)",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ ...s.label, marginBottom: 5 }}>{t("coach.race_briefing_modal_eyebrow")}</div>
              <h2 style={{ fontSize: 18, fontWeight: 650, lineHeight: 1.25, margin: 0, color: "var(--ink-1)" }}>
                {race.name || t("coach.race_briefing_target")}
              </h2>
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--ink-3)", lineHeight: 1.45 }}>
                {[race.date, t("coach.race_briefing_days", { days: race.daysToRace ?? "-" }), [race.category, race.subtype].filter(Boolean).join(" / ")].filter(Boolean).join(" · ")}
              </div>
            </div>
            <button onClick={onClose} style={s.modalCloseBtn} aria-label="Close">×</button>
          </div>
          <div style={{
            borderTop: "1px solid var(--rule)",
            paddingTop: 12,
            color: "var(--ink-1)",
            fontSize: 13,
            lineHeight: 1.65,
          }}>
            {markdown ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {markdown}
              </ReactMarkdown>
            ) : (
              <div style={detailEmptyStyle}>{t("coach.agent_action_empty_detail")}</div>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <button type="button" onClick={onClose} style={{ ...s.btn, fontSize: 12, padding: "7px 12px" }}>
              {t("common.close")}
            </button>
          </div>
        </div>
      </div>
    </ModalRoot>
  );
}

function MemoryReviewSetting({ enabled, onToggle, t }) {
  return (
    <div style={{
      border: "1px solid var(--rule-soft)",
      background: "var(--paper-2)",
      borderRadius: 4,
      padding: "10px 11px",
      marginBottom: 12,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    }}>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 650, color: "var(--ink-1)" }}>
          {t("coach.memory_nightly_review")}
        </span>
        <span style={{ display: "block", marginTop: 3, fontSize: 11.5, lineHeight: 1.45, color: "var(--ink-3)" }}>
          {t("coach.memory_nightly_review_desc")}
        </span>
      </span>
      <button
        type="button"
        onClick={() => onToggle?.(!enabled)}
        role="switch"
        aria-checked={enabled}
        style={{
          width: 40,
          height: 22,
          minHeight: 22,
          flexShrink: 0,
          borderRadius: 999,
          border: "1px solid var(--rule)",
          background: enabled ? "var(--accent)" : "var(--bg-elevated)",
          position: "relative",
          cursor: "pointer",
          transition: "background 0.15s ease, border-color 0.15s ease",
          padding: 0,
        }}
      >
        <span style={{
          position: "absolute",
          top: 2,
          left: enabled ? 20 : 2,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: enabled ? "var(--accent-ink)" : "var(--ink-3)",
          boxShadow: "0 1px 2px oklch(0 0 0 / 0.22)",
          transition: "left 0.15s ease, background 0.15s ease",
        }} />
      </button>
    </div>
  );
}

function MemoryFactsPanel({ facts = [], displayLang = "en", onStatus, t }) {
  const appDialog = useAppDialog();
  const [view, setView] = useState("current");
  const visibleFacts = useMemo(() => {
    const statuses = view === "archived" ? ["archived"] : ["active", "proposed"];
    return [...(facts || [])]
      .filter(f => statuses.includes(f?.status || "active"))
      .sort((a, b) => {
        const statusRank = (status) => status === "proposed" ? 0 : 1;
        const byStatus = statusRank(a.status) - statusRank(b.status);
        if (byStatus) return byStatus;
        return String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
      })
      .slice(0, 20);
  }, [facts, view]);

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
        <div style={{ ...s.label, margin: 0 }}>{t("coach.memory_facts_title")}</div>
        <div style={{ color: "var(--ink-3)", fontSize: 11 }}>{t("coach.memory_facts_count", { count: visibleFacts.length })}</div>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        {["current", "archived"].map(option => {
          const selected = view === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              style={{
                ...memoryFactFilterButtonStyle,
                background: selected ? "var(--ink-1)" : "transparent",
                color: selected ? "var(--paper)" : "var(--ink-2)",
                borderColor: selected ? "var(--ink-1)" : "var(--rule)",
              }}
            >
              {t(`coach.memory_facts_filter_${option}`)}
            </button>
          );
        })}
      </div>
      <div style={{ ...s.muted, fontSize: 11, lineHeight: 1.45, marginBottom: 8 }}>
        {t("coach.memory_facts_hint")}
      </div>
      {!visibleFacts.length ? (
        <div style={detailEmptyStyle}>
          {view === "archived" ? t("coach.memory_facts_archived_empty") : t("coach.memory_facts_empty")}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 7 }}>
          {visibleFacts.map(fact => (
            <div key={fact.rowId || fact.clientId || fact.id} style={{
              border: "1px solid var(--rule-soft)",
              borderRadius: 4,
              background: "var(--paper-2)",
              padding: "8px 9px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5, flexWrap: "wrap" }}>
                <span style={detailBadgeStyle}>{t(`coach.memory_fact_category_${fact.category || "other"}`)}</span>
                <span style={{
                  ...detailBadgeStyle,
                  color: fact.status === "proposed" ? "var(--moss-deep)" : "var(--ink-3)",
                  borderColor: fact.status === "proposed" ? "var(--moss)" : "var(--rule)",
                }}>
                  {t(`coach.memory_fact_status_${fact.status || "active"}`)}
                </span>
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-1)" }}>
                {displayLang === "zh"
                  ? (fact.contentZh || fact.contentEn || "-")
                  : (fact.contentEn || fact.contentZh || "-")}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                {fact.status === "proposed" && (
                  <>
                    <button type="button" onClick={() => onStatus?.(fact, "active")} style={memoryFactButtonStyle}>{t("coach.memory_fact_accept")}</button>
                    <button type="button" onClick={() => onStatus?.(fact, "rejected")} style={memoryFactButtonStyle}>{t("coach.memory_fact_reject")}</button>
                  </>
                )}
                {fact.status === "active" && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (await appDialog.confirm(t("coach.memory_fact_archive_confirm"))) {
                        onStatus?.(fact, "archived");
                      }
                    }}
                    style={memoryFactButtonStyle}
                  >
                    {t("coach.memory_fact_archive")}
                  </button>
                )}
                {fact.status === "archived" && (
                  <button type="button" onClick={() => onStatus?.(fact, "active")} style={memoryFactButtonStyle}>{t("coach.memory_fact_restore")}</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const memoryFactFilterButtonStyle = {
  ...s.btnGhost,
  minHeight: 0,
  padding: "5px 10px",
  fontSize: 11,
  borderRadius: 999,
};

const memoryFactButtonStyle = {
  ...s.btnGhost,
  minHeight: 0,
  padding: "4px 8px",
  fontSize: 11,
};

function CoachActionMatrix({ matrix = [], lang = "zh", t }) {
  const rows = [...matrix].sort((a, b) => (a.rank || 0) - (b.rank || 0));
  return (
    <div>
      <div style={{ ...s.muted, lineHeight: 1.55, margin: "0 0 12px" }}>
        {t("coach.action_matrix_hint")}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map(card => (
          <div key={card.id} style={{
            border: "1px solid var(--rule)",
            borderRadius: 6,
            background: "var(--bg-elevated)",
            padding: "11px 12px",
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-1)", lineHeight: 1.35 }}>
                  {card.rank}. {matrixText(card.title, lang)}
                </div>
                <div style={{ marginTop: 3, fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
                  {card.phase}
                </div>
              </div>
              <span style={actionMatrixStatusStyle(card.status)}>
                {t(`coach.action_matrix_status_${card.status}`)}
              </span>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <ActionMatrixLine label={t("coach.action_matrix_trigger")} text={matrixText(card.trigger, lang)} />
              <ActionMatrixLine label={t("coach.action_matrix_suggestion")} text={matrixText(card.suggestion, lang)} />
              <ActionMatrixLine label={t("coach.action_matrix_boundary")} text={matrixText(card.boundary, lang)} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionMatrixLine({ label, text }) {
  return (
    <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-2)" }}>
      <span style={{ color: "var(--ink-3)", marginRight: 6 }}>{label}</span>
      <span>{text}</span>
    </div>
  );
}

function matrixText(value, lang) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value[lang] || value.zh || value.en || "";
}

function actionMatrixStatusStyle(status) {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    minHeight: 0,
    border: "1px solid var(--rule)",
    borderRadius: 999,
    padding: "3px 8px",
    fontSize: 11,
    lineHeight: 1.2,
    whiteSpace: "nowrap",
  };
  if (status === "observing") {
    return {
      ...base,
      color: "var(--moss-deep)",
      background: "var(--moss-bg)",
      borderColor: "var(--moss)",
    };
  }
  if (status === "next") {
    return {
      ...base,
      color: "var(--accent-dark)",
      background: "var(--accent-soft)",
      borderColor: "var(--accent)",
    };
  }
  if (status === "deferred") {
    return {
      ...base,
      color: "var(--ink-3)",
      background: "var(--paper)",
      borderColor: "var(--rule)",
    };
  }
  return {
    ...base,
    color: "var(--ink-2)",
    background: "var(--paper-2)",
  };
}

function RecentAgentActions({ actions = [], t, onDelete, onAskCoach, onOpenRaceBriefing }) {
  const recent = useMemo(() => {
    return [...(actions || [])]
      .filter(Boolean)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .slice(0, 10);
  }, [actions]);
  const [openId, setOpenId] = useState(null);
  const [actionTarget, setActionTarget] = useState(null);
  const pressTimer = useRef(null);
  const longPressFired = useRef(false);
  function startPress(action) {
    if (!onDelete) return;
    longPressFired.current = false;
    pressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      setActionTarget(action);
    }, 450);
  }
  function endPress() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  if (!recent.length) {
    return (
      <div style={{
        border: "1px solid var(--rule)", borderRadius: 6,
        padding: "16px 14px", color: "var(--ink-3)", fontSize: 13,
        background: "var(--bg-elevated)", lineHeight: 1.55,
      }}>
        {t("coach.agent_actions_empty")}
      </div>
    );
  }

  return (
    <div>
      <div style={{ ...s.muted, lineHeight: 1.55, margin: "0 0 12px" }}>
        {t("coach.agent_actions_hint")}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {recent.map(action => {
          const id = action.id || action.rowId || `${action.type}-${action.createdAt}`;
          const open = openId === id;
          const summary = summarizeAgentAction(action, t);
          return (
            <div key={id} style={{
              border: "1px solid var(--rule)",
              borderRadius: 6,
              background: "var(--bg-elevated)",
              overflow: "hidden",
            }}>
              <button type="button" onClick={() => {
                if (longPressFired.current) { longPressFired.current = false; return; }
                setOpenId(open ? null : id);
              }} style={{
                width: "100%", border: "none", background: "transparent",
                display: "grid", gridTemplateColumns: "1fr auto", gap: 10,
                textAlign: "left", padding: "11px 12px", cursor: "pointer",
                fontFamily: "var(--font-sans)", color: "var(--ink-1)",
                WebkitTouchCallout: "none",
              }}
                onPointerDown={() => startPress(action)}
                onPointerUp={endPress}
                onPointerCancel={endPress}
                onPointerLeave={endPress}
                onContextMenu={e => e.preventDefault()}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 650, marginBottom: 4 }}>
                    {summary.typeLabel}
                  </span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--ink-2)", lineHeight: 1.45 }}>
                    {summary.meta}
                  </span>
                  {summary.error && (
                    <span style={{ display: "block", fontSize: 11.5, color: "var(--danger)", lineHeight: 1.45, marginTop: 3 }}>
                      {summary.error}
                    </span>
                  )}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <StatusPill status={action.status} t={t} />
                  <span style={{ color: "var(--ink-3)", fontSize: 14 }}>{open ? "⌃" : "⌄"}</span>
                </span>
              </button>
              {open && (
                <div style={{
                  borderTop: "1px solid var(--rule-soft)",
                  padding: "10px 12px 12px",
                  display: "grid", gap: 8,
                }}>
                  <AgentActionDetails action={action} t={t} />
                  {onAskCoach && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {isRaceBriefingAction(action) && (
                        <button
                          type="button"
                          onClick={() => onOpenRaceBriefing?.(action)}
                          style={{
                            ...s.btn,
                            justifySelf: "start",
                            minHeight: 0,
                            padding: "6px 10px",
                            fontSize: 12,
                          }}>
                          {t("coach.race_briefing_open")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onAskCoach(action)}
                        style={{
                          ...s.btnGhost,
                          justifySelf: "start",
                          minHeight: 0,
                          padding: "6px 10px",
                          fontSize: 12,
                        }}>
                        {t("coach.agent_action_ask_coach")}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {actionTarget && (
        <ItemActionModal
          title={summarizeAgentAction(actionTarget, t).typeLabel}
          onDelete={() => {
            const target = actionTarget;
            setActionTarget(null);
            onDelete?.(target);
          }}
          onClose={() => setActionTarget(null)}
        />
      )}
    </div>
  );
}

function StatusPill({ status, t }) {
  const tone = status === "executed" ? "ok"
    : status === "failed" ? "bad"
      : status === "rejected" || status === "cancelled" ? "muted"
        : "pending";
  const style = {
    ok: { borderColor: "var(--moss)", color: "var(--moss-deep)", background: "var(--moss-bg)" },
    bad: { borderColor: "rgba(192,57,43,0.35)", color: "var(--danger)", background: "rgba(192,57,43,0.08)" },
    muted: { borderColor: "var(--rule)", color: "var(--ink-3)", background: "var(--paper-2)" },
    pending: { borderColor: "var(--rule)", color: "var(--ink-2)", background: "var(--paper)" },
  }[tone];
  return (
    <span style={{
      ...style,
      border: "1px solid",
      borderRadius: 999,
      padding: "3px 7px",
      fontSize: 11,
      lineHeight: 1,
      whiteSpace: "nowrap",
    }}>
      {t(`coach.agent_action_status_${status || "proposed"}`)}
    </span>
  );
}

function AgentActionDetails({ action, t }) {
  if (action.type === "create_plans") return <PlanActionDetails action={action} t={t} />;
  if (action.type === "memory_update") return <MemoryActionDetails action={action} t={t} />;
  if (isRaceBriefingAction(action)) return <RaceBriefingActionDetails action={action} t={t} />;
  return <div style={detailEmptyStyle}>{t("coach.agent_action_empty_detail")}</div>;
}

function RaceBriefingActionDetails({ action, t }) {
  const race = action.payload?.raceBriefing || {};
  const markdown = String(action.payload?.briefingMarkdown || "").trim();
  const preview = markdown
    .split(/\n+/)
    .map(line => line.replace(/^#+\s*/, "").replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" / ");
  return (
    <>
      <ActionDetailSection title={t("coach.agent_action_race_briefing_detail_title")}>
        <div style={detailChangeStyle}>
          <div style={detailChangeDateStyle}>{[race.date, race.name].filter(Boolean).join(" · ") || "-"}</div>
          <div>{t("coach.race_briefing_detail", {
            days: race.daysToRace ?? "-",
            category: [race.category, race.subtype].filter(Boolean).join(" / ") || "-",
          })}</div>
        </div>
      </ActionDetailSection>
      {preview && (
        <ActionDetailSection title={t("coach.agent_actions_payload")}>
          <div style={detailEmptyStyle}>{preview}</div>
        </ActionDetailSection>
      )}
    </>
  );
}

function PlanActionDetails({ action, t }) {
  const plans = Array.isArray(action.payload?.plans) ? action.payload.plans : [];
  const changes = Array.isArray(action.result?.planChanges) ? action.result.planChanges : [];
  const hasResult = (action.result && typeof action.result === "object" && Object.keys(action.result).length > 0) || !!action.error;
  const createdCount = Number(action.result?.createdWorkoutCount || action.result?.createdCount || 0);
  const updatedCount = Number(action.result?.updatedPlanCount || changes.length || 0);
  const restDates = Array.isArray(action.result?.plannedRestDates) ? action.result.plannedRestDates : [];

  return (
    <>
      {plans.length > 0 && (
        <ActionDetailSection title={t("coach.agent_actions_items")}>
          <div style={{ display: "grid", gap: 6 }}>
            {plans.slice(0, 10).map((plan, idx) => {
              const kind = isRestPlanItem(plan)
                ? t("coach.agent_action_item_rest")
                : isPlanUpdateItem(plan)
                  ? t("coach.agent_action_item_update")
                  : t("coach.agent_action_item_new");
              return (
                <div key={`${plan.date || "plan"}-${idx}`} style={detailRowStyle}>
                  <span style={detailBadgeStyle}>{kind}</span>
                  <span>{formatPlanActionBrief(plan, t)}</span>
                </div>
              );
            })}
          </div>
        </ActionDetailSection>
      )}
      {changes.length > 0 && (
        <ActionDetailSection title={t("coach.agent_actions_changes")}>
          <div style={{ display: "grid", gap: 8 }}>
            {groupPlanChangesByDate(changes.slice(0, 10)).map((group) => (
              <div key={group.date} style={detailChangeStyle}>
                <div style={detailChangeDateStyle}>{group.date}</div>
                <div style={{ display: "grid", gap: 7 }}>
                  {group.items.map((change, idx) => (
                    <div key={`${change.targetPlanId || group.date}-${idx}`} style={detailChangeGridStyle}>
                      <span style={detailMiniLabelStyle}>{t("coach.agent_action_before")}</span>
                      <span>{formatPlanActionBrief(change.before, t, { includeDate: false })}</span>
                      <span style={detailMiniLabelStyle}>{t("coach.agent_action_after")}</span>
                      <span>{formatPlanActionBrief(change.after, t, { includeDate: false })}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ActionDetailSection>
      )}
      {hasResult && (
        <ActionDetailSection title={t("coach.agent_actions_result")}>
          <div style={detailResultWrapStyle}>
            {createdCount > 0 && <span style={detailResultPillStyle}>{t("coach.agent_action_created_count_short", { count: createdCount })}</span>}
            {updatedCount > 0 && <span style={detailResultPillStyle}>{t("coach.agent_action_updated_count_short", { count: updatedCount })}</span>}
            {restDates.length > 0 && <span style={detailResultPillStyle}>{t("coach.agent_action_rest_dates", { dates: restDates.join(", ") })}</span>}
            {action.error && <div style={{ color: "var(--danger)" }}>{t("coach.agent_action_error", { msg: action.error })}</div>}
            {!createdCount && !updatedCount && !restDates.length && !action.error && (
              <div>{t("coach.agent_action_empty_detail")}</div>
            )}
          </div>
        </ActionDetailSection>
      )}
      {!plans.length && !changes.length && !hasResult && (
        <div style={detailEmptyStyle}>{t("coach.agent_action_empty_detail")}</div>
      )}
    </>
  );
}

function MemoryActionDetails({ action, t }) {
  const memory = action.payload?.memory && typeof action.payload.memory === "object" ? action.payload.memory : {};
  const previews = [
    memory.zh ? ["中文", memory.zh] : null,
    memory.en ? ["EN", memory.en] : null,
  ].filter(Boolean);
  const savedLanguages = Array.isArray(action.result?.savedLanguages) ? action.result.savedLanguages : [];
  const savedFactCount = Number(action.result?.savedFactCount || 0);
  return (
    <>
      {previews.length > 0 && (
        <ActionDetailSection title={t("coach.agent_action_memory_preview")}>
          <div style={{ display: "grid", gap: 7 }}>
            {previews.map(([label, text]) => (
              <div key={label} style={detailChangeStyle}>
                <div style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 650 }}>{label}</div>
                <div>{formatMemoryPreview(text)}</div>
              </div>
            ))}
          </div>
        </ActionDetailSection>
      )}
      {(savedFactCount > 0 || savedLanguages.length > 0 || action.error) && (
        <ActionDetailSection title={t("coach.agent_actions_result")}>
          <div style={{ color: action.error ? "var(--danger)" : "var(--ink-2)", fontSize: 12, lineHeight: 1.45 }}>
            {action.error
              ? t("coach.agent_action_error", { msg: action.error })
              : savedFactCount > 0
                ? t("coach.agent_action_memory_facts_saved", { count: savedFactCount })
                : t("coach.agent_action_memory_saved", { langs: savedLanguages.join(" / ") })}
          </div>
        </ActionDetailSection>
      )}
      {!previews.length && !savedFactCount && !savedLanguages.length && !action.error && (
        <div style={detailEmptyStyle}>{t("coach.agent_action_empty_detail")}</div>
      )}
    </>
  );
}

function ActionDetailSection({ title, children }) {
  return (
    <div>
      <div style={{ ...s.label, fontSize: 10, marginBottom: 5 }}>{title}</div>
      {children}
    </div>
  );
}

const detailRowStyle = {
  display: "grid",
  gridTemplateColumns: "auto 1fr",
  gap: 8,
  alignItems: "start",
  fontSize: 12,
  lineHeight: 1.45,
  color: "var(--ink-2)",
};

const detailBadgeStyle = {
  border: "1px solid var(--rule)",
  borderRadius: 999,
  padding: "2px 6px",
  color: "var(--ink-3)",
  fontSize: 10,
  lineHeight: 1.2,
  whiteSpace: "nowrap",
};

const detailChangeStyle = {
  border: "1px solid var(--rule-soft)",
  borderRadius: 4,
  background: "var(--paper-2)",
  padding: "8px 8px",
  fontSize: 12,
  lineHeight: 1.45,
  color: "var(--ink-2)",
};

const detailChangeDateStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  color: "var(--ink)",
  marginBottom: 6,
};

const detailChangeGridStyle = {
  display: "grid",
  gridTemplateColumns: "44px minmax(0, 1fr)",
  gap: "3px 7px",
  alignItems: "start",
};

const detailMiniLabelStyle = {
  color: "var(--ink-3)",
  fontSize: 10,
  lineHeight: 1.45,
  whiteSpace: "nowrap",
};

const detailResultWrapStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  color: "var(--ink-2)",
  fontSize: 12,
  lineHeight: 1.45,
};

const detailResultPillStyle = {
  border: "1px solid var(--rule-soft)",
  borderRadius: 6,
  background: "var(--paper-2)",
  padding: "4px 7px",
};

const detailEmptyStyle = {
  color: "var(--ink-3)",
  fontSize: 12,
  lineHeight: 1.45,
};

function groupPlanChangesByDate(changes = []) {
  const groups = [];
  const byDate = new Map();
  changes.forEach((change, idx) => {
    const date = change?.after?.date || change?.before?.date || "-";
    if (!byDate.has(date)) {
      const group = { date, items: [] };
      byDate.set(date, group);
      groups.push(group);
    }
    byDate.get(date).items.push({ ...change, _idx: idx });
  });
  return groups;
}

function formatPlanActionBrief(plan, t, options = {}) {
  const { includeDate = true, includeTargetId = false } = options;
  if (!plan) return "-";
  if (isRestPlanItem(plan)) {
    return [includeDate ? (plan.date || "-") : "", t("calendar.planned_rest_label"), plan.notes].filter(Boolean).join(" · ");
  }
  const subTypes = Array.isArray(plan.subTypes) ? plan.subTypes : [];
  const runType = plan.runType || "";
  const subTypeLabel = runType
    ? t(`enum.subtype.${runType}`)
    : subTypes.map(st => t(`enum.subtype.${st}`)).join(" / ");
  const bits = [
    includeDate ? (plan.date || "-") : "",
    plan.timeOfDay === "am" || plan.timeOfDay === "pm" ? t(`calendar.plan_tod_${plan.timeOfDay}`) : "",
    plan.type ? t(`enum.activity.${plan.type}`) : "",
    subTypeLabel,
  ];
  const distance = Number(plan.distance || 0);
  const ascent = Number(plan.ascent || 0);
  const speed = Number(plan.speed || plan.planDetail?.speed || 0);
  const durationMin = Number(plan.durationMin || 0) || Math.round(Number(plan.duration || 0) / 60) || 0;
  if (distance > 0) bits.push(`${formatCompactNumber(distance)} km`);
  if (ascent > 0) bits.push(`+${Math.round(ascent)} m`);
  if (speed > 0) bits.push(`${formatCompactNumber(speed)} km/h`);
  if (durationMin > 0) bits.push(`${durationMin} ${t("form.minutes")}`);
  const targetId = getPlanTargetId(plan);
  if (includeTargetId && targetId) bits.push(`#${targetId.slice(0, 6)}`);
  return bits.filter(Boolean).join(" · ");
}

function formatCompactNumber(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

function formatMemoryPreview(text) {
  const lines = String(text || "")
    .split(/\n+/)
    .map(line => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 4);
  return lines.length ? lines.join(" / ") : "-";
}

function buildAgentActionFollowUpMessage(action, t, lang = "zh") {
  const summary = summarizeAgentAction(action, t);
  const plans = Array.isArray(action.payload?.plans) ? action.payload.plans : [];
  const changes = Array.isArray(action.result?.planChanges) ? action.result.planChanges : [];
  const raceBriefingText = isRaceBriefingAction(action) ? String(action.payload?.briefingMarkdown || "").trim() : "";
  const zh = lang === "zh";
  const lines = [
    zh
      ? "请基于下面这条教练建议继续分析，不要直接改日历或保存新内容："
      : "Please analyze this coach suggestion. Do not change the calendar or save anything new directly:",
    "",
    `${zh ? "类型" : "Type"}：${summary.typeLabel}`,
    `${zh ? "状态" : "Status"}：${t(`coach.agent_action_status_${action.status || "proposed"}`)}`,
    summary.meta ? `${zh ? "摘要" : "Summary"}：${summary.meta}` : "",
    action.reason ? `${zh ? "原始原因" : "Original reason"}：${action.reason}` : "",
    action.error ? `${zh ? "错误" : "Error"}：${action.error}` : "",
  ].filter(Boolean);
  if (plans.length) {
    lines.push("", zh ? "建议内容：" : "Suggestion items:");
    plans.slice(0, 10).forEach(plan => lines.push(`- ${formatPlanActionBrief(plan, t)}`));
  }
  if (changes.length) {
    lines.push("", zh ? "已保存的修改：" : "Saved changes:");
    changes.slice(0, 10).forEach(change => {
      lines.push(`- ${formatPlanActionBrief(change.before, t)} -> ${formatPlanActionBrief(change.after, t)}`);
    });
  }
  if (raceBriefingText) {
    const race = action.payload?.raceBriefing || {};
    lines.push("", zh ? "赛前简报：" : "Race briefing:");
    if (race.date || race.name) lines.push(`${[race.date, race.name].filter(Boolean).join(" · ")}`);
    lines.push(raceBriefingText);
  }
  const resultBits = [];
  const createdCount = Number(action.result?.createdWorkoutCount || action.result?.createdCount || 0);
  const updatedCount = Number(action.result?.updatedPlanCount || changes.length || 0);
  const restDates = Array.isArray(action.result?.plannedRestDates) ? action.result.plannedRestDates : [];
  const savedLanguages = Array.isArray(action.result?.savedLanguages) ? action.result.savedLanguages : [];
  const savedFactCount = Number(action.result?.savedFactCount || 0);
  if (createdCount > 0) resultBits.push(zh ? `创建计划 ${createdCount} 条` : `created ${createdCount} planned item(s)`);
  if (updatedCount > 0) resultBits.push(zh ? `修改计划 ${updatedCount} 条` : `updated ${updatedCount} existing plan(s)`);
  if (restDates.length) resultBits.push(zh ? `计划休息日：${restDates.join(", ")}` : `planned rest: ${restDates.join(", ")}`);
  if (savedFactCount > 0) resultBits.push(zh ? `已启用记忆事实 ${savedFactCount} 条` : `activated ${savedFactCount} memory fact(s)`);
  else if (savedLanguages.length) resultBits.push(zh ? `已保存记忆语言：${savedLanguages.join(" / ")}` : `saved memory languages: ${savedLanguages.join(" / ")}`);
  if (resultBits.length) lines.push("", `${zh ? "保存结果" : "Saved result"}：${resultBits.join(zh ? "；" : "; ")}`);
  if (raceBriefingText) {
    lines.push("", zh
      ? "请基于这份赛前简报继续分析：还有哪些赛前风险、装备或执行细节需要我特别注意？如果有训练调整建议，只作为建议说明，不要直接改日历。"
      : "Continue from this race briefing. What race-week risks, gear items, or execution details should I pay special attention to? If training changes are needed, explain them as advice only and do not change the calendar.");
  } else {
    lines.push("", zh
      ? "请告诉我：这条建议是否合理？接下来我应该继续、调整，还是撤回/手动修正？如果需要调整，请给出明确建议。"
      : "Tell me whether this suggestion was reasonable. Should I continue, adjust, or undo/manual-fix something next? If adjustment is needed, give a concrete recommendation.");
  }
  return lines.join("\n");
}

function summarizeAgentAction(action, t) {
  const plans = Array.isArray(action.payload?.plans) ? action.payload.plans : [];
  const affectedDates = Array.isArray(action.payload?.affectedDates)
    ? action.payload.affectedDates
    : [...new Set(plans.map(p => p?.date).filter(Boolean))].sort();
  const createdCount = Number(action.result?.createdWorkoutCount ?? action.result?.createdCount ?? 0);
  const memory = action.payload?.memory && typeof action.payload.memory === "object" ? action.payload.memory : null;
  const savedLanguages = Array.isArray(action.result?.savedLanguages) ? action.result.savedLanguages : [];
  const savedFactCount = Number(action.result?.savedFactCount || 0);
  const race = action.payload?.raceBriefing || null;

  const typeLabel = action.type === "create_plans"
    ? t("coach.agent_action_type_create_plans")
    : action.type === "memory_update"
      ? t("coach.agent_action_type_memory_update")
      : isRaceBriefingAction(action)
        ? t("coach.agent_action_type_race_briefing")
        : (action.title || action.type || t("coach.agent_action_type_unknown"));
  const sourceLabel = action.sourceReportId || action.source === "weekly_report"
    ? t("coach.agent_action_source_report")
    : action.source === "plan_deviation_rescue"
      ? t("coach.agent_action_source_plan_rescue")
      : action.source === "recovery_load_guard"
        ? t("coach.agent_action_source_recovery_guard")
        : action.source === "combined_training_adjustment"
          ? t("coach.agent_action_source_combined_adjustment")
          : action.source === "race_briefing_checklist" || isRaceBriefingAction(action)
            ? t("coach.agent_action_source_race_briefing")
            : t("coach.agent_action_source_coach");
  const detail = action.type === "create_plans"
    ? t("coach.agent_action_plan_detail", {
        dates: affectedDates.length ? affectedDates.slice(0, 4).join(", ") : "-",
        count: plans.length || createdCount || 0,
      })
    : action.type === "memory_update"
      ? t("coach.agent_action_memory_detail", {
          count: savedFactCount || savedLanguages.length || [memory?.en, memory?.zh].filter(v => String(v || "").trim()).length || 0,
        })
      : isRaceBriefingAction(action)
        ? t("coach.agent_action_race_briefing_detail", {
            name: race?.name || "-",
            date: race?.date || "-",
          })
        : "";
  const when = formatActionTime(action.createdAt);
  const meta = [sourceLabel, detail, when].filter(Boolean).join(" · ");
  const error = action.error ? t("coach.agent_action_error", { msg: action.error }) : "";
  return { typeLabel, meta, error };
}

function formatActionTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

function MemoryProposalReview({ proposal, displayLang, oldFacts = [], onAccept, onReject, t }) {
  const splitLines = (str) => (str || "").split("\n").map(l => l.replace(/\s+$/, "")).filter(l => l.trim());
  const enLines = splitLines(proposal.en);
  const zhLines = splitLines(proposal.zh);
  const action = proposal.action || null;
  const aligned = enLines.length === zhLines.length && enLines.length > 0;
  const displayLines = displayLang === "zh" ? (zhLines.length ? zhLines : enLines) : (enLines.length ? enLines : zhLines);
  const oldFactText = oldFacts
    .filter(f => f?.status === "active")
    .map(f => displayLang === "zh" ? (f.contentZh || f.contentEn || "") : (f.contentEn || f.contentZh || ""))
    .join("\n")
    .toLowerCase();
  const [kept, setKept] = useState(() => new Set(displayLines.map((_, i) => i)));
  const isNew = (line) => {
    const probe = line.trim().toLowerCase();
    return probe.length > 0 && !oldFactText.includes(probe.slice(0, Math.min(probe.length, 30)));
  };
  function toggle(i) {
    if (isMemorySectionHeading(displayLines[i])) return;
    setKept(prev => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  }
  function accept() {
    const keep = (lines) => lines.filter((line, i) => isMemorySectionHeading(line) || kept.has(i)).join("\n");
    const normalizeEn = (text) => fillEmptyMemorySections(text, "en");
    const normalizeZh = (text) => fillEmptyMemorySections(text, "zh");
    if (aligned) { onAccept(normalizeEn(keep(enLines)), normalizeZh(keep(zhLines))); return; }
    if (displayLang === "zh") onAccept(normalizeEn(proposal.en), normalizeZh(keep(zhLines)));
    else onAccept(normalizeEn(keep(enLines)), normalizeZh(proposal.zh));
  }
  return (
    <>
      <div style={{
        border: "1px solid var(--ink-1)", borderRadius: 4, padding: 12,
        marginBottom: 12, background: "var(--paper)",
      }}>
        <div style={{
          fontSize: 10, textTransform: "uppercase", letterSpacing: 0,
          color: "var(--ink-3)", marginBottom: 6,
        }}>
          {t("coach.action_modal_eyebrow")}
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 650, color: "var(--ink-1)" }}>
            {t("coach.memory_action_title")}
          </div>
          <span style={{
            flexShrink: 0, border: "1px solid var(--rule)", padding: "3px 6px",
            borderRadius: 2, fontSize: 11, color: "var(--ink-2)", background: "var(--paper-2)",
          }}>
            {action?.risk === "medium" ? t("coach.action_risk_medium") : t("coach.action_risk_low")}
          </span>
        </div>
        <div style={{ ...s.muted, fontSize: 12, lineHeight: 1.5, marginTop: 8 }}>
          {t("coach.memory_action_reason")}
        </div>
        <div style={{ borderTop: "1px solid var(--rule)", marginTop: 10, paddingTop: 10, fontSize: 12, color: "var(--ink-2)", lineHeight: 1.45 }}>
          {t("coach.action_requires_confirmation")}
        </div>
      </div>
      <div style={{ ...s.label, marginBottom: 4, color: "var(--moss-deep)" }}>{t("coach.memory_proposal_title")}</div>
      <div style={{ ...s.muted, fontSize: 11, marginBottom: 8, lineHeight: 1.5 }}>{t("coach.memory_proposal_hint")}</div>
      <div style={{
        display: "flex", flexDirection: "column", gap: 2, maxHeight: 320, overflowY: "auto",
        border: "1px solid var(--moss)", background: "var(--moss-bg)", borderRadius: 4, padding: "8px 10px",
      }}>
        {displayLines.map((line, i) => {
          const isHeading = isMemorySectionHeading(line);
          return (
            <label key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: isHeading ? "default" : "pointer", padding: "4px 0" }}>
              {isHeading ? (
                <span style={{ width: 13, marginTop: 4, flexShrink: 0 }} />
              ) : (
                <input type="checkbox" checked={kept.has(i)} onChange={() => toggle(i)} style={{ marginTop: 4, flexShrink: 0 }} />
              )}
              <span style={{
                flex: 1, fontSize: 13, lineHeight: 1.5,
                color: isHeading || kept.has(i) ? "var(--ink-1)" : "var(--ink-3)",
                textDecoration: isHeading || kept.has(i) ? "none" : "line-through",
                fontWeight: isHeading ? 600 : 400,
              }}>
                {line}
                {!isHeading && isNew(line) && (
                  <span style={{
                    marginLeft: 6, fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--moss)",
                    border: "1px solid var(--moss)", borderRadius: 3, padding: "0 4px", verticalAlign: "middle",
                  }}>{t("coach.memory_new")}</span>
                )}
              </span>
            </label>
          );
        })}
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
