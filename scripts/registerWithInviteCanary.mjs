import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { fileURLToPath } from "node:url";
import {
  buildPrivateTableAuditSql,
  runLinkedDbQuery,
  summarizePrivateTableAudit,
} from "./registerWithInvitePrivateTableAudit.mjs";

const FUNCTION_NAME = "register-with-invite";
const MAX_RESPONSE_BODY_BYTES = 16 * 1024;
const RUN_RECORD_DIRECTORY = new URL("../supabase/.temp/", import.meta.url);
const RUN_RECORD_FILE = new URL("../supabase/.temp/register-with-invite-canary-result.json", import.meta.url);
const SAFE_ERROR_CATEGORIES = new Set([
  "bad_input",
  "weak_password",
  "invalid_code",
  "code_used",
  "email_taken",
  "registration_unavailable",
  "registration_timeout",
  "account_create_rejected",
  "registration_cleanup_required",
  "confirmation_send_failed",
  "confirmation_send_rejected",
  "confirmation_rate_limited",
]);
const SAFE_FAILURE_STAGES = new Set([
  "configuration",
  "invite_lookup",
  "account_create",
  "invite_consume",
  "confirmation_send",
  "cleanup",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorCode(error) {
  if (typeof error !== "object" || error === null) return "";
  const direct = "code" in error ? error.code : undefined;
  if (typeof direct === "string") return direct;
  const cause = "cause" in error ? error.cause : undefined;
  return typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : "";
}

// The production summary deliberately classifies transport failures without
// retaining the raw Node/Undici error, URL, request body, or credentials.
export function classifyRequestFailure(error, timedOut) {
  if (timedOut) return "request_timeout";
  const code = errorCode(error);
  if (code === "ECONNRESET" || code === "ECONNABORTED" || code === "UND_ERR_SOCKET") {
    return "request_connection_reset";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "request_dns_failed";
  if (code.startsWith("ERR_TLS") || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
    return "request_tls_failed";
  }
  return "request_failed";
}

// Project-level 4xx/5xx bodies are parsed only into the existing allowlist.
// The raw body is discarded immediately so an unexpected gateway response
// cannot be persisted by the production canary.
export function summarizeFunctionResponse(status, rawBody) {
  let parsed = null;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    // The status remains safe to report even if a gateway returned no JSON.
  }
  const error = typeof parsed?.error === "string" && SAFE_ERROR_CATEGORIES.has(parsed.error)
    ? parsed.error
    : "unexpected";
  const accepted = status === 200
    && parsed?.ok === true
    && parsed?.needsEmailVerification === true;
  const stage = typeof parsed?.stage === "string" && SAFE_FAILURE_STAGES.has(parsed.stage)
    ? parsed.stage
    : null;
  const retryable = typeof parsed?.retryable === "boolean" ? parsed.retryable : null;
  return {
    responseReceived: true,
    status,
    category: accepted ? "accepted" : error,
    stage,
    retryable,
    accepted,
  };
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function integer(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function readEnvValue(text, name) {
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1 || line.slice(0, separator).trim() !== name) continue;
    const raw = line.slice(separator + 1).trim();
    if ((raw.startsWith("\"") && raw.endsWith("\"")) || (raw.startsWith("'") && raw.endsWith("'"))) {
      return raw.slice(1, -1);
    }
    return raw;
  }
  return "";
}

async function functionConfiguration() {
  const envFile = await readFile(new URL("../.env.local", import.meta.url), "utf8");
  const url = readEnvValue(envFile, "VITE_SUPABASE_URL").replace(/\/+$/, "");
  const apiKey = readEnvValue(envFile, "VITE_SUPABASE_ANON_KEY");
  if (!url || !apiKey) throw new Error("function_configuration_unavailable");
  return { url: `${url}/functions/v1/${FUNCTION_NAME}`, apiKey };
}

async function invokeOnce(configuration, body, timeoutMs) {
  const url = new URL(configuration.url);
  const payload = JSON.stringify(body);
  return new Promise(resolve => {
    let settled = false;
    let timedOut = false;
    let timeoutId = null;
    const settle = result => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      resolve(result);
    };
    let request;
    try {
      request = httpsRequest({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        agent: false,
        headers: {
          Authorization: `Bearer ${configuration.apiKey}`,
          apikey: configuration.apiKey,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          Connection: "close",
        },
      }, response => {
        let bodyText = "";
        let bodyBytes = 0;
        response.setEncoding("utf8");
        response.on("data", chunk => {
          bodyBytes += Buffer.byteLength(chunk);
          if (bodyBytes > MAX_RESPONSE_BODY_BYTES) {
            response.destroy();
            settle(summarizeFunctionResponse(response.statusCode ?? 0, ""));
            return;
          }
          bodyText += chunk;
        });
        response.once("error", error => {
          settle({
          responseReceived: false,
          status: null,
          category: classifyRequestFailure(error, timedOut),
          stage: null,
          retryable: null,
          accepted: false,
          });
        });
        response.once("end", () => settle(summarizeFunctionResponse(response.statusCode ?? 0, bodyText)));
      });
    } catch (error) {
      settle({
        responseReceived: false,
        status: null,
        category: classifyRequestFailure(error, false),
        stage: null,
        retryable: null,
        accepted: false,
      });
      return;
    }
    timeoutId = setTimeout(() => {
      timedOut = true;
      request.destroy();
    }, timeoutMs);
    request.setTimeout(timeoutMs, () => {
      timedOut = true;
      request.destroy();
    });
    request.once("error", error => {
      settle({
        responseReceived: false,
        status: null,
        category: classifyRequestFailure(error, timedOut),
        stage: null,
        retryable: null,
        accepted: false,
      });
    });
    request.end(payload);
  });
}

async function oneCount(sql) {
  const rows = await runLinkedDbQuery(sql);
  if (rows.length !== 1) throw new Error("invalid_count_result");
  const count = integer(rows[0].row_count);
  if (count === null || count < 0) throw new Error("invalid_count_result");
  return count;
}

export function exactAccountIdsFromRows(rows) {
  if (rows.length !== 1) throw new Error("invalid_account_lookup");
  const accountCount = integer(rows[0].account_count);
  if (accountCount === 0) return [];
  if (
    accountCount !== 1
    || typeof rows[0].account_id !== "string"
    || !UUID_RE.test(rows[0].account_id)
  ) {
    throw new Error("invalid_account_lookup");
  }
  return [rows[0].account_id];
}

async function exactAccountIds(email) {
  const rows = await runLinkedDbQuery(
    `SELECT COUNT(*)::bigint AS account_count, MIN(id::text) AS account_id ` +
    `FROM auth.users WHERE email = ${sqlLiteral(email)}`,
  );
  return exactAccountIdsFromRows(rows);
}

async function checkpoint(result, phase) {
  try {
    await mkdir(RUN_RECORD_DIRECTORY, { recursive: true });
    await writeFile(RUN_RECORD_FILE, `${JSON.stringify({ ...result, checkpoint: phase })}\n`, "utf8");
    result.recording_state = "recorded";
  } catch {
    result.recording_state = "unavailable";
  }
}

async function print(result) {
  await checkpoint(result, "final");
  return new Promise(resolve => {
    process.stdout.write(`${JSON.stringify(result)}\n`, resolve);
  });
}

async function runDiagnosis() {
  const configuration = await functionConfiguration();
  const response = await invokeOnce(configuration, { probe: "response" }, 15_000);
  const passed = response.responseReceived && response.status === 400 && response.category === "bad_input";
  await print({
    mode: "diagnosis",
    function_request_count: 1,
    response_received: response.responseReceived,
    response_status: response.status,
    response_category: response.category,
    response_stage: response.stage,
    response_retryable: response.retryable,
    passed,
  });
  if (!passed) process.exitCode = 1;
}

async function runLifecycle() {
  const configuration = await functionConfiguration();
  const nonce = randomUUID().replaceAll("-", "");
  const email = `canary-${nonce}@example.invalid`;
  const password = `Canary-${randomUUID()}-A9`;
  const code = `REG-${nonce.slice(0, 24)}`;
  const result = {
    mode: "lifecycle",
    function_request_count: 0,
    response_received: false,
    response_status: null,
    response_category: "not_run",
    response_stage: null,
    response_retryable: null,
    auth_before_count: null,
    auth_observed_after_count: null,
    invite_before_count: null,
    invite_consumed_after_count: null,
    auth_after_cleanup_count: null,
    invite_after_cleanup_count: null,
    private_table_audit: null,
    recording_state: "pending",
    passed: false,
  };
  let inviteCreated = false;
  let accountId = null;

  try {
    await checkpoint(result, "started");
    result.auth_before_count = (await exactAccountIds(email)).length;
    if (result.auth_before_count !== 0) throw new Error("unexpected_account_collision");

    await runLinkedDbQuery(
      `INSERT INTO public.invite_codes (code, note) VALUES (${sqlLiteral(code)}, 'register_with_invite_canary')`,
    );
    inviteCreated = true;
    result.invite_before_count = await oneCount(
      `SELECT COUNT(*)::bigint AS row_count FROM public.invite_codes WHERE code = ${sqlLiteral(code)}`,
    );
    if (result.invite_before_count !== 1) throw new Error("invite_create_unverified");
    await checkpoint(result, "invite_verified");

    result.function_request_count = 1;
    const response = await invokeOnce(configuration, { email, password, code }, 55_000);
    result.response_received = response.responseReceived;
    result.response_status = response.status;
    result.response_category = response.category;
    result.response_stage = response.stage;
    result.response_retryable = response.retryable;

    const accountIds = await exactAccountIds(email);
    result.auth_observed_after_count = accountIds.length;
    if (accountIds.length === 1) accountId = accountIds[0];
    result.invite_consumed_after_count = await oneCount(
      `SELECT COUNT(*)::bigint AS row_count FROM public.invite_codes WHERE code = ${sqlLiteral(code)} AND used_by IS NOT NULL`,
    );
    await checkpoint(result, "function_completed");
  } catch {
    result.response_category = result.function_request_count === 0 ? "setup_failed" : result.response_category;
    await checkpoint(result, "execution_interrupted");
  } finally {
    await checkpoint(result, "cleanup_started");
    if (accountId) {
      try {
        await runLinkedDbQuery(`DELETE FROM auth.users WHERE id = ${sqlLiteral(accountId)}::uuid`);
      } catch {
        // Cleanup verification below determines whether this remains a failure.
      }
      try {
        result.auth_after_cleanup_count = (await exactAccountIds(email)).length;
      } catch {
        result.auth_after_cleanup_count = null;
      }
    }

    if (inviteCreated) {
      try {
        await runLinkedDbQuery(`DELETE FROM public.invite_codes WHERE code = ${sqlLiteral(code)}`);
      } catch {
        // Cleanup verification below determines whether this remains a failure.
      }
      try {
        result.invite_after_cleanup_count = await oneCount(
          `SELECT COUNT(*)::bigint AS row_count FROM public.invite_codes WHERE code = ${sqlLiteral(code)}`,
        );
      } catch {
        result.invite_after_cleanup_count = null;
      }
    }

    await checkpoint(result, "cleanup_completed");

    if (accountId && result.auth_after_cleanup_count === 0) {
      try {
        const audit = summarizePrivateTableAudit(
          await runLinkedDbQuery(buildPrivateTableAuditSql(accountId)),
        );
        result.private_table_audit = {
          audited_table_count: audit.auditedTableCount,
          zero_table_count: audit.zeroTableCount,
          nonzero_table_count: audit.nonzeroTableCount,
          total_related_row_count: audit.totalRelatedRowCount,
        };
      } catch {
        result.private_table_audit = { audit_error: "cleanup_audit_unavailable" };
      }
    }

    await checkpoint(result, "audit_completed");

    result.passed = result.function_request_count === 1
      && result.response_received === true
      && result.response_status === 200
      && result.response_category === "accepted"
      && result.auth_before_count === 0
      && result.auth_observed_after_count === 1
      && result.invite_before_count === 1
      && result.invite_consumed_after_count === 1
      && result.auth_after_cleanup_count === 0
      && result.invite_after_cleanup_count === 0
      && result.private_table_audit?.audited_table_count === 28
      && result.private_table_audit?.zero_table_count === 28
      && result.private_table_audit?.nonzero_table_count === 0
      && result.private_table_audit?.total_related_row_count === 0;
    await print(result);
    if (!result.passed) process.exitCode = 1;
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode === "diagnosis") return runDiagnosis();
  if (mode === "lifecycle") return runLifecycle();
  throw new Error("invalid_canary_mode");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(async () => {
    await print({ mode: "unknown", canary_error: "canary_unavailable", passed: false });
    process.exitCode = 1;
  });
}
