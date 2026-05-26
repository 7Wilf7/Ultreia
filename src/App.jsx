import { useState, useEffect } from "react";
import { TABS, DEFAULT_MODEL, DEFAULT_PROFILE, DEFAULT_COACH_CONFIG, DEFAULT_LANG } from "./constants";
import { isProfileComplete } from "./utils/profile";
import { LanguageProvider, useT } from "./i18n/LanguageContext";
import { INITIAL_FILTER } from "./components/GlobalFilter";
import { TrainingTab } from "./components/TrainingTab";
import { RacesTab } from "./components/RacesTab";
import { AICoachTab } from "./components/AICoachTab";
import { CalendarTab } from "./components/CalendarTab";
import { ConfirmDeleteModal } from "./components/ConfirmDeleteModal";
import { ProfileEditor } from "./components/ProfileEditor";
import { ApiSettingsModal } from "./components/ApiSettingsModal";
import { ChangePasswordModal } from "./components/ChangePasswordModal";
import { UserBadge } from "./components/Auth/UserBadge";
import { LoginScreen } from "./components/Auth/LoginScreen";
import { MobileShell } from "./components/MobileShell";
import { SettingsMobileTab } from "./components/SettingsMobileTab";
import { useAuth } from "./hooks/useAuth";
import { useIsMobile, useIsNarrow } from "./hooks/useMediaQuery";
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
  const { user, loading, signIn, signOut, changePassword } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!user) return <LoginScreen onClose={() => {}} signIn={signIn} />;
  return <AuthedApp user={user} signOut={signOut} changePassword={changePassword} />;
}

