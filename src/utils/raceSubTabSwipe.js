const MIN_SWIPE_PX = 48;
const AXIS_RATIO = 1.2;

export function resolveRaceSubTabSwipe({ currentTab, startX, startY, endX, endY }) {
  const dx = Number(endX) - Number(startX);
  const dy = Number(endY) - Number(startY);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (Math.abs(dx) < MIN_SWIPE_PX || Math.abs(dx) <= Math.abs(dy) * AXIS_RATIO) return null;
  if (currentTab === "target" && dx < 0) return "history";
  if (currentTab === "history" && dx > 0) return "target";
  return null;
}

export function raceSubTabSwipeBoundary(currentTab) {
  return {
    swipeNext: currentTab === "target",
    swipePrev: currentTab === "history",
  };
}

export function shouldStartRaceSubTabSwipe({ isPrimary, pointerType, isWithinRoot, isInteractive }) {
  return isPrimary === true
    && pointerType !== "mouse"
    && isWithinRoot === true
    && isInteractive !== true;
}
