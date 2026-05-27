import { useState, useEffect } from "react";
import {
  TABS, DEFAULT_PROFILE, DEFAULT_COACH_CONFIG, DEFAULT_LANG,
  API_PROVIDERS, DEFAULT_API_PROVIDER, getEndpointUrl, ACTIVITY_TYPES,
} from "./constants";
import { isProfileComplete, buildSystemPrompt } from "./utils/profile";
import { buildDataBlock, parsePlansFromLLM } from "./utils/coachPrompt";
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
import { CoachPlanImportModal } from "./components/CoachPlanImportModal";
import { Spinner } from "./components/Spinner";
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
  // Provider-aware: keys for BOTH providers are persisted so the user can
  // flip between DeepSeek and Claude without re-pasting. apiProvider drives
  // which key + endpoint + model preset list the chat client uses.
  const [apiProvider, setApiProviderState] = useState(DEFAULT_API_PROVIDER);
  const [apiKey, setApiKeyState] = useState("");          // DeepSeek key
  const [claudeApiKey, setClaudeApiKeyState] = useState(""); // Claude key (third-party relay)
  const [apiModel, setApiModelState] = useState(API_PROVIDERS[DEFAULT_API_PROVIDER].defaultModel);
  // Claude endpoint pick lives in localStorage (per device, not per account)
  // because the right mirror depends on the current network — a phone on
  // mobile data may want the Tokyo/Singapore route, the home laptop may not.
  // Per-account sync would force one choice across devices, which is worse.
  const [claudeEndpointId, setClaudeEndpointIdState] = useState(() => {
    try {
      return localStorage.getItem("ts.claudeEndpointId") || "default";
    } catch { return "default"; }
  });
  function setClaudeEndpointId(id) {
    setClaudeEndpointIdState(id);
    try { localStorage.setItem("ts.claudeEndpointId", id); } catch { /* private mode, etc. */ }
  }
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
          const provider = (settingsData.apiProvider && API_PROVIDERS[settingsData.apiProvider])
            ? settingsData.apiProvider
            : DEFAULT_API_PROVIDER;
          setApiProviderState(provider);
          setApiKeyState(settingsData.apiKey ?? "");
          setClaudeApiKeyState(settingsData.claudeApiKey ?? "");
          setApiModelState(settingsData.apiModel || API_PROVIDERS[provider].defaultModel);
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
    if ("apiProvider" in patch) setApiProviderState(patch.apiProvider);
    if ("apiKey" in patch) setApiKeyState(patch.apiKey);
    if ("claudeApiKey" in patch) setClaudeApiKeyState(patch.claudeApiKey);
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
  const setApiProvider = (v) => updateSettings({ apiProvider: v });
  const setApiKey = (v) => updateSettings({ apiKey: v });
  const setClaudeApiKey = (v) => updateSettings({ claudeApiKey: v });
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
        logs={logs} refreshLogs={refreshLogs}
        addLog={addLog} updateLog={updateLog} bulkAddLogs={bulkAddLogs} deleteLogs={deleteLogs}
        races={races}
        addRace={addRace} updateRace={updateRace} deleteRace={deleteRace}
        chatMessages={chatMessages}
        setChatMessages={setChatMessages}
        appendChatMessage={appendChatMessage}
        appendLocalChatMessage={appendLocalChatMessage}
        clearAllChatMessages={clearAllChatMessages}
        dailyNotes={dailyNotes} setDailyTags={setDailyTags}
        apiProvider={apiProvider} setApiProvider={setApiProvider}
        apiKey={apiKey} setApiKey={setApiKey}
        claudeApiKey={claudeApiKey} setClaudeApiKey={setClaudeApiKey}
        claudeEndpointId={claudeEndpointId} setClaudeEndpointId={setClaudeEndpointId}
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
  logs, refreshLogs, addLog, updateLog, bulkAddLogs, deleteLogs,
  races, addRace, updateRace, deleteRace,
  chatMessages, setChatMessages, appendChatMessage, appendLocalChatMessage, clearAllChatMessages,
  dailyNotes, setDailyTags,
  apiProvider, setApiProvider,
  apiKey, setApiKey,
  claudeApiKey, setClaudeApiKey,
  claudeEndpointId, setClaudeEndpointId,
  apiModel, setApiModel,
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

  // ── AI Coach in-flight state, lifted from AICoachTab so it SURVIVES tab
  //    switches. Previously the fetch and chatLoading both lived in
  //    AICoachTab → switching away mid-send unmounted the component, the
  //    "Coach is thinking…" indicator disappeared, and the user couldn't
  //    tell whether the request was still alive. Lifting these here keeps
  //    the request running (closure over AppShell-scope state) and lets
  //    the tab bar render a persistent spinner badge while the model works.
  //      chatLoading           — sendChat fetch in flight
  //      extractingForMsgId    — importToCalendar fetch in flight (per msg)
  //      planProposal          — opens the plan-import review modal once
  //                              extraction returns a non-empty array
  const [chatLoading, setChatLoading] = useState(false);
  const [extractingForMsgId, setExtractingForMsgId] = useState(null);
  const [planProposal, setPlanProposal] = useState(null);

  // ── Lifted sendChat — talks to DeepSeek's Anthropic-compat endpoint.
  //    Takes the user's typed message; reads everything else from props/
  //    state in this scope. Persists user + assistant turns via the
  //    appendChatMessage wrapper (which writes to Supabase + updates the
  //    chatMessages prop coming from AuthedApp). On API or network errors,
  //    emits a transient local-only bubble that won't pollute the DB.
  async function sendChat(userMsg) {
    if (!userMsg || chatLoading) return false;
    const provider = API_PROVIDERS[apiProvider] || API_PROVIDERS[DEFAULT_API_PROVIDER];
    const endpointUrl = apiProvider === "claude"
      ? getEndpointUrl("claude", claudeEndpointId)
      : provider.endpoints[0].url;
    const activeKey = apiProvider === "claude" ? claudeApiKey : apiKey;
    if (!activeKey) {
      appendLocalChatMessage("assistant", t("coach.no_key"));
      return false;
    }

    // Optimistic UI: drop the user's bubble into the chat IMMEDIATELY, before
    // any awaits, so the user sees their message land the moment they hit
    // send. The persisted row replaces this placeholder once the DB write
    // returns; on failure we surface an error bubble and bail.
    const optimisticId = `pending-${Date.now()}`;
    const messagesToSend = [...chatMessages, { role: "user", content: userMsg }];
    setChatMessages(prev => [...prev, { id: optimisticId, role: "user", content: userMsg, isLocal: true }]);
    setChatLoading(true);

    let freshLogs = logs;
    try {
      freshLogs = await refreshLogs();
    } catch (err) {
      console.warn("[AI Coach] refreshLogs failed, using cached state:", err);
    }

    const systemPrompt = buildSystemPrompt({
      profile, coachConfig, coachMemory,
      dataBlock: buildDataBlock({ logs: freshLogs, races, now, lang: "en" }),
      lang: "en",
    });

    try {
      const saved = await db.coachMessages.appendMessage("user", userMsg);
      // Swap the optimistic bubble for the persisted row (real id, no isLocal).
      setChatMessages(prev => prev.map(m => m.id === optimisticId ? saved : m));
    } catch (err) {
      // Drop the optimistic bubble and surface the failure so the user knows
      // the message wasn't saved.
      setChatMessages(prev => prev.filter(m => m.id !== optimisticId));
      window.alert("Failed to save message: " + err.message);
      setChatLoading(false);
      return false;
    }

    try {
      const resp = await fetch(endpointUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": activeKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: apiModel,
          max_tokens: 8000,
          system: systemPrompt,
          messages: messagesToSend,
        }),
      });
      // Detect "server returned HTML instead of JSON" up-front — that's the
      // classic symptom of a wrong endpoint URL (path 404'd, response is a
      // generic error page). Mapping it to a clearer error beats the JSON
      // parser blowing up with "Unexpected token '<'".
      const contentType = resp.headers.get("content-type") || "";
      if (!contentType.includes("json")) {
        const body = await resp.text().catch(() => "");
        const snippet = body.slice(0, 120).replace(/\s+/g, " ");
        appendLocalChatMessage("assistant", t("coach.endpoint_error", { status: resp.status, url: endpointUrl, snippet }));
        setChatLoading(false);
        return true;
      }
      const data = await resp.json();
      if (!resp.ok || data.error) {
        const msg = data.error?.message || `HTTP ${resp.status}`;
        console.error("[AI Coach] API error:", data);
        appendLocalChatMessage("assistant", t("coach.api_error", { msg }));
      } else {
        const reply = data.content?.filter(b => b.type === "text").map(b => b.text).join("") || t("coach.no_response");
        try {
          await appendChatMessage("assistant", reply);
        } catch { /* alerted by wrapper */ }
      }
    } catch (err) {
      console.error("[AI Coach] Network error:", err);
      appendLocalChatMessage("assistant", t("coach.network_error", { msg: err.message, url: endpointUrl }));
    }
    setChatLoading(false);
    return true;
  }

  // ── Lifted importToCalendar — second-pass LLM call: take an assistant
  //    reply and re-emit any concrete training suggestions as a structured
  //    JSON array, then open the review modal. Tagged by message id (not
  //    index, since indices shift across re-renders) so AICoachTab can
  //    show per-message extraction state.
  async function importToCalendar(assistantContent, msgId) {
    const provider = API_PROVIDERS[apiProvider] || API_PROVIDERS[DEFAULT_API_PROVIDER];
    const endpointUrl = apiProvider === "claude"
      ? getEndpointUrl("claude", claudeEndpointId)
      : provider.endpoints[0].url;
    const activeKey = apiProvider === "claude" ? claudeApiKey : apiKey;
    if (!activeKey) {
      alert(t("coach.no_key"));
      return;
    }
    setExtractingForMsgId(msgId);
    const todayStr = now.toISOString().slice(0, 10);
    const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });
    const typeUnion = ACTIVITY_TYPES.map(at => `"${at}"`).join(" | ");
    const extractPrompt = `You are a structured-data extractor. The user's AI running coach just produced the reply below. Extract any concrete training suggestions into a JSON array.

Today is ${todayStr} (${dayOfWeek}, GMT+8).

Coach's reply:
---
${assistantContent}
---

Output a JSON array. Each item:
{
  "date": "YYYY-MM-DD",
  "type": ${typeUnion},
  "distance": number (kilometres, optional — omit if not specified),
  "duration": number (MINUTES, optional — omit if not specified),
  "subTypes": ["Easy Run" | "Aerobic Run" | "Tempo Run" | "Interval Run" | "Race" | "Upper Body" | "Lower Body" | "Core"] (optional, only when relevant),
  "notes": string (brief — optional)
}

Rules:
- Only extract suggestions that have a clear day (explicit date OR a weekday like "Wednesday" / "周三" / "tomorrow"). Resolve weekdays to the next upcoming occurrence from today.
- Skip vague advice ("rest more", "stay hydrated"), past references, and analysis-only text.
- If the coach explicitly suggests a rest / recovery day with no activity, set type to "Recovery".
- If you cannot find any concrete plan, output [].
- Output the JSON array ONLY. No prose, no markdown fences, no comments.`;

    try {
      const resp = await fetch(endpointUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": activeKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: apiModel,
          max_tokens: 8000,
          messages: [{ role: "user", content: extractPrompt }],
        }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        alert(t("coach.api_error", { msg: data.error?.message || `HTTP ${resp.status}` }));
        return;
      }
      const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("") || "";
      const plans = parsePlansFromLLM(text);
      if (plans.length === 0) {
        alert(t("coach.import_no_plans"));
        return;
      }
      setPlanProposal({ plans });
    } catch (err) {
      console.error("[AI Coach] Plan-extract error:", err);
      alert(t("coach.network_error", { msg: err.message, url: endpointUrl }));
    } finally {
      setExtractingForMsgId(null);
    }
  }

  async function confirmImportPlans(workouts) {
    try {
      await bulkAddLogs(workouts, { source: "ai_coach_plan" });
      setPlanProposal(null);
      alert(t("coach.import_success", { n: workouts.length }));
    } catch {
      // bulkAddLogs already alerted; keep modal open for retry
    }
  }

  // True when ANY long-running AI Coach operation is in flight. Used to
  // render the spinner badge on the AI Coach tab label so the user knows
  // the model is still working even when they've switched to another tab.
  const coachBusy = chatLoading || !!extractingForMsgId;

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
          races={races}
          profile={profile}
          coachConfig={coachConfig}
          setCoachConfig={setCoachConfig}
          coachMemory={coachMemory}
          setCoachMemory={setCoachMemory}
          chatMessages={chatMessages}
          appendLocalChatMessage={appendLocalChatMessage}
          now={now}
          setConfirmDelete={setConfirmDelete}
          apiProvider={apiProvider}
          apiKey={apiKey}
          claudeApiKey={claudeApiKey}
          claudeEndpointId={claudeEndpointId}
          apiModel={apiModel}
          onEditProfile={() => setProfileEditorMode("edit")}
          /* Lifted state + handlers — see AppShell top for definitions. */
          chatLoading={chatLoading}
          extractingForMsgId={extractingForMsgId}
          sendChat={sendChat}
          importToCalendar={importToCalendar}
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
          apiProvider={apiProvider}
          setApiProvider={setApiProvider}
          apiKey={apiKey}
          setApiKey={setApiKey}
          claudeApiKey={claudeApiKey}
          setClaudeApiKey={setClaudeApiKey}
          claudeEndpointId={claudeEndpointId}
          setClaudeEndpointId={setClaudeEndpointId}
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

      {/* Plan-import review modal — rendered at AppShell level (not inside
          AICoachTab) so the user sees it pop up even if they walked away
          from the AI Coach tab while the extraction was running. */}
      {planProposal && (
        <CoachPlanImportModal
          plans={planProposal.plans}
          onConfirm={confirmImportPlans}
          onCancel={() => setPlanProposal(null)}
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
        <MobileShell tab={tab} setTab={setTab} coachBusy={coachBusy}>
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
          const showSpinner = i === 3 && coachBusy;
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
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}>
              {t(key)}
              {showSpinner && <Spinner size={12} thickness={1.5} color="var(--moss)" />}
            </button>
          );
        })}
      </div>

      {tabContent}
      {modals}
    </div>
  );
}
