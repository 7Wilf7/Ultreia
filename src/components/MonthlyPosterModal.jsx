import { useMemo, useRef, useState } from "react";
import { RUN_GROUP_TYPES } from "../constants";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { formatDurationShort } from "../utils/format";
import { s } from "../styles";
import { ModalRoot } from "./ModalRoot";

const POSTER_W = 1080;
const POSTER_H = 1920;

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
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  const monthLogs = logs.filter(l => {
    if (l.isPlanned || !RUN_GROUP_TYPES.includes(l.type)) return false;
    const d = new Date(l.date);
    return d >= start && d < end;
  });

  const daily = Array.from({ length: days }, (_, i) => ({ day: i + 1, km: 0 }));
  for (const l of monthLogs) {
    const d = new Date(l.date);
    daily[d.getDate() - 1].km += Number(l.distance) || 0;
  }

  const weeks = [];
  for (let i = 0; i < daily.length; i += 7) {
    const chunk = daily.slice(i, i + 7);
    weeks.push({
      label: `${chunk[0].day}-${chunk[chunk.length - 1].day}`,
      km: chunk.reduce((sum, d) => sum + d.km, 0),
    });
  }

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
    weeks,
    maxWeekKm: Math.max(...weeks.map(w => w.km), 1),
  };
}

function PosterSvg({ stats, t, svgRef }) {
  const bars = stats.weeks.map((w, i) => {
    const h = Math.max(12, (w.km / stats.maxWeekKm) * 260);
    return { ...w, x: 142 + i * 150, y: 1370 - h, h };
  });

  return (
    <svg
      viewBox={`0 0 ${POSTER_W} ${POSTER_H}`}
      width={POSTER_W}
      height={POSTER_H}
      xmlns="http://www.w3.org/2000/svg"
      ref={svgRef}
      role="img"
      aria-label={t("poster.monthly_title")}
      style={{ width: "100%", height: "auto", display: "block", background: "#f2f1ec" }}
    >
      <rect width={POSTER_W} height={POSTER_H} fill="#f2f1ec" />
      <circle cx="160" cy="180" r="360" fill="#4a5e3a" opacity="0.055" />
      <circle cx="1040" cy="120" r="420" fill="#141413" opacity="0.035" />
      <g fill="none" stroke="#141413" strokeWidth="1.2" opacity="0.07">
        <path d="M-80 420 C 160 300, 320 520, 540 390 S 900 250, 1180 380" />
        <path d="M-80 480 C 180 360, 360 590, 570 455 S 910 330, 1180 455" />
        <path d="M-80 545 C 200 430, 370 650, 600 520 S 930 410, 1180 530" />
        <path d="M-80 1280 C 220 1110, 390 1360, 650 1190 S 900 1110, 1180 1260" />
        <path d="M-80 1360 C 240 1190, 420 1450, 700 1270 S 960 1210, 1180 1350" />
      </g>
      <rect x="58" y="58" width="964" height="1804" fill="none" stroke="#141413" strokeWidth="3" />
      <rect x="82" y="82" width="916" height="1756" fill="none" stroke="#d1cfc6" strokeWidth="2" />

      <text x="110" y="178" fill="#57564f" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="34" fontWeight="600" letterSpacing="4">
        {t("poster.monthly_title")}
      </text>
      <text x="110" y="232" fill="#9b9991" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="28" letterSpacing="2">
        {stats.monthLabel}
      </text>
      <text x="970" y="178" textAnchor="end" fill="#141413" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="28" fontWeight="600">
        TRAINING STUDIO
      </text>

      <line x1="110" y1="308" x2="970" y2="308" stroke="#141413" strokeWidth="3" />
      <text x="110" y="560" fill="#141413" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="220" fontWeight="600" letterSpacing="-3">
        {fmtNum(stats.totalKm, 1)}
      </text>
      <text x="820" y="548" fill="#57564f" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="62" fontWeight="600">
        km
      </text>
      <text x="112" y="638" fill="#57564f" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="32">
        {t("poster.monthly_subtitle")}
      </text>

      <g transform="translate(110 760)">
        {[
          [t("poster.sessions"), fmtNum(stats.sessions)],
          [t("poster.time"), formatDurationShort(stats.totalSec)],
          [t("poster.ascent"), `+${fmtNum(stats.totalAscent)} m`],
          [t("poster.longest"), `${fmtNum(stats.longestKm, 1)} km`],
        ].map(([label, value], i) => (
          <g key={label} transform={`translate(${(i % 2) * 430} ${Math.floor(i / 2) * 172})`}>
            <rect x="0" y="0" width="390" height="132" fill="#fafaf7" stroke="#d1cfc6" strokeWidth="2" />
            <text x="28" y="45" fill="#9b9991" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="25" letterSpacing="2">
              {label}
            </text>
            <text x="28" y="102" fill="#141413" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="45" fontWeight="600">
              {value}
            </text>
          </g>
        ))}
      </g>

      <text x="110" y="1196" fill="#141413" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="38" fontWeight="600">
        {t("poster.weekly_bars")}
      </text>
      <line x1="110" y1="1400" x2="970" y2="1400" stroke="#d1cfc6" strokeWidth="2" />
      {bars.map((b) => (
        <g key={b.label}>
          <rect x={b.x} y={b.y} width="86" height={b.h} fill="#4a5e3a" />
          <text x={b.x + 43} y={b.y - 20} textAnchor="middle" fill="#141413" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="26" fontWeight="600">
            {fmtNum(b.km, 1)}
          </text>
          <text x={b.x + 43} y="1452" textAnchor="middle" fill="#9b9991" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="24">
            {b.label}
          </text>
        </g>
      ))}

      <rect x="110" y="1548" width="860" height="2" fill="#141413" />
      <text x="110" y="1618" fill="#57564f" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="30">
        {t("poster.active_days")}  {fmtNum(stats.activeDays)}
      </text>
      <text x="110" y="1672" fill="#9b9991" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="24">
        {t("poster.monthly_note")}
      </text>
      <text x="970" y="1765" textAnchor="end" fill="#141413" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="34" fontWeight="600">
        www.aitrainstudio.com
      </text>
    </svg>
  );
}

export function MonthlyPosterModal({ logs, onClose }) {
  const t = useT();
  const { lang } = useLanguage();
  const svgRef = useRef(null);
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
      a.download = `training-studio-monthly-${stats.fileLabel}.png`;
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

          <div style={{
            width: "100%",
            maxWidth: 360,
            margin: "0 auto 14px",
            border: "1px solid var(--rule)",
            background: "var(--bg-elevated)",
          }}>
            <PosterSvg svgRef={svgRef} stats={stats} t={t} />
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