function AuthedApp({ user, signOut, changePassword }) {
  // ── Supabase-backed: workouts (3.3c) + races (3.3d) + chatMessages (3.3e)
  //    + dailyNotes (Calendar day-level tags, e.g. ['massage'])
  const [logs, setLogs] = useState([]);
  const [races, setRaces] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [dailyNotes, setDailyNotes] = useState([]);

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
        const [profileData, settingsData, workoutsData, racesData, messagesData, notesData] = await Promise.all([
          db.profiles.getMyProfile(),
          db.userSettings.getMySettings(),
          db.workouts.listMyWorkouts(),
          db.races.listMyRaces(),
          db.coachMessages.listMyMessages(),
          db.dailyNotes.listMyDailyNotes(),
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

        // Daily notes — DAL returns date desc. Calendar indexes by date so
        // order isn't critical; we keep the DAL ordering as-is.
        setDailyNotes(notesData);
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

  // On-demand refetch — used by AI Coach right before sendChat to guarantee
  // the prompt's [Recent Activities] block reflects writes from OTHER tabs /
  // devices (single-tab writes already update local state immediately via
  // addLog/bulkAddLogs/updateLog). Returns the fresh list so the caller can
  // use it for THIS turn without waiting for the next React re-render.
  async function refreshLogs() {
    const fresh = await db.workouts.listMyWorkouts();
    setLogs(fresh);
    return fresh;
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

  // ── Daily notes — upsert by date, [] clears the row server-side. We
  // replace the matching local entry on success; if the result is null
  // (server deleted because tags=[]), drop the entry locally.
  async function setDailyTags(date, tags) {
    try {
      const updated = await db.dailyNotes.setDailyTags(date, tags);
      setDailyNotes(prev => {
        const without = prev.filter(n => n.date !== date);
        return updated ? [updated, ...without] : without;
      });
      return updated;
    } catch (err) {
      window.alert("Failed to update daily tags: " + err.message);
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
        user={user} signOut={signOut} changePassword={changePassword}
        logs={logs}
        addLog={addLog} updateLog={updateLog} bulkAddLogs={bulkAddLogs} deleteLogs={deleteLogs}
        races={races}
        addRace={addRace} updateRace={updateRace} deleteRace={deleteRace}
        chatMessages={chatMessages}
        appendChatMessage={appendChatMessage}
        appendLocalChatMessage={appendLocalChatMessage}
        clearAllChatMessages={clearAllChatMessages}
        dailyNotes={dailyNotes} setDailyTags={setDailyTags}
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
  user, signOut, changePassword,
  logs, addLog, updateLog, bulkAddLogs, deleteLogs,
  races, addRace, updateRace, deleteRace,
  chatMessages, appendChatMessage, appendLocalChatMessage, clearAllChatMessages,
  dailyNotes, setDailyTags,
  apiKey, setApiKey, apiModel, setApiModel,
  itraPI, setItraPI, profile, setProfile, coachConfig, setCoachConfig,
  coachMemory, setCoachMemory,
  lang, setLang,
}) {
  const t = useT();
  const isMobile = useIsMobile();
  const isNarrow = useIsNarrow();
  const [tab, setTab] = useState(0);
  const [period, setPeriod] = useState({ type: "all" });
  const [periodDropdown, setPeriodDropdown] = useState(null);
  const [filterDropdown, setFilterDropdown] = useState(null);
  const [globalFilter, setGlobalFilter] = useState(INITIAL_FILTER);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [now, setNow] = useState(new Date());
  const [profileEditorMode, setProfileEditorMode] = useState(null);
  const [showApiSettings, setShowApiSettings] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);

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

  // Tab content rendered identically across desktop & mobile shells — only
  // the chrome around it differs. Modals stay outside both shells so they
  // overlay everything (and aren't constrained by the mobile content scroll).
  const tabContent = (
    <>
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
        <CalendarTab
          logs={logs}
          addLog={addLog}
          updateLog={updateLog}
          setConfirmDelete={setConfirmDelete}
          dailyNotes={dailyNotes}
          setDailyTags={setDailyTags}
        />
      )}
      {tab === 2 && (
        <RacesTab
          races={races}
          addRace={addRace}
          updateRace={updateRace}
          now={now}
          setConfirmDelete={setConfirmDelete}
          itraPI={itraPI}
          setItraPI={setItraPI}
        />
      )}
      {tab === 3 && (
        <AICoachTab
          logs={logs}
          refreshLogs={refreshLogs}
          races={races}
          profile={profile}
          coachConfig={coachConfig}
          setCoachConfig={setCoachConfig}
          coachMemory={coachMemory}
          setCoachMemory={setCoachMemory}
          chatMessages={chatMessages}
          appendChatMessage={appendChatMessage}
          appendLocalChatMessage={appendLocalChatMessage}
          bulkAddLogs={bulkAddLogs}
          now={now}
          setConfirmDelete={setConfirmDelete}
          apiKey={apiKey}
          apiModel={apiModel}
          onEditProfile={() => setProfileEditorMode("edit")}
        />
      )}
    </>
  );

  const modals = (
    <>
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

      {showChangePassword && (
        <ChangePasswordModal
          changePassword={changePassword}
          onClose={() => setShowChangePassword(false)}
        />
      )}
    </>
  );

  if (isMobile) {
    // 5th tab (idx=4) is the mobile-only Settings page — it owns the actions
    // that desktop puts in the top-right (profile / api / lang / guide / signout).
    const mobileContent = tab === 4 ? (
      <SettingsMobileTab
        user={user}
        profile={profile}
        apiKey={apiKey}
        lang={lang}
        onOpenProfile={() => setProfileEditorMode("edit")}
        onOpenApiSettings={() => setShowApiSettings(true)}
        onToggleLang={toggleLang}
        onChangePassword={() => setShowChangePassword(true)}
        signOut={signOut}
      />
    ) : tabContent;
    return (
      <>
        <MobileShell tab={tab} setTab={setTab}>
          {mobileContent}
        </MobileShell>
        {modals}
      </>
    );
  }

  return (
    <div style={{
      maxWidth: 1280, margin: "0 auto",
      padding: isMobile ? "1rem 1rem 1.5rem" : "1.1rem 1.75rem 2rem",
      fontFamily: "var(--font-sans)", color: "var(--ink-1)", position: "relative",
    }}>

      {/* Top instrument bar — desktop runs a 3-column grid; narrow stacks the
          three sections vertically with the title on top (the most important
          identifier on a phone) and the brand + controls flanking it.
          Desktop revamp: left column now carries icon + GMT+8 + date + time
          inline; right column is just the controls strip (no separate clock
          block). Whole bar compresses vertically. */}
      <div style={{
        display: "grid",
        gridTemplateColumns: isNarrow ? "1fr" : "1fr auto 1fr",
        alignItems: isNarrow ? "stretch" : "center",
        gap: isNarrow ? 12 : 16,
        paddingBottom: isMobile ? 14 : 12,
        borderBottom: "1px solid var(--rule)",
        marginBottom: isMobile ? 16 : 14,
      }}>

        {/* Left: product icon + GMT+8 + date + live time, all inline.
            Replaces the older 3-line "▲ Training Studio / GMT+8 / date" block. */}
        <div style={{
          display: "flex", flexWrap: "wrap",
          alignItems: "center", gap: 10,
          fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)",
          lineHeight: 1.2,
        }}>
          <img src="/favicon.jpg" alt="Training Studio"
            style={{
              width: 28, height: 28,
              borderRadius: 4,
              flexShrink: 0,
              objectFit: "cover",
              border: "1px solid var(--rule)",
            }} />
          <div>GMT+8</div>
          <div>{now.toLocaleDateString("en-CA")}</div>
          <div style={{
            color: "var(--ink-1)",
            fontVariantNumeric: "tabular-nums",
            fontWeight: 500,
          }}>
            {now.toLocaleTimeString("en-GB", { hour12: false })}
          </div>
        </div>

        {/* Center: title — display weight, generous space.
            Narrow: smaller font, drops subtitle to save vertical space.
            Desktop: subtitle dropped too as part of the compress pass. */}
        <div style={{
          textAlign: "center",
          maxWidth: 520,
          order: isNarrow ? -1 : 0,  // title first on narrow stack
          margin: isNarrow ? "0 auto" : undefined,
        }}>
          <h2 style={{
            fontFamily: "var(--font-sans)",
            fontSize: isMobile ? 22 : 26,
            fontWeight: 500, margin: 0, color: "var(--ink-1)",
            letterSpacing: "-0.02em", lineHeight: 1.15,
          }}>
            {titleText}
          </h2>
        </div>

        {/* Right: controls strip only — the old clock+"local time" block was
            removed; the time now sits in the left column instead. */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: isNarrow ? "space-between" : "flex-end",
          gap: 10,
        }}>
          <div style={{ display: "flex", gap: 0 }}>
            <a href="https://training-studio.gitbook.io/training-studio-docs"
              target="_blank" rel="noreferrer"
              title={t("header.guide_tooltip")}
              style={{ border: "1px solid var(--rule)", borderRight: "none", background: "var(--bg-elevated)", height: 32, padding: "0 12px", fontSize: 13, color: "var(--ink-2)", fontFamily: "var(--font-sans)", borderRadius: 0, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
              {t("header.guide")}
            </a>
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
            <UserBadge user={user} signOut={signOut} onChangePassword={() => setShowChangePassword(true)} />
          </div>
        </div>
      </div>

      {/* Tabs — full-width segmented ruler. Position number stays small + mono
          to keep the instrument feel; the label is sentence case + readable.
          Mobile: trim padding, hide the 01/02/03/04 prefix to save room.
          Desktop revamp: drop the 01/02/03/04 prefix here too, bump label
          font, trim vertical padding — taller-feeling tabs in less space. */}
      <div style={{
        display: "flex",
        marginBottom: isMobile ? 20 : 18,
        borderBottom: "1px solid var(--rule)",
        overflowX: "auto", WebkitOverflowScrolling: "touch",
      }}>
        {TABS.map((label, i) => {
          const key = ["tabs.training", "tabs.calendar", "tabs.races", "tabs.ai_coach"][i];
          const active = tab === i;
          return (
            <button key={label} onClick={() => setTab(i)} style={{
              flex: 1, textAlign: "center",
              background: "transparent", border: "none",
              padding: isMobile ? "10px 8px 12px" : "9px 18px 11px",
              fontSize: isMobile ? 13 : 17,
              fontFamily: "var(--font-sans)",
              fontWeight: active ? 600 : 500,
              color: active ? "var(--ink-1)" : "var(--ink-3)",
              cursor: "pointer", whiteSpace: "nowrap",
              position: "relative",
              borderBottom: active ? "2px solid var(--ink-1)" : "2px solid transparent",
              marginBottom: -1,
              transition: "color 120ms",
            }}>
              {t(key)}
            </button>
          );
        })}
      </div>

      {tabContent}
      {modals}
    </div>
  );
}
