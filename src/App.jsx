import { useState, useEffect } from "react";
import { STORAGE_KEY, TABS, DEFAULT_MODEL, DEFAULT_PROFILE, DEFAULT_COACH_CONFIG, DEFAULT_LANG } from "./constants";
import { isProfileComplete } from "./utils/profile";
import { sampleLogs, sampleRaces } from "./data/samples";
import { migrateLogs, migrateRaces, migrateProfile, migrateCoachConfig } from "./utils/migrate";
import { LanguageProvider, useT } from "./i18n/LanguageContext";
import { INITIAL_FILTER } from "./components/GlobalFilter";
import { TrainingTab } from "./components/TrainingTab";
import { RacesTab } from "./components/RacesTab";
import { AICoachTab } from "./components/AICoachTab";
import { PersonalRecordsTab } from "./components/PersonalRecordsTab";
import { ConfirmDeleteModal } from "./components/ConfirmDeleteModal";
import { ProfileEditor } from "./components/ProfileEditor";
import { ApiSettingsModal } from "./components/ApiSettingsModal";

function loadFromStorage(key, fallback) {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed[key] !== undefined) return parsed[key];
    }
  } catch {}
  return fallback;
}

export default function App() {
  const [logs, setLogs] = useState(() => migrateLogs(loadFromStorage("logs", sampleLogs)));
  const [races, setRaces] = useState(() => migrateRaces(loadFromStorage("races", sampleRaces)));
  const [chatMessages, setChatMessages] = useState(() => loadFromStorage("chatMessages", []));
  const [apiKey, setApiKey] = useState(() => loadFromStorage("apiKey", ""));
  const [apiModel, setApiModel] = useState(() => loadFromStorage("apiModel", DEFAULT_MODEL));
  const [itraPI, setItraPI] = useState(() => loadFromStorage("itraPI", ""));
  const [profile, setProfile] = useState(() => ({ ...DEFAULT_PROFILE, ...migrateProfile(loadFromStorage("profile", {})) }));
  const [coachConfig, setCoachConfig] = useState(() => ({ ...DEFAULT_COACH_CONFIG, ...migrateCoachConfig(loadFromStorage("coachConfig", {})) }));
  // Long-term coach memory — plain text the user or the model can update over time.
  const [coachMemory, setCoachMemory] = useState(() => loadFromStorage("coachMemory", ""));
  const [lang, setLang] = useState(() => loadFromStorage("lang", DEFAULT_LANG));

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        logs, races, chatMessages, apiKey, apiModel, itraPI, profile, coachConfig, coachMemory, lang,
      }));
    } catch {}
  }, [logs, races, chatMessages, apiKey, apiModel, itraPI, profile, coachConfig, coachMemory, lang]);

  return (
    <LanguageProvider lang={lang} setLang={setLang}>
      <AppShell
        logs={logs} setLogs={setLogs}
        races={races} setRaces={setRaces}
        chatMessages={chatMessages} setChatMessages={setChatMessages}
        apiKey={apiKey} setApiKey={setApiKey}
        apiModel={apiModel} setApiModel={setApiModel}
        itraPI={itraPI} setItraPI={setItraPI}
        profile={profile} setProfile={setProfile}
        coachConfig={coachConfig} setCoachConfig={setCoachConfig}
        coachMemory={coachMemory} setCoachMemory={setCoachMemory}
        lang={lang} setLang={setLang}
      />
    </LanguageProvider>
  );
}

