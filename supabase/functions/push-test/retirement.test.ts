import { describe, expect, it } from "vitest";
import { retiredPushTestResponse } from "./retirement.ts";

describe("push-test retirement contract", () => {
  it("returns a safe terminal response without accepting a target", () => {
    expect(retiredPushTestResponse()).toEqual({
      status: 410,
      body: { error: "function_retired", stage: "retired" },
    });
  });
});
