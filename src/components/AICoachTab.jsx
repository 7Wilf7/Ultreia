import { memo, useState, useEffect, useRef, useMemo, useLayoutEffect, useCallback, useDeferredValue } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { s } from "../styles";
import {
  coachComposerIconButtonStyle,
  coachComposerInputStyle,
  coachComposerSendButtonStyle,
} from "./CoachComposerControls";
import {
  COACH_STYLES, OUTPUT_LENGTHS, INTERVENTION_LEVELS,
  TRAINING_PREFERENCE_OPTIONS,
  DEFAULT_COACH_CONFIG,
} from "../constants";
import { COACH_ACTION_MATRIX } from "../data/coachActionMatrix";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { cityAbbreviationFromLocation, cityFromLocation, hasValidCoords } from "../lib/weather";
import { buildDataBlock, buildPromptSkeleton, estimateTextTokens, loadPreciseTextTokenCounter, messageContentForCoach, parseCoachMessageMeta } from "../utils/coachPrompt";
import { buildSystemPrompt } from "../utils/profile";
import { buildMemoryFactReview, buildMemoryFactSnapshotFromReview, extractMemoryFacts, MEMORY_SECTIONS } from "../utils/memory";
import { AGENT_ACTION_STATUS, getAgentActionQualitySignal, getPlanTargetId, isPlanUpdateItem, isRaceBriefingAction, isRestPlanItem, markAgentActionStatus } from "../utils/agentActions";
import { planAdjustmentSignature, recoveryAdjustmentSignature, trainingAdjustmentSignature } from "../utils/proactiveTrainingAdjustment";
import { shouldAutoQuietProactiveAction, shouldAutoTriggerPlanDeviation, shouldAutoTriggerRecoveryGuard } from "../utils/actionPlanFilters";
import { normalizeComposerTextChange } from "../utils/composerInput";
import { ModalRoot } from "./ModalRoot";
import { Spinner } from "./Spinner";
import { CalendarIcon, CoachIcon, SettingsIcon, MailIcon, ImageIcon, PinIcon } from "./Icons";
import { ItemActionModal } from "./ItemActionModal";
import { RaceBriefingModal } from "./RaceBriefingModal";
import { useAppDialog } from "./AppDialogContext";
import { Dropdown } from "./Dropdown";
import { useInstantPress, useInstantTap } from "../hooks/useInstantPress";

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
const TRAINING_PREFERENCE_DAYS = [1, 2, 3, 4, 5, 6, 0];
const TRAINING_PREFERENCE_SLOTS = ["am", "pm"];

function normalizeTrainingPreferences(value) {
  const template = value?.weeklyTemplate && typeof value.weeklyTemplate === "object"
    ? value.weeklyTemplate
    : {};
  const weeklyTemplate = {};
  for (const day of TRAINING_PREFERENCE_DAYS) {
    const source = template[String(day)] || template[day] || {};
    const entry = {};
    for (const slot of TRAINING_PREFERENCE_SLOTS) {
      const text = String(source?.[slot] || "").trim();
      if (text) entry[slot] = text;
    }
    if (Object.keys(entry).length) weeklyTemplate[String(day)] = entry;
  }
  return { weeklyTemplate };
}

function normalizeCoachConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...DEFAULT_COACH_CONFIG,
    ...source,
    trainingPreferences: normalizeTrainingPreferences(source.trainingPreferences),
  };
}

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

