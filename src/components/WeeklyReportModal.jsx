import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { s } from "../styles";
import { useT } from "../i18n/LanguageContext";
import { weekWindow } from "../utils/weeklyReport";

const stripNode = ({ node, ...rest }) => rest; // eslint-disable-line no-unused-vars

function fmtGeneratedAt(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const mdComponents = {
  h1: (p) => <h2 {...stripNode(p)} style={{ fontSize: 19, lineHeight: 1.35, margin: "18px 0 8px", fontWeight: 750 }} />,
  h2: (p) => <h3 {...stripNode(p)} style={{ fontSize: 17, lineHeight: 1.45, margin: "18px 0 8px", fontWeight: 700 }} />,
  h3: (p) => <h4 {...stripNode(p)} style={{ fontSize: 15, lineHeight: 1.5, margin: "16px 0 6px", fontWeight: 700 }} />,
  h4: (p) => <h5 {...stripNode(p)} style={{ fontSize: 14, lineHeight: 1.5, margin: "14px 0 5px", fontWeight: 650 }} />,
  p: (p) => <p {...stripNode(p)} style={{ margin: "0 0 11px", lineHeight: 1.8, whiteSpace: "pre-wrap" }} />,
  ul: (p) => <ul {...stripNode(p)} style={{ margin: "0 0 12px", paddingLeft: 22, lineHeight: 1.75 }} />,
  ol: (p) => <ol {...stripNode(p)} style={{ margin: "0 0 12px", paddingLeft: 22, lineHeight: 1.75 }} />,
  li: (p) => <li {...stripNode(p)} style={{ margin: "2px 0" }} />,
  strong: (p) => <strong {...stripNode(p)} style={{ fontWeight: 750 }} />,
  hr: (p) => <hr {...stripNode(p)} style={{ border: "none", borderTop: "1px solid var(--rule)", margin: "18px 0" }} />,
  blockquote: (p) => (
    <blockquote {...stripNode(p)} style={{
      margin: "10px 0 14px",
      padding: "8px 12px",
      borderLeft: "3px solid var(--moss)",
      background: "var(--bg-elevated)",
      color: "var(--ink-2)",
    }} />
  ),
  table: (p) => (
    <div style={{ overflowX: "auto", maxWidth: "100%", margin: "10px 0 14px" }}>
      <table {...stripNode(p)} style={{ borderCollapse: "collapse", minWidth: "max-content", fontSize: 12 }} />
    </div>
  ),
  th: (p) => <th {...stripNode(p)} style={{ border: "1px solid var(--rule)", padding: "6px 8px", textAlign: "left", fontWeight: 700 }} />,
  td: (p) => <td {...stripNode(p)} style={{ border: "1px solid var(--rule)", padding: "6px 8px", verticalAlign: "top" }} />,
};

export function WeeklyReportPage({
  now,
  onClose,
  onImportPlan,
  onDiscussReport,
  reports,
  rangeMode,
  setRangeMode,
  loading,
  error,
  onGenerate,
}) {
  const t = useT();
  const [discussionText, setDiscussionText] = useState("");
  const range = useMemo(() => weekWindow(now || new Date(), rangeMode === "last" ? -1 : 0), [now, rangeMode]);
  const selected = useMemo(() => {
    const modeReports = (reports || []).filter(r => r.rangeMode === rangeMode);
    return modeReports.sort((a, b) => String(b.generatedAt || "").localeCompare(String(a.generatedAt || "")))[0] || null;
  }, [reports, rangeMode]);
  const canDiscuss = selected && discussionText.trim();

  function sendDiscussion() {
    if (!canDiscuss) return;
    onDiscussReport?.(selected, discussionText.trim());
    setDiscussionText("");
  }

  return (
    <div style={{
      height: "100%",
      minHeight: "calc(100dvh - 92px)",
      background: "var(--bg)",
      fontFamily: "var(--font-sans)",
      display: "flex",
      flexDirection: "column",
      margin: "-8px -14px 0",
      overflow: "hidden",
    }}>
      <div style={{
        padding: "calc(max(env(safe-area-inset-top), 14px) + 4px) 18px 12px",
        borderBottom: "1px solid var(--rule)",
        background: "var(--bg)",
        flexShrink: 0,
        zIndex: 3,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
              <h2 style={{ fontSize: 24, fontWeight: 750, margin: 0, lineHeight: 1.12, flexShrink: 0 }}>
                {t("weekly_report.title")}
              </h2>
              <div style={{ ...s.muted, fontSize: 11, lineHeight: 1.4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {range.start} to {range.end}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ ...s.modalCloseBtn, position: "static", flexShrink: 0 }} aria-label="Close">×</button>
        </div>
      </div>

      <div style={{
        padding: "10px 18px 12px",
        borderBottom: "1px solid var(--rule-soft)",
        background: "var(--bg)",
        flexShrink: 0,
        zIndex: 2,
      }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
          <button onClick={() => setRangeMode("this")} style={{ ...(rangeMode === "this" ? s.btn : s.btnGhost), minHeight: 0, padding: "9px 6px", whiteSpace: "nowrap" }}>
            {t("weekly_report.this_week")}
          </button>
          <button onClick={() => setRangeMode("last")} style={{ ...(rangeMode === "last" ? s.btn : s.btnGhost), minHeight: 0, padding: "9px 6px", whiteSpace: "nowrap" }}>
            {t("weekly_report.last_week")}
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <button
            onClick={() => onGenerate?.(range, rangeMode)}
            disabled={loading}
            style={{ ...s.btn, opacity: loading ? 0.7 : 1, minHeight: 0, padding: "9px 6px", whiteSpace: "nowrap" }}>
            {loading ? t("weekly_report.generating") : t("weekly_report.generate")}
          </button>
          <button
            onClick={() => selected && onImportPlan?.(selected.text, selected.id)}
            disabled={!selected}
            style={{ ...s.btnGhost, opacity: selected ? 1 : 0.45, minHeight: 0, padding: "9px 6px", whiteSpace: "nowrap" }}>
            {t("weekly_report.import_plan")}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "16px 18px 18px" }}>
        {error && (
          <div style={{
            border: "1px solid var(--danger)",
            color: "var(--danger)",
            padding: 10,
            fontSize: 12,
            marginBottom: 12,
            lineHeight: 1.5,
          }}>
            {error}
          </div>
        )}

        {!selected && !loading && (
          <div style={{ ...s.muted, fontSize: 13, lineHeight: 1.7, padding: "18px 0" }}>
            {t("weekly_report.empty")}
          </div>
        )}

        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 0", color: "var(--ink-2)", fontSize: 13 }}>
            <span className="ultreia-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
            {t("weekly_report.thinking")}
          </div>
        )}

        {selected && (
          <>
            <div style={{ ...s.muted, fontSize: 11, lineHeight: 1.5, marginBottom: 12 }}>
              {t("weekly_report.generated_at", { time: fmtGeneratedAt(selected.generatedAt) })}
            </div>
            <article className="selectable" style={{ maxWidth: 720, color: "var(--ink-1)", fontSize: 14, lineHeight: 1.75 }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {selected.text || ""}
              </ReactMarkdown>
            </article>

            <div style={{ borderTop: "1px solid var(--rule)", marginTop: 18, paddingTop: 12 }}>
              <textarea
                value={discussionText}
                onChange={e => setDiscussionText(e.target.value)}
                rows={3}
                placeholder={t("weekly_report.discuss_placeholder")}
                style={{ ...s.input, width: "100%", resize: "vertical", minHeight: 78, lineHeight: 1.5, marginBottom: 8 }}
              />
              <button onClick={sendDiscussion} disabled={!canDiscuss} style={{ ...s.btn, width: "100%", opacity: canDiscuss ? 1 : 0.45 }}>
                {t("weekly_report.discuss_send")}
              </button>
            </div>
          </>
        )}

        <div style={{ ...s.muted, fontSize: 11, lineHeight: 1.55, marginTop: 16, paddingBottom: 4 }}>
          {loading ? t("weekly_report.background_note") : t("weekly_report.local_note")}
        </div>
      </div>
    </div>
  );
}

export const WeeklyReportModal = WeeklyReportPage;
