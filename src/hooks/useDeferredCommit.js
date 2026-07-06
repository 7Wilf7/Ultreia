import { useCallback, useEffect, useRef } from "react";

function requestNextFrame(callback) {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(callback);
  }
  return setTimeout(callback, 0);
}

function cancelNextFrame(id) {
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(id);
    return;
  }
  clearTimeout(id);
}

export function useDeferredCommit(commit) {
  const commitRef = useRef(commit);
  const frameRef = useRef(0);
  const pendingRef = useRef(undefined);
  const hasPendingRef = useRef(false);

  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);

  const cancel = useCallback(() => {
    if (frameRef.current) {
      cancelNextFrame(frameRef.current);
      frameRef.current = 0;
    }
    pendingRef.current = undefined;
    hasPendingRef.current = false;
  }, []);

  const schedule = useCallback((value) => {
    cancel();
    pendingRef.current = value;
    hasPendingRef.current = true;
    frameRef.current = requestNextFrame(() => {
      frameRef.current = 0;
      if (!hasPendingRef.current) return;
      const pending = pendingRef.current;
      pendingRef.current = undefined;
      hasPendingRef.current = false;
      commitRef.current?.(pending);
    });
  }, [cancel]);

  useEffect(() => cancel, [cancel]);

  return schedule;
}
