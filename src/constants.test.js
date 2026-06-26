import { describe, expect, it } from "vitest";
import { getHyroxSubtypesForGender } from "./constants";

describe("HYROX division options", () => {
  it("hides women's divisions for male profiles while keeping mixed divisions", () => {
    const options = getHyroxSubtypesForGender("male");

    expect(options).toContain("Men Doubles Pro");
    expect(options).toContain("Men Relay");
    expect(options).toContain("Mixed Doubles");
    expect(options).toContain("Mixed Relay");
    expect(options).not.toContain("Women Open");
    expect(options).not.toContain("Women Doubles");
    expect(options).not.toContain("Women Doubles Pro");
    expect(options).not.toContain("Women Relay");
  });

  it("hides men's divisions for female profiles while keeping mixed divisions", () => {
    const options = getHyroxSubtypesForGender("female");

    expect(options).toContain("Women Doubles Pro");
    expect(options).toContain("Women Relay");
    expect(options).toContain("Mixed Doubles");
    expect(options).toContain("Mixed Relay");
    expect(options).not.toContain("Men Open");
    expect(options).not.toContain("Men Doubles");
    expect(options).not.toContain("Men Doubles Pro");
    expect(options).not.toContain("Men Relay");
  });

  it("keeps the current stored subtype visible for legacy records", () => {
    expect(getHyroxSubtypesForGender("male", "Relay")[0]).toBe("Relay");
    expect(getHyroxSubtypesForGender("male", "Women Doubles")[0]).toBe("Women Doubles");
  });
});
