import { useCallback, useRef, useState, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { useT } from "../i18n/LanguageContext";
import { UpdateChecker } from "./UpdateChecker";
import { WalletPanel } from "./WalletModal";
import { productLogoUrl } from "../assets/logo";
import { clearPwaCacheAndReload } from "../core/pwa";
import { useInstantPress, useInstantTap } from "../hooks/useInstantPress";

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
  onOpenWeatherSettings,
  onOpenPushSettings,
  onOpenWeeklyReportSettings,
  onOpenLocationSettings,
  pushEnabled,
  pushTimes = [],
  weeklyReportEnabled,
  defaultLocation,
  weatherAutoUpdate,
  weatherIntervalHours,
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
  const instantTap = useInstantTap();
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

  async function handleClearCacheAndReload() {
    if (clearing) return;
    setClearing(true);
    await clearPwaCacheAndReload();
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

  // The "jump to this setting" flash only reads if the account group is open.
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
  const locationFlash = focusGroup?.group === "other" && focusGroup?.item === "location";
  const sectionHeadingStyle = {
    padding: "12px 14px 7px",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    color: "var(--ink-3)",
    textTransform: "uppercase",
  };
  const otherSettings = (
    <>
      <div style={sectionHeadingStyle}>
        {t("settings.notifications_automation")}
      </div>
      <SubCell
        primary={t("settings.daily_push")}
        secondary={pushEnabled
          ? t("settings.daily_push_on", { time: pushTimes.join(" / ") || "—" })
          : t("settings.daily_push_off")}
        onClick={onOpenPushSettings} />
      <SubCell
        primary={t("settings.weekly_report_auto")}
        secondary={weeklyReportEnabled ? t("settings.automation_on") : t("settings.automation_off")}
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
      <SubCell key={`location-${locationFlash ? focusGroup.tick : 0}`}
        primary={t("settings.location")}
        secondary={defaultLocation?.name || t("settings.location_missing")}
        flash={locationFlash}
        onClick={onOpenLocationSettings} />
      <div style={{ ...sectionHeadingStyle, borderTop: "1px solid var(--rule-soft)", marginTop: 4 }}>
        {t("settings.section_other")}
      </div>
      <SubCell
        primary={t("settings.language")}
        rightValue={<LangSwitch lang={lang} onToggle={onToggleLang} />}
        onClick={onToggleLang} />
      <SubCell primary={t("settings.guide")} secondary={t("settings.guide_desc")} onClick={onOpenGuide} />
      {!isNative && (
        <SubCell
          primary={t("settings.clear_cache")}
          secondary={clearing ? t("settings.clear_cache_working") : t("settings.clear_cache_desc")}
          instant={false}
          onClick={handleClearCacheAndReload} />
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
      <button type="button" {...instantTap("settings-account-toggle", toggleAccount)} style={{
        display: "flex", alignItems: "center", gap: 14,
        width: "100%",
        textAlign: "left",
        padding: "12px 14px",
        border: "1px solid var(--rule)",
        background: "var(--bg-elevated)",
        borderRadius: 10,
        marginBottom: 10,
        boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.05)",
        cursor: "pointer",
        color: "var(--ink-1)",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
      }}>
        <img src={productLogoUrl} alt="" aria-hidden="true"
          style={{ width: 44, height: 44, borderRadius: 10, flexShrink: 0 }} />
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
  const instantPress = useInstantPress();
  return (
    <button type="button" {...instantPress(`settings-section-${children}`, onClick)} style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "8px 14px", minHeight: 0,
      border: `1px solid ${active ? "var(--accent)" : "var(--rule)"}`,
      background: active ? "var(--accent-soft)" : "var(--bg-elevated)",
      color: active ? "var(--accent-dark)" : "var(--ink-1)",
      borderRadius: 999,
      fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600,
      cursor: "pointer", touchAction: "manipulation", WebkitTapHighlightColor: "transparent",
    }}>
      {children}
    </button>
  );
}

// Oval 中/EN segmented switch — a knob slides to the active side on tap. Stops
// propagation so tapping the switch toggles language exactly once.
function LangSwitch({ lang, onToggle }) {
  const instantPress = useInstantPress();
  const isEn = lang === "en";
  const toggle = (event) => {
    event?.stopPropagation?.();
    onToggle();
  };
  return (
    <div
      role="switch"
      aria-checked={isEn}
      aria-label="Language"
      {...instantPress("settings-language-switch", toggle)}
      style={{
        position: "relative", width: 76, height: 30, borderRadius: 15,
        background: "var(--bg-sunken)", border: "1px solid var(--rule)",
        cursor: "pointer", flexShrink: 0, userSelect: "none",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
      }}>
      {/* Sliding knob — left:2 for 中, left:38 for EN. */}
      <div style={{
        position: "absolute", top: 2, left: isEn ? 38 : 2,
        width: 36, height: 24, borderRadius: 12,
        background: "var(--accent)",
        transition: "left 180ms cubic-bezier(0.2,0.7,0.3,1)",
      }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center" }}>
        <span style={{
          flex: 1, textAlign: "center", fontSize: 13, fontFamily: "var(--font-sans)",
          fontWeight: 600, zIndex: 1, transition: "color 180ms",
          color: !isEn ? "var(--accent-ink)" : "var(--ink-3)",
        }}>中</span>
        <span style={{
          flex: 1, textAlign: "center", fontSize: 11, fontFamily: "var(--font-mono)",
          fontWeight: 600, zIndex: 1, letterSpacing: "0.04em", transition: "color 180ms",
          color: isEn ? "var(--accent-ink)" : "var(--ink-3)",
        }}>EN</span>
      </div>
    </div>
  );
}

// Rows inside an accordion group. Supports a secondary line, a right-hand
// control (rightValue, e.g. the language switch — replaces the chevron), a
// flash highlight (jump-to-setting), and a danger tone.
function SubCell({ primary, secondary, warn, danger, rightValue, flash, busy, expanded, indent = 0, instant = true, onClick }) {
  const instantTap = useInstantTap();
  const pressProps = !instant
    ? { onClick }
    : instantTap(`settings-cell-${String(primary)}`, onClick);
  return (
    <button {...pressProps}
      className={flash ? "ultreia-flash" : undefined}
      style={{
        display: "flex", alignItems: "center", width: "100%",
        textAlign: "left",
        background: "transparent",
        border: "none",
        borderBottom: "1px solid var(--rule-soft)",
        padding: `12px 14px 12px ${14 + indent}px`,
        minHeight: 48,
        fontFamily: "var(--font-sans)", fontSize: 14,
        color: danger ? "var(--danger)" : "var(--ink-1)",
        fontWeight: 500,
        cursor: "pointer", borderRadius: 0,
        touchAction: "manipulation",
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
        : <span style={{ color: "var(--ink-3)", fontSize: 14 }}>{expanded ? "⌄" : "›"}</span>}
    </button>
  );
}
