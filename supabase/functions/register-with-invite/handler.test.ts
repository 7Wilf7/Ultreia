import { describe, expect, it } from "vitest";
import { createRegisterWithInviteHandler } from "./handler.ts";
import type { RegistrationGateway } from "./registration.ts";

const validPayload = {
  email: ["temporary", "invalid"].join("@") + ".test",
  password: "opaque-password",
  code: "opaque-invite",
};

function request(body: unknown) {
  return new Request("https://function.invalid/register-with-invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeGateway(overrides: Partial<RegistrationGateway> = {}): RegistrationGateway {
  return {
    lookupInvite: async () => "unused",
    createAccount: async () => ({ state: "created", accountId: "opaque-account" }),
    consumeInvite: async () => "consumed",
    sendSignupConfirmation: async () => "sent",
    deleteAccount: async () => "deleted",
    accountExists: async () => false,
    releaseInvite: async () => "released",
    inviteOwner: async () => null,
    ...overrides,
  };
}

describe("register-with-invite HTTP boundary", () => {
  it("returns a deterministic JSON response when runtime configuration is unavailable", async () => {
    const diagnostics: unknown[] = [];
    const handler = createRegisterWithInviteHandler({
      createGateway: () => null,
      reportDiagnostic: diagnostic => diagnostics.push(diagnostic),
    });

    const response = await handler(request(validPayload));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "registration_unavailable",
      stage: "configuration",
      retryable: false,
    });
    expect(diagnostics).toEqual([{
      event: "register_with_invite_failed",
      status: 503,
      stage: "configuration",
      outcome: "registration_unavailable",
      retryable: false,
    }]);
  });

  it("returns the bounded Auth timeout response through the HTTP boundary", async () => {
    const handler = createRegisterWithInviteHandler({
      createGateway: () => makeGateway({ createAccount: async () => ({ state: "timeout" }) }),
    });

    const response = await handler(request(validPayload));
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      error: "registration_timeout",
      stage: "account_create",
      retryable: true,
    });
  });

  it("returns a safe JSON response when the lifecycle executor throws", async () => {
    const handler = createRegisterWithInviteHandler({
      createGateway: () => makeGateway(),
      executeRegistration: async () => {
        throw new Error("opaque upstream failure");
      },
    });

    const response = await handler(request(validPayload));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "registration_cleanup_required",
      stage: "cleanup",
      retryable: false,
    });
  });
});
