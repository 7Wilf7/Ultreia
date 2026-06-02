import { s } from "../styles";
import { TYPE_COLOR, DAILY_TAG_ICONS } from "../constants";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { startedAtToTimeOfDay } from "../utils/format";
import { skyconMeta } from "../lib/weather";
import { ModalRoot } from "./ModalRoot";
import { formatHeaderDate, logHeadline, todRank } from "./CalendarDayModal";

// Two-line weather summary for the preview:
//   line 1 — feels-like, ambient temp, humidity
//   line 2 — sky condition, wind, AQI
function weatherLines(w, lang) {
  if (!w) return null;
  const zh = lang === "zh";
  const apparent = w.apparentC ?? w.apparentAvgC;
  const l1 = [];
  if (Number.isFinite(apparent)) l1.push(`${zh ? "体感" : "feels"} ${Math.round(apparent)}°`);
  if (Number.isFinite(w.tempC)) l1.push(`${zh ? "温度" : "temp"} ${Math.round(w.tempC)}°`);
  else if (Number.isFinite(w.tempMaxC) && Number.isFinite(w.tempMinC)) l1.push(`${Math.round(w.tempMinC)}–${Math.round(w.tempMaxC)}°`);
  else if (Number.isFinite(w.tempAvgC)) l1.push(`${zh ? "温度" : "temp"} ${Math.round(w.tempAvgC)}°`);
  if (Number.isFinite(w.humidity)) {
    const rh = w.humidity > 1 ? Math.round(w.humidity) : Math.round(w.humidity * 100);
    l1.push(`${zh ? "湿度" : "RH"} ${rh}%`);
  }
  const sky = w.skycon ? skyconMeta(w.skycon, lang) : null;
  const l2 = [];
  if (sky) l2.push(sky.label);
  if (Number.isFinite(w.windSpeed) && w.windSpeed >= 1) l2.push(`${zh ? "风" : "wind"} ${Math.round(w.windSpeed)}km/h`);
  if (Number.isFinite(w.aqi) && w.aqi > 0) l2.push(`AQI ${w.aqi}`);
  return { l1: l1.join(" · "), l2: l2.join(" · "), icon: sky?.icon };
}

// Read-only day preview opened by a short tap on a calendar cell. ‹ / › step
// to the previous / next day in place. Editing (day tags, activities) is behind
// a long-press on the cell (CalendarDayModal). Blurred backdrop.
export function CalendarDayPreview({ dateKey, isFuture, logs, note, weather, onPrev, onNext, onClose }) {
  const t = useT();
  const { lang } = useLanguage();
  const isMobile = useIsMobile();

  const tags = note ? (note.tags || []) : [];
  const wl = weatherLines(weather, lang);
  const sortedLogs = [...logs].sort((a, b) => todRank(a) - todRank(b));

  return (
    <ModalRoot onClose={onClose}>
      <div onClick={onClose} className="ts-overlay-in" style={{
        position: "fixed", inset: 0, background: "rgba(20,20,19,0.45)",
        backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center",
        zIndex: 9999, padding: isMobile ? 0 : 20, overscrollBehavior: "contain",
      }}>
        <div onClick={e => e.stopPropagation()} className="ts-modal-in" style={{
          background: "var(--bg)", border: "1px solid var(--rule)",
          borderRadius: isMobile ? "12px 12px 0 0" : 12,
          boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
          width: "100%", maxWidth: 460,
          maxHeight: isMobile ? "85vh" : "90vh", overflowY: "auto",
          padding: isMobile ? "16px 18px calc(env(safe-area-inset-bottom) + 20px)" : "18px 22px 22px",
          boxSizing: "border-box", fontFamily: "var(--font-sans)",
        }}>
          {/* Header: ‹  centered date  ›  + close */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <button onClick={onPrev} aria-label={lang === "zh" ? "前一天" : "Previous day"}
              style={navBtn}>‹</button>
            <div style={{ flex: 1, textAlign: "center" }}>
              <div style={{
                fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)",
                textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2,
              }}>{isFuture ? t("calendar.day_future") : t("calendar.day_past")}</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--ink-1)" }}>
                {formatHeaderDate(dateKey, lang)}
              </div>
            </div>
            <button onClick={onNext} aria-label={lang === "zh" ? "后一天" : "Next day"}
              style={navBtn}>›</button>
          </div>

          {/* Weather — two lines */}
          {wl && (wl.l1 || wl.l2) && (
            <div style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "10px 12px", marginBottom: 14,
              background: "var(--bg-elevated)", border: "1px solid var(--rule)", borderRadius: 8,
            }}>
              {wl.icon && <span style={{ fontSize: 26 }} aria-hidden="true">{wl.icon}</span>}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--ink-1)", fontVariantNumeric: "tabular-nums" }}>{wl.l1 || "—"}</div>
                {wl.l2 && <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)", marginTop: 3 }}>{wl.l2}</div>}
              </div>
            </div>
          )}

          {/* Activities (read-only) */}
          {sortedLogs.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: tags.length ? 14 : 0 }}>
              {sortedLogs.map(l => {
                const color = TYPE_COLOR[l.type] || "var(--ink-2)";
                const tod = startedAtToTimeOfDay(l.startedAt);
                return (
                  <div key={l.id} style={{
                    border: "1px solid var(--rule)",
                    borderLeft: `3px ${l.isPlanned ? "dashed" : "solid"} ${color}`,
                    padding: "9px 12px", background: l.isPlanned ? "var(--bg-elevated)" : "var(--bg)",
                    display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                  }}>
                    <div style={{ ...s.tag(l.type), fontSize: 11 }}>{t(`enum.activity.${l.type}`)}</div>
                    {Array.isArray(l.subTypes) && l.subTypes.length > 0 && (
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-2)" }}>
                        {l.subTypes.map(st => t(`enum.subtype.${st}`)).join(" · ")}
                      </div>
                    )}
                    {tod && (
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)", letterSpacing: "0.06em" }}>
                        {t(tod === "am" ? "calendar.plan_tod_am" : "calendar.plan_tod_pm")}
                      </div>
                    )}
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--ink-2)", fontVariantNumeric: "tabular-nums", marginLeft: "auto" }}>
                      {logHeadline(l)}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: "14px 0", color: "var(--ink-3)", fontSize: 13, textAlign: "center", fontFamily: "var(--font-mono)" }}>
              {isFuture ? t("calendar.empty_future") : t("calendar.empty_past")}
            </div>
          )}

          {/* Day tags (read-only) */}
          {tags.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {tags.map(tag => (
                <span key={tag} style={{
                  fontSize: 12, fontFamily: "var(--font-mono)", padding: "4px 10px", borderRadius: 9,
                  background: "var(--moss-bg)", color: "var(--moss-deep)", border: "1px solid var(--moss)",
                }}>{DAILY_TAG_ICONS[tag] ? `${DAILY_TAG_ICONS[tag]} ` : ""}{t(`calendar.tag.${tag}`)}</span>
              ))}
            </div>
          )}

          {/* Hint: long-press a day to edit */}
          <div style={{ ...s.muted, fontSize: 11, marginTop: 14, textAlign: "center", lineHeight: 1.5 }}>
            {t("calendar.preview_edit_hint")}
          </div>
        </div>
      </div>
    </ModalRoot>
  );
}

const navBtn = {
  flexShrink: 0, width: 40, height: 40, minHeight: 40,
  border: "1px solid var(--rule)", borderRadius: 8,
  background: "var(--bg-elevated)", color: "var(--ink-1)",
  fontSize: 20, lineHeight: 1, cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  WebkitTapHighlightColor: "transparent",
};
