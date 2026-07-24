import {
  executeInviteRegistration,
  registrationFailureDiagnostic,
  type RegistrationFailureDiagnostic,
  type RegistrationGateway,
  type RegistrationResult,
} from "./registration.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type RegistrationExecutor = (
  gateway: RegistrationGateway,
  input: { email: string; password: string; code: string },
  now: Date,
) => Promise<RegistrationResult>;

export type RegisterWithInviteHandlerOptions = {
  createGateway: () => RegistrationGateway | null;
  executeRegistration?: RegistrationExecutor;
  now?: () => Date;
  reportDiagnostic?: (diagnostic: RegistrationFailureDiagnostic) => void;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function registrationResponse(
  result: RegistrationResult,
  reportDiagnostic: (diagnostic: RegistrationFailureDiagnostic) => void,
): Response {
  const diagnostic = registrationFailureDiagnostic(result);
  if (diagnostic) reportDiagnostic(diagnostic);
  return json(result.body, result.status);
}

function unavailableConfiguration(): RegistrationResult {
  return {
    status: 503,
    body: { error: "registration_unavailable", stage: "configuration", retryable: false },
  };
}

function cleanupRequired(): RegistrationResult {
  return {
    status: 500,
    body: { error: "registration_cleanup_required", stage: "cleanup", retryable: false },
  };
}

// Keep all handler exits as JSON responses. In particular, an unexpected
// gateway-factory or lifecycle exception must not turn into a platform-level
// timeout with no safe response boundary.
export function createRegisterWithInviteHandler(options: RegisterWithInviteHandlerOptions) {
  const executeRegistration = options.executeRegistration ?? executeInviteRegistration;
  const now = options.now ?? (() => new Date());
  const reportDiagnostic = options.reportDiagnostic
    ?? ((diagnostic: RegistrationFailureDiagnostic) => console.warn(JSON.stringify(diagnostic)));

  return async (req: Request): Promise<Response> => {
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

    let gateway: RegistrationGateway | null;
    try {
      gateway = options.createGateway();
    } catch {
      return registrationResponse(unavailableConfiguration(), reportDiagnostic);
    }
    if (!gateway) return registrationResponse(unavailableConfiguration(), reportDiagnostic);

    try {
      const result = await executeRegistration(gateway, { email, password, code }, now());
      return registrationResponse(result, reportDiagnostic);
    } catch {
      return registrationResponse(cleanupRequired(), reportDiagnostic);
    }
  };
}
