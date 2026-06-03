import { useState, useEffect } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { useT } from "../i18n/LanguageContext";

// Native bridge declared in android/.../ApkInstallerPlugin.java. On web this
// is a no-op stub (we never call it off-native).
const ApkInstaller = registerPlugin("ApkInstaller");

const isNative = () => Capacitor.isNativePlatform?.() === true;

const GITHUB_RELEASES_API =
  "https://api.github.com/repos/7Wilf7/training-studio/releases/latest";

// Strip leading "v" so "v0.2.1" → "0.2.1"
function stripV(tag) {
  return tag.replace(/^v/i, "").trim();
}

// semver-ish compare: 0.2.1 > 0.2.0 → 1, equal → 0, older → -1.
// Handles prerelease suffixes ("0.4.0-beta.4"): per semver, a prerelease ranks
// BELOW the matching release (0.4.0-beta.4 < 0.4.0). The old naive split-on-dot
// got this backwards — it parsed "0.4.0-beta.4" as [0,4,0,4] and so judged the
// installed beta NEWER than the released 0.4.0, reporting "you're up to date".
function parseVersion(v) {
  const [core, pre = ""] = String(v).split("-");
  return { nums: core.split(".").map((n) => parseInt(n, 10) || 0), pre };
}
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < len; i++) {
    const x = pa.nums[i] || 0;
    const y = pb.nums[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  // Core versions equal — a release (no prerelease) outranks a prerelease.
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && !pb.pre) return -1;
  if (pa.pre && pb.pre) {
    // Both prerelease, e.g. "beta.4" vs "beta.5" — numeric-aware compare.
    return Math.sign(pa.pre.localeCompare(pb.pre, undefined, { numeric: true }));
  }
  return 0;
}

function pickApkAsset(assets) {
  if (!Array.isArray(assets)) return null;
  return assets.find((a) => /\.apk$/i.test(a?.name)) || null;
}

