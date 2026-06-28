// ─────────────────────────────────────────────────────────────────────────
// Owner-only prompt catalog — the source of truth for the in-app admin viewer
// (PromptCatalogModal). Every place the product feeds text to an LLM (or
// pre-fills a message) is listed here so it can be reviewed from any device.
//
// IMPORTANT — keeping this in sync:
//   • The CORE system prompt, the daily-checkin template and the preview
//     skeleton are imported LIVE (constants / coachPrompt) so they never drift.
//   • The four prompts that live INLINE in code (plan extractor + memory
//     distill in src/App.jsx; the daily-push prompt in
//     supabase/functions/daily-coach-dispatch/index.ts; the review draft in
//     src/App.jsx) are copied here verbatim. If you edit one of those, update
//     the matching `body` below.
// This file is shipped in the public bundle — but so is the core prompt already
// (requests are assembled client-side), so it leaks nothing new.
// ─────────────────────────────────────────────────────────────────────────

import { FIXED_SYSTEM_PROMPT, FIXED_SYSTEM_PROMPT_ZH, DEFAULT_DAILY_TEMPLATE } from "../constants";
import { buildPromptSkeleton } from "../utils/coachPrompt";

const REVIEW_DRAFT = `请点评下面的训练。{这是刚新增的活动。/ 这是批量导入 N 条活动中的最近 M 条。}

这不是普通闲聊，而是一次“新增活动后的教练回合”。请同时完成两件事：
- 点评这次新增活动本身。
- 结合当前上下文里的 [Planned Sessions]、[Training Load]、[Plan Adherence]、[Day Notes] 和 [Recent Agent Actions]，判断下一次相关计划是否需要调整。

请按这个结构回答：
1. 训练目的和强度判断
2. 恢复风险或需要注意的地方
3. 下一次相关计划结论：只在【保留 / 降量 / 取消 / 暂不判断】里选一个，并用一句话说明
4. 如果需要改日历，只给一个最小、可确认的调整方向；不要输出 JSON，不要假装已经修改日历

规则：
- 这条回复是当前“新增活动 + 下一次计划”的唯一口径；不要在同一条回复里一边说保留，一边又给降量替代方案。
- 如果结论是【保留】，就不要再建议把同一条计划降量或取消。
- 如果结论是【降量】或【取消】，必须说明是因为新增活动后的恢复 / 负荷 / 身体部位影响，还是因为近期计划偏差。
- 不要重写完整训练计划，不要机械补回漏掉的训练量；恢复和负荷保护优先于补量。

[New Activities]
{1. 日期 · 类型 · 距离 · 时长 · 配速 · 爬升 · 心率 · RPE · 备注}`;

const PLAN_EXTRACTOR = `You are a structured-data extractor. The user's AI running coach just produced the reply below. Extract any concrete training suggestions into a JSON array.

Today is {YYYY-MM-DD} ({weekday}, GMT+8).

Coach's reply:
---
{assistant 回复全文}
---

Output a JSON array. Each item:
{
  "date": "YYYY-MM-DD",
  "type": {活动类型枚举},
  "distance": number (kilometres, optional),
  "ascent": number (metres of climb, optional),
  "speed": number (km/h, cycling target, optional),
  "duration": number (MINUTES, optional),
  "subTypes": ["Easy Run" | "Aerobic Run" | "Tempo Run" | "Interval Run" | "Race" | "Upper Body" | "Lower Body" | "Core"] (optional),
  "timeOfDay": "am" | "pm" (optional — ONLY if the coach explicitly says morning/上午 or evening/afternoon/下午/晚上),
  "notes": string (brief Chinese reason — optional)
}

Rules:
- Only extract suggestions that have a clear day (explicit date OR a weekday). Resolve weekdays to the next upcoming occurrence from today.
- Planned sessions may include key_session=true. If the coach clearly changes a key session, emit action="update" with its exact targetPlanId and preserve the coach's reason in notes. Do NOT turn a key-session change into a broad create/rest item that would replace the whole date.
- Each TYPE has its OWN fields — emit only these, omit the rest:
  - Road Run: "distance"; run type in "subTypes" (Easy/Aerobic/Tempo/Interval) when named. No "duration".
  - Trail Run / Hiking: "distance" + "ascent" (m). No "duration".
  - Floor Climbing: "ascent" only.
  - Cycling: "distance" + "speed" (km/h) when given.
  - Swimming: "duration" only.
  - Strength: "subTypes" = area(s); do NOT invent per-area minutes.
  - HIIT: ONLY "timeOfDay" (+ notes); no distance/duration.
- HR zone may go in notes as "Z1".."Z5".
- Skip vague advice, past references, analysis-only text. Rest days get NO entry.
- Output the JSON array ONLY. No prose, no fences.`;

