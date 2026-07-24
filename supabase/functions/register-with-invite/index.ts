// Invite-gated self-registration.
//
// Public Supabase signup stays disabled. This Function validates a one-time
// invite, creates an unconfirmed Auth user, consumes the invite conditionally,
// and requests the signup confirmation email. Every network call is bounded so
// that confirmation failures can be reported with a stable stage and the
// newly-created account/invite can be reconciled and cleaned.
//
// Auth: runs with Verify JWT = OFF — a registrant has no session yet. Deploy:
//   npx supabase functions deploy register-with-invite --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  type RegistrationGateway,
} from "./registration.ts";
import {
  classifyConfirmationSendError,
  isMissingAuthUser,
} from "./auth-error.ts";
import { createRegisterWithInviteHandler } from "./handler.ts";
import { resolveRegistrationRuntimeConfig } from "./runtime-config.ts";
// The prior 4-second cap was shorter than a cold Auth admin create on the
// hosted path. Eight seconds remains bounded while leaving time for the exact
// account/invite cleanup sequence within the total Function budget.
const REQUEST_TIMEOUT_MS = 8_000;
const FUNCTION_BUDGET_MS = 48_000;

function timeoutError() {
  const error = new Error("request_timed_out");
  error.name = "TimeoutError";
  return error;
}

function isTimeout(error: unknown) {
  return typeof error === "object"
    && error !== null
    && ("name" in error)
    && (error as { name?: string }).name === "TimeoutError";
}

function errorMessage(error: unknown) {
  return typeof error === "object" && error !== null && "message" in error
    ? String((error as { message?: unknown }).message || "")
    : "";
}

function errorStatus(error: unknown) {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  const status = Number((error as { status?: unknown }).status);
  return Number.isInteger(status) ? status : null;
}

function errorState(error: unknown): "failed" | "timeout" {
  return isTimeout(error) ? "timeout" : "failed";
}

function createTimedFetch() {
  const deadline = Date.now() + FUNCTION_BUDGET_MS;
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw timeoutError();

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      Math.min(REQUEST_TIMEOUT_MS, remaining),
    );
    const upstreamSignal = init?.signal;
    const abortFromUpstream = () => controller.abort();
    upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) throw timeoutError();
      throw error;
    } finally {
      clearTimeout(timeoutId);
      upstreamSignal?.removeEventListener("abort", abortFromUpstream);
    }
  };
}

function createGateway(): RegistrationGateway | null {
  const config = resolveRegistrationRuntimeConfig(Deno.env);
  if (!config) return null;

  const db = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: createTimedFetch() },
  });

  return {
    async lookupInvite(code) {
      try {
        const { data, error } = await db
          .from("invite_codes")
          .select("used_by")
          .eq("code", code)
          .maybeSingle();
        if (error) return "failed";
        if (!data) return "missing";
        return data.used_by ? "used" : "unused";
      } catch (error) {
        return errorState(error);
      }
    },

    async createAccount(email, password) {
      try {
        const { data, error } = await db.auth.admin.createUser({
          email,
          password,
          email_confirm: false,
        });
        if (error) {
          const message = errorMessage(error).toLowerCase();
          if ((error as { code?: string }).code === "email_exists" || message.includes("already")) {
            return { state: "email_taken" as const };
          }
          if (message.includes("password")) return { state: "weak_password" as const };
          const status = errorStatus(error);
          if (status === 401 || status === 403) {
            return { state: "credentials_invalid" as const };
          }
          if (status !== null && status >= 400 && status < 500) {
            return { state: "rejected" as const };
          }
          return { state: "failed" as const };
        }
        if (!data?.user?.id) return { state: "failed" as const };
        return { state: "created" as const, accountId: data.user.id };
      } catch (error) {
        return { state: errorState(error) as "failed" | "timeout" };
      }
    },

    async consumeInvite(code, accountId, email, usedAt) {
      try {
        const { data, error } = await db
          .from("invite_codes")
          .update({ used_by: accountId, used_at: usedAt, used_email: email })
          .eq("code", code)
          .is("used_by", null)
          .select("code");
        if (error) return "failed";
        return data && data.length > 0 ? "consumed" : "unavailable";
      } catch (error) {
        return errorState(error);
      }
    },

    async sendSignupConfirmation(email, redirectTo) {
      try {
        const { error } = await db.auth.resend({
          type: "signup",
          email,
          options: { emailRedirectTo: redirectTo },
        });
        return error ? classifyConfirmationSendError(error) : "sent";
      } catch (error) {
        return errorState(error);
      }
    },

    async deleteAccount(accountId) {
      try {
        const { error } = await db.auth.admin.deleteUser(accountId);
        return error ? "failed" : "deleted";
      } catch (error) {
        return errorState(error);
      }
    },

    async accountExists(accountId) {
      try {
        const { data, error } = await db.auth.admin.getUserById(accountId);
        if (data?.user) return true;
        if (!error || isMissingAuthUser(error)) return false;
        return "unknown";
      } catch {
        return "unknown";
      }
    },

    async releaseInvite(code, accountId) {
      try {
        const { data, error } = await db
          .from("invite_codes")
          .update({ used_by: null, used_at: null, used_email: null })
          .eq("code", code)
          .eq("used_by", accountId)
          .select("code");
        if (error) return "failed";
        return data && data.length > 0 ? "released" : "not_owned";
      } catch (error) {
        return errorState(error);
      }
    },

    async inviteOwner(code) {
      try {
        const { data, error } = await db
          .from("invite_codes")
          .select("used_by")
          .eq("code", code)
          .maybeSingle();
        if (error) return "unknown";
        if (!data) return "missing";
        return data.used_by ?? null;
      } catch {
        return "unknown";
      }
    },
  };
}

Deno.serve(createRegisterWithInviteHandler({ createGateway }));
