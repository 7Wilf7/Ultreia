export const RUNNER_STATUS_DISCONNECT_CONFIRM_MS = 30_000;

export function createOptimisticRunnerStatus(source = {}) {
  return {
    ...source,
    provider: "desktop_codex",
    state: "online",
    runner_state: "online",
    codex_status: source.codex_status === "ok" ? "ok" : "unknown",
    expected_provider: source.preference === "deepseek_only" ? "deepseek" : "desktop_codex",
    optimistic: true,
    pending_state: source.state || null,
    checked_at: source.checked_at || new Date().toISOString(),
  };
}

function isRunnerHardFailure(status) {
  return status?.codex_status === "auth_error"
    || status?.reason === "desktop_codex_auth_error";
}

function shouldConfirmRunnerDisconnect(status) {
  const state = status?.state || "unknown";
  return state === "unknown" || state === "stale" || state === "offline" || state === "error";
}

export function resolveRunnerStatusForDisplay(status, {
  disconnectSince = null,
  now = Date.now(),
  confirmMs = RUNNER_STATUS_DISCONNECT_CONFIRM_MS,
} = {}) {
  const next = status || { state: "unknown", provider: "desktop_codex" };
  if (!shouldConfirmRunnerDisconnect(next)) {
    return { status: next, disconnectSince: null };
  }
  if (isRunnerHardFailure(next)) {
    return { status: next, disconnectSince: disconnectSince ?? now };
  }

  const startedAt = Number.isFinite(disconnectSince) ? disconnectSince : now;
  if (now - startedAt < confirmMs) {
    return {
      status: createOptimisticRunnerStatus(next),
      disconnectSince: startedAt,
    };
  }
  return { status: next, disconnectSince: startedAt };
}
