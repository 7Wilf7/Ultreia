function clampTab(idx, count) {
  return Math.max(0, Math.min(count - 1, idx));
}

export function mergeTabWindows(...windows) {
  return [...new Set(windows.flat().filter(Number.isFinite))].sort((a, b) => a - b);
}

export function getMobilePagerRenderWindow(idx, count) {
  const clamped = clampTab(idx, count);
  const tabs = [clamped];
  if (clamped > 0) tabs.push(clamped - 1);
  if (clamped < count - 1) tabs.push(clamped + 1);
  return tabs.sort((a, b) => a - b);
}

export function getMobilePagerJumpWindow(from, to, count) {
  const start = clampTab(Math.min(from, to), count);
  const end = clampTab(Math.max(from, to), count);
  const span = [];
  for (let idx = start; idx <= end; idx += 1) span.push(idx);

  return mergeTabWindows(
    span,
    getMobilePagerRenderWindow(from, count),
    getMobilePagerRenderWindow(to, count),
  );
}

export function getMobilePagerTapWindow(from, to, count) {
  return mergeTabWindows([
    clampTab(from, count),
    clampTab(to, count),
  ]);
}

export function shouldRenderMobilePagerPane(idx, renderedTabs, visualTab, propTab) {
  return renderedTabs.includes(idx) || idx === visualTab || idx === propTab;
}

export function shouldOuterPagerHandleSwipe({ direction, currentTab, tabCount, innerCanMove = false }) {
  if (innerCanMove) return false;
  if (direction > 0) return currentTab < tabCount - 1;
  if (direction < 0) return currentTab > 0;
  return false;
}

export function resolveMobilePagerTouchStart({
  visualTab,
  trackLeft = 0,
  width = 1,
  tabCount,
  settleTarget = null,
}) {
  const safeWidth = Math.max(1, width || 1);
  const isSettling = Number.isFinite(settleTarget);
  const current = clampTab(isSettling ? settleTarget : visualTab, tabCount);

  return {
    current,
    startLeft: isSettling ? trackLeft : current * safeWidth,
  };
}
