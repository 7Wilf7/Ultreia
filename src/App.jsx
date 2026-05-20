import { useState, useEffect } from "react";
import { TABS, DEFAULT_MODEL, DEFAULT_PROFILE, DEFAULT_COACH_CONFIG, DEFAULT_LANG } from "./constants";
import { isProfileComplete } from "./utils/profile";
import { LanguageProvider, useT } from "./i18n/LanguageContext";
import { INITIAL_FILTER } from "./components/GlobalFilter";
import { TrainingTab } from "./components/TrainingTab";
import { RacesTab } from "./components/RacesTab";
import { AICoachTab } from "./components/AICoachTab";
import { PersonalRecordsTab } from "./components/PersonalRecordsTab";
import { ConfirmDeleteModal } from "./components/ConfirmDeleteModal";
import { ProfileEditor } from "./components/ProfileEditor";
import { ApiSettingsModal } from "./components/ApiSettingsModal";
import { UserBadge } from "./components/Auth/UserBadge";
import { LoginScreen } from "./components/Auth/LoginScreen";
import { useAuth } from "./hooks/useAuth";
import * as db from "./lib/db";

function LoadingScreen() {
  return (
    <div style={{
      position: "fixed", inset: 0,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 10, background: "var(--bg)",
    }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--moss)", fontWeight: 600 }}>
        ▲ Training Studio
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Loading…
      </div>
    </div>
  );
}

export default function App() {
  const { user, loading, signIn, signOut } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!user) return <LoginScreen onClose={() => {}} signIn={signIn} />;
  return <AuthedApp user={user} signOut={signOut} />;
}

