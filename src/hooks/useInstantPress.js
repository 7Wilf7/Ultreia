import { useCallback, useRef } from "react";

const DUPLICATE_CLICK_WINDOW_MS = 750;
const TAP_MOVE_TOLERANCE_PX = 10;

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

export function useInstantTap({
  duplicateClickWindowMs = DUPLICATE_CLICK_WINDOW_MS,
  moveTolerancePx = TAP_MOVE_TOLERANCE_PX,
} = {}) {
  const activeTapRef = useRef(new Map());
  const recentTapRef = useRef(new Map());
  const cancelledTapRef = useRef(new Map());

  return useCallback((key, onTap) => ({
    onPointerDown: (event) => {
      if (event.pointerType === "mouse") return;
      activeTapRef.current.set(key, {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      });
    },
    onPointerMove: (event) => {
      const active = activeTapRef.current.get(key);
      if (!active || active.pointerId !== event.pointerId) return;
      const dx = event.clientX - active.x;
      const dy = event.clientY - active.y;
      if (Math.hypot(dx, dy) > moveTolerancePx) {
        cancelledTapRef.current.set(key, event.timeStamp || 0);
        activeTapRef.current.delete(key);
      }
    },
    onPointerCancel: (event) => {
      const active = activeTapRef.current.get(key);
      if (!active || active.pointerId === event.pointerId) {
        cancelledTapRef.current.set(key, event.timeStamp || 0);
        activeTapRef.current.delete(key);
      }
    },
    onPointerUp: (event) => {
      const active = activeTapRef.current.get(key);
      if (!active || active.pointerId !== event.pointerId) return;
      activeTapRef.current.delete(key);
      const dx = event.clientX - active.x;
      const dy = event.clientY - active.y;
      if (Math.hypot(dx, dy) > moveTolerancePx) return;
      recentTapRef.current.set(key, event.timeStamp || 0);
      event.preventDefault?.();
      onTap?.(event);
    },
    onClick: (event) => {
      const at = event.timeStamp || 0;
      const cancelledAt = cancelledTapRef.current.get(key) || 0;
      if (cancelledAt && at - cancelledAt < duplicateClickWindowMs) {
        event.preventDefault?.();
        return;
      }
      const hasRecentTap = recentTapRef.current.has(key);
      const recentAt = recentTapRef.current.get(key) || 0;
      if (hasRecentTap && at - recentAt < duplicateClickWindowMs) {
        event.preventDefault?.();
        return;
      }
      onTap?.(event);
    },
  }), [duplicateClickWindowMs, moveTolerancePx]);
}
