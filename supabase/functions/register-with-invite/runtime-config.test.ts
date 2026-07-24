import { describe, expect, it } from "vitest";
import { resolveRegistrationRuntimeConfig } from "./runtime-config.ts";

function environment(values: Record<string, string | undefined>) {
  return { get: (name: string) => values[name] };
}

describe("register-with-invite runtime configuration", () => {
  it("uses the hosted secret-key map when the legacy key is absent", () => {
    expect(resolveRegistrationRuntimeConfig(environment({
      SUPABASE_URL: "https://project.invalid",
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: "opaque-runtime-key" }),
    }))).toEqual({
      supabaseUrl: "https://project.invalid",
      serviceRoleKey: "opaque-runtime-key",
    });
  });

  it("falls back to the legacy key only when no usable default secret key exists", () => {
    expect(resolveRegistrationRuntimeConfig(environment({
      SUPABASE_URL: "https://project.invalid",
      SUPABASE_SECRET_KEYS: "not-json",
      SUPABASE_SERVICE_ROLE_KEY: "opaque-legacy-key",
    }))).toEqual({
      supabaseUrl: "https://project.invalid",
      serviceRoleKey: "opaque-legacy-key",
    });
  });

  it("fails closed when runtime configuration is incomplete", () => {
    expect(resolveRegistrationRuntimeConfig(environment({
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: "opaque-runtime-key" }),
    }))).toBeNull();
  });
});
