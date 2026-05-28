import { useState } from "react";
import { useT } from "../i18n/LanguageContext";
import { UpdateChecker } from "./UpdateChecker";

/**
 * Mobile-only settings page — three sections, top-down:
 *   1. 账号 (Account)    — display name + email cell that EXPANDS into a
 *                          secondary menu (Change password / Sign out).
 *                          "Change password" pops a centered modal so the
 *                          user never leaves Settings.
 *   2. API               — AI Coach API cell + Weather API cell.
 *   3. 其他 (Other)      — Language · Default location · User guide · App version.
 *
 * The expanding-account-cell pattern keeps Sign out off the top-level list
 * (used to live as a dangerous-looking standalone cell at the bottom) and
 * groups password / sign-out under one identity owner.
 */
export function SettingsMobileTab({
  user,
  profile,
  apiKey,
  caiyunApiKey,      // optional — undefined until #9 schema lands
  lang,
  defaultLocation,
  onOpenProfile,
  onOpenApiSettings,
  onOpenWeatherApiSettings,
  onOpenLocationSettings,
  onOpenGuide,
  onToggleLang,
  onChangePassword,
  signOut,
}) {
  const t = useT();
  const [accountOpen, setAccountOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const displayName = profile?.displayName || "—";
  const email = user?.email || "";
  // Default-location secondary line — name if labeled, raw coords if not, or
  // the "not set" warning when nothing is configured.
  const locName = defaultLocation?.name?.trim();
  const hasLocCoords = Number.isFinite(defaultLocation?.lng) && Number.isFinite(defaultLocation?.lat);
  const locSecondary = locName
    ? t("settings.location_set", { name: locName })
    : hasLocCoords
      ? `${defaultLocation.lng}, ${defaultLocation.lat}`
      : t("settings.location_missing");

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
    <div style={{ paddingBottom: 8 }}>
      {/* ── 账号 ────────────────────────────────────────────────────────── */}
      <SectionHeader label={t("settings.account")} />
      <Cell
        primary={displayName}
        secondary={email}
        rightValue={accountOpen ? "▴" : "▾"}
        onClick={() => setAccountOpen(o => !o)}
        ariaLabel={t("settings.email_actions")}
      />
      {accountOpen && (
        <div style={{ paddingLeft: 14, background: "var(--bg)" }}>
          <SubCell
            primary={t("settings.change_password")}
            onClick={() => { setAccountOpen(false); onChangePassword(); }}
          />
          <SubCell
            primary={signingOut ? "…" : t("settings.sign_out")}
            danger
            onClick={handleSignOut}
          />
        </div>
      )}
      <Cell
        primary={t("settings.profile")}
        secondary={t("settings.profile_desc")}
        onClick={onOpenProfile}
      />

      {/* ── API ──────────────────────────────────────────────────────────── */}
      <SectionHeader label={t("settings.section_api")} />
      <Cell
        primary={t("settings.ai_api")}
        secondary={apiKey ? t("settings.api_set") : t("settings.api_missing")}
        secondaryWarn={!apiKey}
        onClick={onOpenApiSettings}
      />
      <Cell
        primary={t("settings.weather_api")}
        secondary={caiyunApiKey ? t("settings.weather_api_set") : t("settings.weather_api_default")}
        onClick={onOpenWeatherApiSettings}
      />

      {/* ── 其他 ──────────────────────────────────────────────────────────── */}
      <SectionHeader label={t("settings.section_other")} />
      <Cell
        primary={t("settings.language")}
        rightValue={lang === "en" ? "English" : "中文"}
        onClick={onToggleLang}
      />
      <Cell
        primary={t("settings.location")}
        secondary={locSecondary}
        secondaryWarn={!locName && !hasLocCoords}
        onClick={onOpenLocationSettings}
      />
      <Cell
        primary={t("settings.guide")}
        secondary={t("settings.guide_desc")}
        onClick={onOpenGuide}
      />
      <UpdateChecker />
    </div>
  );
}

function SectionHeader({ label }) {
  return (
    <div style={{
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--ink-3)",
      textTransform: "uppercase",
      letterSpacing: "0.06em",
      padding: "20px 4px 8px",
      minHeight: label ? undefined : 12,
    }}>
      {label}
    </div>
  );
}

// Top-level cells — full-width with the rule above + below, iOS-Settings look.
function Cell({ primary, secondary, secondaryWarn, rightValue, onClick, href, external, danger, ariaLabel }) {
  const inner = (
    <>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: "var(--font-sans)",
          fontSize: 15,
          color: danger ? "var(--danger)" : "var(--ink-1)",
          fontWeight: 500,
          lineHeight: 1.25,
        }}>
          {primary}
        </div>
        {secondary && (
          <div style={{
            fontFamily: "var(--font-sans)",
            fontSize: 12,
            color: secondaryWarn ? "var(--warn)" : "var(--ink-3)",
            marginTop: 3,
            lineHeight: 1.35,
          }}>
            {secondary}
          </div>
        )}
      </div>
      {rightValue && (
        <div style={{
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          color: "var(--ink-3)",
          marginLeft: 12,
        }}>
          {rightValue}
        </div>
      )}
      {(onClick || href) && !rightValue && (
        <div style={{
          marginLeft: 10,
          color: "var(--ink-3)",
          fontSize: 16,
          lineHeight: 1,
        }}>
          {external ? "↗" : "›"}
        </div>
      )}
    </>
  );

  const baseStyle = {
    display: "flex",
    alignItems: "center",
    width: "100%",
    textAlign: "left",
    background: "var(--bg-elevated)",
    border: "none",
    borderBottom: "1px solid var(--rule-soft)",
    borderTop: "1px solid var(--rule-soft)",
    marginTop: -1,
    padding: "14px 14px",
    minHeight: 56,
    cursor: onClick || href ? "pointer" : "default",
    fontFamily: "var(--font-sans)",
    borderRadius: 0,
    color: "var(--ink-1)",
    textDecoration: "none",
    WebkitTapHighlightColor: "transparent",
  };

  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" style={baseStyle} aria-label={ariaLabel}>
        {inner}
      </a>
    );
  }
  return (
    <button onClick={onClick} style={baseStyle} aria-label={ariaLabel}>
      {inner}
    </button>
  );
}

// Secondary cells — slightly indented + lower density, used inside the
// expanded account menu so the user reads them as "options under email".
function SubCell({ primary, danger, onClick }) {
  return (
    <button onClick={onClick} style={{
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
      <span style={{ flex: 1 }}>{primary}</span>
      <span style={{ color: "var(--ink-3)", fontSize: 14 }}>›</span>
    </button>
  );
}
