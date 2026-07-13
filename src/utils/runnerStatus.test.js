import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RUNNER_STATUS_DISCONNECT_CONFIRM_MS,
  createOptimisticRunnerStatus,
  resolveRunnerStatusForDisplay,
} from "./runnerStatus";

describe("runner status display", () => {
  it("starts green without changing a DeepSeek-only preference", () => {
    expect(createOptimisticRunnerStatus({ state: "initial" })).toMatchObject({
      state: "online",
      codex_status: "unknown",
      expected_provider: "desktop_codex",
      optimistic: true,
    });
    expect(createOptimisticRunnerStatus({ preference: "deepseek_only" }).expected_provider).toBe("deepseek");
  });

  it("keeps short heartbeat gaps and ordinary Codex errors optimistic", () => {
    const startedAt = 1_000;
    for (const state of ["stale", "offline", "error"]) {
      const result = resolveRunnerStatusForDisplay(
        { state, codex_status: state === "error" ? "error" : "unknown" },
        { disconnectSince: startedAt, now: startedAt + RUNNER_STATUS_DISCONNECT_CONFIRM_MS - 1 },
      );
      expect(result.status).toMatchObject({ state: "online", optimistic: true });
    }
  });

  it("shows a sustained disconnect but resets confirmation after recovery", () => {
    const startedAt = 2_000;
    const disconnected = resolveRunnerStatusForDisplay(
      { state: "offline", codex_status: "unknown" },
      { disconnectSince: startedAt, now: startedAt + RUNNER_STATUS_DISCONNECT_CONFIRM_MS },
    );
    expect(disconnected.status.state).toBe("offline");

    const recovered = resolveRunnerStatusForDisplay(
      { state: "online", codex_status: "ok" },
      { disconnectSince: disconnected.disconnectSince, now: startedAt + RUNNER_STATUS_DISCONNECT_CONFIRM_MS + 1 },
    );
    expect(recovered).toMatchObject({
      status: { state: "online", codex_status: "ok" },
      disconnectSince: null,
    });
  });

  it("surfaces authentication failures immediately", () => {
    const result = resolveRunnerStatusForDisplay({ state: "error", codex_status: "auth_error" }, { now: 3_000 });
    expect(result.status).toMatchObject({ state: "error", codex_status: "auth_error" });
    expect(result.status.optimistic).not.toBe(true);
  });

  it("keeps the runner-status endpoint aligned with the routing cooldown", () => {
    const edgePath = fileURLToPath(new URL("../../supabase/functions/coach-proxy/index.ts", import.meta.url));
    const edgeSource = readFileSync(edgePath, "utf8");
    expect(edgeSource).toContain("const codexErrorActive =");
    expect(edgeSource).toContain("codexErrorCooldownMs(codexStatus)");
    expect(edgeSource).toContain('codex_status: codexErrorActive ? codexStatus : (codexStatus === "ok" ? "ok" : "unknown")');
  });
});
