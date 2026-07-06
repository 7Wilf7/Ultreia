import { useState, useEffect } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { useT } from "../i18n/LanguageContext";
import { cleanReleaseNotes } from "../utils/releaseNotes";

// Native bridges (android/.../*.java). On web these are no-op stubs.
//   ApkInstaller  — hands a downloaded APK to the system package installer.
//   ApkDownloader — system DownloadManager: survives backgrounding / screen-off
//                   and shows progress in the notification tray.
const ApkInstaller = registerPlugin("ApkInstaller");
const ApkDownloader = registerPlugin("ApkDownloader");

const isNative = () => Capacitor.isNativePlatform?.() === true;

const GITHUB_RELEASES_API =
  "https://api.github.com/repos/7Wilf7/ultreia/releases/latest";

// China-friendlier release metadata and APK mirrors on Supabase Storage
// (public bucket), uploaded by the release workflow. GitHub API/CDN can be slow
// or unreachable in mainland China, so update checks try the small manifest
// first and keep GitHub as a fallback.
const SUPABASE_URL = (import.meta.env?.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const MIRROR_RELEASE_MANIFEST_URL = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/public/releases/ultreia-latest.json`
  : null;
const MIRROR_APK_URL = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/public/releases/ultreia-latest.apk`
  : null;
const MIRROR_CHECK_TIMEOUT_MS = 5000;
const GITHUB_CHECK_TIMEOUT_MS = 9000;
const AUTO_CHECK_CACHE_MS = 30 * 60 * 1000;
let releaseCheckCache = null; // { at, status, release }

function updateCopy(t) {
  return {
    version: t("settings.version"),
    viewRecent: t("settings.view_recent"),
    hideRecent: t("settings.update_hide_recent"),
    check: t("settings.check_update"),
    checking: t("settings.update_checking"),
    latest: t("settings.update_latest"),
    latestTitle: (v) => t("settings.update_recent_title", { v }),
    newTitle: (v) => t("settings.update_new_title", { v }),
    error: t("settings.update_error"),
    download: t("settings.update_download"),
    install: t("settings.update_install"),
    downloading: t("settings.update_downloading"),
    installing: t("settings.update_installing"),
    installFailed: t("settings.update_install_failed"),
    networkHint: t("settings.update_network_hint"),
  };
}

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

function uniqueUrls(urls) {
  return [...new Set(urls.filter(Boolean))];
}

function releaseDownloadUrl(release) {
  return release?.mirrorApkUrl || release?.apkUrl || "";
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = GITHUB_CHECK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function releaseFromMirrorManifest(data) {
  const remote = stripV(data?.version || data?.tagName || data?.tag_name || "");
  if (!remote) throw new Error("release manifest has no version");
  return {
    version: remote,
    url: data.htmlUrl || data.html_url || `https://github.com/7Wilf7/Ultreia/releases/tag/v${remote}`,
    apkUrl: data.githubApkUrl || data.github_apk_url || null,
    mirrorApkUrl: data.mirrorApkUrl || data.mirror_apk_url || data.apkUrl || data.apk_url || null,
    notes: data.notes || data.body || "",
  };
}

function releaseFromGithub(data) {
  const remote = stripV(data?.tag_name || "");
  if (!remote) throw new Error("GitHub release has no version");
  return {
    version: remote,
    url: data.html_url,
    apkUrl: pickApkAsset(data.assets)?.browser_download_url || null,
    mirrorApkUrl: null,
    notes: data.body || "",
  };
}

async function fetchLatestRelease() {
  let mirrorError = null;
  if (MIRROR_RELEASE_MANIFEST_URL) {
    try {
      const data = await fetchJsonWithTimeout(MIRROR_RELEASE_MANIFEST_URL, {}, MIRROR_CHECK_TIMEOUT_MS);
      return releaseFromMirrorManifest(data);
    } catch (err) {
      mirrorError = err;
      console.warn("[update] mirror release manifest failed:", err);
    }
  }

  try {
    const data = await fetchJsonWithTimeout(GITHUB_RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
    }, GITHUB_CHECK_TIMEOUT_MS);
    return releaseFromGithub(data);
  } catch (err) {
    console.warn("[update] GitHub release check failed:", err);
    throw mirrorError || err;
  }
}

function renderNotes(notes, maxChars) {
  const cleaned = cleanReleaseNotes(notes).slice(0, maxChars);
  if (!cleaned) return null;
  const lines = cleaned.split("\n").map(l => l.trim()).filter(Boolean);
  return (
    <div style={notesBlockStyle}>
      {lines.map((line, idx) => {
        const isBullet = /^[-*]\s+/.test(line);
        const text = line.replace(/^[-*]\s+/, "");
        return (
          <div key={`${idx}-${text.slice(0, 12)}`} style={isBullet ? noteItemStyle : noteHeadingStyle}>
            {isBullet ? `- ${text}` : text}
          </div>
        );
      })}
    </div>
  );
}

function ReleaseNotes({ notes, maxChars }) {
  return renderNotes(notes, maxChars);
}

export function UpdateChecker() {
  const t = useT();
  const copy = updateCopy(t);
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
  const [showRecentAction, setShowRecentAction] = useState(false);

  // Auto-check on mount, but reuse an in-memory result for a while. On mobile
  // the Settings tab unmounts when the user leaves it; without this cache,
  // every visit would hit GitHub again.
  useEffect(() => { check({ automatic: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function check({ automatic = false } = {}) {
    if (automatic && releaseCheckCache && Date.now() - releaseCheckCache.at < AUTO_CHECK_CACHE_MS) {
      setStatus(releaseCheckCache.status);
      setRelease(releaseCheckCache.release);
      return;
    }
    if (!automatic) {
      setShowNotes(false);
      setShowRecentAction(false);
    }
    setStatus("checking");
    try {
      const nextRelease = await fetchLatestRelease();
      const cmp = compareVersions(nextRelease.version, currentVersion);
      const nextStatus = cmp > 0 ? "newer" : "latest";
      setRelease(nextRelease);
      setStatus(nextStatus);
      if (!automatic && nextStatus === "latest") setShowRecentAction(true);
      releaseCheckCache = { at: Date.now(), status: nextStatus, release: nextRelease };
    } catch {
      setStatus("error");
      setRelease(null);
      if (!automatic) setShowRecentAction(false);
    }
  }

  // Native path: download the APK via the system DownloadManager (survives
  // backgrounding / screen-off, shows a tray notification), then hand it to the
  // system installer. Tries the versioned Supabase mirror first, then the legacy
  // "latest" mirror, then the GitHub asset. If every native path fails, open the
  // best available URL in the browser so the button never dead-ends.
  async function downloadAndInstall(targetRelease) {
    const primaryUrl = releaseDownloadUrl(targetRelease);
    if (!isNative()) {
      window.open(primaryUrl || targetRelease?.url, "_blank", "noreferrer");
      return;
    }
    setInstallMsg("");
    setDownloadPct(null);
    const candidates = uniqueUrls([targetRelease?.mirrorApkUrl, MIRROR_APK_URL, targetRelease?.apkUrl]);
    let lastErr = null;
    for (const url of candidates) {
      let poll = null;
      try {
        setInstallState("downloading");
        // Poll the native download for the in-app progress bar (the tray
        // notification shows it too). total is -1 until Content-Length is known.
        poll = setInterval(async () => {
          try {
            const p = await ApkDownloader.getProgress();
            if (p && p.total > 0) {
              setDownloadPct(Math.min(100, Math.round((p.bytes / p.total) * 100)));
            }
          } catch { /* ignore poll errors */ }
        }, 700);
        const res = await ApkDownloader.download({ url, fileName: "ultreia-update.apk" });
        clearInterval(poll); poll = null;
        const path = res?.path;
        if (!path) throw new Error("download returned no path");
        setInstallState("installing");
        await ApkInstaller.install({ path });
        setInstallState("idle");
        setDownloadPct(null);
        return; // success
      } catch (err) {
        console.error("[update] download attempt failed:", url, err);
        lastErr = err;
        if (poll) clearInterval(poll);
        setDownloadPct(null);
      }
    }
    // Every native attempt failed — surface the reason and fall back to the
    // browser (which uses the system download stack and always works).
    setInstallState("idle");
    const reason = lastErr?.message || String(lastErr);
    const isNetwork = /resolve host|No address|network|timeout|unable to|failed to connect/i.test(reason);
    setInstallMsg(
      `${copy.installFailed} (${reason})` +
      (isNetwork ? ` ${copy.networkHint}` : "")
    );
    window.open(primaryUrl || targetRelease?.url, "_blank", "noreferrer");
  }

  const recentActionEnabled = status === "latest" && release && showRecentAction;
  const primaryActionLabel = status === "checking"
    ? copy.checking
    : recentActionEnabled
      ? (showNotes ? copy.hideRecent : copy.viewRecent)
      : copy.check;
  const onPrimaryAction = () => {
    if (recentActionEnabled) {
      if (showNotes) {
        setShowNotes(false);
        setShowRecentAction(false);
      } else {
        setShowNotes(true);
      }
      return;
    }
    void check({ automatic: false });
  };

  return (
    <div style={cellStyle}>
      <div style={headerStyle}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 8 }}>
          <div style={primaryStyle}>{copy.version}</div>
          <div style={{ ...secondaryStyle, marginTop: 0 }}>v{currentVersion}</div>
          {recentActionEnabled && (
            <div style={latestHintStyle}>✓ {copy.latest}</div>
          )}
        </div>
        <div style={buttonWrapStyle}>
          <button
            onClick={onPrimaryAction}
            disabled={status === "checking"}
            style={btnStyle}
          >
            {primaryActionLabel}
          </button>
          {status === "newer" && (
            <span aria-hidden="true" style={updateDotStyle} />
          )}
        </div>
      </div>

      {status === "error" && (
        <div style={resultErrStyle}>{copy.error}</div>
      )}

      {/* Up-to-date: show the latest release notes when the user taps "view
          recent updates". Version as the panel title. */}
      {status === "latest" && showNotes && release && (
        <div style={updatePanelStyle}>
          <div style={panelTitleStyle}>{copy.latestTitle(release.version)}</div>
          {cleanReleaseNotes(release.notes)
            ? <ReleaseNotes notes={release.notes} maxChars={1200} />
            : <div style={resultOkStyle}>✓ {copy.latest}</div>}
        </div>
      )}

      {status === "newer" && release && (
        <div style={updatePanelStyle}>
          <div style={panelTitleStyle}>{copy.newTitle(release.version)}</div>
          {/* Actions FIRST so the download CTA is always reachable without
              scrolling past the notes (which used to trap the touch scroll). */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {releaseDownloadUrl(release) && (
              isNative() ? (
                // Native: download + launch the installer in-app, no browser hop.
                <button
                  onClick={() => downloadAndInstall(release)}
                  disabled={installState !== "idle"}
                  style={{ ...downloadBtnStyle, border: "none", cursor: installState !== "idle" ? "default" : "pointer", opacity: installState !== "idle" ? 0.7 : 1 }}>
                  {installState === "downloading"
                    ? `${copy.downloading}${downloadPct != null ? ` ${downloadPct}%` : ""}`
                    : installState === "installing"
                      ? copy.installing
                      : `↓ ${copy.install}`}
                </button>
              ) : (
                // Web: plain download link.
                <a href={releaseDownloadUrl(release)} target="_blank" rel="noreferrer" style={downloadBtnStyle}>
                  ↓ {copy.download}
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
                    : { width: "40%", animation: "ultreia-indeterminate 1.1s ease-in-out infinite" }),
                }}
              />
            </div>
          )}
          {installMsg && (
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--warn)", lineHeight: 1.5 }}>
              {installMsg}
            </div>
          )}
          {/* This release's changes, below the actions. The notes flow with the
              page so they never trap touch scrolling. */}
          {cleanReleaseNotes(release.notes)
            ? <ReleaseNotes notes={release.notes} maxChars={800} />
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

const headerStyle = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  gap: 10,
  minWidth: 0,
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

const latestHintStyle = {
  fontFamily: "var(--font-sans)",
  fontSize: 12,
  color: "var(--moss)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const btnStyle = {
  background: "var(--bg)",
  border: "1px solid var(--rule)",
  borderRadius: 6,
  padding: "7px 8px",
  flex: "0 0 auto",
  minWidth: 0,
  maxWidth: 132,
  minHeight: 34,
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  color: "var(--ink-1)",
  cursor: "pointer",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  WebkitTapHighlightColor: "transparent",
};

const buttonWrapStyle = {
  position: "relative",
  flex: "0 0 auto",
  maxWidth: 132,
  display: "flex",
  overflow: "visible",
};

const updateDotStyle = {
  position: "absolute",
  top: -4,
  right: -4,
  width: 8,
  height: 8,
  borderRadius: "50%",
  background: "var(--danger)",
  border: "1px solid var(--bg-elevated)",
  boxShadow: "0 0 0 1px var(--bg-elevated)",
  pointerEvents: "none",
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

const notesBlockStyle = {
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  color: "var(--ink-2)",
  lineHeight: 1.55,
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const noteItemStyle = {
  color: "var(--ink-2)",
};

const noteHeadingStyle = {
  color: "var(--ink-1)",
  fontWeight: 600,
  marginTop: 2,
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
