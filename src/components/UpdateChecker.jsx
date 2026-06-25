import { useState, useEffect } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { useT } from "../i18n/LanguageContext";

// Native bridges (android/.../*.java). On web these are no-op stubs.
//   ApkInstaller  — hands a downloaded APK to the system package installer.
//   ApkDownloader — system DownloadManager: survives backgrounding / screen-off
//                   and shows progress in the notification tray.
const ApkInstaller = registerPlugin("ApkInstaller");
const ApkDownloader = registerPlugin("ApkDownloader");

const isNative = () => Capacitor.isNativePlatform?.() === true;

const GITHUB_RELEASES_API =
  "https://api.github.com/repos/7Wilf7/ultreia/releases/latest";

// China-friendly mirror of the latest APK on Supabase Storage (public bucket),
// uploaded by the release workflow. GitHub's asset CDN is throttled in mainland
// China; the Supabase object isn't, so we try it first.
const SUPABASE_URL = (import.meta.env?.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const MIRROR_APK_URL = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/public/releases/ultreia-latest.apk`
  : null;
const AUTO_CHECK_CACHE_MS = 30 * 60 * 1000;
let releaseCheckCache = null; // { at, status, release }

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

const NOTE_TRANSLATIONS = {
  "replace product logo assets": "更换 Ultreia 新 logo 并同步图标资源",
  "poster mark: centre the watermark": "分享海报水印位置居中",
  "poster mark: extract the real logo line-art, themed per finish": "分享海报背景改用真实 logo 线稿，并跟随风格切换",
  "poster background: brand mark (bold peaks + dots + green tick), drop contours": "分享海报背景改为品牌山形标志",
  "poster: title case headings, keep data labels uppercase": "分享海报标题改为首字母大写，数据标签保留全大写",
  "pwa cache-clear, fresh acwr on review, poster contour+mountain & fixes": "修复 PWA 缓存、训练负荷刷新和海报细节",
  "poster overhaul: contour background, all-time type, single-session controls": "分享海报重做背景、历史类型和单次训练控制",
  "inbox read-on-view; ai coach model switch + weather→calendar": "收件箱完整显示后自动已读，AI Coach 支持切换模型和天气跳转日历",
  "poster signature font: caveat -> alex brush": "分享海报签名字体更新",
  "boot splash: logo + wordmark + built credit": "开屏页改为 logo 和产品名",
  "fix plan-status flash, ul- invite prefix, brand dots in docs": "修复日历计划状态闪动，邀请码改为 UL- 前缀，并补充品牌说明",
  "fix android icon crop and onboarding intro": "修正安卓桌面图标裁切，并补充新手引导名字由来",
  "finalize ultreia logo assets": "定稿 Ultreia logo 并同步图标资源",
  "add horizontal tab motion and cleaner update notes": "优化移动端横滑动画，并清理更新日志",
  "optimize mobile tab gestures and update notes": "优化移动端 tab 手势和更新日志",
  "remove unused legacy logo resources": "清理不再使用的旧 logo 资源",
  "optimize logo assets and poster line background": "优化 logo 资源与海报背景线条",
  "use original product logo assets": "统一使用正确的产品 logo",
  "refine poster logo treatment": "调整分享海报 logo 细节",
  "fix poster logo rendering": "修正分享海报 logo 显示",
  "separate day and night poster themes": "区分分享海报 Day / Night 样式",
  "improve poster background and readability": "优化分享海报背景和可读性",
  "improve mobile settings and tab gestures": "优化移动端设置页和 tab 手势",
  "fix calendar legacy dots and greeting profile": "清理日历旧标记，并修复问候语账号读取",
  "fix login layout and account actions": "修复登录页布局和账号操作入口",
  "add remembered login accounts": "新增登录账号记忆",
  "add email verification flow": "新增邮箱验证流程",
  "fix wallet top-up android notifications": "修复充值提醒的 Android 系统推送",
  "optimize wallet top-up push delivery": "优化充值提醒推送送达稳定性",
  "log wallet top-up push delivery": "补充充值提醒推送链路日志，便于排查送达问题",
  "clarify wallet top-up push delivery": "明确充值提醒推送链路和排查说明",
  "remove training studio legacy names": "清理 Training Studio 旧名称",
  "restore ai coach streaming": "恢复 AI Coach 流式输出",
  "use deepseek only for wallet ai billing": "AI Coach 统一改用 DeepSeek",
  "add configurable weather auto updates": "新增天气每日自动更新与频率设置",
  "add getui push for payment reminders": "接入个推，提升国内充值提醒系统推送",
  "hide public account and wallet surfaces": "隐藏面向公开用户的钱包、注册和管理入口",
};

function localizeNoteLine(line) {
  if (/^\s*full changelog\s*:/i.test(line)) return "";
  const prefix = line.match(/^(\s*[-*]\s*)/)?.[1] || "";
  let text = line.replace(/^\s*[-*]\s*/, "").trim();
  if (!text) return "";
  text = text
    .replace(/^#+\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .trim();
  if (/^(bump|reset)\s+version\s+to\s+v?\d+\.\d+\.\d+$/i.test(text)) return "";
  if (/^bump\s+android\s+release\s+to\s+v?\d+\.\d+\.\d+$/i.test(text)) return "";
  if (/^version\s+bump\s+v?\d+\.\d+\.\d+$/i.test(text)) return "";
  text = text
    .replace(/[;,]?\s*(bump|reset)\s+(version\s+)?(to\s+)?v?\d+\.\d+\.\d+/gi, "")
    .replace(/\bv?\d+\.\d+\.\d+\b/g, "")
    .replace(/\s*\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!text) return "";
  const translated = NOTE_TRANSLATIONS[text.toLowerCase()] || text;
  return `${prefix}${translated}`;
}

// The release notes come from raw git commit subjects, which sometimes mention
// version numbers ("Bump version to 0.9.4"). The version already shows as the
// panel title, so remove release-only version lines and localize common commit
// subjects for the in-app changelog.
function cleanNotes(notes) {
  if (!notes) return "";
  return notes
    .split("\n")
    .map(localizeNoteLine)
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderNotes(notes, maxChars) {
  const cleaned = cleanNotes(notes).slice(0, maxChars);
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
    setStatus("checking");
    try {
      const res = await fetch(GITHUB_RELEASES_API, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const remote = stripV(data.tag_name || "");
      const cmp = compareVersions(remote, currentVersion);
      const nextRelease = {
        version: remote,
        url: data.html_url,
        apkUrl: pickApkAsset(data.assets)?.browser_download_url || null,
        notes: data.body || "",
      };
      const nextStatus = cmp > 0 ? "newer" : "latest";
      setRelease(nextRelease);
      setStatus(nextStatus);
      releaseCheckCache = { at: Date.now(), status: nextStatus, release: nextRelease };
    } catch {
      setStatus("error");
      setRelease(null);
    }
  }

  // Native path: download the APK via the system DownloadManager (survives
  // backgrounding / screen-off, shows a tray notification), then hand it to the
  // system installer. Tries the Supabase mirror first (fast in CN), then the
  // GitHub asset. If every native path fails, open the GitHub URL in the
  // browser — the always-works fallback — so the button never dead-ends.
  async function downloadAndInstall(githubUrl) {
    if (!isNative()) {
      window.open(githubUrl, "_blank", "noreferrer");
      return;
    }
    setInstallMsg("");
    setDownloadPct(null);
    const candidates = [MIRROR_APK_URL, githubUrl].filter(Boolean);
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
      `${t("settings.update_install_failed")} (${reason})` +
      (isNetwork ? ` ${t("settings.update_network_hint")}` : "")
    );
    window.open(githubUrl, "_blank", "noreferrer");
  }

  return (
    <div style={cellStyle}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", width: "100%", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 8 }}>
          <div style={primaryStyle}>{t("settings.version")}</div>
          <div style={{ ...secondaryStyle, marginTop: 0 }}>v{currentVersion}</div>
        </div>
        <div style={{
          display: "grid",
          gridTemplateColumns: status === "latest" && release ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)",
          gap: 6,
          alignItems: "center",
          minWidth: 0,
        }}>
          {status === "latest" && release && (
            <button onClick={() => setShowNotes(o => !o)} style={btnStyle}>
              {t("settings.view_recent")}
            </button>
          )}
          <button
            onClick={() => check({ automatic: false })}
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
        </div>
      </div>

      {status === "error" && (
        <div style={resultErrStyle}>{t("settings.update_error")}</div>
      )}

      {/* Up-to-date: show the latest release notes when the user taps "view
          recent updates". Version as the panel title. */}
      {status === "latest" && showNotes && release && (
        <div style={updatePanelStyle}>
          <div style={panelTitleStyle}>{t("settings.update_recent_title", { v: release.version })}</div>
          {cleanNotes(release.notes)
            ? <ReleaseNotes notes={release.notes} maxChars={1200} />
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
          {cleanNotes(release.notes)
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
  padding: "7px 8px",
  minWidth: 0,
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
