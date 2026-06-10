import { useState, useEffect, useRef, useCallback } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { popBackHandler, hasBackHandler } from "./lib/backStack";
import {
  TABS, DEFAULT_PROFILE, DEFAULT_COACH_CONFIG, DEFAULT_LANG,
  API_PROVIDERS, DEFAULT_API_PROVIDER, getEndpointUrl, ACTIVITY_TYPES, ADMIN_EMAIL,
  FREE_DEEPSEEK_LIMIT, FREE_WEATHER_LIMIT,
} from "./constants";
import { isProfileComplete, buildSystemPrompt } from "./utils/profile";
import { buildDataBlock, parsePlansFromLLM } from "./utils/coachPrompt";
import { formatDuration, formatPaceFromSec } from "./utils/format";
import { LanguageProvider, useT } from "./i18n/LanguageContext";
import { INITIAL_FILTER } from "./components/GlobalFilter";
import { TrainingTab } from "./components/TrainingTab";
import { RacesTab } from "./components/RacesTab";
import { AICoachTab } from "./components/AICoachTab";
import { parseBilingualMemory } from "./utils/memory";
import { reportError } from "./lib/errorOverlay";
import { pickGreeting, timeGreeting } from "./data/greetings";
import { CalendarTab } from "./components/CalendarTab";
import { ConfirmDeleteModal } from "./components/ConfirmDeleteModal";
import { ProfileEditor, ProfilePreview } from "./components/ProfileEditor";
import { ApiSettingsModal } from "./components/ApiSettingsModal";
import { WeatherApiSettingsModal } from "./components/WeatherApiSettingsModal";
import { PushSettingsModal } from "./components/PushSettingsModal";
import { InboxModal } from "./components/InboxModal";
import { ChangePasswordModal } from "./components/ChangePasswordModal";
import { DeleteAccountModal } from "./components/DeleteAccountModal";
import { InviteCodeModal } from "./components/InviteCodeModal";
import { PromptCatalogModal } from "./components/PromptCatalogModal";
import { OnboardingTour, TOUR_FLAG } from "./components/OnboardingTour";
import { CoachPlanImportModal } from "./components/CoachPlanImportModal";
import { ReadinessPromptModal } from "./components/ReadinessPromptModal";
import { GuideModal } from "./components/GuideModal";
import { Spinner } from "./components/Spinner";
import { UserBadge } from "./components/Auth/UserBadge";
import { LoginScreen } from "./components/Auth/LoginScreen";
import { PasswordRecoveryModal } from "./components/Auth/PasswordRecoveryModal";
import { MobileShell } from "./components/MobileShell";
import { SettingsMobileTab } from "./components/SettingsMobileTab";
import {
  BookIcon, CalendarIcon, CloudIcon, CoachIcon, FootIcon, GlobeIcon, KeyIcon, SettingsIcon, TrophyIcon,
} from "./components/Icons";
import { useAuth } from "./hooks/useAuth";
import { useIsMobile, useIsNarrow } from "./hooks/useMediaQuery";
import * as db from "./lib/db";
import { getCurrentLocation, captureSnapshotForWorkout, weatherWindowEligible, useWeatherContext, fetchRaceDayWeather } from "./lib/weather";
import { postJson, postJsonStream } from "./lib/apiFetch";
import { initPushNotifications } from "./lib/push";
import productLogoUrl from "../resources/Original.png";

// One random sport line per launch, stable across the auth→data loading remounts.
const BOOT_GREETING = pickGreeting();

function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function readinessComplete(readiness) {
  return !!(readiness?.sleep && readiness?.legs && readiness?.energy);
}

function describeWorkoutForCoach(w, idx) {
  const subTypes = (w.subTypes || []).filter(Boolean).join(", ");
  const metrics = [
    w.distance ? `${w.distance} km` : null,
    w.duration ? formatDuration(w.duration) : null,
    w.pace ? `${formatPaceFromSec(w.pace)} /km` : null,
    w.ascent ? `+${w.ascent} m` : null,
    w.hr ? `avg HR ${w.hr}` : null,
    w.maxHR ? `max HR ${w.maxHR}` : null,
    w.rpe ? `RPE ${w.rpe}` : null,
    w.note ? `note: ${w.note}` : null,
  ].filter(Boolean).join(" · ");
  return `${idx + 1}. ${w.date || "No date"} · ${w.type || "Activity"}${subTypes ? ` (${subTypes})` : ""}${metrics ? ` · ${metrics}` : ""}`;
}

function buildWorkoutReviewDraft(workouts, meta = {}) {
  const rows = workouts.map(describeWorkoutForCoach).join("\n");
  const countLine = meta.count && meta.count > workouts.length
    ? `这是批量导入 ${meta.count} 条活动中的最近 ${workouts.length} 条。`
    : "这是刚新增的活动。";
  return `请点评下面的训练。${countLine}

请按这个结构回答：
1. 训练目的和强度判断
2. 恢复风险或需要注意的地方
3. 下一次训练建议

不要重写完整训练计划，重点点评这次活动。

[New Activities]
${rows}`;
}

// Boot screen — deliberately mirrors the native Android splash (logo +
// "Training Studio" on the cream background) so on the APK the native splash →
// web-view handoff is visually seamless: the user sees ONE logo screen, then
// the app. Now also a warm time-of-day greeting + a random sport line.
// Logo + text use vmin units so they track the stretched native splash size.
function LoadingScreen({ userId = null }) {
  // Read directly from localStorage — this renders before LanguageProvider /
  // profile are available (during auth + first data load). Name is cached when
  // the profile loads. Cache is per auth user so switching accounts cannot leak
  // the previous account's name into the boot greeting.
  let lang = "en", name = "";
  try {
    const l = localStorage.getItem("ts-lang");
    if (l === "zh" || l === "en") lang = l;
    name = userId ? (localStorage.getItem(`ts-display-name:${userId}`) || "") : "";
  } catch { /* private mode */ }
  const hello = timeGreeting(lang) + (name ? `，${name}` : "");
  const line = BOOT_GREETING[lang === "zh" ? "zh" : "en"];

  return (
    <div style={{
      position: "fixed", inset: 0,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: "5vmin", background: "var(--bg)", padding: "0 24px",
    }}>
      {/* Pre-rounded, transparent-corner logo (favicon center-cropped to drop
          the dark frame) — identical asset to the native splash so the
          native-splash → web-view handoff shows the same logo. */}
      <img
        src={productLogoUrl}
        alt="Training Studio"
        style={{
          width: "min(30vmin, 150px)",
          height: "min(30vmin, 150px)",
          objectFit: "contain",
        }}
      />
      <div style={{
        fontFamily: "var(--font-sans)",
        fontSize: "min(5.2vmin, 24px)",
        fontWeight: 500,
        color: "var(--ink-1)",
        letterSpacing: "0.02em",
      }}>
        {hello}
      </div>
      <div style={{
        fontFamily: "var(--font-sans)",
        fontSize: "min(3.6vmin, 15px)",
        color: "var(--ink-3)",
        textAlign: "center",
        maxWidth: 360,
        lineHeight: 1.5,
        marginTop: "-2vmin",
      }}>
        {line}
      </div>
    </div>
  );
}

export default function App() {
  const {
    user,
    loading,
    recoveryMode,
    signIn,
    signOut,
    changePassword,
    register,
    deleteAccount,
    sendPasswordReset,
    completePasswordRecovery,
    clearRecoveryMode,
  } = useAuth();

  // Watchdog: if auth init never resolves the loading state, surface it on the
  // error overlay so a stuck-on-splash boot is diagnosable on the device.
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => reportError("Boot watchdog: auth still loading after 25s (stuck on splash). Likely auth/session init hang."), 25000);
    return () => clearTimeout(t);
  }, [loading]);

  if (loading) return <LoadingScreen userId={user?.id} />;
  if (recoveryMode) {
    return (
      <PasswordRecoveryModal
        completePasswordRecovery={completePasswordRecovery}
        onClose={clearRecoveryMode}
      />
    );
  }
  if (!user) {
    return (
      <LoginScreen
        onClose={() => {}}
        signIn={signIn}
        register={register}
        sendPasswordReset={sendPasswordReset}
      />
    );
  }
  return <AuthedApp user={user} signOut={signOut} changePassword={changePassword} deleteAccount={deleteAccount} />;
}

