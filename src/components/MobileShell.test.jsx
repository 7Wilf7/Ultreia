import { describe, expect, it } from "vitest";
import {
  getMobilePagerJumpWindow,
  getMobilePagerRenderWindow,
  shouldRenderMobilePagerPane,
} from "../utils/mobilePager";

describe("MobileShell pager render window", () => {
  it("keeps edge tabs with their only neighbor", () => {
    expect(getMobilePagerRenderWindow(0, 5)).toEqual([0, 1]);
    expect(getMobilePagerRenderWindow(4, 5)).toEqual([3, 4]);
  });

  it("keeps middle tabs with immediate neighbors pre-mounted", () => {
    expect(getMobilePagerRenderWindow(1, 5)).toEqual([0, 1, 2]);
    expect(getMobilePagerRenderWindow(2, 5)).toEqual([1, 2, 3]);
  });

  it("keeps other middle tabs with immediate neighbors", () => {
    expect(getMobilePagerRenderWindow(3, 5)).toEqual([2, 3, 4]);
  });

  it("keeps crossed panes mounted for direct bottom-nav jumps", () => {
    expect(getMobilePagerJumpWindow(0, 4, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(getMobilePagerJumpWindow(2, 3, 5)).toEqual([1, 2, 3, 4]);
  });

  it("always renders the visible tab even if the render window is stale", () => {
    expect(shouldRenderMobilePagerPane(3, [0, 1], 3, 0)).toBe(true);
    expect(shouldRenderMobilePagerPane(4, [0, 1], 0, 4)).toBe(true);
    expect(shouldRenderMobilePagerPane(2, [0, 1], 3, 4)).toBe(false);
  });
});
