import { describe, expect, it } from "vitest";
import {
  getMobilePagerJumpWindow,
  getMobilePagerPreheatQueue,
  getMobilePagerRenderWindow,
  getMobilePagerTapWindow,
  isMobilePagerTouching,
  mergeTabWindows,
  resolveMobilePagerTouchStart,
  shouldReuseMobilePagerPane,
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

  it("keeps crossed panes mounted while settling pager jumps", () => {
    expect(getMobilePagerJumpWindow(0, 4, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(getMobilePagerJumpWindow(2, 3, 5)).toEqual([1, 2, 3, 4]);
  });

  it("keeps bottom-nav tap mounts to current and target panes only", () => {
    expect(getMobilePagerTapWindow(0, 4, 5)).toEqual([0, 4]);
    expect(getMobilePagerTapWindow(2, 3, 5)).toEqual([2, 3]);
    expect(getMobilePagerTapWindow(2, 2, 5)).toEqual([2]);
  });

  it("preheats missing tabs one at a time from nearest to farthest", () => {
    expect(getMobilePagerPreheatQueue([0, 1], 0, 5)).toEqual([2, 3, 4]);
    expect(getMobilePagerPreheatQueue([3, 4], 4, 5)).toEqual([2, 1, 0]);
    expect(getMobilePagerPreheatQueue([1, 2, 3], 2, 5)).toEqual([0, 4]);
  });

  it("retains already mounted tabs across an early long jump", () => {
    expect(mergeTabWindows([0, 1], [0, 4])).toEqual([0, 1, 4]);
    expect(mergeTabWindows([0, 1, 4], [3, 4])).toEqual([0, 1, 3, 4]);
  });

  it("reads the drag marker from the mobile shell element", () => {
    expect(isMobilePagerTouching({ querySelector: () => ({}) })).toBe(true);
    expect(isMobilePagerTouching({ querySelector: () => null })).toBe(false);
  });

  it("always renders the visible tab even if the render window is stale", () => {
    expect(shouldRenderMobilePagerPane(3, [0, 1], 3, 0)).toBe(true);
    expect(shouldRenderMobilePagerPane(4, [0, 1], 0, 4)).toBe(true);
    expect(shouldRenderMobilePagerPane(2, [0, 1], 3, 4)).toBe(false);
  });

  it("freezes hidden preheated panes until they become active again", () => {
    const previousRender = () => null;
    const base = {
      idx: 2,
      shouldRender: true,
      isActive: false,
      renderTab: previousRender,
    };

    expect(shouldReuseMobilePagerPane(base, {
      ...base,
      renderTab: () => null,
    })).toBe(true);
    expect(shouldReuseMobilePagerPane(base, {
      ...base,
      isActive: true,
      renderTab: () => null,
    })).toBe(false);
  });

  it("refreshes the active pane and reacts to mount-window changes", () => {
    const previousRender = () => null;
    const active = {
      idx: 1,
      shouldRender: true,
      isActive: true,
      renderTab: previousRender,
    };

    expect(shouldReuseMobilePagerPane(active, {
      ...active,
      renderTab: () => null,
    })).toBe(false);
    expect(shouldReuseMobilePagerPane(active, active)).toBe(true);
    expect(shouldReuseMobilePagerPane(active, {
      ...active,
      shouldRender: false,
    })).toBe(false);
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