function AuthedApp({ user, signOut }) {
  // ── Supabase-backed: workouts (3.3c) + races (3.3d) + chatMessages (3.3e)
  const [logs, setLogs] = useState([]);
  const [races, setRaces] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);

  // ── Supabase-backed (loaded async on mount) ─────────────────────────────
  const [profile, setProfileState] = useState(null);
  const [itraPI, setItraPIState] = useState("");
  const [apiKey, setApiKeyState] = useState("");
  const [apiModel, setApiModelState] = useState(DEFAULT_MODEL);
  const [coachConfig, setCoachConfigState] = useState(DEFAULT_COACH_CONFIG);
  const [coachMemory, setCoachMemoryState] = useState("");
  const [lang, setLangState] = useState(DEFAULT_LANG);
  const [dataLoading, setDataLoading] = useState(true);

  // Fetch profile + user_settings + workouts once the auth'd user is known.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [profileData, settingsData, workoutsData, racesData, messagesData] = await Promise.all([
          db.profiles.getMyProfile(),
          db.userSettings.getMySettings(),
          db.workouts.listMyWorkouts(),
          db.races.listMyRaces(),
          db.coachMessages.listMyMessages(),
        ]);
        if (cancelled) return;

        // Profile — null means no row yet (handle_new_user trigger should
        // prevent this, but defend against it). DEFAULT_PROFILE keeps shape
        // consistent so AppShell can read profile.displayName safely; the
        // setup wizard still fires because isProfileComplete() checks values.
        const mergedProfile = { ...DEFAULT_PROFILE, ...(profileData || {}) };
        setProfileState(mergedProfile);
        setItraPIState(mergedProfile.itraPI ?? "");

        // Settings — same defensive merge.
        if (settingsData) {
          setApiKeyState(settingsData.apiKey ?? "");
          setApiModelState(settingsData.apiModel || DEFAULT_MODEL);
          setCoachConfigState({
            ...DEFAULT_COACH_CONFIG,
            ...(settingsData.coachConfig || {}),
          });
          setCoachMemoryState(settingsData.coachMemory ?? "");
          setLangState(settingsData.lang || DEFAULT_LANG);
        }

        // Workouts — list already sorted date desc, created_at desc by the DAL.
        setLogs(workoutsData);

        // Races — DAL returns created_at desc; RacesTab re-sorts internally
        // (target by date asc, history by date desc).
        setRaces(racesData);

        // Coach messages — DAL returns created_at asc (oldest first).
        setChatMessages(messagesData);
      } catch (err) {
        console.error("Failed to load user data:", err);
        if (!cancelled) {
          window.alert("Failed to load your data, please refresh.");
        }
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user.id]);

  // One-time cleanup: remove the legacy localStorage blob now that every
  // domain (profile / user_settings / workouts / races / chatMessages) lives
  // on Supabase. After the first run on each device this becomes a no-op.
  useEffect(() => {
    if (!user?.id) return;
    try {
      if (localStorage.getItem("wilf_training_studio_v1")) {
        localStorage.removeItem("wilf_training_studio_v1");
        console.info("[migration] removed legacy localStorage key");
      }
    } catch {
      // localStorage may be unavailable (private mode, quotas, etc.) — fine to skip.
    }
  }, [user?.id]);

  // ── Setter wrappers: optimistic local update + remote write ─────────────
  async function updateProfile(patch) {
    setProfileState(prev => ({ ...DEFAULT_PROFILE, ...(prev || {}), ...patch }));
    if ("itraPI" in patch) setItraPIState(patch.itraPI ?? "");
    try {
      await db.profiles.updateMyProfile(patch);
    } catch (err) {
      console.error("Failed to save profile:", err);
      window.alert("Failed to save profile: " + err.message);
    }
  }

  async function updateSettings(patch) {
    if ("apiKey" in patch) setApiKeyState(patch.apiKey);
    if ("apiModel" in patch) setApiModelState(patch.apiModel);
    if ("coachConfig" in patch) setCoachConfigState(patch.coachConfig);
    if ("coachMemory" in patch) setCoachMemoryState(patch.coachMemory);
    if ("lang" in patch) setLangState(patch.lang);
    try {
      await db.userSettings.updateMySettings(patch);
    } catch (err) {
      console.error("Failed to save settings:", err);
      window.alert("Failed to save settings: " + err.message);
    }
  }

  // Shims to preserve existing child-component prop shapes (setProfile,
  // setItraPI, setApiKey, ...) so nothing downstream has to change.
  const setProfile = (next) => updateProfile(next);
  const setItraPI = (v) => updateProfile({ itraPI: v });
  const setApiKey = (v) => updateSettings({ apiKey: v });
  const setApiModel = (v) => updateSettings({ apiModel: v });
  const setCoachConfig = (v) => updateSettings({ coachConfig: v });
  const setCoachMemory = (v) => updateSettings({ coachMemory: v });
  const setLang = (v) => updateSettings({ lang: v });

  // ── Workout mutations (3.3c). Server-side write completes before local
  // state updates so we pick up the server-generated id / created_at. ──────
  async function addLog(workoutData, { source = "manual" } = {}) {
    try {
      const created = await db.workouts.createWorkout(workoutData, { source });
      setLogs(prev => [created, ...prev]);
      return created;
    } catch (err) {
      window.alert("Failed to add workout: " + err.message);
      throw err;
    }
  }

  async function updateLog(id, patch) {
    try {
      const updated = await db.workouts.updateWorkout(id, patch);
      setLogs(prev => prev.map(l => l.id === id ? updated : l));
      return updated;
    } catch (err) {
      window.alert("Failed to update workout: " + err.message);
      throw err;
    }
  }

  async function bulkAddLogs(workouts, { source = "garmin_csv" } = {}) {
    try {
      const created = await db.workouts.bulkInsertWorkouts(workouts, { source });
      setLogs(prev => [...created, ...prev]);
      return created;
    } catch (err) {
      window.alert(err.message);
      throw err;
    }
  }

  async function deleteLogs(ids) {
    const idArr = Array.isArray(ids) ? ids : [ids];
    try {
      await db.workouts.deleteWorkouts(idArr);
      setLogs(prev => prev.filter(l => !idArr.includes(l.id)));
    } catch (err) {
      window.alert("Failed to delete workout: " + err.message);
      throw err;
    }
  }

  // ── Race mutations (3.3d). Same shape as workouts: await server, then
  // patch local state with the canonical row. ─────────────────────────────
  async function addRace(raceData) {
    try {
      const created = await db.races.createRace(raceData);
      setRaces(prev => [created, ...prev]);
      return created;
    } catch (err) {
      window.alert("Failed to add race: " + err.message);
      throw err;
    }
  }

  async function updateRace(id, patch) {
    try {
      const updated = await db.races.updateRace(id, patch);
      setRaces(prev => prev.map(r => r.id === id ? updated : r));
      return updated;
    } catch (err) {
      window.alert("Failed to update race: " + err.message);
      throw err;
    }
  }

  async function deleteRace(id) {
    try {
      await db.races.deleteRace(id);
      setRaces(prev => prev.filter(r => r.id !== id));
    } catch (err) {
      window.alert("Failed to delete race: " + err.message);
      throw err;
    }
  }

  // ── Coach message mutations (3.3e). Chat is append-only at the row level;
  // streaming responses are NOT used (DeepSeek call is one-shot await
  // resp.json), so a single append per assistant turn is correct. ─────────
  async function appendChatMessage(role, content) {
    try {
      const msg = await db.coachMessages.appendMessage(role, content);
      setChatMessages(prev => [...prev, msg]);
      return msg;
    } catch (err) {
      window.alert("Failed to save message: " + err.message);
      throw err;
    }
  }

  async function clearAllChatMessages() {
    try {
      await db.coachMessages.clearAllMessages();
      setChatMessages([]);
    } catch (err) {
      window.alert("Failed to clear messages: " + err.message);
      throw err;
    }
  }

  // Transient, in-memory only — used for error fallback bubbles (API error,
  // network error, missing key). Refreshing the page clears them since they
  // never reach the DB. `isLocal` lets downstream code identify them.
  function appendLocalChatMessage(role, content) {
    setChatMessages(prev => [...prev, {
      id: `local-${Date.now()}`,
      role,
      content,
      createdAt: new Date().toISOString(),
      isLocal: true,
    }]);
  }

  if (dataLoading) return <LoadingScreen />;

  return (
    <LanguageProvider lang={lang} setLang={setLang}>
      <AppShell
        user={user} signOut={signOut}
        logs={logs}
        addLog={addLog} updateLog={updateLog} bulkAddLogs={bulkAddLogs} deleteLogs={deleteLogs}
        races={races}
        addRace={addRace} updateRace={updateRace} deleteRace={deleteRace}
        chatMessages={chatMessages}
        appendChatMessage={appendChatMessage}
        appendLocalChatMessage={appendLocalChatMessage}
        clearAllChatMessages={clearAllChatMessages}
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
  user, signOut,
  logs, addLog, updateLog, bulkAddLogs, deleteLogs,
  races, addRace, updateRace, deleteRace,
  chatMessages, appendChatMessage, appendLocalChatMessage, clearAllChatMessages,
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

  async function executeDelete() {
    if (!confirmDelete) return;
    if (confirmDelete.type === "log") {
      await deleteLogs([confirmDelete.id]);
    }
    if (confirmDelete.type === "logs") {
      await deleteLogs(confirmDelete.ids);
    }
    if (confirmDelete.type === "race") {
      await deleteRace(confirmDelete.id);
    }
    if (confirmDelete.type === "chat") {
      await clearAllChatMessages();
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
              style={{ border: "1px solid var(--rule)", borderRight: "none", background: "var(--bg-elevated)", height: 32, width: 38, fontSize: 15, color: "var(--ink-2)", borderRadius: 0 }}>
              ⚙
            </button>
            <UserBadge user={user} signOut={signOut} />
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
          addLog={addLog}
          updateLog={updateLog}
          bulkAddLogs={bulkAddLogs}
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
          addRace={addRace}
          updateRace={updateRace}
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
          appendChatMessage={appendChatMessage}
          appendLocalChatMessage={appendLocalChatMessage}
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
