import { describe, expect, it } from "vitest";
import {
  getMobilePagerJumpWindow,
  getMobilePagerRenderWindow,
  resolveMobilePagerTouchStart,
  shouldOuterPagerHandleSwipe,
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

  it("lets nested swipers keep gestures until their boundary", () => {
    expect(shouldOuterPagerHandleSwipe({
      direction: 1,
      currentTab: 0,
      tabCount: 5,
      innerCanMove: true,
    })).toBe(false);
    expect(shouldOuterPagerHandleSwipe({
      direction: 1,
      currentTab: 0,
      tabCount: 5,
      innerCanMove: false,
    })).toBe(true);
    expect(shouldOuterPagerHandleSwipe({
      direction: -1,
      currentTab: 0,
      tabCount: 5,
      innerCanMove: false,
    })).toBe(false);
  });

  it("starts a new drag from the settle target when the previous settle is interrupted", () => {
    expect(resolveMobilePagerTouchStart({
      visualTab: 2,
      trackLeft: 568,
      width: 400,
      tabCount: 5,
      settleTarget: 2,
    })).toEqual({
      current: 2,
      startLeft: 568,
    });

    expect(resolveMobilePagerTouchStart({
      visualTab: 2,
      trackLeft: 1048,
      width: 400,
      tabCount: 5,
      settleTarget: 2,
    })).toEqual({
      current: 2,
      startLeft: 1048,
    });
  });

  it("uses the aligned visual tab when no settle animation is active", () => {
    expect(resolveMobilePagerTouchStart({
      visualTab: 3,
      trackLeft: 1048,
      width: 400,
      tabCount: 5,
    })).toEqual({
      current: 3,
      startLeft: 1200,
    });
  });
});
