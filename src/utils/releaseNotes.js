const NOTE_TRANSLATIONS = {
  "add image support to ai coach": "智能教练支持图片附件",
  "update hyrox race divisions": "补齐 Hyrox 比赛组别",
  "fix security scan findings": "修复安全扫描问题",
  "align recent coach suggestion menu color": "统一最近教练建议菜单字体颜色",
  "refine coach settings and poster background": "精简教练设置并调整分享海报背景",
  "improve coach adjustment controls": "优化教练综合调整控制",
  "polish coach review suggestions": "精简教练日历建议弹窗",
  "document git pull update reporting": "补充拉取更新后的汇报规则",
  "replace product logo assets": "更换 Ultreia 新标志并同步图标资源",
  "refine poster mark background cleanup": "精修分享海报背景标志",
  "poster mark: centre the watermark": "分享海报水印位置居中",
  "poster mark: extract the real logo line-art, themed per finish": "分享海报背景改用真实标志线稿，并跟随风格切换",
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
  "optimize logo assets and poster line background": "优化标志资源与海报背景线条",
  "use original product logo assets": "统一使用正确的产品标志",
  "refine poster logo treatment": "调整分享海报标志细节",
  "fix poster logo rendering": "修正分享海报标志显示",
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
  "unify post-import coach review adjustments": "统一导入后教练点评与后续调整口径",
  "tighten strength import review and coach adjustment timing": "收紧力量训练导入审核和教练调整触发时机",
  "polish coach header and weekly report layout": "优化教练页顶栏和周复盘布局",
  "document desktop runner launcher": "补充本机运行器启动说明",
};

function hasCjk(text) {
  return /[\u3400-\u9fff]/.test(text);
}

function normalizeChineseTerms(text) {
  return text
    .replace(/\bAI Coach\b/gi, "智能教练")
    .replace(/\bcoach\b/gi, "教练")
    .replace(/\bweekly report\b/gi, "周复盘")
    .replace(/\bdesktop runner\b/gi, "本机运行器")
    .replace(/\brunner\b/gi, "运行器")
    .replace(/\bposter\b/gi, "分享海报")
    .replace(/\blogo\b/gi, "标志")
    .replace(/\bmark\b/gi, "标志")
    .replace(/\blayout\b/gi, "布局")
    .replace(/\breview\b/gi, "点评")
    .replace(/\bsettings\b/gi, "设置")
    .replace(/\bsetting\b/gi, "设置")
    .trim();
}

function inferChineseNote(text) {
  const lower = text.toLowerCase();
  if (/security/.test(lower)) return "修复安全扫描问题";
  if (/hyrox|division/.test(lower)) return "更新 Hyrox 比赛组别";
  if (/no-op.*plan|plan.*no-op|evening slot/.test(lower)) {
    return "过滤无变化的日历调整，并把计划时段统一为晚上";
  }
  if (/unread.*inbox.*tab|inbox.*unread/.test(lower)) {
    return "收件箱各 tab 显示未读数量";
  }
  if (/touch.*dropdown.*flicker|dropdown.*flicker|touch overlays/.test(lower)) {
    return "修复触摸覆盖层和下拉列表闪烁";
  }
  if (/button press animation|press animation/.test(lower)) {
    return "移除不必要的按钮下压动画";
  }
  if (/pwa.*boot|boot.*core data|slow core data/.test(lower)) {
    return "PWA 启动时允许慢数据后台补齐，减少卡在加载页";
  }
  if (/changelog/.test(lower)) return "";
  if (/(tap|tab|chip|dropdown|control|button|modal|card|switch|toggle|selection|filter|action|form|settings)/.test(lower) &&
      /(speed up|responsive|responsiveness|defer|preheat|first-frame|synchronous|faster|improve|tighten|stabilize|dedupe)/.test(lower)) {
    return "提升移动端 tab、按钮和筛选控件的响应速度";
  }
  if (/image|photo|picture/.test(lower)) return "新增图片相关支持";
  if (/poster|logo|mark/.test(lower)) return "优化分享海报和品牌标志";
  if (/runner|launcher/.test(lower)) return "更新本机运行器说明";
  if (/weekly report/.test(lower)) return "优化周复盘体验";
  if (/coach/.test(lower)) return "优化智能教练体验";
  if (/weather/.test(lower)) return "优化天气相关体验";
  if (/doc|readme|guide/.test(lower)) return "更新使用说明";
  return "";
}

function cleanReleaseNoteMarkdown(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .trim();
}

function isVersionOnlyLine(text) {
  return /^(release|bump|reset|version bump)\s+(version\s+)?(to\s+)?v?\d+\.\d+\.\d+$/i.test(text) ||
    /^v?\d+\.\d+\.\d+$/.test(text);
}

function isDateHeading(text) {
  return /^#{1,6}\s*\d{4}-\d{2}-\d{2}\s*$/.test(text) ||
    /^\d{4}-\d{2}-\d{2}$/.test(text);
}

function localizeNoteLine(line) {
  if (/^\s*full changelog\s*:/i.test(line)) return "";
  if (/^\s*#{1,6}\s*\d{4}-\d{2}-\d{2}\s*$/.test(line)) return "";

  const prefix = line.match(/^(\s*[-*]\s*)/)?.[1] || "";
  let text = line.replace(/^\s*[-*]\s*/, "").trim();
  if (!text) return "";
  text = cleanReleaseNoteMarkdown(text.replace(/^#+\s*/, ""));
  if (!text || isDateHeading(text) || isVersionOnlyLine(text)) return "";

  text = text
    .replace(/[;,]?\s*(bump|reset)\s+(version\s+)?(to\s+)?v?\d+\.\d+\.\d+/gi, "")
    .replace(/\bv?\d+\.\d+\.\d+\b/g, "")
    .replace(/\s*\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!text || isDateHeading(text) || isVersionOnlyLine(text)) return "";

  const translated = NOTE_TRANSLATIONS[text.toLowerCase()] || inferChineseNote(text);
  const finalText = hasCjk(text)
    ? normalizeChineseTerms(text)
    : normalizeChineseTerms(translated);
  return finalText ? `${prefix}${finalText}` : "";
}

export function cleanReleaseNotes(notes) {
  if (!notes) return "";
  const seen = new Set();
  const lines = [];
  for (const rawLine of String(notes).split("\n")) {
    const line = localizeNoteLine(rawLine);
    if (!line) continue;
    const key = line.replace(/^[-*]\s*/, "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
