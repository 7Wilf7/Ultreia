function errorStatus(error: unknown) {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  const status = Number((error as { status?: unknown }).status);
  return Number.isInteger(status) ? status : null;
}

function errorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) return "";
  return String((error as { code?: unknown }).code ?? "").toLowerCase();
}

// GoTrue returns user_not_found for an already-deleted account. Treat the
// status/code as the only contract. No raw error is kept or logged by this
// helper.
export function isMissingAuthUser(error: unknown) {
  const status = errorStatus(error);
  const code = errorCode(error);
  return status === 404 || code === "user_not_found";
}

// Confirmation delivery errors are projected into a tiny stable set. The
// Function never returns or logs the upstream message, recipient, URL, or
// provider detail.
export function classifyConfirmationSendError(error: unknown) {
  const status = errorStatus(error);
  const code = errorCode(error);
  if (status === 429 || code === "over_email_send_rate_limit") return "rate_limited";
  if (
    code === "validation_failed"
    || code === "email_address_invalid"
    || code === "email_address_not_authorized"
    || code === "email_provider_disabled"
    || (status !== null && status >= 400 && status < 500 && status !== 401 && status !== 403)
  ) {
    return "rejected";
  }
  return "failed";
}
