import { useState } from "react";
import { s } from "../styles";
import { ACTIVITY_TYPES, WORKOUT_TAGS, RUN_GROUP_TYPES, TYPE_COLOR } from "../constants";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { formatDuration } from "../utils/format";

// Pretty header date: "Thu, May 21 2026" / "5月21日 周四 2026"
function formatHeaderDate(yyyy_mm_dd, lang) {
  const [y, m, d] = yyyy_mm_dd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (lang === "zh") {
    const wk = ["日", "一", "二", "三", "四", "五", "六"][dt.getDay()];
    return `${y} 年 ${m} 月 ${d} 日 · 周${wk}`;
  }
  const wkEn = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getDay()];
  const monEn = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return `${wkEn}, ${monEn} ${d} ${y}`;
}

// Sums a Strength/HIIT/Recovery duration into a tiny label; for runs we
// pick distance as the headline.
function logHeadline(log) {
  if (RUN_GROUP_TYPES.includes(log.type) && log.distance > 0) {
    return `${log.distance} km${log.duration > 0 ? " · " + formatDuration(log.duration) : ""}`;
  }
  if (log.duration > 0) return formatDuration(log.duration);
  return "—";
}

export function CalendarDayModal({
  dateKey, isFuture, logs, onClose,
  addLog, updateLog, setConfirmDelete,
}) {
  const t = useT();
  const { lang } = useLanguage();

  // Three folded panels — only one open at a time keeps the modal short.
  // null | 'recovery' | 'plan' | { editTagsFor: logId }
  const [panel, setPanel] = useState(null);

  // ── "Add recovery" form state ──
  const [recoveryTags, setRecoveryTags] = useState([]);

  // ── "Add planned workout" form state ──
  const [planType, setPlanType] = useState("Road Run");
  const [planDistance, setPlanDistance] = useState("");
  const [planDurationMin, setPlanDurationMin] = useState("");

  // ── "Edit tags on existing log" state ──
  const [editTagsDraft, setEditTagsDraft] = useState([]);

  function startEditTags(log) {
    setEditTagsDraft([...(log.tags || [])]);
    setPanel({ editTagsFor: log.id });
  }

  function toggleInArray(arr, val) {
    return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val];
  }

  async function saveRecovery() {
    if (recoveryTags.length === 0) {
      // No tag = nothing to record. Just close the form.
      setPanel(null);
      return;
    }
    try {
      await addLog({
        date: dateKey,
        type: "Recovery",
        subTypes: [],
        distance: 0, duration: 0, pace: 0, hr: 0, maxHR: 0,
        ascent: 0, cadence: 0, aerobicTE: 0, gap: 0,
        isPlanned: false,
        tags: recoveryTags,
      }, { source: "manual" });
      setRecoveryTags([]);
      setPanel(null);
    } catch { /* alert shown by wrapper */ }
  }

  async function savePlan() {
    const distNum = parseFloat(planDistance) || 0;
    const durSec = (parseFloat(planDurationMin) || 0) * 60;
    if (distNum === 0 && durSec === 0) {
      alert(t("calendar.plan_empty_warning"));
      return;
    }
    try {
      await addLog({
        date: dateKey,
        type: planType,
        subTypes: [],
        distance: distNum,
        duration: Math.round(durSec),
        pace: 0, hr: 0, maxHR: 0,
        ascent: 0, cadence: 0, aerobicTE: 0, gap: 0,
        isPlanned: true,
        tags: [],
      }, { source: "calendar_plan" });
      setPlanType("Road Run");
      setPlanDistance("");
      setPlanDurationMin("");
      setPanel(null);
    } catch { /* alert shown by wrapper */ }
  }

  async function saveTagEdit(logId) {
    try {
      await updateLog(logId, { tags: editTagsDraft });
      setPanel(null);
    } catch { /* alert shown by wrapper */ }
  }

  function deleteLog(logId) {
    setConfirmDelete({ type: "log", id: logId });
    // Optimistically close; if user cancels delete, modal is gone but state is intact.
    onClose();
  }

  const headerDate = formatHeaderDate(dateKey, lang);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(20,20,19,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 100, padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--bg)",
          border: "1px solid var(--rule)",
          borderRadius: 4,
          width: "100%", maxWidth: 520,
          maxHeight: "90vh", overflowY: "auto",
          padding: "22px 26px 24px",
          fontFamily: "var(--font-sans)",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 6,
        }}>
          <div>
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 11,
              color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em",
              marginBottom: 2,
            }}>
              {isFuture ? t("calendar.day_future") : t("calendar.day_past")}
            </div>
            <div style={{ fontSize: 17, fontWeight: 500, color: "var(--ink-1)" }}>
              {headerDate}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "none", fontSize: 20,
            color: "var(--ink-3)", cursor: "pointer", padding: "4px 8px",
          }} aria-label="Close">×</button>
        </div>

        <div style={{ height: 1, background: "var(--rule)", margin: "14px 0 16px" }} />

        {/* Existing logs on this day */}
        {logs.length > 0 ? (
          <div style={{ marginBottom: 18 }}>
            <div style={{ ...s.label, marginBottom: 8 }}>
              {t("calendar.day_logs_title")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {logs.map(l => {
                const color = TYPE_COLOR[l.type] || "var(--ink-2)";
                const showTags = (l.tags || []).length > 0;
                const editingThis = panel && panel.editTagsFor === l.id;
                return (
                  <div key={l.id} style={{
                    border: "1px solid var(--rule)",
                    borderLeft: `3px ${l.isPlanned ? "dashed" : "solid"} ${color}`,
                    padding: "10px 12px",
                    background: l.isPlanned ? "var(--bg-elevated)" : "var(--bg)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ ...s.tag(l.type), fontSize: 11 }}>
                        {t(`enum.activity.${l.type}`)}
                      </div>
                      {l.isPlanned && (
                        <div style={{
                          fontSize: 10, fontFamily: "var(--font-mono)",
                          color: "var(--ink-3)", textTransform: "uppercase",
                          letterSpacing: "0.06em",
                        }}>
                          {t("calendar.planned_badge")}
                        </div>
                      )}
                      <div style={{
                        fontFamily: "var(--font-mono)", fontSize: 13,
                        color: "var(--ink-2)", fontVariantNumeric: "tabular-nums",
                      }}>
                        {logHeadline(l)}
                      </div>
                      <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                        {!l.isPlanned && (
                          <button onClick={() => editingThis ? setPanel(null) : startEditTags(l)}
                            style={{ ...s.btnGhost, fontSize: 11, padding: "4px 9px" }}>
                            {editingThis ? t("common.cancel") : t("calendar.edit_tags")}
                          </button>
                        )}
                        <button onClick={() => deleteLog(l.id)}
                          style={{ ...s.btnGhost, fontSize: 11, padding: "4px 9px", color: "var(--danger)" }}>
                          {t("common.delete")}
                        </button>
                      </div>
                    </div>

                    {/* Existing tags row */}
                    {showTags && !editingThis && (
                      <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {l.tags.map(tag => (
                          <span key={tag} style={{
                            fontSize: 10.5, fontFamily: "var(--font-mono)",
                            padding: "2px 7px", borderRadius: 8,
                            background: "var(--moss-bg)", color: "var(--moss-deep)",
                            border: "1px solid var(--moss)",
                          }}>{t(`calendar.tag.${tag}`)}</span>
                        ))}
                      </div>
                    )}

                    {/* Inline tag editor */}
                    {editingThis && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                          {WORKOUT_TAGS.map(tag => (
                            <button key={tag}
                              onClick={() => setEditTagsDraft(toggleInArray(editTagsDraft, tag))}
                              style={s.chip(editTagsDraft.includes(tag))}>
                              {t(`calendar.tag.${tag}`)}
                            </button>
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => saveTagEdit(l.id)} style={{ ...s.btn, fontSize: 12, padding: "5px 12px" }}>
                            {t("common.save")}
                          </button>
                          <button onClick={() => setPanel(null)} style={{ ...s.btnGhost, fontSize: 12, padding: "5px 12px" }}>
                            {t("common.cancel")}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{
            padding: "16px 0 18px",
            color: "var(--ink-3)", fontSize: 13, textAlign: "center",
            fontFamily: "var(--font-mono)",
          }}>
            {isFuture ? t("calendar.empty_future") : t("calendar.empty_past")}
          </div>
        )}

        {/* Action panels — past/today shows "add recovery", future shows "add plan" */}
        {!isFuture && (
          <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 14 }}>
            {panel === "recovery" ? (
              <>
                <div style={{ ...s.label, marginBottom: 8 }}>
                  {t("calendar.add_recovery_title")}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                  {WORKOUT_TAGS.map(tag => (
                    <button key={tag}
                      onClick={() => setRecoveryTags(toggleInArray(recoveryTags, tag))}
                      style={s.chip(recoveryTags.includes(tag))}>
                      {t(`calendar.tag.${tag}`)}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={saveRecovery}
                    disabled={recoveryTags.length === 0}
                    style={{ ...s.btn, fontSize: 12, padding: "6px 14px", opacity: recoveryTags.length === 0 ? 0.5 : 1 }}>
                    {t("calendar.save_recovery")}
                  </button>
                  <button onClick={() => { setPanel(null); setRecoveryTags([]); }} style={{ ...s.btnGhost, fontSize: 12, padding: "6px 14px" }}>
                    {t("common.cancel")}
                  </button>
                </div>
              </>
            ) : (
              <button onClick={() => setPanel("recovery")} style={s.btn}>
                {t("calendar.add_recovery_button")}
              </button>
            )}
          </div>
        )}

        {isFuture && (
          <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 14 }}>
            {panel === "plan" ? (
              <>
                <div style={{ ...s.label, marginBottom: 8 }}>
                  {t("calendar.add_plan_title")}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                  <div>
                    <div style={{ ...s.muted, fontSize: 11, marginBottom: 4 }}>{t("form.type")}</div>
                    <select value={planType} onChange={e => setPlanType(e.target.value)}
                      style={{ ...s.input, padding: "6px 8px", fontSize: 13 }}>
                      {ACTIVITY_TYPES.filter(at => at !== "Recovery").map(at => (
                        <option key={at} value={at}>{t(`enum.activity.${at}`)}</option>
                      ))}
                    </select>
                  </div>
                  {RUN_GROUP_TYPES.includes(planType) && (
                    <div>
                      <div style={{ ...s.muted, fontSize: 11, marginBottom: 4 }}>{t("form.distance")} (km)</div>
                      <input type="number" step="0.1" min="0" value={planDistance}
                        onChange={e => setPlanDistance(e.target.value)}
                        placeholder="e.g. 8"
                        style={{ ...s.input, padding: "6px 8px", fontSize: 13 }} />
                    </div>
                  )}
                  <div>
                    <div style={{ ...s.muted, fontSize: 11, marginBottom: 4 }}>{t("form.duration")} ({t("form.minutes")})</div>
                    <input type="number" step="1" min="0" value={planDurationMin}
                      onChange={e => setPlanDurationMin(e.target.value)}
                      placeholder="e.g. 45"
                      style={{ ...s.input, padding: "6px 8px", fontSize: 13 }} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={savePlan} style={{ ...s.btn, fontSize: 12, padding: "6px 14px" }}>
                    {t("calendar.save_plan")}
                  </button>
                  <button onClick={() => { setPanel(null); setPlanDistance(""); setPlanDurationMin(""); }} style={{ ...s.btnGhost, fontSize: 12, padding: "6px 14px" }}>
                    {t("common.cancel")}
                  </button>
                </div>
              </>
            ) : (
              <button onClick={() => setPanel("plan")} style={s.btn}>
                {t("calendar.add_plan_button")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
