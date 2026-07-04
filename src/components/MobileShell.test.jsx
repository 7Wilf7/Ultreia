import { describe, expect, it } from "vitest";
import { getMobilePagerRenderWindow } from "../utils/mobilePager";

describe("MobileShell pager render window", () => {
  it("keeps edge tabs with their only neighbor", () => {
    expect(getMobilePagerRenderWindow(0, 5)).toEqual([0, 1]);
    expect(getMobilePagerRenderWindow(4, 5)).toEqual([3, 4]);
  });

  it("keeps the heavy Calendar and AI Coach pair as a two-pane window", () => {
    expect(getMobilePagerRenderWindow(1, 5)).toEqual([1, 2]);
    expect(getMobilePagerRenderWindow(2, 5)).toEqual([1, 2]);
  });

  it("keeps other middle tabs with immediate neighbors", () => {
    expect(getMobilePagerRenderWindow(3, 5)).toEqual([2, 3, 4]);
  });
});
