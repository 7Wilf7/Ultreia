import { describe, expect, it } from "vitest";
import {
  executeInviteRegistration,
  SIGNUP_EMAIL_REDIRECT_URL,
  type RegistrationGateway,
} from "./registration.ts";

const testInput = {
  email: "temporary@invalid.example",
  password: "safe-test-password",
  code: "UL-TESTCODE",
};

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

describe("register-with-invite lifecycle", () => {
  it("succeeds only after invite consumption and confirmation dispatch", async () => {
    let seenRedirect = "";
    const result = await executeInviteRegistration(
      makeGateway({
        sendSignupConfirmation: async (_email, redirectTo) => {
          seenRedirect = redirectTo;
          return "sent";
        },
      }),
      testInput,
      new Date("2026-07-24T00:00:00.000Z"),
    );

    expect(result).toEqual({ status: 200, body: { ok: true, needsEmailVerification: true } });
    expect(seenRedirect).toBe(SIGNUP_EMAIL_REDIRECT_URL);
  });

  it("cleans the created account and restores the invite after a confirmation timeout", async () => {
    let deleteCalls = 0;
    let releaseCalls = 0;
    let inviteOwner: string | null = "opaque-account";
    const result = await executeInviteRegistration(
      makeGateway({
        sendSignupConfirmation: async () => "timeout",
        deleteAccount: async () => {
          deleteCalls += 1;
          return "deleted";
        },
        releaseInvite: async () => {
          releaseCalls += 1;
          inviteOwner = null;
          return "released";
        },
        inviteOwner: async () => inviteOwner,
      }),
      testInput,
      new Date("2026-07-24T00:00:00.000Z"),
    );

    expect(result).toEqual({
      status: 503,
      body: {
        error: "confirmation_send_failed",
        stage: "confirmation_send",
        retryable: true,
      },
    });
    expect(deleteCalls).toBe(1);
    expect(releaseCalls).toBe(1);
  });

  it("uses a bounded exact-account cleanup retry when a delete acknowledgement is indeterminate", async () => {
    let deleteCalls = 0;
    let existenceChecks = 0;
    const result = await executeInviteRegistration(
      makeGateway({
        sendSignupConfirmation: async () => "failed",
        deleteAccount: async () => {
          deleteCalls += 1;
          return "timeout";
        },
        accountExists: async () => {
          existenceChecks += 1;
          return existenceChecks === 1;
        },
      }),
      testInput,
      new Date("2026-07-24T00:00:00.000Z"),
    );

    expect(result.body.error).toBe("confirmation_send_failed");
    expect(deleteCalls).toBe(2);
    expect(existenceChecks).toBe(2);
  });

  it("does not send confirmation when another request consumes the invite first", async () => {
    let confirmationCalls = 0;
    const result = await executeInviteRegistration(
      makeGateway({
        consumeInvite: async () => "unavailable",
        sendSignupConfirmation: async () => {
          confirmationCalls += 1;
          return "sent";
        },
      }),
      testInput,
      new Date("2026-07-24T00:00:00.000Z"),
    );

    expect(result).toEqual({ status: 400, body: { error: "code_used" } });
    expect(confirmationCalls).toBe(0);
  });

  it("fails closed without exposing internal error detail when cleanup cannot be confirmed", async () => {
    const result = await executeInviteRegistration(
      makeGateway({
        sendSignupConfirmation: async () => "failed",
        accountExists: async () => "unknown",
      }),
      testInput,
      new Date("2026-07-24T00:00:00.000Z"),
    );

    expect(result).toEqual({
      status: 500,
      body: {
        error: "registration_cleanup_required",
        stage: "cleanup",
        retryable: false,
      },
    });
  });
});
