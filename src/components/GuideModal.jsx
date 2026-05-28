import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { s } from "../styles";
import { useT } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { ModalRoot } from "./ModalRoot";

// Bundle the user manual straight into the app. Vite's `?raw` suffix inlines
// each markdown file as a string at build time, so the guide works offline and
// opens in-app (no jump to the external GitBook). docs/ lives at the project
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
  { file: "running.md",      title: "配速分类",          md: runningMd },
  { file: "data-import.md",  title: "数据导入",          md: dataImportMd },
  { file: "races.md",        title: "赛事管理",          md: racesMd },
  { file: "weather.md",      title: "天气",              md: weatherMd },
  { file: "ai-coach.md",     title: "AI 教练",           md: aiCoachMd },
  { file: "charts.md",       title: "图表",              md: chartsMd },
  { file: "changelog.md",    title: "更新日志",          md: changelogMd },
];

// Reading-mode markdown renderers — document-scale typography (bigger than the
// chat bubbles), tuned to the app's ink/moss palette. `onNavigate(file)` lets
// internal .md links switch chapters instead of 404-ing.
function makeGuideComponents(onNavigate) {
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
    table: (p) => (
      <div style={{ overflowX: "auto", maxWidth: "100%", margin: "8px 0 14px" }}>
        <table {...strip(p)} style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: "max-content" }} />
      </div>
    ),
    th: (p) => <th {...strip(p)} style={{ border: "1px solid var(--rule)", padding: "6px 9px", textAlign: "left", fontWeight: 600, background: "var(--bg-sunken)", whiteSpace: "nowrap" }} />,
    td: (p) => <td {...strip(p)} style={{ border: "1px solid var(--rule)", padding: "6px 9px", verticalAlign: "top" }} />,
  };
}

export function GuideModal({ onClose }) {
  const t = useT();
  const isMobile = useIsMobile();
  const [active, setActive] = useState(0);

  function navigateToFile(file) {
    const idx = CHAPTERS.findIndex(c => c.file.toLowerCase() === file.toLowerCase());
    if (idx >= 0) {
      setActive(idx);
      // Jump back to the top of the reading pane on chapter switch.
      const body = document.getElementById("guide-scroll-body");
      if (body) body.scrollTop = 0;
    }
  }

  const components = makeGuideComponents(navigateToFile);
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
              <button onClick={onClose} style={s.modalCloseBtn} aria-label="Close">×</button>
            </div>
            <select
              value={active}
              onChange={e => navigateToFile(CHAPTERS[Number(e.target.value)].file)}
              style={{ ...s.input, height: 40, fontSize: 14, padding: "0 10px" }}>
              {CHAPTERS.map((c, i) => (
                <option key={c.file} value={i}>{c.title}</option>
              ))}
            </select>
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
