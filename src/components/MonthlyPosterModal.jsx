import { useMemo, useRef, useState } from "react";
import { RUN_GROUP_TYPES } from "../constants";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { formatDurationShort } from "../utils/format";
import { s } from "../styles";
import { ModalRoot } from "./ModalRoot";

const POSTER_W = 1080;
const POSTER_H = 1920;
const TEMPLATES = ["classic", "bib", "topo"];

function fmtNum(n, digits = 0) {
  return Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function monthTitle(date, lang) {
  if (lang === "zh") return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}`;
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase();
}

function buildMonthlyStats(logs, lang) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const monthLogs = logs.filter(l => {
    if (l.isPlanned || !RUN_GROUP_TYPES.includes(l.type)) return false;
    const d = new Date(l.date);
    return d >= start && d < end;
  });

  const totalKm = monthLogs.reduce((sum, l) => sum + (Number(l.distance) || 0), 0);
  const totalSec = monthLogs.reduce((sum, l) => sum + (Number(l.duration) || 0), 0);
  const totalAscent = monthLogs.reduce((sum, l) => sum + (Number(l.ascent) || 0), 0);
  const longest = monthLogs.reduce((best, l) => (Number(l.distance) || 0) > (Number(best?.distance) || 0) ? l : best, null);
  const activeDays = new Set(monthLogs.map(l => l.date)).size;

  return {
    monthLabel: monthTitle(now, lang),
    fileLabel: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    totalKm,
    sessions: monthLogs.length,
    activeDays,
    totalSec,
    totalAscent,
    longestKm: Number(longest?.distance) || 0,
  };
}

function brandMark({ x = 832, y = 118, ink = "#141413", muted = "#74736b", dark = false }) {
  const bg = dark ? "#f4f0e4" : "none";
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="0" y="0" width="54" height="54" rx="0" fill={bg} stroke={ink} strokeWidth="4" />
      <path d="M16 36 L27 13 L38 36 M21 28 H33" fill="none" stroke={ink} strokeWidth="5" strokeLinecap="square" strokeLinejoin="miter" />
      <text x="68" y="22" fill={ink} fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="20" fontWeight="800" letterSpacing="2.4">
        AI TRAIN
      </text>
      <text x="68" y="48" fill={muted} fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="18" fontWeight="700" letterSpacing="2.1">
        STUDIO
      </text>
    </g>
  );
}

function signature({ y = 1792, ink = "#141413", opacity = 0.78 }) {
  return (
    <text
      x="540"
      y={y}
      textAnchor="middle"
      fill={ink}
      opacity={opacity}
      fontFamily="Brush Script MT, Segoe Script, Georgia, serif"
      fontSize="68"
      fontStyle="italic"
    >
      Training Studio
    </text>
  );
}

function metricCards(stats, t, palette, x = 110, y = 790) {
  const items = [
    [t("poster.sessions"), fmtNum(stats.sessions)],
    [t("poster.time"), formatDurationShort(stats.totalSec)],
    [t("poster.longest"), `${fmtNum(stats.longestKm, 1)} km`],
    [t("poster.ascent"), `+${fmtNum(stats.totalAscent)} m`],
  ];

  return (
    <g transform={`translate(${x} ${y})`}>
      {items.map(([label, value], i) => (
        <g key={label} transform={`translate(${(i % 2) * 430} ${Math.floor(i / 2) * 170})`}>
          <rect x="0" y="0" width="388" height="130" fill={palette.card} stroke={palette.rule} strokeWidth="2" />
          <text x="28" y="43" fill={palette.muted} fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="24" fontWeight="700" letterSpacing="2">
            {label}
          </text>
          <text x="28" y="100" fill={palette.ink} fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="44" fontWeight="800">
            {value}
          </text>
        </g>
      ))}
    </g>
  );
}

function monthLine(stats, t, palette, y = 1288) {
  return (
    <g>
      <rect x="110" y={y - 74} width="860" height="2" fill={palette.ruleStrong} />
      <text x="110" y={y} fill={palette.ink} fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="34" fontWeight="800">
        {t("poster.active_days")} {fmtNum(stats.activeDays)}
      </text>
      <text x="970" y={y} textAnchor="end" fill={palette.muted} fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="28">
        {t("poster.monthly_note")}
      </text>
    </g>
  );
}

function ClassicPoster({ stats, t, svgRef }) {
  const palette = {
    ink: "#141413",
    muted: "#74736b",
    rule: "#d1cfc6",
    ruleStrong: "#141413",
    card: "#fafaf7",
  };

  return (
    <svg viewBox={`0 0 ${POSTER_W} ${POSTER_H}`} width={POSTER_W} height={POSTER_H} xmlns="http://www.w3.org/2000/svg" ref={svgRef}
      role="img" aria-label={t("poster.monthly_title")} style={{ width: "100%", height: "auto", display: "block", background: "#f2f1ec" }}>
      <rect width={POSTER_W} height={POSTER_H} fill="#f2f1ec" />
      <circle cx="160" cy="180" r="360" fill="#4a5e3a" opacity="0.055" />
      <circle cx="1040" cy="120" r="420" fill="#141413" opacity="0.035" />
      <g fill="none" stroke="#141413" strokeWidth="1.2" opacity="0.06">
        <path d="M-80 420 C 160 300, 320 520, 540 390 S 900 250, 1180 380" />
        <path d="M-80 500 C 190 370, 360 600, 600 455 S 930 340, 1180 455" />
        <path d="M-80 1260 C 220 1110, 390 1360, 650 1190 S 900 1110, 1180 1260" />
        <path d="M-80 1350 C 240 1190, 420 1450, 700 1270 S 960 1210, 1180 1350" />
      </g>
      <rect x="58" y="58" width="964" height="1804" fill="none" stroke="#141413" strokeWidth="3" />
      <rect x="82" y="82" width="916" height="1756" fill="none" stroke="#d1cfc6" strokeWidth="2" />

      {brandMark({})}
      <text x="110" y="178" fill="#57564f" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="34" fontWeight="700" letterSpacing="4">
        {t("poster.monthly_title")}
      </text>
      <text x="110" y="234" fill="#9b9991" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="28" letterSpacing="2">
        {stats.monthLabel}
      </text>

      <line x1="110" y1="318" x2="970" y2="318" stroke="#141413" strokeWidth="3" />
      <text x="110" y="590" fill="#141413" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="245" fontWeight="800">
        {fmtNum(stats.totalKm, 1)}
      </text>
      <text x="824" y="570" fill="#57564f" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="62" fontWeight="800">
        km
      </text>
      <text x="112" y="666" fill="#57564f" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="32" fontWeight="700">
        {t("poster.monthly_subtitle")}
      </text>

      {metricCards(stats, t, palette)}
      {monthLine(stats, t, palette)}
      <text x="540" y="1518" textAnchor="middle" fill="#4a5e3a" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="38" fontWeight="800" letterSpacing="2">
        www.aitrainstudio.com
      </text>
      {signature({ y: 1718 })}
    </svg>
  );
}

function BibPoster({ stats, t, svgRef }) {
  const palette = {
    ink: "#11100d",
    muted: "#756b55",
    rule: "#11100d",
    ruleStrong: "#11100d",
    card: "#fff9e6",
  };

  return (
    <svg viewBox={`0 0 ${POSTER_W} ${POSTER_H}`} width={POSTER_W} height={POSTER_H} xmlns="http://www.w3.org/2000/svg" ref={svgRef}
      role="img" aria-label={t("poster.monthly_title")} style={{ width: "100%", height: "auto", display: "block", background: "#d84a32" }}>
      <rect width={POSTER_W} height={POSTER_H} fill="#d84a32" />
      <rect x="82" y="92" width="916" height="1736" fill="#fff9e6" stroke="#11100d" strokeWidth="7" />
      <rect x="116" y="126" width="848" height="1668" fill="none" stroke="#11100d" strokeWidth="3" strokeDasharray="16 14" />
      {[0, 1, 2, 3, 4, 5].map(i => (
        <circle key={i} cx={164 + i * 150} cy="210" r="19" fill="#d84a32" stroke="#11100d" strokeWidth="5" />
      ))}
      {[0, 1, 2, 3, 4, 5].map(i => (
        <circle key={i} cx={164 + i * 150} cy="1710" r="19" fill="#d84a32" stroke="#11100d" strokeWidth="5" />
      ))}

      {brandMark({ x: 765, y: 160, ink: "#11100d", muted: "#756b55" })}
      <text x="150" y="190" fill="#11100d" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="42" fontWeight="900" letterSpacing="3">
        {t("poster.template_bib")}
      </text>
      <text x="150" y="250" fill="#756b55" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="30" fontWeight="800" letterSpacing="3">
        {stats.monthLabel}
      </text>

      <rect x="150" y="344" width="780" height="118" fill="#11100d" />
      <text x="540" y="424" textAnchor="middle" fill="#fff9e6" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="58" fontWeight="900" letterSpacing="5">
        MONTHLY RUNNER
      </text>

      <text x="540" y="780" textAnchor="middle" fill="#11100d" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="278" fontWeight="900">
        {fmtNum(stats.totalKm, 1)}
      </text>
      <text x="540" y="872" textAnchor="middle" fill="#11100d" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="76" fontWeight="900" letterSpacing="9">
        KILOMETERS
      </text>

      {metricCards(stats, t, palette, 150, 1010)}
      {monthLine(stats, t, palette, 1478)}
      <text x="540" y="1588" textAnchor="middle" fill="#11100d" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="36" fontWeight="900" letterSpacing="3">
        www.aitrainstudio.com
      </text>
      {signature({ y: 1718, ink: "#11100d", opacity: 0.82 })}
    </svg>
  );
}

function TopoPoster({ stats, t, svgRef }) {
  const palette = {
    ink: "#f7f0dc",
    muted: "#b9c0a2",
    rule: "#5d6b45",
    ruleStrong: "#dce8a8",
    card: "#253119",
  };

  return (
    <svg viewBox={`0 0 ${POSTER_W} ${POSTER_H}`} width={POSTER_W} height={POSTER_H} xmlns="http://www.w3.org/2000/svg" ref={svgRef}
      role="img" aria-label={t("poster.monthly_title")} style={{ width: "100%", height: "auto", display: "block", background: "#172014" }}>
      <rect width={POSTER_W} height={POSTER_H} fill="#172014" />
      <rect x="0" y="0" width="1080" height="1920" fill="#172014" />
      <g fill="none" stroke="#dce8a8" strokeWidth="1.5" opacity="0.14">
        {Array.from({ length: 18 }, (_, i) => (
          <path key={i} d={`M-120 ${250 + i * 84} C 110 ${145 + i * 48}, 290 ${360 + i * 68}, 520 ${250 + i * 58} S 840 ${90 + i * 72}, 1200 ${250 + i * 52}`} />
        ))}
      </g>
      <rect x="58" y="58" width="964" height="1804" fill="none" stroke="#dce8a8" strokeWidth="2" opacity="0.75" />
      <rect x="94" y="94" width="892" height="1732" fill="none" stroke="#5d6b45" strokeWidth="2" />

      {brandMark({ x: 760, y: 142, ink: "#f7f0dc", muted: "#b9c0a2", dark: false })}
      <text x="112" y="192" fill="#dce8a8" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="34" fontWeight="800" letterSpacing="5">
        {t("poster.template_topo")}
      </text>
      <text x="112" y="250" fill="#b9c0a2" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="28" fontWeight="700" letterSpacing="3">
        {stats.monthLabel}
      </text>

      <text x="112" y="620" fill="#f7f0dc" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="238" fontWeight="900">
        {fmtNum(stats.totalKm, 1)}
      </text>
      <text x="824" y="602" fill="#dce8a8" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="58" fontWeight="900">
        km
      </text>
      <text x="116" y="700" fill="#b9c0a2" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="33" fontWeight="700">
        {t("poster.monthly_subtitle")}
      </text>

      {metricCards(stats, t, palette, 112, 840)}
      {monthLine(stats, t, palette, 1320)}
      <text x="540" y="1540" textAnchor="middle" fill="#dce8a8" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="36" fontWeight="900" letterSpacing="3">
        www.aitrainstudio.com
      </text>
      {signature({ y: 1730, ink: "#f7f0dc", opacity: 0.8 })}
    </svg>
  );
}

function PosterSvg({ template, stats, t, svgRef }) {
  if (template === "bib") return <BibPoster stats={stats} t={t} svgRef={svgRef} />;
  if (template === "topo") return <TopoPoster stats={stats} t={t} svgRef={svgRef} />;
  return <ClassicPoster stats={stats} t={t} svgRef={svgRef} />;
}

export function MonthlyPosterModal({ logs, onClose }) {
  const t = useT();
  const { lang } = useLanguage();
  const svgRef = useRef(null);
  const [template, setTemplate] = useState("classic");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const stats = useMemo(() => buildMonthlyStats(logs || [], lang), [logs, lang]);

  async function downloadPoster() {
    if (!svgRef.current || busy) return;
    setBusy(true);
    setMsg("");
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      const svgText = new XMLSerializer().serializeToString(svgRef.current);
      const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
      const svgUrl = URL.createObjectURL(svgBlob);
      const img = new Image();
      const loaded = new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      img.src = svgUrl;
      await loaded;
      const canvas = document.createElement("canvas");
      canvas.width = POSTER_W;
      canvas.height = POSTER_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.drawImage(img, 0, 0, POSTER_W, POSTER_H);
      URL.revokeObjectURL(svgUrl);

      const pngBlob = await new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG export failed")), "image/png");
      });
      const pngUrl = URL.createObjectURL(pngBlob);
      const a = document.createElement("a");
      a.href = pngUrl;
      a.download = `training-studio-monthly-${stats.fileLabel}-${template}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(pngUrl);
      setMsg(t("poster.downloaded"));
    } catch {
      setMsg(t("poster.download_failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalRoot onClose={onClose}>
      <div onClick={onClose} style={s.modalOverlay(true, { float: true })}>
        <div onClick={e => e.stopPropagation()}
          style={s.modalCard(true, { maxWidth: 520, bg: "var(--bg)", float: true })}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{t("poster.preview_title")}</h2>
              <div style={{ ...s.muted, marginTop: 3 }}>{stats.monthLabel}</div>
            </div>
            <button onClick={onClose} style={s.modalCloseBtn} aria-label="Close">x</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6, marginBottom: 12 }}>
            {TEMPLATES.map(id => {
              const active = template === id;
              return (
                <button key={id} onClick={() => setTemplate(id)}
                  style={{
                    ...s.chip(active),
                    minHeight: 36,
                    minWidth: 0,
                    padding: "0 8px",
                    fontSize: 12,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                  {t(`poster.template_${id}`)}
                </button>
              );
            })}
          </div>

          <div style={{
            width: "100%",
            maxWidth: 360,
            margin: "0 auto 14px",
            border: "1px solid var(--rule)",
            background: "var(--bg-elevated)",
          }}>
            <PosterSvg template={template} svgRef={svgRef} stats={stats} t={t} />
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
            {msg && <span style={{ ...s.muted, marginRight: "auto" }}>{msg}</span>}
            <button onClick={onClose} style={s.btnGhost}>{t("common.cancel")}</button>
            <button onClick={downloadPoster} disabled={busy}
              style={{ ...s.btn, opacity: busy ? 0.6 : 1 }}>
              {busy ? t("poster.saving") : t("poster.save_png")}
            </button>
          </div>
        </div>
      </div>
    </ModalRoot>
  );
}
