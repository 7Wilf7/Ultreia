import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { s } from "../styles";
import { useT } from "../i18n/LanguageContext";
import { weekWindow } from "../utils/weeklyReport";
import { buildAnnotatedDiscussionMessage } from "../utils/annotations";
import { TextAnnotationPanel } from "./TextAnnotationPanel";

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
  extracting,
  error,
  onGenerate,
  onStopGenerate,
  onStopImport,
}) {
  const t = useT();
  const articleRef = useRef(null);
  const [discussionText, setDiscussionText] = useState("");
  const [annotations, setAnnotations] = useState([]);
  const range = useMemo(() => weekWindow(now || new Date(), rangeMode === "last" ? -1 : 0), [now, rangeMode]);
  const selected = useMemo(() => {
    const modeReports = (reports || []).filter(r => r.rangeMode === rangeMode);
    return modeReports.sort((a, b) => String(b.generatedAt || "").localeCompare(String(a.generatedAt || "")))[0] || null;
  }, [reports, rangeMode]);
  const canDiscuss = selected && (discussionText.trim() || annotations.length > 0);

  function sendDiscussion() {
    if (!canDiscuss) return;
    onDiscussReport?.(selected, buildAnnotatedDiscussionMessage({
      intro: t("weekly_report.discuss_intro"),
      sourceTitle: t("weekly_report.title"),
      sourceText: selected?.text || "",
      extraText: discussionText,
      annotations,
    }));
    setDiscussionText("");
    setAnnotations([]);
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
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 64px 28px", alignItems: "center", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 22, fontWeight: 750, margin: 0, lineHeight: 1.12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {t("weekly_report.title")}
            </h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 5, width: 64 }}>
            <button
              onClick={() => loading ? onStopGenerate?.() : onGenerate?.(range, rangeMode)}
              style={{ ...(loading ? s.btnGhost : s.btn), minHeight: 0, width: "100%", padding: "5px 0", fontSize: 11, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
              {loading && <span className="ultreia-spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} />}
              {loading ? t("common.stop") : t("weekly_report.generate_short")}
            </button>
            <button
              onClick={() => {
                if (extracting) onStopImport?.();
                else if (selected) onImportPlan?.(selected.text, selected.id);
              }}
              disabled={!selected && !extracting}
              style={{ ...s.btnGhost, opacity: (selected || extracting) ? 1 : 0.45, minHeight: 0, width: "100%", padding: "5px 0", fontSize: 11, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
              {extracting && <span className="ultreia-spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} />}
              {extracting ? t("common.stop") : t("weekly_report.import_plan_short")}
            </button>
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <button onClick={() => setRangeMode("this")} style={{ ...(rangeMode === "this" ? s.btn : s.btnGhost), minHeight: 0, padding: "9px 6px", whiteSpace: "nowrap" }}>
            {t("weekly_report.this_week")}
          </button>
          <button onClick={() => setRangeMode("last")} style={{ ...(rangeMode === "last" ? s.btn : s.btnGhost), minHeight: 0, padding: "9px 6px", whiteSpace: "nowrap" }}>
            {t("weekly_report.last_week")}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "16px 18px 18px" }}>
        <div style={{
          ...s.muted,
          fontSize: 12,
          lineHeight: 1.45,
          paddingBottom: 10,
          marginBottom: 12,
          borderBottom: "1px solid var(--rule-soft)",
        }}>
          {range.start} to {range.end}
        </div>

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
            <article ref={articleRef} className="selectable" style={{ maxWidth: 720, color: "var(--ink-1)", fontSize: 14, lineHeight: 1.75 }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {selected.text || ""}
              </ReactMarkdown>
            </article>
          </>
        )}

        <div style={{ ...s.muted, fontSize: 11, lineHeight: 1.55, marginTop: 16, paddingBottom: 4 }}>
          {loading ? t("weekly_report.background_note") : t("weekly_report.local_note")}
        </div>
      </div>
      {selected && (
        <TextAnnotationPanel
          title={t("weekly_report.annotations_title")}
          hint={t("weekly_report.annotations_hint")}
          sourceLabel={t("weekly_report.title")}
          annotations={annotations}
          setAnnotations={setAnnotations}
          extraText={discussionText}
          setExtraText={setDiscussionText}
          extraPlaceholder={t("weekly_report.discuss_placeholder")}
          sendLabel={t("weekly_report.discuss_send")}
          onSend={sendDiscussion}
          selectionRootRef={articleRef}
          floating
          compact
        />
      )}
    </div>
  );
}

export const WeeklyReportModal = WeeklyReportPage;
