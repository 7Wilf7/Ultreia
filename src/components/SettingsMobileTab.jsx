import { useCallback, useRef, useState, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { useT } from "../i18n/LanguageContext";
import { UpdateChecker } from "./UpdateChecker";
import { WalletPanel } from "./WalletModal";
import { productLogoUrl } from "../assets/logo";

const GROUP_ORDER = { wallet: 0, admin: 1, other: 2 };

/**
 * Mobile-only settings page. Public mode uses independent groups (one open at
 * a time):
 *   • Account  — tap the identity header → profile / change password / sign
 *                out / delete account.
 *   • Wallet   — balance + ledger entry point for AI and weather usage.
 *   • Admin    — (admin only) invite codes + prompt catalog.
 * Personal mode hides public wallet/admin surfaces, so the remaining settings
 * render directly without an "Other" group chip.
 */
export function SettingsMobileTab({
  user,
  profile,
  wallet,
  lang,
  onOpenProfile,
  onRefreshWallet,
  onOpenPushSettings,
  onOpenWeatherSettings,
  onOpenWeeklyReport,
  onOpenWeeklyReportSettings,
  weeklyReportStatus,
  weeklyReportEnabled,
  weeklyReportWeekday,
  weeklyReportTime,
  weeklyReportAfterSundayImport,
  weatherAutoUpdate,
  weatherIntervalHours,
  pushEnabled,
  pushHours,
  pushTimes,
  pushFlash,
  profileFlash,
  onOpenGuide,
  onToggleLang,
  onChangePassword,
  onDeleteAccount,
  isAdmin,
  publicFeatures = false,
  onGenerateInvite,
  onOpenAdminWalletGrant,
  onOpenPromptCatalog,
  signOut,
  focusGroup,
}) {
  const t = useT();
  const [accountOpen, setAccountOpen] = useState(false);
  const [group, setGroup] = useState("other");
  const [groupMotion, setGroupMotion] = useState({ dir: 0, seq: 0 });
  const [signingOut, setSigningOut] = useState(false);
  const [clearing, setClearing] = useState(false);
  const handledFocusTickRef = useRef(null);
  const showAdminGroup = publicFeatures && isAdmin;
  // Native (APK) updates go through the UpdateChecker + the SW is unregistered
  // there; the cache-clear cell is a web/PWA convenience for forcing a fresh
  // version after a deploy.
  const isNative = Capacitor.isNativePlatform?.() === true;

  // Drop the service worker + all Cache Storage, then hard-reload so the PWA
  // pulls the freshly-deployed index and assets from the network.
  async function clearCacheAndReload() {
    if (clearing) return;
    setClearing(true);
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if (typeof caches !== "undefined") {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch (e) {
      console.warn("[clear-cache] failed:", e);
    }
    window.location.reload();
  }

  function toggleAccount() {
    setAccountOpen(open => !open);
  }

  const selectGroup = useCallback((next) => {
    if (next === group) return;
    setGroupMotion(prev => ({
      dir: (GROUP_ORDER[next] ?? 0) > (GROUP_ORDER[group] ?? 0) ? 1 : -1,
      seq: prev.seq + 1,
    }));
    setGroup(next);
  }, [group]);

  // The "jump to this setting" flashes (from the inbox push-setup button / the
  // AI Coach edit-profile jump) only read if their group is open — auto-open it.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (pushFlash) selectGroup("other"); }, [pushFlash, selectGroup]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (profileFlash) setAccountOpen(true); }, [profileFlash]);
  useEffect(() => {
    if ((publicFeatures || group !== "wallet") && (showAdminGroup || group !== "admin")) return;
    const id = setTimeout(() => setGroup("other"), 0);
    return () => clearTimeout(id);
  }, [publicFeatures, showAdminGroup, group]);
  useEffect(() => {
    if (!publicFeatures && focusGroup?.group === "wallet") return;
    if (!focusGroup?.group || handledFocusTickRef.current === focusGroup.tick) return;
    handledFocusTickRef.current = focusGroup.tick;
    selectGroup(focusGroup.group);
  }, [focusGroup, publicFeatures, selectGroup]);

  const displayName = profile?.displayName || "—";
  const email = user?.email || "";
  const pushSlots = (Array.isArray(pushTimes) && pushTimes.length)
    ? [...pushTimes].sort()
    : (Array.isArray(pushHours) ? [...pushHours].sort((a, b) => a - b).map(h => `${String(h).padStart(2, "0")}:00`) : []);
  const weeklyDay = Number.isInteger(Number(weeklyReportWeekday)) ? Number(weeklyReportWeekday) : 0;
  const weeklyTime = typeof weeklyReportTime === "string" && weeklyReportTime ? weeklyReportTime : "20:00";
  const otherSettings = (
    <>
      <SubCell
        primary={t("settings.daily_push")}
        flash={pushFlash}
        secondary={(pushEnabled && pushSlots.length > 0)
          ? t("settings.daily_push_on", { time: pushSlots.join(" · ") })
          : t("settings.daily_push_off")}
        onClick={onOpenPushSettings} />
      <SubCell
        primary={t("settings.weekly_report")}
        secondary={weeklyReportStatus === "analyzing"
          ? t("settings.weekly_report_analyzing")
          : weeklyReportStatus === "extracting"
            ? t("settings.weekly_report_extracting")
            : t("settings.weekly_report_desc")}
        busy={!!weeklyReportStatus}
        onClick={onOpenWeeklyReport} />
      <SubCell
        primary={t("settings.weekly_report_auto")}
        secondary={weeklyReportEnabled
          ? t("settings.weekly_report_auto_on", { day: t(`weekly_settings.day_${weeklyDay}`), time: weeklyTime })
          : t("settings.weekly_report_auto_off", { sunday: weeklyReportAfterSundayImport !== false ? t("settings.weekly_report_sunday_on") : t("settings.weekly_report_sunday_off") })}
        onClick={onOpenWeeklyReportSettings} />
      <SubCell
        primary={t("settings.weather_updates")}
        secondary={weatherAutoUpdate !== false
          ? t("settings.weather_updates_on", {
              interval: Number(weatherIntervalHours) === 24
                ? t("settings.weather_updates_daily")
                : t("settings.weather_updates_hours", { n: String(Number(weatherIntervalHours) || 3) }),
            })
          : t("settings.weather_updates_off")}
        onClick={onOpenWeatherSettings} />
      <SubCell
        primary={t("settings.language")}
        rightValue={<LangSwitch lang={lang} onToggle={onToggleLang} />}
        onClick={onToggleLang} />
      <SubCell primary={t("settings.guide")} secondary={t("settings.guide_desc")} onClick={onOpenGuide} />
      {!isNative && (
        <SubCell
          primary={t("settings.clear_cache")}
          secondary={clearing ? t("settings.clear_cache_working") : t("settings.clear_cache_desc")}
          onClick={clearCacheAndReload} />
      )}
      <UpdateChecker />
    </>
  );

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      // No retry UI — Supabase signOut only fails on network errors; user
      // can pull again.
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div style={{ paddingTop: 8, paddingBottom: 8 }}>
      {/* Identity header — tap toggles the Account group. */}
      <button type="button" onClick={toggleAccount} style={{
        display: "flex", alignItems: "center", gap: 14,
        width: "100%",
        textAlign: "left",
        padding: "14px 14px",
        border: "1px solid var(--rule)",
        background: "var(--bg-elevated)",
        borderRadius: 10,
        marginBottom: 10,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.65)",
        cursor: "pointer",
        color: "var(--ink-1)",
        WebkitTapHighlightColor: "transparent",
      }}>
        <img src={productLogoUrl} alt="" aria-hidden="true"
          style={{ width: 48, height: 48, borderRadius: 12, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: "var(--font-sans)", fontSize: 17, fontWeight: 600,
            color: "var(--ink-1)", lineHeight: 1.15,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {displayName}
          </div>
          {email && (
            <div style={{
              marginTop: 4, fontFamily: "var(--font-sans)", fontSize: 12,
              color: "var(--ink-3)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {email}
            </div>
          )}
        </div>
        <div style={{ color: "var(--ink-3)", fontSize: 15, marginLeft: 4, flexShrink: 0 }}>
          {accountOpen ? "⌃" : "⌄"}
        </div>
      </button>

      <AccountPanel open={accountOpen}>
        <SubCell primary={t("settings.profile")} secondary={t("settings.profile_desc")} flash={profileFlash} onClick={onOpenProfile} />
        <SubCell primary={t("settings.change_password")} onClick={onChangePassword} />
        <SubCell
          primary={signingOut
            ? <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span className="ultreia-spinner" style={{ width: 13, height: 13, borderWidth: 2 }} />
                {t("settings.signing_out")}
              </span>
            : t("settings.sign_out")}
          danger onClick={handleSignOut} />
        <SubCell primary={t("settings.delete_account")} danger onClick={onDeleteAccount} />
      </AccountPanel>

      {publicFeatures && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <SectionChip active={group === "wallet"} onClick={() => selectGroup("wallet")}>
            {t("settings.section_wallet")}
          </SectionChip>
          {showAdminGroup && (
            <SectionChip active={group === "admin"} onClick={() => selectGroup("admin")}>
              {t("settings.section_admin")}
            </SectionChip>
          )}
          <SectionChip active={group === "other"} onClick={() => selectGroup("other")}>
            {t("settings.section_other")}
          </SectionChip>
        </div>
      )}

      <GroupPanel motion={groupMotion}>
        {publicFeatures && group === "wallet" && (
          <div style={{ padding: 14 }}>
            <WalletPanel wallet={wallet} onRefresh={onRefreshWallet} userEmail={user?.email || ""} />
          </div>
        )}

        {showAdminGroup && group === "admin" && (
          <>
            <SubCell primary={t("settings.generate_invite")} onClick={onGenerateInvite} />
            <SubCell primary={t("settings.admin_wallet_grant")} onClick={onOpenAdminWalletGrant} />
            <SubCell primary={t("settings.prompt_catalog")} onClick={onOpenPromptCatalog} />
          </>
        )}

        {group === "other" && otherSettings}
      </GroupPanel>
    </div>
  );
}

function AccountPanel({ open, children }) {
  return (
    <div aria-hidden={!open} style={{
      maxHeight: open ? 360 : 0,
      opacity: open ? 1 : 0,
      transform: open ? "translateY(0)" : "translateY(-6px)",
      transition: "max-height 320ms cubic-bezier(0.18,0.86,0.24,1), opacity 240ms cubic-bezier(0.2,0.7,0.3,1), transform 280ms cubic-bezier(0.18,0.86,0.24,1), margin-bottom 280ms cubic-bezier(0.18,0.86,0.24,1), border-color 240ms ease",
      marginBottom: open ? 10 : 0,
      border: "1px solid var(--rule-soft)",
      borderRadius: 8,
      background: "var(--bg)",
      overflow: "hidden",
      pointerEvents: open ? "auto" : "none",
      willChange: "max-height, opacity, transform",
    }}>
      {children}
    </div>
  );
}

function GroupPanel({ motion, children }) {
  const cls = motion.dir > 0 ? "ultreia-settings-slide-left" : motion.dir < 0 ? "ultreia-settings-slide-right" : undefined;
  return (
    <div style={{
      border: "1px solid var(--rule-soft)",
      borderRadius: 8,
      background: "var(--bg)",
      overflow: "hidden",
      minHeight: 48,
    }}>
      <div key={motion.seq} className={cls}>
        {children}
      </div>
    </div>
  );
}

// Pill that toggles a settings group.
function SectionChip({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "8px 14px", minHeight: 0,
      border: `1px solid ${active ? "var(--ink-1)" : "var(--rule)"}`,
      background: active ? "var(--ink-1)" : "var(--bg-elevated)",
      color: active ? "var(--ink-inv)" : "var(--ink-1)",
      borderRadius: 999,
      fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600,
      cursor: "pointer", WebkitTapHighlightColor: "transparent",
    }}>
      {children}
    </button>
  );
}

// Oval 中/EN segmented switch — a knob slides to the active side on tap. Stops
// propagation so tapping the switch toggles language exactly once.
function LangSwitch({ lang, onToggle }) {
  const isEn = lang === "en";
  return (
    <div
      role="switch"
      aria-checked={isEn}
      aria-label="Language"
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      style={{
        position: "relative", width: 76, height: 30, borderRadius: 15,
        background: "var(--bg-sunken)", border: "1px solid var(--rule)",
        cursor: "pointer", flexShrink: 0, userSelect: "none",
        WebkitTapHighlightColor: "transparent",
      }}>
      {/* Sliding knob — left:2 for 中, left:38 for EN. */}
      <div style={{
        position: "absolute", top: 2, left: isEn ? 38 : 2,
        width: 36, height: 24, borderRadius: 12,
        background: "var(--ink-1)",
        transition: "left 180ms cubic-bezier(0.2,0.7,0.3,1)",
      }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center" }}>
        <span style={{
          flex: 1, textAlign: "center", fontSize: 13, fontFamily: "var(--font-sans)",
          fontWeight: 600, zIndex: 1, transition: "color 180ms",
          color: !isEn ? "var(--ink-inv)" : "var(--ink-3)",
        }}>中</span>
        <span style={{
          flex: 1, textAlign: "center", fontSize: 11, fontFamily: "var(--font-mono)",
          fontWeight: 600, zIndex: 1, letterSpacing: "0.04em", transition: "color 180ms",
          color: isEn ? "var(--ink-inv)" : "var(--ink-3)",
        }}>EN</span>
      </div>
    </div>
  );
}

// Rows inside an accordion group. Supports a secondary line, a right-hand
// control (rightValue, e.g. the language switch — replaces the chevron), a
// flash highlight (jump-to-setting), and a danger tone.
function SubCell({ primary, secondary, warn, danger, rightValue, flash, busy, onClick }) {
  return (
    <button onClick={onClick}
      className={flash ? "ultreia-flash" : undefined}
      style={{
        display: "flex", alignItems: "center", width: "100%",
        textAlign: "left",
        background: "transparent",
        border: "none",
        borderBottom: "1px solid var(--rule-soft)",
        padding: "12px 14px",
        minHeight: 48,
        fontFamily: "var(--font-sans)", fontSize: 14,
        color: danger ? "var(--danger)" : "var(--ink-1)",
        fontWeight: 500,
        cursor: "pointer", borderRadius: 0,
        WebkitTapHighlightColor: "transparent",
      }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span>{primary}</span>
        {secondary && (
          <span style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 3,
            fontSize: 12,
            color: warn ? "var(--warn)" : "var(--ink-3)",
            fontWeight: 400,
            lineHeight: 1.35,
            overflowWrap: "anywhere",
          }}>
            {busy && <span className="ultreia-spinner" style={{ width: 11, height: 11, borderWidth: 1.5, flexShrink: 0 }} />}
            {secondary}
          </span>
        )}
      </span>
      {rightValue
        ? <span style={{ marginLeft: 12, flexShrink: 0 }}>{rightValue}</span>
        : <span style={{ color: "var(--ink-3)", fontSize: 14 }}>›</span>}
    </button>
  );
}
