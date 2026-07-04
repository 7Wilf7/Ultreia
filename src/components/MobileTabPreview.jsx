import { RUN_GROUP_TYPES, TYPE_COLOR } from "../constants";
import { messageContentForCoach } from "../utils/coachPrompt";
import { formatDateShort, formatDurationShort, formatPaceFromSec } from "../utils/format";

const TAB_KEYS = ["tabs.training", "tabs.calendar", "tabs.ai_coach", "tabs.races", "tabs.settings"];

function copy(lang, zh, en) {
  return lang === "zh" ? zh : en;
}

function toDateKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function cleanText(value, max = 96) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function byDateDesc(a, b) {
  return String(b?.date || b?.createdAt || "").localeCompare(String(a?.date || a?.createdAt || ""));
}

function workoutMeta(log) {
  const bits = [];
  if (Number(log?.distance) > 0) bits.push(`${Number(log.distance).toFixed(1)} km`);
  if (Number(log?.duration) > 0) bits.push(formatDurationShort(Number(log.duration)));
  if (RUN_GROUP_TYPES.includes(log?.type) && Number(log?.pace) > 0) bits.push(`${formatPaceFromSec(Number(log.pace))} /km`);
  return bits.join(" · ");
}

function PreviewFrame({ title, eyebrow, children }) {
  return (
    <div
      aria-hidden="true"
      style={{
        minHeight: "100%",
        pointerEvents: "none",
        userSelect: "none",
        color: "var(--ink-1)",
        display: "grid",
        alignContent: "start",
        gap: 12,
      }}
    >
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 12,
        paddingTop: 2,
      }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 0, lineHeight: 1.1 }}>
          {title}
        </div>
        <div style={{
          fontSize: 11,
          color: "var(--ink-3)",
          fontFamily: "var(--font-mono)",
          textTransform: "uppercase",
          letterSpacing: 0,
          whiteSpace: "nowrap",
        }}>
          {eyebrow}
        </div>
      </div>
      {children}
    </div>
  );
}

function PreviewPanel({ children, compact = false }) {
  return (
    <div style={{
      border: "1px solid var(--rule)",
      background: "oklch(0.15 0.012 145 / 0.84)",
      borderRadius: 8,
      padding: compact ? "9px 10px" : "12px",
      display: "grid",
      gap: compact ? 7 : 10,
      boxShadow: "none",
    }}>
      {children}
    </div>
  );
}

function EmptyLine({ lang }) {
  return (
    <div style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.45 }}>
      {copy(lang, "暂无内容", "Nothing here yet")}
    </div>
  );
}

function WorkoutRows({ logs, lang }) {
  const rows = [...(logs || [])]
    .filter(log => !log?.isPlanned)
    .sort(byDateDesc)
    .slice(0, 5);

  if (!rows.length) return <EmptyLine lang={lang} />;

  return rows.map((log, idx) => (
    <div key={log.id || `${log.date}-${idx}`} style={{
      display: "grid",
      gridTemplateColumns: "10px 1fr",
      gap: 9,
      alignItems: "center",
      minWidth: 0,
    }}>
      <span style={{
        width: 8,
        height: 8,
        borderRadius: 2,
        background: TYPE_COLOR[log.type] || "var(--ink-3)",
      }} />
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 13,
          color: "var(--ink-1)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          {[formatDateShort(log.date), log.type].filter(Boolean).join(" · ")}
        </div>
        <div style={{
          fontSize: 11,
          color: "var(--ink-3)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          marginTop: 2,
        }}>
          {workoutMeta(log) || copy(lang, "记录已保存", "Saved workout")}
        </div>
      </div>
    </div>
  ));
}

