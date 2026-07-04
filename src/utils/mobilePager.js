const CALENDAR_TAB = 1;
const COACH_TAB = 2;

export function getMobilePagerRenderWindow(idx, count) {
  const clamped = Math.max(0, Math.min(count - 1, idx));

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
