import { useMemo, useState } from "react";
import { s } from "../styles";
import { useT } from "../i18n/LanguageContext";
import { ModalRoot } from "./ModalRoot";
import * as db from "../lib/db";
import { formatDuration, formatPaceFromSec } from "../utils/format";
import { buildDataBlock } from "../utils/coachPrompt";

const STORAGE_KEY_PREFIX = "ultreia.weeklyReports.v1";
const KEEP_REPORTS = 8;

function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(dateKey, days) {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localDateKey(d);
}

function weekWindow(now, offsetWeeks = 0) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetWeeks * 7);
  const mondayOffset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - mondayOffset);
  const start = localDateKey(d);
  return {
    start,
    end: addDays(start, 6),
    nextStart: addDays(start, 7),
    nextEnd: addDays(start, 13),
  };
}

function storageKey(scope) {
  return `${STORAGE_KEY_PREFIX}.${scope || "default"}`;
}

function loadStoredReports(scope) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(scope)) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStoredReports(scope, reports) {
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify(reports.slice(0, KEEP_REPORTS)));
  } catch {
    // localStorage may be unavailable in private mode; the in-session state
    // still keeps the report visible until the app reloads.
  }
}

function fmtWorkout(w) {
  const bits = [w.date, w.type];
  if (Array.isArray(w.subTypes) && w.subTypes.length) bits.push(w.subTypes.join("/"));
  if (w.distance > 0) bits.push(`${Number(w.distance).toFixed(1)} km`);
  if (w.ascent > 0) bits.push(`+${Math.round(w.ascent)} m`);
  if (w.duration > 0) bits.push(formatDuration(w.duration));
  if (w.pace > 0) bits.push(`${formatPaceFromSec(w.pace)}/km`);
  if (w.hr > 0) bits.push(`avg HR ${w.hr}`);
  if (w.maxHR > 0) bits.push(`max HR ${w.maxHR}`);
  if (w.rpe > 0) bits.push(`RPE ${w.rpe}`);
  if (w.aerobicTE > 0) bits.push(`TE ${w.aerobicTE}`);
  if (w.note) bits.push(`note: ${String(w.note).replace(/\s+/g, " ").slice(0, 180)}`);
  return `- ${bits.join(" · ")}`;
}

function fmtDailyNote(n) {
  const parts = [n.date];
  if (Array.isArray(n.tags) && n.tags.length) parts.push(`tags: ${n.tags.join(", ")}`);
  if (n.readiness && typeof n.readiness === "object") {
    const r = n.readiness;
    const bits = [];
    for (const key of ["sleep", "soreness", "fatigue", "motivation", "stress", "legs"]) {
      if (r[key] != null && r[key] !== "") bits.push(`${key}:${r[key]}`);
    }
    if (bits.length) parts.push(`readiness: ${bits.join(", ")}`);
  }
  if (n.note) parts.push(`note: ${String(n.note).replace(/\s+/g, " ").slice(0, 160)}`);
  return `- ${parts.join(" · ")}`;
}

