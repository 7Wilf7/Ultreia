import { useCallback, useRef } from "react";

const DUPLICATE_CLICK_WINDOW_MS = 750;

export function useInstantPress({ duplicateClickWindowMs = DUPLICATE_CLICK_WINDOW_MS } = {}) {
  const recentPointerPressRef = useRef(new Map());

  return useCallback((key, onPress) => ({
    onPointerDown: (event) => {
      if (event.pointerType === "mouse") return;
      recentPointerPressRef.current.set(key, event.timeStamp || 0);
      event.preventDefault?.();
      onPress?.(event);
    },
    onClick: (event) => {
      const at = event.timeStamp || 0;
      const hasRecentPointerPress = recentPointerPressRef.current.has(key);
      const recentAt = recentPointerPressRef.current.get(key) || 0;
      if (hasRecentPointerPress && at - recentAt < duplicateClickWindowMs) {
        event.preventDefault?.();
        return;
      }
      onPress?.(event);
    },
  }), [duplicateClickWindowMs]);
}
