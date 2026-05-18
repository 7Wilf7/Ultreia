import { useState, useEffect } from "react";
import { STORAGE_KEY, TABS, DEFAULT_API_ENDPOINT, DEFAULT_MODEL, DEFAULT_PROFILE, DEFAULT_COACH_CONFIG, DEFAULT_LANG } from "./constants";
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
  const [apiEndpoint, setApiEndpoint] = useState(() => loadFromStorage("apiEndpoint", DEFAULT_API_ENDPOINT));
  const [apiModel, setApiModel] = useState(() => loadFromStorage("apiModel", DEFAULT_MODEL));
  const [bochaApiKey, setBochaApiKey] = useState(() => loadFromStorage("bochaApiKey", ""));
  const [itraPI, setItraPI] = useState(() => loadFromStorage("itraPI", ""));
  const [profile, setProfile] = useState(() => ({ ...DEFAULT_PROFILE, ...migrateProfile(loadFromStorage("profile", {})) }));
  const [coachConfig, setCoachConfig] = useState(() => ({ ...DEFAULT_COACH_CONFIG, ...migrateCoachConfig(loadFromStorage("coachConfig", {})) }));
  const [lang, setLang] = useState(() => loadFromStorage("lang", DEFAULT_LANG));

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        logs, races, chatMessages, apiKey, apiEndpoint, apiModel, bochaApiKey, itraPI, profile, coachConfig, lang,
      }));
    } catch {}
  }, [logs, races, chatMessages, apiKey, apiEndpoint, apiModel, bochaApiKey, itraPI, profile, coachConfig, lang]);

  return (
    <LanguageProvider lang={lang} setLang={setLang}>
      <AppShell
        logs={logs} setLogs={setLogs}
        races={races} setRaces={setRaces}
        chatMessages={chatMessages} setChatMessages={setChatMessages}
        apiKey={apiKey} setApiKey={setApiKey}
        apiEndpoint={apiEndpoint} setApiEndpoint={setApiEndpoint}
        apiModel={apiModel} setApiModel={setApiModel}
        bochaApiKey={bochaApiKey} setBochaApiKey={setBochaApiKey}
        itraPI={itraPI} setItraPI={setItraPI}
        profile={profile} setProfile={setProfile}
        coachConfig={coachConfig} setCoachConfig={setCoachConfig}
        lang={lang} setLang={setLang}
      />
    </LanguageProvider>
  );
}

function AppShell({
  logs, setLogs, races, setRaces, chatMessages, setChatMessages,
  apiKey, setApiKey, apiEndpoint, setApiEndpoint, apiModel, setApiModel,
  bochaApiKey, setBochaApiKey,
  itraPI, setItraPI, profile, setProfile, coachConfig, setCoachConfig,
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
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "1.25rem 1.5rem", fontFamily: "var(--font-sans)", color: "#111", position: "relative" }}>

      {/* Top-right floating controls (absolute, so the title can sit centered) */}
      <div style={{ position: "absolute", top: 20, right: 24, display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 11, color: "#888", lineHeight: 1.5 }}>
          <div>{now.toLocaleDateString("en-CA")}</div>
          <div style={{ fontSize: 14, color: "#333", fontWeight: 500 }}>{now.toLocaleTimeString("en-GB", { hour12: false })}</div>
          <div>GMT+8</div>
        </div>
        <button onClick={toggleLang}
          title={t("header.lang_tooltip")}
          style={{ border: "1px solid #ddd", background: "#fff", borderRadius: 8, height: 36, padding: "0 12px", fontSize: 13, cursor: "pointer", color: "#444", fontWeight: 500, fontFamily: "var(--font-mono)" }}>
          {lang === "en" ? "中" : "EN"}
        </button>
        <button onClick={() => setShowApiSettings(true)}
          title={t("header.api_tooltip")}
          style={{ border: "1px solid #ddd", background: apiKey ? "#fff" : "#fff4e0", borderRadius: 8, height: 36, padding: "0 12px", fontSize: 13, cursor: "pointer", color: "#444", fontWeight: 500 }}>
          🔑 {t("header.api")}{!apiKey && " ⚠"}
        </button>
        <button onClick={() => setProfileEditorMode("edit")}
          title={t("header.profile")}
          style={{ border: "1px solid #ddd", background: "#fff", borderRadius: 8, width: 36, height: 36, fontSize: 16, cursor: "pointer", color: "#444" }}>
          ⚙
        </button>
      </div>

      {/* Centered title block */}
      <div style={{ textAlign: "center", marginBottom: 22, paddingTop: 4 }}>
        <h2 style={{ fontSize: 24, fontWeight: 500, margin: 0, color: "#111" }}>{titleText}</h2>
        <p style={{ fontSize: 14, color: "#888", margin: "4px 0 0" }}>{t("header.subtitle")}</p>
      </div>

      {/* Centered tabs — each tab takes equal width, label centered */}
      <div style={{ display: "flex", borderBottom: "1px solid #e8e8e8", marginBottom: 22, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        {TABS.map((label, i) => {
          const key = ["tabs.training", "tabs.races", "tabs.pr", "tabs.ai_coach"][i];
          return (
            <button key={label} onClick={() => setTab(i)} style={{
              flex: 1, textAlign: "center",
              background: "none", border: "none",
              borderBottom: tab === i ? "2px solid #111" : "2px solid transparent",
              padding: "12px 22px", fontSize: 15, fontWeight: tab === i ? 500 : 400,
              color: tab === i ? "#111" : "#888", cursor: "pointer", marginBottom: -1, whiteSpace: "nowrap",
            }}>{t(key)}</button>
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
        />
      )}
      {tab === 1 && (
        <RacesTab
          races={races}
          setRaces={setRaces}
          now={now}
          setConfirmDelete={setConfirmDelete}
          apiKey={apiKey}
          apiEndpoint={apiEndpoint}
          apiModel={apiModel}
          bochaApiKey={bochaApiKey}
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
          chatMessages={chatMessages}
          setChatMessages={setChatMessages}
          now={now}
          setConfirmDelete={setConfirmDelete}
          apiKey={apiKey}
          apiEndpoint={apiEndpoint}
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
          apiEndpoint={apiEndpoint}
          setApiEndpoint={setApiEndpoint}
          apiModel={apiModel}
          setApiModel={setApiModel}
          bochaApiKey={bochaApiKey}
          setBochaApiKey={setBochaApiKey}
          onClose={() => setShowApiSettings(false)}
        />
      )}
    </div>
  );
}
