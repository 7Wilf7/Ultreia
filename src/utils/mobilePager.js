const CALENDAR_TAB = 1;
const COACH_TAB = 2;

function clampTab(idx, count) {
  return Math.max(0, Math.min(count - 1, idx));
}

export function mergeTabWindows(...windows) {
  return [...new Set(windows.flat().filter(Number.isFinite))].sort((a, b) => a - b);
}

export function getMobilePagerRenderWindow(idx, count) {
  const clamped = clampTab(idx, count);

  // Calendar <-> AI Coach is the heavy, high-frequency mobile swipe pair.
  // Keep only those two pages mounted while settled on either side; the actual
  // swipe direction can still add Training/Races on demand.
  if (count >= 3 && (clamped === CALENDAR_TAB || clamped === COACH_TAB)) {
    return [CALENDAR_TAB, COACH_TAB].filter(tab => tab < count);
  }

  const tabs = [clamped];
  if (clamped > 0) tabs.push(clamped - 1);
  if (clamped < count - 1) tabs.push(clamped + 1);
  return tabs.sort((a, b) => a - b);
}

export function getMobilePagerScrollWindow(scrollLeft, width, count) {
  const page = width > 0 ? scrollLeft / width : 0;
  const candidates = [
    clampTab(Math.floor(page), count),
    clampTab(Math.ceil(page), count),
    clampTab(Math.round(page), count),
  ];

  return mergeTabWindows(...candidates.map(idx => getMobilePagerRenderWindow(idx, count)));
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

export function shouldRenderMobilePagerPane(idx, renderedTabs, visualTab, propTab) {
  return renderedTabs.includes(idx) || idx === visualTab || idx === propTab;
}
