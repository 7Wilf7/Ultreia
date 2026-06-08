import { useMemo, useState, useRef } from "react";
import { s } from "../styles";
import { RUN_GROUP_TYPES, TYPE_COLOR, DAILY_TAG_ICONS } from "../constants";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { CalendarDayModal } from "./CalendarDayModal";
import { skyconMeta } from "../lib/weather";
import { startedAtToTimeOfDay } from "../utils/format";

const WEEKDAY_SHORT_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_SHORT_ZH = ["日", "一", "二", "三", "四", "五", "六"];

// YYYY-MM-DD in LOCAL time. workouts.date is stored as 'YYYY-MM-DD' (no time
// component). Using toISOString() would shift the date by the timezone offset
// (e.g. May 21 GMT+8 → May 20 UTC) and cause off-by-one buckets — same trap
// noted in ChartsTab.weekRangeLabel.
function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Mon-Sun ordering. JavaScript's getDay() returns 0=Sun..6=Sat — we shift so
// 0=Mon..6=Sun, matching the calendar layout (and ChartsTab week-buckets).
function monIdx(d) { return (d.getDay() + 6) % 7; }

// Build the grid for a given (year, month). Returns 6 rows × 7 days = 42 cells,
// padded with neighboring-month days so the layout stays rectangular regardless
// of how the month starts/ends.
function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  const startOffset = monIdx(first);
  const gridStart = new Date(year, month, 1 - startOffset);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push(d);
  }
  return cells;
}

const MONTH_KEYS = [
  "period.month_short.0",  "period.month_short.1",  "period.month_short.2",
  "period.month_short.3",  "period.month_short.4",  "period.month_short.5",
  "period.month_short.6",  "period.month_short.7",  "period.month_short.8",
  "period.month_short.9",  "period.month_short.10", "period.month_short.11",
];

