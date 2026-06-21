import { useMemo } from "react";
import { s } from "../styles";
import { useT } from "../i18n/LanguageContext";
import { weekWindow } from "../utils/weeklyReport";

function fmtGeneratedAt(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderReportText(text) {
  return String(text || "").split(/\n{2,}/).map((block, idx) => {
    const trimmed = block.trim();
    if (!trimmed) return null;
    const heading = /^(#{1,3}\s+|[一二三四五六七八九十]+[、.]\s*|[0-9]+[.)、]\s*)/.test(trimmed)
      || trimmed.length <= 26 && !/[。.!?；;]/.test(trimmed);
    return (
      <p key={idx} style={{
        margin: heading ? "18px 0 8px" : "0 0 12px",
        fontSize: heading ? 15 : 14,
        lineHeight: 1.75,
        fontWeight: heading ? 650 : 400,
        color: "var(--ink-1)",
        whiteSpace: "pre-wrap",
      }}>
        {trimmed.replace(/^#{1,3}\s+/, "")}
      </p>
    );
  });
}

export function WeeklyReportPage({
  now,
  onClose,
  onImportPlan,
  reports,
  selectedId,
  setSelectedId,
  rangeMode,
  setRangeMode,
  loading,
  error,
  onGenerate,
}) {
  const t = useT();
  const range = useMemo(() => weekWindow(now || new Date(), rangeMode === "last" ? -1 : 0), [now, rangeMode]);
  const selected = (reports || []).find(r => r.id === selectedId) || reports?.[0] || null;

  return (
    <div style={{
      minHeight: "calc(100dvh - 78px)",
      background: "var(--bg)",
      fontFamily: "var(--font-sans)",
      display: "flex",
      flexDirection: "column",
      margin: "-8px -14px 0",
    }}>
      <div style={{
        padding: "calc(max(env(safe-area-inset-top), 14px) + 4px) 18px 14px",
        borderBottom: "1px solid var(--rule)",
        background: "var(--bg)",
        position: "sticky",
        top: 0,
        zIndex: 4,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...s.label, marginBottom: 5 }}>{t("weekly_report.kicker")}</div>
            <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0, lineHeight: 1.1 }}>{t("weekly_report.title")}</h2>
            <div style={{ ...s.muted, fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
              {range.start} to {range.end}
            </div>
          </div>
          <button onClick={onClose} style={{ ...s.btnGhost, minHeight: 34, padding: "0 10px", flexShrink: 0 }}>
            {t("common.done")}
          </button>
        </div>
      </div>

      <div style={{
        padding: "12px 18px",
        borderBottom: "1px solid var(--rule-soft)",
        display: "grid",
        gridTemplateColumns: "1fr 1fr 104px",
        gap: 6,
        alignItems: "stretch",
      }}>
        <button onClick={() => setRangeMode("this")} style={{ ...(rangeMode === "this" ? s.btn : s.btnGhost), whiteSpace: "nowrap", paddingLeft: 6, paddingRight: 6 }}>
          {t("weekly_report.this_week")}
        </button>
        <button onClick={() => setRangeMode("last")} style={{ ...(rangeMode === "last" ? s.btn : s.btnGhost), whiteSpace: "nowrap", paddingLeft: 6, paddingRight: 6 }}>
          {t("weekly_report.last_week")}
        </button>
        <button
          onClick={() => onGenerate?.(range, rangeMode)}
          disabled={loading}
          style={{
            ...s.btn,
            opacity: loading ? 0.7 : 1,
            minWidth: 0,
            paddingLeft: 6,
            paddingRight: 6,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}>
          {loading ? t("weekly_report.generating") : t("weekly_report.generate")}
        </button>
      </div>

      {reports?.length > 0 && (
        <div style={{ padding: "10px 18px", borderBottom: "1px solid var(--rule-soft)" }}>
          <select value={selected?.id || ""} onChange={e => setSelectedId(e.target.value)} style={{ ...s.input, width: "100%" }}>
            {reports.map(r => (
              <option key={r.id} value={r.id}>
                {r.start}..{r.end} · {fmtGeneratedAt(r.generatedAt)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div style={{ flex: 1, padding: "16px 18px 96px" }}>
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
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px 0", color: "var(--ink-2)", fontSize: 13 }}>
            <span className="ultreia-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
            {t("weekly_report.thinking")}
          </div>
        )}

        {selected && (
          <>
            <div style={{
              borderBottom: "1px solid var(--rule)",
              marginBottom: 14,
              paddingBottom: 10,
              display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap",
              color: "var(--ink-3)", fontSize: 12,
            }}>
              <span>{selected.start}..{selected.end}</span>
              <span>{fmtGeneratedAt(selected.generatedAt)}</span>
            </div>
            <article style={{ maxWidth: 680 }}>
              {renderReportText(selected.text)}
            </article>
          </>
        )}
      </div>

      <div style={{
        position: "sticky",
        bottom: 0,
        borderTop: "1px solid var(--rule)",
        background: "var(--bg)",
        padding: "12px 18px calc(env(safe-area-inset-bottom, 0px) + 12px)",
        display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center",
        flexWrap: "wrap",
      }}>
        <div style={{ ...s.muted, fontSize: 11, lineHeight: 1.5, maxWidth: 430 }}>
          {loading ? t("weekly_report.background_note") : t("weekly_report.local_note")}
        </div>
        <button
          onClick={() => selected && onImportPlan?.(selected.text, selected.id)}
          disabled={!selected}
          style={{ ...s.btn, opacity: selected ? 1 : 0.5 }}
        >
          {t("weekly_report.import_plan")}
        </button>
      </div>
    </div>
  );
}

export const WeeklyReportModal = WeeklyReportPage;
