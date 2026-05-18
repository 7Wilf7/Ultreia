import { useEffect, useRef } from "react";

/**
 * Attach a ref to a DOM node; the callback fires when the user clicks anywhere
 * outside that node. Disabled when `enabled` is false.
 *
 * The listener re-binds when `callback` or `enabled` change. That's a single
 * document mousedown handler so the rebind cost is negligible.
 */
export function useClickOutside(callback, enabled = true) {
  const ref = useRef(null);

  useEffect(() => {
    if (!enabled) return;
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        callback(e);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [enabled, callback]);

  return ref;
}