function TrainingPreview({ t, lang, logs }) {
  const completed = (logs || []).filter(log => !log?.isPlanned);
  const totalKm = completed.reduce((sum, log) => sum + (Number(log.distance) || 0), 0);
  const totalTime = completed.reduce((sum, log) => sum + (Number(log.duration) || 0), 0);

  return (
    <PreviewFrame title={t("tabs.training")} eyebrow={copy(lang, "预览", "Preview")}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <PreviewPanel compact>
          <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{copy(lang, "总距离", "Distance")}</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{totalKm.toFixed(1)} km</div>
        </PreviewPanel>
        <PreviewPanel compact>
          <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{copy(lang, "总时长", "Time")}</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{formatDurationShort(totalTime)}</div>
        </PreviewPanel>
      </div>
      <PreviewPanel>
        <div style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 650 }}>
          {copy(lang, "最近训练", "Recent workouts")}
        </div>
        <WorkoutRows logs={logs} lang={lang} />
      </PreviewPanel>
    </PreviewFrame>
  );
}

function buildMonthCells(now, logs, dailyNotes, races) {
  const base = now instanceof Date ? now : new Date();
  const year = base.getFullYear();
  const month = base.getMonth();
  const first = new Date(year, month, 1);
  const firstDay = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const workoutDates = new Set((logs || []).map(log => log?.date).filter(Boolean));
  const noteDates = new Set((dailyNotes || []).map(note => note?.date).filter(Boolean));
  const raceDates = new Set((races || []).map(race => race?.date).filter(Boolean));

  return Array.from({ length: 42 }, (_, idx) => {
    const day = idx - firstDay + 1;
    if (day < 1 || day > daysInMonth) return null;
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return {
      day,
      key,
      hasWorkout: workoutDates.has(key),
      hasNote: noteDates.has(key),
      hasRace: raceDates.has(key),
      isToday: key === toDateKey(new Date()),
    };
  });
}

