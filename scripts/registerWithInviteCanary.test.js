import { describe, expect, it } from "vitest";
import { exactAccountIdsFromRows } from "./registerWithInviteCanary.mjs";

describe("register-with-invite canary account lookup", () => {
  it("accepts the aggregate zero-account shape without exposing an identifier", () => {
    expect(exactAccountIdsFromRows([{ account_count: 0, account_id: null }])).toEqual([]);
  });

  it("accepts exactly one temporary account only", () => {
    expect(exactAccountIdsFromRows([{
      account_count: 1,
      account_id: "00000000-0000-4000-8000-000000000000",
    }])).toEqual(["00000000-0000-4000-8000-000000000000"]);
  });

  it("fails closed for an ambiguous lookup", () => {
    expect(() => exactAccountIdsFromRows([{
      account_count: 2,
      account_id: "00000000-0000-4000-8000-000000000000",
    }])).toThrow("invalid_account_lookup");
  });
});
