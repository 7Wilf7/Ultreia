import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Canonical Phase 2 cleanup boundary. Keep this fixed inventory in Ultreia so
// production verification never depends on a dynamic foreign-key crawl.
export const REGISTER_WITH_INVITE_PRIVATE_TABLES = Object.freeze([
  { table: "agent_actions", ownerColumn: "user_id" },
  { table: "ai_jobs", ownerColumn: "user_id" },
  { table: "coach_memory_facts", ownerColumn: "user_id" },
  { table: "coach_messages", ownerColumn: "user_id" },
  { table: "coach_reports", ownerColumn: "user_id" },
  { table: "daily_notes", ownerColumn: "user_id" },
  { table: "profiles", ownerColumn: "id" },
  { table: "push_getui_devices", ownerColumn: "user_id" },
  { table: "push_inbox", ownerColumn: "user_id" },
  { table: "push_subscriptions", ownerColumn: "user_id" },
  { table: "races", ownerColumn: "user_id" },
  { table: "training_locations", ownerColumn: "user_id" },
  { table: "user_settings", ownerColumn: "user_id" },
  { table: "workouts", ownerColumn: "user_id" },
  { table: "viatica_accounts", ownerColumn: "user_id" },
  { table: "viatica_budgets", ownerColumn: "user_id" },
  { table: "viatica_preference_items", ownerColumn: "user_id" },
  { table: "viatica_preferences", ownerColumn: "user_id" },
  { table: "viatica_projects", ownerColumn: "user_id" },
  { table: "viatica_transactions", ownerColumn: "user_id" },
  { table: "sidera_agent_actions", ownerColumn: "user_id" },
  { table: "sidera_deleted", ownerColumn: "user_id" },
  { table: "sidera_entries", ownerColumn: "user_id" },
  { table: "sidera_links", ownerColumn: "user_id" },
  { table: "sidera_messages", ownerColumn: "user_id" },
  { table: "sidera_nodes", ownerColumn: "user_id" },
  { table: "sidera_preferences", ownerColumn: "user_id" },
  { table: "sidera_reviews", ownerColumn: "user_id" },
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll("\"", "\"\"")}"`;
}

function validTargetUserId(targetUserId) {
  return typeof targetUserId === "string" && UUID_RE.test(targetUserId);
}

// One fixed, read-only COUNT per audited table. The output intentionally uses
// numeric indexes, rather than table names or row values, so production output
// can prove the whole boundary without exposing schema or account details.
export function buildPrivateTableAuditSql(targetUserId) {
  if (!validTargetUserId(targetUserId)) throw new Error("invalid_audit_target");
  const literal = targetUserId.toLowerCase();
  const statements = REGISTER_WITH_INVITE_PRIVATE_TABLES.map(({ table, ownerColumn }, index) => (
    `SELECT ${index + 1}::integer AS table_index, COUNT(*)::bigint AS row_count ` +
    `FROM public.${quoteIdentifier(table)} ` +
    `WHERE ${quoteIdentifier(ownerColumn)} = '${literal}'::uuid`
  ));
  return `${statements.join(" UNION ALL ")} ORDER BY table_index`;
}

