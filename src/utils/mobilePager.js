export function getMobilePagerRenderWindow(idx, count) {
  const tabs = [idx];
  if (idx > 0) tabs.push(idx - 1);
  if (idx < count - 1) tabs.push(idx + 1);
  return tabs.sort((a, b) => a - b);
}
