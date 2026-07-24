import { describe, expect, it } from "vitest";
import {
  classifyRequestFailure,
  exactAccountIdsFromRows,
  summarizeFunctionResponse,
} from "./registerWithInviteCanary.mjs";

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

describe("register-with-invite canary transport summaries", () => {
  it("classifies timeout, DNS, TLS, and connection reset without raw errors", () => {
    expect(classifyRequestFailure(new Error("ignored"), true)).toBe("request_timeout");
    expect(classifyRequestFailure({ cause: { code: "ENOTFOUND" } }, false)).toBe("request_dns_failed");
    expect(classifyRequestFailure({ cause: { code: "ERR_TLS_CERT_ALTNAME_INVALID" } }, false))
      .toBe("request_tls_failed");
    expect(classifyRequestFailure({ cause: { code: "UND_ERR_SOCKET" } }, false))
      .toBe("request_connection_reset");
  });

  it("keeps unknown failures non-sensitive", () => {
    expect(classifyRequestFailure({ cause: { code: "provider-detail-not-allowed" } }, false))
      .toBe("request_failed");
  });

  it("accepts only the expected lifecycle response shape", () => {
    expect(summarizeFunctionResponse(200, JSON.stringify({
      ok: true,
      needsEmailVerification: true,
    }))).toEqual({
      responseReceived: true,
      status: 200,
      category: "accepted",
      accepted: true,
    });
    expect(summarizeFunctionResponse(500, JSON.stringify({ error: "provider-detail-not-allowed" })))
      .toEqual({
        responseReceived: true,
        status: 500,
        category: "unexpected",
        accepted: false,
      });
  });
});