export function CalendarTab({ logs, addLog, updateLog, setConfirmDelete, dailyNotes, setDailyTags, setReadiness, weatherCtx, races }) {
  const t = useT();
  const { lang } = useLanguage();
  const isMobile = useIsMobile();
  const today = new Date();
  const todayKey = dateKey(today);

  // Day-keyed weather Map. Built from the shared weatherCtx so we hit the
  // localStorage cache (no per-tab-mount API call) and stay in sync with
  // the AI Coach pill. Today's cell uses realtime (actual observed),
  // future cells use the 7-day forecast.
  // Read ctx fields into locals first — the React Compiler lint rule
  // wants the useMemo deps to match the actual reads exactly, and
  // chained-optional `weatherCtx?.foo` shows up as `weatherCtx` in its
  // inference.
  const ctxForecast = weatherCtx?.forecastByDate;
  const ctxRealtime = weatherCtx?.currentWeather;
  const forecastByDate = useMemo(() => {
    const m = new Map();
    if (ctxForecast) {
      for (const [date, f] of ctxForecast.entries()) m.set(date, f);
    }
    if (ctxRealtime) {
      // Merge realtime over today's daily forecast (if any): keep the day's
      // max/min range from the forecast, but overlay the live current temp +
      // feels-like so today's card reads "now". Same realtime snapshot the AI
      // Coach header uses. Without this overlay, today's card had only the
      // daily-forecast fields (max/min) OR nothing — and the realtime card
      // path read tempC/apparentC which weren't present, so today showed "—".
      const base = m.get(todayKey) || {};
      m.set(todayKey, {
        ...base,
        date: todayKey,
        tempC: ctxRealtime.tempC,
        apparentC: ctxRealtime.apparentC,
        humidity: ctxRealtime.humidity ?? base.humidity,
        skycon: ctxRealtime.skycon ?? base.skycon,
        windSpeed: ctxRealtime.windSpeed ?? base.windSpeed,
        aqi: ctxRealtime.aqi ?? base.aqi,
        _source: 'realtime',
      });
    }
    return m;
  }, [ctxForecast, ctxRealtime, todayKey]);

  // Default view = current month. < > buttons step by ±1 month; "Today" resets.
  const [view, setViewMonth] = useState(() => ({
    year: today.getFullYear(),
    month: today.getMonth(),
  }));

  const cells = useMemo(() => buildMonthGrid(view.year, view.month), [view]);

  // Direction of the last month change (1 = next/forward, -1 = prev/back),
  // drives the slide-in animation so switching months isn't an instant flash.
  const [dir, setDir] = useState(0);

  // Index workouts AND dailyNotes by date for O(1) lookup per cell. Multiple
  // workouts can share a date (morning run + evening strength); daily_notes
  // is UNIQUE per (user_id, date) so there's at most one note entry per day.
  const byDate = useMemo(() => {
    const m = new Map();
    for (const l of logs) {
      if (!l.date) continue;
      const arr = m.get(l.date) || [];
      arr.push(l);
      m.set(l.date, arr);
    }
    return m;
  }, [logs]);

  const notesByDate = useMemo(() => {
    const m = new Map();
    for (const n of dailyNotes) {
      if (n.date) m.set(n.date, n);
    }
    return m;
  }, [dailyNotes]);

  // Race days (target + history) → a date-key set so each cell can show a
  // trophy. Pulled straight from the races list so it stays in sync.
  const raceDays = useMemo(() => {
    const set = new Set();
    for (const r of races || []) {
      if (r.date) set.add(r.date);
    }
    return set;
  }, [races]);

  // Tap a day → one centered day modal that views + edits + adds. dayKey also
  // drives the ‹/› day stepping inside the modal.
  const [dayKey, setDayKey] = useState(null);

  // Shift a YYYY-MM-DD key by N days (for the preview's prev/next arrows).
  function shiftDayKey(key, delta) {
    const [y, m, d] = key.split("-").map(Number);
    return dateKey(new Date(y, m - 1, d + delta));
  }

  // Vertical swipe on the calendar grid changes month (up = next, down = prev);
  // the 7-day weather strip below scrolls normally.
  const swipeRef = useRef(null);
  function onGridTouchStart(e) {
    if (e.touches.length !== 1) { swipeRef.current = null; return; }
    swipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  function onGridTouchEnd(e) {
    const st = swipeRef.current; swipeRef.current = null;
    const p = e.changedTouches && e.changedTouches[0];
    if (!st || !p) return;
    const dx = p.clientX - st.x, dy = p.clientY - st.y;
    if (Math.abs(dy) < 50 || Math.abs(dy) < Math.abs(dx) * 1.5) return; // need a clear vertical swipe
    if (dy < 0) gotoNext(); else gotoPrev();
  }

  function gotoPrev() {
    setDir(-1);
    setViewMonth(v => {
      const d = new Date(v.year, v.month - 1, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }
  function gotoNext() {
    setDir(1);
    setViewMonth(v => {
      const d = new Date(v.year, v.month + 1, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }
  function gotoToday() {
    setViewMonth(v => {
      const target = today.getFullYear() * 12 + today.getMonth();
      const cur = v.year * 12 + v.month;
      setDir(target === cur ? 0 : target > cur ? 1 : -1);
      return { year: today.getFullYear(), month: today.getMonth() };
    });
  }

  const monthLabel = t("period.month_year", {
    year: view.year,
    month: t(MONTH_KEYS[view.month]),
  });

  const WEEKDAYS = lang === "zh"
    ? ["一", "二", "三", "四", "五", "六", "日"]
    : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // Mobile layout: the month + weekday header + 6×7 grid become a sticky
  // block at the top of the scrollable region so the user can swipe the
  // weather strip cards beneath without losing the calendar context.
  // Desktop scrolls normally — the whole page fits in the viewport.
  const monthBlockStyle = isMobile ? {
    position: "sticky",
    top: "calc(-1 * max(env(safe-area-inset-top), 14px))",
    zIndex: 10,
    background: "var(--bg)",
    marginLeft: -14, marginRight: -14, paddingLeft: 14, paddingRight: 14,
    marginTop: "calc(-1 * max(env(safe-area-inset-top), 14px))",
    paddingTop: "calc(max(env(safe-area-inset-top), 14px) + 4px)",
    paddingBottom: 8,
    borderBottom: "1px solid var(--rule)",
    marginBottom: 14,
    // Consume touch gestures on the calendar block for our month-change swipe
    // (handled in JS) instead of letting them scroll the page — so swiping the
    // calendar no longer drags the weather strip below. The weather strip sits
    // outside this block and scrolls normally.
    touchAction: "none",
  } : {};

  return (
    <div>
      <div style={monthBlockStyle} onTouchStart={onGridTouchStart} onTouchEnd={onGridTouchEnd}>
      {/* Month navigation bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        marginBottom: 16, flexWrap: "wrap",
      }}>
        <button onClick={gotoPrev} style={{ ...s.btnGhost, padding: "6px 12px", fontSize: 14 }} aria-label="Previous month">‹</button>
        <div style={{
          fontFamily: "var(--font-sans)", fontSize: 18, fontWeight: 500,
          color: "var(--ink-1)",
          minWidth: isMobile ? 110 : 160,
          textAlign: "center",
          letterSpacing: "-0.01em",
        }}>{monthLabel}</div>
        <button onClick={gotoNext} style={{ ...s.btnGhost, padding: "6px 12px", fontSize: 14 }} aria-label="Next month">›</button>
        <button onClick={gotoToday} style={{ ...s.btnGhost, padding: "6px 12px", fontSize: 12, marginLeft: 4 }}>
          {t("calendar.today")}
        </button>
        {/* Legend hint is verbose — hidden on mobile to save the nav bar from
            wrapping. Users still see the visual distinction (solid vs dashed)
            in the cells themselves. */}
        <div style={{
          marginLeft: isMobile ? 0 : "auto",
          width: isMobile ? "100%" : "auto",
          ...s.muted,
          fontSize: isMobile ? 10.5 : 12,
          lineHeight: 1.25,
          fontFamily: "var(--font-mono)",
          letterSpacing: isMobile ? "0.02em" : 0,
        }}>
          {t(isMobile ? "calendar.legend_hint_mobile" : "calendar.legend_hint")}
        </div>
      </div>

      {/* Weekday header */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        gap: 0,
        marginBottom: 0,
        borderBottom: "1px solid var(--rule)",
      }}>
        {WEEKDAYS.map((w, i) => (
          <div key={w} style={{
            fontFamily: "var(--font-mono)",
            fontSize: isMobile ? 10 : 12,
            color: i >= 5 ? "var(--ink-3)" : "var(--ink-2)",
            textTransform: "uppercase", letterSpacing: "0.06em",
            padding: isMobile ? "6px 4px" : "10px 12px",
            textAlign: "center",
            borderRight: i < 6 ? "1px solid var(--rule)" : "none",
          }}>{w}</div>
        ))}
      </div>

      {/* The 6 × 7 grid. Keyed by month so switching remounts it and replays the
          slide-in (direction set by gotoPrev/Next). */}
      <div
        key={`${view.year}-${view.month}`}
        className={dir > 0 ? "ts-cal-in-next" : dir < 0 ? "ts-cal-in-prev" : undefined}
        style={{
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        gap: 0,
        border: "1px solid var(--rule)",
        borderTop: "none",
        background: "var(--bg)",
      }}>
        {cells.map((d, i) => {
          const key = dateKey(d);
          const inMonth = d.getMonth() === view.month;
          const isToday = key === todayKey;
          const isFuture = key > todayKey;
          const isWeekend = monIdx(d) >= 5;
          const dayLogs = byDate.get(key) || [];
          const dayNote = notesByDate.get(key) || null;

          return (
            <DayCell
              key={key + "-" + i}
              date={d}
              inMonth={inMonth}
              isToday={isToday}
              isFuture={isFuture}
              isWeekend={isWeekend}
              logs={dayLogs}
              note={dayNote}
              isRace={raceDays.has(key)}
              colIdx={i % 7}
              rowIdx={Math.floor(i / 7)}
              onTap={() => setDayKey(key)}
              t={t}
              isMobile={isMobile}
            />
          );
        })}
      </div>
      </div> {/* /monthBlockStyle wrapper */}

      {/* 7-day weather strip — sits beneath the calendar grid. Today + next
          6 days, each rendered as its own card. On desktop the seven cards
          span the row; on mobile they stack vertically so the user can
          scroll through forecasts while the calendar above stays in view. */}
      <WeatherStrip
        forecastByDate={forecastByDate}
        todayKey={todayKey}
        lang={lang}
        t={t}
        isMobile={isMobile}
        lastUpdatedAt={weatherCtx?.lastUpdatedAt}
        onRefresh={() => weatherCtx?.refetch?.({ force: true })}
        refreshing={weatherCtx?.status === "loading"}
      />

      {/* Tap a day → one centered modal (view + long-press-edit + add), with
          ‹/› stepping to the previous/next day in place. */}
      {dayKey && (() => {
        const k = dayKey;
        const w = k >= todayKey
          ? (forecastByDate.get(k) || null)
          : ((byDate.get(k) || []).find(l => l.weather)?.weather || null);
        return (
          <CalendarDayModal
            dateKey={k}
            isFuture={k > todayKey}
            logs={byDate.get(k) || []}
            note={notesByDate.get(k) || null}
            weather={w}
            onPrev={() => setDayKey(shiftDayKey(k, -1))}
            onNext={() => setDayKey(shiftDayKey(k, 1))}
            onClose={() => setDayKey(null)}
            addLog={addLog}
            updateLog={updateLog}
            setConfirmDelete={setConfirmDelete}
            setDailyTags={setDailyTags}
            setReadiness={setReadiness}
            isToday={k === todayKey}
          />
        );
      })()}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 7-day weather strip — beneath the calendar grid. Each card carries the
// daily forecast for one of the next 7 days (today + 6). Desktop lays them
// out as a 7-column horizontal row; mobile stacks them vertically so the
// user can scroll through forecasts while the sticky calendar above stays
// visible. Cards are read-only — clicking a day still opens the day modal
// from the grid above.
// ─────────────────────────────────────────────────────────────────────────
function WeatherStrip({ forecastByDate, todayKey, lang, t, isMobile, lastUpdatedAt, onRefresh, refreshing }) {
  // Build the 7-day window starting from today (local time). Even when a
  // particular date has no forecast (e.g. Caiyun returned fewer than 7), we
  // still render the slot as a muted placeholder so the layout stays even.
  const days = [];
  const todayD = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(todayD);
    d.setDate(todayD.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const key = `${y}-${m}-${day}`;
    days.push({ date: d, key, forecast: forecastByDate?.get(key) || null });
  }

  // Empty state — when there's no forecast data at all (no location set,
  // first launch before fetch lands, error). The hint nudges the user to
  // the location settings.
  const anyForecast = days.some(x => x.forecast);
  if (!anyForecast) {
    return (
      <div style={{
        marginTop: 18, padding: "16px 18px",
        border: "1px solid var(--rule)", borderRadius: 2,
        color: "var(--ink-3)", fontSize: 13,
        background: "var(--bg-elevated)", lineHeight: 1.5,
      }}>
        {t("calendar.weather_strip_empty")}
      </div>
    );
  }

  // Header row: title on the left + "updated HH:MM · ↻" on the right.
  // The timestamp shows the user when realtime data was last fetched (the
  // forecast piggybacks on the same refetch). The refresh button calls
  // onRefresh({force:true}) to bust the cache and pull fresh data.
  const updatedLabel = lastUpdatedAt ? formatTimeShort(lastUpdatedAt) : null;

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{
        display: "flex", alignItems: "baseline", justifyContent: "space-between",
        marginBottom: 8, gap: 8,
      }}>
        <div style={s.label}>{t("calendar.weather_strip_title")}</div>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          fontFamily: "var(--font-mono)", fontSize: 11,
          color: "var(--ink-3)",
        }}>
          {updatedLabel && (
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {t("calendar.weather_updated_at", { time: updatedLabel })}
            </span>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            title={t("calendar.weather_refresh_tooltip")}
            aria-label={t("calendar.weather_refresh_tooltip")}
            style={{
              border: "1px solid var(--rule)",
              background: "var(--bg-elevated)",
              color: refreshing ? "var(--ink-3)" : "var(--ink-1)",
              padding: "2px 8px",
              minHeight: 24,
              borderRadius: 2,
              cursor: refreshing ? "default" : "pointer",
              fontFamily: "var(--font-mono)", fontSize: 12,
              lineHeight: 1,
              display: "inline-flex", alignItems: "center", gap: 4,
            }}>
            <span style={{
              display: "inline-block",
              transition: "transform 600ms linear",
              transform: refreshing ? "rotate(360deg)" : "rotate(0deg)",
            }}>↻</span>
          </button>
        </div>
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "repeat(7, minmax(0, 1fr))",
        gap: isMobile ? 8 : 6,
      }}>
        {days.map(({ date, key, forecast }) => (
          <WeatherCard
            key={key}
            date={date}
            forecast={forecast}
            isToday={key === todayKey}
            lang={lang}
            t={t}
            isMobile={isMobile}
          />
        ))}
      </div>
    </div>
  );
}

// Format an ISO timestamp as "HH:MM" in local time. Used by the "updated at"
// label so the user can tell at a glance how stale the data is.
function formatTimeShort(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Compact two-line forecast card. Fixed-height (so the strip stays even
// when some days lack secondary data) and laid out the same on desktop
// + mobile — only the grid orientation changes upstream.
//
//   Row 1: weekday · date · [today tag] · icon · temp range
//   Row 2: feels · RH · wind · AQI   (small mono, single line)
const WEATHER_CARD_HEIGHT = 68;
function WeatherCard({ date, forecast, isToday, lang, t, isMobile }) {
  const weekdays = lang === "zh" ? WEEKDAY_SHORT_ZH : WEEKDAY_SHORT_EN;
  const wkLabel = weekdays[date.getDay()];
  const dateLabel = `${date.getMonth() + 1}-${date.getDate()}`;
  const skyMeta = forecast?.skycon ? skyconMeta(forecast.skycon, lang) : null;
  const tMax = forecast?.tempMaxC;
  const tMin = forecast?.tempMinC;
  const tAvg = forecast?.tempAvgC;
  // Realtime current temp (today's card, from the live snapshot). Future days
  // don't have it — they fall back to the max/min range below.
  const tCur = forecast?.tempC;
  // Feels-like: realtime snapshots carry apparentC, daily forecasts carry
  // apparentAvgC. Prefer whichever is present.
  const apparent = forecast?.apparentC ?? forecast?.apparentAvgC;
  const humidity = Number.isFinite(forecast?.humidity)
    ? (forecast.humidity > 1 ? Math.round(forecast.humidity) : Math.round(forecast.humidity * 100))
    : null;
  const wind = forecast?.windSpeed;
  const aqi = forecast?.aqi;
  const todayTag = isToday ? t("calendar.weather_today_tag") : null;

  const cardStyle = {
    border: "1px solid " + (isToday ? "var(--moss)" : "var(--rule)"),
    background: isToday ? "var(--moss-bg)" : "var(--bg-elevated)",
    padding: isMobile ? "10px 12px" : "8px 10px",
    borderRadius: 2,
    height: isMobile ? 76 : WEATHER_CARD_HEIGHT,
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    minWidth: 0,
    overflow: "hidden",
  };

  if (!forecast) {
    return (
      <div style={cardStyle}>
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 11,
          color: "var(--ink-3)", letterSpacing: "0.04em",
          display: "flex", gap: 6, alignItems: "baseline",
        }}>
          <span style={{ textTransform: "uppercase" }}>{wkLabel}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{dateLabel}</span>
        </div>
        <div style={{ ...s.muted, fontSize: 11 }}>—</div>
      </div>
    );
  }

  // Today (realtime) → single live temp; future → max/min range; fallback avg.
  const tempReadout = Number.isFinite(tCur)
    ? `${Math.round(tCur)}°`
    : Number.isFinite(tMax) && Number.isFinite(tMin)
      ? `${Math.round(tMax)}°/${Math.round(tMin)}°`
      : Number.isFinite(tAvg)
        ? `${Math.round(tAvg)}°`
        : "—";

  return (
    <div style={cardStyle}>
      {/* Row 1: weekday · date · today tag · icon · temp range. Single line. */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        minWidth: 0, whiteSpace: "nowrap",
      }}>
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 11,
          color: "var(--ink-2)", textTransform: "uppercase",
          letterSpacing: "0.04em",
          fontWeight: isToday ? 600 : 500,
          flexShrink: 0,
        }}>{wkLabel}</span>
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 11,
          color: "var(--ink-3)", fontVariantNumeric: "tabular-nums",
          flexShrink: 0,
        }}>{dateLabel}</span>
        {todayTag && (
          <span style={{
            fontSize: 9, color: "var(--moss-deep)",
            textTransform: "uppercase", letterSpacing: "0.06em",
            flexShrink: 0,
          }}>{todayTag}</span>
        )}
        <span style={{ flex: 1 }} />
        {skyMeta && (
          <span style={{ fontSize: isMobile ? 18 : 16, flexShrink: 0, lineHeight: 1 }} aria-hidden="true">
            {skyMeta.icon}
          </span>
        )}
        <span style={{
          fontFamily: "var(--font-mono)",
          fontVariantNumeric: "tabular-nums",
          fontSize: isMobile ? 16 : 13,
          fontWeight: 600, color: "var(--ink-1)",
          flexShrink: 0,
        }}>{tempReadout}</span>
      </div>

      {/* Row 2: feels · RH · wind · AQI. Small mono, one line, ellipsised
          if it overflows (rare — usually 2–3 short tokens). */}
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: isMobile ? 11 : 10,
        color: "var(--ink-3)",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
        overflow: "hidden", textOverflow: "ellipsis",
      }}>
        {[
          Number.isFinite(apparent) ? `${lang === "zh" ? "体感" : "feels"} ${Math.round(apparent)}°` : null,
          humidity !== null ? `${lang === "zh" ? "湿" : "RH"}${humidity}%` : null,
          Number.isFinite(wind) && wind >= 1 ? `${lang === "zh" ? "风" : "wind"} ${Math.round(wind)}km/h` : null,
          Number.isFinite(aqi) && aqi > 0 ? `AQI ${aqi}` : null,
        ].filter(Boolean).join(" · ") || (skyMeta?.label || "")}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Single day cell.
