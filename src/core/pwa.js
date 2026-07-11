export async function clearPwaCacheAndReload() {
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if ("caches" in globalThis) {
      const keys = await globalThis.caches.keys();
      await Promise.all(keys.map((key) => globalThis.caches.delete(key)));
    }
  } catch (error) {
    console.warn("[clear-cache] failed:", error);
  }

  const nextUrl = new URL(globalThis.location.href);
  nextUrl.searchParams.set("refresh", String(Date.now()));
  globalThis.location.replace(nextUrl.toString());
}
