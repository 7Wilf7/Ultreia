import { describe, expect, it } from "vitest";
import {
  executeInviteRegistration,
  registrationFailureDiagnostic,
  SIGNUP_EMAIL_REDIRECT_URL,
  type RegistrationGateway,
} from "./registration.ts";

const testInput = {
  email: "account-input",
  password: "credential-input",
  code: "invite-input",
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
  it("logs only allowlisted failure metadata", () => {
    expect(registrationFailureDiagnostic({
      status: 503,
      body: {
        error: "registration_unavailable",
        stage: "account_create",
        retryable: true,
      },
    })).toEqual({
      event: "register_with_invite_failed",
      status: 503,
      stage: "account_create",
      outcome: "registration_unavailable",
      retryable: true,
    });

    expect(registrationFailureDiagnostic({
      status: 500,
      body: { error: "unrecognized_failure", retryable: false },
    })).toEqual({
      event: "register_with_invite_failed",
      status: 500,
      stage: "unknown",
      outcome: "unexpected",
      retryable: false,
    });
  });

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
      status: 504,
      body: {
        error: "registration_timeout",
        stage: "confirmation_send",
        retryable: true,
      },
    });
    expect(deleteCalls).toBe(1);
    expect(releaseCalls).toBe(1);
  });

  it("returns a determinate timeout boundary when Auth account creation times out", async () => {
    const result = await executeInviteRegistration(
      makeGateway({ createAccount: async () => ({ state: "timeout" }) }),
      testInput,
      new Date("2026-07-24T00:00:00.000Z"),
    );

    expect(result).toEqual({
      status: 504,
      body: {
        error: "registration_timeout",
        stage: "account_create",
        retryable: true,
      },
    });
  });

  it("reports an upstream invite-lookup failure without creating an account", async () => {
    let accountCreateCalls = 0;
    const result = await executeInviteRegistration(
      makeGateway({
        lookupInvite: async () => "failed",
        createAccount: async () => {
          accountCreateCalls += 1;
          return { state: "created", accountId: "opaque-account" };
        },
      }),
      testInput,
      new Date("2026-07-24T00:00:00.000Z"),
    );

    expect(result).toEqual({
      status: 503,
      body: {
        error: "registration_unavailable",
        stage: "invite_lookup",
        retryable: true,
      },
    });
    expect(accountCreateCalls).toBe(0);
  });

  it("rejects a duplicate submission before any Auth call", async () => {
    let accountCreateCalls = 0;
    const result = await executeInviteRegistration(
      makeGateway({
        lookupInvite: async () => "used",
        createAccount: async () => {
          accountCreateCalls += 1;
          return { state: "created", accountId: "opaque-account" };
        },
      }),
      testInput,
      new Date("2026-07-24T00:00:00.000Z"),
    );

    expect(result).toEqual({ status: 400, body: { error: "code_used" } });
    expect(accountCreateCalls).toBe(0);
  });

  it("does not expose an Auth rejection detail", async () => {
    const result = await executeInviteRegistration(
      makeGateway({ createAccount: async () => ({ state: "rejected" }) }),
      testInput,
      new Date("2026-07-24T00:00:00.000Z"),
    );

    expect(result).toEqual({
      status: 422,
      body: {
        error: "account_create_rejected",
        stage: "account_create",
        retryable: false,
      },
    });
  });

  it("reports a retryable Auth request failure without exposing provider detail", async () => {
    const result = await executeInviteRegistration(
      makeGateway({ createAccount: async () => ({ state: "failed" }) }),
      testInput,
      new Date("2026-07-24T00:00:00.000Z"),
    );

    expect(result).toEqual({
      status: 503,
      body: {
        error: "registration_unavailable",
        stage: "account_create",
        retryable: true,
      },
    });
  });

  it("cleans exact ownership before reporting an invite-consume timeout", async () => {
    let released = false;
    const result = await executeInviteRegistration(
      makeGateway({
        consumeInvite: async () => "timeout",
        releaseInvite: async () => {
          released = true;
          return "released";
        },
        inviteOwner: async () => released ? null : "opaque-account",
      }),
      testInput,
      new Date("2026-07-24T00:00:00.000Z"),
    );

    expect(result).toEqual({
      status: 504,
      body: {
        error: "registration_timeout",
        stage: "invite_consume",
        retryable: true,
      },
    });
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
