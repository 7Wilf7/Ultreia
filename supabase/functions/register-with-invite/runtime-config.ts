export type EnvironmentReader = {
  get(name: string): string | undefined;
};

export type RegistrationRuntimeConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
};

function nonEmpty(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || null;
}

function defaultSecretKey(secretKeys: string | undefined) {
  if (!secretKeys) return null;
  try {
    const parsed = JSON.parse(secretKeys);
    return parsed && typeof parsed === "object"
      ? nonEmpty((parsed as Record<string, unknown>).default as string | undefined)
      : null;
  } catch {
    return null;
  }
}

// Hosted Supabase now provides SUPABASE_SECRET_KEYS as the primary secret-key
// source. Keep the legacy variable as a compatibility fallback for projects
// that have not completed the key migration. This function deliberately never
// logs either value.
export function resolveRegistrationRuntimeConfig(
  environment: EnvironmentReader,
): RegistrationRuntimeConfig | null {
  const supabaseUrl = nonEmpty(environment.get("SUPABASE_URL"));
  const serviceRoleKey = defaultSecretKey(environment.get("SUPABASE_SECRET_KEYS"))
    ?? nonEmpty(environment.get("SUPABASE_SERVICE_ROLE_KEY"));

  if (!supabaseUrl || !serviceRoleKey) return null;
  return { supabaseUrl, serviceRoleKey };
}
