import { describe, expect, it } from "vitest";
import { isMissingAuthUser } from "./auth-error.ts";

describe("register-with-invite Auth cleanup confirmation", () => {
  it("recognizes GoTrue's missing-user error code without relying on raw text", () => {
    expect(isMissingAuthUser({ code: "user_not_found" })).toBe(true);
  });

  it("recognizes a missing-user HTTP status", () => {
    expect(isMissingAuthUser({ status: 404, code: "opaque" })).toBe(true);
  });

  it("does not mistake unrelated Auth failures for successful cleanup", () => {
    expect(isMissingAuthUser({ status: 500, code: "unexpected_failure" })).toBe(false);
    expect(isMissingAuthUser({ message: "user not found" })).toBe(false);
  });
});
