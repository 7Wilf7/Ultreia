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
