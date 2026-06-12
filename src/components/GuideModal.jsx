import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { s } from "../styles";
import { useT } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { ModalRoot } from "./ModalRoot";

// Bundle the user manual straight into the app. Vite's `?raw` suffix inlines
// each markdown file as a string at build time, so the guide works offline and
// opens in-app (no jump to external documentation). docs/ lives at the project
// root, hence the ../../ climb out of src/components.
import readmeMd from "../../docs/README.md?raw";
import trainingLogMd from "../../docs/training-log.md?raw";
import runningMd from "../../docs/running.md?raw";
import dataImportMd from "../../docs/data-import.md?raw";
import racesMd from "../../docs/races.md?raw";
import weatherMd from "../../docs/weather.md?raw";
import aiCoachMd from "../../docs/ai-coach.md?raw";
import chartsMd from "../../docs/charts.md?raw";
import changelogMd from "../../docs/changelog.md?raw";

// Ordered chapter list — mirrors docs/SUMMARY.md. `file` is the source
// filename so internal [...](races.md) links can resolve to a chapter.
const CHAPTERS = [
  { file: "README.md",       title: "总览",              md: readmeMd },
  { file: "training-log.md", title: "训练记录",          md: trainingLogMd },
  { file: "ai-coach.md",     title: "AI 教练",           md: aiCoachMd },
  { file: "races.md",        title: "赛事管理",          md: racesMd },
  { file: "weather.md",      title: "天气",              md: weatherMd },
  { file: "charts.md",       title: "图表",              md: chartsMd },
  { file: "running.md",      title: "配速分类",          md: runningMd },
  { file: "data-import.md",  title: "数据导入",          md: dataImportMd },
  { file: "changelog.md",    title: "更新日志",          md: changelogMd },
];

// ── Markdown table helpers (mobile) ──────────────────────────────────────
// On phones a wide table can't be read by horizontal scroll (it fights the
// vertical reading-pane scroll and snaps back). Mirror the AI Coach approach:
// collapse wide tables (≥3 cols) into stacked "label: value" cards. Narrow
// tables (≤2 cols) stay as real tables.
function hastToText(node) {
  if (!node) return "";
  if (node.type === "text") return node.value || "";
  if (node.tagName === "br") return "\n";
  if (Array.isArray(node.children)) return node.children.map(hastToText).join("");
  return "";
}

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
        if (th.type === "element" && th.tagName === "th") headers.push(hastToText(th).trim());
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
      if (cell.tagName === "td" || cell.tagName === "th") cells.push(hastToText(cell).trim());
    }
    if (cells.length) rows.push(cells);
  }
  return { headers, rows };
}

