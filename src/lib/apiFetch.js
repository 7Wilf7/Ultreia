// HTTP POST that survives the WebView going to background on Android.
//
// Capacitor's APK runs the React app inside a WebView. When the user backgrounds
// the app, Android freezes the WebView JS context after a short grace period —
// any in-flight `fetch()` initiated from inside the WebView is paused and, in
// practice, often comes back as a TypeError "network request failed". That's
// what the user used to see after returning to the AI Coach.
//
// CapacitorHttp routes the request to the NATIVE layer (OkHttp on Android,
// URLSession on iOS), where the OS happily lets it run even while the WebView
// is suspended. When the WebView resumes, the JS Promise resolves with the
// real response.
//
// On web (PWA / browser) we still use window.fetch — same behaviour as before.
// PWAs do get suspended in some mobile browsers (notably iOS Safari) but the
// fix there is service workers, which is a separate concern.
//
// API: returns a Response-LIKE object (headers.get / status / json() / text())
// so existing call sites can swap `await fetch(...)` for `await postJson(...)`
// with minimal changes.

import { Capacitor, CapacitorHttp } from "@capacitor/core";

const isNative = () => Capacitor.isNativePlatform?.() === true;

export async function postJson({ url, headers = {}, body }) {
  if (isNative()) {
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
  }

  // Web — plain fetch. Returns the native Response object so callers can use
  // its .json() / .text() / headers.get directly.
  return fetch(url, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
