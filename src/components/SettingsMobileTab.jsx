import { useState, useEffect } from "react";
import { useT } from "../i18n/LanguageContext";
import { UpdateChecker } from "./UpdateChecker";
import { FREE_DEEPSEEK_LIMIT, FREE_WEATHER_LIMIT } from "../constants";
import { CoachIcon, CloudIcon } from "./Icons";

/**
 * Mobile-only settings page. The old single "tap the email → one long list"
 * was too tall, so it's now an accordion of independent groups (one open at a
 * time):
 *   • Account  — tap the identity header → profile / change password / sign
 *                out / delete account.
 *   • API      — chip carries the two configured indicators; expands to the
 *                AI Coach API + Weather API cells.
 *   • Admin    — (admin only) invite codes + prompt catalog.
 *   • Other    — daily push / language / guide / app version.
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
  onOpenPromptCatalog,
  signOut,
}) {
  const t = useT();
  // Accordion — only one group open at a time. null | 'account' | 'api' | 'admin' | 'other'.
  const [open, setOpen] = useState(null);
  const toggle = (sec) => setOpen(cur => (cur === sec ? null : sec));
  const [signingOut, setSigningOut] = useState(false);

  // The "jump to this setting" flashes (from the inbox push-setup button / the
  // AI Coach edit-profile jump) only read if their group is open — auto-open it.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (pushFlash) setOpen("other"); }, [pushFlash]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (profileFlash) setOpen("account"); }, [profileFlash]);

  const displayName = profile?.displayName || "—";
  const email = user?.email || "";
  const pushSlots = (Array.isArray(pushTimes) && pushTimes.length)
    ? [...pushTimes].sort()
    : (Array.isArray(pushHours) ? [...pushHours].sort((a, b) => a - b).map(h => `${String(h).padStart(2, "0")}:00`) : []);

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
      <button type="button" onClick={() => toggle("account")} style={{
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
        <img src="/splash-logo.png" alt="" aria-hidden="true"
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
          {open === "account" ? "⌃" : "⌄"}
        </div>
      </button>

      <Panel open={open === "account"}>
        <SubCell primary={t("settings.profile")} secondary={t("settings.profile_desc")} flash={profileFlash} onClick={onOpenProfile} />
        <SubCell primary={t("settings.change_password")} onClick={onChangePassword} />
        <SubCell
          primary={signingOut
            ? <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span className="ts-spinner" style={{ width: 13, height: 13, borderWidth: 2 }} />
                {t("settings.signing_out")}
              </span>
            : t("settings.sign_out")}
          danger onClick={handleSignOut} />
        <SubCell primary={t("settings.delete_account")} danger onClick={onDeleteAccount} />
      </Panel>

      {/* Section chips. API keeps the two "configured" indicators from before. */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <SectionChip active={open === "api"} onClick={() => toggle("api")}>
          <ApiDot icon={<CoachIcon size={12} />} ok={!!apiKey} active={open === "api"} />
          <ApiDot icon={<CloudIcon size={12} />} ok={!!caiyunApiKey} active={open === "api"} />
          <span>{t("settings.section_api")}</span>
        </SectionChip>
        {isAdmin && (
          <SectionChip active={open === "admin"} onClick={() => toggle("admin")}>
            {t("settings.section_admin")}
          </SectionChip>
        )}
        <SectionChip active={open === "other"} onClick={() => toggle("other")}>
          {t("settings.section_other")}
        </SectionChip>
      </div>

      <Panel open={open === "api"}>
        <SubCell
          primary={t("settings.ai_api")}
          secondary={apiKey
            ? t("settings.api_set")
            : (typeof freeDeepseekLeft === "number" && freeDeepseekLeft > 0
                ? t("quota.ai_left", { n: String(freeDeepseekLeft), total: String(FREE_DEEPSEEK_LIMIT) })
                : t("settings.api_missing"))}
          warn={!apiKey && !(typeof freeDeepseekLeft === "number" && freeDeepseekLeft > 0)}
          onClick={onOpenApiSettings} />
        <SubCell
          primary={t("settings.weather_api")}
          secondary={caiyunApiKey
            ? t("settings.api_set")
            : (typeof freeWeatherLeft === "number" && freeWeatherLeft > 0
                ? t("quota.weather_left", { n: String(freeWeatherLeft), total: String(FREE_WEATHER_LIMIT) })
                : t("settings.weather_api_default"))}
          warn={!caiyunApiKey && !(typeof freeWeatherLeft === "number" && freeWeatherLeft > 0)}
          onClick={onOpenWeatherApiSettings} />
      </Panel>

      {isAdmin && (
        <Panel open={open === "admin"}>
          <SubCell primary={t("settings.generate_invite")} onClick={onGenerateInvite} />
          <SubCell primary={t("settings.prompt_catalog")} onClick={onOpenPromptCatalog} />
        </Panel>
      )}

      <Panel open={open === "other"}>
        <SubCell
          primary={t("settings.daily_push")}
          flash={pushFlash}
          secondary={(pushEnabled && pushSlots.length > 0)
            ? t("settings.daily_push_on", { time: pushSlots.join(" · ") })
            : t("settings.daily_push_off")}
          onClick={onOpenPushSettings} />
        <SubCell
          primary={t("settings.language")}
          rightValue={<LangSwitch lang={lang} onToggle={onToggleLang} />}
          onClick={onToggleLang} />
        <SubCell primary={t("settings.guide")} secondary={t("settings.guide_desc")} onClick={onOpenGuide} />
        <UpdateChecker />
      </Panel>
    </div>
  );
}

// Collapsible group container with the same animation the account list used.
function Panel({ open, children }) {
  return (
    <div aria-hidden={!open} style={{
      maxHeight: open ? 600 : 0,
      opacity: open ? 1 : 0,
      transform: open ? "translateY(0)" : "translateY(-6px)",
      overflow: "hidden",
      pointerEvents: open ? "auto" : "none",
      transition: "max-height 240ms cubic-bezier(0.2,0.7,0.3,1), opacity 160ms ease, transform 180ms ease",
      marginBottom: open ? 10 : 0,
      border: open ? "1px solid var(--rule-soft)" : "1px solid transparent",
      borderRadius: 8,
      background: "var(--bg)",
    }}>
      {children}
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

// Compact configured/missing indicator shown on the API chip (replaces the two
// "Configured" pills). Green icon = set, warn = needs attention.
function ApiDot({ icon, ok, active }) {
  const color = active ? "var(--ink-inv)" : ok ? "var(--moss-deep)" : "var(--warn)";
  return <span style={{ display: "inline-flex", color }} title={ok ? "configured" : "not set"}>{icon}</span>;
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
function SubCell({ primary, secondary, warn, danger, rightValue, flash, onClick }) {
  return (
    <button onClick={onClick}
      className={flash ? "ts-flash" : undefined}
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
            display: "block",
            marginTop: 3,
            fontSize: 12,
            color: warn ? "var(--warn)" : "var(--ink-3)",
            fontWeight: 400,
            lineHeight: 1.35,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
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
