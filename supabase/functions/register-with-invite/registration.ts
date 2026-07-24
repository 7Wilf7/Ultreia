export const SIGNUP_EMAIL_REDIRECT_URL = "https://ultreia.run/";

export type RegistrationStage =
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

export type RegistrationGateway = {
  lookupInvite(code: string): Promise<"unused" | "used" | "missing" | "failed" | "timeout">;
  createAccount(
    email: string,
    password: string,
  ): Promise<
    | { state: "created"; accountId: string }
    | { state: "email_taken" | "weak_password" | "failed" | "timeout" }
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
    return failure("registration_unavailable", "invite_lookup", 503, true);
  }

  const created = await safely(
    () => gateway.createAccount(input.email, input.password),
    { state: "failed" } as const,
  );
  if (created.state === "email_taken") return { status: 400, body: { error: "email_taken" } };
  if (created.state === "weak_password") return { status: 400, body: { error: "weak_password" } };
  if (created.state !== "created") {
    return failure("registration_unavailable", "account_create", 503, true);
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
    return { status: 400, body: { error: "code_used" } };
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
  return failure("confirmation_send_failed", "confirmation_send", 503, true);
}