function AppShell({
  logs, setLogs, races, setRaces, chatMessages, setChatMessages,
  apiKey, setApiKey, apiModel, setApiModel,
  itraPI, setItraPI, profile, setProfile, coachConfig, setCoachConfig,
  coachMemory, setCoachMemory,
  lang, setLang,
}) {
  const t = useT();
  const [tab, setTab] = useState(0);
  const [period, setPeriod] = useState({ type: "all" });
  const [periodDropdown, setPeriodDropdown] = useState(null);
  const [filterDropdown, setFilterDropdown] = useState(null);
  const [globalFilter, setGlobalFilter] = useState(INITIAL_FILTER);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [now, setNow] = useState(new Date());
  const [profileEditorMode, setProfileEditorMode] = useState(null);
  const [showApiSettings, setShowApiSettings] = useState(false);

  // First-time setup: force the wizard until profile is complete (incl. displayName)
  useEffect(() => {
    if (!isProfileComplete(profile)) {
      setProfileEditorMode("setup");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    function onClick(e) {
      if (!e.target.closest("[data-period-control]")) setPeriodDropdown(null);
      if (!e.target.closest("[data-global-filter]")) setFilterDropdown(null);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  function executeDelete() {
    if (!confirmDelete) return;
    if (confirmDelete.type === "log") {
      setLogs(logs.filter(l => l.id !== confirmDelete.id));
    }
    if (confirmDelete.type === "logs") {
      const idSet = new Set(confirmDelete.ids);
      setLogs(logs.filter(l => !idSet.has(l.id)));
    }
    if (confirmDelete.type === "race") {
      setRaces(races.filter(r => r.id !== confirmDelete.id));
    }
    if (confirmDelete.type === "chat") {
      setChatMessages([]);
    }
    setConfirmDelete(null);
  }

  function toggleLang() {
    setLang(lang === "en" ? "zh" : "en");
  }

  const titleText = profile.displayName
    ? t("header.title", { name: profile.displayName })
    : t("header.title_empty");

  // Keep the browser tab title in sync with the displayed page title
  useEffect(() => { document.title = titleText; }, [titleText]);

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "1.5rem 1.75rem 2rem", fontFamily: "var(--font-sans)", color: "var(--ink-1)", position: "relative" }}>

      {/* Top instrument bar — runs full-width across the top with hairline ruling
          underneath. Layout is a 3-column grid: brand mark / center title / readout + controls. */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "flex-start",
        gap: 16,
        paddingBottom: 18,
        borderBottom: "1px solid var(--rule)",
        marginBottom: 24,
      }}>

        {/* Left: brand mark — coordinate-style identifier */}
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)", lineHeight: 1.6 }}>
          <div style={{ color: "var(--moss)", fontWeight: 600 }}>▲ Training Studio</div>
          <div>GMT+8</div>
          <div>{now.toLocaleDateString("en-CA")}</div>
        </div>

        {/* Center: title — display weight, generous space */}
        <div style={{ textAlign: "center", maxWidth: 520 }}>
          <h2 style={{ fontFamily: "var(--font-sans)", fontSize: 30, fontWeight: 500, margin: 0, color: "var(--ink-1)", letterSpacing: "-0.02em", lineHeight: 1.15 }}>
            {titleText}
          </h2>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--ink-3)", margin: "8px 0 0" }}>
            {t("header.subtitle")}
          </p>
        </div>

        {/* Right: clock + controls. Clock as instrument readout (big mono), buttons as ruled cells. */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
          <div style={{ fontFamily: "var(--font-mono)", color: "var(--ink-1)", textAlign: "right", lineHeight: 1.1 }}>
            <div style={{ fontSize: 24, fontWeight: 500, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
              {now.toLocaleTimeString("en-GB", { hour12: false })}
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>
              local time
            </div>
          </div>
          <div style={{ display: "flex", gap: 0 }}>
            <button onClick={toggleLang} title={t("header.lang_tooltip")}
              style={{ border: "1px solid var(--rule)", borderRight: "none", background: "var(--bg-elevated)", height: 32, padding: "0 12px", fontSize: 13, color: "var(--ink-2)", fontFamily: "var(--font-sans)", borderRadius: 0 }}>
              {lang === "en" ? "中" : "EN"}
            </button>
            <button onClick={() => setShowApiSettings(true)} title={t("header.api_tooltip")}
              style={{ border: "1px solid var(--rule)", borderRight: "none", background: apiKey ? "var(--bg-elevated)" : "rgba(181,78,26,0.08)", height: 32, padding: "0 12px", fontSize: 13, color: apiKey ? "var(--ink-2)" : "var(--warn)", fontFamily: "var(--font-sans)", borderRadius: 0 }}>
              {t("header.api")}{!apiKey && " ⚠"}
            </button>
            <button onClick={() => setProfileEditorMode("edit")} title={t("header.profile")}
              style={{ border: "1px solid var(--rule)", background: "var(--bg-elevated)", height: 32, width: 38, fontSize: 15, color: "var(--ink-2)", borderRadius: 0 }}>
              ⚙
            </button>
          </div>
        </div>
      </div>

      {/* Tabs — full-width segmented ruler. Position number stays small + mono
          to keep the instrument feel; the label is sentence case + readable. */}
      <div style={{ display: "flex", marginBottom: 28, borderBottom: "1px solid var(--rule)", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        {TABS.map((label, i) => {
          const key = ["tabs.training", "tabs.races", "tabs.pr", "tabs.ai_coach"][i];
          const active = tab === i;
          return (
            <button key={label} onClick={() => setTab(i)} style={{
              flex: 1, textAlign: "center",
              background: "transparent", border: "none",
              padding: "14px 18px 18px",
              fontSize: 15, fontFamily: "var(--font-sans)",
              fontWeight: active ? 600 : 500,
              color: active ? "var(--ink-1)" : "var(--ink-3)",
              cursor: "pointer", whiteSpace: "nowrap",
              position: "relative",
              borderBottom: active ? "2px solid var(--ink-1)" : "2px solid transparent",
              marginBottom: -1,
              transition: "color 120ms",
            }}>
              <span style={{ color: "var(--ink-3)", marginRight: 8, fontWeight: 400, fontFamily: "var(--font-mono)", fontSize: 11 }}>{String(i + 1).padStart(2, "0")}</span>
              {t(key)}
            </button>
          );
        })}
      </div>

      {tab === 0 && (
        <TrainingTab
          logs={logs}
          setLogs={setLogs}
          filter={globalFilter}
          setFilter={setGlobalFilter}
          filterDropdown={filterDropdown}
          setFilterDropdown={setFilterDropdown}
          period={period}
          setPeriod={setPeriod}
          periodDropdown={periodDropdown}
          setPeriodDropdown={setPeriodDropdown}
          setConfirmDelete={setConfirmDelete}
          profile={profile}
        />
      )}
      {tab === 1 && (
        <RacesTab
          races={races}
          setRaces={setRaces}
          now={now}
          setConfirmDelete={setConfirmDelete}
        />
      )}
      {tab === 2 && (
        <PersonalRecordsTab
          races={races}
          itraPI={itraPI}
          setItraPI={setItraPI}
        />
      )}
      {tab === 3 && (
        <AICoachTab
          logs={logs}
          races={races}
          profile={profile}
          coachConfig={coachConfig}
          setCoachConfig={setCoachConfig}
          coachMemory={coachMemory}
          setCoachMemory={setCoachMemory}
          chatMessages={chatMessages}
          setChatMessages={setChatMessages}
          now={now}
          setConfirmDelete={setConfirmDelete}
          apiKey={apiKey}
          apiModel={apiModel}
          onEditProfile={() => setProfileEditorMode("edit")}
        />
      )}

      <ConfirmDeleteModal
        confirmDelete={confirmDelete}
        setConfirmDelete={setConfirmDelete}
        onConfirm={executeDelete}
      />

      {profileEditorMode && (
        <ProfileEditor
          profile={profile}
          setProfile={setProfile}
          mode={profileEditorMode}
          onClose={() => setProfileEditorMode(null)}
        />
      )}

      {showApiSettings && (
        <ApiSettingsModal
          apiKey={apiKey}
          setApiKey={setApiKey}
          apiModel={apiModel}
          setApiModel={setApiModel}
          onClose={() => setShowApiSettings(false)}
        />
      )}
    </div>
  );
}
