// HTTP POST that survives the WebView going to background on Android.
//
// Capacitor's APK runs the React app inside a WebView. When the user backgrounds
// the app, Android freezes the WebView JS context after a short grace period AND
// throttles the app's network — any in-flight `fetch()` initiated from inside the
// WebView is paused and, in practice, often comes back as a TypeError "network
// request failed". That's what the user used to see after returning to the AI
// Coach mid-request.
//
// Two-layer fix:
//   1. CapacitorHttp routes the request to the NATIVE layer (OkHttp on Android,
//      URLSession on iOS), where the OS lets it run even while the WebView is
//      suspended.
//   2. While the request is in flight we hold a background task (Capawesome
//      background-task plugin). If the user switches away mid-call, the OS grants
//      grace time so the native request can finish (LLM calls take tens of
//      seconds) instead of being network-throttled/killed. On resume the JS
//      Promise resolves with the real response.
//
// On web (PWA / browser) we still use window.fetch — same behaviour as before.
//
// API: returns a Response-LIKE object (headers.get / status / json() / text())
// so existing call sites can swap `await fetch(...)` for `await postJson(...)`
// with minimal changes.

import { Capacitor, CapacitorHttp } from "@capacitor/core";

const isNative = () => Capacitor.isNativePlatform?.() === true;

// Run `work()` (a Promise-returning fn) while holding an OS background task if
// the app gets backgrounded mid-flight, so Android/iOS grant grace time to
// finish it. Best-effort: any plugin failure falls back to just running work().
// Plugins are imported lazily so the web bundle never loads the native shim.
async function withBackgroundGrace(work) {
  if (!isNative()) return work();

  let App, BackgroundTask;
  try {
    ({ App } = await import("@capacitor/app"));
    ({ BackgroundTask } = await import("@capawesome/capacitor-background-task"));
  } catch {
    return work(); // plugin unavailable — run without the grace window
  }

  const promise = work();
  let handle = null;
  try {
    // Registered only for the lifetime of THIS request. When the app moves to
    // the background, request a background task whose callback waits for the
    // request to settle, then finishes — keeping the process alive meanwhile.
    handle = await App.addListener("appStateChange", async ({ isActive }) => {
      if (isActive) return;
      try {
        const taskId = await BackgroundTask.beforeExit(async () => {
          try { await promise; } catch { /* error surfaces to the real caller */ }
          BackgroundTask.finish({ taskId });
        });
      } catch { /* best-effort — ignore */ }
    });
    return await promise;
  } finally {
    try { if (handle) await handle.remove(); } catch { /* ignore */ }
  }
}

export async function postJson({ url, headers = {}, body }) {
  if (isNative()) {
    return withBackgroundGrace(async () => {
      const resp = await CapacitorHttp.request({
        method: "POST",
        url,
        headers,
        data: typeof body === "string" ? JSON.parse(body) : body,
      });
      const respHeaders = resp.headers || {};
      const headerGet = (k) => {
        if (respHeaders[k] != null) return respHeaders[k];
        const lower = k.toLowerCase();
        if (respHeaders[lower] != null) return respHeaders[lower];
        // Case-insensitive search for headers; native plugins sometimes use
        // canonicalized keys ("Content-Type") and sometimes lowercase.
        for (const hk of Object.keys(respHeaders)) {
          if (hk.toLowerCase() === lower) return respHeaders[hk];
        }
        return null;
      };
      const data = resp.data;
      return {
        ok: resp.status >= 200 && resp.status < 300,
        status: resp.status,
        headers: { get: headerGet },
        // CapacitorHttp tends to auto-parse JSON when the upstream sets a JSON
        // content-type. For consistency with fetch we still expose .json() /
        // .text() methods that return Promises.
        json: async () => {
          if (typeof data === "object" && data !== null) return data;
          if (typeof data === "string") {
            try { return JSON.parse(data); } catch { return data; }
          }
          return data;
        },
        text: async () => typeof data === "string" ? data : JSON.stringify(data),
      };
    });
  }

  // Web — plain fetch. Returns the native Response object so callers can use
  // its .json() / .text() / headers.get directly.
  return fetch(url, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// Streaming POST for the AI coach (Anthropic-style SSE). Uses window.fetch on
// BOTH web and the WebView (CapacitorHttp can't stream — it buffers the whole
// body), but still wraps the read in withBackgroundGrace so a mid-stream
// backgrounding on Android gets OS grace time. `onToken(fullText)` is called
// with the running accumulated text as deltas arrive. Robust fallback: if the
// provider ignores `stream:true` and returns a single JSON body, we read it and
// emit the whole text once. Returns { ok, status, text, usage, errorText }.
export async function postJsonStream({ url, headers = {}, body, onToken }) {
  return withBackgroundGrace(async () => {
    let resp;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers,
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
    } catch (err) {
      return { ok: false, status: 0, text: "", errorText: err.message || "network error" };
    }
    const ct = resp.headers.get("content-type") || "";
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return { ok: false, status: resp.status, text: "", errorText: errText.slice(0, 200) };
    }
    // Non-streaming fallback: provider returned a single JSON body.
    if (!ct.includes("event-stream") || !resp.body || !resp.body.getReader) {
      const data = await resp.json().catch(() => null);
      if (data && data.error) return { ok: false, status: resp.status, text: "", errorText: data.error?.message || "error" };
      const text = data?.content?.filter(b => b.type === "text").map(b => b.text).join("") || "";
      if (text && onToken) onToken(text);
      return { ok: true, status: resp.status, text, usage: data?.usage || null };
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "", full = "", errMsg = "", usage = null;
    const mergeUsage = (next) => {
      if (!next || typeof next !== "object") return;
      usage = { ...(usage || {}), ...next };
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let evt;
        try { evt = JSON.parse(payload); } catch { continue; }
        if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
          full += evt.delta.text;
          if (onToken) onToken(full);
        } else if (evt.type === "message_start") {
          mergeUsage(evt.message?.usage);
        } else if (evt.type === "message_delta") {
          mergeUsage(evt.usage);
        } else if (evt.type === "error") {
          errMsg = evt.error?.message || "stream error";
        }
      }
    }
    if (errMsg) return { ok: false, status: resp.status, text: full, errorText: errMsg };
    return { ok: true, status: resp.status, text: full, usage };
  });
}