export function UpdateChecker() {
  const t = useT();
  // __APP_VERSION__ is injected by vite (see vite.config.js -> define).
  const currentVersion = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
  const [status, setStatus] = useState("idle"); // idle | checking | latest | newer | error
  const [release, setRelease] = useState(null);
  // Native in-app download/install progress: idle | downloading | installing
  const [installState, setInstallState] = useState("idle");
  const [installMsg, setInstallMsg] = useState("");
  // Download progress 0–100, or null when the server gives no Content-Length
  // (then we show an indeterminate bar instead of a percentage).
  const [downloadPct, setDownloadPct] = useState(null);
  // "View recent updates" (up-to-date case) expands the latest release notes.
  const [showNotes, setShowNotes] = useState(false);

  // Auto-check once on mount so the button can show "new version + red dot" vs
  // "view recent updates" without the user having to tap first. Settings is the
  // only place this mounts, so it's at most one GitHub call per Settings open.
  useEffect(() => { check(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function check() {
    setStatus("checking");
    try {
      const res = await fetch(GITHUB_RELEASES_API, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const remote = stripV(data.tag_name || "");
      const cmp = compareVersions(remote, currentVersion);
      setRelease({
        version: remote,
        url: data.html_url,
        apkUrl: pickApkAsset(data.assets)?.browser_download_url || null,
        notes: data.body || "",
      });
      setStatus(cmp > 0 ? "newer" : "latest");
    } catch {
      setStatus("error");
      setRelease(null);
    }
  }

  // Native path: download the APK into the app cache, then hand it to the
  // system installer via the ApkInstaller plugin. Any failure (download
  // error, plugin missing, installer refused) falls back to opening the
  // APK URL in the browser — the always-works path — so the button never
  // dead-ends.
  async function downloadAndInstall(apkUrl) {
    if (!isNative()) {
      window.open(apkUrl, "_blank", "noreferrer");
      return;
    }
    setInstallMsg("");
    setDownloadPct(null);
    let progressHandle = null;
    try {
      setInstallState("downloading");
      // Live byte-progress from the native download. contentLength is 0 when
      // the server omits Content-Length — keep pct null so the UI falls back
      // to an indeterminate bar rather than a stuck "0%".
      progressHandle = await Filesystem.addListener("progress", (p) => {
        if (p.contentLength > 0) {
          setDownloadPct(Math.min(100, Math.round((p.bytes / p.contentLength) * 100)));
        }
      });
      // Download with one retry. The common failure is a transient DNS hiccup
      // ("Unable to resolve host github.com") — the asset URL 302-redirects
      // github.com → objects.githubusercontent.com, and a momentary network
      // blip on either lookup aborts the whole download. A short backoff +
      // single retry recovers most of those without bothering the user.
      let res = null, lastErr = null;
      for (let attempt = 0; attempt < 2 && !res; attempt++) {
        try {
          res = await Filesystem.downloadFile({
            url: apkUrl,
            path: "ts-update.apk",
            directory: Directory.Cache,
            progress: true,
          });
        } catch (e) {
          lastErr = e;
          if (attempt === 0) {
            setDownloadPct(null);
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
      }
      if (!res) throw lastErr || new Error("download failed");
      const path = res?.path;
      if (!path) throw new Error("download returned no path");
      setInstallState("installing");
      await ApkInstaller.install({ path });
      // Installer launched in a separate task; reset our button state.
      setInstallState("idle");
    } catch (err) {
      console.error("[update] in-app install failed:", err);
      setInstallState("idle");
      // Surface the actual reason (so a failure is diagnosable) AND still fall
      // back to the browser download so the button never dead-ends. The message
      // persists in-app when the user returns from the browser.
      const reason = err?.message || String(err);
      // DNS / host-resolution failures are the common transient case — add a
      // "check your network" hint so the user knows a retry will likely work.
      const isNetwork = /resolve host|No address|network|timeout|unable to|failed to connect/i.test(reason);
      setInstallMsg(
        `${t("settings.update_install_failed")} (${reason})` +
        (isNetwork ? ` ${t("settings.update_network_hint")}` : "")
      );
      window.open(apkUrl, "_blank", "noreferrer");
    } finally {
      progressHandle?.remove?.();
      setDownloadPct(null);
    }
  }

  return (
    <div style={cellStyle}>
      <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={primaryStyle}>{t("settings.version")}</div>
          <div style={secondaryStyle}>v{currentVersion}</div>
        </div>
        {status === "latest" ? (
          // Up to date → button reveals the latest version's changelog.
          <button onClick={() => setShowNotes(o => !o)} style={btnStyle}>
            {t("settings.view_recent")}
          </button>
        ) : (
          <button
            onClick={check}
            disabled={status === "checking"}
            style={{ ...btnStyle, position: "relative" }}
          >
            {status === "checking" ? t("settings.update_checking") : t("settings.check_update")}
            {status === "newer" && (
              <span style={{
                position: "absolute", top: -3, right: -3,
                width: 8, height: 8, borderRadius: "50%",
                background: "var(--danger)", border: "1px solid var(--bg-elevated)",
              }} />
            )}
          </button>
        )}
      </div>

      {status === "error" && (
        <div style={resultErrStyle}>{t("settings.update_error")}</div>
      )}

      {/* Up-to-date: show the latest release notes when the user taps "view
          recent updates". Version as the panel title. */}
      {status === "latest" && showNotes && release && (
        <div style={updatePanelStyle}>
          <div style={panelTitleStyle}>{t("settings.update_recent_title", { v: release.version })}</div>
          {release.notes
            ? <pre style={notesStyle}>{release.notes.slice(0, 1200)}</pre>
            : <div style={resultOkStyle}>✓ {t("settings.update_latest")}</div>}
        </div>
      )}

      {status === "newer" && release && (
        <div style={updatePanelStyle}>
          <div style={panelTitleStyle}>{t("settings.update_new_title", { v: release.version })}</div>
          {/* Actions FIRST so the download CTA is always reachable without
              scrolling past the notes (which used to trap the touch scroll). */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {release.apkUrl && (
              isNative() ? (
                // Native: download + launch the installer in-app, no browser hop.
                <button
                  onClick={() => downloadAndInstall(release.apkUrl)}
                  disabled={installState !== "idle"}
                  style={{ ...downloadBtnStyle, border: "none", cursor: installState !== "idle" ? "default" : "pointer", opacity: installState !== "idle" ? 0.7 : 1 }}>
                  {installState === "downloading"
                    ? `${t("settings.update_downloading")}${downloadPct != null ? ` ${downloadPct}%` : ""}`
                    : installState === "installing"
                      ? t("settings.update_installing")
                      : `↓ ${t("settings.update_install")}`}
                </button>
              ) : (
                // Web: plain download link.
                <a href={release.apkUrl} target="_blank" rel="noreferrer" style={downloadBtnStyle}>
                  ↓ {t("settings.update_download")}
                </a>
              )
            )}
          </div>
          {installState === "downloading" && (
            <div style={progressTrackStyle}>
              <div
                style={{
                  ...progressFillStyle,
                  // Determinate when we know the size; otherwise a slim
                  // looping bar so the user still sees motion.
                  ...(downloadPct != null
                    ? { width: `${downloadPct}%` }
                    : { width: "40%", animation: "ts-indeterminate 1.1s ease-in-out infinite" }),
                }}
              />
            </div>
          )}
          {installMsg && (
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--warn)", lineHeight: 1.5 }}>
              {installMsg}
            </div>
          )}
          {/* This release's changes, below the actions. No internal scroll
              (see notesStyle) so it never traps the page scroll. */}
          {release.notes
            ? <pre style={notesStyle}>{release.notes.slice(0, 800)}</pre>
            : <div style={{ ...secondaryStyle, marginTop: 0 }}>v{release.version}</div>}
        </div>
      )}
    </div>
  );
}

const cellStyle = {
  background: "var(--bg-elevated)",
  borderTop: "1px solid var(--rule-soft)",
  borderBottom: "1px solid var(--rule-soft)",
  marginTop: -1,
  padding: "14px 14px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const primaryStyle = {
  fontFamily: "var(--font-sans)",
  fontSize: 15,
  color: "var(--ink-1)",
  fontWeight: 500,
  lineHeight: 1.25,
};

const secondaryStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  color: "var(--ink-3)",
  marginTop: 3,
};

const btnStyle = {
  background: "var(--bg)",
  border: "1px solid var(--rule)",
  borderRadius: 6,
  padding: "6px 10px",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  color: "var(--ink-1)",
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
};

const resultOkStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  color: "var(--moss)",
};

const resultErrStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  color: "var(--warn)",
};

const updatePanelStyle = {
  background: "var(--bg)",
  border: "1px solid var(--rule-soft)",
  borderRadius: 8,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const notesStyle = {
  whiteSpace: "pre-wrap",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  color: "var(--ink-2)",
  margin: 0,
  // No internal scroll on purpose — a nested scroller swallows the touch
  // gesture and the page can't scroll on to the buttons. The notes flow and
  // the page (MobileShell <main>) does the scrolling. Notes are short now.
};

const downloadBtnStyle = {
  background: "var(--moss)",
  color: "var(--bg)",
  border: "none",
  borderRadius: 6,
  padding: "8px 14px",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  textDecoration: "none",
  fontWeight: 600,
};

const progressTrackStyle = {
  height: 6,
  borderRadius: 3,
  background: "var(--bg-sunken)",
  overflow: "hidden",
};

const progressFillStyle = {
  height: "100%",
  background: "var(--moss)",
  borderRadius: 3,
  transition: "width 0.2s ease",
};

const panelTitleStyle = {
  fontFamily: "var(--font-sans)",
  fontSize: 14,
  fontWeight: 600,
  color: "var(--ink-1)",
};