function CalendarPreview({ t, lang, now, logs, dailyNotes, races }) {
  const base = now instanceof Date ? now : new Date();
  const cells = buildMonthCells(base, logs, dailyNotes, races);
  const monthLabel = base.toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "long",
  });

  return (
    <PreviewFrame title={t("tabs.calendar")} eyebrow={monthLabel}>
      <PreviewPanel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5 }}>
          {cells.map((cell, idx) => (
            <div key={cell?.key || `empty-${idx}`} style={{
              aspectRatio: "1",
              borderRadius: 6,
              border: cell?.isToday ? "1px solid var(--accent)" : "1px solid oklch(1 0 0 / 0.045)",
              background: cell ? "oklch(0.12 0.010 145 / 0.92)" : "transparent",
              padding: 4,
              display: "grid",
              alignContent: "space-between",
              opacity: cell ? 1 : 0.28,
            }}>
              {cell && (
                <>
                  <div style={{ fontSize: 10, color: cell.isToday ? "var(--accent)" : "var(--ink-3)" }}>{cell.day}</div>
                  <div style={{ display: "flex", gap: 2, minHeight: 4 }}>
                    {cell.hasWorkout && <span style={{ width: 10, height: 3, borderRadius: 2, background: "var(--accent)" }} />}
                    {cell.hasNote && <span style={{ width: 4, height: 4, borderRadius: 2, background: "var(--ink-3)" }} />}
                    {cell.hasRace && <span style={{ width: 4, height: 4, borderRadius: 2, background: "var(--danger)" }} />}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </PreviewPanel>
    </PreviewFrame>
  );
}

function CoachPreview({ t, lang, chatMessages, chatLoading, codexRunnerStatus }) {
  const rows = [...(chatMessages || [])]
    .filter(msg => String(messageContentForCoach(msg?.content) || "").trim())
    .slice(-4)
    .reverse();
  const runnerState = codexRunnerStatus?.runner_state || codexRunnerStatus?.state || "unknown";

  return (
    <PreviewFrame title={t("tabs.ai_coach")} eyebrow={runnerState}>
      <PreviewPanel>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <div style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 650 }}>
            {copy(lang, "最近对话", "Recent chat")}
          </div>
          {chatLoading && (
            <div style={{ fontSize: 11, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
              {copy(lang, "生成中", "Thinking")}
            </div>
          )}
        </div>
        {rows.length ? rows.map((msg, idx) => (
          <div key={msg.id || `${msg.role}-${idx}`} style={{
            border: "1px solid var(--rule)",
            borderRadius: 7,
            background: msg.role === "assistant" ? "oklch(0.17 0.018 138 / 0.58)" : "oklch(0.12 0.010 145 / 0.58)",
            padding: "7px 8px",
            minWidth: 0,
          }}>
            <div style={{ fontSize: 11, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: 0 }}>
              {msg.role === "assistant" ? copy(lang, "教练", "Coach") : copy(lang, "我", "Me")}
            </div>
            <div style={{
              fontSize: 13,
              color: "var(--ink-1)",
              lineHeight: 1.45,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}>
              {cleanText(messageContentForCoach(msg.content), 120)}
            </div>
          </div>
        )) : <EmptyLine lang={lang} />}
      </PreviewPanel>
    </PreviewFrame>
  );
}

function RacesPreview({ t, lang, races, now }) {
  const today = toDateKey(now || new Date());
  const upcoming = [...(races || [])]
    .filter(race => race?.date && String(race.date) >= today)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(0, 4);
  const past = [...(races || [])]
    .filter(race => race?.date && String(race.date) < today)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 2);
  const rows = upcoming.length ? upcoming : past;

  return (
    <PreviewFrame title={t("tabs.races")} eyebrow={copy(lang, "赛事", "Races")}>
      <PreviewPanel>
        {rows.length ? rows.map((race, idx) => (
          <div key={race.id || `${race.date}-${idx}`} style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 13,
              color: "var(--ink-1)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}>
              {[formatDateShort(race.date), race.name].filter(Boolean).join(" · ")}
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>
              {[race.category, race.distance].filter(Boolean).join(" · ") || copy(lang, "比赛记录", "Race record")}
            </div>
          </div>
        )) : <EmptyLine lang={lang} />}
      </PreviewPanel>
    </PreviewFrame>
  );
}

function SettingsPreview({ t, lang }) {
  const rows = [
    "settings.profile",
    "settings.daily_push",
    "settings.weather_updates",
    "settings.language",
    "settings.guide",
  ];

  return (
    <PreviewFrame title={t("tabs.settings")} eyebrow={copy(lang, "设置", "Settings")}>
      <PreviewPanel>
        {rows.map(key => (
          <div key={key} style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            borderBottom: "1px solid oklch(1 0 0 / 0.045)",
            paddingBottom: 8,
          }}>
            <span style={{ fontSize: 13, color: "var(--ink-1)" }}>{t(key)}</span>
            <span style={{ width: 18, height: 6, borderRadius: 999, background: "var(--rule)" }} />
          </div>
        ))}
      </PreviewPanel>
    </PreviewFrame>
  );
}

export function MobileTabPreview({
  tabIndex,
  t,
  lang,
  logs = [],
  races = [],
  dailyNotes = [],
  chatMessages = [],
  chatLoading = false,
  codexRunnerStatus = null,
  now = new Date(),
}) {
  const title = t(TAB_KEYS[tabIndex] || "tabs.training");
  if (tabIndex === 0) return <TrainingPreview t={t} lang={lang} logs={logs} />;
  if (tabIndex === 1) return <CalendarPreview t={t} lang={lang} now={now} logs={logs} dailyNotes={dailyNotes} races={races} />;
  if (tabIndex === 2) return <CoachPreview t={t} lang={lang} chatMessages={chatMessages} chatLoading={chatLoading} codexRunnerStatus={codexRunnerStatus} />;
  if (tabIndex === 3) return <RacesPreview t={t} lang={lang} races={races} now={now} />;
  if (tabIndex === 4) return <SettingsPreview t={t} lang={lang} />;
  return (
    <PreviewFrame title={title} eyebrow={copy(lang, "预览", "Preview")}>
      <PreviewPanel><EmptyLine lang={lang} /></PreviewPanel>
    </PreviewFrame>
  );
}
