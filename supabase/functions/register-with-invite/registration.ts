export const SIGNUP_EMAIL_REDIRECT_URL = "https://ultreia.run/";

export type RegistrationStage =
  | "configuration"
  | "invite_lookup"
  | "account_create"
  | "invite_consume"
  | "confirmation_send"
  | "cleanup";

export type RegistrationResult = {
  status: number;
  body: {
    ok?: true;
    needsEmailVerification?: true;
    error?: string;
    stage?: RegistrationStage;
    retryable?: boolean;
  };
};

export type RegistrationFailureDiagnostic = {
  event: "register_with_invite_failed";
  status: number;
  stage: RegistrationStage | "unknown";
  outcome:
    | "invalid_code"
    | "code_used"
    | "email_taken"
    | "weak_password"
    | "registration_unavailable"
    | "registration_timeout"
    | "account_create_rejected"
    | "registration_cleanup_required"
    | "confirmation_send_failed"
    | "unexpected";
  retryable: boolean;
};

const DIAGNOSTIC_STAGES = new Set<RegistrationStage>([
  "configuration",
  "invite_lookup",
  "account_create",
  "invite_consume",
  "confirmation_send",
  "cleanup",
]);

const DIAGNOSTIC_OUTCOMES = new Set<Exclude<RegistrationFailureDiagnostic["outcome"], "unexpected">>([
  "invalid_code",
  "code_used",
  "email_taken",
  "weak_password",
  "registration_unavailable",
  "registration_timeout",
  "account_create_rejected",
  "registration_cleanup_required",
  "confirmation_send_failed",
]);

// This is the only diagnostic projection the deployed handler may log. It
// intentionally rejects arbitrary error text so dashboard logs cannot retain
// request data, Auth/provider messages, or identifiers.
export function registrationFailureDiagnostic(
  result: RegistrationResult,
): RegistrationFailureDiagnostic | null {
  if (result.status < 400) return null;

  const stage = result.body.stage && DIAGNOSTIC_STAGES.has(result.body.stage)
    ? result.body.stage
    : "unknown";
  const outcome = result.body.error && DIAGNOSTIC_OUTCOMES.has(
    result.body.error as Exclude<RegistrationFailureDiagnostic["outcome"], "unexpected">,
  )
    ? result.body.error as RegistrationFailureDiagnostic["outcome"]
    : "unexpected";

  return {
    event: "register_with_invite_failed",
    status: result.status,
    stage,
    outcome,
    retryable: result.body.retryable === true,
  };
}

export type RegistrationGateway = {
  lookupInvite(code: string): Promise<"unused" | "used" | "missing" | "failed" | "timeout">;
  createAccount(
    email: string,
    password: string,
  ): Promise<
    | { state: "created"; accountId: string }
    | {
      state:
        | "email_taken"
        | "weak_password"
        | "rejected"
        | "credentials_invalid"
        | "failed"
        | "timeout";
    }
  >;
  consumeInvite(
    code: string,
    accountId: string,
    email: string,
    usedAt: string,
  ): Promise<"consumed" | "unavailable" | "failed" | "timeout">;
  sendSignupConfirmation(
    email: string,
    redirectTo: string,
  ): Promise<"sent" | "failed" | "timeout">;
  deleteAccount(accountId: string): Promise<"deleted" | "failed" | "timeout">;
  accountExists(accountId: string): Promise<boolean | "unknown">;
  releaseInvite(
    code: string,
    accountId: string,
  ): Promise<"released" | "not_owned" | "failed" | "timeout">;
  inviteOwner(code: string): Promise<string | null | "missing" | "unknown">;
};

function failure(
  error: string,
  stage: RegistrationStage,
  status: number,
  retryable: boolean,
): RegistrationResult {
  return { status, body: { error, stage, retryable } };
}

function gatewayFailure(
  stage: RegistrationStage,
  state: "failed" | "timeout",
): RegistrationResult {
  return state === "timeout"
    ? failure("registration_timeout", stage, 504, true)
    : failure("registration_unavailable", stage, 503, true);
}

async function safely<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await operation();
  } catch {
    return fallback;
  }
}

