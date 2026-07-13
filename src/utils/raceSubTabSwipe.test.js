import { describe, expect, it } from "vitest";
import { shouldInnerPagerOwnSwipe } from "./mobilePager";
import { raceSubTabSwipeBoundary, resolveRaceSubTabSwipe, shouldStartRaceSubTabSwipe } from "./raceSubTabSwipe";

describe("race sub-tab swipe", () => {
  it("switches from Target to History on a left swipe", () => {
    expect(resolveRaceSubTabSwipe({
      currentTab: "target", startX: 280, startY: 120, endX: 180, endY: 126,
    })).toBe("history");
  });

  it("switches from History to Target on a right swipe", () => {
    expect(resolveRaceSubTabSwipe({
      currentTab: "history", startX: 120, startY: 120, endX: 220, endY: 116,
    })).toBe("target");
  });

  it("ignores short, vertical, and boundary-direction gestures", () => {
    expect(resolveRaceSubTabSwipe({
      currentTab: "target", startX: 200, startY: 100, endX: 168, endY: 102,
    })).toBeNull();
    expect(resolveRaceSubTabSwipe({
      currentTab: "target", startX: 200, startY: 100, endX: 140, endY: 180,
    })).toBeNull();
    expect(resolveRaceSubTabSwipe({
      currentTab: "target", startX: 120, startY: 100, endX: 220, endY: 100,
    })).toBeNull();
    expect(resolveRaceSubTabSwipe({
      currentTab: "history", startX: 220, startY: 100, endX: 120, endY: 100,
    })).toBeNull();
  });

  it("hands boundary directions back to the outer five-tab pager", () => {
    expect(raceSubTabSwipeBoundary("target")).toEqual({ swipeNext: true, swipePrev: false });
    expect(raceSubTabSwipeBoundary("history")).toEqual({ swipeNext: false, swipePrev: true });
    expect(shouldInnerPagerOwnSwipe({ swipeNext: true, swipePrev: false, dx: -80 })).toBe(true);
    expect(shouldInnerPagerOwnSwipe({ swipeNext: true, swipePrev: false, dx: 80 })).toBe(false);
    expect(shouldInnerPagerOwnSwipe({ swipeNext: false, swipePrev: true, dx: 80 })).toBe(true);
    expect(shouldInnerPagerOwnSwipe({ swipeNext: false, swipePrev: true, dx: -80 })).toBe(false);
  });

  it("does not begin from portal content or interactive controls", () => {
    const base = { isPrimary: true, pointerType: "touch", isWithinRoot: true, isInteractive: false };
    expect(shouldStartRaceSubTabSwipe(base)).toBe(true);
    expect(shouldStartRaceSubTabSwipe({ ...base, isWithinRoot: false })).toBe(false);
    expect(shouldStartRaceSubTabSwipe({ ...base, isInteractive: true })).toBe(false);
    expect(shouldStartRaceSubTabSwipe({ ...base, pointerType: "mouse" })).toBe(false);
  });
});