function integer(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function summarizePrivateTableAudit(rows) {
  if (!Array.isArray(rows) || rows.length !== REGISTER_WITH_INVITE_PRIVATE_TABLES.length) {
    throw new Error("invalid_audit_row_count");
  }

  const seenIndexes = new Set();
  let zeroTableCount = 0;
  let nonzeroTableCount = 0;
  let totalRelatedRowCount = 0;

  for (const row of rows) {
    const tableIndex = integer(row?.table_index);
    const rowCount = integer(row?.row_count);
    if (
      tableIndex === null
      || rowCount === null
      || tableIndex < 1
      || tableIndex > REGISTER_WITH_INVITE_PRIVATE_TABLES.length
      || rowCount < 0
      || seenIndexes.has(tableIndex)
    ) {
      throw new Error("invalid_audit_row");
    }
    seenIndexes.add(tableIndex);
    totalRelatedRowCount += rowCount;
    if (rowCount === 0) zeroTableCount += 1;
    else nonzeroTableCount += 1;
  }

  if (seenIndexes.size !== REGISTER_WITH_INVITE_PRIVATE_TABLES.length) {
    throw new Error("incomplete_audit_rows");
  }

  return {
    auditedTableCount: REGISTER_WITH_INVITE_PRIVATE_TABLES.length,
    zeroTableCount,
    nonzeroTableCount,
    totalRelatedRowCount,
  };
}

function firstJsonObject(text) {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (start < 0) {
      if (character === "{") {
        start = index;
        depth = 1;
      }
      continue;
    }
    if (inString) {
      if (escaping) escaping = false;
      else if (character === "\\") escaping = true;
      else if (character === "\"") inString = false;
      continue;
    }
    if (character === "\"") inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

// Keep SQL out of the native Windows command line. The fixed 28-table query
// exceeds its length ceiling once PowerShell expands an environment variable.
// The query file is local, short-lived, and removed after the CLI returns.
export function linkedDbQueryInvocation(queryFile, windows = process.platform === "win32") {
  if (typeof queryFile !== "string" || !queryFile) throw new Error("invalid_query_file");
  if (windows) {
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "& npx.cmd supabase db query --file $env:ULTREIA_REGISTER_AUDIT_SQL_FILE --linked --output-format json --log-level error",
      ],
      environment: { ULTREIA_REGISTER_AUDIT_SQL_FILE: queryFile },
    };
  }
  return {
    command: "npx",
    args: [
      "supabase",
      "db",
      "query",
      "--file",
      queryFile,
      "--linked",
      "--output-format",
      "json",
      "--log-level",
      "error",
    ],
    environment: null,
  };
}

// The Supabase CLI may exit non-zero after a successful query because optional
// telemetry shutdown timed out. Accept only a fully parseable rows payload;
// otherwise fail closed without forwarding CLI output.
export async function runLinkedDbQuery(sql) {
  const queryDirectory = await mkdtemp(join(tmpdir(), "ultreia-register-audit-"));
  const queryFile = join(queryDirectory, "query.sql");
  try {
    await writeFile(queryFile, sql, { encoding: "utf8", mode: 0o600 });
    const invocation = linkedDbQueryInvocation(queryFile);
    const result = await new Promise((resolve, reject) => {
      const child = spawn(invocation.command, invocation.args, {
        cwd: process.cwd(),
        env: invocation.environment
          ? { ...process.env, ...invocation.environment }
          : process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", chunk => { stdout += chunk; });
      child.once("error", () => reject(new Error("database_query_unavailable")));
      child.once("close", exitCode => resolve({ exitCode, stdout }));
    });

    const json = firstJsonObject(result.stdout);
    if (!json) throw new Error("database_query_unavailable");
    try {
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed?.rows)) throw new Error("database_query_unavailable");
      return parsed.rows;
    } catch {
      throw new Error("database_query_unavailable");
    }
  } finally {
    try {
      await rm(queryDirectory, { recursive: true, force: true });
    } catch {
      // A local temporary-file cleanup failure must not expose query contents.
    }
  }
}

async function main() {
  const targetUserId = process.env.ULTREIA_CLEANUP_AUDIT_USER_ID ?? "";
  const rows = await runLinkedDbQuery(buildPrivateTableAuditSql(targetUserId));
  const summary = summarizePrivateTableAudit(rows);
  process.stdout.write(`${JSON.stringify({
    audited_table_count: summary.auditedTableCount,
    zero_table_count: summary.zeroTableCount,
    nonzero_table_count: summary.nonzeroTableCount,
    total_related_row_count: summary.totalRelatedRowCount,
  })}\n`);
  if (summary.nonzeroTableCount !== 0) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(() => {
    process.stdout.write('{"audit_error":"cleanup_audit_unavailable"}\n');
    process.exitCode = 1;
  });
}
