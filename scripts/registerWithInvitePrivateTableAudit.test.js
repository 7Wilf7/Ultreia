import { describe, expect, it } from "vitest";
import {
  REGISTER_WITH_INVITE_PRIVATE_TABLES,
  buildPrivateTableAuditSql,
  linkedDbQueryInvocation,
  summarizePrivateTableAudit,
} from "./registerWithInvitePrivateTableAudit.mjs";

describe("register-with-invite private-table cleanup audit", () => {
  it("pins the canonical 28-table ownership boundary", () => {
    expect(REGISTER_WITH_INVITE_PRIVATE_TABLES).toHaveLength(28);
    expect(new Set(REGISTER_WITH_INVITE_PRIVATE_TABLES.map(entry => entry.table)).size).toBe(28);
    expect(REGISTER_WITH_INVITE_PRIVATE_TABLES.every(entry => ["id", "user_id"].includes(entry.ownerColumn))).toBe(true);
  });

  it("builds a fixed read-only count for every audited table", () => {
    const sql = buildPrivateTableAuditSql("00000000-0000-4000-8000-000000000000");
    expect((sql.match(/AS table_index/g) ?? [])).toHaveLength(28);
    expect((sql.match(/UNION ALL/g) ?? [])).toHaveLength(27);
    expect(sql).toContain("COUNT(*)::bigint AS row_count");
    expect(sql).not.toContain("DELETE");
    expect(sql).not.toContain("UPDATE");
    expect(sql).not.toContain("INSERT");
  });

  it("uses a query file so the fixed audit never exceeds the Windows command-line limit", () => {
    const invocation = linkedDbQueryInvocation("C:\\temp\\register-audit.sql", true);

    expect(invocation.command).toBe("powershell.exe");
    expect(invocation.args.join(" ")).toContain("--file $env:ULTREIA_REGISTER_AUDIT_SQL_FILE");
    expect(invocation.args.join(" ")).not.toContain("SELECT");
    expect(invocation.environment).toEqual({
      ULTREIA_REGISTER_AUDIT_SQL_FILE: "C:\\temp\\register-audit.sql",
    });
  });

  it("proves a complete zero-result audit without returning row details", () => {
    const summary = summarizePrivateTableAudit(Array.from(
      { length: 28 },
      (_, index) => ({ table_index: index + 1, row_count: 0 }),
    ));

    expect(summary).toEqual({
      auditedTableCount: 28,
      zeroTableCount: 28,
      nonzeroTableCount: 0,
      totalRelatedRowCount: 0,
    });
  });

  it("fails closed when any audited table is missing", () => {
    expect(() => summarizePrivateTableAudit(Array.from(
      { length: 27 },
      (_, index) => ({ table_index: index + 1, row_count: 0 }),
    ))).toThrow("invalid_audit_row_count");
  });
});