const MEMORY_DISTILL = `You are updating reviewed long-term Memory fact cards about a runner. The facts capture DURABLE, repeatedly-useful information about the user — training patterns, preferences, injuries, recurring concerns, coaching style preferences.

Existing active Memory facts:
{当前已启用 facts}

Recent conversation:
{[role] 内容 …整段对话}

Guidelines:
- Return a COMPLETE, deduplicated active snapshot. Do not output only additions. If an old fact is outdated, replaced, or no longer useful, omit it.
- Keep the exact section headings from the real prompt.
- Use categories strictly:
  - Injuries / Health: injuries, recovery needs, fatigue readiness, health risks, HRV/resting-HR/heart-rate risk signals.
  - Goals / Races: current target races and current race priorities only. Drop completed race results and stale targets.
  - Training Preferences: plan structure, equipment constraints, terrain, schedule preferences, training methods.
  - Coaching Style: how the user wants the coach to communicate, decide, or frame judgment.
  - Recurring Patterns: repeated behavior patterns that affect planning.
- One short fact per line.
- DROP session-specific things (today's specific question, one-off advice).
- Don't repeat what's already in the user's profile (age, location, basic stats).
- Maximum ~500 words. Trim older entries if needed.
- If nothing meaningful should change, return the existing facts unchanged, but normalize them into the section structure when useful.

Output the updated Memory facts in BOTH English and Simplified Chinese — SAME facts, SAME order, line-by-line — using EXACTLY:
===EN===
<english memory, one fact per line>
===ZH===
<中文记忆，每行一条，与英文逐行一一对应>`;

const DAILY_PUSH_SYSTEM = `You are this runner's coach. Write ONE short daily check-in to push as a phone notification. LANGUAGE (most important): write the ENTIRE message in {lang}, and ONLY {lang}. The data below may be in another language — IGNORE its language and still write in {lang}. Do not mix languages. Other hard rules: at most 2 sentences; no greeting, no sign-off, no markdown, no emoji; be specific and actionable using the data (if yesterday was hard, suggest easy today; mind the race countdown). Chinese style rules: write like a Chinese runner would actually read it. Keep race/product names in their standard sports spelling, especially HYROX (never translate it as 海洛克斯). Use Arabic numerals and compact units: 8月15日, 6.2km, 24h, 3-4组. Do NOT spell these as 八月十五日, 六点二公里, 二十四小时, or 三到四组. If [Recent coach chat] is present, treat it as the FRESHEST context and stay consistent with it — do NOT just repeat the same race reminder every day; vary the focus. If there's no recent training, give a brief encouraging nudge. Output ONLY the message text.`;

const DAILY_PUSH_USER = `[Today] {date}
[Recent training (newest first)]
{最多 8 条：日期 类型 距离 时长 HR RPE note}
[Target race] {赛名 on 日期 (~N weeks out) / none}
[Recent coach chat (most recent last)]
{Runner/Coach: …最近对话，可选}
[Notes about this runner] {长期记忆前 600 字，可选}`;

const ASSEMBLE_STRUCTURE = `每条 AI Coach 消息的 system 字段，按顺序拼成（空块跳过）：
1. 核心系统提示词（见下）— 英文版实际发送
2. [Your Profile] 你的资料块
3. [Coach Settings] 风格 / 输出长度 / 干预强度
4. [Long-term Memory] 长期记忆
5. 动态数据块（见下）
对话历史作为 messages 数组一起发送。`;