// Narrow (≤2 col) tables on mobile: render a real table that WRAPS to fit the
// width instead of forcing horizontal scroll (min-width: max-content was the
// culprit — long cells overflowed and the pan fought the vertical scroll).
function MobileWrapTable({ headers, rows }) {
  const hasHeaders = headers.some(h => h);
  return (
    <table style={{
      width: "100%", borderCollapse: "collapse", tableLayout: "fixed",
      fontSize: 13, margin: "8px 0 14px",
    }}>
      {hasHeaders && (
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={{
                border: "1px solid var(--rule)", padding: "6px 8px", textAlign: "left",
                fontWeight: 600, background: "var(--bg-sunken)",
                whiteSpace: "normal", wordBreak: "break-word", color: "var(--ink-1)",
              }}>{h}</th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {rows.map((cells, ri) => (
          <tr key={ri}>
            {cells.map((c, ci) => (
              <td key={ci} style={{
                border: "1px solid var(--rule)", padding: "6px 8px", verticalAlign: "top",
                whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.55, color: "var(--ink-1)",
              }}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MobileTableCards({ headers, rows }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "8px 0 14px" }}>
      {rows.map((cells, ri) => (
        <div key={ri} style={{ border: "1px solid var(--rule)", borderRadius: 6, padding: "9px 11px", background: "var(--bg-elevated)" }}>
          {cells[0] !== undefined && (
            <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13.5, color: "var(--ink-1)", whiteSpace: "pre-wrap" }}>
              {headers[0] ? `${headers[0]} ` : ""}{cells[0]}
            </div>
          )}
          {cells.slice(1).map((cell, ci) => {
            const header = headers[ci + 1];
            return (
              <div key={ci} style={{ display: "flex", gap: 6, lineHeight: 1.6, marginBottom: 3, fontSize: 13 }}>
                {header && <span style={{ fontWeight: 600, flexShrink: 0, color: "var(--ink-2)" }}>{header}:</span>}
                <span style={{ whiteSpace: "pre-wrap", flex: 1, minWidth: 0, color: "var(--ink-1)" }}>{cell || "—"}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Reading-mode markdown renderers — document-scale typography (bigger than the
// chat bubbles), tuned to the app's ink/moss palette. `onNavigate(file)` lets
// internal .md links switch chapters instead of 404-ing. On mobile, wide
// tables render as stacked cards (see helpers above).
function makeGuideComponents(onNavigate, isMobile) {
  const strip = ({ node, ...rest }) => rest; // eslint-disable-line no-unused-vars
  return {
    h1: (p) => <h1 {...strip(p)} style={{ fontSize: 22, fontWeight: 600, color: "var(--ink-1)", margin: "4px 0 14px", letterSpacing: "-0.01em", lineHeight: 1.25 }} />,
    h2: (p) => <h2 {...strip(p)} style={{ fontSize: 17, fontWeight: 600, color: "var(--ink-1)", margin: "24px 0 10px", lineHeight: 1.3 }} />,
    h3: (p) => <h3 {...strip(p)} style={{ fontSize: 14.5, fontWeight: 600, color: "var(--ink-1)", margin: "18px 0 8px" }} />,
    p:  (p) => <p {...strip(p)} style={{ fontSize: 14, lineHeight: 1.7, color: "var(--ink-1)", margin: "0 0 12px" }} />,
    ul: (p) => <ul {...strip(p)} style={{ fontSize: 14, lineHeight: 1.7, color: "var(--ink-1)", paddingLeft: 22, margin: "0 0 12px" }} />,
    ol: (p) => <ol {...strip(p)} style={{ fontSize: 14, lineHeight: 1.7, color: "var(--ink-1)", paddingLeft: 22, margin: "0 0 12px" }} />,
    li: (p) => <li {...strip(p)} style={{ margin: "0 0 5px" }} />,
    strong: (p) => <strong {...strip(p)} style={{ fontWeight: 600, color: "var(--ink-1)" }} />,
    blockquote: (p) => (
      <blockquote {...strip(p)} style={{
        borderLeft: "3px solid var(--moss)", background: "var(--moss-bg)",
        margin: "0 0 14px", padding: "8px 14px", borderRadius: "0 4px 4px 0",
        fontSize: 13.5, lineHeight: 1.65, color: "var(--moss-deep)",
      }} />
    ),
    code: (p) => (
      <code {...strip(p)} style={{
        fontFamily: "var(--font-mono)", fontSize: 12.5,
        background: "var(--bg-sunken)", padding: "1px 5px", borderRadius: 3,
        wordBreak: "break-word",
      }} />
    ),
    hr: (p) => <hr {...strip(p)} style={{ border: "none", borderTop: "1px solid var(--rule)", margin: "20px 0" }} />,
    a: ({ node, href, ...rest }) => { // eslint-disable-line no-unused-vars
      const isInternal = href && /\.md(#.*)?$/i.test(href);
      if (isInternal) {
        const file = href.replace(/^.*\//, "").replace(/#.*$/, "");
        return (
          <a {...rest} href={href}
            onClick={(e) => { e.preventDefault(); onNavigate(file); }}
            style={{ color: "var(--moss-deep)", textDecoration: "underline", cursor: "pointer" }} />
        );
      }
      return <a {...rest} href={href} target="_blank" rel="noreferrer"
        style={{ color: "var(--moss-deep)", textDecoration: "underline", wordBreak: "break-word" }} />;
    },
    table: (p) => {
      // Mobile never horizontally scrolls a table: wide (>=3 col) tables become
      // stacked cards; narrow (<=2 col) tables wrap to fit the width.
      if (isMobile && p.node) {
        const { headers, rows } = extractTable(p.node);
        const colCount = Math.max(headers.length, ...rows.map(r => r.length), 0);
        if (colCount >= 3) return <MobileTableCards headers={headers} rows={rows} />;
        return <MobileWrapTable headers={headers} rows={rows} />;
      }
      return (
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", maxWidth: "100%", margin: "8px 0 14px" }}>
          <table {...strip(p)} style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: "max-content" }} />
        </div>
      );
    },
    th: (p) => <th {...strip(p)} style={{ border: "1px solid var(--rule)", padding: "6px 9px", textAlign: "left", fontWeight: 600, background: "var(--bg-sunken)", whiteSpace: "nowrap" }} />,
    td: (p) => <td {...strip(p)} style={{ border: "1px solid var(--rule)", padding: "6px 9px", verticalAlign: "top" }} />,
  };
}

export function GuideModal({ onClose, onReplayTour }) {
  const t = useT();
  const isMobile = useIsMobile();
  const [active, setActive] = useState(0);
  const [tocOpen, setTocOpen] = useState(false);
  const tocRef = useRef(null);

  // Close the inline TOC on outside tap (mirrors GlobalFilter).
  useEffect(() => {
    if (!tocOpen) return;
    function onClick(e) {
      if (tocRef.current && !tocRef.current.contains(e.target)) setTocOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("touchstart", onClick);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("touchstart", onClick);
    };
  }, [tocOpen]);

  function navigateToFile(file) {
    const idx = CHAPTERS.findIndex(c => c.file.toLowerCase() === file.toLowerCase());
    if (idx >= 0) {
      setActive(idx);
      // Jump back to the top of the reading pane on chapter switch.
      const body = document.getElementById("guide-scroll-body");
      if (body) body.scrollTop = 0;
    }
  }

  function pickChapter(idx) {
    setActive(idx);
    setTocOpen(false);
    const body = document.getElementById("guide-scroll-body");
    if (body) body.scrollTop = 0;
  }

  const components = makeGuideComponents(navigateToFile, isMobile);
  const chapter = CHAPTERS[active];

  return (
    <ModalRoot onClose={onClose}>
      <div onClick={onClose} style={s.modalOverlay(isMobile)}>
        <div onClick={e => e.stopPropagation()}
          style={{
            ...s.modalCard(isMobile, { maxWidth: 760, bg: "var(--bg)" }),
            display: "flex", flexDirection: "column",
            padding: 0,
          }}>
          {/* Header — title + chapter selector + close. Sticky so it stays put
              while the body scrolls. */}
          <div style={{
            flexShrink: 0,
            borderBottom: "1px solid var(--rule)",
            padding: isMobile ? "calc(env(safe-area-inset-top) + 14px) 16px 12px" : "18px 22px 14px",
            background: "var(--bg-elevated)",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: "var(--ink-1)" }}>{t("settings.guide")}</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {onReplayTour && (
                  <button onClick={onReplayTour}
                    style={{ ...s.btnGhost, fontSize: 12, padding: "5px 10px", minHeight: 0, flexShrink: 0 }}>
                    {t("tour.replay")}
                  </button>
                )}
                <button onClick={onClose} style={s.modalCloseBtn} aria-label="Close">×</button>
              </div>
            </div>
            {/* Inline TOC dropdown — opens a list right under the box instead
                of the OS's full-screen native <select> picker. */}
            <div ref={tocRef} style={{ position: "relative" }}>
              <button
                onClick={() => setTocOpen(o => !o)}
                style={{
                  ...s.input, height: 40, fontSize: 14, padding: "0 12px",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  cursor: "pointer", textAlign: "left",
                }}>
                <span style={{ color: "var(--ink-1)", fontWeight: 500 }}>{chapter.title}</span>
                <span style={{ fontSize: 10, color: "var(--ink-3)", marginLeft: 8 }}>
                  {tocOpen ? "▲" : "▼"}
                </span>
              </button>
              {tocOpen && (
                <div style={{
                  position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--rule)", borderRadius: 4,
                  padding: "4px 0",
                  boxShadow: "0 8px 24px rgba(20,20,19,0.12)",
                  zIndex: 50,
                  maxHeight: "60vh", overflowY: "auto",
                  WebkitOverflowScrolling: "touch",
                }}>
                  {CHAPTERS.map((c, i) => (
                    <button key={c.file} onClick={() => pickChapter(i)}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        width: "100%", textAlign: "left",
                        background: i === active ? "var(--bg-sunken)" : "transparent",
                        border: "none", padding: "11px 14px",
                        fontFamily: "var(--font-sans)", fontSize: 14,
                        color: "var(--ink-1)", cursor: "pointer",
                        fontWeight: i === active ? 600 : 400, borderRadius: 0,
                      }}>
                      <span>{c.title}</span>
                      {i === active && <span style={{ color: "var(--moss)", fontSize: 13 }}>●</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Scrollable reading pane. */}
          <div id="guide-scroll-body" style={{
            flex: 1, minHeight: 0, overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            padding: isMobile ? "16px 16px calc(env(safe-area-inset-bottom) + 24px)" : "20px 24px 28px",
          }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
              {chapter.md}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </ModalRoot>
  );
}