function AuthedApp({ user, signOut, changePassword, deleteAccount }) {
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
  const [coachMemoryZh, setCoachMemoryZhState] = useState("");
  const [lang, setLangState] = useState(DEFAULT_LANG);
  // Default location for weather fetch — used when navigator.geolocation /
  // Capacitor Geolocation are unavailable or denied. lng/lat are WGS84 numbers
  // (or null when unset), name is a free-text label the user types in.
  const [defaultLocation, setDefaultLocationState] = useState({ lng: null, lat: null, name: "" });
  // Optional Caiyun Weather token — empty falls back to the shared server
  // token. Persisted to user_settings.caiyun_api_key so it follows the
  // user across devices (whereas the AI provider's claudeEndpointId stays
  // local because the right mirror is per-network not per-user).
  const [caiyunApiKey, setCaiyunApiKeyState] = useState("");
  const [pushEnabled, setPushEnabledState] = useState(false);
  const [pushHours, setPushHoursState] = useState([]);
  const [pushTimes, setPushTimesState] = useState([]);
  const [pushTimezone, setPushTimezoneState] = useState("");
  // Free-tier usage counters (served from the owner's shared keys via the
  // coach-proxy / weather-proxy Edge Functions). Read-only here; the proxies are
  // the source of truth and return `remaining` which we mirror into these.
  const [deepseekUsed, setDeepseekUsed] = useState(0);
  const [weatherUsed, setWeatherUsed] = useState(0);
  const [dataLoading, setDataLoading] = useState(true);

  // Pull-to-refresh in flight (Training tab). Separate from dataLoading so a
  // refresh shows a small top spinner instead of the full LoadingScreen.
  const [refreshing, setRefreshing] = useState(false);

  // Fetch + apply all user data. Reused by the boot effect AND pull-to-refresh.
  // Throws on error so each caller can handle it (boot alerts; refresh is quiet).
  const loadData = useCallback(async () => {
        const [profileData, settingsData, workoutsData, racesData, messagesData, notesData, usageData] = await Promise.all([
          db.profiles.getMyProfile(),
          db.userSettings.getMySettings(),
          db.workouts.listMyWorkouts(),
          db.races.listMyRaces(),
          db.coachMessages.listMyMessages(),
          db.dailyNotes.listMyDailyNotes(),
          db.usage.getMyUsage(),
        ]);

        // Profile — null means no row yet (handle_new_user trigger should
        // prevent this, but defend against it). DEFAULT_PROFILE keeps shape
        // consistent so AppShell can read profile.displayName safely; the
        // setup wizard still fires because isProfileComplete() checks values.
        const mergedProfile = { ...DEFAULT_PROFILE, ...(profileData || {}) };
        setProfileState(mergedProfile);
        setItraPIState(mergedProfile.itraPI ?? "");
        // Cache the name so the next launch's splash greeting can show it before
        // the profile finishes loading.
        try {
          localStorage.setItem(`ts-display-name:${user.id}`, mergedProfile.displayName || "");
          localStorage.removeItem("ts-display-name");
        } catch { /* private mode */ }

        // Settings — same defensive merge.
        if (settingsData) {
          const provider = (settingsData.apiProvider && API_PROVIDERS[settingsData.apiProvider])
            ? settingsData.apiProvider
            : DEFAULT_API_PROVIDER;
          setApiProviderState(provider);
          setApiKeyState(settingsData.apiKey ?? "");
          setClaudeApiKeyState(settingsData.claudeApiKey ?? "");
          // Model is now LOCKED to each provider's flagship (defaultModel).
          // Ignore any stale apiModel in the DB row — when we bump the
          // flagship in constants, everyone picks it up on next load without
          // a per-user migration.
          setApiModelState(API_PROVIDERS[provider].defaultModel);
          setCoachConfigState({
            ...DEFAULT_COACH_CONFIG,
            ...(settingsData.coachConfig || {}),
          });
          setCoachMemoryState(settingsData.coachMemory ?? "");
          setCoachMemoryZhState(settingsData.coachMemoryZh ?? "");
          setDefaultLocationState({
            lng: Number.isFinite(settingsData.defaultLng) ? settingsData.defaultLng : null,
            lat: Number.isFinite(settingsData.defaultLat) ? settingsData.defaultLat : null,
            name: settingsData.defaultLocationName || "",
          });
          setCaiyunApiKeyState(settingsData.caiyunApiKey || "");
          setPushEnabledState(settingsData.pushEnabled === true);
          setPushHoursState(Array.isArray(settingsData.pushHours) ? settingsData.pushHours : []);
          setPushTimesState(Array.isArray(settingsData.pushTimes) ? settingsData.pushTimes : []);
          setPushTimezoneState(settingsData.pushTimezone || "");
        }

        // Language: a saved setting wins; otherwise fall back to the choice the
        // user made on the login screen (stored in localStorage). For a brand-new
        // user with no saved lang, seed it into settings so it persists server-
        // side and the onboarding tour opens in their chosen language.
        let preLang = null;
        try {
          const v = localStorage.getItem("ts-lang");
          if (v === "zh" || v === "en") preLang = v;
        } catch { /* private mode */ }
        const savedLang = settingsData?.lang;
        setLangState(savedLang || preLang || DEFAULT_LANG);
        if (!savedLang && preLang) {
          db.userSettings.updateMySettings({ lang: preLang }).catch(() => {});
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

        // Free-tier usage counters.
        setDeepseekUsed(usageData?.deepseekUsed ?? 0);
        setWeatherUsed(usageData?.weatherUsed ?? 0);
  }, [user.id]);

  // Initial load on mount / user change. Owns the full-screen LoadingScreen +
  // the stuck-boot watchdog.
  useEffect(() => {
    let cancelled = false;
    const watchdog = setTimeout(() => {
      if (!cancelled) reportError("Boot watchdog: data load still pending after 25s (stuck on splash). Likely one of profiles/settings/workouts/races/messages/notes/usage never resolved.");
    }, 25000);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDataLoading(true);
    loadData()
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load user data:", err);
        reportError(`Data load failed: ${err?.message || String(err)}\n${err?.stack || ""}`);
        window.alert("Failed to load your data, please refresh.");
      })
      .finally(() => { clearTimeout(watchdog); if (!cancelled) setDataLoading(false); });
    return () => { cancelled = true; clearTimeout(watchdog); };
  }, [loadData]);

  // Pull-to-refresh handler — re-fetch everything, no full-screen takeover.
  // Hold the spinner for at least 600ms (loadData is fast now) so the refresh
  // is actually visible instead of flashing by.
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await Promise.all([loadData(), new Promise(r => setTimeout(r, 600))]); }
    catch (err) { reportError(`Refresh failed: ${err?.message || String(err)}`); }
    finally { setRefreshing(false); }
  }, [loadData]);

  // Register this device for push (Android APK only; no-op on web). Fires once
  // the user is known so the FCM token is stored against their account. Guarded
  // internally so re-mounts don't stack listeners.
  useEffect(() => {
    if (!user?.id) return;
    void initPushNotifications();
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
    if ("coachMemoryZh" in patch) setCoachMemoryZhState(patch.coachMemoryZh);
    if ("lang" in patch) setLangState(patch.lang);
    if ("caiyunApiKey" in patch) setCaiyunApiKeyState(patch.caiyunApiKey || "");
    if ("pushEnabled" in patch) setPushEnabledState(patch.pushEnabled === true);
    if ("pushHours" in patch) setPushHoursState(Array.isArray(patch.pushHours) ? patch.pushHours : []);
    if ("pushTimes" in patch) setPushTimesState(Array.isArray(patch.pushTimes) ? patch.pushTimes : []);
    if ("pushTimezone" in patch) setPushTimezoneState(patch.pushTimezone || "");
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
  const setCoachMemoryZh = (v) => updateSettings({ coachMemoryZh: v });
  // Save both language versions in one write (used when accepting a bilingual
  // memory proposal so EN + 中 stay in sync).
  const setCoachMemoryBoth = (en, zh) => updateSettings({ coachMemory: en, coachMemoryZh: zh });
  const setLang = (v) => updateSettings({ lang: v });
  const setCaiyunApiKey = (v) => updateSettings({ caiyunApiKey: v });
  const setPushSettings = (patch) => updateSettings(patch);
  // Patch the local state immediately AND persist to Supabase. updateSettings()
  // doesn't refresh local state, so we do it eagerly here so the Settings page
  // and any new addLog calls see the latest values without waiting for a
  // refetch.
  async function setDefaultLocation(patch) {
    const next = { ...defaultLocation, ...patch };
    setDefaultLocationState(next);
    await updateSettings({
      defaultLng: next.lng,
      defaultLat: next.lat,
      defaultLocationName: next.name,
    });
  }

  // Best-effort weather capture before writing. Never blocks the save —
  // location denied / network down / Caiyun quota exhausted all silently
  // skip the snapshot, and the workout still gets created without weather.
  // Skipped entirely for Garmin CSV imports (source !== 'manual') because
  // those rows were recorded long ago at unknown locations; the calendar
  // entry from "import to calendar" likewise skips because it's a plan, not
  // a logged session — the calendar tab pulls forecast weather on demand.
  async function captureWeatherForNewWorkout(workoutData) {
    try {
      const loc = await getCurrentLocation({
        defaultLng: defaultLocation.lng,
        defaultLat: defaultLocation.lat,
      });
      const snap = await captureSnapshotForWorkout({
        date: workoutData.date,
        startedAt: workoutData.startedAt,
        durationSec: workoutData.duration || 0,
        lng: loc.lng,
        lat: loc.lat,
        caiyunToken: caiyunApiKey,
      });
      return snap;
    } catch (err) {
      console.warn('[weather] snapshot skipped:', err.message);
      return null;
    }
  }

  // ── Workout mutations — OPTIMISTIC.
  //
  // The classic "await DB → setState → resolve" flow makes save / delete
  // feel laggy because the user's click can't close the form / modal until
  // a network roundtrip lands. With weather snapshotting layered on top
  // that was 1–3 seconds of dead-screen on every manual save.
  //
  // We now resolve the user-facing promise IMMEDIATELY after patching
  // local state. The DB write (and any side work like weather capture)
  // runs in a background task; success quietly swaps the optimistic row
  // for the canonical one, failure rolls back and surfaces an alert.
  //
  // Trade-offs:
  //  - Callers can't rely on the returned `id` being final — they get a
  //    `temp-…` placeholder. None of our current call sites need the real
  //    id, but new code should pull from the latest `logs` array.
  //  - If the user edits an optimistic row before the background insert
  //    finishes, that update will fail (no real id yet). We surface the
  //    alert and revert; users can retry once the row settles.
  function makeTempId(prefix = "temp") {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function addLog(workoutData, { source = "manual" } = {}) {
    const tempId = makeTempId();
    const optimistic = {
      id: tempId,
      // Match the shape the DAL returns so downstream renderers don't
      // blow up trying to read e.g. .subTypes on undefined.
      ...workoutData,
      subTypes: workoutData.subTypes || [],
      weather: workoutData.weather || null,
      isPlanned: !!workoutData.isPlanned,
      createdAt: new Date().toISOString(),
      isOptimistic: true,
    };
    setLogs(prev => [optimistic, ...prev]);

    // Background: weather snapshot (slowest piece) then DB insert. Both
    // fire-and-forget; the user already saw their row.
    (async () => {
      try {
        let payload = workoutData;
        // fetchWeather is the user's per-entry choice (default on for outdoor,
        // off for indoor). Undefined (older callers) → treat as on for back-compat.
        // Only fetch when (a) the user left the toggle on and (b) Caiyun has
        // data for this moment (now / past 24h / future). A >24h-old session
        // would otherwise get current weather wrongly stamped on it.
        const wantWeather = workoutData.fetchWeather !== false && weatherWindowEligible(workoutData);
        if (source === "manual" && wantWeather && !workoutData.weather && !workoutData.isPlanned) {
          const weather = await captureWeatherForNewWorkout(workoutData);
          if (weather) payload = { ...workoutData, weather };
        }
        const created = await db.workouts.createWorkout(payload, { source });
        setLogs(prev => prev.map(l => l.id === tempId ? created : l));
      } catch (err) {
        console.error("[addLog] background save failed:", err);
        setLogs(prev => prev.filter(l => l.id !== tempId));
        window.alert("Failed to add workout: " + err.message);
      }
    })();

    return Promise.resolve(optimistic);
  }

  function updateLog(id, patch) {
    // Snapshot the row inside the setter so we get the most recent state,
    // not a stale closure read.
    let snapshot = null;
    setLogs(prev => {
      snapshot = prev.find(l => l.id === id) || null;
      return prev.map(l => l.id === id ? { ...l, ...patch } : l);
    });

    (async () => {
      try {
        const updated = await db.workouts.updateWorkout(id, patch);
        setLogs(prev => prev.map(l => l.id === id ? updated : l));
      } catch (err) {
        console.error("[updateLog] background save failed:", err);
        if (snapshot) setLogs(prev => prev.map(l => l.id === id ? snapshot : l));
        window.alert("Failed to update workout: " + err.message);
      }
    })();

    return Promise.resolve();
  }

  function bulkAddLogs(workouts, { source = "garmin_csv", fetchWeather = false, replacePlannedDates = false } = {}) {
    const optimistics = workouts.map(w => ({
      id: makeTempId("bulk"),
      ...w,
      subTypes: w.subTypes || [],
      weather: w.weather || null,
      isPlanned: !!w.isPlanned,
      createdAt: new Date().toISOString(),
      isOptimistic: true,
    }));
    // When replacing (coach plan import), the imported plan supersedes any
    // existing PLANNED rows on those same dates — drop them optimistically so
    // the calendar doesn't briefly show two plans (old 5km + new 8km).
    const planDates = replacePlannedDates ? [...new Set(workouts.map(w => w.date).filter(Boolean))] : [];
    setLogs(prev => [
      ...optimistics,
      ...(replacePlannedDates ? prev.filter(l => !(l.isPlanned && planDates.includes(l.date))) : prev),
    ]);

    (async () => {
      try {
        if (replacePlannedDates) await db.workouts.deletePlannedOnDates(planDates);
        let toInsert = workouts;
        // FIT import can request weather for rows that fall inside Caiyun's
        // window (now / past 24h). Use the FIT's own GPS start point for the
        // location (more accurate than current GPS — you may upload from home a
        // run done elsewhere); fall back to the saved default location when a
        // row has no GPS (e.g. pool swim). Rows older than 24h are skipped by
        // weatherWindowEligible, so a bulk historical import does no fetching.
        if (fetchWeather) {
          toInsert = await Promise.all(workouts.map(async (w) => {
            if (w.weather || !weatherWindowEligible(w)) return w;
            const start = Array.isArray(w.gpsTrack) && w.gpsTrack.length ? w.gpsTrack[0] : null;
            const lng = start ? start[1] : defaultLocation.lng;
            const lat = start ? start[0] : defaultLocation.lat;
            try {
              const weather = await captureSnapshotForWorkout({
                date: w.date, startedAt: w.startedAt, durationSec: w.duration || 0,
                lng, lat, caiyunToken: caiyunApiKey,
              });
              return weather ? { ...w, weather } : w;
            } catch (err) {
              console.warn("[bulkAddLogs] weather skipped:", err.message);
              return w;
            }
          }));
        }
        const created = await db.workouts.bulkInsertWorkouts(toInsert, { source });
        const tempIds = new Set(optimistics.map(o => o.id));
        // Replace all temp rows with the persisted ones in one pass.
        setLogs(prev => [...created, ...prev.filter(l => !tempIds.has(l.id))]);
      } catch (err) {
        console.error("[bulkAddLogs] background save failed:", err);
        const tempIds = new Set(optimistics.map(o => o.id));
        setLogs(prev => prev.filter(l => !tempIds.has(l.id)));
        // A replace import may have already deleted the old plan rows before
        // failing — resync from server truth so the calendar isn't left wrong.
        if (replacePlannedDates) refreshLogs().catch(() => {});
        window.alert(err.message);
      }
    })();

    return Promise.resolve(optimistics);
  }

  function deleteLogs(ids) {
    const idArr = Array.isArray(ids) ? ids : [ids];
    const idSet = new Set(idArr);
    let removed = [];
    setLogs(prev => {
      removed = prev.filter(l => idSet.has(l.id));
      return prev.filter(l => !idSet.has(l.id));
    });
    // Skip the DB call for optimistic rows that were never persisted
    // (user added then immediately deleted). For mixed batches we still
    // call delete with the real ids only.
    const realIds = idArr.filter(id => !String(id).startsWith("temp-") && !String(id).startsWith("bulk-"));

    (async () => {
      if (realIds.length === 0) return;
      try {
        await db.workouts.deleteWorkouts(realIds);
      } catch (err) {
        console.error("[deleteLogs] background delete failed:", err);
        setLogs(prev => [...removed, ...prev]);
        window.alert("Failed to delete workout: " + err.message);
      }
    })();

    return Promise.resolve();
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

  // ── Race mutations — also OPTIMISTIC, same pattern as workouts above.
  function addRace(raceData) {
    const tempId = makeTempId("race");
    const optimistic = {
      id: tempId,
      ...raceData,
      createdAt: new Date().toISOString(),
      isOptimistic: true,
    };
    setRaces(prev => [optimistic, ...prev]);

    (async () => {
      try {
        const created = await db.races.createRace(raceData);
        setRaces(prev => prev.map(r => r.id === tempId ? created : r));
      } catch (err) {
        console.error("[addRace] background save failed:", err);
        setRaces(prev => prev.filter(r => r.id !== tempId));
        window.alert("Failed to add race: " + err.message);
      }
    })();

    return Promise.resolve(optimistic);
  }

  function updateRace(id, patch) {
    let snapshot = null;
    setRaces(prev => {
      snapshot = prev.find(r => r.id === id) || null;
      return prev.map(r => r.id === id ? { ...r, ...patch } : r);
    });

    (async () => {
      try {
        const updated = await db.races.updateRace(id, patch);
        setRaces(prev => prev.map(r => r.id === id ? updated : r));
      } catch (err) {
        console.error("[updateRace] background save failed:", err);
        if (snapshot) setRaces(prev => prev.map(r => r.id === id ? snapshot : r));
        window.alert("Failed to update race: " + err.message);
      }
    })();

    return Promise.resolve();
  }

  function deleteRace(id) {
    let removed = null;
    setRaces(prev => {
      removed = prev.find(r => r.id === id) || null;
      return prev.filter(r => r.id !== id);
    });
    const idStr = String(id);
    if (idStr.startsWith("race-") || idStr.startsWith("temp-")) {
      // Optimistic row was never written; nothing to do.
      return Promise.resolve();
    }
    (async () => {
      try {
        await db.races.deleteRace(id);
      } catch (err) {
        console.error("[deleteRace] background delete failed:", err);
        if (removed) setRaces(prev => [removed, ...prev]);
        window.alert("Failed to delete race: " + err.message);
      }
    })();

    return Promise.resolve();
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

  function clearAllChatMessages() {
    // Optimistic clear so the user sees the panel empty instantly.
    let snapshot = [];
    setChatMessages(prev => { snapshot = prev; return []; });
    (async () => {
      try {
        await db.coachMessages.clearAllMessages();
      } catch (err) {
        console.error("[clearAllChatMessages] background failed:", err);
        setChatMessages(snapshot);
        window.alert("Failed to clear messages: " + err.message);
      }
    })();
    return Promise.resolve();
  }

  // ── Daily notes — upsert by date, [] clears the row server-side.
  // Optimistic: patch local state from `tags` (we don't have a server row
  // yet, but the shape is straightforward) and replace with the canonical
  // row on success / roll back on failure.
  function setDailyTags(date, tags) {
    let snapshot = null;
    setDailyNotes(prev => {
      snapshot = prev.find(n => n.date === date) || null;
      const without = prev.filter(n => n.date !== date);
      if (!tags || tags.length === 0) return without;
      const optimistic = {
        ...(snapshot || {}),
        date,
        tags,
        travelDest: "",
        // Mark so renderers can render a subtle "saving…" hint if they want.
        isOptimistic: true,
      };
      return [optimistic, ...without];
    });

    (async () => {
      try {
        const updated = await db.dailyNotes.setDailyTags(date, tags, "");
        setDailyNotes(prev => {
          const without = prev.filter(n => n.date !== date);
          return updated ? [updated, ...without] : without;
        });
      } catch (err) {
        console.error("[setDailyTags] background save failed:", err);
        setDailyNotes(prev => {
          const without = prev.filter(n => n.date !== date);
          return snapshot ? [snapshot, ...without] : without;
        });
        window.alert("Failed to update daily tags: " + err.message);
      }
    })();

    return Promise.resolve();
  }

  // Morning readiness check-in — same optimistic pattern as setDailyTags but
  // writes the readiness columns on the (user, date) daily_notes row. Tags on
  // the same row are preserved (the DAL upserts only the readiness columns).
  function setReadiness(date, vals) {
    let snapshot = null;
    setDailyNotes(prev => {
      snapshot = prev.find(n => n.date === date) || null;
      const without = prev.filter(n => n.date !== date);
      const optimistic = {
        ...(snapshot || { date, tags: [] }),
        date,
        readiness: { sleep: vals.sleep ?? null, legs: vals.legs ?? null, energy: vals.energy ?? null },
        isOptimistic: true,
      };
      return [optimistic, ...without];
    });
    (async () => {
      try {
        const updated = await db.dailyNotes.setReadiness(date, vals);
        setDailyNotes(prev => {
          const without = prev.filter(n => n.date !== date);
          return updated ? [updated, ...without] : without;
        });
      } catch (err) {
        console.error("[setReadiness] background save failed:", err);
        setDailyNotes(prev => {
          const without = prev.filter(n => n.date !== date);
          return snapshot ? [snapshot, ...without] : without;
        });
        window.alert("Failed to save readiness: " + err.message);
      }
    })();
    return Promise.resolve();
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

  if (dataLoading) return <LoadingScreen userId={user?.id} />;

  return (
    <LanguageProvider lang={lang} setLang={setLang}>
      <AppShell
        user={user} signOut={signOut} changePassword={changePassword} deleteAccount={deleteAccount}
        logs={logs} refreshLogs={refreshLogs} refresh={refresh} refreshing={refreshing}
        addLog={addLog} updateLog={updateLog} bulkAddLogs={bulkAddLogs} deleteLogs={deleteLogs}
        races={races}
        addRace={addRace} updateRace={updateRace} deleteRace={deleteRace}
        chatMessages={chatMessages}
        setChatMessages={setChatMessages}
        appendChatMessage={appendChatMessage}
        appendLocalChatMessage={appendLocalChatMessage}
        clearAllChatMessages={clearAllChatMessages}
        dailyNotes={dailyNotes} setDailyTags={setDailyTags} setReadiness={setReadiness}
        apiProvider={apiProvider} setApiProvider={setApiProvider}
        apiKey={apiKey} setApiKey={setApiKey}
        claudeApiKey={claudeApiKey} setClaudeApiKey={setClaudeApiKey}
        claudeEndpointId={claudeEndpointId} setClaudeEndpointId={setClaudeEndpointId}
        apiModel={apiModel} setApiModel={setApiModel}
        itraPI={itraPI} setItraPI={setItraPI}
        profile={profile} setProfile={setProfile}
        coachConfig={coachConfig} setCoachConfig={setCoachConfig}
        coachMemory={coachMemory} setCoachMemory={setCoachMemory}
        coachMemoryZh={coachMemoryZh} setCoachMemoryZh={setCoachMemoryZh} setCoachMemoryBoth={setCoachMemoryBoth}
        lang={lang} setLang={setLang}
        defaultLocation={defaultLocation} setDefaultLocation={setDefaultLocation}
        caiyunApiKey={caiyunApiKey} setCaiyunApiKey={setCaiyunApiKey}
        pushEnabled={pushEnabled} pushHours={pushHours} pushTimes={pushTimes} pushTimezone={pushTimezone} setPushSettings={setPushSettings}
        deepseekUsed={deepseekUsed} setDeepseekUsed={setDeepseekUsed}
        weatherUsed={weatherUsed} setWeatherUsed={setWeatherUsed}
      />
    </LanguageProvider>
  );
}

function AppShell({
  user, signOut, changePassword, deleteAccount,
  logs, refreshLogs, refresh, refreshing, addLog, updateLog, bulkAddLogs, deleteLogs,
  races, addRace, updateRace, deleteRace,
  chatMessages, setChatMessages, appendChatMessage, appendLocalChatMessage, clearAllChatMessages,
  dailyNotes, setDailyTags, setReadiness,
  apiProvider, setApiProvider,
  apiKey, setApiKey,
  claudeApiKey, setClaudeApiKey,
  claudeEndpointId, setClaudeEndpointId,
  apiModel, setApiModel,
  itraPI, setItraPI, profile, setProfile, coachConfig, setCoachConfig,
  coachMemory, setCoachMemory,
  coachMemoryZh, setCoachMemoryZh, setCoachMemoryBoth,
  lang, setLang,
  defaultLocation, setDefaultLocation,
  caiyunApiKey, setCaiyunApiKey,
  pushEnabled, pushHours, pushTimes, pushTimezone, setPushSettings,
  deepseekUsed, setDeepseekUsed, weatherUsed, setWeatherUsed,
}) {
  const t = useT();
  const isMobile = useIsMobile();
  const isNarrow = useIsNarrow();
  const [tab, setTab] = useState(0);
  const [period, setPeriod] = useState({ type: "all" });
  const [periodDropdown, setPeriodDropdown] = useState(null);
  const [filterDropdown, setFilterDropdown] = useState(null);
  const [globalFilter, setGlobalFilter] = useState(INITIAL_FILTER);
  // Per-session sub-view memory — lifted out of the tab components so it
  // survives switching top tabs (those components unmount when their tab is
  // inactive). Resets only on a full app restart (fresh state on mount).
  //   trainingView — Activities / Charts toggle inside Training
  //   racesTopTab  — Races / PR top tabs inside Races (mobile)
  //   racesSubTab  — Target / History sub-tabs inside Races
  const [trainingView, setTrainingView] = useState("activities");
  const [racesTopTab, setRacesTopTab] = useState("races");
  const [racesSubTab, setRacesSubTab] = useState("target");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [now, setNow] = useState(new Date());
  const [profileEditorMode, setProfileEditorMode] = useState(null);
  const [showApiSettings, setShowApiSettings] = useState(false);
  const [showWeatherApiSettings, setShowWeatherApiSettings] = useState(false);
  const [showPushSettings, setShowPushSettings] = useState(false);
  const [showInbox, setShowInbox] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [showInviteCodes, setShowInviteCodes] = useState(false);
  const [showPromptCatalog, setShowPromptCatalog] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const isAdmin = (user?.email || "").toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const [showGuide, setShowGuide] = useState(false);
  const [readinessPromptDate, setReadinessPromptDate] = useState(null);
  const [coachDraft, setCoachDraft] = useState(null);
  // Flash the "Daily coach push" settings cell after the user taps the inbox's
  // "set up daily push" button — draws the eye to where the setting lives.
  const [pushFlash, setPushFlash] = useState(false);
  // Same idea as pushFlash, for the "edit profile" jump from the AI Coach.
  const [profileFlash, setProfileFlash] = useState(false);

  // Inbox messages, loaded ONCE at startup so opening the inbox is instant (no
  // per-open fetch) and the unread badge derives from this list — marking read
  // updates the badge immediately, no DB round-trip / race. The modal does a
  // silent background refresh on open to pick up any newly-pushed messages.
  const [inboxItems, setInboxItems] = useState([]);
  useEffect(() => {
    db.pushInbox.listMine().then(setInboxItems).catch(() => {});
  }, []);
  const inboxUnread = inboxItems.filter(i => !i.read).length;

  useEffect(() => {
    const today = localDateKey(now);
    const note = dailyNotes.find(n => n.date === today);
    if (now.getHours() < 5 || readinessComplete(note?.readiness)) return;
    if (profileEditorMode || showTour || readinessPromptDate) return;
    try {
      if (localStorage.getItem(`ts.readinessPrompt.${today}`)) return;
    } catch { /* private mode */ }
    const id = setTimeout(() => setReadinessPromptDate(today), 0);
    return () => clearTimeout(id);
  }, [dailyNotes, now, profileEditorMode, readinessPromptDate, showTour]);

  function markReadinessPromptHandled(dateKey) {
    try { localStorage.setItem(`ts.readinessPrompt.${dateKey}`, "1"); } catch { /* private mode */ }
    setReadinessPromptDate(null);
  }

  function saveReadinessPrompt(vals) {
    const dateKey = readinessPromptDate;
    if (!dateKey) return;
    setReadiness(dateKey, vals);
    markReadinessPromptHandled(dateKey);
  }

  function requestCoachReview(workouts, meta = {}) {
    const rows = (Array.isArray(workouts) ? workouts : [workouts]).filter(Boolean).slice(0, 3);
    if (!rows.length) return;
    setCoachDraft({ id: Date.now(), text: buildWorkoutReviewDraft(rows, { ...meta, count: meta.count || rows.length }) });
    setTab(3);
  }

  // Jump from the inbox to the daily-push setting. On mobile that's the
  // Settings tab (flash the cell); on desktop just open the modal directly.
  function goToPushSettings() {
    setShowInbox(false);
    if (isMobile) {
      setTab(4);
      setPushFlash(true);
      setTimeout(() => setPushFlash(false), 2200);
    } else {
      setShowPushSettings(true);
    }
  }

  // Jump from the AI Coach's "edit profile" to the Settings → profile cell.
  // On mobile, switch to Settings and flash the cell (so the user learns where
  // their profile lives); on desktop, open the editor directly.
  function goToProfileSettings() {
    if (isMobile) {
      setTab(4);
      setProfileFlash(true);
      setTimeout(() => setProfileFlash(false), 2200);
    } else {
      setProfileEditorMode("preview");
    }
  }

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
  // First-send guidance nudge: the pending message, kept here (not in AICoachTab)
  // so it survives a tab switch — the nudge re-opens when the user returns.
  const [coachHintsPending, setCoachHintsPending] = useState(null);
  // ── Memory-update state, LIFTED here so it survives leaving the AI Coach
  //    tab. The user can hit "Update" in the Memory modal, walk away, and the
  //    request keeps running; when the proposal is ready a top banner invites
  //    them back to review it (see the memory banner near the return). showMemory
  //    is lifted too so the banner can open the modal.
  const [memoryUpdating, setMemoryUpdating] = useState(false);
  const [memoryProposal, setMemoryProposal] = useState(null); // { en, zh } once ready
  const [showMemory, setShowMemory] = useState(false);

  // Ask the LLM to distill an updated memory from the current chat + existing
  // memory. Runs at app scope (not inside AICoachTab) so unmounting that tab
  // mid-request doesn't drop the result. Errors surface via alert; success
  // sets memoryProposal, which both the Memory modal and the top banner react to.
  async function proposeMemoryUpdate() {
    const activeKey = apiProvider === "claude" ? claudeApiKey : apiKey;
    if (!activeKey) { window.alert(t("coach.no_key")); return; }
    if (!chatMessages.length) { window.alert(t("coach.memory_need_chat")); return; }
    const providerCfg = API_PROVIDERS[apiProvider] || API_PROVIDERS[DEFAULT_API_PROVIDER];
    const apiEndpoint = apiProvider === "claude"
      ? getEndpointUrl("claude", claudeEndpointId)
      : providerCfg.endpoints[0].url;
    const chatTranscript = chatMessages.map(m => `[${m.role}]\n${m.content}`).join("\n\n");
    const memoryPrompt = `You are updating a long-term memory file about a runner. The memory captures DURABLE, repeatedly-useful facts about the user — training patterns, preferences, injuries, recurring concerns, coaching style preferences.

Current memory (English):
${coachMemory || "(empty)"}

Recent conversation:
${chatTranscript}

Guidelines:
- One short fact per line. No markdown headings.
- Keep durable facts (preferences, goals, injuries, training style, recurring concerns).
- DROP session-specific things (today's specific question, one-off advice).
- Don't repeat what's already in the user's profile (age, location, basic stats).
- Maximum ~500 words. Trim older entries if needed.
- If nothing meaningful to add or update, return the existing memory unchanged.

Output the updated memory in BOTH English and Simplified Chinese — the SAME facts, SAME order, line-by-line correspondence — using EXACTLY this format and nothing else:
===EN===
<english memory, one fact per line>
===ZH===
<中文记忆，每行一条，与英文逐行一一对应>`;
    setMemoryUpdating(true);
    try {
      const resp = await postJson({
        url: apiEndpoint,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": activeKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: apiModel,
          max_tokens: 8000,
          messages: [{ role: "user", content: memoryPrompt }],
        }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        window.alert(t("coach.api_error", { msg: data.error?.message || `HTTP ${resp.status}` }));
        return;
      }
      const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("") || "";
      if (!text.trim()) { window.alert(t("coach.memory_empty_response")); return; }
      setMemoryProposal(parseBilingualMemory(text));
    } catch (err) {
      console.error("[AI Coach] Memory update error:", err);
      window.alert(t("coach.network_error", { msg: err.message, url: apiEndpoint }));
    } finally {
      setMemoryUpdating(false);
    }
  }

  // Shared weather context — populated once on mount (or when default
  // location changes). Consumed by sendChat (for the prompt), AICoachTab
  // (for the status pill + prompt preview), and the calendar can read
  // the same forecastByDate if we lift that later. Status field lets the
  // UI tell the user *why* weather isn't showing up instead of silently
  // dropping it.
  // Free-tier remaining (one-time allowance from the owner's shared keys).
  const freeDeepseekLeft = Math.max(0, FREE_DEEPSEEK_LIMIT - deepseekUsed);
  const freeWeatherLeft = Math.max(0, FREE_WEATHER_LIMIT - weatherUsed);
  // Stable so it doesn't churn the weather hook's effect every render.
  const onWeatherUsed = useCallback((remaining) => {
    if (typeof remaining === "number") setWeatherUsed(FREE_WEATHER_LIMIT - remaining);
  }, [setWeatherUsed]);

  const weatherCtx = useWeatherContext({
    defaultLng: defaultLocation?.lng,
    defaultLat: defaultLocation?.lat,
    caiyunToken: caiyunApiKey,
    freeWeatherLeft,
    onWeatherUsed,
  });

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
    // Free tier: DeepSeek with no own key but remaining allowance → route through
    // the coach-proxy (owner's shared key). Claude has no free tier.
    const useFreeProxy = apiProvider === "deepseek" && !apiKey && freeDeepseekLeft > 0;
    if (!activeKey && !useFreeProxy) {
      const exhausted = apiProvider === "deepseek" && !apiKey && freeDeepseekLeft <= 0;
      appendLocalChatMessage("assistant", exhausted ? t("coach.free_used") : t("coach.no_key"));
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

    // Reuse the AppShell-level weather state (populated by useWeatherContext
    // once on mount). On the first send right after page load this *may*
    // still be 'loading' — that's fine; the prompt just won't include
    // weather for that turn. Subsequent sends get the data.
    const { currentWeather, forecastByDate, status: weatherStatus } = weatherCtx;
    console.info('[weather] sendChat status:', weatherStatus,
      currentWeather ? `currentTemp=${currentWeather.tempC}°C apparent=${currentWeather.apparentC}°C` : 'no realtime',
      forecastByDate ? `${forecastByDate.size}-day forecast` : 'no forecast');

    // Race-day weather for the NEXT upcoming target race that has a location
    // (outdoor only — Hyrox is indoor, skipped). Forecast when within ~2 weeks,
    // else a climate normal. Only the nearest race is included so the coach
    // doesn't ramble about races months out. Best-effort — never blocks the send.
    let raceDayWeather = null;
    try {
      const nowMs = Date.now();
      const nextRace = races
        .filter(r => r.isTarget && r.category !== "Hyrox" && r.date
          && Number.isFinite(r.locationLat) && Number.isFinite(r.locationLng)
          && new Date(`${r.date}T00:00:00`).getTime() >= nowMs - 86400000)
        .sort((a, b) => a.date.localeCompare(b.date))[0];
      if (nextRace) {
        const w = await fetchRaceDayWeather({
          lat: nextRace.locationLat, lng: nextRace.locationLng,
          date: nextRace.date, caiyunToken: caiyunApiKey,
        });
        if (w) raceDayWeather = { name: nextRace.name, date: nextRace.date, ...w };
      }
    } catch { /* best-effort — skip race weather on any failure */ }

    const systemPrompt = buildSystemPrompt({
      profile, coachConfig, coachMemory,
      dataBlock: buildDataBlock({
        logs: freshLogs, races, now, lang: "en",
        currentWeather, forecastByDate, dailyNotes, raceDayWeather,
      }),
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

    if (useFreeProxy) {
      // Free tier: the coach-proxy Edge Function calls DeepSeek with the owner's
      // shared key, enforces + decrements quota, and returns { content, remaining }.
      try {
        const data = await db.usage.coachProxy({
          system: systemPrompt,
          messages: messagesToSend,
          max_tokens: 8000,
        });
        if (typeof data.remaining === "number") setDeepseekUsed(FREE_DEEPSEEK_LIMIT - data.remaining);
        const reply = data.content?.filter(b => b.type === "text").map(b => b.text).join("") || t("coach.no_response");
        try { await appendChatMessage("assistant", reply); } catch { /* alerted by wrapper */ }
      } catch (err) {
        if (err?.code === "quota_exceeded") {
          setDeepseekUsed(FREE_DEEPSEEK_LIMIT);
          appendLocalChatMessage("assistant", t("coach.free_used"));
        } else {
          console.error("[AI Coach] proxy error:", err);
          appendLocalChatMessage("assistant", t("coach.api_error", { msg: err?.message || String(err) }));
        }
      }
      setChatLoading(false);
      return true;
    }

    // Streaming reply. A transient assistant bubble fills in token-by-token,
    // then we persist the final text and swap the placeholder for the saved row.
    // postJsonStream uses window.fetch (streams on web + WebView) wrapped in
    // background grace; if the provider ignores stream:true it falls back to a
    // single full-text emit, so this path is safe for all providers.
    const streamId = `stream-${Date.now()}`;
    let started = false, lastFlush = 0;
    try {
      const result = await postJsonStream({
        url: endpointUrl,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": activeKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: {
          model: apiModel,
          max_tokens: 8000,
          system: systemPrompt,
          messages: messagesToSend,
          stream: true,
        },
        onToken: (full) => {
          if (!started) {
            started = true;
            setChatMessages(prev => [...prev, { id: streamId, role: "assistant", content: full, isLocal: true, isStreaming: true }]);
            return;
          }
          // Throttle re-renders (re-parsing markdown every token janks on phones).
          const tNow = Date.now();
          if (tNow - lastFlush < 40) return;
          lastFlush = tNow;
          setChatMessages(prev => prev.map(m => m.id === streamId ? { ...m, content: full } : m));
        },
      });
      if (!result.ok) {
        setChatMessages(prev => prev.filter(m => m.id !== streamId));
        const msg = result.errorText || `HTTP ${result.status}`;
        console.error("[AI Coach] API error:", msg);
        appendLocalChatMessage("assistant", t("coach.api_error", { msg }));
      } else if (!started) {
        // Provider returned nothing to stream — append a normal bubble.
        try { await appendChatMessage("assistant", result.text || t("coach.no_response")); } catch { /* alerted */ }
      } else {
        // Finalize the streamed bubble IN PLACE (no flash), then persist in the
        // background and swap the placeholder for the saved row (real id → the
        // calendar-import button then appears).
        const reply = result.text || t("coach.no_response");
        setChatMessages(prev => prev.map(m => m.id === streamId ? { ...m, content: reply, isStreaming: false } : m));
        try {
          const saved = await db.coachMessages.appendMessage("assistant", reply);
          setChatMessages(prev => prev.map(m => m.id === streamId ? saved : m));
        } catch (e) { console.error("[AI Coach] persist failed:", e); }
      }
    } catch (err) {
      console.error("[AI Coach] Network error:", err);
      setChatMessages(prev => prev.filter(m => m.id !== streamId));
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
  "distance": number (kilometres, optional),
  "ascent": number (metres of climb, optional),
  "speed": number (km/h, cycling target, optional),
  "duration": number (MINUTES, optional),
  "subTypes": ["Easy Run" | "Aerobic Run" | "Tempo Run" | "Interval Run" | "Race" | "Upper Body" | "Lower Body" | "Core"] (optional, only when relevant),
  "subTypeDurations": { "Upper Body": number, "Lower Body": number, "Core": number } (MINUTES per area; Strength only, optional),
  "timeOfDay": "am" | "pm" (optional — ONLY if the coach explicitly says morning/上午 or evening/afternoon/下午/晚上),
  "notes": string (brief — optional)
}

Rules:
- Only extract suggestions that have a clear day (explicit date OR a weekday like "Wednesday" / "周三" / "tomorrow"). Resolve weekdays to the next upcoming occurrence from today.
- Each TYPE has its OWN fields — emit only these, omit the rest:
  - Road Run: "distance"; put the run type in "subTypes" as exactly one of "Easy Run"/"Aerobic Run"/"Tempo Run"/"Interval Run" when the coach names an intensity. Do NOT emit "duration" for Road Run.
  - Trail Run / Hiking: "distance" and "ascent" (metres). Do NOT emit "duration".
  - Floor Climbing: "ascent" only.
  - Cycling: "distance" and "speed" (km/h) when given.
  - Swimming: "duration" only.
  - Strength: "subTypes" = area(s) ("Upper Body"/"Lower Body"/"Core"); when the coach gives per-area minutes, emit "subTypeDurations" mapping each area to its minutes.
  - HIIT: emit ONLY "timeOfDay" (and notes); no distance/duration.
- A heart-rate zone may go in notes as "Z1".."Z5" when the coach names one.
- Skip vague advice ("rest more", "stay hydrated"), past references, and analysis-only text.
- REST DAYS ARE NORMAL: do NOT invent a workout for every day. Only output entries for days the coach actually assigns training. A day the coach leaves blank — or explicitly calls a rest day with no activity — gets NO entry at all (just omit it). Only emit a "Recovery" entry if the coach explicitly prescribes an active-recovery session (e.g. an easy shakeout, mobility).
- If you cannot find any concrete plan, output [].
- Output the JSON array ONLY. No prose, no markdown fences, no comments.`;

    try {
      // Same native-HTTP-aware POST as sendChat — the plan-extraction call
      // benefits from backgrounding tolerance too (it can run for several
      // seconds, and the user might tab away).
      const resp = await postJson({
        url: endpointUrl,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": activeKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: {
          model: apiModel,
          max_tokens: 8000,
          messages: [{ role: "user", content: extractPrompt }],
        },
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

  function confirmImportPlans(workouts) {
    // bulkAddLogs is optimistic — the rows appear on Calendar before this
    // returns. Close the review modal immediately and skip the "success"
    // alert (which used to compete with a possible later failure alert).
    bulkAddLogs(workouts, { source: "ai_coach_plan", replacePlannedDates: true });
    setPlanProposal(null);
  }

  // True when ANY long-running AI Coach operation is in flight. Used to
  // render the spinner badge on the AI Coach tab label so the user knows
  // the model is still working even when they've switched to another tab.
  const coachBusy = chatLoading || !!extractingForMsgId || memoryUpdating;

  // First-time setup: force the wizard until profile is complete (incl. displayName)
  useEffect(() => {
    if (!isProfileComplete(profile)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProfileEditorMode("setup");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // First-run guided tour: fire once when a brand-new user's profile flips
  // incomplete -> complete (they just finished the setup wizard). Existing users
  // mount already-complete (null -> true), so they don't get it. Per-device flag.
  const prevProfileCompleteRef = useRef(null);
  const tourFiredRef = useRef(false);
  useEffect(() => {
    const complete = isProfileComplete(profile);
    const prev = prevProfileCompleteRef.current;
    prevProfileCompleteRef.current = complete;
    if (tourFiredRef.current) return;
    let seen = true;
    try { seen = !!localStorage.getItem(TOUR_FLAG); } catch { /* private mode: skip */ }
    if (seen) return;
    if (prev === false && complete === true) {
      tourFiredRef.current = true;
      setShowTour(true);
    }
  }, [profile]);

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

  // ── Android hardware/gesture back button ────────────────────────────────
  // Without a handler, Capacitor's default finishes the Activity → the app
  // drops to the home screen and the next launch re-runs the splash (feels
  // like the app was killed). We register a single listener and decide in JS:
  //   1. A modal is open  → close the top-most one (back stack).
  //   2. Not on Training  → go back to the Training tab.
  //   3. Otherwise (root) → minimizeApp() — same as pressing Home, so the
  //      Activity stays alive in the background and returning is instant
  //      (no splash). We never call exitApp(), so the app stays resident.
  // tabRef keeps the latest tab without re-registering the native listener.
  // Updated in an effect (not during render) to satisfy the refs-in-render lint.
  const tabRef = useRef(tab);
  useEffect(() => { tabRef.current = tab; });
  useEffect(() => {
    if (!Capacitor.isNativePlatform?.()) return;
    let handle;
    const sub = CapacitorApp.addListener("backButton", () => {
      // 1. Close the most-recently-opened overlay, if any.
      if (hasBackHandler()) {
        popBackHandler();
        return;
      }
      // 2. Non-root tab → return to Training (tab 0).
      if (tabRef.current !== 0) {
        setTab(0);
        return;
      }
      // 3. Root → drop to background instead of exiting (stays resident).
      CapacitorApp.minimizeApp();
    });
    sub.then(h => { handle = h; });
    return () => { if (handle) handle.remove(); };
  }, []);

  function executeDelete() {
    if (!confirmDelete) return;
    // Close the confirm modal IMMEDIATELY. Each delete fn is optimistic so
    // the corresponding row(s) are already gone from local state; the DB
    // delete runs in the background and surfaces a rollback alert on fail.
    const cd = confirmDelete;
    setConfirmDelete(null);
    if (cd.type === "log") deleteLogs([cd.id]);
    else if (cd.type === "logs") deleteLogs(cd.ids);
    else if (cd.type === "race") deleteRace(cd.id);
    else if (cd.type === "chat") clearAllChatMessages();
  }

  function toggleLang() {
    setLang(lang === "en" ? "zh" : "en");
  }

  const titleText = profile.displayName
    ? t("header.title", { name: profile.displayName })
    : t("header.title_empty");
  const desktopTabs = [
    { label: TABS[0], key: "tabs.training", Icon: FootIcon },
    { label: TABS[1], key: "tabs.calendar", Icon: CalendarIcon },
    { label: TABS[2], key: "tabs.races", Icon: TrophyIcon },
    { label: TABS[3], key: "tabs.ai_coach", Icon: CoachIcon },
  ];
  const headerCell = {
    border: "1px solid var(--rule)",
    borderRight: "none",
    background: "var(--bg-elevated)",
    height: 32,
    padding: "0 11px",
    fontSize: 13,
    color: "var(--ink-2)",
    fontFamily: "var(--font-sans)",
    borderRadius: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    textDecoration: "none",
  };

  // Keep the browser tab title in sync with the displayed page title
  useEffect(() => { document.title = titleText; }, [titleText]);

  // Tab content rendered identically across desktop & mobile shells — only
  // the chrome around it differs. Modals stay outside both shells so they
  // overlay everything (and aren't constrained by the mobile content scroll).
  // Render the content for a given tab index. A function (not a static
  // `tab === N` fragment) so the mobile pager can render the CURRENT tab AND a
  // neighbor simultaneously during a finger-follow swipe. Index 4 is the
  // mobile-only Settings page (desktop has no Settings tab; it never asks for 4).
  const renderTab = (which) => {
    if (which === 0) return (
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
          view={trainingView}
          setView={setTrainingView}
          setConfirmDelete={setConfirmDelete}
          profile={profile}
          races={races}
          onCoachReviewRequest={requestCoachReview}
        />
    );
    if (which === 1) return (
        <CalendarTab
          logs={logs}
          addLog={addLog}
          updateLog={updateLog}
          setConfirmDelete={setConfirmDelete}
          dailyNotes={dailyNotes}
          setDailyTags={setDailyTags}
          setReadiness={setReadiness}
          races={races}
          /* Shared weather context — same cache as AI Coach. Per-tab-mount
             fetch was wasteful; cache + visibility-change refresh in the
             hook is enough. */
          weatherCtx={weatherCtx}
        />
    );
    if (which === 2) return (
        <RacesTab
          races={races}
          addRace={addRace}
          updateRace={updateRace}
          now={now}
          setConfirmDelete={setConfirmDelete}
          itraPI={itraPI}
          setItraPI={setItraPI}
          mobileTopTab={racesTopTab}
          setMobileTopTab={setRacesTopTab}
          mobileSubTab={racesSubTab}
          setMobileSubTab={setRacesSubTab}
        />
    );
    if (which === 3) return (
        <AICoachTab
          logs={logs}
          races={races}
          profile={profile}
          coachConfig={coachConfig}
          setCoachConfig={setCoachConfig}
          coachMemory={coachMemory}
          setCoachMemory={setCoachMemory}
          coachMemoryZh={coachMemoryZh}
          setCoachMemoryZh={setCoachMemoryZh}
          setCoachMemoryBoth={setCoachMemoryBoth}
          chatMessages={chatMessages}
          appendLocalChatMessage={appendLocalChatMessage}
          now={now}
          setConfirmDelete={setConfirmDelete}
          dailyNotes={dailyNotes}
          apiProvider={apiProvider}
          apiKey={apiKey}
          claudeApiKey={claudeApiKey}
          claudeEndpointId={claudeEndpointId}
          apiModel={apiModel}
          onEditProfile={goToProfileSettings}
          onGoToTraining={() => setTab(0)}
          onGoToRaces={() => setTab(2)}
          coachHintsPending={coachHintsPending}
          setCoachHintsPending={setCoachHintsPending}
          /* Lifted state + handlers — see AppShell top for definitions. */
          chatLoading={chatLoading}
          extractingForMsgId={extractingForMsgId}
          sendChat={sendChat}
          importToCalendar={importToCalendar}
          /* Shared weather context — preview + status pill consume this. */
          weatherCtx={weatherCtx}
          /* "need location" weather pill now routes to the profile editor,
             where location (address + coords) lives. */
          onOpenLocationSettings={() => setProfileEditorMode("edit")}
          /* Inbox entry — top-right of the AI Coach header. */
          onOpenInbox={() => setShowInbox(true)}
          inboxUnread={inboxUnread}
          /* Memory update lifted to app scope (survives leaving the tab). */
          showMemory={showMemory}
          setShowMemory={setShowMemory}
          memoryUpdating={memoryUpdating}
          memoryProposal={memoryProposal}
          setMemoryProposal={setMemoryProposal}
          proposeMemoryUpdate={proposeMemoryUpdate}
          externalDraft={coachDraft}
          clearExternalDraft={() => setCoachDraft(null)}
        />
    );
    // Index 4 — mobile-only Settings page (desktop puts these in the top-right).
    if (which === 4) return (
        <SettingsMobileTab
          user={user}
          profile={profile}
          apiKey={apiKey}
          caiyunApiKey={caiyunApiKey}
          freeDeepseekLeft={freeDeepseekLeft}
          freeWeatherLeft={freeWeatherLeft}
          lang={lang}
          onOpenProfile={() => setProfileEditorMode("preview")}
          onOpenApiSettings={() => setShowApiSettings(true)}
          onOpenWeatherApiSettings={() => setShowWeatherApiSettings(true)}
          onOpenPushSettings={() => setShowPushSettings(true)}
          pushEnabled={pushEnabled}
          pushHours={pushHours}
          pushTimes={pushTimes}
          pushFlash={pushFlash}
          profileFlash={profileFlash}
          onOpenGuide={() => setShowGuide(true)}
          onToggleLang={toggleLang}
          onChangePassword={() => setShowChangePassword(true)}
          onDeleteAccount={() => setShowDeleteAccount(true)}
          isAdmin={isAdmin}
          onGenerateInvite={() => setShowInviteCodes(true)}
          onOpenPromptCatalog={() => setShowPromptCatalog(true)}
          signOut={signOut}
        />
    );
    return null;
  };
  const tabContent = renderTab(tab);

  const modals = (
    <>
      {/* Memory-update-ready banner — appears at the top of the app once the
          background memory proposal lands and the Memory modal isn't open, so
          the user can wander off while it runs and get pulled back to review.
          Tapping jumps to the AI Coach tab and opens the Memory modal. */}
      {memoryProposal && !showMemory && (
        <button
          onClick={() => { setTab(3); setShowMemory(true); }}
          className="ts-overlay-in"
          style={{
            position: "fixed", top: 0, left: 0, right: 0, zIndex: 9998,
            background: "var(--moss)", color: "var(--ink-inv)", border: "none",
            padding: "calc(env(safe-area-inset-top) + 10px) 16px 10px",
            fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 500,
            cursor: "pointer", textAlign: "center", width: "100%",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
          }}>
          <span aria-hidden="true">🧠</span>
          <span>{t("coach.memory_ready_banner")}</span>
        </button>
      )}
      <ConfirmDeleteModal
        confirmDelete={confirmDelete}
        setConfirmDelete={setConfirmDelete}
        onConfirm={executeDelete}
      />

      {profileEditorMode === "preview" && (
        <ProfilePreview
          profile={profile}
          defaultLocation={defaultLocation}
          onClose={() => setProfileEditorMode(null)}
          onEdit={() => setProfileEditorMode("edit")}
        />
      )}
      {(profileEditorMode === "edit" || profileEditorMode === "setup") && (
        <ProfileEditor
          profile={profile}
          setProfile={setProfile}
          mode={profileEditorMode}
          onClose={() => setProfileEditorMode(null)}
          defaultLocation={defaultLocation}
          setDefaultLocation={setDefaultLocation}
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
          freeDeepseekLeft={freeDeepseekLeft}
          onClose={() => setShowApiSettings(false)}
        />
      )}

      {showChangePassword && (
        <ChangePasswordModal
          changePassword={changePassword}
          onClose={() => setShowChangePassword(false)}
        />
      )}

      {showDeleteAccount && (
        <DeleteAccountModal
          deleteAccount={deleteAccount}
          onClose={() => setShowDeleteAccount(false)}
        />
      )}

      {showInviteCodes && (
        <InviteCodeModal onClose={() => setShowInviteCodes(false)} />
      )}

      {/* Admin-only prompt catalog viewer (gated on isAdmin so the entry never
          shows for normal users; render is also guarded here). */}
      {isAdmin && showPromptCatalog && (
        <PromptCatalogModal onClose={() => setShowPromptCatalog(false)} />
      )}

      {showTour && !profileEditorMode && (
        <OnboardingTour
          isMobile={isMobile}
          onChangeTab={setTab}
          onClose={() => setShowTour(false)}
        />
      )}

      {showWeatherApiSettings && (
        <WeatherApiSettingsModal
          caiyunApiKey={caiyunApiKey}
          setCaiyunApiKey={setCaiyunApiKey}
          freeWeatherLeft={freeWeatherLeft}
          onClose={() => setShowWeatherApiSettings(false)}
        />
      )}

      {showPushSettings && (
        <PushSettingsModal
          pushEnabled={pushEnabled}
          pushHours={pushHours}
          pushTimes={pushTimes}
          pushTimezone={pushTimezone}
          setPushSettings={setPushSettings}
          onClose={() => setShowPushSettings(false)}
        />
      )}

      {showInbox && (
        <InboxModal
          items={inboxItems}
          setItems={setInboxItems}
          onClose={() => setShowInbox(false)}
          onGoToPushSettings={goToPushSettings}
        />
      )}

      {readinessPromptDate && (
        <ReadinessPromptModal
          initial={dailyNotes.find(n => n.date === readinessPromptDate)?.readiness || null}
          onSave={saveReadinessPrompt}
          onSkip={() => markReadinessPromptHandled(readinessPromptDate)}
        />
      )}

      {showGuide && (
        <GuideModal
          onClose={() => setShowGuide(false)}
          onReplayTour={() => { setShowGuide(false); setShowTour(true); }}
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
    // MobileShell drives the finger-follow pager; renderTab(idx) lets it paint
    // the current tab AND a neighbor during a swipe. Index 4 is the Settings
    // page (handled inside renderTab).
    return (
      <>
        <MobileShell tab={tab} setTab={setTab} coachBusy={coachBusy}
          renderTab={renderTab} tabCount={5}
          /* Inner toggles (Training: Activities/Charts; Races: Races/PR) own a
             horizontal swipe until their edge — then the top pager takes over.
             This tells the shell where each inner toggle currently sits. */
          getInnerPager={(which) =>
            which === 0 ? { index: trainingView === "charts" ? 1 : 0, count: 2 }
            : which === 2 ? { index: racesTopTab === "pr" ? 1 : 0, count: 2 }
            : null}
          onRefresh={tab === 0 ? refresh : null} refreshing={refreshing} />
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
          <img src={productLogoUrl} alt="Training Studio"
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
            <button onClick={() => setShowGuide(true)}
              title={t("header.guide_tooltip")}
              style={headerCell}>
              <BookIcon size={13} />
              {t("header.guide")}
            </button>
            <button onClick={toggleLang} title={t("header.lang_tooltip")}
              style={headerCell}>
              <GlobeIcon size={13} />
              {lang === "en" ? "中" : "EN"}
            </button>
            <button onClick={() => setShowApiSettings(true)} title={t("header.api_tooltip")}
              style={{
                ...headerCell,
                background: apiKey ? "var(--bg-elevated)" : "rgba(181,78,26,0.08)",
                color: apiKey ? "var(--ink-2)" : "var(--warn)",
              }}>
              <KeyIcon size={13} />
              {t("header.api")}
              {!apiKey && (
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: "var(--warn)", display: "inline-block",
                }} />
              )}
            </button>
            <button onClick={() => setShowWeatherApiSettings(true)} title={t("settings.weather_api")}
              style={{ ...headerCell, width: 38, padding: 0 }}>
              <CloudIcon size={13} />
            </button>
            <button onClick={() => setProfileEditorMode("preview")} title={t("header.profile")}
              style={{ ...headerCell, width: 38, padding: 0 }}>
              <SettingsIcon size={14} />
            </button>
            <UserBadge user={user} signOut={signOut} onChangePassword={() => setShowChangePassword(true)} onDeleteAccount={() => setShowDeleteAccount(true)} isAdmin={isAdmin} onGenerateInvite={() => setShowInviteCodes(true)} />
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
        {desktopTabs.map(({ label, key, Icon }, i) => {
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
              <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                <Icon size={15} />
                {showSpinner && (
                  <span style={{
                    position: "absolute",
                    right: -9,
                    top: -6,
                    background: "var(--bg)",
                    borderRadius: 8,
                    lineHeight: 0,
                  }}>
                    <Spinner size={10} thickness={1.4} color="var(--moss)" />
                  </span>
                )}
              </span>
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