function buildWeeklyReportPrompt({ lang, profile, coachConfig, coachMemory, logs, races, dailyNotes, now, range }) {
  const completed = logs
    .filter(w => !w.isPlanned && w.date >= range.start && w.date <= range.end)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const plannedThisWeek = logs
    .filter(w => w.isPlanned && w.date >= range.start && w.date <= range.end)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const plannedNextWeek = logs
    .filter(w => w.isPlanned && w.date >= range.nextStart && w.date <= range.nextEnd)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const notes = dailyNotes
    .filter(n => n.date >= range.start && n.date <= range.end)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const targetRaces = races
    .filter(r => r.isTarget && r.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(0, 5);
  const totalKm = completed.reduce((sum, w) => sum + (Number(w.distance) || 0), 0);
  const totalAscent = completed.reduce((sum, w) => sum + (Number(w.ascent) || 0), 0);
  const totalSec = completed.reduce((sum, w) => sum + (Number(w.duration) || 0), 0);
  const languageName = lang === "zh" ? "简体中文" : "English";

  const system =
    `You are an expert endurance running coach for trail running and hybrid fitness. ` +
    `Write a detailed weekly training report in ${languageName}. Be professional, concrete, and opinionated. ` +
    `Do not write a short push notification. This is a full report page.`;

  const profileBlock = buildDataBlock({ logs, races, now, lang: "en", dailyNotes });
  const user =
    `Report range: ${range.start} to ${range.end}. Next plan range: ${range.nextStart} to ${range.nextEnd}.\n\n` +
    `[Runner profile and longer context]\n${profileBlock}\n\n` +
    `[Coach preference]\n${JSON.stringify(coachConfig || {})}\n\n` +
    `[Coach memory]\n${coachMemory || profile?.coachMemory || "none"}\n\n` +
    `[This week completed workouts]\n${completed.length ? completed.map(fmtWorkout).join("\n") : "none"}\n\n` +
    `[This week planned workouts]\n${plannedThisWeek.length ? plannedThisWeek.map(fmtWorkout).join("\n") : "none"}\n\n` +
    `[Next week existing plans]\n${plannedNextWeek.length ? plannedNextWeek.map(fmtWorkout).join("\n") : "none"}\n\n` +
    `[Daily readiness / notes]\n${notes.length ? notes.map(fmtDailyNote).join("\n") : "none"}\n\n` +
    `[Target races]\n${targetRaces.length ? targetRaces.map(r => `- ${r.date} · ${r.name || r.category || "race"} · ${r.category || ""} · ${r.priority || ""}`).join("\n") : "none"}\n\n` +
    `[Weekly totals]\n- workouts: ${completed.length}\n- distance: ${totalKm.toFixed(1)} km\n- ascent: ${Math.round(totalAscent)} m\n- duration: ${formatDuration(totalSec)}\n\n` +
    `[Output requirements]\n` +
    `1. Use clear section headings. Long output is OK; do not compress important points.\n` +
    `2. First give an executive summary: what went well, what is risky, what needs to change.\n` +
    `3. Then review EACH completed workout one by one. For every workout, mention date/type/key metrics, what the session likely achieved, whether intensity was appropriate, and one concrete lesson.\n` +
    `4. Compare completed work against planned work when possible. Point out skipped strength or missed key sessions.\n` +
    `5. Interpret fatigue/readiness/RPE/HR in context. Avoid generic motivational text.\n` +
    `6. Give a detailed next 7-day training plan for ${range.nextStart} to ${range.nextEnd}. Include exact dates, workout type, distance/ascent/duration where applicable, intensity target, and purpose. Include rest days explicitly when needed.\n` +
    `7. If a plan should replace existing next-week plans, say why.\n` +
    `8. End with a short checklist of what the runner should watch next week.\n` +
    `9. Do not mention tokens, APIs, wallet, database, prompt, or internal implementation.`;

  return { system, user };
}

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

export function WeeklyReportModal({
  logs,
  races,
  dailyNotes,
  profile,
  coachConfig,
  coachMemory,
  lang,
  now,
  onClose,
  onImportPlan,
  onWalletBalance,
  storageScope,
}) {
  const t = useT();
  const [reports, setReports] = useState(() => loadStoredReports(storageScope));
  const [rangeMode, setRangeMode] = useState("this");
  const [selectedId, setSelectedId] = useState(() => loadStoredReports(storageScope)[0]?.id || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isZh = lang === "zh";
  const range = useMemo(() => weekWindow(now || new Date(), rangeMode === "last" ? -1 : 0), [now, rangeMode]);
  const selected = reports.find(r => r.id === selectedId) || reports[0] || null;

  async function generate() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const prompt = buildWeeklyReportPrompt({
        lang,
        profile,
        coachConfig,
        coachMemory,
        logs,
        races,
        dailyNotes,
        now: now || new Date(),
        range,
      });
      const data = await db.usage.coachProxy({
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
        max_tokens: 8000,
      });
      if (typeof data.wallet?.balance_cents === "number") onWalletBalance?.(data.wallet.balance_cents);
      const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("") || "";
      const report = {
        id: `${range.start}:${Date.now()}`,
        rangeMode,
        start: range.start,
        end: range.end,
        nextStart: range.nextStart,
        nextEnd: range.nextEnd,
        generatedAt: new Date().toISOString(),
        text,
      };
      const next = [report, ...reports.filter(r => r.id !== report.id)].slice(0, KEEP_REPORTS);
      setReports(next);
      saveStoredReports(storageScope, next);
      setSelectedId(report.id);
    } catch (err) {
      if (err?.code === "insufficient_balance") setError(t("wallet.insufficient_ai"));
      else setError(t("weekly_report.generate_failed", { msg: err?.message || String(err) }));
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalRoot onClose={onClose}>
      <div onClick={onClose} className="ultreia-overlay-in" style={{
        position: "fixed", inset: 0,
        background: "rgba(20,20,19,0.45)",
        backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 9999, padding: 12, overscrollBehavior: "contain",
      }}>
        <div onClick={e => e.stopPropagation()} className="ultreia-modal-in" style={{
          background: "var(--bg)",
          border: "1px solid var(--rule)",
          borderRadius: 4,
          boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
          width: "100%", maxWidth: 760, height: "min(820px, calc(100dvh - 24px))",
          display: "flex", flexDirection: "column",
          fontFamily: "var(--font-sans)",
        }}>
          <div style={{
            padding: "18px 18px 12px",
            borderBottom: "1px solid var(--rule)",
            display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
          }}>
            <div>
              <div style={{ ...s.label, marginBottom: 5 }}>{t("weekly_report.kicker")}</div>
              <h2 style={{ fontSize: 20, fontWeight: 650, margin: 0 }}>{t("weekly_report.title")}</h2>
              <div style={{ ...s.muted, fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
                {isZh ? `${range.start} 至 ${range.end}` : `${range.start} to ${range.end}`}
              </div>
            </div>
            <button onClick={onClose} style={s.modalCloseBtn} aria-label="Close">×</button>
          </div>

          <div style={{
            padding: "12px 18px",
            borderBottom: "1px solid var(--rule-soft)",
            display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center",
          }}>
            <button onClick={() => setRangeMode("this")} style={rangeMode === "this" ? s.btn : s.btnGhost}>
              {t("weekly_report.this_week")}
            </button>
            <button onClick={() => setRangeMode("last")} style={rangeMode === "last" ? s.btn : s.btnGhost}>
              {t("weekly_report.last_week")}
            </button>
            <button onClick={generate} disabled={loading} style={{ ...s.btn, marginLeft: "auto", opacity: loading ? 0.7 : 1 }}>
              {loading ? t("weekly_report.generating") : t("weekly_report.generate")}
            </button>
          </div>

          {reports.length > 0 && (
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

          <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px 20px" }}>
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
            borderTop: "1px solid var(--rule)",
            padding: "12px 18px",
            display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center",
            flexWrap: "wrap",
          }}>
            <div style={{ ...s.muted, fontSize: 11, lineHeight: 1.5, maxWidth: 430 }}>
              {t("weekly_report.local_note")}
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
      </div>
    </ModalRoot>
  );
}
