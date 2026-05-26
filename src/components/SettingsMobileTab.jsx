import { useT } from "../i18n/LanguageContext";

/**
 * Mobile-only settings page — rendered when MobileShell tab=4. Hosts what
 * used to live in the desktop top-right corner (profile / API / language /
 * guide / sign out) plus account info. Styled as a vertical list of cells,
 * iOS-Settings-style.
 */
export function SettingsMobileTab({
  user,
  profile,
  apiKey,
  lang,
  onOpenProfile,
  onOpenApiSettings,
  onToggleLang,
  onChangePassword,
  signOut,
}) {
  const t = useT();
  const displayName = profile?.displayName || "—";
  const email = user?.email || "";

  return (
    <div style={{ paddingBottom: 8 }}>
      <SectionHeader label={t("settings.account")} />
      {/* Top cell = account identity. Tap → change password (matches the
          desktop UserBadge: clicking the account name reveals a password
          menu, not the profile editor). The display-name + email here is
          purely identity readout; the editable profile lives in the cell
          below. */}
      <Cell
        primary={displayName}
        secondary={email}
        onClick={onChangePassword}
        ariaLabel={t("settings.change_password")}
      />
      <Cell
        primary={t("settings.profile")}
        secondary={t("settings.profile_desc")}
        onClick={onOpenProfile}
      />

      <SectionHeader label={t("settings.preferences")} />
      <Cell
        primary={t("settings.api")}
        secondary={apiKey ? t("settings.api_set") : t("settings.api_missing")}
        secondaryWarn={!apiKey}
        onClick={onOpenApiSettings}
      />
      <Cell
        primary={t("settings.language")}
        rightValue={lang === "en" ? "English" : "中文"}
        onClick={onToggleLang}
      />
      <Cell
        primary={t("settings.guide")}
        secondary={t("settings.guide_desc")}
        href="https://training-studio.gitbook.io/training-studio-docs"
        external
      />

      <SectionHeader label="" />
      <Cell
        primary={t("settings.sign_out")}
        danger
        onClick={signOut}
      />
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
      {(onClick || href) && (
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
