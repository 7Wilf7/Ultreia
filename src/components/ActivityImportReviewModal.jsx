import { useMemo, useState } from "react";
import { s } from "../styles";
import { useIsMobile } from "../hooks/useMediaQuery";
import { useT } from "../i18n/LanguageContext";
import { formatDuration, formatPaceFromSec } from "../utils/format";
import { weatherWindowEligible } from "../lib/weather";
import { ModalRoot } from "./ModalRoot";

const DETAIL_LIMIT = 5;
const COACH_LIMIT = 3;

function clampRpe(raw) {
  if (raw === "") return "";
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return "";
  return String(Math.max(1, Math.min(10, n)));
}

function workoutSummary(w) {
  const subTypes = (w.subTypes || []).filter(Boolean).join(", ");
  const bits = [
    w.distance ? `${w.distance} km` : null,
    w.duration ? formatDuration(w.duration) : null,
    w.pace ? `${formatPaceFromSec(w.pace)} /km` : null,
    w.ascent ? `+${w.ascent} m` : null,
    w.hr ? `HR ${w.hr}` : null,
  ].filter(Boolean);
  return {
    title: `${w.date || ""} · ${w.type || "Activity"}${subTypes ? ` (${subTypes})` : ""}`,
    meta: bits.join(" · "),
  };
}

