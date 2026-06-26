import { s } from "../styles";

export const COACH_COMPOSER_HEIGHT = 32;

export function coachComposerInputStyle({ isMobile = true } = {}) {
  return {
    ...s.input,
    resize: isMobile ? "none" : "vertical",
    fontFamily: "var(--font-sans)",
    display: "block",
    width: "100%",
    lineHeight: isMobile ? 1.35 : 1.45,
    padding: isMobile ? "6px 9px" : undefined,
    minHeight: isMobile ? COACH_COMPOSER_HEIGHT : undefined,
    height: isMobile ? COACH_COMPOSER_HEIGHT : undefined,
    maxHeight: isMobile ? "calc(13px * 1.35 * 7 + 18px)" : undefined,
    overflowY: isMobile ? "auto" : undefined,
    "--mobile-input-fs": isMobile ? "13px" : undefined,
  };
}

export function coachComposerIconButtonStyle({ disabled = false } = {}) {
  return {
    ...s.btnGhost,
    width: 36,
    height: COACH_COMPOSER_HEIGHT,
    padding: 0,
    minHeight: COACH_COMPOSER_HEIGHT,
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: disabled ? 0.45 : 1,
  };
}

export function coachComposerSendButtonStyle({
  disabled = false,
  text = false,
  minWidth,
} = {}) {
  return {
    ...s.btn,
    width: text ? undefined : 40,
    minWidth: text ? (minWidth || 112) : undefined,
    height: COACH_COMPOSER_HEIGHT,
    minHeight: COACH_COMPOSER_HEIGHT,
    padding: text ? "0 12px" : 0,
    fontSize: text ? 13 : 20,
    lineHeight: 1,
    flexShrink: 0,
    opacity: disabled ? 0.4 : 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    whiteSpace: "nowrap",
  };
}