function PromptLangSwitch({ value, onChange }) {
  const instantPress = useInstantPress();
  const isEn = value === "en";
  const nextValue = isEn ? "zh" : "en";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isEn}
      aria-label="Prompt language"
      {...instantPress("prompt-lang-switch", () => onChange(nextValue))}
      style={{
        position: "relative",
        width: 76,
        height: 30,
        minHeight: 0,
        padding: 0,
        borderRadius: 15,
        background: "var(--bg-sunken)",
        border: "1px solid var(--rule)",
        cursor: "pointer",
        flexShrink: 0,
        userSelect: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <span style={{
        position: "absolute",
        top: 2,
        left: isEn ? 38 : 2,
        width: 36,
        height: 24,
        borderRadius: 12,
        background: "var(--accent)",
        transition: "left 180ms cubic-bezier(0.2,0.7,0.3,1)",
      }} />
      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center" }}>
        <span style={{
          flex: 1,
          textAlign: "center",
          fontSize: 13,
          fontFamily: "var(--font-sans)",
          fontWeight: 600,
          zIndex: 1,
          transition: "color 180ms",
          color: !isEn ? "var(--accent-ink)" : "var(--ink-3)",
        }}>中</span>
        <span style={{
          flex: 1,
          textAlign: "center",
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          fontWeight: 600,
          zIndex: 1,
          transition: "color 180ms",
          color: isEn ? "var(--accent-ink)" : "var(--ink-3)",
        }}>EN</span>
      </span>
    </button>
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

const COACH_CONTEXT_WINDOW_TOKENS = 200_000;
const COACH_CONTEXT_WARN_REMAINING_TOKENS = 20_000;
const COACH_CONTEXT_FIXED_OVERHEAD_TOKENS = 2_500;
const COACH_IMAGE_ESTIMATE_TOKENS = 1_500;
const MOBILE_CHAT_INITIAL_RENDER_COUNT = 12;
const MOBILE_CHAT_RENDER_BATCH = 12;
const PROACTIVE_ADJUSTMENT_SNOOZE_KEY = "ultreia.proactiveAdjustment.snoozedUntil";
const PROACTIVE_ADJUSTMENT_ATTEMPT_KEY = "ultreia.proactiveAdjustment.attemptedSignature";
const PROACTIVE_ADJUSTMENT_ATTEMPT_LIMIT = 20;
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

function compactProactiveAdjustmentSignatures(signatures = []) {
  return Array.from(new Set(
    (Array.isArray(signatures) ? signatures : [signatures])
      .map(sig => String(sig || "").trim())
      .filter(Boolean),
  )).slice(-PROACTIVE_ADJUSTMENT_ATTEMPT_LIMIT);
}

function readProactiveAdjustmentAttempts() {
  try {
    const raw = localStorage.getItem(PROACTIVE_ADJUSTMENT_ATTEMPT_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return compactProactiveAdjustmentSignatures(parsed);
      if (typeof parsed === "string") return compactProactiveAdjustmentSignatures([parsed]);
    } catch {
      return compactProactiveAdjustmentSignatures([raw]);
    }
    return compactProactiveAdjustmentSignatures([raw]);
  } catch {
    return [];
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

const CoachChatMessages = memo(function CoachChatMessages({
  chatMessages,
  isMobile,
  mdComponents,
  lang,
  t,
  showCalendarButton,
  importToCalendar,
  chatLoading,
  sendChat,
  extractingForMsgId,
  hasPlanImportCache,
  getPlanImportActionStatus,
  onStopExtraction,
}) {
  const [mobileRenderCount, setMobileRenderCount] = useState(MOBILE_CHAT_INITIAL_RENDER_COUNT);
  const instantPress = useInstantPress();

  if (chatMessages.length === 0) {
    return (
      <div style={{ color: "var(--ink-3)", textAlign: "center", padding: 30, fontSize: 13, lineHeight: 1.6 }}>
        <div style={{ whiteSpace: "pre-line" }}>{t("coach.empty")}</div>
      </div>
    );
  }

  // The "resend" affordance only shows on the most-recent user message
  // (an older send is rarely what the user wants to retry — usually they
  // hit a network error on the last one).
  let lastUserIdx = -1;
  for (let k = chatMessages.length - 1; k >= 0; k--) {
    if (chatMessages[k].role === "user") { lastUserIdx = k; break; }
  }
  const renderCount = isMobile
    ? Math.min(chatMessages.length, Math.max(MOBILE_CHAT_INITIAL_RENDER_COUNT, mobileRenderCount))
    : chatMessages.length;
  const hiddenCount = Math.max(0, chatMessages.length - renderCount);
  const visibleMessages = hiddenCount > 0 ? chatMessages.slice(hiddenCount) : chatMessages;
  const nextOlderCount = Math.min(MOBILE_CHAT_RENDER_BATCH, hiddenCount);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {hiddenCount > 0 && (
        <button
          type="button"
          {...instantPress("coach-load-older", () => setMobileRenderCount(count => Math.min(chatMessages.length, count + MOBILE_CHAT_RENDER_BATCH)))}
          style={{
            alignSelf: "center",
            border: "1px solid var(--rule)",
            background: "var(--bg-elevated)",
            color: "var(--ink-2)",
            borderRadius: 6,
            padding: "7px 12px",
            minHeight: 0,
            fontSize: 12,
            lineHeight: 1.2,
            fontFamily: "var(--font-sans)",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          ↑ {t("coach.load_older_messages", { count: nextOlderCount, total: hiddenCount })}
        </button>
      )}
      {visibleMessages.map((m, offset) => {
        const i = hiddenCount + offset;
        const isUser = m.role === "user";
        const parsedMessage = parseCoachMessageMeta(m.content);
        const displayContent = parsedMessage.text;
        const providerMeta = !isUser ? formatProviderMeta(parsedMessage.meta, lang) : "";
        const hasDisplayContent = String(displayContent || "").trim().length > 0;
        if (!isUser && m.isStreaming && !hasDisplayContent) return null;
        const canImport = m.role === "assistant" && !m.isLocal && importToCalendar && showCalendarButton;
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
          <div key={m.id || i} className="ultreia-msg-in" style={{
            alignSelf: isUser ? "flex-end" : "flex-start",
            // Mobile bubbles get wider so long messages don't squeeze into
            // a narrow column the user has to keep scrolling to read.
            // Color already differentiates user vs coach so the visual
            // "tail" of leftover horizontal space isn't needed.
            maxWidth: isMobile ? "94%" : "85%",
            display: "flex", flexDirection: "column",
            alignItems: isUser ? "flex-end" : "flex-start",
            gap: 6, minWidth: 0,
            contain: "layout paint style",
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
      })}
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
  );
}, areCoachChatMessagesEqual);

function areCoachChatMessagesEqual(prev, next) {
  return prev.chatMessages === next.chatMessages
    && prev.isMobile === next.isMobile
    && prev.mdComponents === next.mdComponents
    && prev.lang === next.lang
    && prev.showCalendarButton === next.showCalendarButton
    && prev.chatLoading === next.chatLoading
    && prev.extractingForMsgId === next.extractingForMsgId
    && prev.importToCalendar === next.importToCalendar
    && prev.sendChat === next.sendChat
    && prev.hasPlanImportCache === next.hasPlanImportCache
    && prev.getPlanImportActionStatus === next.getPlanImportActionStatus
    && prev.onStopExtraction === next.onStopExtraction;
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

function formatTokenK(tokens) {
  const n = Math.max(0, Math.round(Number(tokens) || 0));
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function runnerAgeMs(iso, nowMs) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.max(0, nowMs - ms) : null;
}

const COACH_IMAGE_LIMIT = 3;
const COACH_IMAGE_MAX_SIDE = 1280;
const COACH_IMAGE_MAX_DATA_URL_CHARS = 2_200_000;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("image_read_failed"));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image_decode_failed"));
    image.src = src;
  });
}

function dataUrlBytes(dataUrl) {
  const base64 = String(dataUrl || "").split(",")[1] || "";
  return Math.round((base64.length * 3) / 4);
}

async function prepareCoachImageAttachment(file) {
  if (!file || !String(file.type || "").startsWith("image/")) {
    throw new Error("unsupported_image");
  }
  const raw = await readFileAsDataUrl(file);
  const image = await loadImageElement(raw);
  const longestSide = Math.max(image.naturalWidth || image.width || 0, image.naturalHeight || image.height || 0);
  if (!longestSide) throw new Error("unsupported_image");
  const scale = Math.min(1, COACH_IMAGE_MAX_SIDE / longestSide);
  const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("image_canvas_failed");
  ctx.drawImage(image, 0, 0, width, height);

  let dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  if (dataUrl.length > COACH_IMAGE_MAX_DATA_URL_CHARS) {
    dataUrl = canvas.toDataURL("image/jpeg", 0.68);
  }
  if (dataUrl.length > COACH_IMAGE_MAX_DATA_URL_CHARS) {
    throw new Error("image_too_large");
  }
  return {
    type: "image",
    name: String(file.name || "coach-image.jpg").slice(0, 100),
    mediaType: "image/jpeg",
    dataUrl,
    width,
    height,
    sizeBytes: dataUrlBytes(dataUrl),
  };
}

export function AICoachTab({
  coachConfig: incomingCoachConfig, setCoachConfig,
  profile = null,
  chatMessages,
  logs = [], races = [],
  now = new Date(),
  dailyNotes = [],
  setConfirmDelete,
  // Jump to other tabs from the first-send guidance nudge. coachHintsPending
  // (lifted to AppShell so it survives a tab switch) re-opens the nudge when the
  // user comes back from a setting, so multi-item nudges can be worked through.
  onGoToTraining, onGoToRaces, onGoToWeather,
  coachHintsPending, setCoachHintsPending,
  // Lifted from AppShell so they survive tab switches — the user can send
  // a message, tab away, and the spinner badge on the AI Coach tab still
  // shows the model is working.
  chatLoading, contextCompressing = false, chatInput, setChatInput, coachProviderLabel: currentProviderLabel = "DeepSeek", coachProviderFallback = null, extractingForMsgId, sendChat, importToCalendar, onStopChat, onStopExtraction, hasPlanImportCache, getPlanImportActionStatus,
  codexRunnerStatus = null,
  planDeviationSummary = null,
  recoveryGuardSummary = null,
  raceBriefingSummary = null,
  proactiveAutoPauseUntil = 0,
  handledProactiveAdjustmentSignatures = [],
  proactiveAdjustmentLoading = false, onProactiveTrainingAdjustmentRequest, onStopProactiveTrainingAdjustment, onOpenProactiveAction,
  raceBriefingLoading = false, onRaceBriefingRequest,
  agentActions = [], onDeleteAgentAction,
  memoryFacts = [], onMemoryFactStatus, onMemoryFactDelete,
  // Shared weather context — { currentWeather, forecastByDate, status,
  // error, refetch }. Drives the Weather status pill below + the prompt
  // preview's [Current Weather] / [Upcoming Forecast] sections.
  weatherCtx, defaultLocation, onOpenLocationSettings,
  // Inbox (delivered coach pushes) — entry lives top-right of this tab's
  // header. Opens the InboxModal owned by AppShell; inboxUnread drives the
  // badge.
  onOpenInbox, inboxUnread = 0, weeklyReportLoading = false,
  // Memory update lifted to AppShell so it survives leaving this tab (the
  // request keeps running; a top banner invites the user back when ready).
  showMemory, setShowMemory,
  memoryUpdating, memoryProposal, setMemoryProposal, lastMemoryAction, setLastMemoryAction, recordMemoryActionDecision, saveMemoryFacts, proposeMemoryUpdate,
}) {
  const t = useT();
  const appDialog = useAppDialog();
  const { lang } = useLanguage();
  const isMobile = useIsMobile();
  const instantPress = useInstantPress();
  const recentCalendarButtonPressRef = useRef(new Map());
  const [optimisticCoachConfig, setOptimisticCoachConfig] = useState(() => normalizeCoachConfig(incomingCoachConfig));
  const optimisticCoachConfigRef = useRef(optimisticCoachConfig);
  useEffect(() => {
    let cancelled = false;
    const next = normalizeCoachConfig(incomingCoachConfig);
    optimisticCoachConfigRef.current = next;
    queueMicrotask(() => {
      if (!cancelled) setOptimisticCoachConfig(next);
    });
    return () => { cancelled = true; };
  }, [incomingCoachConfig]);
  const commitCoachConfig = useCallback((nextConfig) => {
    const next = normalizeCoachConfig(nextConfig);
    optimisticCoachConfigRef.current = next;
    setOptimisticCoachConfig(next);
    setCoachConfig?.(next);
  }, [setCoachConfig]);
  const patchCoachConfig = useCallback((patch) => {
    commitCoachConfig({
      ...optimisticCoachConfigRef.current,
      ...patch,
    });
  }, [commitCoachConfig]);
  const coachConfig = optimisticCoachConfig;
  const [runnerNowMs, setRunnerNowMs] = useState(() => Date.now());
  // Markdown component map depends on isMobile (mobile swaps wide tables to
  // stacked row cards). Memoize so we don't rebuild the renderer object on
  // every chat message render.
  const mdComponents = useMemo(() => makeMdComponents(isMobile), [isMobile]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.body?.dataset?.ultreiaPagerTouching === "true") return;
      setRunnerNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  const [showCoachConfig, setShowCoachConfig] = useState(false);
  const [showCoachFocus, setShowCoachFocus] = useState(false);
  const [showTrainingPreferences, setShowTrainingPreferences] = useState(false);
  const [showCalendarSettings, setShowCalendarSettings] = useState(false);
  const [showAgentActions, setShowAgentActions] = useState(false);
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [coachAdvancedOpen, setCoachAdvancedOpen] = useState(false);
  // Preview language is independent of UI language — defaults to UI language
  // but the user can flip it to read the prompt in the other language.
  const [previewLang, setPreviewLang] = useState(lang);
  // showMemory / memoryUpdating / memoryProposal are now lifted to AppShell
  // (props) so the update can finish after the user leaves this tab.
  const memoryDisplayLang = lang === "zh" ? "zh" : "en";
  // First-send guidance: { msg, hints } while the one-time nudge modal is open.
  const [coachHints, setCoachHints] = useState(null);
  const [coachImages, setCoachImages] = useState([]);
  const [composerInput, setComposerInput] = useState(() => String(chatInput || ""));
  const composerInputRef = useRef(composerInput);
  const composerFocusedRef = useRef(false);
  const composerComposingRef = useRef(false);
  const lastParentDraftWriteRef = useRef(String(chatInput || ""));
  const pendingSelectionRestoreRef = useRef(null);
  const syncComposerInput = useCallback((value) => {
    const next = String(value ?? "");
    composerInputRef.current = next;
    setComposerInput(next);
    lastParentDraftWriteRef.current = next;
    setChatInput?.(next);
  }, [setChatInput]);
  const handleComposerInputChange = useCallback((event) => {
    const normalized = normalizeComposerTextChange(composerInputRef.current, event.target.value, {
      inputType: event.nativeEvent?.inputType,
      selectionStart: event.target.selectionStart,
    });
    const next = normalized.value;
    composerInputRef.current = next;
    if (normalized.changed && normalized.selectionStart != null) {
      pendingSelectionRestoreRef.current = normalized.selectionStart;
    }
    setComposerInput(next);
  }, []);
  const deferredComposerInput = useDeferredValue(composerInput);

  useEffect(() => {
    const next = String(chatInput || "");
    if (next === lastParentDraftWriteRef.current && next !== composerInputRef.current) return;
    if ((composerFocusedRef.current || composerComposingRef.current) && next !== "") return;
    if (next === composerInputRef.current) return;
    composerInputRef.current = next;
    setComposerInput(next);
  }, [chatInput]);

  // Keep typing responsive: keystrokes update local state immediately, while
  // the lifted AppShell draft only syncs after the user pauses.
  useEffect(() => {
    if (composerComposingRef.current) return undefined;
    const timer = setTimeout(() => {
      const next = composerInputRef.current;
      if (next !== String(chatInput || "")) {
        lastParentDraftWriteRef.current = next;
        setChatInput?.(next);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [chatInput, composerInput, setChatInput]);

  useEffect(() => () => {
    setChatInput?.(composerInputRef.current);
  }, [setChatInput]);

  // Single ⚙ toggle replaces the row of toggle buttons (config / memory /
  // prompt preview / edit profile / clear chat). Open the menu to access
  // any of those — keeps the top of the tab uncluttered.
  // Mobile: opens an in-place settings sub-page (kept for the touch flow).
  // Desktop: opens a unified hub modal with vertical tabs on the left + the
  // selected tab's content rendered on the right — see CoachSettingsHub
  // below. coachHubTab tracks which tab is active in that modal.
  const [showCoachMenu, setShowCoachMenu] = useState(false);
  const [showCoachHub, setShowCoachHub] = useState(false);
  // Default to the state overview. Internal diagnostics are under Advanced so
  // the settings hub does not open on a prompt/debug surface.
  const [coachHubTab, setCoachHubTab] = useState("focus");
  // Long-chat hint is dismissible. Once dismissed it collapses to a
  // single-line tappable chip that sits between provider pills and the
  // chat scroll area — no longer occupies a full banner, but still
  // reachable so the user can act when they want to. Per-session state
  // (resets on page reload, which is the point — fresh page → fresh
  // reminder if conversation is still long).
  const [longChatHintCollapsed, setLongChatHintCollapsed] = useState(false);
  const contextUsageButtonRef = useRef(null);
  const contextUsagePointerAtRef = useRef(0);
  const [showContextUsage, setShowContextUsage] = useState(false);
  const [contextUsagePopoverPosition, setContextUsagePopoverPosition] = useState(null);
  const [preciseTextTokenCounter, setPreciseTextTokenCounter] = useState(null);
  const [proactiveAdjustmentSnoozedUntil, setProactiveAdjustmentSnoozedUntil] = useState(readProactiveAdjustmentSnooze);
  const [raceBriefingSnoozedUntil, setRaceBriefingSnoozedUntil] = useState(readRaceBriefingSnooze);
  const [raceBriefingAction, setRaceBriefingAction] = useState(null);
  const [attemptedProactiveAdjustmentSignatures, setAttemptedProactiveAdjustmentSignatures] = useState(readProactiveAdjustmentAttempts);
  const [attemptedRaceBriefingSignature, setAttemptedRaceBriefingSignature] = useState(() => {
    try { return localStorage.getItem(RACE_BRIEFING_ATTEMPT_KEY) || ""; }
    catch { return ""; }
  });
  const [confirmManualAdjustment, setConfirmManualAdjustment] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadPreciseTextTokenCounter()
      .then((countTokens) => {
        if (!cancelled) setPreciseTextTokenCounter(() => countTokens);
      })
      .catch(() => {
        if (!cancelled) setPreciseTextTokenCounter(null);
      });
    return () => { cancelled = true; };
  }, []);
  const proactiveAdjustmentSnoozed = proactiveAdjustmentSnoozedUntil > runnerNowMs;
  const proactiveAutoPaused = Number(proactiveAutoPauseUntil) > runnerNowMs;
  const raceBriefingSnoozed = raceBriefingSnoozedUntil > runnerNowMs;
  const snoozeProactiveAdjustment = useCallback(() => {
    const until = Date.now() + PROACTIVE_ADJUSTMENT_SNOOZE_MS;
    setProactiveAdjustmentSnoozedUntil(until);
    try {
      localStorage.setItem(PROACTIVE_ADJUSTMENT_SNOOZE_KEY, JSON.stringify({ until }));
    } catch { /* private mode */ }
  }, []);
  const markProactiveAdjustmentAttempted = useCallback((signatures) => {
    const incoming = compactProactiveAdjustmentSignatures(signatures);
    if (!incoming.length) return;
    setAttemptedProactiveAdjustmentSignatures(prev => {
      const next = compactProactiveAdjustmentSignatures([
        ...readProactiveAdjustmentAttempts(),
        ...(Array.isArray(prev) ? prev : []),
        ...incoming,
      ]);
      try {
        if (next.length) localStorage.setItem(PROACTIVE_ADJUSTMENT_ATTEMPT_KEY, JSON.stringify(next));
        else localStorage.removeItem(PROACTIVE_ADJUSTMENT_ATTEMPT_KEY);
      } catch { /* private mode */ }
      return next;
    });
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
    const planAutoEligible = shouldAutoTriggerPlanDeviation(planDeviationSummary);
    const recoveryAutoEligible = shouldAutoTriggerRecoveryGuard(recoveryGuardSummary);
    const kind = hasPlanDeviation && hasRecoverySignal
      ? "combined_training_adjustment"
      : hasRecoverySignal
        ? "recovery_load_guard"
        : "plan_deviation_rescue";
    const autoEligible = kind === "combined_training_adjustment"
      ? (planAutoEligible || recoveryAutoEligible)
      : kind === "recovery_load_guard"
        ? recoveryAutoEligible
        : planAutoEligible;
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
    const autoQuieted = shouldAutoQuietProactiveAction(agentActions, kind, now);
    return { kind, signature, existingAction, settledAction, autoEligible, autoQuieted };
  }, [agentActions, now, planDeviationSummary, recoveryGuardSummary]);
  const allAttemptedProactiveAdjustmentSignatures = useMemo(
    () => compactProactiveAdjustmentSignatures([
      ...attemptedProactiveAdjustmentSignatures,
      ...compactProactiveAdjustmentSignatures(handledProactiveAdjustmentSignatures),
    ]),
    [attemptedProactiveAdjustmentSignatures, handledProactiveAdjustmentSignatures],
  );
  useEffect(() => {
    const incoming = compactProactiveAdjustmentSignatures(handledProactiveAdjustmentSignatures);
    if (!incoming.length) return;
    const missing = incoming.filter(sig => !attemptedProactiveAdjustmentSignatures.includes(sig));
    if (!missing.length) return;
    const next = compactProactiveAdjustmentSignatures([
      ...readProactiveAdjustmentAttempts(),
      ...attemptedProactiveAdjustmentSignatures,
      ...missing,
    ]);
    try {
      localStorage.setItem(PROACTIVE_ADJUSTMENT_ATTEMPT_KEY, JSON.stringify(next));
    } catch { /* private mode */ }
  }, [
    attemptedProactiveAdjustmentSignatures,
    handledProactiveAdjustmentSignatures,
  ]);
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
    if (proactiveAdjustment.signature && (generated || quiet)) markProactiveAdjustmentAttempted(proactiveAdjustment.signature);
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
    if (!proactiveAdjustment.autoEligible) return;
    if (proactiveAdjustment.autoQuieted) return;
    if (proactiveAdjustmentSnoozed) return;
    if (proactiveAutoPaused) return;
    if (allAttemptedProactiveAdjustmentSignatures.includes(proactiveAdjustment.signature)) return;
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
    allAttemptedProactiveAdjustmentSignatures,
    handleProactiveAdjustmentRequest,
    onProactiveTrainingAdjustmentRequest,
    proactiveAdjustment,
    proactiveAdjustmentLoading,
    proactiveAutoPaused,
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
    && (
      proactiveAdjustment.existingAction
      || (proactiveAdjustment.autoEligible && !proactiveAdjustment.autoQuieted)
    )
    && !proactiveAdjustmentSnoozed
    && !proactiveAutoPaused
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
  const showHeaderManualAdjustmentShortcut = !!(
    showManualAdjustmentShortcut
    && (
      proactiveAdjustment?.existingAction
      || (proactiveAdjustment?.autoEligible && !proactiveAdjustment?.autoQuieted)
      || proactiveAdjustmentLoading
    )
  );
  const handleStopProactiveAdjustment = useCallback(() => {
    onStopProactiveTrainingAdjustment?.();
    setConfirmManualAdjustment(false);
  }, [onStopProactiveTrainingAdjustment]);
  const closeManualAdjustmentConfirm = useCallback(() => {
    setConfirmManualAdjustment(false);
  }, []);
  const handleManualAdjustmentShortcut = useCallback(() => {
    if (proactiveAdjustmentLoading) {
      handleStopProactiveAdjustment();
      return;
    }
    if (proactiveAdjustment?.existingAction) {
      onOpenProactiveAction?.(proactiveAdjustment.existingAction);
      return;
    }
    setConfirmManualAdjustment(true);
  }, [
    handleStopProactiveAdjustment,
    onOpenProactiveAction,
    proactiveAdjustment,
    proactiveAdjustmentLoading,
  ]);
  const handleConfirmManualAdjustment = useCallback(async () => {
    await handleProactiveAdjustmentRequest();
    setConfirmManualAdjustment(false);
  }, [handleProactiveAdjustmentRequest]);
  const manualAdjustmentLabel = proactiveAdjustment?.existingAction
    ? t("coach.proactive_open")
    : proactiveAdjustmentLoading
      ? t("common.stop")
      : t("coach.proactive_manual");
  const manualAdjustmentHint = proactiveAdjustmentLoading
    ? t("common.stop")
    : proactiveAdjustment?.existingAction
    ? t("coach.proactive_open")
    : t("coach.proactive_manual_hint");
  const handleManualAdjustmentFromHub = useCallback(() => {
    handleManualAdjustmentShortcut();
  }, [handleManualAdjustmentShortcut]);
  const handleOpenRaceBriefingFromFocus = useCallback((action) => {
    setRaceBriefingAction(action);
  }, []);
  const handleRaceBriefingRequestFromFocus = useCallback((options) => {
    return handleRaceBriefingRequest(options);
  }, [handleRaceBriefingRequest]);
  const handleOpenRaceBriefingFromAgentActions = useCallback((action) => {
    setShowAgentActions(false);
    setShowCoachHub(false);
    setRaceBriefingAction(action);
  }, []);

  // (Removed the hourly weather auto-refresh timer: it burned Caiyun calls all
  // day for a runner sitting on this tab. The hook already refetches on tab
  // foreground / app resume, and the realtime cache TTL is now 3h — fresh
  // enough while avoiding unnecessary weather calls.)

  // Chat scroll container + the two floating jump buttons. The buttons live
  // inside the (sticky) message window so the provider pills above and the
  // input row below never move while the user scrolls messages.
  const chatScrollRef = useRef(null);
  const chatInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const [showJumpTop, setShowJumpTop] = useState(false);
  const [showJumpBottom, setShowJumpBottom] = useState(false);
  const hideJumpTimer = useRef(null);
  const scrollIdleTimer = useRef(null);
  const recentJumpPressRef = useRef({});
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

  // Do not read layout or set React state on every scroll tick. On 120Hz
  // Android screens that still means many forced measurements per second. Wait
  // for the drag/fling to settle, then decide whether the jump buttons are
  // needed.
  const onChatScroll = useCallback(() => {
    clearTimeout(scrollIdleTimer.current);
    scrollIdleTimer.current = setTimeout(() => {
      updateJumpButtons();
    }, 120);
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
  useEffect(() => () => {
    clearTimeout(hideJumpTimer.current);
    clearTimeout(scrollIdleTimer.current);
  }, []);

  useLayoutEffect(() => {
    if (!isMobile) return;
    const el = chatInputRef.current;
    if (!el) return;
    const active = typeof document !== "undefined" && document.activeElement === el;
    const selectionStart = active ? el.selectionStart : null;
    const selectionEnd = active ? el.selectionEnd : null;
    const selectionDirection = active ? el.selectionDirection : "none";
    const scrollTop = el.scrollTop;
    const minHeight = 32;
    const maxHeight = Math.round(13 * 1.35 * 7 + 18);
    const hasText = composerInput.trim().length > 0;
    el.style.height = `${minHeight}px`;
    if (hasText) {
      el.style.height = `${Math.min(Math.max(el.scrollHeight, minHeight), maxHeight)}px`;
    }
    const pendingSelection = pendingSelectionRestoreRef.current;
    pendingSelectionRestoreRef.current = null;
    if (active && !composerComposingRef.current) {
      const nextSelectionStart = pendingSelection ?? selectionStart;
      const nextSelectionEnd = pendingSelection ?? selectionEnd;
      try {
        if (nextSelectionStart != null && nextSelectionEnd != null) {
          el.setSelectionRange(nextSelectionStart, nextSelectionEnd, selectionDirection || "none");
        }
      } catch { /* selection can fail for some IME states */ }
      el.scrollTop = scrollTop;
    }
  }, [composerInput, isMobile]);

  async function handleImagePick(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    const slots = COACH_IMAGE_LIMIT - coachImages.length;
    if (slots <= 0) {
      appDialog.alert(t("coach.image_too_many", { count: COACH_IMAGE_LIMIT }));
      return;
    }
    const selected = files.slice(0, slots);
    try {
      const prepared = [];
      for (const file of selected) {
        // Sequential compression keeps memory predictable on mobile browsers.
        prepared.push(await prepareCoachImageAttachment(file));
      }
      setCoachImages(prev => [...prev, ...prepared]);
      if (files.length > slots) {
        appDialog.alert(t("coach.image_too_many", { count: COACH_IMAGE_LIMIT }));
      }
    } catch (err) {
      const code = err?.message || "";
      appDialog.alert(code === "image_too_large"
        ? t("coach.image_too_large")
        : t("coach.image_unsupported"));
    }
  }

  function removeCoachImage(index) {
    setCoachImages(prev => prev.filter((_, i) => i !== index));
  }

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
  async function acceptMemoryProposal(facts, stats = {}) {
    const safeFacts = Array.isArray(facts) ? facts : [];
    const actionId = memoryProposal?.action?.id || `memory-update-${Date.now()}`;
    const sourceSummary = memoryProposal?.action?.source === "nightly_memory_review" ? "Nightly Memory review" : "Memory auto-update";
    const factsToSave = safeFacts.map((fact, index) => ({
      ...fact,
      clientId: fact.clientId || fact.id || `memory-fact-${actionId}-${index}`,
      metadata: {
        ...(fact.metadata || {}),
        memoryActionId: fact.metadata?.memoryActionId || actionId,
        sourceMessageCount: Number(fact.metadata?.sourceMessageCount || memoryProposal?.action?.payload?.sourceMessageCount || 0),
      },
      source: fact.source || memoryProposal?.action?.source || "ai_coach_memory",
      sourceSummary: fact.sourceSummary || sourceSummary,
      status: "active",
    }));
    try {
      if (factsToSave.length && typeof saveMemoryFacts !== "function") {
        throw new Error("Memory facts save handler is unavailable");
      }
      const saveResult = await saveMemoryFacts(factsToSave, { replaceActiveSnapshot: true, returnSummary: true });
      const savedFacts = Array.isArray(saveResult) ? saveResult : (saveResult?.savedFacts || []);
      const archivedFactCount = Array.isArray(saveResult) ? 0 : (saveResult?.archivedFacts?.length || 0);
      if (factsToSave.length && (!Array.isArray(savedFacts) || savedFacts.length < factsToSave.length)) {
        throw new Error(`Only saved ${savedFacts?.length || 0} of ${factsToSave.length} Memory facts`);
      }
      if (memoryProposal?.action) {
        const nextAction = recordMemoryActionDecision
          ? recordMemoryActionDecision(memoryProposal.action, AGENT_ACTION_STATUS.EXECUTED, {
              savedLanguages: ["facts"],
              savedCharacterCount: {
                en: factsToSave.reduce((sum, fact) => sum + String(fact.contentEn || "").length, 0),
                zh: factsToSave.reduce((sum, fact) => sum + String(fact.contentZh || "").length, 0),
              },
              savedFactCount: savedFacts.length,
              archivedFactCount,
              reviewedChangeCount: Number(stats.reviewedChangeCount || 0),
              unchangedFactCount: Number(stats.unchangedFactCount || 0),
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

  function setStyle(id)        { patchCoachConfig({ style: id }); }
  function setOutputLength(id) { patchCoachConfig({ outputLength: id }); }
  function setIntervention(id) { patchCoachConfig({ intervention: id }); }
  const setShowCalendarButton = useCallback((v) => {
    patchCoachConfig({ showCalendarButton: v });
  }, [patchCoachConfig]);
  function setNightlyMemoryReview(v) { patchCoachConfig({ nightlyMemoryReview: v }); }
  function setTrainingPreferences(next) {
    patchCoachConfig({ trainingPreferences: normalizeTrainingPreferences(next) });
  }
  const pressCalendarButtonSetting = useCallback((key, enabled, event) => {
    if (event.pointerType === "mouse") return;
    recentCalendarButtonPressRef.current.set(key, event.timeStamp || 0);
    event.preventDefault?.();
    setShowCalendarButton(enabled);
  }, [setShowCalendarButton]);
  const clickCalendarButtonSetting = useCallback((key, enabled, event) => {
    const at = event.timeStamp || 0;
    const recentAt = recentCalendarButtonPressRef.current.get(key) || 0;
    if (recentAt && at - recentAt < 750) {
      event.preventDefault?.();
      return;
    }
    setShowCalendarButton(enabled);
  }, [setShowCalendarButton]);

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
    if (!hasDefaultLocation) out.push("location");
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
    const userMsg = composerInput.trim();
    const attachments = coachImages;
    if ((!userMsg && !attachments.length) || chatLoading || contextCompressing) return;
    let seen = true;
    try { seen = !!localStorage.getItem(HINTS_FLAG); } catch { /* private mode */ }
    if (!seen && !attachments.length) {
      const hints = computeCoachHints();
      if (hints.length) { setCoachHints({ msg: userMsg, hints }); return; }
      markHintsSeen();
    }
    syncComposerInput("");
    setCoachImages([]);
    const sent = await sendChat(userMsg || t("coach.image_only_message"), { imageAttachments: attachments });
    if (!sent) {
      syncComposerInput(userMsg);
      if (attachments.length) setCoachImages(attachments);
    }
  }

  const dismissCoachHints = useCallback(() => {
    markHintsSeen();
    setCoachHintsPending?.(null);
    setCoachHints(null);
  }, [setCoachHintsPending]);
  const proceedCoachHints = useCallback(() => {
    if (!coachHints) return;
    markHintsSeen();
    const message = coachHints.msg;
    setCoachHintsPending?.(null);
    setCoachHints(null);
    syncComposerInput("");
    sendChat(message);
  }, [coachHints, sendChat, setCoachHintsPending, syncComposerInput]);
  const jumpFromCoachHints = useCallback((action) => {
    if (!coachHints) return;
    setCoachHintsPending?.(coachHints.msg);
    setCoachHints(null);
    action?.();
  }, [coachHints, setCoachHintsPending]);
  const coachHintMeta = useMemo(() => ({
    config:   { text: t("coach.hint_config"),   jump: () => jumpFromCoachHints(() => setShowCoachConfig(true)) },
    workouts: { text: t("coach.hint_workouts"), jump: () => jumpFromCoachHints(() => onGoToTraining?.()) },
    races:    { text: t("coach.hint_races"),    jump: () => jumpFromCoachHints(() => onGoToRaces?.()) },
    location: { text: t("coach.hint_location"), jump: () => jumpFromCoachHints(() => onOpenLocationSettings?.()) },
  }), [jumpFromCoachHints, onGoToRaces, onGoToTraining, onOpenLocationSettings, t]);

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
  const hasCoachImageAttachments = coachImages.length > 0;
  const canSubmitCoachMessage = !contextCompressing && (composerInput.trim().length > 0 || hasCoachImageAttachments);
  // Weather pill value + state. When location is missing, the pill opens the
  // AI Coach location panel so the user can set the weather place in-context.
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
  const hasDefaultLocation = hasValidCoords(defaultLocation);
  const locationCity = cityFromLocation(defaultLocation);
  const locationLabel = cityAbbreviationFromLocation(defaultLocation, lang);
  const runnerLastSeenIso = codexRunnerStatus?.last_seen_at || null;
  const runnerAge = runnerAgeMs(runnerLastSeenIso, runnerNowMs);
  const runnerFreshMs = Number(codexRunnerStatus?.fresh_ms) || 12_000;
  const runnerStaleMs = Number(codexRunnerStatus?.stale_ms) || 8_000;
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
  const countTokens = preciseTextTokenCounter || estimateTextTokens;
  const baseContextUsage = useMemo(() => {
    let systemTokens;
    try {
      const dataBlock = buildDataBlock({
        logs,
        races,
        now,
        lang: "en",
        currentWeather: weatherCtx?.currentWeather || null,
        forecastByDate: weatherCtx?.forecastByDate || null,
        dailyNotes,
        agentActions,
        memoryFacts,
      });
      const systemPrompt = buildSystemPrompt({
        profile,
        coachConfig,
        dataBlock,
        lang: "en",
      });
      systemTokens = countTokens(systemPrompt);
    } catch {
      systemTokens = COACH_CONTEXT_FIXED_OVERHEAD_TOKENS;
    }
    const historyTokens = chatMessages.reduce((sum, m) => (
      sum + countTokens(`[${m.role || "user"}]\n${messageContentForCoach(m.content)}`)
    ), 0);
    return { systemTokens, historyTokens };
  }, [agentActions, chatMessages, coachConfig, countTokens, dailyNotes, logs, memoryFacts, now, profile, races, weatherCtx]);
  const contextUsage = useMemo(() => {
    const draft = String(deferredComposerInput || "").trim();
    const draftTokens = draft ? countTokens(`[user]\n${draft}`) : 0;
    const imageTokens = Math.max(0, coachImages.length) * COACH_IMAGE_ESTIMATE_TOKENS;
    const usedTokens = Math.max(0, Math.round(
      baseContextUsage.systemTokens
      + baseContextUsage.historyTokens
      + draftTokens
      + imageTokens
      + COACH_CONTEXT_FIXED_OVERHEAD_TOKENS
    ));
    const remainingTokens = Math.max(0, COACH_CONTEXT_WINDOW_TOKENS - usedTokens);
    const ratio = Math.min(1, usedTokens / COACH_CONTEXT_WINDOW_TOKENS);
    return {
      usedTokens,
      remainingTokens,
      totalTokens: COACH_CONTEXT_WINDOW_TOKENS,
      ratio,
      usedLabel: formatTokenK(usedTokens),
      remainingLabel: formatTokenK(remainingTokens),
      totalLabel: formatTokenK(COACH_CONTEXT_WINDOW_TOKENS),
      nearLimit: remainingTokens <= COACH_CONTEXT_WARN_REMAINING_TOKENS,
    };
  }, [baseContextUsage, coachImages.length, countTokens, deferredComposerInput]);
  const contextUsageAccent = contextUsage.nearLimit
    ? "var(--danger)"
    : contextUsage.ratio >= 0.75
      ? "var(--warn)"
      : "var(--moss)";
  const closeContextUsagePopover = useCallback(() => {
    setShowContextUsage(false);
  }, []);
  const updateContextUsagePopoverPosition = useCallback(() => {
    const rect = contextUsageButtonRef.current?.getBoundingClientRect?.();
    if (!rect || typeof window === "undefined") return;
    const viewportWidth = window.innerWidth || 360;
    const viewportHeight = window.innerHeight || 640;
    const width = Math.min(286, Math.max(240, viewportWidth - 32));
    const safeLeftMax = Math.max(16, viewportWidth - width - 16);
    const left = Math.min(Math.max(16, rect.right - width), safeLeftMax);
    const estimatedHeight = 128;
    const belowTop = rect.bottom + 8;
    const top = belowTop + estimatedHeight <= viewportHeight - 12
      ? belowTop
      : Math.max(12, rect.top - estimatedHeight - 8);
    setContextUsagePopoverPosition({ top, left, width });
  }, []);
  const toggleContextUsagePopover = useCallback(() => {
    if (!showContextUsage) updateContextUsagePopoverPosition();
    setShowContextUsage(v => !v);
  }, [showContextUsage, updateContextUsagePopoverPosition]);
  const pressContextUsagePopover = useCallback((event) => {
    if (event.pointerType === "mouse") return;
    contextUsagePointerAtRef.current = event.timeStamp || 0;
    event.preventDefault?.();
    toggleContextUsagePopover();
  }, [toggleContextUsagePopover]);
  const clickContextUsagePopover = useCallback((event) => {
    const at = event.timeStamp || 0;
    if (contextUsagePointerAtRef.current && at - contextUsagePointerAtRef.current < 750) {
      event.preventDefault?.();
      return;
    }
    toggleContextUsagePopover();
  }, [toggleContextUsagePopover]);
  useLayoutEffect(() => {
    if (!showContextUsage) return undefined;
    updateContextUsagePopoverPosition();
    window.addEventListener("resize", updateContextUsagePopoverPosition);
    window.addEventListener("scroll", updateContextUsagePopoverPosition, true);
    return () => {
      window.removeEventListener("resize", updateContextUsagePopoverPosition);
      window.removeEventListener("scroll", updateContextUsagePopoverPosition, true);
    };
  }, [showContextUsage, updateContextUsagePopoverPosition]);
  useEffect(() => {
    if (!showContextUsage) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") closeContextUsagePopover();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeContextUsagePopover, showContextUsage]);
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
                <button {...instantPress("coach-config-close", () => setShowCoachConfig(false))} style={s.modalCloseBtn} aria-label="Close">×</button>
              </div>
              <div style={{ ...s.muted, marginBottom: 16, lineHeight: 1.5 }}>{t("coach.behavior_hint")}</div>
              <CoachConfigDropdowns
                coachConfig={coachConfig}
                onStyle={setStyle}
                onOutputLength={setOutputLength}
                onIntervention={setIntervention}
                t={t}
              />
            </div>
          </div>
        </ModalRoot>
      )}

      {showTrainingPreferences && (
        <ModalRoot onClose={() => setShowTrainingPreferences(false)}>
          <div style={s.modalOverlay(isMobile, { float: true })} onClick={() => setShowTrainingPreferences(false)}>
            <div
              style={{
                ...s.modalCard(isMobile, { maxWidth: 720, float: true }),
                maxHeight: isMobile ? "min(94dvh, 760px)" : "min(88vh, 760px)",
                overflowY: "auto",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: isMobile ? 4 : 8 }}>
                <h2 style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 18, fontWeight: 500, margin: 0 }}>
                  <span>{t("coach.training_preferences")}</span>
                  <TrainingPreferenceHintIcon t={t} />
                </h2>
                <button {...instantPress("coach-training-preferences-close", () => setShowTrainingPreferences(false))} style={s.modalCloseBtn} aria-label="Close">×</button>
              </div>
              <TrainingPreferenceEditor
                value={coachConfig.trainingPreferences}
                onChange={setTrainingPreferences}
                t={t}
                isMobile={isMobile}
              />
            </div>
          </div>
        </ModalRoot>
      )}

      {showCoachFocus && (
        <ModalRoot onClose={() => setShowCoachFocus(false)}>
          <div style={s.modalOverlay(isMobile, { float: true })} onClick={() => setShowCoachFocus(false)}>
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                ...s.modalCard(isMobile, { maxWidth: 620, float: true }),
                maxHeight: isMobile ? "min(82dvh, 680px)" : "min(82vh, 720px)",
                overflowY: "auto",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <h2 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>{t("coach.current_focus")}</h2>
                <button {...instantPress("coach-focus-close", () => setShowCoachFocus(false))} style={s.modalCloseBtn} aria-label="Close">×</button>
              </div>
              <CoachFocusPanel
                races={races}
                logs={logs}
                now={now}
                planDeviationSummary={planDeviationSummary}
                recoveryGuardSummary={recoveryGuardSummary}
                proactiveAdjustment={proactiveAdjustment}
                proactiveAdjustmentLoading={proactiveAdjustmentLoading}
                showManualAdjustmentShortcut={showManualAdjustmentShortcut}
                manualAdjustmentLabel={manualAdjustmentLabel}
                handleManualAdjustmentFromHub={handleManualAdjustmentFromHub}
                raceBriefing={raceBriefing}
                raceBriefingLoading={raceBriefingLoading}
                onOpenRaceBriefing={handleOpenRaceBriefingFromFocus}
                onRaceBriefingRequest={handleRaceBriefingRequestFromFocus}
                t={t}
                lang={lang}
              />
            </div>
          </div>
        </ModalRoot>
      )}

      {/* Calendar button toggle — separate modal opened from Advanced settings.
          Pulled out of Coach Preferences because it's a display
          preference, not a behavior knob about the coach itself. */}
      {showCalendarSettings && (
        <ModalRoot onClose={() => setShowCalendarSettings(false)}>
          <div style={s.modalOverlay(isMobile, { float: true })} onClick={() => setShowCalendarSettings(false)}>
            <div style={s.modalCard(isMobile, { maxWidth: 600, float: true })} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <h2 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>{t("coach.calendar_btn_label")}</h2>
                <button {...instantPress("coach-calendar-settings-close", () => setShowCalendarSettings(false))} style={s.modalCloseBtn} aria-label="Close">×</button>
              </div>
              <div style={{ ...s.muted, marginBottom: 16, lineHeight: 1.5 }}>{t("coach.calendar_btn_hint")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  onPointerDown={(event) => pressCalendarButtonSetting("coach-calendar-button-on-mobile", true, event)}
                  onClick={(event) => clickCalendarButtonSetting("coach-calendar-button-on-mobile", true, event)}
                  style={{ ...s.chip(coachConfig.showCalendarButton !== false), padding: "10px 14px", width: "100%", textAlign: "center", touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                >
                  {t("coach.calendar_btn_on")}
                </button>
                <button
                  onPointerDown={(event) => pressCalendarButtonSetting("coach-calendar-button-off-mobile", false, event)}
                  onClick={(event) => clickCalendarButtonSetting("coach-calendar-button-off-mobile", false, event)}
                  style={{ ...s.chip(coachConfig.showCalendarButton === false), padding: "10px 14px", width: "100%", textAlign: "center", touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                >
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
                <button {...instantPress("coach-agent-actions-close", () => setShowAgentActions(false))} style={s.modalCloseBtn} aria-label="Close">×</button>
              </div>
              <RecentAgentActions
                actions={agentActions}
                t={t}
                onDelete={onDeleteAgentAction}
                onOpenRaceBriefing={handleOpenRaceBriefingFromAgentActions}
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

      {showMemory && (
        <ModalRoot onClose={() => setShowMemory(false)}>
          <div style={s.modalOverlay(isMobile)} onClick={() => setShowMemory(false)}>
            <div
              className="ultreia-scroll-stable ultreia-no-motion-surface"
              style={{
              ...s.modalCard(isMobile, { maxWidth: 860 }),
              maxWidth: isMobile ? "none" : 860,
              ...(!isMobile ? {
                height: "calc(100dvh - 40px)",
                maxHeight: "calc(100dvh - 40px)",
                margin: "0 auto",
              } : {}),
            }} onClick={(e) => e.stopPropagation()}>
              <div style={{ marginBottom: 8 }}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}>
                  <h2 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>{t("coach.memory_title")}</h2>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                    {!memoryProposal && (
                      <button {...instantPress("coach-memory-update-mobile", proposeMemoryUpdate)}
                        disabled={memoryUpdating || chatMessages.length === 0}
                        style={{ ...s.btnGhost, minHeight: 0, fontSize: 12, padding: "6px 10px", opacity: (memoryUpdating || chatMessages.length === 0) ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 6, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}>
                        {memoryUpdating && <Spinner size={11} thickness={1.4} />}
                        {memoryUpdating ? t("coach.memory_updating") : t("coach.memory_auto_update")}
                      </button>
                    )}
                    <button {...instantPress("coach-memory-close", () => setShowMemory(false))} style={s.modalCloseBtn} aria-label="Close">×</button>
                  </div>
                </div>
                <div style={{ ...s.muted, marginTop: 6, lineHeight: 1.35, fontSize: 12 }}>{t("coach.memory_hint")}</div>
              </div>
              <MemoryReviewSetting
                enabled={coachConfig.nightlyMemoryReview === true}
                onToggle={setNightlyMemoryReview}
                t={t}
              />
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
                  onDelete={onMemoryFactDelete}
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
                <div style={{ marginLeft: "auto" }}>
                  <PromptLangSwitch value={previewLang} onChange={setPreviewLang} />
                </div>
                <button {...instantPress("coach-prompt-preview-close", () => setShowPromptPreview(false))} style={s.modalCloseBtn} aria-label="Close">×</button>
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

      {confirmManualAdjustment && (
        <ModalRoot onClose={closeManualAdjustmentConfirm}>
          <div
            style={{ ...s.modalOverlay(isMobile, { float: true }), zIndex: 10010 }}
            onClick={closeManualAdjustmentConfirm}
          >
            <div
              style={{
                ...s.modalCard(isMobile, { maxWidth: 460, bg: "oklch(0.132 0.009 145)", float: true }),
                background: "linear-gradient(180deg, oklch(0.18 0.011 145), oklch(0.132 0.009 145))",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                <h2 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>{t("coach.proactive_confirm_title")}</h2>
                <button
                  type="button"
                  onClick={closeManualAdjustmentConfirm}
                  style={s.modalCloseBtn}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div style={{ ...s.muted, lineHeight: 1.55, marginBottom: 16 }}>
                {t("coach.proactive_confirm_body")}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  {...instantPress("coach-manual-adjustment-confirm", proactiveAdjustmentLoading ? handleStopProactiveAdjustment : handleConfirmManualAdjustment)}
                  style={{
                    ...s.btn,
                    minWidth: 112,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 7,
                    background: proactiveAdjustmentLoading ? "var(--warn)" : undefined,
                    borderColor: proactiveAdjustmentLoading ? "var(--warn)" : undefined,
                  }}
                >
                  {proactiveAdjustmentLoading && <Spinner size={12} thickness={1.5} />}
                  {proactiveAdjustmentLoading ? t("common.stop") : t("coach.proactive_confirm_primary")}
                </button>
              </div>
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
        <button
          ref={contextUsageButtonRef}
          type="button"
          onPointerDown={pressContextUsagePopover}
          onClick={clickContextUsagePopover}
          title={providerTitle}
          aria-expanded={showContextUsage}
          aria-controls="coach-context-usage-popover"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            minHeight: 26, padding: "4px 9px",
            border: "1px solid var(--rule)", borderRadius: 2,
            background: "var(--bg-elevated)", color: "var(--ink-2)",
            fontSize: 11, fontFamily: "var(--font-sans)",
            whiteSpace: "nowrap", cursor: "pointer",
            flex: "0 0 auto",
            touchAction: "manipulation",
            WebkitTapHighlightColor: "transparent",
          }}>
          <span style={{ color: "var(--moss)", display: "inline-flex" }}><CoachIcon size={12} /></span>
          {!isMobile && <span style={{ color: "var(--ink-3)" }}>Model</span>}
          <span style={{ color: "var(--ink-1)", fontWeight: 600 }}>{displayProviderLabel}</span>
          <span aria-hidden="true" style={{
            width: 14,
            height: 14,
            borderRadius: 999,
            background: `conic-gradient(${contextUsageAccent} ${Math.round(contextUsage.ratio * 360)}deg, var(--panel-3) 0deg)`,
            boxShadow: "inset 0 0 0 1px var(--rule)",
            display: "inline-block",
            position: "relative",
          }}>
            <span style={{
              position: "absolute",
              inset: 4,
              borderRadius: 999,
              background: "var(--bg-elevated)",
            }} />
          </span>
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
          <button {...instantPress("coach-weather-location-missing", onOpenLocationSettings)}
            title={lang === 'zh' ? '点击设置默认位置' : 'Click to set a default location'}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              minHeight: 26, padding: "4px 9px",
              border: "1px solid var(--warn)", borderRadius: 2,
              background: "rgba(181,78,26,0.08)", color: "var(--warn)",
              fontSize: 11, fontFamily: "var(--font-sans)",
              cursor: "pointer", whiteSpace: "nowrap",
              touchAction: "manipulation", WebkitTapHighlightColor: "transparent",
            }}>
            <span>☁</span>
            <span style={{ fontWeight: 600 }}>{weatherLabel}</span>
          </button>
        ) : onGoToWeather ? (
          <button type="button" {...instantPress("coach-weather-pill", onGoToWeather)}
            title={lang === "zh" ? "查看日历天气" : "View weather on the calendar"}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              minHeight: 26, padding: "4px 9px",
              border: "1px solid var(--rule)", borderRadius: 2,
              background: weatherActive ? "var(--bg-elevated)" : "var(--bg)",
              color: weatherActive ? "var(--ink-2)" : "var(--ink-3)",
              fontSize: 11, fontFamily: "var(--font-sans)",
              cursor: "pointer", whiteSpace: "nowrap", touchAction: "manipulation", WebkitTapHighlightColor: "transparent",
            }}>
            <span style={{ color: weatherActive ? "var(--moss)" : "var(--ink-3)" }}>☁</span>
            {!isMobile && <span style={{ color: "var(--ink-3)" }}>Weather</span>}
            <span style={{ color: weatherActive ? "var(--ink-1)" : "var(--ink-3)", fontWeight: 600 }}>{weatherLabel}</span>
          </button>
        ) : statusPill(<span>☁</span>, "Weather", weatherLabel, weatherActive, isMobile)}

        {onOpenLocationSettings && (
          <button type="button" {...instantPress("coach-location-settings", onOpenLocationSettings)}
            title={hasDefaultLocation
              ? (lang === "zh" ? `天气城市：${locationCity || defaultLocation?.name || ""}；点开查看具体地点` : `Weather city: ${locationCity || defaultLocation?.name || ""}; open for details`)
              : (lang === "zh" ? "设置天气默认地点" : "Set default weather location")}
            aria-label={lang === "zh" ? "设置天气默认地点" : "Set default weather location"}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              minHeight: 26, padding: "4px 9px",
              border: `1px solid ${hasDefaultLocation ? "var(--rule)" : "var(--warn)"}`,
              borderRadius: 2,
              background: hasDefaultLocation ? "var(--bg-elevated)" : "rgba(181,78,26,0.08)",
              color: hasDefaultLocation ? "var(--ink-2)" : "var(--warn)",
              fontSize: 11, fontFamily: "var(--font-sans)",
              cursor: "pointer", whiteSpace: "nowrap", touchAction: "manipulation", WebkitTapHighlightColor: "transparent",
              flex: "0 0 auto",
            }}>
            <span style={{ color: hasDefaultLocation ? "var(--moss)" : "var(--warn)", display: "inline-flex" }}>
              <PinIcon size={12} />
            </span>
            <span style={{ color: hasDefaultLocation ? "var(--ink-1)" : "var(--warn)", fontWeight: 600 }}>
              {locationLabel}
            </span>
          </button>
        )}

        <span style={{ flex: 1, minWidth: 6 }} />
        {!isMobile && showHeaderManualAdjustmentShortcut && (
          <button
            type="button"
            {...instantPress("coach-manual-adjustment-shortcut", handleManualAdjustmentShortcut)}
            title={manualAdjustmentHint}
            style={{
              ...s.btnGhost,
              minHeight: 26,
              padding: "4px 9px",
              fontSize: 11,
              whiteSpace: "nowrap",
              flex: "0 0 auto",
              color: proactiveAdjustmentLoading ? "var(--warn)" : undefined,
              borderColor: proactiveAdjustmentLoading ? "var(--warn)" : undefined,
              cursor: "pointer",
            }}>
            {manualAdjustmentLabel}
          </button>
        )}
        {onOpenInbox && (
          <button {...instantPress("coach-open-inbox", onOpenInbox)} title={weeklyReportLoading ? t("weekly_report.thinking") : t("inbox.title")} aria-label={weeklyReportLoading ? t("weekly_report.thinking") : t("inbox.title")}
            style={{
              position: "relative",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              minHeight: 26, width: 34, padding: 0,
              border: weeklyReportLoading ? "1px solid var(--accent)" : "1px solid var(--rule)",
              borderRadius: 2,
              background: weeklyReportLoading ? "var(--accent-soft)" : "var(--bg-elevated)",
              color: weeklyReportLoading ? "var(--accent-dark)" : "var(--ink-2)",
              boxShadow: weeklyReportLoading ? "0 0 0 1px oklch(0.54 0.055 138 / 0.12), 0 0 18px oklch(0.38 0.060 138 / 0.18)" : "none",
              cursor: "pointer", touchAction: "manipulation", WebkitTapHighlightColor: "transparent",
            }}>
            <MailIcon size={15} />
            {weeklyReportLoading && (
              <span style={{
                position: "absolute",
                right: -5,
                top: -5,
                background: "var(--bg)",
                borderRadius: 8,
                lineHeight: 0,
              }}>
                <Spinner size={10} thickness={1.4} color="var(--accent)" />
              </span>
            )}
            {inboxUnread > 0 && (
              <span style={{
                position: "absolute", top: -6, right: weeklyReportLoading ? 7 : -6,
                minWidth: 16, height: 16, padding: "0 4px", boxSizing: "border-box",
                borderRadius: 8, background: "var(--warn)", color: "var(--bg-deep)",
                fontSize: 9, fontWeight: 700, lineHeight: "16px", textAlign: "center",
                fontFamily: "var(--font-mono)",
              }}>{inboxUnread > 99 ? "99+" : inboxUnread}</span>
            )}
          </button>
        )}
        {isMobile && (
          <button {...instantPress("coach-mobile-menu-open", () => setShowCoachMenu(true))} aria-label={t("coach.menu_open")}
            style={{
              position: "relative",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              minHeight: 26, width: 34, padding: 0,
              border: "1px solid var(--rule)", borderRadius: 2,
              background: "var(--bg-elevated)", color: "var(--ink-2)",
              cursor: "pointer", touchAction: "manipulation", WebkitTapHighlightColor: "transparent",
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
      {showContextUsage && (
        <ModalRoot onClose={closeContextUsagePopover}>
          <div
            onPointerDown={closeContextUsagePopover}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 9999,
              background: "transparent",
              WebkitTapHighlightColor: "transparent",
            }}>
            <div
              id="coach-context-usage-popover"
              role="dialog"
              aria-label={t("coach.context_used")}
              onPointerDown={(event) => event.stopPropagation()}
              style={{
                position: "fixed",
                top: contextUsagePopoverPosition?.top ?? 64,
                left: contextUsagePopoverPosition?.left ?? 16,
                width: contextUsagePopoverPosition?.width ?? "calc(100vw - 32px)",
                maxWidth: "calc(100vw - 32px)",
                boxSizing: "border-box",
                padding: "9px 11px",
                border: "1px solid var(--rule)",
                borderRadius: 8,
                background: "var(--bg-elevated)",
                color: "var(--ink-2)",
                display: "grid",
                gap: 6,
                boxShadow: "0 8px 8px oklch(0.04 0.006 274 / 0.22)",
              }}>
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                fontSize: 12,
                fontFamily: "var(--font-sans)",
              }}>
                <span style={{ color: "var(--ink-3)" }}>{t("coach.context_used")}</span>
                <span style={{ color: "var(--ink-1)", fontWeight: 650, fontFamily: "var(--font-mono)" }}>
                  ≈ {contextUsage.usedLabel} / {contextUsage.totalLabel}
                </span>
              </div>
              <div style={{
                height: 5,
                borderRadius: 999,
                background: "var(--bg-sunken)",
                overflow: "hidden",
              }}>
                <div style={{
                  width: `${Math.min(100, Math.round(contextUsage.ratio * 100))}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: contextUsageAccent,
                }} />
              </div>
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                fontSize: 12,
                fontFamily: "var(--font-sans)",
              }}>
                <span style={{ color: "var(--ink-3)" }}>{t("coach.context_remaining")}</span>
                <span style={{ color: contextUsage.nearLimit ? "var(--danger)" : "var(--ink-1)", fontWeight: 650, fontFamily: "var(--font-mono)" }}>
                  ≈ {contextUsage.remainingLabel}
                </span>
              </div>
            </div>
          </div>
        </ModalRoot>
      )}
      {/* Soft hint once estimated context usage approaches the safe limit. Two states:
          • EXPANDED (default) — full banner with the "consider distilling
            to memory" explanation + Open Memory button + ✕ dismiss
          • COLLAPSED — single-line chip that still nudges the user but
            doesn't take vertical real estate; tap to re-expand.
          Per-session state so the chip reappears full-size on next page
          load when context usage is still high. */}
      {contextUsage.nearLimit && !showMemory && (
        longChatHintCollapsed ? (
          <button
            {...instantPress("long-chat-expand", () => setLongChatHintCollapsed(false))}
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
            <span>{t("coach.long_chat_chip", { used: contextUsage.usedLabel, total: contextUsage.totalLabel })}</span>
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
              {t("coach.long_chat_hint", { used: contextUsage.usedLabel, total: contextUsage.totalLabel, remaining: contextUsage.remainingLabel })}
            </div>
            <button
              {...instantPress("long-chat-open-memory", () => setShowMemory(true))}
              style={{ ...s.btnGhost, fontSize: 12, padding: "5px 10px", flexShrink: 0 }}>
              {t("coach.long_chat_action")}
            </button>
            {/* Clear chat right from the nudge. The confirm dialog reminds the
                user to distill Memory first (see ConfirmDeleteModal chat body). */}
            <button {...instantPress("long-chat-clear-chat", clearChat)}
              style={{ ...s.btnGhost, fontSize: 12, padding: "5px 10px", flexShrink: 0, color: "var(--danger)", borderColor: "var(--danger)", touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}>
              {t("coach.clear_chat")}
            </button>
            <button
              {...instantPress("long-chat-collapse", () => setLongChatHintCollapsed(true))}
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
                {...instantPress("proactive-open-existing", () => onOpenProactiveAction?.(proactiveAdjustment.existingAction))}
                style={{
                  ...s.btn,
                  fontSize: 12,
                  padding: "6px 10px",
                  touchAction: "manipulation",
                  WebkitTapHighlightColor: "transparent",
                }}>
                {t("coach.proactive_open")}
              </button>
            ) : (
              <button
                type="button"
                {...instantPress("proactive-manual-adjustment-shortcut", handleManualAdjustmentShortcut)}
                style={{
                  ...s.btn,
                  fontSize: 12,
                  padding: "6px 10px",
                  background: proactiveAdjustmentLoading ? "var(--warn)" : undefined,
                  borderColor: proactiveAdjustmentLoading ? "var(--warn)" : undefined,
                  cursor: "pointer",
                }}>
                {proactiveAdjustmentLoading ? t("common.stop") : t("coach.proactive_retry")}
              </button>
            )}
            <button
              type="button"
              {...instantPress("proactive-dismiss", handleProactiveAdjustmentDismiss)}
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
                {...instantPress("race-briefing-open-existing-banner", () => setRaceBriefingAction(raceBriefing.existingAction))}
                style={{
                  ...s.btn,
                  fontSize: 12,
                  padding: "6px 10px",
                  touchAction: "manipulation",
                  WebkitTapHighlightColor: "transparent",
                }}>
                {t("coach.race_briefing_open")}
              </button>
            ) : (
              <button
                type="button"
                {...instantPress("race-briefing-generate-banner", () => handleRaceBriefingRequest())}
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
              {...instantPress("race-briefing-dismiss", handleRaceBriefingDismiss)}
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
      <div ref={chatScrollRef} onScroll={onChatScroll} className="ultreia-scroll-stable" data-mobile-vertical-scroll="true" style={{
        ...s.card,
        marginBottom: 0,
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        overscrollBehaviorX: "auto",
        overscrollBehaviorY: "contain",
        WebkitOverflowScrolling: "touch",
        touchAction: "pan-x pan-y",
        contain: "layout paint",
        ...(isMobile ? {
          background: "var(--bg-elevated)",
          backdropFilter: "none",
          WebkitBackdropFilter: "none",
          boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.035)",
        } : {}),
      }}>
        <CoachChatMessages
          chatMessages={chatMessages}
          isMobile={isMobile}
          mdComponents={mdComponents}
          lang={lang}
          t={t}
          showCalendarButton={coachConfig.showCalendarButton !== false}
          importToCalendar={importToCalendar}
          chatLoading={chatLoading}
          sendChat={sendChat}
          extractingForMsgId={extractingForMsgId}
          hasPlanImportCache={hasPlanImportCache}
          getPlanImportActionStatus={getPlanImportActionStatus}
          onStopExtraction={onStopExtraction}
        />
      </div>

      {/* Jump to oldest — shows once the user scrolls down into history. */}
      {showJumpTop && chatMessages.length > 0 && (
        <button
          onPointerDown={(event) => {
            if (event.pointerType === "mouse") return;
            recentJumpPressRef.current.top = event.timeStamp || 0;
            event.preventDefault?.();
            scrollToTop();
          }}
          onClick={(event) => {
            const recentAt = recentJumpPressRef.current.top || 0;
            const at = event.timeStamp || 0;
            if (recentAt && at - recentAt < 750) {
              event.preventDefault?.();
              return;
            }
            scrollToTop();
          }}
          aria-label={lang === "zh" ? "回到顶部" : "Jump to top"}
          style={jumpBtnStyle("top")}>↑</button>
      )}
      {/* Jump to latest — shows when scrolled up away from the newest message. */}
      {showJumpBottom && chatMessages.length > 0 && (
        <button
          onPointerDown={(event) => {
            if (event.pointerType === "mouse") return;
            recentJumpPressRef.current.bottom = event.timeStamp || 0;
            event.preventDefault?.();
            scrollToBottom("smooth");
          }}
          onClick={(event) => {
            const recentAt = recentJumpPressRef.current.bottom || 0;
            const at = event.timeStamp || 0;
            if (recentAt && at - recentAt < 750) {
              event.preventDefault?.();
              return;
            }
            scrollToBottom("smooth");
          }}
          aria-label={lang === "zh" ? "回到最新" : "Jump to latest"}
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
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/*"
          multiple
          onChange={handleImagePick}
          style={{ display: "none" }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          {hasCoachImageAttachments && (
            <div style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginBottom: 6,
            }}>
              {coachImages.map((img, idx) => (
                <div key={`${img.name}-${idx}`} style={{
                  position: "relative",
                  width: 48,
                  height: 48,
                  borderRadius: 6,
                  overflow: "hidden",
                  border: "1px solid var(--rule)",
                  background: "var(--bg-elevated)",
                  flexShrink: 0,
                }}>
                  <img
                    src={img.dataUrl}
                    alt={img.name}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                  <button
                    type="button"
                    onClick={() => removeCoachImage(idx)}
                    aria-label={t("coach.image_remove")}
                    title={t("coach.image_remove")}
                    style={{
                      position: "absolute",
                      top: 3,
                      right: 3,
                      width: 18,
                      height: 18,
                      minWidth: 0,
                      minHeight: 0,
                      padding: 0,
                      borderRadius: 9,
                      border: "1px solid rgba(255,255,255,0.28)",
                      background: "rgba(0,0,0,0.62)",
                      color: "#fff",
                      fontSize: 13,
                      lineHeight: 1,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={chatInputRef}
            rows={isMobile ? 1 : 9}
            value={composerInput}
            onChange={handleComposerInputChange}
            onFocus={() => { composerFocusedRef.current = true; }}
            onBlur={() => {
              composerFocusedRef.current = false;
              lastParentDraftWriteRef.current = composerInputRef.current;
              setChatInput?.(composerInputRef.current);
            }}
            onCompositionStart={() => { composerComposingRef.current = true; }}
            onCompositionEnd={(event) => {
              composerComposingRef.current = false;
              handleComposerInputChange(event);
            }}
            onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSend(); }}
            disabled={contextCompressing}
            style={{
              ...coachComposerInputStyle({ isMobile }),
              opacity: contextCompressing ? 0.62 : undefined,
            }} />
        </div>
        {isMobile ? (
          <>
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={chatLoading || contextCompressing || coachImages.length >= COACH_IMAGE_LIMIT}
              aria-label={t("coach.attach_image")}
              title={t("coach.attach_image")}
              style={coachComposerIconButtonStyle({ disabled: chatLoading || contextCompressing || coachImages.length >= COACH_IMAGE_LIMIT })}>
              <ImageIcon size={15} />
            </button>
            <button onClick={chatLoading ? onStopChat : handleSend} disabled={contextCompressing || (!chatLoading && !canSubmitCoachMessage)}
              aria-label={chatLoading ? t("coach.stop_generating") : t("coach.send")}
              style={coachComposerSendButtonStyle({ disabled: contextCompressing || (!chatLoading && !canSubmitCoachMessage) })}>
              {chatLoading ? "×" : "⏎"}
            </button>
          </>
        ) : (
          // Desktop: ⚙ stacked above Send in a slim column, mirroring mobile.
          // ⚙ opens the unified hub modal (vertical tabs on left, content on right).
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0, width: 84 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <button {...instantPress("coach-desktop-hub-open", () => { setCoachHubTab("config"); setShowCoachHub(true); })} aria-label={t("coach.menu_open")}
                style={{ ...s.btnGhost, padding: "8px 0", fontSize: 13, lineHeight: 1.2, minWidth: 0, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}>
                ⚙{memoryReady ? " ●" : ""}
              </button>
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={chatLoading || contextCompressing || coachImages.length >= COACH_IMAGE_LIMIT}
                aria-label={t("coach.attach_image")}
                title={t("coach.attach_image")}
                style={{
                  ...s.btnGhost,
                  padding: "8px 0",
                  minWidth: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: (chatLoading || contextCompressing || coachImages.length >= COACH_IMAGE_LIMIT) ? 0.45 : 1,
                }}>
                <ImageIcon size={14} />
              </button>
            </div>
            <button onClick={chatLoading ? onStopChat : handleSend} disabled={contextCompressing || (!chatLoading && !canSubmitCoachMessage)}
              style={{
                ...s.btn, padding: "10px 20px",
                opacity: (contextCompressing || (!chatLoading && !canSubmitCoachMessage)) ? 0.5 : 1,
                flex: 1,
              }}>
              {contextCompressing ? t("coach.context_compressing_short") : chatLoading ? t("common.stop") : t("coach.send")}
            </button>
          </div>
        )}
      </div>
      </>)}

      {/* MOBILE settings — bottom sheet. Daily-use controls stay first; internal
          diagnostics and destructive actions sit behind Advanced. */}
      {coachHints && (
          <ModalRoot onClose={dismissCoachHints}>
            <div onClick={dismissCoachHints} className="ultreia-overlay-in" style={{
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
                      <span style={{ flex: 1, fontSize: 13, lineHeight: 1.5, color: "var(--ink-1)" }}>{coachHintMeta[id].text}</span>
                      <button {...instantPress(`coach-hint-jump-${id}`, coachHintMeta[id].jump)} style={{ ...s.btnGhost, fontSize: 12, padding: "6px 12px", minHeight: 0, flexShrink: 0, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}>
                        {t("coach.hint_go")}
                      </button>
                    </div>
                  ))}
                </div>
                <button onClick={proceedCoachHints} style={{ ...s.btn, width: "100%" }}>
                  {t("coach.hints_proceed")}
                </button>
              </div>
            </div>
          </ModalRoot>
      )}

      {showCoachMenu && isMobile && (() => {
        // pick: close the menu then act — for items that navigate away (edit
        // profile) or are destructive (clear chat).
        const pick = (fn) => { setShowCoachMenu(false); fn(); };
        // openSub: KEEP the menu open and open a sub-modal on top of it (the menu
        // sits at a lower z-index, below). Closing the sub returns to the menu.
        const openSub = (fn) => { fn(); };
        const row = (label, onClick, { badge = false, danger = false, muted = false } = {}) => (
          <button {...instantPress(`coach-menu-${label}`, onClick)} style={{
            display: "flex", alignItems: "center", width: "100%", textAlign: "left",
            background: "transparent", border: "none",
            borderTop: "1px solid var(--rule-soft)",
            padding: "13px 16px", minHeight: 50,
            fontFamily: "var(--font-sans)", fontSize: 15,
            color: danger ? "var(--danger)" : muted ? "var(--ink-2)" : "var(--ink-1)",
            cursor: "pointer", borderRadius: 0,
            touchAction: "manipulation", WebkitTapHighlightColor: "transparent",
          }}>
            <span style={{ flex: 1 }}>{label}{badge ? <span style={{ color: "var(--moss)", marginLeft: 6 }}>●</span> : null}</span>
            <span style={{ color: "var(--ink-3)", fontSize: 15 }}>›</span>
          </button>
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
                  <button {...instantPress("coach-menu-close", () => setShowCoachMenu(false))} style={{ ...s.modalCloseBtn, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }} aria-label="Close">×</button>
                </div>

                {row(t("coach.current_focus"), () => openSub(() => setShowCoachFocus(true)))}
                {row(t("coach.show_config"), () => openSub(() => setShowCoachConfig(true)))}
                {row(t("coach.training_preferences"), () => openSub(() => setShowTrainingPreferences(true)))}
                {row(t("coach.show_memory"), () => openSub(() => setShowMemory(true)), { badge: memoryReady })}
                {row(t("coach.recent_agent_actions"), () => openSub(() => setShowAgentActions(true)))}

                <button
                  type="button"
                  {...instantPress("coach-menu-advanced", () => setCoachAdvancedOpen(open => !open))}
                  style={{
                    display: "flex", alignItems: "center", width: "100%", textAlign: "left",
                    background: "transparent", border: "none", borderTop: "1px solid var(--rule-soft)",
                    padding: "13px 16px", minHeight: 50,
                    fontFamily: "var(--font-sans)", fontSize: 15, color: "var(--ink-2)",
                    cursor: "pointer", borderRadius: 0,
                    touchAction: "manipulation", WebkitTapHighlightColor: "transparent",
                  }}>
                  <span style={{ flex: 1 }}>{t("coach.group_advanced")}</span>
                  <span style={{ color: "var(--ink-3)", fontSize: 15 }}>{coachAdvancedOpen ? "⌃" : "⌄"}</span>
                </button>
                {coachAdvancedOpen && (
                  <div>
                    {row(t("coach.preview_prompt"), () => openSub(() => setShowPromptPreview(true)), { muted: true })}
                    {row(t("coach.calendar_btn_label"), () => openSub(() => setShowCalendarSettings(true)), { muted: true })}
                    {chatMessages.length > 0 && row(t("coach.clear_chat"), () => pick(clearChat), { danger: true })}
                  </div>
                )}
              </div>
            </div>
          </ModalRoot>
        );
      })()}

      {/* Desktop unified settings hub. Keep daily-use controls first; internal
          diagnostics and destructive actions sit in Advanced. */}
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
                <button {...instantPress("coach-hub-close", () => setShowCoachHub(false))} style={{ ...s.modalCloseBtn, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }} aria-label="Close">×</button>
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
                    { items: [
                      { id: "focus", label: t("coach.current_focus") },
                      { id: "config", label: t("coach.show_config") },
                      { id: "trainingPrefs", label: t("coach.training_preferences") },
                      { id: "memory", label: t("coach.show_memory") + (memoryReady ? " ●" : "") },
                      { id: "actions", label: t("coach.recent_agent_actions") },
                    ] },
                    { header: t("coach.group_advanced"), items: [
                      { id: "prompt", label: t("coach.preview_prompt"), muted: true },
                      { id: "calendar", label: t("coach.calendar_btn_label"), muted: true },
                      { id: "matrix", label: t("coach.action_matrix_title"), muted: true },
                      { id: "clear", label: t("coach.clear_chat"), muted: true, danger: true },
                    ] },
                  ].filter(group => group.items.length > 0).map((group, gi) => (
                    <div key={group.header || `group-${gi}`}>
                      {group.header && (
                        <div style={{
                          padding: gi === 0 ? "2px 14px 6px" : "14px 14px 6px",
                          fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)",
                          textTransform: "uppercase", letterSpacing: "0.06em",
                        }}>{group.header}</div>
                      )}
                      {group.items.map(tab => {
                        const active = coachHubTab === tab.id;
                        return (
                          <button key={tab.id}
                            {...instantPress(`coach-hub-tab-${tab.id}`, () => setCoachHubTab(tab.id))}
                            style={{
                              textAlign: "left", width: "calc(100% - 16px)",
                              margin: "0 8px 3px",
                              background: active ? "var(--bg-elevated)" : "transparent",
                              border: active ? "1px solid var(--rule)" : "1px solid transparent",
                              padding: "9px 10px",
                              fontFamily: "var(--font-sans)",
                              fontSize: 13,
                              fontWeight: active ? 600 : 500,
                              color: active ? "var(--ink-1)" : tab.danger ? "var(--danger)" : tab.muted ? "var(--ink-3)" : "var(--ink-2)",
                              cursor: "pointer", borderRadius: 6,
                              touchAction: "manipulation", WebkitTapHighlightColor: "transparent",
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
                  {coachHubTab === "focus" && (
                    <CoachFocusPanel
                      races={races}
                      logs={logs}
                      now={now}
                      planDeviationSummary={planDeviationSummary}
                      recoveryGuardSummary={recoveryGuardSummary}
                      proactiveAdjustment={proactiveAdjustment}
                      proactiveAdjustmentLoading={proactiveAdjustmentLoading}
                      showManualAdjustmentShortcut={showManualAdjustmentShortcut}
                      manualAdjustmentLabel={manualAdjustmentLabel}
                      handleManualAdjustmentFromHub={handleManualAdjustmentFromHub}
                      raceBriefing={raceBriefing}
                      raceBriefingLoading={raceBriefingLoading}
                      onOpenRaceBriefing={handleOpenRaceBriefingFromFocus}
                      onRaceBriefingRequest={handleRaceBriefingRequestFromFocus}
                      t={t}
                      lang={lang}
                    />
                  )}

                  {coachHubTab === "config" && (
                    <div>
                      <div style={{ ...s.muted, marginBottom: 16, lineHeight: 1.5 }}>{t("coach.behavior_hint")}</div>
                      <CoachConfigDropdowns
                        coachConfig={coachConfig}
                        onStyle={setStyle}
                        onOutputLength={setOutputLength}
                        onIntervention={setIntervention}
                        t={t}
                      />
                    </div>
                  )}

                  {coachHubTab === "trainingPrefs" && (
                    <TrainingPreferenceEditor
                      value={coachConfig.trainingPreferences}
                      onChange={setTrainingPreferences}
                      t={t}
                      isMobile={false}
                    />
                  )}

                  {coachHubTab === "calendar" && (
                    <div>
                      <div style={{ ...s.muted, marginBottom: 14, lineHeight: 1.6 }}>{t("coach.calendar_btn_hint")}</div>
                      <div style={{ ...s.label, marginBottom: 6 }}>{t("coach.calendar_btn_label")}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          onPointerDown={(event) => pressCalendarButtonSetting("coach-calendar-button-on-desktop", true, event)}
                          onClick={(event) => clickCalendarButtonSetting("coach-calendar-button-on-desktop", true, event)}
                          style={{ ...s.chip(coachConfig.showCalendarButton !== false), touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                        >
                          {t("coach.calendar_btn_on")}
                        </button>
                        <button
                          onPointerDown={(event) => pressCalendarButtonSetting("coach-calendar-button-off-desktop", false, event)}
                          onClick={(event) => clickCalendarButtonSetting("coach-calendar-button-off-desktop", false, event)}
                          style={{ ...s.chip(coachConfig.showCalendarButton === false), touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                        >
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
                      onOpenRaceBriefing={handleOpenRaceBriefingFromAgentActions}
                      onAskCoach={(action) => {
                        sendChat?.(buildAgentActionFollowUpMessage(action, t, lang));
                        setShowCoachHub(false);
                      }}
                    />
                  )}

                  {coachHubTab === "adjust" && (
                    <div>
                      <div style={{ ...s.muted, marginBottom: 14, lineHeight: 1.6 }}>
                        {t("coach.proactive_manual_hint")}
                      </div>
                      <button
                        type="button"
                        {...instantPress("coach-hub-manual-adjustment", handleManualAdjustmentFromHub)}
                        disabled={!showManualAdjustmentShortcut}
                        style={{
                          ...s.btn,
                          background: proactiveAdjustmentLoading ? "var(--warn)" : undefined,
                          borderColor: proactiveAdjustmentLoading ? "var(--warn)" : undefined,
                          opacity: !showManualAdjustmentShortcut ? 0.65 : 1,
                          cursor: !showManualAdjustmentShortcut ? "default" : "pointer",
                        }}>
                        {manualAdjustmentLabel}
                      </button>
                    </div>
                  )}

                  {coachHubTab === "matrix" && (
                    <CoachActionMatrix matrix={COACH_ACTION_MATRIX} lang={lang} t={t} />
                  )}

                  {coachHubTab === "memory" && (
                    <div>
                      <div style={{ marginBottom: 14 }}>
                        {!memoryProposal && (
                          <button {...instantPress("coach-memory-update-desktop", proposeMemoryUpdate)}
                            disabled={memoryUpdating || chatMessages.length === 0}
                            style={{ ...s.btnGhost, minHeight: 0, fontSize: 12, padding: "6px 10px", opacity: (memoryUpdating || chatMessages.length === 0) ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 6, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}>
                            {memoryUpdating && <Spinner size={11} thickness={1.4} />}
                            {memoryUpdating ? t("coach.memory_updating") : t("coach.memory_auto_update")}
                          </button>
                        )}
                        <div style={{ ...s.muted, lineHeight: 1.35, fontSize: 12, marginTop: 8 }}>{t("coach.memory_hint")}</div>
                      </div>
                      <MemoryReviewSetting
                        enabled={coachConfig.nightlyMemoryReview === true}
                        onToggle={setNightlyMemoryReview}
                        t={t}
                      />
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
                          onDelete={onMemoryFactDelete}
                          t={t}
                        />
                      )}
                    </div>
                  )}

                  {coachHubTab === "prompt" && (
                    <div>
                      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                        <PromptLangSwitch value={previewLang} onChange={setPreviewLang} />
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
                      <button {...instantPress("coach-hub-clear-chat-confirm", () => { setShowCoachHub(false); clearChat(); })}
                        disabled={chatMessages.length === 0}
                        style={{ ...s.btn, background: "var(--danger)", borderColor: "var(--danger)", color: "var(--ink-inv)", opacity: chatMessages.length === 0 ? 0.4 : 1, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}>
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

function CoachConfigDropdowns({ coachConfig, onStyle, onOutputLength, onIntervention, t }) {
  const rowStyle = {
    display: "grid",
    gridTemplateColumns: "minmax(96px, 0.42fr) minmax(0, 1fr)",
    gap: 12,
    alignItems: "center",
    marginBottom: 12,
  };
  const triggerStyle = {
    minHeight: 38,
    borderRadius: 6,
    background: "var(--bg-elevated)",
    fontSize: 13,
  };
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <div style={rowStyle}>
        <div style={{ ...s.label, margin: 0 }}>{t("coach.style")}</div>
        <Dropdown
          options={COACH_STYLES.map(o => ({ value: o.id, label: t(`enum.coach.${o.id}`) }))}
          value={coachConfig.style || DEFAULT_COACH_CONFIG.style}
          onChange={onStyle}
          ariaLabel={t("coach.style")}
          triggerStyle={triggerStyle}
        />
      </div>
      <div style={rowStyle}>
        <div style={{ ...s.label, margin: 0 }}>{t("coach.length")}</div>
        <Dropdown
          options={OUTPUT_LENGTHS.map(o => ({ value: o.id, label: t(`enum.length.${o.id}`) }))}
          value={coachConfig.outputLength || DEFAULT_COACH_CONFIG.outputLength}
          onChange={onOutputLength}
          ariaLabel={t("coach.length")}
          triggerStyle={triggerStyle}
        />
      </div>
      <div style={{ ...rowStyle, marginBottom: 0 }}>
        <div style={{ ...s.label, margin: 0 }}>{t("coach.intervention")}</div>
        <Dropdown
          options={INTERVENTION_LEVELS.map(o => ({ value: o.id, label: t(`enum.intervention.${o.id}`) }))}
          value={coachConfig.intervention || DEFAULT_COACH_CONFIG.intervention}
          onChange={onIntervention}
          ariaLabel={t("coach.intervention")}
          triggerStyle={triggerStyle}
        />
      </div>
    </div>
  );
}

function TrainingPreferenceEditor({ value, onChange, t, isMobile }) {
  const instantPress = useInstantPress();
  const prefs = normalizeTrainingPreferences(value);
  const template = prefs.weeklyTemplate || {};
  const slotLabels = {
    am: t("calendar.plan_tod_am"),
    pm: t("calendar.plan_tod_pm"),
  };
  const options = [
    { value: "", label: t("coach.training_preferences_unset") },
    ...TRAINING_PREFERENCE_OPTIONS.map(option => ({
      value: option.id,
      label: t(`enum.training_pref.${option.id}`),
    })),
  ];
  const write = (day, slot, text) => {
    const nextTemplate = {};
    for (const dayId of TRAINING_PREFERENCE_DAYS) {
      const source = template[String(dayId)] || {};
      const nextDay = {};
      for (const slotId of TRAINING_PREFERENCE_SLOTS) {
        const current = dayId === day && slotId === slot ? text : source[slotId];
        const clean = String(current || "").trim();
        if (clean) nextDay[slotId] = clean;
      }
      if (Object.keys(nextDay).length) nextTemplate[String(dayId)] = nextDay;
    }
    onChange?.({ weeklyTemplate: nextTemplate });
  };
  const clearAll = () => onChange?.({ weeklyTemplate: {} });

  return (
    <div style={{ display: "grid", gap: isMobile ? 6 : 12 }}>
      <div style={{ display: "grid", gap: isMobile ? 0 : 8 }}>
        {TRAINING_PREFERENCE_DAYS.map(day => {
          const dayPrefs = template[String(day)] || {};
          return (
            <div
              key={day}
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "52px minmax(0, 1fr) minmax(0, 1fr)" : "74px minmax(0, 1fr) minmax(0, 1fr)",
                columnGap: isMobile ? 6 : 10,
                rowGap: isMobile ? 3 : 6,
                alignItems: "center",
                padding: isMobile ? "4px 0" : "8px 0",
                borderTop: "1px solid var(--rule-soft)",
              }}
            >
              <div style={{ ...s.label, margin: 0, color: "var(--ink-2)" }}>
                {t(`weekly_settings.day_${day}`)}
              </div>
              {TRAINING_PREFERENCE_SLOTS.map(slot => (
                <label
                  key={slot}
                  style={{
                    display: "grid",
                    gap: isMobile ? 3 : 4,
                    minWidth: 0,
                  }}
                  >
                  <span style={{ fontSize: 10.5, color: "var(--ink-3)", lineHeight: 1.1 }}>
                    {slotLabels[slot]}
                  </span>
                  <Dropdown
                    options={options}
                    value={dayPrefs[slot] || ""}
                    onChange={next => write(day, slot, next)}
                    placeholder={t("coach.training_preferences_unset")}
                    ariaLabel={`${t(`weekly_settings.day_${day}`)} ${slotLabels[slot]}`}
                    triggerStyle={{
                      minHeight: isMobile ? 30 : 38,
                      padding: isMobile ? "5px 8px" : "8px 10px",
                      fontSize: isMobile ? 12.5 : 13,
                      lineHeight: 1.35,
                    }}
                  />
                </label>
              ))}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          {...instantPress("training-preferences-clear", clearAll)}
          style={{ ...s.btnGhost, minHeight: 0, padding: "7px 11px", fontSize: 12, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
        >
          {t("coach.training_preferences_clear")}
        </button>
      </div>
    </div>
  );
}

function TrainingPreferenceHintIcon({ t }) {
  return (
    <span
      title={t("coach.training_preferences_hint")}
      aria-label={t("coach.training_preferences_hint")}
      role="img"
      style={{
        width: 18,
        height: 18,
        borderRadius: 999,
        border: "1px solid var(--rule)",
        color: "var(--ink-3)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      !
    </span>
  );
}

function CoachFocusPanel({
  races = [],
  logs = [],
  now = new Date(),
  planDeviationSummary = null,
  recoveryGuardSummary = null,
  proactiveAdjustment = null,
  proactiveAdjustmentLoading = false,
  showManualAdjustmentShortcut = false,
  manualAdjustmentLabel = "",
  handleManualAdjustmentFromHub,
  raceBriefing = null,
  raceBriefingLoading = false,
  onOpenRaceBriefing,
  onRaceBriefingRequest,
  t,
  lang = "zh",
}) {
  const nextRace = getNextCoachTargetRace(races, now);
  const nextPlan = getNextCoachPlan(logs, now);
  const raceName = nextRace?.name || t("coach.race_briefing_target");
  const raceMeta = nextRace ? [
    nextRace.date,
    nextRace.priority ? t("coach.focus_priority", { priority: nextRace.priority }) : "",
    [nextRace.category, nextRace.subtype].filter(Boolean).join(" / "),
  ].filter(Boolean).join(" · ") : "";
  const longTermTitle = nextRace
    ? t("coach.focus_target_race", { name: raceName })
    : t("coach.focus_target_none");
  const longTermMeta = nextRace
    ? [t("coach.focus_days_to_race", { days: nextRace.daysToRace }), raceMeta].filter(Boolean).join(" · ")
    : t("coach.focus_target_none_hint");
  const inRaceWindow = !!nextRace && nextRace.daysToRace <= 14;
  const shortTermTitle = inRaceWindow
    ? t("coach.focus_training_race_window")
    : nextPlan
      ? t("coach.focus_training_next_plan")
      : nextRace
        ? t("coach.focus_training_build_target")
        : t("coach.focus_training_data");
  const shortTermMeta = inRaceWindow
    ? t("coach.focus_training_race_window_meta")
    : nextPlan
      ? formatCoachFocusPlan(nextPlan, t, lang)
      : nextRace
        ? t("coach.focus_training_build_target_meta")
        : t("coach.focus_training_data_meta");
  const watchItems = buildCoachFocusWatchItems({
    planDeviationSummary,
    recoveryGuardSummary,
    proactiveAdjustment,
    raceBriefing,
    t,
  });
  const canRequestBriefing = !!(
    raceBriefing
    && !raceBriefing.existingAction
    && typeof onRaceBriefingRequest === "function"
  );
  const instantPress = useInstantPress();

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ ...s.muted, lineHeight: 1.55, marginBottom: 2 }}>{t("coach.current_focus_hint")}</div>

      <CoachFocusBlock
        title={t("coach.focus_long_term")}
        value={longTermTitle}
        meta={longTermMeta}
      />
      <CoachFocusBlock
        title={t("coach.focus_short_term")}
        value={shortTermTitle}
        meta={shortTermMeta}
      />

      <div style={coachFocusBlockStyle}>
        <div style={coachFocusLabelStyle}>{t("coach.focus_watchlist")}</div>
        <div style={{ display: "grid", gap: 7 }}>
          {watchItems.length ? watchItems.map(item => (
            <div key={item.key} style={{
              display: "grid",
              gridTemplateColumns: "minmax(96px, 0.36fr) 1fr",
              gap: 8,
              alignItems: "start",
              borderTop: "1px solid var(--rule-soft)",
              paddingTop: 7,
            }}>
              <div style={{
                fontSize: 11,
                color: item.tone === "warn" ? "var(--warn)" : "var(--ink-3)",
                fontWeight: 650,
                lineHeight: 1.35,
              }}>{item.label}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "var(--ink-1)", lineHeight: 1.4 }}>{item.value}</div>
                {item.note && <div style={{ marginTop: 2, fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.45 }}>{item.note}</div>}
              </div>
            </div>
          )) : (
            <div style={{ borderTop: "1px solid var(--rule-soft)", paddingTop: 7, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.45 }}>
              {t("coach.focus_stable")}
            </div>
          )}
        </div>
      </div>

      <div style={coachFocusBlockStyle}>
        <div style={coachFocusLabelStyle}>{t("coach.focus_next_action")}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            {...instantPress("focus-manual-adjustment", handleManualAdjustmentFromHub)}
            disabled={!showManualAdjustmentShortcut}
            style={{
              ...s.btn,
              minHeight: 0,
              fontSize: 12,
              padding: "7px 11px",
              background: proactiveAdjustmentLoading ? "var(--warn)" : undefined,
              borderColor: proactiveAdjustmentLoading ? "var(--warn)" : undefined,
              opacity: !showManualAdjustmentShortcut ? 0.55 : 1,
              cursor: !showManualAdjustmentShortcut ? "default" : "pointer",
            }}
          >
            {showManualAdjustmentShortcut ? manualAdjustmentLabel : t("coach.focus_no_adjustment")}
          </button>

          {raceBriefing && (
            raceBriefing.existingAction ? (
              <button
                type="button"
                {...instantPress("focus-open-race-briefing", () => onOpenRaceBriefing?.(raceBriefing.existingAction))}
                style={{ ...s.btnGhost, minHeight: 0, fontSize: 12, padding: "7px 11px", touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
              >
                {t("coach.race_briefing_open")}
              </button>
            ) : (
              <button
                type="button"
                {...instantPress("focus-race-briefing-generate", () => onRaceBriefingRequest?.())}
                disabled={!canRequestBriefing || raceBriefingLoading}
                style={{
                  ...s.btnGhost,
                  minHeight: 0,
                  fontSize: 12,
                  padding: "7px 11px",
                  opacity: !canRequestBriefing || raceBriefingLoading ? 0.55 : 1,
                  cursor: !canRequestBriefing || raceBriefingLoading ? "default" : "pointer",
                }}
              >
                {raceBriefingLoading ? t("coach.race_briefing_generating") : t("coach.race_briefing_generate")}
              </button>
            )
          )}
        </div>
        <div style={{ marginTop: 7, fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.45 }}>
          {t("coach.focus_next_action_hint")}
        </div>
        <div style={{ marginTop: 5, fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.45 }}>
          {t("coach.focus_edit_hint")}
        </div>
      </div>
    </div>
  );
}

function CoachFocusBlock({ title, value, meta }) {
  return (
    <div style={coachFocusBlockStyle}>
      <div style={coachFocusLabelStyle}>{title}</div>
      <div style={{ fontSize: 15, fontWeight: 650, color: "var(--ink-1)", lineHeight: 1.35 }}>{value}</div>
      {meta && <div style={{ marginTop: 4, fontSize: 12, color: "var(--ink-3)", lineHeight: 1.45 }}>{meta}</div>}
    </div>
  );
}

const coachFocusBlockStyle = {
  border: "1px solid var(--rule-soft)",
  borderRadius: 6,
  background: "var(--paper-2)",
  padding: "10px 11px",
};

const coachFocusLabelStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  color: "var(--ink-3)",
  textTransform: "uppercase",
  letterSpacing: 0,
  marginBottom: 6,
};

function buildCoachFocusWatchItems({
  planDeviationSummary = null,
  recoveryGuardSummary = null,
  proactiveAdjustment = null,
  raceBriefing = null,
  t,
}) {
  const items = [];
  if (planDeviationSummary?.affectedCount > 0) {
    const missed = Number(planDeviationSummary.missedCount || 0);
    const partial = Number(planDeviationSummary.partialCount || 0);
    items.push({
      key: "plan-deviation",
      label: t("coach.focus_plan_deviation"),
      value: t("coach.focus_plan_deviation_value", {
        count: planDeviationSummary.affectedCount,
        missed,
        partial,
      }),
      note: proactiveAdjustment?.autoEligible
        ? t("coach.focus_auto_candidate")
        : t("coach.focus_manual_candidate"),
      tone: proactiveAdjustment?.autoEligible ? "warn" : "muted",
    });
  }
  if (recoveryGuardSummary?.signalCount > 0) {
    const hard = Number(recoveryGuardSummary.hardFuturePlanCount || 0);
    const severity = String(recoveryGuardSummary.severity || "");
    const elevated = severity === "high" || severity === "danger";
    items.push({
      key: "recovery",
      label: t("coach.focus_recovery_guard"),
      value: t("coach.focus_recovery_guard_value", {
        count: recoveryGuardSummary.signalCount,
        hard,
      }),
      note: elevated ? t("coach.focus_recovery_elevated") : t("coach.focus_recovery_light"),
      tone: elevated ? "warn" : "muted",
    });
  }
  if (raceBriefing) {
    items.push({
      key: "race-briefing",
      label: t("coach.focus_race_briefing"),
      value: raceBriefing.existingAction
        ? t("coach.focus_race_briefing_ready")
        : t("coach.focus_race_briefing_window", { days: raceBriefing.daysToRace ?? "-" }),
      note: t("coach.focus_race_briefing_note"),
      tone: raceBriefing.existingAction ? "muted" : "warn",
    });
  }
  return items;
}

function getNextCoachTargetRace(races = [], now = new Date()) {
  const todayMs = coachFocusDateMs(coachFocusDateKey(now));
  if (todayMs == null) return null;
  return (Array.isArray(races) ? races : [])
    .filter(race => race?.isTarget && race.date)
    .map(race => {
      const raceMs = coachFocusDateMs(race.date);
      if (raceMs == null) return null;
      return {
        ...race,
        daysToRace: Math.round((raceMs - todayMs) / (24 * 60 * 60 * 1000)),
      };
    })
    .filter(Boolean)
    .filter(race => race.daysToRace >= 0)
    .sort((a, b) => {
      const byDate = (a.date || "").localeCompare(b.date || "");
      if (byDate) return byDate;
      return racePriorityRank(a.priority) - racePriorityRank(b.priority);
    })[0] || null;
}

function getNextCoachPlan(logs = [], now = new Date()) {
  const today = coachFocusDateKey(now);
  return (Array.isArray(logs) ? logs : [])
    .filter(log => log?.isPlanned && log.date && log.date >= today && log.planStatus !== "done")
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))[0] || null;
}

function formatCoachFocusPlan(plan, t, lang = "zh") {
  if (!plan) return "";
  const date = formatCoachFocusDate(plan.date, lang);
  const type = plan.type ? t(`enum.activity.${plan.type}`) : "";
  const subTypes = Array.isArray(plan.subTypes) ? plan.subTypes : [];
  const subTypeText = subTypes.map(st => t(`enum.subtype.${st}`)).filter(Boolean).join(" / ");
  const distance = Number(plan.distance || 0);
  const ascent = Number(plan.ascent || 0);
  const durationMin = Math.round(Number(plan.duration || 0) / 60) || 0;
  const bits = [date, type, subTypeText].filter(Boolean);
  if (distance > 0) bits.push(`${formatCompactNumber(distance)} km`);
  if (ascent > 0) bits.push(`+${Math.round(ascent)} m`);
  if (durationMin > 0) bits.push(`${durationMin} ${t("form.minutes")}`);
  if (plan.planDetail?.keySession) bits.push(t("calendar.plan_key_session_short"));
  return bits.join(" · ");
}

function formatCoachFocusDate(dateKey, lang = "zh") {
  if (!dateKey) return "";
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  if (lang === "zh") {
    return `${date.getMonth() + 1}.${date.getDate()}`;
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function racePriorityRank(priority) {
  if (priority === "A") return 0;
  if (priority === "B") return 1;
  if (priority === "C") return 2;
  return 3;
}

function coachFocusDateKey(d = new Date()) {
  const date = d instanceof Date ? d : new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function coachFocusDateMs(dateKey) {
  const ms = new Date(`${dateKey}T00:00:00`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function MemoryReviewSetting({ enabled, onToggle, t }) {
  const instantPress = useInstantPress();
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
        {...instantPress("memory-review-toggle", () => onToggle?.(!enabled))}
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
          touchAction: "manipulation",
          WebkitTapHighlightColor: "transparent",
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

function MemoryFactsPanel({ facts = [], displayLang = "en", onStatus, onDelete, t }) {
  const appDialog = useAppDialog();
  const instantPress = useInstantPress();
  const [view, setView] = useState("current");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [expandedCategories, setExpandedCategories] = useState(() => new Set());
  const baseFacts = useMemo(() => {
    const statuses = view === "archived" ? ["archived"] : ["active", "proposed"];
    return [...(facts || [])]
      .filter(f => statuses.includes(f?.status || "active"))
      .sort((a, b) => {
        const statusRank = (status) => status === "proposed" ? 0 : 1;
        const byStatus = statusRank(a.status) - statusRank(b.status);
        if (byStatus) return byStatus;
        return String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
      });
  }, [facts, view]);
  const categorySummary = useMemo(() => {
    const counts = new Map();
    for (const fact of baseFacts) {
      const category = fact.category || "other";
      counts.set(category, (counts.get(category) || 0) + 1);
    }
    return sortMemoryCategoryEntries([...counts.entries()]);
  }, [baseFacts]);
  const categoryExists = categorySummary.some(([category]) => category === categoryFilter);
  const selectedCategory = categoryFilter === "all" || categoryExists ? categoryFilter : "all";
  const visibleFacts = useMemo(() => {
    return selectedCategory === "all"
      ? baseFacts
      : baseFacts.filter(fact => (fact.category || "other") === selectedCategory);
  }, [baseFacts, selectedCategory]);
  const categoryOptions = useMemo(() => {
    if (!baseFacts.length) return [];
    return [["all", baseFacts.length], ...categorySummary];
  }, [baseFacts.length, categorySummary]);
  const groupedCategories = useMemo(() => (
    groupMemoryFactsByCategory(visibleFacts, displayLang, t)
  ), [visibleFacts, displayLang, t]);
  function toggleCategoryExpanded(category) {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
          <div style={{ ...s.label, margin: 0 }}>{t("coach.memory_facts_title")}</div>
          <div style={{ color: "var(--ink-3)", fontSize: 11, whiteSpace: "nowrap" }}>{t("coach.memory_facts_count", { count: visibleFacts.length })}</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {["current", "archived"].map(option => {
            const selected = view === option;
            return (
              <button
                key={option}
                type="button"
                {...instantPress(`memory-facts-view-${option}`, () => setView(option))}
                style={{
                  ...memoryFactFilterButtonStyle,
                  background: selected ? "var(--ink-1)" : "transparent",
                  color: selected ? "var(--paper)" : "var(--ink-2)",
                  borderColor: selected ? "var(--ink-1)" : "var(--rule)",
                  touchAction: "manipulation",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {t(`coach.memory_facts_filter_${option}`)}
              </button>
            );
          })}
        </div>
      </div>
      {categoryOptions.length > 0 && (
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 8 }}>
          {categoryOptions.map(([category, count]) => {
            const selected = selectedCategory === category;
            return (
              <button
                key={category}
                type="button"
                {...instantPress(`memory-facts-category-${category}`, () => setCategoryFilter(category))}
                style={{
                  ...memoryFactCategoryChipStyle,
                  background: selected ? "var(--ink-1)" : "var(--bg-elevated)",
                  color: selected ? "var(--paper)" : "var(--ink-2)",
                  borderColor: selected ? "var(--ink-1)" : "var(--rule)",
                  touchAction: "manipulation",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {t(`coach.memory_fact_category_${category}`)} · {count}
              </button>
            );
          })}
        </div>
      )}
      <div style={{ ...s.muted, fontSize: 11, lineHeight: 1.45, marginBottom: 8 }}>
        {t("coach.memory_facts_hint")}
      </div>
      {!visibleFacts.length ? (
        <div style={detailEmptyStyle}>
          {view === "archived" ? t("coach.memory_facts_archived_empty") : t("coach.memory_facts_empty")}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 7 }}>
          {groupedCategories.map(group => (
            <MemoryFactCategorySection
              key={group.category}
              group={group}
              expanded={expandedCategories.has(group.category) || group.hasProposed}
              onToggle={() => toggleCategoryExpanded(group.category)}
              displayLang={displayLang}
              onStatus={onStatus}
              onDelete={onDelete}
              t={t}
              appDialog={appDialog}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const MEMORY_CATEGORY_ORDER = new Map(MEMORY_SECTIONS.map((section, index) => [section.key, index]));

function sortMemoryCategoryEntries(entries) {
  return [...entries].sort((a, b) => {
    const byOrder = (MEMORY_CATEGORY_ORDER.get(a[0]) ?? 99) - (MEMORY_CATEGORY_ORDER.get(b[0]) ?? 99);
    if (byOrder) return byOrder;
    return String(a[0]).localeCompare(String(b[0]));
  });
}

function getMemoryFactText(fact, displayLang) {
  return displayLang === "zh"
    ? (fact.contentZh || fact.contentEn || "-")
    : (fact.contentEn || fact.contentZh || "-");
}

function normalizeMemorySummaryText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[。.!！?？;；,，]+$/g, "")
    .trim()
    .toLowerCase();
}

function cleanMemorySummaryText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[。.!！?？;；]+$/g, "")
    .trim();
}

function buildMemoryCategorySummary(texts, displayLang, t) {
  const cleaned = texts.map(cleanMemorySummaryText).filter(Boolean);
  if (!cleaned.length) return t("coach.memory_category_summary_empty");
  const shown = cleaned.slice(0, 4);
  const joiner = displayLang === "zh" ? "；" : "; ";
  let summary = shown.join(joiner);
  if (summary && displayLang === "zh") summary = `${summary}。`;
  else if (summary && !/[.!?]$/.test(summary)) summary = `${summary}.`;
  const remaining = cleaned.length - shown.length;
  if (remaining > 0) {
    summary = `${summary} ${t("coach.memory_category_summary_more", { count: remaining })}`;
  }
  return summary;
}

function groupMemoryFactsByCategory(facts, displayLang, t) {
  const groups = new Map();
  for (const fact of facts) {
    const category = fact.category || "other";
    if (!groups.has(category)) {
      groups.set(category, { category, facts: [], texts: [], textKeys: new Set(), hasProposed: false });
    }
    const group = groups.get(category);
    group.facts.push(fact);
    if (fact.status === "proposed") group.hasProposed = true;
    const text = getMemoryFactText(fact, displayLang);
    const key = normalizeMemorySummaryText(text);
    if (key && !group.textKeys.has(key)) {
      group.textKeys.add(key);
      group.texts.push(text);
    }
  }
  return sortMemoryCategoryEntries([...groups.entries()]).map(([, group]) => ({
    category: group.category,
    facts: group.facts,
    hasProposed: group.hasProposed,
    summary: buildMemoryCategorySummary(group.texts, displayLang, t),
  }));
}

function MemoryFactCategorySection({ group, expanded, onToggle, displayLang, onStatus, onDelete, t, appDialog }) {
  const instantTap = useInstantTap();
  return (
    <div style={memoryFactCategorySectionStyle}>
      <button
        type="button"
        aria-expanded={expanded}
        {...instantTap(`memory-category-${group.category}`, onToggle)}
        style={{
          ...memoryFactCategoryHeaderButtonStyle,
          touchAction: "manipulation",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-1)", minWidth: 0 }}>
            {t(`coach.memory_fact_category_${group.category}`)}
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-3)", whiteSpace: "nowrap" }}>
            {t("coach.memory_category_fact_count", { count: group.facts.length })}
          </div>
        </div>
        <div style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-2)" }}>
          {group.summary}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 8 }}>
          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
            {expanded ? t("coach.memory_category_collapse") : t("coach.memory_category_expand")}
          </span>
          <span aria-hidden="true" style={{ fontSize: 14, color: "var(--ink-3)", lineHeight: 1 }}>
            {expanded ? "-" : "+"}
          </span>
        </div>
      </button>
      {expanded && (
        <div style={memoryFactDetailsStyle}>
          {group.facts.map((fact, index) => (
            <MemoryFactRow
              key={fact.rowId || fact.clientId || fact.id}
              fact={fact}
              hasTopBorder={index > 0}
              displayLang={displayLang}
              onStatus={onStatus}
              onDelete={onDelete}
              t={t}
              appDialog={appDialog}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MemoryFactRow({ fact, hasTopBorder, displayLang, onStatus, onDelete, t, appDialog }) {
  return (
    <div style={{ ...memoryFactRowStyle, borderTop: hasTopBorder ? "1px solid var(--rule-soft)" : "none" }}>
      <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-1)" }}>
        {getMemoryFactText(fact, displayLang)}
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
          <>
            <button type="button" onClick={() => onStatus?.(fact, "active")} style={memoryFactButtonStyle}>{t("coach.memory_fact_restore")}</button>
            <button
              type="button"
              onClick={async () => {
                if (await appDialog.confirm(t("coach.memory_fact_delete_confirm"), { danger: true, confirmLabel: t("common.delete") })) {
                  onDelete?.(fact);
                }
              }}
              style={{ ...memoryFactButtonStyle, color: "var(--danger)", borderColor: "var(--danger)" }}
            >
              {t("coach.memory_fact_delete")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const memoryFactCategorySectionStyle = {
  border: "1px solid var(--rule-soft)",
  borderRadius: 6,
  background: "var(--paper-2)",
  overflow: "hidden",
};

const memoryFactCategoryHeaderButtonStyle = {
  width: "100%",
  minHeight: 0,
  border: "none",
  borderRadius: 0,
  background: "transparent",
  color: "inherit",
  padding: "10px 11px",
  textAlign: "left",
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
};

const memoryFactDetailsStyle = {
  borderTop: "1px solid var(--rule-soft)",
  background: "var(--bg-elevated)",
};

const memoryFactRowStyle = {
  padding: "10px 11px",
};

const memoryFactFilterButtonStyle = {
  ...s.btnGhost,
  minHeight: 0,
  padding: "5px 10px",
  fontSize: 11,
  borderRadius: 999,
  transition: "none",
  boxShadow: "none",
};

const memoryFactCategoryChipStyle = {
  display: "inline-flex",
  alignItems: "center",
  width: "fit-content",
  minHeight: 0,
  border: "1px solid var(--rule)",
  borderRadius: 999,
  padding: "5px 10px",
  fontSize: 12,
  lineHeight: 1.2,
  background: "var(--bg-elevated)",
  color: "var(--ink-2)",
  cursor: "pointer",
  transition: "none",
  boxShadow: "none",
};

const memoryFactButtonStyle = {
  ...s.btnGhost,
  minHeight: 0,
  padding: "4px 8px",
  fontSize: 11,
  transition: "none",
  boxShadow: "none",
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
  const instantPress = useInstantPress();
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
  const rowPressRef = useRef(null);
  const recentRowTapRef = useRef(new Map());
  function toggleOpen(id) {
    setOpenId(current => current === id ? null : id);
  }
  function cancelRowPress() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    rowPressRef.current = null;
  }
  function startPress(action, event, id) {
    if (event?.pointerType === "mouse") return;
    longPressFired.current = false;
    rowPressRef.current = {
      id,
      pointerId: event?.pointerId,
      x: event?.clientX || 0,
      y: event?.clientY || 0,
    };
    if (onDelete) {
      pressTimer.current = setTimeout(() => {
        longPressFired.current = true;
        setActionTarget(action);
      }, 450);
    }
  }
  function movePress(event) {
    const active = rowPressRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (Math.hypot((event.clientX || 0) - active.x, (event.clientY || 0) - active.y) > 10) {
      cancelRowPress();
    }
  }
  function endPress(event, id) {
    if (event?.pointerType === "mouse") return;
    const active = rowPressRef.current;
    if (!active || active.id !== id || active.pointerId !== event.pointerId) {
      cancelRowPress();
      return;
    }
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    rowPressRef.current = null;
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    recentRowTapRef.current.set(id, event?.timeStamp || 0);
    event?.preventDefault?.();
    toggleOpen(id);
  }
  function clickRow(event, id) {
    if (event?.defaultPrevented) return;
    const at = event?.timeStamp || 0;
    const recentAt = recentRowTapRef.current.get(id) || 0;
    if (at - recentAt < 750) {
      event?.preventDefault?.();
      return;
    }
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    toggleOpen(id);
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
              <button type="button" onClick={(event) => clickRow(event, id)} style={{
                width: "100%", border: "none", background: "transparent",
                display: "grid", gridTemplateColumns: "1fr auto", gap: 10,
                textAlign: "left", padding: "11px 12px", cursor: "pointer",
                fontFamily: "var(--font-sans)", color: "var(--ink-1)",
                WebkitTouchCallout: "none",
                touchAction: "manipulation",
                WebkitTapHighlightColor: "transparent",
              }}
                onPointerDown={(event) => startPress(action, event, id)}
                onPointerMove={movePress}
                onPointerUp={(event) => endPress(event, id)}
                onPointerCancel={cancelRowPress}
                onPointerLeave={cancelRowPress}
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
                          {...instantPress(`agent-action-open-briefing-${id}`, () => onOpenRaceBriefing?.(action))}
                          style={{
                            ...s.btn,
                            justifySelf: "start",
                            minHeight: 0,
                            padding: "6px 10px",
                            fontSize: 12,
                            touchAction: "manipulation",
                            WebkitTapHighlightColor: "transparent",
                          }}>
                          {t("coach.race_briefing_open")}
                        </button>
                      )}
                      <button
                        type="button"
                        {...instantPress(`agent-action-ask-coach-${id}`, () => onAskCoach(action))}
                        style={{
                          ...s.btnGhost,
                          justifySelf: "start",
                          minHeight: 0,
                          padding: "6px 10px",
                          fontSize: 12,
                          touchAction: "manipulation",
                          WebkitTapHighlightColor: "transparent",
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
  return (
    <>
      <ActionQualityDetails action={action} t={t} />
      {action.type === "create_plans"
        ? <PlanActionDetails action={action} t={t} />
        : action.type === "memory_update"
          ? <MemoryActionDetails action={action} t={t} />
          : isRaceBriefingAction(action)
            ? <RaceBriefingActionDetails action={action} t={t} />
            : <div style={detailEmptyStyle}>{t("coach.agent_action_empty_detail")}</div>}
    </>
  );
}

function ActionQualityDetails({ action, t }) {
  const signal = getAgentActionQualitySignal(action);
  if (!signal?.label) return null;
  return (
    <ActionDetailSection title={t("coach.agent_action_quality_title")}>
      <div style={detailResultWrapStyle}>
        <span style={detailResultPillStyle}>{t(`coach.agent_action_quality_${signal.label}`)}</span>
        <span style={detailResultPillStyle}>{t("coach.agent_action_quality_score", { score: Number(signal.score || 0) })}</span>
      </div>
      <div style={{ ...detailEmptyStyle, marginTop: 6 }}>
        {t(`coach.agent_action_quality_hint_${signal.label}`)}
      </div>
    </ActionDetailSection>
  );
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
  const archivedFactCount = Number(action.result?.archivedFactCount || 0);
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
      {(savedFactCount > 0 || archivedFactCount > 0 || savedLanguages.length > 0 || action.error) && (
        <ActionDetailSection title={t("coach.agent_actions_result")}>
          <div style={{ color: action.error ? "var(--danger)" : "var(--ink-2)", fontSize: 12, lineHeight: 1.45 }}>
            {action.error ? (
              t("coach.agent_action_error", { msg: action.error })
            ) : (
              <>
                {savedFactCount > 0
                  ? t("coach.agent_action_memory_facts_saved", { count: savedFactCount })
                  : savedLanguages.length > 0
                    ? t("coach.agent_action_memory_saved", { langs: savedLanguages.join(" / ") })
                    : null}
                {archivedFactCount > 0 && (
                  <span style={{ display: "block", marginTop: savedFactCount || savedLanguages.length ? 3 : 0 }}>
                    {t("coach.agent_action_memory_facts_archived", { count: archivedFactCount })}
                  </span>
                )}
              </>
            )}
          </div>
        </ActionDetailSection>
      )}
      {!previews.length && !savedFactCount && !archivedFactCount && !savedLanguages.length && !action.error && (
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
  const archivedFactCount = Number(action.result?.archivedFactCount || 0);
  if (createdCount > 0) resultBits.push(zh ? `创建计划 ${createdCount} 条` : `created ${createdCount} planned item(s)`);
  if (updatedCount > 0) resultBits.push(zh ? `修改计划 ${updatedCount} 条` : `updated ${updatedCount} existing plan(s)`);
  if (restDates.length) resultBits.push(zh ? `计划休息日：${restDates.join(", ")}` : `planned rest: ${restDates.join(", ")}`);
  if (savedFactCount > 0) resultBits.push(zh ? `已启用记忆事实 ${savedFactCount} 条` : `activated ${savedFactCount} memory fact(s)`);
  if (archivedFactCount > 0) resultBits.push(zh ? `归档旧记忆事实 ${archivedFactCount} 条` : `archived ${archivedFactCount} old memory fact(s)`);
  if (!savedFactCount && savedLanguages.length) resultBits.push(zh ? `已保存记忆语言：${savedLanguages.join(" / ")}` : `saved memory languages: ${savedLanguages.join(" / ")}`);
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
  const archivedFactCount = Number(action.result?.archivedFactCount || 0);
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
  const memoryDetail = () => {
    const count = savedFactCount || savedLanguages.length || [memory?.en, memory?.zh].filter(v => String(v || "").trim()).length || 0;
    const base = t("coach.agent_action_memory_detail", { count });
    return archivedFactCount > 0
      ? `${base} · ${t("coach.agent_action_memory_archived_short", { count: archivedFactCount })}`
      : base;
  };
  const detail = action.type === "create_plans"
    ? t("coach.agent_action_plan_detail", {
        dates: affectedDates.length ? affectedDates.slice(0, 4).join(", ") : "-",
        count: plans.length || createdCount || 0,
      })
    : action.type === "memory_update"
      ? memoryDetail()
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
  const action = proposal.action || null;
  const sourceMessageCount = Number(action?.payload?.sourceMessageCount || 0);
  const source = action?.source || "ai_coach_memory";
  const sourceSummary = source === "nightly_memory_review" ? "Nightly Memory review" : "Memory auto-update";
  const fallbackActionId = useMemo(() => {
    const seed = `${proposal.en || ""}|${proposal.zh || ""}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    return `memory-update-${seed.length}-${hash.toString(36)}`;
  }, [proposal.en, proposal.zh]);
  const actionId = action?.id || fallbackActionId;
  const proposalFacts = useMemo(() => {
    if (Array.isArray(proposal.facts) && proposal.facts.length) {
      return proposal.facts.map((fact, index) => ({
        ...fact,
        clientId: fact.clientId || fact.id || `memory-fact-${actionId}-${index}`,
        source: fact.source || source,
        sourceSummary: fact.sourceSummary || sourceSummary,
        status: "active",
      }));
    }
    return extractMemoryFacts({ en: proposal.en, zh: proposal.zh }, {
      clientPrefix: `memory-fact-${actionId}`,
      memoryActionId: actionId,
      sourceMessageCount,
      source,
      sourceSummary,
      status: "active",
    });
  }, [actionId, proposal.en, proposal.facts, proposal.zh, source, sourceMessageCount, sourceSummary]);
  const review = useMemo(
    () => buildMemoryFactReview(proposalFacts, oldFacts),
    [oldFacts, proposalFacts],
  );
  const defaultSelectedKeys = useMemo(() => new Set(
    review.entries
      .filter(entry => entry.kind === "new" || entry.kind === "updated")
      .map(entry => entry.key),
  ), [review.entries]);
  const defaultSelectedSignature = useMemo(
    () => [...defaultSelectedKeys].sort().join("|"),
    [defaultSelectedKeys],
  );
  const [selectionState, setSelectionState] = useState(() => ({
    signature: defaultSelectedSignature,
    keys: defaultSelectedKeys,
  }));
  const selectedKeys = selectionState.signature === defaultSelectedSignature ? selectionState.keys : defaultSelectedKeys;
  const [saving, setSaving] = useState(false);
  const changedEntries = review.entries.filter(entry => entry.kind !== "unchanged");
  const unchangedEntries = review.entries.filter(entry => entry.kind === "unchanged");
  function toggle(key) {
    if (saving) return;
    setSelectionState(prev => {
      const base = prev.signature === defaultSelectedSignature ? prev.keys : defaultSelectedKeys;
      const keys = new Set(base);
      if (keys.has(key)) keys.delete(key); else keys.add(key);
      return { signature: defaultSelectedSignature, keys };
    });
  }
  async function accept() {
    if (saving) return;
    const finalFacts = buildMemoryFactSnapshotFromReview(review.entries, selectedKeys);
    setSaving(true);
    try {
      await onAccept(finalFacts, {
        reviewedChangeCount: changedEntries.filter(entry => selectedKeys.has(entry.key)).length,
        unchangedFactCount: unchangedEntries.length,
      });
    } finally {
      setSaving(false);
    }
  }
  const summaryBits = [
    review.counts.new ? t("coach.memory_review_summary_new", { count: review.counts.new }) : "",
    review.counts.updated ? t("coach.memory_review_summary_updated", { count: review.counts.updated }) : "",
    review.counts.removed ? t("coach.memory_review_summary_removed", { count: review.counts.removed }) : "",
    review.counts.unchanged ? t("coach.memory_review_summary_unchanged", { count: review.counts.unchanged }) : "",
  ].filter(Boolean);
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
      <div style={{ ...s.muted, fontSize: 11, marginBottom: 8, lineHeight: 1.5 }}>
        {summaryBits.length ? summaryBits.join(" · ") : t("coach.memory_review_no_changes")}
      </div>
      <div style={memoryReviewListStyle}>
        {changedEntries.length ? (
          changedEntries.map(entry => (
            <MemoryReviewEntry
              key={entry.key}
              entry={entry}
              selected={selectedKeys.has(entry.key)}
              disabled={saving}
              displayLang={displayLang}
              onToggle={() => toggle(entry.key)}
              t={t}
            />
          ))
        ) : (
          <div style={memoryReviewEmptyStyle}>{t("coach.memory_review_no_changes")}</div>
        )}
        {unchangedEntries.length > 0 && (
          <details style={memoryReviewDetailsStyle}>
            <summary style={memoryReviewSummaryStyle}>{t("coach.memory_review_unchanged_group", { count: unchangedEntries.length })}</summary>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              {unchangedEntries.map(entry => (
                <MemoryReviewEntry
                  key={entry.key}
                  entry={entry}
                  selected
                  disabled
                  displayLang={displayLang}
                  t={t}
                />
              ))}
            </div>
          </details>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={accept}
          disabled={saving}
          style={{ ...s.btn, opacity: saving ? 0.55 : 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
          {saving && <Spinner size={13} thickness={1.6} color="currentColor" />}
          {saving ? t("coach.memory_importing") : t("coach.memory_accept")}
        </button>
        <button onClick={onReject} disabled={saving} style={{ ...s.btnGhost, opacity: saving ? 0.5 : 1 }}>{t("coach.memory_reject")}</button>
      </div>
    </>
  );
}

function MemoryReviewEntry({ entry, selected, disabled, displayLang, onToggle, t }) {
  const fact = entry.fact || entry.oldFact || {};
  const oldFact = entry.oldFact || null;
  const text = displayLang === "zh" ? (fact.contentZh || fact.contentEn || "") : (fact.contentEn || fact.contentZh || "");
  const oldText = oldFact && entry.kind === "updated"
    ? (displayLang === "zh" ? (oldFact.contentZh || oldFact.contentEn || "") : (oldFact.contentEn || oldFact.contentZh || ""))
    : "";
  const removable = entry.kind === "removed";
  const label = t(`coach.memory_review_kind_${entry.kind}`);
  return (
    <label style={{
      ...memoryReviewEntryStyle,
      borderColor: selected ? "var(--moss)" : "var(--rule)",
      background: selected ? "var(--moss-bg)" : "var(--panel-2)",
      opacity: disabled && entry.kind !== "unchanged" ? 0.72 : 1,
      cursor: disabled || entry.kind === "unchanged" ? "default" : "pointer",
    }}>
      <input
        type="checkbox"
        checked={selected}
        disabled={disabled || entry.kind === "unchanged"}
        onChange={onToggle}
        style={{ marginTop: 4, flexShrink: 0 }}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
          <span style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            border: "1px solid var(--rule)",
            borderRadius: 4,
            padding: "1px 5px",
            color: removable ? "var(--danger)" : "var(--moss-deep)",
            background: "var(--paper-2)",
          }}>
            {label}
          </span>
          {fact.category && (
            <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
              {t(`coach.memory_fact_category_${fact.category}`)}
            </span>
          )}
        </span>
        {oldText && oldText !== text && (
          <span style={{
            display: "block",
            fontSize: 12,
            lineHeight: 1.45,
            color: "var(--ink-3)",
            textDecoration: "line-through",
            marginBottom: 3,
          }}>
            {oldText}
          </span>
        )}
        <span style={{
          display: "block",
          fontSize: 13,
          lineHeight: 1.5,
          color: selected || entry.kind === "unchanged" ? "var(--ink-1)" : "var(--ink-3)",
          textDecoration: selected || entry.kind === "unchanged" ? "none" : "line-through",
        }}>
          {text || t("coach.memory_review_empty_fact")}
        </span>
      </span>
    </label>
  );
}

const memoryReviewListStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  maxHeight: 360,
  overflowY: "auto",
  border: "1px solid var(--moss)",
  background: "var(--moss-bg)",
  borderRadius: 4,
  padding: 8,
};

const memoryReviewEntryStyle = {
  display: "flex",
  gap: 8,
  alignItems: "flex-start",
  padding: "8px 9px",
  border: "1px solid var(--rule)",
  borderRadius: 6,
};

const memoryReviewEmptyStyle = {
  ...s.muted,
  fontSize: 12,
  lineHeight: 1.5,
  padding: "8px 4px",
};

const memoryReviewDetailsStyle = {
  borderTop: "1px solid var(--rule)",
  marginTop: 4,
  paddingTop: 8,
};

const memoryReviewSummaryStyle = {
  fontSize: 12,
  color: "var(--ink-2)",
  cursor: "pointer",
  userSelect: "none",
};
