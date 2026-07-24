import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  buildPrivateTableAuditSql,
  runLinkedDbQuery,
  summarizePrivateTableAudit,
} from "./registerWithInvitePrivateTableAudit.mjs";

const FUNCTION_NAME = "register-with-invite";
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
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(configuration.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${configuration.apiKey}`,
        apikey: configuration.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let parsed = null;
    try {
      parsed = await response.json();
    } catch {
      // The status remains safe to report even if a gateway returned no JSON.
    }
    const error = typeof parsed?.error === "string" && SAFE_ERROR_CATEGORIES.has(parsed.error)
      ? parsed.error
      : "unexpected";
    const accepted = response.status === 200
      && parsed?.ok === true
      && parsed?.needsEmailVerification === true;
    return {
      responseReceived: true,
      status: response.status,
      category: accepted ? "accepted" : error,
      accepted,
    };
  } catch {
    return {
      responseReceived: false,
      status: null,
      category: controller.signal.aborted ? "request_timeout" : "request_failed",
      accepted: false,
    };
  } finally {
    clearTimeout(timeoutId);
  }
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

function print(result) {
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
    auth_before_count: null,
    auth_observed_after_count: null,
    invite_before_count: null,
    invite_consumed_after_count: null,
    auth_after_cleanup_count: null,
    invite_after_cleanup_count: null,
    private_table_audit: null,
    passed: false,
  };
  let inviteCreated = false;
  let accountId = null;

  try {
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

    result.function_request_count = 1;
    const response = await invokeOnce(configuration, { email, password, code }, 55_000);
    result.response_received = response.responseReceived;
    result.response_status = response.status;
    result.response_category = response.category;

    const accountIds = await exactAccountIds(email);
    result.auth_observed_after_count = accountIds.length;
    if (accountIds.length === 1) accountId = accountIds[0];
    result.invite_consumed_after_count = await oneCount(
      `SELECT COUNT(*)::bigint AS row_count FROM public.invite_codes WHERE code = ${sqlLiteral(code)} AND used_by IS NOT NULL`,
    );
  } catch {
    result.response_category = result.function_request_count === 0 ? "setup_failed" : result.response_category;
  } finally {
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
