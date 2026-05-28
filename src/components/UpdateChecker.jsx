import { useState } from "react";
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

// Naive semver compare: 0.2.1 > 0.2.0 → 1, equal → 0, older → -1
function compareVersions(a, b) {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
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
    try {
      setInstallState("downloading");
      const res = await Filesystem.downloadFile({
        url: apkUrl,
        path: "ts-update.apk",
        directory: Directory.Cache,
      });
      const path = res?.path;
      if (!path) throw new Error("download returned no path");
      setInstallState("installing");
      await ApkInstaller.install({ path });
      // Installer launched in a separate task; reset our button state.
      setInstallState("idle");
    } catch (err) {
      console.error("[update] in-app install failed:", err);
      setInstallState("idle");
      setInstallMsg(t("settings.update_install_failed"));
      window.open(apkUrl, "_blank", "noreferrer");
    }
  }

  return (
    <div style={cellStyle}>
      <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={primaryStyle}>{t("settings.version")}</div>
          <div style={secondaryStyle}>v{currentVersion}</div>
        </div>
        <button
          onClick={check}
          disabled={status === "checking"}
          style={btnStyle}
        >
          {status === "checking" ? t("settings.update_checking") : t("settings.check_update")}
        </button>
      </div>

      {status === "latest" && (
        <div style={resultOkStyle}>✓ {t("settings.update_latest")}</div>
      )}

      {status === "error" && (
        <div style={resultErrStyle}>{t("settings.update_error")}</div>
      )}

      {status === "newer" && release && (
        <div style={updatePanelStyle}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-2)" }}>
            {t("settings.update_available")} · <strong>v{release.version}</strong>
          </div>
          {release.notes && (
            <pre style={notesStyle}>{release.notes.slice(0, 600)}</pre>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {release.apkUrl && (
              isNative() ? (
                // Native: download + launch the installer in-app, no browser hop.
                <button
                  onClick={() => downloadAndInstall(release.apkUrl)}
                  disabled={installState !== "idle"}
                  style={{ ...downloadBtnStyle, border: "none", cursor: installState !== "idle" ? "default" : "pointer", opacity: installState !== "idle" ? 0.7 : 1 }}>
                  {installState === "downloading"
                    ? t("settings.update_downloading")
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
            <a href={release.url} target="_blank" rel="noreferrer" style={viewBtnStyle}>
              ↗ {t("settings.update_view")}
            </a>
          </div>
          {installMsg && (
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--warn)", lineHeight: 1.5 }}>
              {installMsg}
            </div>
          )}
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
  maxHeight: 160,
  overflow: "auto",
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

const viewBtnStyle = {
  background: "transparent",
  color: "var(--ink-1)",
  border: "1px solid var(--rule)",
  borderRadius: 6,
  padding: "8px 14px",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  textDecoration: "none",
};