const DATA_BLOCK_SECTIONS = `每条消息实时拼上的你的数据（有内容才出现）：
[Current Date] 当前时间 GMT+8
[Current Weather] 实时天气
[7-Day Forecast] 未来 7 天预报
[Target Races] 目标赛事（优先级 / 距离 / 爬升）
[Next Race Weather] 下一场目标赛的赛日天气
[Race History] 比赛历史（每类最近一场 + PR）
[Weekly Load] 最近 8 周跑量 + 爬升 + 次数
[Training Load] 平滑 sRPE ACWR（7天 EWMA / 4周 EWMA）
[Morning Readiness] 最近几天睡眠/腿感/精力自评
[Recent Activities (last 10)] 最近 10 条训练（RPE / 备注 / 当时天气）
[Day Notes] 最近 21 天当日标记
[Plan Adherence] 近 14 天计划 vs 完成/部分/漏/跳过
[Planned Sessions] 今天和未来约 21 天计划（只代表已安排，不代表已完成；距离/爬升/速度/主课标记/预报）
[Coaching Focus This Message] 本次触发的周期/热适应/负荷/漏练提醒`;

// Each entry: { id, title, when, source, blocks: [{ label, text }] }
export function getPromptCatalog() {
  return [
    {
      id: "assemble",
      title: "① 系统提示词拼装总图",
      when: "每条 AI Coach 消息",
      source: "src/utils/profile.js · buildSystemPrompt()",
      blocks: [{ label: "结构", text: ASSEMBLE_STRUCTURE }],
    },
    {
      id: "core",
      title: "② 教练核心系统提示词",
      when: "每条 AI Coach 消息（英文版实际发送；这就是 Preview 里隐藏的那段）",
      source: "src/constants.js · FIXED_SYSTEM_PROMPT(_ZH)",
      blocks: [
        { label: "英文版（实际发送）", text: FIXED_SYSTEM_PROMPT },
        { label: "中文版（仅应用内阅读）", text: FIXED_SYSTEM_PROMPT_ZH },
      ],
    },
    {
      id: "data",
      title: "③ 动态数据块",
      when: "每条 AI Coach 消息",
      source: "src/utils/coachPrompt.js · buildDataBlock()",
      blocks: [{ label: "区块清单（顺序）", text: DATA_BLOCK_SECTIONS }],
    },
    {
      id: "review",
      title: "④ 新增活动点评请求",
      when: "新增活动后确认发送给 AI Coach",
      source: "src/App.jsx · buildWorkoutReviewDraft()",
      blocks: [{ label: "消息模板", text: REVIEW_DRAFT }],
    },
    {
      id: "extract",
      title: "⑤ 日历建议整理（计划抽取）",
      when: "点「看看日历建议」时",
      source: "src/App.jsx · importToCalendar()",
      blocks: [{ label: "抽取提示词", text: PLAN_EXTRACTOR }],
    },
    {
      id: "memory",
      title: "⑥ 长期记忆更新（distill）",
      when: "点 Memory 里「自动更新」时",
      source: "src/App.jsx · proposeMemoryUpdate()",
      blocks: [{ label: "蒸馏提示词", text: MEMORY_DISTILL }],
    },
    {
      id: "daily",
      title: "⑦ 每日推送打卡",
      when: "pg_cron 定时（独立于前端，改了要单独部署 Edge Function）",
      source: "supabase/functions/daily-coach-dispatch/index.ts",
      blocks: [
        { label: "system", text: DAILY_PUSH_SYSTEM },
        { label: "user", text: DAILY_PUSH_USER },
      ],
    },
    {
      id: "misc",
      title: "⑧ 其它模板",
      when: "—",
      source: "src/constants.js · DEFAULT_DAILY_TEMPLATE / src/utils/coachPrompt.js · buildPromptSkeleton()",
      blocks: [
        { label: "输入框占位（每日打卡模板）", text: DEFAULT_DAILY_TEMPLATE },
        { label: "应用内 Preview 的脱敏骨架（给用户看的）", text: buildPromptSkeleton("zh") },
      ],
    },
  ];
}
