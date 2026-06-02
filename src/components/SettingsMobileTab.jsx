import { useState } from "react";
import { useT } from "../i18n/LanguageContext";
import { UpdateChecker } from "./UpdateChecker";
import { FREE_DEEPSEEK_LIMIT, FREE_WEATHER_LIMIT } from "../constants";

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
  freeDeepseekLeft,
  freeWeatherLeft,
  lang,
  onOpenProfile,
  onOpenApiSettings,
  onOpenWeatherApiSettings,
  onOpenPushSettings,
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
  onGenerateInvite,
  signOut,
}) {
  const t = useT();
  const [accountOpen, setAccountOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const displayName = profile?.displayName || "—";
  const email = user?.email || "";

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
          {isAdmin && (
            <SubCell
              primary={t("settings.generate_invite")}
              onClick={() => { setAccountOpen(false); onGenerateInvite(); }}
            />
          )}
          <SubCell
            primary={signingOut
              ? <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span className="ts-spinner" style={{ width: 13, height: 13, borderWidth: 2 }} />
                  {t("settings.signing_out")}
                </span>
              : t("settings.sign_out")}
            danger
            onClick={handleSignOut}
          />
          <SubCell
            primary={t("settings.delete_account")}
            danger
            onClick={() => { setAccountOpen(false); onDeleteAccount(); }}
          />
        </div>
      )}
      <Cell
        flash={profileFlash}
        primary={t("settings.profile")}
        secondary={t("settings.profile_desc")}
        onClick={onOpenProfile}
      />

      {/* ── API ──────────────────────────────────────────────────────────── */}
      <SectionHeader label={t("settings.section_api")} />
      <Cell
        primary={t("settings.ai_api")}
        secondary={apiKey
          ? t("settings.api_set")
          : (typeof freeDeepseekLeft === "number" && freeDeepseekLeft > 0
              ? t("quota.ai_left", { n: String(freeDeepseekLeft), total: String(FREE_DEEPSEEK_LIMIT) })
              : t("settings.api_missing"))}
        secondaryWarn={!apiKey && !(typeof freeDeepseekLeft === "number" && freeDeepseekLeft > 0)}
        onClick={onOpenApiSettings}
      />
      <Cell
        primary={t("settings.weather_api")}
        secondary={caiyunApiKey
          ? t("settings.weather_api_set")
          : (typeof freeWeatherLeft === "number" && freeWeatherLeft > 0
              ? t("quota.weather_left", { n: String(freeWeatherLeft), total: String(FREE_WEATHER_LIMIT) })
              : t("settings.weather_api_default"))}
        secondaryWarn={!caiyunApiKey && !(typeof freeWeatherLeft === "number" && freeWeatherLeft > 0)}
        onClick={onOpenWeatherApiSettings}
      />

      {/* ── 其他 ──────────────────────────────────────────────────────────── */}
      <SectionHeader label={t("settings.section_other")} />
      <Cell
        flash={pushFlash}
        primary={t("settings.daily_push")}
        secondary={(() => {
          // Prefer the new "HH:MM" times; fall back to legacy whole-hours.
          const slots = (Array.isArray(pushTimes) && pushTimes.length)
            ? [...pushTimes].sort()
            : (Array.isArray(pushHours) ? [...pushHours].sort((a, b) => a - b).map(h => `${String(h).padStart(2, "0")}:00`) : []);
          return (pushEnabled && slots.length > 0)
            ? t("settings.daily_push_on", { time: slots.join(" · ") })
            : t("settings.daily_push_off");
        })()}
        onClick={onOpenPushSettings}
      />
      <Cell
        primary={t("settings.language")}
        rightValue={<LangSwitch lang={lang} onToggle={onToggleLang} />}
        onClick={onToggleLang}
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

// Oval 中/EN segmented switch — a knob slides to the active side on tap.
// Rendered inside the language Cell as its right-hand control. Uses a div
// (not a button) to stay valid nested inside the Cell's <button>, and stops
// propagation so it toggles exactly once.
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
function Cell({ primary, secondary, secondaryWarn, rightValue, onClick, href, external, danger, ariaLabel, flash }) {
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
    <button onClick={onClick} style={baseStyle} aria-label={ariaLabel}
      className={flash ? "ts-flash" : undefined}>
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