async function deleteAccountAndConfirm(
  gateway: RegistrationGateway,
  accountId: string,
): Promise<boolean> {
  // An ambiguous admin delete response is never treated as proof of cleanup.
  // Both attempts use the exact newly-created account and reconcile with a
  // direct read before the invite can be released.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await safely(() => gateway.deleteAccount(accountId), "failed" as const);
    const exists = await safely(() => gateway.accountExists(accountId), "unknown" as const);
    if (exists === false) return true;
  }
  return false;
}

async function releaseInviteAndConfirm(
  gateway: RegistrationGateway,
  code: string,
  accountId: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const ownerBefore = await safely(() => gateway.inviteOwner(code), "unknown" as const);
    if (ownerBefore === null || ownerBefore === "missing") return true;
    // The account has already been confirmed absent. If the invite belongs to
    // someone else, it is not a residue of this attempt and must never be
    // altered by this cleanup path.
    if (ownerBefore !== accountId) return true;

    await safely(() => gateway.releaseInvite(code, accountId), "failed" as const);
    const ownerAfter = await safely(() => gateway.inviteOwner(code), "unknown" as const);
    if (ownerAfter === null || ownerAfter === "missing") return true;
    if (ownerAfter !== accountId) return true;
  }
  return false;
}

async function cleanUpCreatedAccount(
  gateway: RegistrationGateway,
  code: string,
  accountId: string,
  releaseInvite: boolean,
): Promise<boolean> {
  const accountDeleted = await deleteAccountAndConfirm(gateway, accountId);
  if (!accountDeleted) return false;
  return releaseInvite
    ? releaseInviteAndConfirm(gateway, code, accountId)
    : true;
}

export async function executeInviteRegistration(
  gateway: RegistrationGateway,
  input: { email: string; password: string; code: string },
  now: Date,
): Promise<RegistrationResult> {
  const inviteState = await safely(() => gateway.lookupInvite(input.code), "failed" as const);
  if (inviteState === "missing") return { status: 400, body: { error: "invalid_code" } };
  if (inviteState === "used") return { status: 400, body: { error: "code_used" } };
  if (inviteState !== "unused") {
    return gatewayFailure("invite_lookup", inviteState);
  }

  const created = await safely(
    () => gateway.createAccount(input.email, input.password),
    { state: "failed" } as const,
  );
  if (created.state === "email_taken") return { status: 400, body: { error: "email_taken" } };
  if (created.state === "weak_password") return { status: 400, body: { error: "weak_password" } };
  if (created.state === "credentials_invalid") {
    return failure("registration_unavailable", "configuration", 503, false);
  }
  if (created.state === "rejected") {
    return failure("account_create_rejected", "account_create", 422, false);
  }
  if (created.state !== "created") {
    return gatewayFailure("account_create", created.state);
  }

  const consumeState = await safely(
    () => gateway.consumeInvite(input.code, created.accountId, input.email, now.toISOString()),
    "failed" as const,
  );
  if (consumeState !== "consumed") {
    // If the conditional consume may have applied before its response was
    // interrupted, release only a row still owned by this exact account. A
    // normal lost race never owns the invite, so it only needs account cleanup.
    const cleaned = await cleanUpCreatedAccount(
      gateway,
      input.code,
      created.accountId,
      consumeState !== "unavailable",
    );
    if (!cleaned) return failure("registration_cleanup_required", "cleanup", 500, false);
    if (consumeState === "unavailable") return { status: 400, body: { error: "code_used" } };
    return gatewayFailure("invite_consume", consumeState);
  }

  const confirmationState = await safely(
    () => gateway.sendSignupConfirmation(input.email, SIGNUP_EMAIL_REDIRECT_URL),
    "failed" as const,
  );
  if (confirmationState === "sent") {
    return { status: 200, body: { ok: true, needsEmailVerification: true } };
  }

  // A confirmation request that fails or reaches its bounded timeout must not
  // strand an unconfirmed account or permanently consume the invitation.
  const cleaned = await cleanUpCreatedAccount(gateway, input.code, created.accountId, true);
  if (!cleaned) return failure("registration_cleanup_required", "cleanup", 500, false);
  return confirmationState === "timeout"
    ? gatewayFailure("confirmation_send", confirmationState)
    : failure("confirmation_send_failed", "confirmation_send", 503, true);
}