export function ActivityImportReviewModal({ workouts, initialPage = 0, onClose, onConfirm }) {
  const t = useT();
  const isMobile = useIsMobile();
  const [page, setPage] = useState(initialPage);
  const [fetchWeather, setFetchWeather] = useState(true);
  const [askCoach, setAskCoach] = useState(workouts.length <= DETAIL_LIMIT);
  const [coachNotes, setCoachNotes] = useState("");
  const [rpeByIndex, setRpeByIndex] = useState({});
  const [bulkRpe, setBulkRpe] = useState("");

  const count = workouts.length;
  const detailMode = count <= DETAIL_LIMIT;
  const current = workouts[Math.min(page, count - 1)] || workouts[0];
  const currentSummary = current ? workoutSummary(current) : { title: "", meta: "" };
  const weatherEligibleCount = useMemo(
    () => workouts.filter(w => weatherWindowEligible({ ...w, durationSec: w.duration || 0 })).length,
    [workouts]
  );
  const coachCount = detailMode ? count : Math.min(COACH_LIMIT, count);
  const hasRequiredRpe = detailMode
    ? workouts.every((w, idx) => (Number(w.rpe) >= 1 && Number(w.rpe) <= 10) || (Number(rpeByIndex[idx]) >= 1 && Number(rpeByIndex[idx]) <= 10))
    : Number(bulkRpe) >= 1 && Number(bulkRpe) <= 10;
  const confirmDisabled = !workouts.length || !hasRequiredRpe;

  function setCurrentRpe(value) {
    setRpeByIndex(prev => ({ ...prev, [page]: clampRpe(value) }));
  }

  function submit() {
    const patched = workouts.map((w, idx) => {
      const raw = detailMode ? rpeByIndex[idx] : bulkRpe;
      if (raw === "" || raw == null) return { ...w, rpe: Number(w.rpe) };
      return { ...w, rpe: Number(raw) };
    });
    onConfirm({
      workouts: patched,
      fetchWeather: fetchWeather && weatherEligibleCount > 0,
      askCoach,
      coachNotes: coachNotes.trim(),
    });
  }

  return (
    <ModalRoot onClose={onClose}>
      <div style={s.modalOverlay(isMobile, { float: true })} onClick={onClose}>
        <div style={s.modalCard(isMobile, { maxWidth: 460, float: true })} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ fontSize: 18, fontWeight: 650, margin: "0 0 5px", color: "var(--ink-1)" }}>
                {t("activities.import_review_title")}
              </h2>
              <p style={{ ...s.muted, margin: 0, lineHeight: 1.5 }}>
                {detailMode
                  ? t("activities.import_review_body", { n: count })
                  : t("activities.import_review_bulk_body", { n: count, coach: coachCount })}
              </p>
            </div>
            <button onClick={onClose} style={s.modalCloseBtn} aria-label="Close">×</button>
          </div>

          {detailMode ? (
            <div style={{
              border: "1px solid var(--rule)",
              background: "var(--bg)",
              borderRadius: 6,
              padding: "10px 12px",
              marginBottom: 12,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  color: "var(--ink-3)",
                  fontFamily: "var(--font-mono)",
                }}>
                  {t("activities.import_review_page", { current: page + 1, total: count })}
                </div>
                {count > 1 && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                      style={{ ...s.btnGhost, minHeight: 0, padding: "4px 8px", fontSize: 12, opacity: page === 0 ? 0.45 : 1 }}>‹</button>
                    <button onClick={() => setPage(p => Math.min(count - 1, p + 1))} disabled={page >= count - 1}
                      style={{ ...s.btnGhost, minHeight: 0, padding: "4px 8px", fontSize: 12, opacity: page >= count - 1 ? 0.45 : 1 }}>›</button>
                  </div>
                )}
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-1)", fontWeight: 600, lineHeight: 1.4 }}>
                {currentSummary.title}
              </div>
              {currentSummary.meta && (
                <div style={{ fontSize: 12, color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginTop: 4, lineHeight: 1.45 }}>
                  {currentSummary.meta}
                </div>
              )}
            </div>
          ) : (
            <div style={{
              border: "1px solid var(--rule)",
              background: "var(--bg)",
              borderRadius: 6,
              padding: "10px 12px",
              marginBottom: 12,
              fontSize: 12,
              color: "var(--ink-2)",
              lineHeight: 1.5,
            }}>
              {t("activities.import_review_bulk_summary", { n: count, weather: weatherEligibleCount, coach: coachCount })}
            </div>
          )}

          <div style={{ display: "grid", gap: 10 }}>
            <label style={rowStyle(fetchWeather && weatherEligibleCount > 0)}>
              <input
                type="checkbox"
                checked={fetchWeather && weatherEligibleCount > 0}
                disabled={weatherEligibleCount === 0}
                onChange={e => setFetchWeather(e.target.checked)}
                style={checkStyle}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={labelStyle}>{t("activities.import_review_weather_title")}</span>
                <span style={hintStyle}>
                  {weatherEligibleCount > 0
                    ? t("activities.import_review_weather_body", { n: weatherEligibleCount })
                    : t("activities.import_review_weather_none")}
                </span>
              </span>
            </label>

            {detailMode ? (
              <label style={fieldBlockStyle}>
                <span style={labelStyle}>{t("activities.import_review_rpe_title")}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="10"
                  value={rpeByIndex[page] || current?.rpe || ""}
                  placeholder={t("activities.import_review_rpe_placeholder")}
                  onChange={e => setCurrentRpe(e.target.value)}
                  style={{ ...s.input, marginTop: 6, minHeight: 0 }}
                />
                <span style={hintStyle}>{t("activities.import_review_rpe_required")}</span>
              </label>
            ) : (
              <label style={fieldBlockStyle}>
                <span style={labelStyle}>{t("activities.import_review_rpe_title")}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="10"
                  value={bulkRpe}
                  placeholder={t("activities.import_review_rpe_placeholder")}
                  onChange={e => setBulkRpe(clampRpe(e.target.value))}
                  style={{ ...s.input, marginTop: 6, minHeight: 0 }}
                />
                <span style={hintStyle}>{t("activities.import_review_rpe_bulk")}</span>
              </label>
            )}

            <div style={fieldBlockStyle}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={askCoach}
                  onChange={e => setAskCoach(e.target.checked)}
                  style={checkStyle}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={labelStyle}>{t("activities.import_review_coach_title")}</span>
                  <span style={hintStyle}>
                    {detailMode
                      ? t("activities.import_review_coach_body", { n: count })
                      : t("activities.import_review_coach_bulk", { n: coachCount })}
                  </span>
                </span>
              </label>
              {askCoach && (
                <textarea
                  rows={3}
                  value={coachNotes}
                  onChange={e => setCoachNotes(e.target.value)}
                  placeholder={t("activities.import_review_coach_placeholder")}
                  style={{ ...s.input, marginTop: 8, resize: "vertical", minHeight: 74, lineHeight: 1.45 }}
                />
              )}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
            <button onClick={onClose} style={s.btnGhost}>
              {t("common.cancel")}
            </button>
            <button onClick={submit} disabled={confirmDisabled} style={{ ...s.btn, opacity: confirmDisabled ? 0.5 : 1 }}>
              {t("activities.import_review_confirm")}
            </button>
          </div>
        </div>
      </div>
    </ModalRoot>
  );
}

const checkStyle = {
  width: 16,
  height: 16,
  flexShrink: 0,
  minHeight: 0,
  marginTop: 1,
};

const rowStyle = (active) => ({
  display: "flex",
  alignItems: "flex-start",
  gap: 9,
  border: "1px solid var(--rule-soft)",
  background: active ? "var(--bg)" : "var(--bg-elevated)",
  borderRadius: 6,
  padding: "10px 12px",
  cursor: "pointer",
});

const fieldBlockStyle = {
  border: "1px solid var(--rule-soft)",
  background: "var(--bg-elevated)",
  borderRadius: 6,
  padding: "10px 12px",
};

const labelStyle = {
  display: "block",
  fontSize: 13,
  color: "var(--ink-1)",
  fontWeight: 600,
  lineHeight: 1.35,
};

const hintStyle = {
  display: "block",
  fontSize: 12,
  color: "var(--ink-3)",
  lineHeight: 1.45,
  marginTop: 3,
};