//   - Workouts render as multi-line pills: "Road Run" on top, then "12.5km
//     · +320m" beneath (when distance / ascent exist).
//   - Strength / HIIT just show the type label (no metrics line).
//   - Planned rows (is_planned=true) use a dashed left border, muted text.
//   - dailyNotes.tags (currently just 'massage') render as a chip in the
//     bottom-right corner — independent from workouts.
//   - Empty + past/today → "Rest" placeholder; empty + future → "+ plan" hint
// ─────────────────────────────────────────────────────────────────────────
function DayCell({ date, inMonth, isToday, isFuture, isWeekend, logs, note, isRace, colIdx, rowIdx, onTap, t, isMobile }) {
  const dayTags = note ? (note.tags || []) : [];
  const cellPast = !isToday && date.getTime() < new Date().setHours(0, 0, 0, 0);
  const visibleLogs = cellPast ? logs.filter(l => !l.isPlanned) : logs;
  const hiddenPlanCount = logs.length - visibleLogs.length;
  const hasContent = visibleLogs.length > 0;

  const cellBg = isToday
    ? "var(--moss-bg)"
    : !inMonth
      ? "var(--bg-elevated)"
      : "var(--bg)";

  // Mobile cells are ~50–60px wide on a 430px screen — way too cramped for
  // labels or distances. Switch to Garmin-style: just the date number and a
  // row of color dots per activity. Tap → existing day modal for details.
  if (isMobile) {
    return (
      <div
        onClick={onTap}
        style={{
          position: "relative",
          minHeight: 48,
          padding: "3px 3px 4px",
          borderRight: colIdx < 6 ? "1px solid var(--rule)" : "none",
          borderBottom: rowIdx < 5 ? "1px solid var(--rule)" : "none",
          background: cellBg,
          cursor: "pointer",
          opacity: inMonth ? 1 : 0.45,
          transition: "background 120ms",
          overflow: "hidden",
          display: "flex", flexDirection: "column", alignItems: "center",
        }}
      >
        {/* Day number — centered on mobile, smaller box for "today". A trophy
            sits to its right on race days (pulled from the races list). */}
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 2,
          marginBottom: 2, lineHeight: 1,
        }}>
          <span style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            fontWeight: isToday ? 600 : 500,
            color: isToday ? "var(--ink-1)"
                  : isWeekend ? "var(--ink-3)"
                  : "var(--ink-2)",
            fontVariantNumeric: "tabular-nums",
            padding: isToday ? "0 4px" : "0",
            border: isToday ? "1px solid var(--ink-1)" : "none",
            borderRadius: isToday ? 3 : 0,
            lineHeight: 1,
          }}>{date.getDate()}</span>
          {isRace && <span aria-label="race" style={{ fontSize: 9, lineHeight: 1 }}>🏆</span>}
        </span>

        {/* Activity bars — short horizontal pills, one per workout, stacked
            vertically. With the new shorter cell we cap at 3 bars before
            collapsing to "+N" so the day number stays readable. */}
        {hasContent && (
          <div style={{
            display: "flex", flexDirection: "column", gap: 1, alignItems: "center",
            width: "100%",
          }}>
            {(() => {
              // Past PLANNED bars recede (auto-archive) so an old, unfulfilled
              // plan stops cluttering the grid — the user no longer needs to
              // delete it. Completed bars and future plans render at full strength.
              return visibleLogs.slice(0, 3).map(l => {
                const c = TYPE_COLOR[l.type] || "#57564f";
                return (
                  <span key={l.id} style={{
                    width: "76%", maxWidth: 26, height: 4,
                    borderRadius: 1,
                    background: l.isPlanned ? "transparent" : c,
                    border: l.isPlanned ? `1px dashed ${c}` : "none",
                    opacity: 1,
                    display: "inline-block",
                    flexShrink: 0,
                  }} title={t(`enum.activity.${l.type}`)} />
                );
              });
            })()}
            {visibleLogs.length > 3 && (
              <span style={{
                fontSize: 8, color: "var(--ink-3)",
                fontFamily: "var(--font-mono)", lineHeight: 1,
              }}>+{visibleLogs.length - 3}</span>
            )}
          </div>
        )}

        {/* Day-level tags — mobile shows just the emoji icon(s), centered along
            the bottom of the cell (no room for text); multiple tags sit in a
            centered row. */}
        {hiddenPlanCount > 0 && inMonth && (
          <span style={{
            marginTop: hasContent ? 1 : 4,
            fontFamily: "var(--font-mono)",
            fontSize: 8,
            color: "var(--ink-3)",
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}>
            {t("calendar.plan_hidden_past_mobile", { n: hiddenPlanCount })}
          </span>
        )}

        {dayTags.length > 0 && (
          <span style={{
            position: "absolute", bottom: 2, left: 0, right: 0,
            display: "flex", justifyContent: "center", gap: 2,
            fontSize: 10, lineHeight: 1,
          }} title={dayTags.map(tag => t(`calendar.tag.${tag}`)).join(", ")}>
            {dayTags.map(tag => (
              <span key={tag} aria-hidden="true">{DAILY_TAG_ICONS[tag] || "•"}</span>
            ))}
          </span>
        )}
      </div>
    );
  }

  // Desktop / tablet — full layout with type names and metrics.
  return (
    <div
      onClick={onTap}
      style={{
        position: "relative",
        minHeight: 132,
        padding: "10px 12px 12px",
        borderRight: colIdx < 6 ? "1px solid var(--rule)" : "none",
        borderBottom: rowIdx < 5 ? "1px solid var(--rule)" : "none",
        background: cellBg,
        cursor: "pointer",
        opacity: inMonth ? 1 : 0.45,
        transition: "background 120ms",
        overflow: "hidden",
      }}
    >
      {/* Day number — weather moved out of the grid into the strip below.
          Trophy to the right of the date on race days. */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        marginBottom: 8,
      }}>
        <span style={{
          fontFamily: "var(--font-mono)",
          fontSize: isToday ? 16 : 15,
          fontWeight: isToday ? 600 : 500,
          color: isToday ? "var(--ink-1)"
                : isWeekend ? "var(--ink-3)"
                : "var(--ink-2)",
          fontVariantNumeric: "tabular-nums",
          padding: isToday ? "1px 7px" : "0",
          border: isToday ? "1px solid var(--ink-1)" : "none",
          borderRadius: isToday ? 3 : 0,
          lineHeight: 1,
        }}>{date.getDate()}</span>
        {isRace && <span aria-label="race" title={t("filter.child.Race") || "Race"} style={{ fontSize: 13, lineHeight: 1 }}>🏆</span>}
      </div>

      {/* Workouts */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {visibleLogs.map(l => <LogPill key={l.id} log={l} t={t} />)}
      </div>

      {/* Rest placeholder — past/today + no activity at all */}
      {!hasContent && !isFuture && inMonth && (
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 12,
          color: "var(--ink-3)", marginTop: 4, letterSpacing: "0.04em",
        }}>{t("calendar.rest")}</div>
      )}

      {!hasContent && isFuture && inMonth && (
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 12,
          color: "var(--ink-3)", marginTop: 4, letterSpacing: "0.04em",
          opacity: 0.55,
        }}>{t("calendar.add_plan_hint")}</div>
      )}

      {hiddenPlanCount > 0 && inMonth && (
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 11,
          color: "var(--ink-3)", marginTop: 4,
        }}>{t("calendar.plan_hidden_past", { n: hiddenPlanCount })}</div>
      )}

      {/* Day-level tags (massage). Pinned to the bottom-right corner so
          they read as metadata on the day, not as an additional workout. */}
      {dayTags.length > 0 && (
        <div style={{
          position: "absolute", bottom: 7, right: 9,
          display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end",
          maxWidth: "75%",
        }}>
          {dayTags.map(tag => (
            <span key={tag} style={{
              fontSize: 11, fontFamily: "var(--font-mono)",
              padding: "2px 7px", borderRadius: 9,
              background: "var(--moss-bg)", color: "var(--moss-deep)",
              border: "1px solid var(--moss)", lineHeight: 1.3,
            }} title={t(`calendar.tag.${tag}`)}>
              {DAILY_TAG_ICONS[tag] ? `${DAILY_TAG_ICONS[tag]} ` : ""}{t(`calendar.tag.${tag}`)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// One activity row inside a day cell. Two-line layout: type label on top,
// metrics line beneath (only rendered when there's something useful to show).
function LogPill({ log, t }) {
  const isRun = RUN_GROUP_TYPES.includes(log.type);
  const isPlanned = log.isPlanned;
  const color = TYPE_COLOR[log.type] || "#57564f";

  // Metrics line: distance + ascent for runs; strength shows its area(s) so a
  // planned "Strength" reads as "Core" not a bare label. AM/PM (when set) leads.
  const metrics = [];
  const tod = startedAtToTimeOfDay(log.startedAt);
  if (tod) metrics.push(tod === "am" ? t("calendar.plan_tod_am") : t("calendar.plan_tod_pm"));
  if (isRun && log.distance > 0) metrics.push(`${log.distance} km`);
  if (isRun && log.ascent > 0)   metrics.push(`+${log.ascent} m`);
  if (!isRun && Array.isArray(log.subTypes) && log.subTypes.length > 0) {
    metrics.push(log.subTypes.map(st => t(`enum.subtype.${st}`)).join(" · "));
  }

  return (
    <div style={{
      fontSize: 11.5, lineHeight: 1.3,
      padding: "3px 6px 4px 7px",
      borderLeft: `2px ${isPlanned ? "dashed" : "solid"} ${color}`,
      background: isPlanned ? "transparent" : "rgba(0,0,0,0.02)",
      borderRadius: 2,
      overflow: "hidden",
    }}>
      {/* Line 1: type name (full label, color-coded) */}
      <div style={{
        fontWeight: 600,
        color: color,
        fontSize: 12,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        opacity: isPlanned ? 0.75 : 1,
      }}>
        {t(`enum.activity.${log.type}`)}
      </div>
      {/* Line 2: metrics (only when present) */}
      {metrics.length > 0 && (
        <div style={{
          fontFamily: "var(--font-mono)",
          fontVariantNumeric: "tabular-nums",
          color: isPlanned ? "var(--ink-3)" : "var(--ink-1)",
          fontSize: 11,
          marginTop: 1,
        }}>
          {metrics.join(" · ")}
        </div>
      )}
    </div>
  );
}
