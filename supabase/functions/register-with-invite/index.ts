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
  executeInviteRegistration,
  type RegistrationGateway,
} from "./registration.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// The prior 4-second cap was shorter than a cold Auth admin create on the
// hosted path. Eight seconds remains bounded while leaving time for the exact
// account/invite cleanup sequence within the total Function budget.
const REQUEST_TIMEOUT_MS = 8_000;
const FUNCTION_BUDGET_MS = 48_000;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

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

function isNotFound(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return message.includes("not found") || message.includes("does not exist");
}

function createGateway(): RegistrationGateway | null {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return null;

  const db = createClient(supabaseUrl, serviceRoleKey, {
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
        return error ? "failed" : "sent";
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
        if (!error || isNotFound(error)) return false;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ error: "bad_input" }, 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "bad_input" }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!EMAIL_RE.test(email) || email.length > 320 || !code || code.length > 128) {
    return json({ error: "bad_input" }, 400);
  }
  if (password.length < 6 || password.length > 256) {
    return json({ error: "weak_password" }, 400);
  }

  const gateway = createGateway();
  if (!gateway) {
    return json({ error: "registration_unavailable", stage: "configuration", retryable: false }, 503);
  }

  const result = await executeInviteRegistration(gateway, { email, password, code }, new Date());
  return json(result.body, result.status);
});
